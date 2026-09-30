import '../src/lib/polyfills';
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../src/lib/session';
import { linkFromNotification, registerForPush } from '../src/lib/push';
import { pathFromLink } from '../src/lib/links';
import { colors } from '../src/lib/theme';

/** Sends signed-out players to sign-in, and handles push registration and taps. */
function Gate() {
  const { user, ready, api } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const onSignIn = segments[0] === 'sign-in';
    if (!user && !onSignIn) router.replace('/sign-in');
    if (user && onSignIn) router.replace('/');
  }, [ready, user, segments, router]);

  useEffect(() => {
    if (!user) return;
    void registerForPush(api).catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = linkFromNotification(response);
      const path = url ? pathFromLink(url) : null;
      if (path) router.push(path as never);
    });
    return () => sub.remove();
  }, [user, api, router]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.canvas },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="solo" options={{ title: 'Solo' }} />
      <Stack.Screen name="rooms" options={{ title: 'Rooms' }} />
      <Stack.Screen name="head-to-head" options={{ title: 'Head-to-head' }} />
      <Stack.Screen name="play/[id]" options={{ title: 'Play' }} />
      <Stack.Screen name="challenge/[code]" options={{ title: 'Challenge' }} />
      <Stack.Screen name="match/[id]" options={{ title: 'Match' }} />
      <Stack.Screen name="results/[id]" options={{ title: 'Results' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Gate />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
