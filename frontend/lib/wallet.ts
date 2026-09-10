import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
  xBullModule,
  AlbedoModule,
  LobstrModule,
  HanaModule,
  type ISupportedWallet,
} from '@creit.tech/stellar-wallets-kit';

let kit: StellarWalletsKit | null = null;

/** Lazily built — StellarWalletsKit touches `window`, so this must never run on the server. */
export function getWalletKit(): StellarWalletsKit {
  if (typeof window === 'undefined') {
    throw new Error('getWalletKit() can only be called in the browser');
  }
  if (!kit) {
    kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: [
        new FreighterModule(),
        new xBullModule(),
        new AlbedoModule(),
        new LobstrModule(),
        new HanaModule(),
      ],
    });
  }
  return kit;
}

export async function connectWallet(): Promise<{ id: string; address: string }> {
  const walletKit = getWalletKit();

  return new Promise((resolve, reject) => {
    walletKit
      .openModal({
        onWalletSelected: async (option: ISupportedWallet) => {
          try {
            walletKit.setWallet(option.id);
            const { address } = await walletKit.getAddress();
            resolve({ id: option.id, address });
          } catch (err) {
            reject(err);
          }
        },
        onClosed: (err?: Error) => {
          if (err) reject(err);
        },
      })
      .catch(reject);
  });
}

export async function signTransaction(xdr: string, address: string): Promise<string> {
  const walletKit = getWalletKit();
  const { signedTxXdr } = await walletKit.signTransaction(xdr, { address });
  return signedTxXdr;
}
