#![no_std]
//! A contract account controlled by a single ed25519 key (test fixture).
//!
//! `__check_auth` accepts a 64-byte ed25519 signature by the owner over the
//! Soroban authorisation payload. Real passkey wallets verify secp256r1
//! instead; the auth flow the server sees is the same.

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    BytesN, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum WalletError {
    NotInitialized = 1,
}

#[contracttype]
pub enum DataKey {
    Owner,
}

#[contract]
pub struct TestWallet;

#[contractimpl]
impl TestWallet {
    pub fn __constructor(env: Env, owner: BytesN<32>) {
        env.storage().instance().set(&DataKey::Owner, &owner);
    }
}

#[contractimpl]
impl CustomAccountInterface for TestWallet {
    type Signature = BytesN<64>;
    type Error = WalletError;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: BytesN<64>,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), WalletError> {
        let owner: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(WalletError::NotInitialized)?;
        env.crypto()
            .ed25519_verify(&owner, &signature_payload.into(), &signature);
        Ok(())
    }
}
