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
