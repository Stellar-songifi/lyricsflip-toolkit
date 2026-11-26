import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { FRIENDBOT_URL, NETWORK_PASSPHRASE, assertTestNetwork } from './config';

/** Where the device key lives. Injected so tests don't need a keychain. */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const SECRET_KEY = 'lyricsflip.testnet.wallet';

/**
 * The player's testnet key, created on first launch and kept in the device
 * keychain. Testnet only: see docs/wallet-spike.md and docs/passkey-wallet.md.
 */
export async function loadOrCreateWallet(store: SecretStore): Promise<Keypair> {
  assertTestNetwork(NETWORK_PASSPHRASE);
  const existing = await store.get(SECRET_KEY);
  if (existing) return Keypair.fromSecret(existing);
  const created = Keypair.random();
  await store.set(SECRET_KEY, created.secret());
  return created;
}

/**
 * Signs a transaction envelope the server built (a SEP-10 challenge or a
 * stake). Refuses anything not on a test network.
 */
export function signEnvelope(keypair: Keypair, transactionXdr: string, networkPassphrase: string): string {
  assertTestNetwork(networkPassphrase);
  const tx = TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
  tx.sign(keypair);
  return tx.toXDR();
}

/**
 * Returns the raw secret key for the device wallet so the player can back it
 * up. The caller is responsible for confirming intent (e.g. biometric prompt)
 * before displaying the returned string.
 */
export async function exportSecretKey(store: SecretStore): Promise<string | null> {
  return store.get(SECRET_KEY);
}

/**
 * Restores a wallet from a user-supplied secret key. Overwrites any existing
 * device wallet. Throws if the supplied secret is not a valid Stellar secret.
 */
export async function restoreWalletFromSecret(store: SecretStore, secret: string): Promise<Keypair> {
  assertTestNetwork(NETWORK_PASSPHRASE);
  const keypair = Keypair.fromSecret(secret); // throws on invalid input
  await store.set(SECRET_KEY, keypair.secret());
  return keypair;
}

/** Asks friendbot for testnet XLM. Harmless if the account is already funded. */
export async function fundWithFriendbot(address: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  assertTestNetwork(NETWORK_PASSPHRASE);
  await fetchImpl(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`).catch(() => undefined);
}
