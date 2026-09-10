#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

fn make_card(env: &Env, id: u32) -> Card {
    Card {
        id,
        snippet: String::from_str(env, "I'm gonna pop some tags"),
        artist: String::from_str(env, "Macklemore"),
        title: String::from_str(env, "Thrift Shop"),
        genre: String::from_str(env, "Hip-Hop"),
        decade: 2010,
    }
}

#[test]
fn create_join_and_play_a_round() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LyricsFlipContract, ());
    let client = LyricsFlipContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let host = Address::generate(&env);
    let guest = Address::generate(&env);

    let round_id = client.create_round(&host);
    client.join_round(&round_id, &guest);
    client.add_card(&round_id, &host, &make_card(&env, 0));

    let round = client.get_round(&round_id);
    assert_eq!(round.players.len(), 2);
    assert_eq!(round.cards.len(), 1);
    assert_eq!(round.wager_amount, 0);

    client.start_round(&round_id, &host);
    client.submit_answer(&round_id, &guest, &100, &true);

    let stats = client.get_player_stats(&guest);
    assert_eq!(stats.score, 100);
    assert_eq!(stats.correct_answers, 1);
}

#[test]
fn non_player_cannot_submit_answer() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LyricsFlipContract, ());
    let client = LyricsFlipContractClient::new(&env, &contract_id);

    let host = Address::generate(&env);
    let outsider = Address::generate(&env);

    let round_id = client.create_round(&host);
    client.add_card(&round_id, &host, &make_card(&env, 0));
    client.start_round(&round_id, &host);

    let result = client.try_submit_answer(&round_id, &outsider, &50, &false);
    assert_eq!(result, Err(Ok(Error::NotAPlayer)));
}
