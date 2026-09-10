#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String, Vec};

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RoundStatus {
    Pending = 0,
    Active = 1,
    Finished = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Card {
    pub id: u32,
    pub snippet: String,
    pub artist: String,
    pub title: String,
    pub genre: String,
    pub decade: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Round {
    pub id: u64,
    pub host: Address,
    pub players: Vec<Address>,
    pub status: RoundStatus,
    pub cards: Vec<Card>,
    pub current_card_index: u32,
    /// Always 0 today — real stakes are held by the `lyricsflip-escrow` contract,
    /// not this one. See onchain/README.md#known-gaps.
    pub wager_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Default)]
pub struct PlayerStats {
    pub score: u32,
    pub xp: u32,
    pub correct_answers: u32,
    pub rounds_played: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    NextRoundId,
    Round(u64),
    PlayerStats(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    RoundNotFound = 3,
    RoundNotPending = 4,
    RoundNotActive = 5,
    AlreadyJoined = 6,
    NotAPlayer = 7,
    NoCardsLeft = 8,
    NotAuthorized = 9,
}

#[contract]
pub struct LyricsFlipContract;

#[contractimpl]
impl LyricsFlipContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextRoundId, &0u64);
        Ok(())
    }

    /// Creates a new round hosted by `host`. Wager amount always settles as 0;
    /// wagering is handled entirely by `lyricsflip-escrow`.
    pub fn create_round(env: Env, host: Address) -> Result<u64, Error> {
        host.require_auth();

        let round_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextRoundId)
            .unwrap_or(0);

        let round = Round {
            id: round_id,
            host: host.clone(),
            players: Vec::from_array(&env, [host]),
            status: RoundStatus::Pending,
            cards: Vec::new(&env),
            current_card_index: 0,
            wager_amount: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Round(round_id), &round);
        env.storage()
            .instance()
            .set(&DataKey::NextRoundId, &(round_id + 1));

        Ok(round_id)
    }

    pub fn join_round(env: Env, round_id: u64, player: Address) -> Result<(), Error> {
        player.require_auth();

        let mut round = Self::load_round(&env, round_id)?;
        if round.status != RoundStatus::Pending {
            return Err(Error::RoundNotPending);
        }
        if round.players.contains(&player) {
            return Err(Error::AlreadyJoined);
        }

        round.players.push_back(player);
        env.storage()
            .persistent()
            .set(&DataKey::Round(round_id), &round);

        Ok(())
    }

    /// Adds a lyric card to a pending round. Restricted to the round host.
    pub fn add_card(env: Env, round_id: u64, host: Address, card: Card) -> Result<(), Error> {
        host.require_auth();

        let mut round = Self::load_round(&env, round_id)?;
        if round.host != host {
            return Err(Error::NotAuthorized);
        }
        if round.status != RoundStatus::Pending {
            return Err(Error::RoundNotPending);
        }

        round.cards.push_back(card);
        env.storage()
            .persistent()
            .set(&DataKey::Round(round_id), &round);

        Ok(())
    }

    pub fn start_round(env: Env, round_id: u64, host: Address) -> Result<(), Error> {
        host.require_auth();

        let mut round = Self::load_round(&env, round_id)?;
        if round.host != host {
            return Err(Error::NotAuthorized);
        }
        if round.status != RoundStatus::Pending {
            return Err(Error::RoundNotPending);
        }

        round.status = RoundStatus::Active;
        round.current_card_index = 0;
        env.storage()
            .persistent()
            .set(&DataKey::Round(round_id), &round);

        Ok(())
    }

    /// Advances the round to the next card. Returns the new card index.
    pub fn next_card(env: Env, round_id: u64, host: Address) -> Result<u32, Error> {
        host.require_auth();

        let mut round = Self::load_round(&env, round_id)?;
        if round.host != host {
            return Err(Error::NotAuthorized);
        }
        if round.status != RoundStatus::Active {
            return Err(Error::RoundNotActive);
        }

        let next_index = round.current_card_index + 1;
        if next_index >= round.cards.len() {
            round.status = RoundStatus::Finished;
        } else {
            round.current_card_index = next_index;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Round(round_id), &round);

        Ok(round.current_card_index)
    }

    /// Records a correct or partial answer for `player` on the round's current
    /// card and updates their XP/score totals. Fuzzy-matching the guess text
    /// itself happens off-chain, in the backend; this call only records the
    /// outcome the backend already scored.
    pub fn submit_answer(
        env: Env,
        round_id: u64,
        player: Address,
        points: u32,
        is_correct: bool,
    ) -> Result<(), Error> {
        player.require_auth();

        let round = Self::load_round(&env, round_id)?;
        if round.status != RoundStatus::Active {
            return Err(Error::RoundNotActive);
        }
        if !round.players.contains(&player) {
            return Err(Error::NotAPlayer);
        }

        let mut stats: PlayerStats = env
            .storage()
            .persistent()
            .get(&DataKey::PlayerStats(player.clone()))
            .unwrap_or_default();

        stats.score += points;
        stats.xp += points;
        if is_correct {
            stats.correct_answers += 1;
        }

        env.storage()
            .persistent()
            .set(&DataKey::PlayerStats(player), &stats);

        Ok(())
    }

    pub fn get_round(env: Env, round_id: u64) -> Result<Round, Error> {
        Self::load_round(&env, round_id)
    }

    pub fn get_player_stats(env: Env, player: Address) -> PlayerStats {
        env.storage()
            .persistent()
            .get(&DataKey::PlayerStats(player))
            .unwrap_or_default()
    }
}

impl LyricsFlipContract {
    fn load_round(env: &Env, round_id: u64) -> Result<Round, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Round(round_id))
            .ok_or(Error::RoundNotFound)
    }
}

mod test;
