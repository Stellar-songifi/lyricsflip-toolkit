import { Networks } from '@stellar/stellar-sdk';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

export const NETWORK_PASSPHRASE =
  process.env.EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;

export const FRIENDBOT_URL = process.env.EXPO_PUBLIC_FRIENDBOT_URL ?? 'https://friendbot.stellar.org';

/**
 * The app's wallet is a key on the device (see docs/wallet-spike.md). That is
 * only acceptable for a free testnet token, so every other network is refused.
 */
export const ALLOWED_PASSPHRASES = new Set<string>([Networks.TESTNET, 'Standalone Network ; February 2017']);

export function assertTestNetwork(passphrase: string): void {
  if (!ALLOWED_PASSPHRASES.has(passphrase)) {
    throw new Error(`This app only signs on test networks, not "${passphrase}"`);
  }
}
