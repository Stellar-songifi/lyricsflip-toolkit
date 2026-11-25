import { useEffect, useState } from 'react';
import { isOnline, subscribeOnline } from '../lib/network';

/** Reactive connectivity state backed by the shared NetInfo subscription. */
export function useNetworkStatus() {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => subscribeOnline(setOnline), []);
  return { online };
}
