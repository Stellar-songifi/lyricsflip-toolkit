import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Keypair } from '@stellar/stellar-sdk';
import { API_URL } from './config';
import { createApi, type Api, type User } from './api';
import { secureStore } from './secure-store';
import { fundWithFriendbot, loadOrCreateWallet, signEnvelope } from './wallet';

const TOKEN_KEY = 'lyricsflip.jwt';

interface Session {
  api: Api;
  user: User | null;
  wallet: Keypair | null;
  ready: boolean;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  refreshUser(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Signs in with the device's testnet wallet over SEP-10 and keeps the JWT in
 * the keychain, so the player stays signed in between launches.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const token = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState<Keypair | null>(null);
  const [ready, setReady] = useState(false);
  const api = useMemo(() => createApi(API_URL, () => token.current), []);

  const refreshUser = useCallback(async () => {
    setUser(await api.users.me());
  }, [api]);

  useEffect(() => {
    (async () => {
      try {
        setWallet(await loadOrCreateWallet(secureStore));
        token.current = await secureStore.get(TOKEN_KEY);
        if (token.current) await refreshUser();
      } catch {
        token.current = null;
      } finally {
        setReady(true);
      }
    })();
  }, [refreshUser]);

  const signIn = useCallback(async () => {
    const keypair = wallet ?? (await loadOrCreateWallet(secureStore));
    await fundWithFriendbot(keypair.publicKey());
    const challenge = await api.auth.challenge(keypair.publicKey());
    const signed = signEnvelope(keypair, challenge.transactionXdr, challenge.networkPassphrase);
    const { accessToken, user: signedIn } = await api.auth.verify(keypair.publicKey(), signed);
    token.current = accessToken;
    await secureStore.set(TOKEN_KEY, accessToken);
    setWallet(keypair);
    setUser(signedIn);
  }, [api, wallet]);

  const signOut = useCallback(async () => {
    token.current = null;
    await secureStore.set(TOKEN_KEY, '');
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ api, user, wallet, ready, signIn, signOut, refreshUser }),
    [api, user, wallet, ready, signIn, signOut, refreshUser],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}
