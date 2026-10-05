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

// --- timeouts -----------------------------------------------------------

#[test]
fn claim_before_the_deadline_is_refused() {
    let s = Setup::new();
    s.open_and_stake_both();

    assert_eq!(
        s.escrow.try_claim_refund(&s.session_id, &s.player_a),
        Err(Ok(Error::DeadlineNotReached))
    );
    assert_eq!(s.escrow_balance(), 2 * STAKE);
}

#[test]
fn claim_exactly_at_the_deadline_is_refused() {
    let s = Setup::new();
    s.open_and_stake_both();
    let deadline = s.escrow.get_pot(&s.session_id).deadline_ledger;
    s.env.ledger().set_sequence_number(deadline);

    assert_eq!(
        s.escrow.try_claim_refund(&s.session_id, &s.player_a),
        Err(Ok(Error::DeadlineNotReached))
    );
}

#[test]
fn each_player_can_reclaim_their_own_stake_after_the_deadline() {
    let s = Setup::new();
    s.open_and_stake_both();
    s.pass_deadline();

    assert_eq!(s.escrow.claim_refund(&s.session_id, &s.player_a), STAKE);
    assert_eq!(s.token.balance(&s.player_a), START_BALANCE);
    assert_eq!(s.token.balance(&s.player_b), START_BALANCE - STAKE);
    assert_eq!(s.escrow.get_pot(&s.session_id).status, PotStatus::Staked);

    s.escrow.claim_refund(&s.session_id, &s.player_b);
    assert_eq!(s.token.balance(&s.player_b), START_BALANCE);
    assert_eq!(s.escrow_balance(), 0);
    assert_eq!(s.escrow.get_pot(&s.session_id).status, PotStatus::Refunded);
}

#[test]
fn a_player_cannot_claim_twice() {
    let s = Setup::new();
    s.open_and_stake_both();
    s.pass_deadline();
    s.escrow.claim_refund(&s.session_id, &s.player_a);

    assert_eq!(
        s.escrow.try_claim_refund(&s.session_id, &s.player_a),
        Err(Ok(Error::NothingToClaim))
    );
    assert_eq!(s.escrow_balance(), STAKE);
}

#[test]
fn a_player_who_never_staked_has_nothing_to_claim() {
    let s = Setup::new();
    s.open();
    s.escrow.stake(&s.session_id, &s.player_a);
    s.pass_deadline();

    assert_eq!(
        s.escrow.try_claim_refund(&s.session_id, &s.player_b),
        Err(Ok(Error::NothingToClaim))
    );
    s.escrow.claim_refund(&s.session_id, &s.player_a);
    assert_eq!(s.escrow.get_pot(&s.session_id).status, PotStatus::Refunded);
}

#[test]
fn outsiders_cannot_claim() {
    let s = Setup::new();
    s.open_and_stake_both();
    s.pass_deadline();
    let outsider = Address::generate(&s.env);

    assert_eq!(
        s.escrow.try_claim_refund(&s.session_id, &outsider),
        Err(Ok(Error::NotAPlayerInPot))
    );
}

#[test]
fn resolve_is_blocked_once_a_player_has_claimed() {
    let s = Setup::new();
    s.open_and_stake_both();
    s.pass_deadline();
    s.escrow.claim_refund(&s.session_id, &s.player_a);

    assert_eq!(
        s.escrow.try_resolve(&s.session_id, &s.player_b),
        Err(Ok(Error::PotNotStaked))
    );
}

#[test]
fn resolve_still_works_after_the_deadline_if_nobody_claimed() {
    let s = Setup::new();
    s.open_and_stake_both();
    s.pass_deadline();

    s.escrow.resolve(&s.session_id, &s.player_b);
    assert_eq!(s.token.balance(&s.player_b), START_BALANCE + STAKE);
    assert_eq!(
        s.escrow.try_claim_refund(&s.session_id, &s.player_a),
        Err(Ok(Error::PotNotOpen))
    );
}

#[test]
fn resolver_refund_after_a_partial_claim_returns_only_what_is_left() {
    let s = Setup::new();
    s.open_and_stake_both();
    s.pass_deadline();
    s.escrow.claim_refund(&s.session_id, &s.player_a);

    s.escrow.refund(&s.session_id);

    assert_eq!(s.token.balance(&s.player_a), START_BALANCE);
    assert_eq!(s.token.balance(&s.player_b), START_BALANCE);
    assert_eq!(s.escrow_balance(), 0);
}

#[test]
fn staking_after_the_deadline_is_refused() {
    let s = Setup::new();
    s.open();
    s.escrow.stake(&s.session_id, &s.player_a);
    s.pass_deadline();

    assert_eq!(
        s.escrow.try_stake(&s.session_id, &s.player_b),
        Err(Ok(Error::DeadlinePassed))
    );
}

