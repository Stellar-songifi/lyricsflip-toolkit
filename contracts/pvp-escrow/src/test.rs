#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (Address, token::StellarAssetClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let address = sac.address();
    (
        address.clone(),
        token::StellarAssetClient::new(env, &address),
    )
}

#[test]
fn full_wager_lifecycle_pays_the_winner() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    let (token_address, token_admin_client) = create_token_contract(&env, &admin);
    let token_client = token::Client::new(&env, &token_address);

    token_admin_client.mint(&player_a, &1_000);
    token_admin_client.mint(&player_b, &1_000);

    let contract_id = env.register(PvpEscrow, (&admin, &resolver, &token_address));
    let client = PvpEscrowClient::new(&env, &contract_id);

    let session_id = BytesN::from_array(&env, &[7u8; 16]);
    client.open_pot(&resolver, &session_id, &player_a, &player_b, &500);

    client.stake(&session_id, &player_a);
    client.stake(&session_id, &player_b);

    assert_eq!(token_client.balance(&player_a), 500);
    assert_eq!(token_client.balance(&player_b), 500);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    client.resolve(&resolver, &session_id, &player_a);

    assert_eq!(token_client.balance(&player_a), 1_500);
    assert_eq!(token_client.balance(&contract_id), 0);
}

#[test]
fn refund_returns_only_deposited_stakes() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    let (token_address, token_admin_client) = create_token_contract(&env, &admin);
    let token_client = token::Client::new(&env, &token_address);
    token_admin_client.mint(&player_a, &1_000);

    let contract_id = env.register(PvpEscrow, (&admin, &resolver, &token_address));
    let client = PvpEscrowClient::new(&env, &contract_id);

    let session_id = BytesN::from_array(&env, &[9u8; 16]);
    client.open_pot(&resolver, &session_id, &player_a, &player_b, &500);
    client.stake(&session_id, &player_a);

    client.refund(&resolver, &session_id);

    assert_eq!(token_client.balance(&player_a), 1_000);
    assert_eq!(token_client.balance(&player_b), 0);
}

#[test]
fn resolver_cannot_pay_someone_outside_the_pot() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    let outsider = Address::generate(&env);

    let (token_address, token_admin_client) = create_token_contract(&env, &admin);
    token_admin_client.mint(&player_a, &1_000);
    token_admin_client.mint(&player_b, &1_000);

    let contract_id = env.register(PvpEscrow, (&admin, &resolver, &token_address));
    let client = PvpEscrowClient::new(&env, &contract_id);

    let session_id = BytesN::from_array(&env, &[3u8; 16]);
    client.open_pot(&resolver, &session_id, &player_a, &player_b, &500);
    client.stake(&session_id, &player_a);
    client.stake(&session_id, &player_b);

    let result = client.try_resolve(&resolver, &session_id, &outsider);
    assert_eq!(result, Err(Ok(Error::InvalidWinner)));
}
