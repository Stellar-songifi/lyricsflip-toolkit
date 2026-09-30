# @lyricsflip-toolkit/sdk

TypeScript client for the [`pvp-escrow`](../../contracts/pvp-escrow) Soroban contract, plus amount
helpers that keep stakes as stroop strings and never floats. It runs in Node (22.12+) and React Native.

> Package name is a placeholder; nothing is published to npm. Use it from this workspace.

## What's in it

| Export | What it does |
|---|---|
| `PvpEscrowClient` | One method per contract call. `openPot`, `resolve` and `refund` sign with the resolver key and submit. `buildStake` and `buildClaimRefund` return a prepared transaction for a player's wallet to sign. |
| `PvpEscrowClient#assertIsStake` | Throws unless a signed envelope is exactly `stake(potId, player)` on this contract. Run it on anything a client sends back. |
| `PvpEscrowClient#getPot` / `getConfig` | Read contract state (free simulations). `getPot` returns `null` for an unknown pot. |
| `SorobanRpc` | Builds, simulates, submits and polls. Every submission ends as `confirmed`, `pending` (outcome unknown: reconcile, don't retry blindly) or `failed` (definitely changed nothing). |
| `toStroops`, `fromStroops`, `assertPositiveStroops`, ... | Amounts as decimal strings of base units (1 token = 10,000,000 stroops). They throw `InvalidAmountError` on floats, too many decimals, or values outside i128. |
| `potIdToScVal` | Encodes a UUID as the contract's 16-byte pot key. |
| `PvpEscrowError` | The contract's error codes, for use with `isContractError(err, code)`. |

## Example: a player reclaims their stake after a timeout

If the game server disappears, each player can take their own stake back once the pot's deadline
ledger has passed. No server is needed:

```ts
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { PvpEscrowClient, SorobanRpc } from '@lyricsflip-toolkit/sdk';

const rpc = new SorobanRpc({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
});
const escrow = new PvpEscrowClient(rpc, ESCROW_CONTRACT_ID);

const pot = await escrow.getPot(wagerId);
const tx = await escrow.buildClaimRefund(wagerId, myAddress);
// Sign in the player's wallet. With a local keypair:
const result = await rpc.signAndSubmit(tx, [Keypair.fromSecret(mySecret)]);
console.log(result.status); // 'confirmed'
```

## React Native

The SDK itself uses no Node APIs: no `Buffer`, `crypto` or `process`. `test/no-node-globals.spec.ts`
runs the built SDK with `Buffer` deleted to check this. `@stellar/stellar-sdk` 17's core (`base`,
`rpc`, `contract`) doesn't use `Buffer` either, but it does rely on web APIs that React Native's
Hermes runtime doesn't fully provide. Import these polyfills once, before anything imports
`@stellar/stellar-sdk`:

```ts
// index.js / app entry, first lines
import 'react-native-get-random-values'; // crypto.getRandomValues: Keypair.random(), noble hashes
import 'react-native-url-polyfill/auto'; // full URL / URLSearchParams: the RPC fetch client builds URLs
```

| API | Needed by | Provided by Hermes? | Polyfill |
|---|---|---|---|
| `crypto.getRandomValues` | random keys, nonces | No | `react-native-get-random-values` |
| `URL`, `URLSearchParams` | RPC HTTP client | Partly (many properties throw) | `react-native-url-polyfill` |
| `TextEncoder` | XDR strings | Yes (RN 0.74+) | — |
| `TextDecoder` | XDR strings | Check your RN version | `fast-text-encoding` if `typeof TextDecoder === 'undefined'` |
| `fetch`, `AbortController` | RPC HTTP client | Yes | — |
| `BigInt` | amounts | Yes | — |
| `Buffer` | not needed | — | — |

`apps/mobile` uses exactly this setup. See [`docs/mobile.md`](../../docs/mobile.md).

## Tests

```bash
npm test -w @lyricsflip-toolkit/sdk
```