#[test]
fn resolver_can_refund_before_the_deadline() {
    let s = Setup::new();
    s.open_and_stake_both();

    s.escrow.refund(&s.session_id);

    assert_eq!(s.escrow_balance(), 0);
    assert_eq!(
        s.escrow.try_claim_refund(&s.session_id, &s.player_a),
        Err(Ok(Error::PotNotOpen))
    );
}

// --- authorisation ------------------------------------------------------

use soroban_sdk::testutils::{AuthorizedFunction, AuthorizedInvocation, MockAuth, MockAuthInvoke};
use soroban_sdk::{IntoVal, Symbol};

impl Setup<'_> {
    /// Replaces the blanket auth mock with a single signature from `signer`
    /// over `function(args)`.
    fn only_signed_by(
        &self,
        signer: &Address,
        function: &str,
        args: soroban_sdk::Vec<soroban_sdk::Val>,
    ) {
        self.env.mock_auths(&[MockAuth {
            address: signer,
            invoke: &MockAuthInvoke {
                contract: &self.escrow.address,
                fn_name: function,
                args,
                sub_invokes: &[],
            },
        }]);
    }

    fn last_auth_was(&self, signer: &Address, function: &str) -> bool {
        self.env.auths().iter().any(|(address, invocation)| {
            address == signer
                && matches!(
                    invocation,
                    AuthorizedInvocation {
                        function: AuthorizedFunction::Contract((contract, name, _)),
                        ..
                    } if *contract == self.escrow.address && *name == Symbol::new(&self.env, function)
                )
        })
    }
}

#[test]
fn resolve_requires_the_resolver_signature() {
    let s = Setup::new();
    s.open_and_stake_both();

    s.escrow.resolve(&s.session_id, &s.player_a);

    assert!(s.last_auth_was(&s.resolver, "resolve"));
}

#[test]
fn a_player_cannot_resolve_in_their_own_favour() {
    let s = Setup::new();
    s.open_and_stake_both();
    s.only_signed_by(
        &s.player_a,
        "resolve",
        (s.session_id.clone(), s.player_a.clone()).into_val(&s.env),
    );

    assert!(s.escrow.try_resolve(&s.session_id, &s.player_a).is_err());
    assert_eq!(s.escrow_balance(), 2 * STAKE);
}

#[test]
fn only_the_resolver_can_open_a_pot() {
    let s = Setup::new();
    let outsider = Address::generate(&s.env);
    s.only_signed_by(
        &outsider,
        "open_pot",
        (
            s.session_id.clone(),
            s.player_a.clone(),
            s.player_b.clone(),
            STAKE,
            TIMEOUT,
        )
            .into_val(&s.env),
    );

    assert!(s
        .escrow
        .try_open_pot(&s.session_id, &s.player_a, &s.player_b, &STAKE, &TIMEOUT)
        .is_err());
}

#[test]
fn only_the_resolver_can_refund() {
    let s = Setup::new();
    s.open_and_stake_both();
    s.only_signed_by(
        &s.player_a,
        "refund",
        (s.session_id.clone(),).into_val(&s.env),
    );

    assert!(s.escrow.try_refund(&s.session_id).is_err());
    assert_eq!(s.escrow_balance(), 2 * STAKE);
}

#[test]
fn a_stake_needs_the_players_own_signature() {
    let s = Setup::new();
    s.open();
    s.only_signed_by(
        &s.resolver,
        "stake",
        (s.session_id.clone(), s.player_b.clone()).into_val(&s.env),
    );

    assert!(s.escrow.try_stake(&s.session_id, &s.player_b).is_err());
    assert_eq!(s.token.balance(&s.player_b), START_BALANCE);
}

#[test]
fn nobody_can_claim_another_players_stake() {
    let s = Setup::new();
    s.open_and_stake_both();
    s.pass_deadline();
    s.only_signed_by(
        &s.player_b,
        "claim_refund",
        (s.session_id.clone(), s.player_a.clone()).into_val(&s.env),
    );

    assert!(s
        .escrow
        .try_claim_refund(&s.session_id, &s.player_a)
        .is_err());
    assert_eq!(s.escrow_balance(), 2 * STAKE);
}

#[test]
fn only_the_admin_can_rotate_the_resolver() {
    let s = Setup::new();
    let attacker = Address::generate(&s.env);
    s.only_signed_by(
        &s.resolver,
        "set_resolver",
        (attacker.clone(),).into_val(&s.env),
    );

    assert!(s.escrow.try_set_resolver(&attacker).is_err());
    assert_eq!(s.escrow.get_config().resolver, s.resolver);
}

