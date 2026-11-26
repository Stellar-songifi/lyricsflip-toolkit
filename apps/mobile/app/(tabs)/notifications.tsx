import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Body, Button, ErrorText, Screen, Title } from '../../src/components/ui';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import type { Notification } from '../../src/lib/api';
import { pathFromLink } from '../../src/lib/links';
import { useSession } from '../../src/lib/session';
import { colors, spacing } from '../../src/lib/theme';

/** In-app inbox for the notifications that also produce pushes. */
export default function Notifications() {
  const { api } = useSession();
  const router = useRouter();
  const { online } = useNetworkStatus();
  const wasOnline = useRef(online);
  const [items, setItems] = useState<Notification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      setError(null);
      try {
        const page = await api.notifications.list({ unreadOnly, cursor });
        // #108 will add a paged envelope; today's server returns an array.
        const rows = Array.isArray(page) ? page : page.items;
        setItems((prev) => (cursor ? [...prev, ...rows] : rows));
        setNextCursor(Array.isArray(page) ? null : page.nextCursor);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [api, unreadOnly],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (online && !wasOnline.current) void load();
    wasOnline.current = online;
  }, [online, load]);

  async function open(item: Notification) {
    if (!item.read) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      void api.notifications.markRead(item.id).catch(() => undefined);
    }
    const url = typeof item.data?.url === 'string' ? item.data.url : null;
    const path = url ? pathFromLink(url) : null;
    if (path) router.push(path as never);
  }

  const visible = unreadOnly ? items.filter((item) => !item.read) : items;
  return (
    <Screen>
      <Title>Notifications</Title>
      <Button
        label={unreadOnly ? 'Show all notifications' : 'Show unread only'}
        variant="secondary"
        onPress={() => setUnreadOnly((value) => !value)}
      />
      <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
        {visible.length === 0 ? <Body muted>No notifications here yet.</Body> : null}
        {visible.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => void open(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.message}${item.read ? '' : ', unread'}`}
            style={[styles.row, !item.read && styles.unread]}
          >
            <View style={styles.rowBody}>
              <Text style={styles.message}>{item.message}</Text>
              <Body muted>{new Date(item.createdAt).toLocaleString()}</Body>
            </View>
            {!item.read ? <View style={styles.dot} accessibilityLabel="Unread" /> : null}
          </Pressable>
        ))}
        {nextCursor ? <Button label="Load more" variant="secondary" onPress={() => void load(nextCursor)} /> : null}
        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  unread: { borderWidth: 1, borderColor: colors.accent300 },
  rowBody: { flex: 1, gap: spacing.xs },
  message: { color: colors.text, fontSize: 16 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent300 },
});
