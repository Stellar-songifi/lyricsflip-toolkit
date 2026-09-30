#![no_std]

//! Escrow for head-to-head (PvP) matches whose result is decided off-chain.
//!
//! One pot exists per match, keyed by the game server's session UUID (as its
//! 16 raw bytes). Both players stake an equal amount, and a single `resolver`
//! account held by the game server later pays the pot to the winner or
//! refunds it.
//!
//! The resolver can pick a winner but can only pay a player who already
//! staked into that specific pot, and `refund` only ever returns each stake
//! to whoever deposited it. A compromised resolver key can choose the wrong
//! one of the two players but can't drain the contract or redirect funds to
//! an arbitrary address.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env,
};

/// Ledgers per day at ~5 seconds per ledger.
pub const DAY_IN_LEDGERS: u32 = 17_280;
/// Shortest allowed pot timeout: ~5 minutes.
pub const MIN_TIMEOUT_LEDGERS: u32 = 60;
/// Longest allowed pot timeout: ~30 days.
pub const MAX_TIMEOUT_LEDGERS: u32 = 30 * DAY_IN_LEDGERS;
/// Storage lifetime to extend pots and the instance to on every access.
/// Longer than the longest timeout, so a pot stays live until its players
/// can reclaim it.
pub const TTL_EXTEND_TO: u32 = 45 * DAY_IN_LEDGERS;
/// Extend whenever remaining lifetime drops below this.
pub const TTL_THRESHOLD: u32 = TTL_EXTEND_TO - DAY_IN_LEDGERS;

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PotStatus {
    Open = 0,
    Staked = 1,
    Resolved = 2,
    Refunded = 3,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Pot {
    pub session_id: BytesN<16>,
    pub player_a: Address,
    pub player_b: Address,
    pub stake_amount: i128,
    pub player_a_staked: bool,
    pub player_b_staked: bool,
    pub status: PotStatus,
    /// Ledger sequence after which the pot has timed out: no more stakes are
    /// accepted, and each player may reclaim their own stake with
    /// `claim_refund` without the resolver.
    pub deadline_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Resolver,
    Token,
    Pot(BytesN<16>),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    // 1 was `AlreadyInitialized`, from the removed `initialize` entry point.
    NotInitialized = 2,
    // 3 was `NotAuthorized`; authorisation failures now come from `require_auth`.
    PotAlreadyExists = 4,
    PotNotFound = 5,
    PotNotOpen = 6,
    PotNotStaked = 7,
    NotAPlayerInPot = 8,
    AlreadyStaked = 9,
    InvalidStakeAmount = 10,
    InvalidWinner = 11,
    SamePlayer = 12,
    InvalidTimeout = 13,
    DeadlinePassed = 14,
    DeadlineNotReached = 15,
    NothingToClaim = 16,
}

#[contract]
pub struct PvpEscrow;

#[contractimpl]
impl PvpEscrow {
    /// Sets the admin, resolver and stake token.
    ///
    /// Runs atomically as part of deployment (`stellar contract deploy
    /// --wasm ... -- --admin ... --resolver ... --token ...`), so there is no
    /// window between deploy and setup in which someone else could configure
    /// the contract. There is no separate `initialize` entry point, so this
    /// can never run a second time.
    pub fn __constructor(env: Env, admin: Address, resolver: Address, token: Address) {
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Resolver, &resolver);
        env.storage().instance().set(&DataKey::Token, &token);
        Self::extend_instance(&env);
    }

    /// Rotates the resolver key. Admin only.
    pub fn set_resolver(env: Env, resolver: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Resolver, &resolver);
        Ok(())
    }

    /// Hands the admin role to a new address (for example a multisig).
    /// Admin only.
    pub fn set_admin(env: Env, admin: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Opens a pot for a match. Called by the game server after both players
    /// have agreed to an equal stake; no funds move yet. After
    /// `timeout_ledgers` ledgers the pot times out (see `claim_refund`).
    pub fn open_pot(
        env: Env,
        session_id: BytesN<16>,
        player_a: Address,
        player_b: Address,
        stake_amount: i128,
        timeout_ledgers: u32,
    ) -> Result<(), Error> {
        Self::require_resolver(&env)?;

        if !(MIN_TIMEOUT_LEDGERS..=MAX_TIMEOUT_LEDGERS).contains(&timeout_ledgers) {
            return Err(Error::InvalidTimeout);
        }

        if stake_amount <= 0 {
            return Err(Error::InvalidStakeAmount);
        }
        if player_a == player_b {
            return Err(Error::SamePlayer);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Pot(session_id.clone()))
        {
            return Err(Error::PotAlreadyExists);
        }

        let pot = Pot {
            session_id: session_id.clone(),
            player_a,
            player_b,
            stake_amount,
            player_a_staked: false,
            player_b_staked: false,
            status: PotStatus::Open,
            deadline_ledger: env.ledger().sequence() + timeout_ledgers,
        };

        Self::save_pot(&env, &session_id, &pot);
        Ok(())
    }

    /// Transfers `stake_amount` from `player` into the contract. Once both
    /// players have staked, the pot moves to `Staked`.
    pub fn stake(env: Env, session_id: BytesN<16>, player: Address) -> Result<(), Error> {
        player.require_auth();

        let mut pot = Self::load_pot(&env, &session_id)?;
        if pot.status != PotStatus::Open {
            return Err(Error::PotNotOpen);
        }
        if env.ledger().sequence() > pot.deadline_ledger {
            return Err(Error::DeadlinePassed);
        }

        let is_a = player == pot.player_a;
        let is_b = player == pot.player_b;
        if !is_a && !is_b {
            return Err(Error::NotAPlayerInPot);
        }
        if (is_a && pot.player_a_staked) || (is_b && pot.player_b_staked) {
            return Err(Error::AlreadyStaked);
        }

        let token_client = Self::token(&env)?;
        token_client.transfer(&player, env.current_contract_address(), &pot.stake_amount);

        if is_a {
            pot.player_a_staked = true;
        } else {
            pot.player_b_staked = true;
        }
        if pot.player_a_staked && pot.player_b_staked {
            pot.status = PotStatus::Staked;
        }

        Self::save_pot(&env, &session_id, &pot);
        Ok(())
    }

    /// Pays the full pot to `winner`. `winner` must be one of the two
    /// players already staked into this pot — the resolver cannot redirect
    /// funds anywhere else.
    pub fn resolve(env: Env, session_id: BytesN<16>, winner: Address) -> Result<(), Error> {
        Self::require_resolver(&env)?;

        let mut pot = Self::load_pot(&env, &session_id)?;
        // The flags are checked as well as the status: after the deadline a
        // player may have reclaimed their stake with `claim_refund`, which
        // clears their flag while the status can still read `Staked`.
        if pot.status != PotStatus::Staked || !pot.player_a_staked || !pot.player_b_staked {
            return Err(Error::PotNotStaked);
        }
        if winner != pot.player_a && winner != pot.player_b {
            return Err(Error::InvalidWinner);
        }

        let token_client = Self::token(&env)?;
        let pot_total = pot.stake_amount * 2;
        token_client.transfer(&env.current_contract_address(), &winner, &pot_total);

        pot.status = PotStatus::Resolved;
        Self::save_pot(&env, &session_id, &pot);
        Ok(())
    }

    /// Returns each player's own stake to them. Only refunds stakes that
    /// were actually deposited — a player who never staked gets nothing.
    pub fn refund(env: Env, session_id: BytesN<16>) -> Result<(), Error> {
        Self::require_resolver(&env)?;

        let mut pot = Self::load_pot(&env, &session_id)?;
        if pot.status != PotStatus::Open && pot.status != PotStatus::Staked {
            return Err(Error::PotNotOpen);
        }

        let token_client = Self::token(&env)?;
        let contract_address = env.current_contract_address();

        if pot.player_a_staked {
            token_client.transfer(&contract_address, &pot.player_a, &pot.stake_amount);
        }
        if pot.player_b_staked {
            token_client.transfer(&contract_address, &pot.player_b, &pot.stake_amount);
        }

        pot.status = PotStatus::Refunded;
        Self::save_pot(&env, &session_id, &pot);
        Ok(())
    }

    /// Lets a player reclaim their own stake once the pot's deadline has
    /// passed without a `resolve` or `refund`. This is the players' escape
    /// hatch if the game server disappears: funds can't be locked forever.
    ///
    /// Only `player`'s own stake moves, and only to `player`. Once either
    /// player has claimed, the pot no longer holds both stakes, so `resolve`
    /// is refused for good.
    pub fn claim_refund(env: Env, session_id: BytesN<16>, player: Address) -> Result<i128, Error> {
        player.require_auth();

        let mut pot = Self::load_pot(&env, &session_id)?;
        if pot.status != PotStatus::Open && pot.status != PotStatus::Staked {
            return Err(Error::PotNotOpen);
        }
        if env.ledger().sequence() <= pot.deadline_ledger {
            return Err(Error::DeadlineNotReached);
        }

        let is_a = player == pot.player_a;
        let is_b = player == pot.player_b;
        if !is_a && !is_b {
            return Err(Error::NotAPlayerInPot);
        }
        if (is_a && !pot.player_a_staked) || (is_b && !pot.player_b_staked) {
            return Err(Error::NothingToClaim);
        }

        Self::token(&env)?.transfer(&env.current_contract_address(), &player, &pot.stake_amount);

        if is_a {
            pot.player_a_staked = false;
        } else {
            pot.player_b_staked = false;
        }
        if !pot.player_a_staked && !pot.player_b_staked {
            pot.status = PotStatus::Refunded;
        }

        Self::save_pot(&env, &session_id, &pot);
        Ok(pot.stake_amount)
    }

    pub fn get_pot(env: Env, session_id: BytesN<16>) -> Result<Pot, Error> {
        Self::load_pot(&env, &session_id)
    }
}

impl PvpEscrow {
    fn require_admin(env: &Env) -> Result<(), Error> {
        Self::extend_instance(env);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }

    /// Requires the stored resolver's authorisation. The resolver is never
    /// taken from arguments, so a caller can't name themselves as resolver.
    fn require_resolver(env: &Env) -> Result<(), Error> {
        Self::extend_instance(env);
        let resolver: Address = env
            .storage()
            .instance()
            .get(&DataKey::Resolver)
            .ok_or(Error::NotInitialized)?;
        resolver.require_auth();
        Ok(())
    }

    fn token(env: &Env) -> Result<token::Client<'_>, Error> {
        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        Ok(token::Client::new(env, &token_id))
    }

    fn load_pot(env: &Env, session_id: &BytesN<16>) -> Result<Pot, Error> {
        Self::extend_instance(env);
        let key = DataKey::Pot(session_id.clone());
        let pot = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PotNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(pot)
    }

    fn save_pot(env: &Env, session_id: &BytesN<16>, pot: &Pot) {
        let key = DataKey::Pot(session_id.clone());
        env.storage().persistent().set(&key, pot);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn extend_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

mod test;
