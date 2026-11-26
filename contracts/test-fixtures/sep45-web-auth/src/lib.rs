#![no_std]
//! Minimal SEP-45 web auth contract (test fixture).
//!
//! `web_auth_verify(args)` requires the authorisation of the client account
//! (`account`), the server (`web_auth_domain_account`) and, if present, the
//! client domain (`client_domain_account`), as SEP-45 describes. The nonce and
//! the other arguments are checked by the server, not here.

use soroban_sdk::{contract, contracterror, contractimpl, Address, Env, Map, String, Symbol};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum WebAuthError {
    MissingArgument = 1,
}

#[contract]
pub struct WebAuth;

#[contractimpl]
impl WebAuth {
    pub fn web_auth_verify(env: Env, args: Map<Symbol, String>) -> Result<(), WebAuthError> {
        let account = args
            .get(Symbol::new(&env, "account"))
            .ok_or(WebAuthError::MissingArgument)?;
        Address::from_string(&account).require_auth();

        let server = args
            .get(Symbol::new(&env, "web_auth_domain_account"))
            .ok_or(WebAuthError::MissingArgument)?;
        Address::from_string(&server).require_auth();

        if let Some(client_domain) = args.get(Symbol::new(&env, "client_domain_account")) {
            Address::from_string(&client_domain).require_auth();
        }
        Ok(())
    }
}
