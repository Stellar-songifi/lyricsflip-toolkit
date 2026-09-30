# Mobile app (`apps/mobile`)

LyricsFlip for iOS and Android, built with Expo SDK 57 (React Native 0.86), Expo Router and TypeScript.
It talks to `apps/game-server`.

## v1 scope

| Feature | Where |
|---|---|
| Sign-in (SEP-10 with the device wallet) | `app/sign-in.tsx`, `src/lib/session.tsx` |
| Home | `app/(tabs)/index.tsx` |
| Solo and rooms | `app/solo.tsx`, `app/rooms.tsx`, `app/play/[id].tsx` |
| Daily challenge | `app/(tabs)/daily.tsx` (server: `GET /daily`, `POST /daily/guess`) |
| Head-to-head: create, share, accept, stake, play | `app/head-to-head.tsx`, `app/challenge/[code].tsx`, `app/match/[id].tsx` |
| Results, including settlement status | `app/results/[id].tsx` |
| Profile and XP progress, username, free test tokens | `app/(tabs)/profile.tsx` |
| Push notifications for challenge invites, stake requests and results | `src/lib/push.ts` (server: `POST /push-tokens`, Expo push service) |
| Deep links: `lyricsflip://challenge/CODE`, `…/match/ID`, `…/results/ID` | `app.json` scheme, `src/lib/links.ts` |
| Haptics on correct guesses | `src/lib/haptics.ts` |

## Wallet

v1 uses a **testnet-only device key**: an ed25519 keypair created on first launch and kept in the device
keychain (`expo-secure-store`). It signs the SEP-10 login challenge and stake transactions.

- It works in Expo Go.
- It refuses to sign for any network but testnet (or a local network).
- It's funded with XLM by friendbot, and gets the stake token from the game server's testnet-only
  faucet (`GET/POST /faucet`) after adding a trustline.

Passkey smart wallets were evaluated in [`wallet-spike.md`](wallet-spike.md). They need an Expo
**development build** (native passkey module plus associated domains), contract-account support on the
server (auth-entry stakes via a relayer), and SEP-45 login. They're the planned next step, not part of v1.

## Stakes on mobile

v1 uses a **free testnet token** for head-to-head stakes. Real-value wagering is not planned for the
app until the contract is audited and app store policy on real-money games has been checked. In `mock`
settlement mode no token is needed: the stake screen submits without a signature.

## React Native setup

`src/lib/polyfills.ts` is the first import in `app/_layout.tsx`. It loads
`react-native-get-random-values` and `react-native-url-polyfill`, plus `fast-text-encoding` if
`TextDecoder` is missing. See [`packages/sdk/README.md`](../packages/sdk/README.md#react-native) for why.

## Running locally

```bash
npm install && npm run build          # from the repository root; the app imports packages/sdk
cd apps/mobile
cp .env.example .env                  # EXPO_PUBLIC_API_URL=http://<your LAN IP>:3001
npx expo start
```

| Variable | Default | Meaning |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://localhost:3001` | The game server |
| `EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | testnet | Anything but a test network is refused |
| `EXPO_PUBLIC_FRIENDBOT_URL` | `https://friendbot.stellar.org` | Funds the device wallet |

Push notifications need a physical device and an EAS project id (`extra.eas.projectId`, added by
`eas init`). Without one, the app skips push registration and everything else works.

## Checks

```bash
npm run lint -w @lyricsflip-toolkit/mobile          # tsc
npm test -w @lyricsflip-toolkit/mobile              # jest-expo
npm run bundle:check -w @lyricsflip-toolkit/mobile  # Metro + Hermes Android bundle
```

CI runs all three. The app has not been run on a physical device or emulator in CI.
