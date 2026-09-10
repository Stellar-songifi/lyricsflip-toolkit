#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

#[test]
fn minter_can_mint_and_owner_is_recorded() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LyricsFlipNftContract, ());
    let client = LyricsFlipNftContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let player = Address::generate(&env);

    client.initialize(&admin, &minter);

    let token_id = client.mint(
        &minter,
        &player,
        &String::from_str(&env, "ipfs://gossip-guru"),
    );
    assert_eq!(client.owner_of(&token_id), player);
    assert_eq!(client.token_count(), 1);
}

#[test]
fn non_minter_cannot_mint() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LyricsFlipNftContract, ());
    let client = LyricsFlipNftContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let impostor = Address::generate(&env);
    let player = Address::generate(&env);

    client.initialize(&admin, &minter);

    let result = client.try_mint(&impostor, &player, &String::from_str(&env, "ipfs://x"));
    assert_eq!(result, Err(Ok(Error::NotAuthorized)));
}
