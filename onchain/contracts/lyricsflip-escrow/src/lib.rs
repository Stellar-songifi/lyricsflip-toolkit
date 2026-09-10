#![no_std]

//! One wager pot per game session, keyed by the session UUID (as raw bytes).
//!
//! The resolver key can pick a winner but can only pay a player who already
//! staked into that specific pot, and `refund` only ever returns each stake
//! to whoever deposited it. A compromised backend resolver key can choose
//! the wrong winner but can't drain the contract or redirect funds to an
//! arbitrary address.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env,
};

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
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    PotAlreadyExists = 4,
    PotNotFound = 5,
    PotNotOpen = 6,
    PotNotStaked = 7,
    NotAPlayerInPot = 8,
    AlreadyStaked = 9,
    InvalidStakeAmount = 10,
    InvalidWinner = 11,
}

#[contract]
pub struct LyricsFlipEscrowContract;

#[contractimpl]
impl LyricsFlipEscrowContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        resolver: Address,
        token: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Resolver, &resolver);
        env.storage().instance().set(&DataKey::Token, &token);

        Ok(())
    }

    pub fn set_resolver(env: Env, admin: Address, resolver: Address) -> Result<(), Error> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if stored_admin != admin {
            return Err(Error::NotAuthorized);
        }

        env.storage().instance().set(&DataKey::Resolver, &resolver);
        Ok(())
    }

    /// Opens a pot for a head-to-head session. Called by the backend after
    /// both players have agreed to an equal stake; no funds move yet.
    pub fn open_pot(
        env: Env,
        resolver: Address,
        session_id: BytesN<16>,
        player_a: Address,
        player_b: Address,
        stake_amount: i128,
    ) -> Result<(), Error> {
        resolver.require_auth();
        Self::require_resolver(&env, &resolver)?;

        if stake_amount <= 0 {
            return Err(Error::InvalidStakeAmount);
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
        };

        env.storage()
            .persistent()
            .set(&DataKey::Pot(session_id), &pot);
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

        let is_a = player == pot.player_a;
        let is_b = player == pot.player_b;
        if !is_a && !is_b {
            return Err(Error::NotAPlayerInPot);
        }
        if (is_a && pot.player_a_staked) || (is_b && pot.player_b_staked) {
            return Err(Error::AlreadyStaked);
        }

        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let token_client = token::Client::new(&env, &token_id);
        token_client.transfer(&player, env.current_contract_address(), &pot.stake_amount);

        if is_a {
            pot.player_a_staked = true;
        } else {
            pot.player_b_staked = true;
        }
        if pot.player_a_staked && pot.player_b_staked {
            pot.status = PotStatus::Staked;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Pot(session_id), &pot);
        Ok(())
    }

    /// Pays the full pot to `winner`. `winner` must be one of the two
    /// players already staked into this pot — the resolver cannot redirect
    /// funds anywhere else.
    pub fn resolve(
        env: Env,
        resolver: Address,
        session_id: BytesN<16>,
        winner: Address,
    ) -> Result<(), Error> {
        resolver.require_auth();
        Self::require_resolver(&env, &resolver)?;

        let mut pot = Self::load_pot(&env, &session_id)?;
        if pot.status != PotStatus::Staked {
            return Err(Error::PotNotStaked);
        }
        if winner != pot.player_a && winner != pot.player_b {
            return Err(Error::InvalidWinner);
        }

        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let token_client = token::Client::new(&env, &token_id);
        let pot_total = pot.stake_amount * 2;
        token_client.transfer(&env.current_contract_address(), &winner, &pot_total);

        pot.status = PotStatus::Resolved;
        env.storage()
            .persistent()
            .set(&DataKey::Pot(session_id), &pot);
        Ok(())
    }

    /// Returns each player's own stake to them. Only refunds stakes that
    /// were actually deposited — a player who never staked gets nothing.
    pub fn refund(env: Env, resolver: Address, session_id: BytesN<16>) -> Result<(), Error> {
        resolver.require_auth();
        Self::require_resolver(&env, &resolver)?;

        let mut pot = Self::load_pot(&env, &session_id)?;
        if pot.status != PotStatus::Open && pot.status != PotStatus::Staked {
            return Err(Error::PotNotOpen);
        }

        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let token_client = token::Client::new(&env, &token_id);
        let contract_address = env.current_contract_address();

        if pot.player_a_staked {
            token_client.transfer(&contract_address, &pot.player_a, &pot.stake_amount);
        }
        if pot.player_b_staked {
            token_client.transfer(&contract_address, &pot.player_b, &pot.stake_amount);
        }

        pot.status = PotStatus::Refunded;
        env.storage()
            .persistent()
            .set(&DataKey::Pot(session_id), &pot);
        Ok(())
    }

    pub fn get_pot(env: Env, session_id: BytesN<16>) -> Result<Pot, Error> {
        Self::load_pot(&env, &session_id)
    }
}

impl LyricsFlipEscrowContract {
    fn require_resolver(env: &Env, caller: &Address) -> Result<(), Error> {
        let resolver: Address = env
            .storage()
            .instance()
            .get(&DataKey::Resolver)
            .ok_or(Error::NotInitialized)?;
        if &resolver != caller {
            return Err(Error::NotAuthorized);
        }
        Ok(())
    }

    fn load_pot(env: &Env, session_id: &BytesN<16>) -> Result<Pot, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Pot(session_id.clone()))
            .ok_or(Error::PotNotFound)
    }
}

mod test;
