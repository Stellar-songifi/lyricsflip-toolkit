#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};

const STAKE: i128 = 500;
const START_BALANCE: i128 = 1_000;
const TIMEOUT: u32 = 1_000;

struct Setup<'a> {
    env: Env,
    admin: Address,
    resolver: Address,
    player_a: Address,
    player_b: Address,
    token: token::Client<'a>,
    escrow: PvpEscrowClient<'a>,
    session_id: BytesN<16>,
}

impl Setup<'_> {
    /// A deployed escrow with two funded players and every auth mocked.
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let resolver = Address::generate(&env);
        let player_a = Address::generate(&env);
        let player_b = Address::generate(&env);

        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let token_admin = token::StellarAssetClient::new(&env, &sac.address());
        token_admin.mint(&player_a, &START_BALANCE);
        token_admin.mint(&player_b, &START_BALANCE);

        let contract_id = env.register(PvpEscrow, (&admin, &resolver, &sac.address()));

        Setup {
            token: token::Client::new(&env, &sac.address()),
            escrow: PvpEscrowClient::new(&env, &contract_id),
            session_id: BytesN::from_array(&env, &[7u8; 16]),
            env,
            admin,
            resolver,
            player_a,
            player_b,
        }
    }

    fn open(&self) {
        self.escrow.open_pot(
            &self.session_id,
            &self.player_a,
            &self.player_b,
            &STAKE,
            &TIMEOUT,
        );
    }

    fn open_and_stake_both(&self) {
        self.open();
        self.escrow.stake(&self.session_id, &self.player_a);
        self.escrow.stake(&self.session_id, &self.player_b);
    }

    fn pass_deadline(&self) {
        let deadline = self.escrow.get_pot(&self.session_id).deadline_ledger;
        self.env.ledger().set_sequence_number(deadline + 1);
    }

    fn escrow_balance(&self) -> i128 {
        self.token.balance(&self.escrow.address)
    }
}

// --- happy path ---------------------------------------------------------

#[test]
fn constructor_stores_the_config() {
    let s = Setup::new();
    let config = s.escrow.get_config();
    assert_eq!(config.admin, s.admin);
    assert_eq!(config.resolver, s.resolver);
    assert_eq!(config.token, s.token.address);
}

#[test]
fn winner_takes_the_whole_pot() {
    let s = Setup::new();
    s.open_and_stake_both();

    assert_eq!(s.token.balance(&s.player_a), START_BALANCE - STAKE);
    assert_eq!(s.token.balance(&s.player_b), START_BALANCE - STAKE);
    assert_eq!(s.escrow_balance(), 2 * STAKE);
    assert_eq!(s.escrow.get_pot(&s.session_id).status, PotStatus::Staked);

    s.escrow.resolve(&s.session_id, &s.player_a);

    assert_eq!(s.token.balance(&s.player_a), START_BALANCE + STAKE);
    assert_eq!(s.token.balance(&s.player_b), START_BALANCE - STAKE);
    assert_eq!(s.escrow_balance(), 0);
    assert_eq!(s.escrow.get_pot(&s.session_id).status, PotStatus::Resolved);
}

#[test]
fn pot_stays_open_until_both_players_stake() {
    let s = Setup::new();
    s.open();
    s.escrow.stake(&s.session_id, &s.player_a);

    let pot = s.escrow.get_pot(&s.session_id);
    assert_eq!(pot.status, PotStatus::Open);
    assert!(pot.player_a_staked);
    assert!(!pot.player_b_staked);
}

#[test]
fn draw_refunds_each_stake_to_its_owner() {
    let s = Setup::new();
    s.open_and_stake_both();

    s.escrow.refund(&s.session_id);

    assert_eq!(s.token.balance(&s.player_a), START_BALANCE);
    assert_eq!(s.token.balance(&s.player_b), START_BALANCE);
    assert_eq!(s.escrow_balance(), 0);
    assert_eq!(s.escrow.get_pot(&s.session_id).status, PotStatus::Refunded);
}

#[test]
fn refund_only_returns_stakes_that_were_made() {
    let s = Setup::new();
    s.open();
    s.escrow.stake(&s.session_id, &s.player_a);

    s.escrow.refund(&s.session_id);

    assert_eq!(s.token.balance(&s.player_a), START_BALANCE);
    assert_eq!(s.token.balance(&s.player_b), START_BALANCE);
    assert_eq!(s.escrow_balance(), 0);
}

#[test]
fn pots_are_independent_per_session() {
    let s = Setup::new();
    s.open_and_stake_both();
    let other = BytesN::from_array(&s.env, &[8u8; 16]);
    s.escrow
        .open_pot(&other, &s.player_a, &s.player_b, &STAKE, &TIMEOUT);
    s.escrow.stake(&other, &s.player_a);

    s.escrow.resolve(&s.session_id, &s.player_b);

    assert_eq!(s.escrow_balance(), STAKE);
    assert_eq!(s.escrow.get_pot(&other).status, PotStatus::Open);
}

// --- resolve guards -----------------------------------------------------

#[test]
fn a_pot_cannot_be_resolved_twice() {
    let s = Setup::new();
    s.open_and_stake_both();
    s.escrow.resolve(&s.session_id, &s.player_a);

    let second = s.escrow.try_resolve(&s.session_id, &s.player_b);

    assert_eq!(second, Err(Ok(Error::PotNotStaked)));
    assert_eq!(s.token.balance(&s.player_b), START_BALANCE - STAKE);
}

