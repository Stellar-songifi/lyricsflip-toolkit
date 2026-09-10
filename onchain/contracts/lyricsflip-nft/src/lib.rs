#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Minter,
    NextTokenId,
    Owner(u64),
    TokenUri(u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    TokenNotFound = 4,
}

#[contract]
pub struct LyricsFlipNftContract;

#[contractimpl]
impl LyricsFlipNftContract {
    /// Sets the contract admin and the address allowed to mint. Only the
    /// admin can change the minter later via `set_minter`.
    pub fn initialize(env: Env, admin: Address, minter: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Minter, &minter);
        env.storage().instance().set(&DataKey::NextTokenId, &0u64);

        Ok(())
    }

    pub fn set_minter(env: Env, admin: Address, minter: Address) -> Result<(), Error> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if stored_admin != admin {
            return Err(Error::NotAuthorized);
        }

        env.storage().instance().set(&DataKey::Minter, &minter);
        Ok(())
    }

    /// Mints a reward NFT to `to`. Callable only by the configured minter —
    /// today that's an operator key; nothing in `lyricsflip` calls this yet,
    /// so no NFTs are minted automatically on a win. See onchain/README.md.
    pub fn mint(env: Env, minter: Address, to: Address, uri: String) -> Result<u64, Error> {
        minter.require_auth();

        let stored_minter: Address = env
            .storage()
            .instance()
            .get(&DataKey::Minter)
            .ok_or(Error::NotInitialized)?;
        if stored_minter != minter {
            return Err(Error::NotAuthorized);
        }

        let token_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::Owner(token_id), &to);
        env.storage()
            .persistent()
            .set(&DataKey::TokenUri(token_id), &uri);
        env.storage()
            .instance()
            .set(&DataKey::NextTokenId, &(token_id + 1));

        Ok(token_id)
    }

    pub fn owner_of(env: Env, token_id: u64) -> Result<Address, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Owner(token_id))
            .ok_or(Error::TokenNotFound)
    }

    pub fn token_uri(env: Env, token_id: u64) -> Result<String, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::TokenUri(token_id))
            .ok_or(Error::TokenNotFound)
    }

    pub fn token_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(0)
    }
}

mod test;
