//! Resource-cost regression gate (#78).
//!
//! Runs every state-changing entry point against the **release Wasm** (so VM
//! instantiation and Wasm execution are metered, not just host calls) and
//! compares the metered resources with `cost-baseline.txt`:
//!
//! - CPU instructions and memory may not grow by more than
//!   [`MAX_REGRESSION_PERCENT`];
//! - ledger read and write entry counts may not grow at all.
//!
//! Run with `cargo test --release-wasm` equivalents in CI:
//!
//! ```sh
//! cargo build --target wasm32v1-none --release
//! cargo test -p pvp-escrow cost -- --ignored
//! ```
//!
//! After an intentional change, refresh the baseline and commit it:
//!
//! ```sh
//! UPDATE_COST_BASELINE=1 cargo test -p pvp-escrow cost -- --ignored
//! ```
#![cfg(test)]

extern crate std;

use crate::{PotStatus, PvpEscrowClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, BytesN, Env};
use std::collections::BTreeMap;
use std::format;
use std::string::{String, ToString};
use std::vec::Vec;

/// Allowed growth for instructions and memory before CI fails.
pub const MAX_REGRESSION_PERCENT: i64 = 15;

const BASELINE_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/cost-baseline.txt");
const WASM_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../target/wasm32v1-none/release/pvp_escrow.wasm"
);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Cost {
    instructions: i64,
    mem_bytes: i64,
    read_entries: u32,
    write_entries: u32,
}

struct Fixture<'a> {
    env: Env,
    escrow: PvpEscrowClient<'a>,
    player_a: Address,
    player_b: Address,
    session_id: BytesN<16>,
}

fn fixture<'a>() -> Fixture<'a> {
    let wasm = std::fs::read(WASM_PATH).unwrap_or_else(|_| {
        panic!("{WASM_PATH} is missing: run `cargo build --target wasm32v1-none --release` first")
    });
    let env = Env::default();
    // The Wasm constructor's `admin.require_auth()` is not the root invocation.
    env.mock_all_auths_allowing_non_root_auth();
    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let minter = token::StellarAssetClient::new(&env, &sac.address());
    minter.mint(&player_a, &1_000);
    minter.mint(&player_b, &1_000);
    let id = env.register(wasm.as_slice(), (&admin, &resolver, &sac.address()));
    Fixture {
        escrow: PvpEscrowClient::new(&env, &id),
        session_id: BytesN::from_array(&env, &[9u8; 16]),
        env,
        player_a,
        player_b,
    }
}

fn last(env: &Env) -> Cost {
    let r = env.cost_estimate().resources();
    Cost {
        instructions: r.instructions,
        mem_bytes: r.mem_bytes,
        read_entries: r.disk_read_entries + r.memory_read_entries,
        write_entries: r.write_entries,
    }
}

/// Meters one call of every entry point that moves funds or changes state.
fn measure() -> BTreeMap<&'static str, Cost> {
    let mut costs = BTreeMap::new();

    let f = fixture();
    f.escrow
        .open_pot(&f.session_id, &f.player_a, &f.player_b, &500, &1_000);
    costs.insert("open_pot", last(&f.env));
    f.escrow.stake(&f.session_id, &f.player_a);
    costs.insert("stake_first", last(&f.env));
    f.escrow.stake(&f.session_id, &f.player_b);
    costs.insert("stake_second", last(&f.env));
    f.escrow.resolve(&f.session_id, &f.player_a);
    costs.insert("resolve", last(&f.env));
    assert_eq!(f.escrow.get_pot(&f.session_id).status, PotStatus::Resolved);

    let f = fixture();
    f.escrow
        .open_pot(&f.session_id, &f.player_a, &f.player_b, &500, &1_000);
    f.escrow.stake(&f.session_id, &f.player_a);
    f.escrow.stake(&f.session_id, &f.player_b);
    f.escrow.refund(&f.session_id);
    costs.insert("refund", last(&f.env));

    let f = fixture();
    f.escrow
        .open_pot(&f.session_id, &f.player_a, &f.player_b, &500, &1_000);
    f.escrow.stake(&f.session_id, &f.player_a);
    let deadline = f.escrow.get_pot(&f.session_id).deadline_ledger;
    f.env.ledger().set_sequence_number(deadline + 1);
    f.escrow.claim_refund(&f.session_id, &f.player_a);
    costs.insert("claim_refund", last(&f.env));

    let f = fixture();
    f.escrow.pause();
    costs.insert("pause", last(&f.env));

    costs
}

fn render(costs: &BTreeMap<&'static str, Cost>) -> String {
    let mut out = String::from("# entry_point instructions mem_bytes read_entries write_entries\n");
    for (name, c) in costs {
        out += &format!(
            "{name} {} {} {} {}\n",
            c.instructions, c.mem_bytes, c.read_entries, c.write_entries
        );
    }
    out
}

fn parse(text: &str) -> BTreeMap<String, Cost> {
    text.lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .map(|line| {
            let f: Vec<&str> = line.split_whitespace().collect();
            assert_eq!(f.len(), 5, "bad baseline line: {line}");
            (
                f[0].to_string(),
                Cost {
                    instructions: f[1].parse().unwrap(),
                    mem_bytes: f[2].parse().unwrap(),
                    read_entries: f[3].parse().unwrap(),
                    write_entries: f[4].parse().unwrap(),
                },
            )
        })
        .collect()
}

fn grew_too_much(old: i64, new: i64) -> bool {
    new * 100 > old * (100 + MAX_REGRESSION_PERCENT)
}

#[test]
#[ignore = "needs the release Wasm; CI runs it after the wasm build (see the module docs)"]
fn cost_regression_gate() {
    let costs = measure();
    if std::env::var("UPDATE_COST_BASELINE").is_ok() {
        std::fs::write(BASELINE_PATH, render(&costs)).unwrap();
        return;
    }
    let baseline = parse(&std::fs::read_to_string(BASELINE_PATH).unwrap_or_else(|_| {
        panic!("{BASELINE_PATH} is missing: run with UPDATE_COST_BASELINE=1 to create it")
    }));

    let mut problems = Vec::new();
    for (name, now) in &costs {
        let Some(old) = baseline.get(*name) else {
            problems.push(format!(
                "{name}: no baseline (run with UPDATE_COST_BASELINE=1)"
            ));
            continue;
        };
        if grew_too_much(old.instructions, now.instructions) {
            problems.push(format!(
                "{name}: instructions {} -> {} (> {MAX_REGRESSION_PERCENT}%)",
                old.instructions, now.instructions
            ));
        }
        if grew_too_much(old.mem_bytes, now.mem_bytes) {
            problems.push(format!(
                "{name}: memory {} -> {} bytes (> {MAX_REGRESSION_PERCENT}%)",
                old.mem_bytes, now.mem_bytes
            ));
        }
        if now.read_entries > old.read_entries {
            problems.push(format!(
                "{name}: ledger reads {} -> {}",
                old.read_entries, now.read_entries
            ));
        }
        if now.write_entries > old.write_entries {
            problems.push(format!(
                "{name}: ledger writes {} -> {}",
                old.write_entries, now.write_entries
            ));
        }
    }
    std::println!("{}", render(&costs));
    assert!(
        problems.is_empty(),
        "resource regressions against cost-baseline.txt:\n{}\nIf intended, refresh the baseline with UPDATE_COST_BASELINE=1.",
        problems.join("\n")
    );
}

#[test]
fn the_threshold_check_is_strict_above_the_limit() {
    assert!(!grew_too_much(1_000, 1_150));
    assert!(grew_too_much(1_000, 1_151));
}