#[test]
fn a_resolved_pot_cannot_be_refunded() {
    let s = Setup::new();
    s.open_and_stake_both();
    s.escrow.resolve(&s.session_id, &s.player_a);

    assert_eq!(
        s.escrow.try_refund(&s.session_id),
        Err(Ok(Error::PotNotOpen))
    );
}

#[test]
fn a_refunded_pot_cannot_be_resolved() {
    let s = Setup::new();
    s.open_and_stake_both();
    s.escrow.refund(&s.session_id);

    assert_eq!(
        s.escrow.try_resolve(&s.session_id, &s.player_a),
        Err(Ok(Error::PotNotStaked))
    );
}

#[test]
fn resolver_cannot_pay_someone_outside_the_pot() {
    let s = Setup::new();
    s.open_and_stake_both();
    let outsider = Address::generate(&s.env);

    let result = s.escrow.try_resolve(&s.session_id, &outsider);

    assert_eq!(result, Err(Ok(Error::InvalidWinner)));
    assert_eq!(s.token.balance(&outsider), 0);
    assert_eq!(s.escrow_balance(), 2 * STAKE);
}

#[test]
fn resolver_cannot_pay_the_escrow_itself() {
    let s = Setup::new();
    s.open_and_stake_both();

    let result = s.escrow.try_resolve(&s.session_id, &s.escrow.address);

    assert_eq!(result, Err(Ok(Error::InvalidWinner)));
}

#[test]
fn a_half_staked_pot_cannot_be_resolved() {
    let s = Setup::new();
    s.open();
    s.escrow.stake(&s.session_id, &s.player_a);

    assert_eq!(
        s.escrow.try_resolve(&s.session_id, &s.player_a),
        Err(Ok(Error::PotNotStaked))
    );
}

#[test]
fn an_unknown_pot_cannot_be_resolved() {
    let s = Setup::new();
    assert_eq!(
        s.escrow.try_resolve(&s.session_id, &s.player_a),
        Err(Ok(Error::PotNotFound))
    );
}

// --- staking and opening guards -----------------------------------------

#[test]
fn a_player_cannot_stake_twice() {
    let s = Setup::new();
    s.open();
    s.escrow.stake(&s.session_id, &s.player_a);

    assert_eq!(
        s.escrow.try_stake(&s.session_id, &s.player_a),
        Err(Ok(Error::AlreadyStaked))
    );
    assert_eq!(s.token.balance(&s.player_a), START_BALANCE - STAKE);
}

#[test]
fn outsiders_cannot_stake() {
    let s = Setup::new();
    s.open();
    let outsider = Address::generate(&s.env);

    assert_eq!(
        s.escrow.try_stake(&s.session_id, &outsider),
        Err(Ok(Error::NotAPlayerInPot))
    );
}

#[test]
fn a_player_who_cannot_cover_the_stake_is_refused() {
    let s = Setup::new();
    s.escrow.open_pot(
        &s.session_id,
        &s.player_a,
        &s.player_b,
        &(START_BALANCE + 1),
        &TIMEOUT,
    );

    assert!(s.escrow.try_stake(&s.session_id, &s.player_a).is_err());
    assert_eq!(s.token.balance(&s.player_a), START_BALANCE);
    assert!(!s.escrow.get_pot(&s.session_id).player_a_staked);
}

#[test]
fn staking_into_a_staked_pot_is_refused() {
    let s = Setup::new();
    s.open_and_stake_both();

    assert_eq!(
        s.escrow.try_stake(&s.session_id, &s.player_a),
        Err(Ok(Error::PotNotOpen))
    );
}

#[test]
fn staking_into_an_unknown_pot_is_refused() {
    let s = Setup::new();
    assert_eq!(
        s.escrow.try_stake(&s.session_id, &s.player_a),
        Err(Ok(Error::PotNotFound))
    );
}

#[test]
fn stakes_must_be_positive() {
    let s = Setup::new();
    for amount in [0i128, -1] {
        assert_eq!(
            s.escrow
                .try_open_pot(&s.session_id, &s.player_a, &s.player_b, &amount, &TIMEOUT),
            Err(Ok(Error::InvalidStakeAmount))
        );
    }
}

#[test]
fn a_player_cannot_play_themselves() {
    let s = Setup::new();
    assert_eq!(
        s.escrow
            .try_open_pot(&s.session_id, &s.player_a, &s.player_a, &STAKE, &TIMEOUT),
        Err(Ok(Error::SamePlayer))
    );
}

#[test]
fn a_session_cannot_be_reused() {
    let s = Setup::new();
    s.open();
    assert_eq!(
        s.escrow
            .try_open_pot(&s.session_id, &s.player_a, &s.player_b, &STAKE, &TIMEOUT),
        Err(Ok(Error::PotAlreadyExists))
    );
}

#[test]
fn timeouts_must_be_within_bounds() {
    let s = Setup::new();
    for timeout in [0, MIN_TIMEOUT_LEDGERS - 1, MAX_TIMEOUT_LEDGERS + 1] {
        assert_eq!(
            s.escrow
                .try_open_pot(&s.session_id, &s.player_a, &s.player_b, &STAKE, &timeout),
            Err(Ok(Error::InvalidTimeout))
        );
    }
}
