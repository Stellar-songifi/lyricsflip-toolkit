/**
 * Next.js inlines `NEXT_PUBLIC_*` variables into the client bundle at build
 * time, so reading them directly here works in both server and browser
 * contexts — no `window.__ENV` indirection needed.
 */
export const stellarConfig = {
  rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  networkPassphrase:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
  lyricsflipContractId: process.env.NEXT_PUBLIC_LYRICSFLIP_CONTRACT_ID ?? '',
  lyricsflipNftContractId: process.env.NEXT_PUBLIC_LYRICSFLIP_NFT_CONTRACT_ID ?? '',
} as const;
