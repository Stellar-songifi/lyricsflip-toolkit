'use client';

import { useWalletStore } from '@/store/walletStore';
import { connectWallet, signTransaction } from '@/lib/wallet';
import { authApi } from '@/lib/auth';

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WalletConnect() {
  const { address, user, isConnecting, setConnecting, setWallet, setSession, disconnect } =
    useWalletStore();

  async function handleConnect() {
    setConnecting(true);
    try {
      const { id, address } = await connectWallet();
      setWallet(id, address);

      // SEP-10: get a challenge, sign it with the connected wallet, verify.
      const { transactionXdr } = await authApi.getChallenge(address);
      const signedTransactionXdr = await signTransaction(transactionXdr, address);
      const { accessToken, user } = await authApi.verify(address, signedTransactionXdr);
      setSession(user, accessToken);
    } catch (err) {
      console.error('Wallet connection failed', err);
      disconnect();
    }
  }

  if (address) {
    return (
      <button
        onClick={disconnect}
        className="rounded-full border border-brand-400 px-4 py-2 text-sm text-text-primary hover:bg-brand-600/20"
      >
        {user?.username ?? truncateAddress(address)}
      </button>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={isConnecting}
      className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-text-primary hover:bg-brand-400 disabled:opacity-50"
    >
      {isConnecting ? 'Connecting…' : 'Connect wallet'}
    </button>
  );
}
