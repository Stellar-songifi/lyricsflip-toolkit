//! Model-based property test for the pot state machine (#75).
//!
//! Generates random sequences of `open_pot`, `stake` (either player, any
//! order), `resolve`, `refund`, `claim_refund`, ledger jumps across
//! `deadline_ledger` and fee changes over a few pots, runs them against the
//! contract (calls that fail are fine), and after **every** step checks:
//!
//! 1. the escrow's token balance equals the sum of `stake_amount` over every
//!    staked flag of every non-terminal pot (`Open`/`Staked`);
//! 2. a pot's status only moves forward: `Open → Staked → {Resolved,
//!    Refunded}` or `Open → Refunded`, never backwards or out of a terminal
//!    state, and a staked flag is never set again once the pot is terminal;
//! 3. no money is created or lost: players + escrow + fee recipient always
//!    hold exactly what was minted;
//! 4. no player is paid twice: what left a pot is never more than what went in,
//!    and a terminal pot has paid out exactly what it took in.
//!
//! 256 cases with a fixed seed, so CI is deterministic. Raise
//! `PROPTEST_CASES` locally to search harder.
#![cfg(test)]

extern crate std;

use crate::{Error, PotStatus, PvpEscrow, PvpEscrowClient};
use proptest::prelude::*;
use proptest::test_runner::{Config, RngSeed};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, BytesN, Env};
use std::vec::Vec;

const POTS: u8 = 3;
const START_BALANCE: i128 = 1_000_000;
const TIMEOUT: u32 = 100;

#[derive(Clone, Debug)]
enum Op {
    Open { pot: u8, stake: i128 },
    Stake { pot: u8, b: bool },
    Resolve { pot: u8, b_wins: bool },
    Refund { pot: u8 },
    Claim { pot: u8, b: bool },
    Advance { ledgers: u32 },
    SetFee { bps: u32 },
}

fn op() -> impl Strategy<Value = Op> {
    let pot = 0..POTS;
    prop_oneof![
        2 => (pot.clone(), 1i128..10_000).prop_map(|(pot, stake)| Op::Open { pot, stake }),
        4 => (pot.clone(), any::<bool>()).prop_map(|(pot, b)| Op::Stake { pot, b }),
        2 => (pot.clone(), any::<bool>()).prop_map(|(pot, b_wins)| Op::Resolve { pot, b_wins }),
        1 => pot.clone().prop_map(|pot| Op::Refund { pot }),
        2 => (pot, any::<bool>()).prop_map(|(pot, b)| Op::Claim { pot, b }),
        2 => (0u32..2 * TIMEOUT).prop_map(|ledgers| Op::Advance { ledgers }),
        1 => (0u32..=1_000).prop_map(|bps| Op::SetFee { bps }),
    ]
}

struct World<'a> {
    env: Env,
    escrow: PvpEscrowClient<'a>,
    token: token::Client<'a>,
    players: Vec<(Address, Address)>,
    treasury: Address,
    /// Per pot: last observed status, tokens in, tokens out.
    seen: Vec<Option<PotStatus>>,
    paid_in: Vec<i128>,
    paid_out: Vec<i128>,
}

fn session(env: &Env, pot: u8) -> BytesN<16> {
    BytesN::from_array(env, &[pot + 1; 16])
}

