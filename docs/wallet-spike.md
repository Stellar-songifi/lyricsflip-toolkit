# Wallet spike: signing on mobile

> Spike report, September 2026. Decides how `apps/mobile` signs in and signs stakes for v1, and what a
> passkey wallet would take. Libraries change quickly; re-check each one before building on it.

## Question

The Expo app needs a Stellar key that can (1) sign the SEP-10 login challenge and (2) sign the
player's `stake` transaction. Could that be a passkey smart wallet (Face ID / fingerprint, no seed
phrase), and does that rule out Expo Go?

## Options

### A. Passkey smart wallet (secp256r1)

Soroban can verify secp256r1 signatures, so a *smart wallet contract* can use a phone's passkey as
its signer.

| Piece | State |
|---|---|
| [`stellar/passkey-kit`](https://github.com/stellar/passkey-kit) (formerly `kalepail/passkey-kit`) | TypeScript SDK. The client "runs in the browser" on the WebAuthn API, and `passkey-kit/server` holds a relayer secret. Writes are fee-sponsored through the OpenZeppelin Relayer Channels service. There's no React Native support, and it's marked unaudited. |
| [`kalepail/smart-account-kit`](https://github.com/kalepail/smart-account-kit) | OpenZeppelin smart-account contracts with passkeys. Browser-focused, and archived July 2026 in favour of `stellar/smart-account-kit`. |
| Native passkeys in React Native | No WebAuthn in React Native. Libraries such as [`react-native-passkeys`](https://github.com/peterferguson/react-native-passkeys) wrap iOS/Android credential APIs. They need native code, **so an Expo development build, not Expo Go** ([why](https://www.authsignal.com/blog/articles/implementing-passkeys-in-react-native-why-expo-go-falls-short-and-how-to-fix-it)). They also need associated domains: an `apple-app-site-association` file with `webcredentials`, Android `assetlinks.json`, iOS deployment target 17.5+ and Android `compileSdkVersion` ≥ 34 ([Privy's Expo setup](https://docs.privy.io/guide/expo/setup/passkey)). |

What it would change in this toolkit:

- **Addresses become contracts (`C...`).** `pvp-escrow` already works with these, because `stake` calls
  `player.require_auth()`, which a smart wallet satisfies. The server's stake flow doesn't: it builds a
  transaction with the player as the *source account* and checks a signed envelope. A smart wallet signs
  an **authorization entry**, and a relayer supplies the source and fee. `StellarEscrowGateway` would need
  a second path that accepts a signed auth entry and submits through a relayer.
- **Login can't use SEP-10.** SEP-10 proves control of a `G...` account. Contract accounts need
  [SEP-45](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md), which
  `Sep10Service` doesn't implement.
- **Fees.** Someone pays for smart-wallet deployment and every stake, either the relayer or the app.
- **Custody and recovery.** Passkeys sync through iCloud Keychain or Google Password Manager. That's
  good for recovery, but the wallet contract's signer rules become part of the threat model.

### B. Hand-off to an installed wallet app

Deep-link or WalletConnect-style hand-off to a mobile Stellar wallet (for example LOBSTR or xBull) to
sign XDR, then return. This works with the current envelope-based stake flow and with SEP-10. The cost is
UX: two app switches per stake, and players must already have a wallet app. Support for signing arbitrary
Soroban XDR varies by wallet, so each one must be tested.

### C. On-device key (testnet only)

The app generates an ed25519 keypair, stores the secret in the device keychain (`expo-secure-store`),
funds it from testnet friendbot, and signs SEP-10 challenges and stakes locally.

- Works in **Expo Go**, with no native modules beyond Expo's own.
- Uses the toolkit exactly as it is: `G...` address, SEP-10, signed stake envelopes.
- Wrong for real value: the key is only as safe as the phone, and a lost phone loses the key. Acceptable
  only for a free testnet token, which is all v1 allows.

## Recommendation

1. **v1 ships option C, testnet only.** The app refuses to run its wallet against any network passphrase
   other than testnet's. It unblocks sign-in, stakes, push and deep links now, in Expo Go.
2. **Next: option A in a development build**, as its own project:
   - add a relayer-submitted, auth-entry stake path to `StellarEscrowGateway`;
   - add SEP-45 login next to SEP-10;
   - pick `stellar/passkey-kit` or `stellar/smart-account-kit` once one has a React Native story and an audit;
   - host the associated-domain files.
3. **Keep option B as the fallback** for players who already use a wallet app.

Nothing here changes `pvp-escrow`: `require_auth` already accepts both account and contract signers.
