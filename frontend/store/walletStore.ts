import { create } from 'zustand';
import type { AuthUser } from '@/lib/auth';

interface WalletState {
  walletId: string | null;
  address: string | null;
  user: AuthUser | null;
  accessToken: string | null;
  isConnecting: boolean;
  setConnecting: (isConnecting: boolean) => void;
  setWallet: (walletId: string, address: string) => void;
  setSession: (user: AuthUser, accessToken: string) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  walletId: null,
  address: null,
  user: null,
  accessToken: null,
  isConnecting: false,
  setConnecting: (isConnecting) => set({ isConnecting }),
  setWallet: (walletId, address) => set({ walletId, address }),
  setSession: (user, accessToken) => set({ user, accessToken, isConnecting: false }),
  disconnect: () => set({ walletId: null, address: null, user: null, accessToken: null }),
}));