impl World<'_> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.cost_estimate().budget().reset_unlimited();
        let admin = Address::generate(&env);
        let resolver = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let minter = token::StellarAssetClient::new(&env, &sac.address());
        let players: Vec<(Address, Address)> = (0..POTS)
            .map(|_| {
                let a = Address::generate(&env);
                let b = Address::generate(&env);
                minter.mint(&a, &START_BALANCE);
                minter.mint(&b, &START_BALANCE);
                (a, b)
            })
            .collect();
        let id = env.register(PvpEscrow, (&admin, &resolver, &sac.address()));
        World {
            escrow: PvpEscrowClient::new(&env, &id),
            token: token::Client::new(&env, &sac.address()),
            treasury: Address::generate(&env),
            players,
            seen: (0..POTS).map(|_| None).collect(),
            paid_in: (0..POTS as usize).map(|_| 0).collect(),
            paid_out: (0..POTS as usize).map(|_| 0).collect(),
            env,
        }
    }

    fn escrow_balance(&self) -> i128 {
        self.token.balance(&self.escrow.address)
    }

    fn apply(&mut self, op: &Op) {
        let before = self.escrow_balance();
        let pot = match op {
            Op::Open { pot, .. }
            | Op::Stake { pot, .. }
            | Op::Resolve { pot, .. }
            | Op::Refund { pot }
            | Op::Claim { pot, .. } => Some(*pot),
            _ => None,
        };
        match op {
            Op::Open { pot, stake } => {
                let (a, b) = &self.players[*pot as usize];
                let _ = self
                    .escrow
                    .try_open_pot(&session(&self.env, *pot), a, b, stake, &TIMEOUT);
            }
            Op::Stake { pot, b } => {
                let (pa, pb) = &self.players[*pot as usize];
                let player = if *b { pb } else { pa };
                let _ = self.escrow.try_stake(&session(&self.env, *pot), player);
            }
            Op::Resolve { pot, b_wins } => {
                let (pa, pb) = &self.players[*pot as usize];
                let winner = if *b_wins { pb } else { pa };
                let _ = self.escrow.try_resolve(&session(&self.env, *pot), winner);
            }
            Op::Refund { pot } => {
                let _ = self.escrow.try_refund(&session(&self.env, *pot));
            }
            Op::Claim { pot, b } => {
                let (pa, pb) = &self.players[*pot as usize];
                let player = if *b { pb } else { pa };
                let _ = self
                    .escrow
                    .try_claim_refund(&session(&self.env, *pot), player);
            }
            Op::Advance { ledgers } => {
                let now = self.env.ledger().sequence();
                self.env.ledger().set_sequence_number(now + ledgers);
            }
            Op::SetFee { bps } => {
                let recipient = if *bps == 0 {
                    None
                } else {
                    Some(self.treasury.clone())
                };
                let _ = self.escrow.try_set_fee(bps, &recipient);
            }
        }
        // Attribute the escrow's balance change to the pot the call touched.
        let delta = self.escrow_balance() - before;
        if let Some(p) = pot {
            if delta > 0 {
                self.paid_in[p as usize] += delta;
            } else {
                self.paid_out[p as usize] += -delta;
            }
        } else {
            assert_eq!(delta, 0, "{op:?} moved escrow funds");
        }
    }

    fn check(&mut self, op: &Op) {
        // 1. balance == sum of live stakes
        let mut live = 0i128;
        for p in 0..POTS {
            let pot = match self.escrow.try_get_pot(&session(&self.env, p)) {
                Ok(Ok(pot)) => pot,
                Err(Ok(Error::PotNotFound)) => {
                    assert!(
                        self.seen[p as usize].is_none(),
                        "pot {p} disappeared after {op:?}"
                    );
                    continue;
                }
                other => panic!("get_pot failed: {other:?}"),
            };
            let terminal = matches!(pot.status, PotStatus::Resolved | PotStatus::Refunded);
            if !terminal {
                live +=
                    pot.stake_amount * (pot.player_a_staked as i128 + pot.player_b_staked as i128);
            }
            // 2. forward-only status
            if let Some(prev) = self.seen[p as usize] {
                let ok = match (prev, pot.status) {
                    (a, b) if a == b => true,
                    (PotStatus::Open, PotStatus::Staked | PotStatus::Refunded) => true,
                    (PotStatus::Staked, PotStatus::Resolved | PotStatus::Refunded) => true,
                    _ => false,
                };
                assert!(ok, "pot {p}: {prev:?} -> {:?} after {op:?}", pot.status);
            }
            if terminal {
                assert!(
                    pot.status == PotStatus::Resolved
                        || (!pot.player_a_staked && !pot.player_b_staked),
                    "refunded pot {p} still holds a stake after {op:?}"
                );
                // 4. a settled pot paid out exactly what it took in
                assert_eq!(
                    self.paid_in[p as usize], self.paid_out[p as usize],
                    "terminal pot {p} in/out mismatch after {op:?}"
                );
            }
            // 4. never paid out more than it took in
            assert!(
                self.paid_out[p as usize] <= self.paid_in[p as usize],
                "pot {p} paid out more than it took in after {op:?}"
            );
            self.seen[p as usize] = Some(pot.status);
        }
        assert_eq!(
            self.escrow_balance(),
            live,
            "escrow balance != live stakes after {op:?}"
        );

        // 3. conservation
        let mut total = self.escrow_balance() + self.token.balance(&self.treasury);
        for (a, b) in &self.players {
            total += self.token.balance(a) + self.token.balance(b);
        }
        assert_eq!(
            total,
            2 * START_BALANCE * POTS as i128,
            "tokens created or lost after {op:?}"
        );
    }
}

proptest! {
    #![proptest_config(Config {
        cases: 256,
        rng_seed: RngSeed::Fixed(0x5eed_0075),
        failure_persistence: None,
        ..Config::default()
    })]

    #[test]
    fn pot_invariants_hold_for_any_call_sequence(ops in proptest::collection::vec(op(), 1..40)) {
        let mut world = World::new();
        for op in &ops {
            world.apply(op);
            world.check(op);
        }
    }
}
