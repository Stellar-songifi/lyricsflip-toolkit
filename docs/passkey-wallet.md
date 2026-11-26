# Passkey-backed wallet: scoping

Follow-up to the testnet keypair spike in [`wallet-spike.md`](wallet-spike.md) (issue #130). This is a
**design/prototype plan**, not shipped code: v1 keeps the ed25519 `Keypair` in `expo-secure-store`.

## Goal

Replace the raw device keypair with a smart-wallet contract whose signer is a platform passkey
(WebAuthn / secp256r1). The player never sees a seed phrase; signing is gated by Face ID / fingerprint
and the credential syncs through iCloud Keychain or Google Password Manager.

## What changes on-chain

- A **smart-wallet contract account (`C...`)** fronts the player. `pvp-escrow` already calls
  `player.require_auth()`, so a contract signer works there without changing the escrow contract.
- The contract's signer policy must be defined: one passkey initially, with a recovery signer (a
  second credential or a trusted guardian contract). Keep the policy upgrade path explicit.
- Stakes can no longer be paid from a `G...` source account directly. The server needs a second path
  in `StellarEscrowGateway`: accept a signed **auth entry** and submit through a fee-paying relayer,
  instead of expecting a signed transaction envelope. Deployment and per-stake fees need an owner.
- Login moves from SEP-10 (proves control of `G...`) to **SEP-45** (proves control of a contract
  account). `Sep10Service` gains a sibling `Sep45Service`; the JWT's `walletAddress` becomes a `C...`.
- Account creation must be atomic enough that a funded contract has its passkey signer installed
  before any stake is accepted.

## What changes in `wallet.ts`

Today `loadOrCreateWallet(store): Promise<Keypair>` returns a secret-bearing object used for both SEP-10
and stake envelopes. Split it into a capability interface:

```ts
interface Wallet {
  address(): string;                       // G... today, C... after migration
  signChallenge(xdr: string, network: string): Promise<string>;
  authorizeStake(xdr: string, network: string): Promise<string>; // auth entry after migration
  signOut(): Promise<void>;
}
```

`loadOrCreateWallet` becomes `loadOrCreateWallet(store): Promise<Wallet>`, with two implementations:
`DeviceKeyWallet` (current behaviour, testnet only) and `PasskeyWallet` (native module + relayer).
`signEnvelope(keypair, ...)` becomes a method on the wallet so callers don't learn which kind it is.
The native passkey module, associated domains (`webcredentials`, `assetlinks.json`) and iOS 17.5+ /
Android SDK 34+ mean this path requires an **Expo development build**, not Expo Go.

## Migration of existing testnet keypair wallets

1. Detect the stored secret (`lyricsflip.testnet.wallet`) and whether the user already has a wallet
   contract record on the server.
2. Offer an explicit in-app migration: create the contract with the existing key as a temporary
   signer, register a passkey, then remove the key signer. Keep the old secret until the first
   successful contract-signed challenge and stake.
3. Map the user's `walletAddress` and any in-flight wagers to the new address; do not silently move
   funds. Testnet-only stakes are disposable, so the first rollout can simply create a new wallet and
   leave the old keypair unfunded.
4. Keep a documented rollback to `DeviceKeyWallet` until the relayer and SEP-45 path are stable.

## Prototype plan (before implementation starts)

- [ ] Stand up a dev build with `react-native-passkeys`; create a credential and verify it on testnet.
- [ ] Deploy a minimal secp256r1 smart-wallet contract; deploy/fund it and exercise one signed
      operation (a no-op or a tiny stake) through a relayer.
- [ ] Add SEP-45 login for that contract and receive a JWT in the mobile app.
- [ ] Confirm biometric gating, credential recovery on a second device, and app-reinstall behaviour.
- [ ] Re-check library maturity/audits (`stellar/passkey-kit`, `stellar/smart-account-kit`) before
      choosing an SDK.

Acceptance for this issue is this reviewed document plus the prototype results; no production wallet
migration is implied.
