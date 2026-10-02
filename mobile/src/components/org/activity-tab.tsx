import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, Empty } from '@/components/controls';
import { orgsApi } from '@/lib/endpoints';
import { formatDate, formatTime } from '@/lib/format';
import { colors, radius } from '@/lib/theme';
import { ActivityEntry } from '@/lib/types';
import { useSocketEvent } from '@/state/socket';

/**
 * «История» — таймлайн действий организации (SPEC v3 §18):
 * GET /api/orgs/:id/activity + «Показать ещё» + live activity:new.
 */
export function ActivityTab({ orgId }: { orgId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    orgsApi
      .activity(orgId)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.activity);
        setHasMore(res.hasMore);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Не удалось загрузить историю');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // realtime: новые записи появляются сверху без перезагрузки
  useSocketEvent('activity:new', (payload) => {
    const item = payload.activity;
    if (!item?.id) return;
    setEntries((prev) => (prev.some((e) => e.id === item.id) ? prev : [item, ...prev]));
  });

  const loadMore = async () => {
    if (loadingMore || entries.length === 0) return;
    setLoadingMore(true);
    try {
      const res = await orgsApi.activity(orgId, entries[0].id);
      setEntries((prev) => {
        const known = new Set(prev.map((e) => e.id));
        return [...prev, ...res.activity.filter((e) => !known.has(e.id))];
      });
      setHasMore(res.hasMore);
    } catch {
      // keep the current page
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>История действий</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && entries.length === 0 ? <Empty text="История пока пуста" /> : null}

      {entries.map((entry) => (
        <View key={entry.id} style={styles.row}>
          <View style={styles.timeline}>
            <View style={styles.dot} />
            <View style={styles.line} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.details}>{entry.details}</Text>
            <Text style={styles.meta}>
              {formatDate(entry.createdAt)} · {formatTime(entry.createdAt)}
            </Text>
          </View>
          {entry.actor ? (
            <Avatar name={entry.actor.displayName} color={entry.actor.avatarColor} size={28} />
          ) : null}
        </View>
      ))}

      {hasMore ? (
        <View style={styles.more}>
          <Button
            title={loadingMore ? 'Загрузка…' : 'Показать ещё'}
            variant="ghost"
            small
            loading={loadingMore}
            onPress={() => void loadMore()}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 10,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
  },
  timeline: {
    alignItems: 'center',
    width: 10,
    paddingTop: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  line: {
    width: 1,
    flex: 1,
    backgroundColor: colors.border,
    marginTop: 4,
  },
  details: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  meta: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 4,
  },
  more: {
    alignItems: 'center',
    paddingTop: 4,
  },
});
