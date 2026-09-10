# frontend

The LyricsFlip web app: Next.js 14 (App Router), Tailwind CSS, Zustand, TanStack Query, Framer Motion, a Socket.IO client and the Stellar Wallets Kit.

## Running locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Runs on `http://localhost:3000`. Point `NEXT_PUBLIC_API_URL` at the backend (`http://localhost:3001` by default — see [`backend/README.md`](../backend/README.md)).

## Structure

```
app/
  page.tsx              # mode selection (solo / rooms / head-to-head) + leaderboard link
  solo/page.tsx          # solo play — REST only
  rooms/page.tsx         # shared rooms — REST to create/join, Socket.IO for live play
  head-to-head/page.tsx  # two-player matches — same as rooms; staking not wired up yet
  leaderboard/page.tsx
components/
  LyricCard.tsx           # the flip card + 15s timer
  GuessForm.tsx
  WalletConnect.tsx        # connects a wallet, then runs the SEP-10 challenge/verify flow
  Providers.tsx             # TanStack Query provider
lib/
  api.ts             # REST client for the backend
  auth.ts             # SEP-10 challenge/verify calls
  socket.ts             # Socket.IO client, connects to the backend's `/game` namespace
  wallet.ts              # Stellar Wallets Kit setup (Freighter, xBull, Albedo, Lobstr, Hana)
  stellarConfig.ts         # reads NEXT_PUBLIC_STELLAR_* env vars
store/
  walletStore.ts    # connected wallet + authenticated user (Zustand)
  gameStore.ts        # current session/lyric/streak (Zustand)
```

## How solo play authenticates

Connecting a wallet (`WalletConnect`) does two things:

1. Opens the Stellar Wallets Kit modal and gets an address.
2. Runs SEP-10: fetches a challenge from `POST /auth/stellar/challenge`, signs it with the connected wallet, and posts it back to `POST /auth/stellar/verify`. The backend returns a JWT and a `User` row, which get stored in `walletStore`.

Every mode uses `user.id` from that session as the player identity when calling the game endpoints.

## Known gaps

- Head-to-head matches don't call the wager endpoints (`POST /wagers`, `/wagers/:id/stake`, `/wagers/:id/settle`) yet — see [`backend/README.md#wager-lifecycle`](../backend/README.md#wager-lifecycle) for what exists server-side to build against.
- No invite-code UI for challenging a specific player by code — matches are joined by session ID today.
- Confetti (or any celebration) on a correct guess isn't implemented.
- No test suite runs in CI yet; `npm test` works locally.

See the [root README](../README.md#known-gaps) for the full list.