#[test]
fn the_admin_can_rotate_the_resolver() {
    let s = Setup::new();
    let new_resolver = Address::generate(&s.env);

    s.escrow.set_resolver(&new_resolver);

    assert!(s.last_auth_was(&s.admin, "set_resolver"));
    assert_eq!(s.escrow.get_config().resolver, new_resolver);
}

#[test]
fn only_the_admin_can_hand_over_the_admin_role() {
    let s = Setup::new();
    let attacker = Address::generate(&s.env);
    s.only_signed_by(&attacker, "set_admin", (attacker.clone(),).into_val(&s.env));

    assert!(s.escrow.try_set_admin(&attacker).is_err());
    assert_eq!(s.escrow.get_config().admin, s.admin);
}

#[test]
fn deploying_requires_the_admin_signature() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let token = Address::generate(&env);

    env.register(PvpEscrow, (&admin, &resolver, &token));

    let auths = env.auths();
    assert!(
        auths.iter().any(|(address, invocation)| *address == admin
            && matches!(
                invocation.function,
                AuthorizedFunction::Contract((_, ref name, _)) if *name == Symbol::new(&env, "__constructor")
            )),
        "constructor did not require admin auth: {:?}",
        auths
    );
}

#[test]
fn there_is_no_initialize_entry_point_left_to_front_run() {
    let s = Setup::new();
    let result = s.env.try_invoke_contract::<(), Error>(
        &s.escrow.address,
        &Symbol::new(&s.env, "initialize"),
        (s.admin.clone(), s.resolver.clone(), s.token.address.clone()).into_val(&s.env),
    );
    assert!(result.is_err());
}

// --- events -------------------------------------------------------------

#[test]
fn resolve_publishes_the_winner_and_payout() {
    use soroban_sdk::testutils::Events as _;
    use soroban_sdk::Event as _;

    let s = Setup::new();
    s.open_and_stake_both();
    s.escrow.resolve(&s.session_id, &s.player_a);

    let expected = Resolved {
        session_id: s.session_id.clone(),
        winner: s.player_a.clone(),
        payout: 2 * STAKE,
    };
    let events = s.env.events().all();
    let last = events.events().last().expect("an event").clone();
    assert_eq!(last, expected.to_xdr(&s.env, &s.escrow.address));
}

/// The last event the escrow published, decoded, so a test can name the event
/// type it expects without hand-rolling XDR.
fn last_event(s: &Setup) -> soroban_sdk::xdr::ContractEvent {
    use soroban_sdk::testutils::Events as _;
    s.env
        .events()
        .all()
        .events()
        .last()
        .expect("an event")
        .clone()
}

#[test]
fn stake_publishes_the_stake_amount() {
    use soroban_sdk::Event as _;

    let s = Setup::new();
    s.open();
    s.escrow.stake(&s.session_id, &s.player_a);

    // Without `stake_amount` an indexer would have to read the Pot to know how
    // much moved; the event must carry it.
    let expected = Staked {
        session_id: s.session_id.clone(),
        player: s.player_a.clone(),
        stake_amount: STAKE,
    };
    assert_eq!(last_event(&s), expected.to_xdr(&s.env, &s.escrow.address));
}

#[test]
fn refund_publishes_the_amount_returned_to_each_player() {
    use soroban_sdk::Event as _;

    let s = Setup::new();
    s.open_and_stake_both();
    s.escrow.refund(&s.session_id);

    let expected = Refunded {
        session_id: s.session_id.clone(),
        player_a_amount: STAKE,
        player_b_amount: STAKE,
    };
    assert_eq!(last_event(&s), expected.to_xdr(&s.env, &s.escrow.address));
}

#[test]
fn refund_event_reports_zero_for_a_player_who_never_staked() {
    use soroban_sdk::Event as _;

    let s = Setup::new();
    s.open();
    s.escrow.stake(&s.session_id, &s.player_a);
    s.escrow.refund(&s.session_id);

    // Player B never staked, so their refund is 0 — visible in the event, not
    // only inferable from the balance delta.
    let expected = Refunded {
        session_id: s.session_id.clone(),
        player_a_amount: STAKE,
        player_b_amount: 0,
    };
    assert_eq!(last_event(&s), expected.to_xdr(&s.env, &s.escrow.address));
}

#[test]
fn refund_event_reports_zero_for_a_stake_already_reclaimed() {
    use soroban_sdk::Event as _;

    let s = Setup::new();
    s.open_and_stake_both();
    s.pass_deadline();
    s.escrow.claim_refund(&s.session_id, &s.player_a);

    s.escrow.refund(&s.session_id);

    // Player A already took their stake back, so the resolver refund returns
    // nothing to them and the full stake only to B.
    let expected = Refunded {
        session_id: s.session_id.clone(),
        player_a_amount: 0,
        player_b_amount: STAKE,
    };
    assert_eq!(last_event(&s), expected.to_xdr(&s.env, &s.escrow.address));
}
