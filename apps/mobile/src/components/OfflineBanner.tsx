import { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { Body } from './ui';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { colors, spacing } from '../lib/theme';

/** Visible, announced state for a device that has lost connectivity. */
export function OfflineBanner() {
  const { online } = useNetworkStatus();
  const previous = useRef(online);

  useEffect(() => {
    if (previous.current === online) return;
    previous.current = online;
    AccessibilityInfo.announceForAccessibility(
      online ? 'Back online. Refreshing your game.' : "You're offline. Showing the last known state.",
    );
  }, [online]);

  if (online) return null;
  return (
    <View accessibilityRole="alert" accessibilityLabel="You are offline" style={styles.banner}>
      <Body>Offline — showing the last known state.</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.error,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
});
