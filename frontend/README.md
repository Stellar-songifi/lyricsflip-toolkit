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
  head-to-head/page.tsx  # invite-code challenges, optional staking, live play, settlement
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

## Head-to-head: challenges and staking

`head-to-head/page.tsx` is a small state machine (`idle → waiting-for-opponent → staking → playing → finished`):

1. The host optionally sets a stake (XLM) and creates a challenge (`challengesApi.create`), getting back a short code. The page polls `GET /challenges/:code` every 2s until the opponent accepts.
2. The joiner enters the code (`challengesApi.accept`), which atomically creates the session and — if a stake was set — the wager, and returns both ids straight away.
3. If there's a wager, both clients poll `GET /wagers/:id` and each calls `wagerApi.stake` for themselves; once both have staked, play starts.
4. Once the session's score-tracked rounds finish, whichever client gets there first calls `wagerApi.settle` (highest score wins the pot) or `wagerApi.refund` on a tie. The other client's settle call is a no-op against the same already-settled wager (the backend treats a repeat call with the same winner as idempotent) — see [`backend/README.md#wager-lifecycle`](../backend/README.md#wager-lifecycle).

Amounts are entered in XLM and converted to stroops (`xlmToStroops` in `lib/api.ts`) before hitting the API, which only ever deals in stroop strings.

## Known gaps

- `lyricsflip-nft` reward NFTs are never minted client- or server-side — see the [root README](../README.md#known-gaps).
- Confetti (or any celebration) on a correct guess isn't implemented.
- No test suite runs in CI yet; `npm test` works locally.
- The settlement race between two clients (step 4 above) is resolved by the backend's idempotent `settle`, but it's still two independent clients guessing at "the match is over" from their own socket state rather than a single authoritative server-pushed event.

See the [root README](../README.md#known-gaps) for the full list.
