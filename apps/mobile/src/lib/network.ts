import NetInfo from '@react-native-community/netinfo';

/**
 * A tiny synchronous view of NetInfo. The API client needs a sync answer so it
 * can block non-idempotent writes before they hit a dead connection; the hook
 * in useNetworkStatus.ts subscribes for reactive UI.
 */
let online = true;
let started = false;
const listeners = new Set<(value: boolean) => void>();

function update(value: boolean): void {
  if (value === online) return;
  online = value;
  listeners.forEach((listener) => listener(value));
}

function start(): void {
  if (started) return;
  started = true;
  void NetInfo.fetch().then((state) => update(Boolean(state.isConnected && state.isInternetReachable !== false)));
  NetInfo.addEventListener((state) => update(Boolean(state.isConnected && state.isInternetReachable !== false)));
}

export function isOnline(): boolean {
  start();
  return online;
}

export function subscribeOnline(listener: (value: boolean) => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
