import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Keypair } from '@stellar/stellar-sdk';
import { API_TIMEOUT_MS, API_URL } from './config';
import { createApi, type Api, type ApiError, type User } from './api';
import { captureException } from './errors';
import { secureStore } from './secure-store';
import { fundWithFriendbot, loadOrCreateWallet, signEnvelope } from './wallet';
import { registerForPush } from './push';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

const TOKEN_KEY = 'lyricsflip.jwt';
const PUSH_TOKEN_KEY = 'lyricsflip.push-token';

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
  const { online } = useNetworkStatus();
  const onlineRef = useRef(online);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  const signOut = useCallback(async () => {
    token.current = null;
    await secureStore.set(TOKEN_KEY, '');
    setUser(null);
    // Gate in app/_layout.tsx sends a null user to /sign-in.
  }, []);

  const api = useMemo(
    () =>
      createApi(API_URL, () => token.current, fetch, API_TIMEOUT_MS, {
        isOnline: () => onlineRef.current,
        reportError: (error: ApiError) => captureException(error),
        // A 401 means the JWT is gone: drop it so the player is signed out and
        // routed back to sign-in instead of retrying a dead token on every call.
        onUnauthorized: () => void signOut(),
      }),
    [signOut],
  );

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
    // Register for push and persist the token so signOut can unregister
    const pushToken = await registerForPush(api).catch(() => null);
    if (pushToken) await secureStore.set(PUSH_TOKEN_KEY, pushToken).catch(() => undefined);
  }, [api, wallet]);

  const signOut = useCallback(async () => {
    // Unregister push device before clearing credentials so we still have the token
    const pushToken = await secureStore.get(PUSH_TOKEN_KEY);
    if (pushToken) {
      await api.push.unregister(pushToken).catch(() => undefined);
      await secureStore.delete(PUSH_TOKEN_KEY);
    }
    token.current = null;
    await secureStore.delete(TOKEN_KEY);
    setUser(null);
  }, [api]);

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
