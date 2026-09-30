# Mobile app (`apps/mobile`)

> **Planned.** This describes the target for v1. Nothing here is built yet.

LyricsFlip for iOS and Android, built with Expo (React Native), Expo Router and TypeScript.
It talks to `apps/game-server`.

## v1 scope

- Sign-in, home, solo, rooms, daily challenge, head-to-head, results, profile and XP
- Push notifications for challenge invites and match results (`expo-notifications`)
- Deep links: an invite code opens the app straight into the challenge (`expo-linking`)
- Haptics on correct guesses

## Wallets

Still being evaluated. The leading option is a **passkey smart wallet**: Soroban supports secp256r1
signature checks, so a phone's Face ID or fingerprint can authorise transactions with no seed phrase
and no browser extension. Open questions for the spike:

- Which React Native library can create passkeys and sign Soroban auth entries
- Whether this needs an Expo development build instead of Expo Go
- Fallback: handing signing off to an installed mobile wallet app

## Stakes on mobile

v1 uses a **free testnet token** for head-to-head stakes. Real-value wagering is not planned for the
app until the contract is audited and app store policy on real-money games has been checked.

## Running locally

```bash
cd apps/mobile
npx expo start
```

Set the game server URL in the app's env file (name finalised when the app is scaffolded).
