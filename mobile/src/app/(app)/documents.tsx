import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Empty } from '@/components/controls';
import { AuthGuard, ScreenHeader } from '@/components/screen';
import { formatDate } from '@/lib/format';
import { dismissalStatusLabel, statusColor } from '@/lib/status';
import { colors, radius } from '@/lib/theme';
import { DocumentItem } from '@/lib/types';
import { useOrgs } from '@/state/orgs';

export default function DocumentsRoute() {
  return (
    <AuthGuard>
      <DocumentsScreen />
    </AuthGuard>
  );
}

function DocumentsScreen() {
  const router = useRouter();
  const { documents, refreshMine } = useOrgs();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refreshMine();
    }, [refreshMine]),
  );

  const pending = documents.filter((item) => item.document.status === 'pending');
  const history = documents.filter((item) => item.document.status !== 'pending');

  const renderRow = (item: DocumentItem, isPending: boolean) => {
    const doc = item.document;
    return (
      <Pressable
        key={doc.id}
        disabled={!isPending}
        onPress={() => router.push(`/document/${doc.id}`)}
        style={({ pressed }) => [
          styles.card,
          isPending && styles.cardPending,
          pressed && isPending && { opacity: 0.8 },
        ]}>
        <View style={styles.cardHead}>
          <View style={styles.iconBox}>
            <Feather name="file-text" size={16} color={isPending ? colors.accent : colors.muted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orgName} numberOfLines={1}>
              {item.org.name}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              Договор об увольнении · {formatDate(doc.createdAt)}
            </Text>
          </View>
          <View style={styles.statusWrap}>
            <View style={[styles.statusDot, { backgroundColor: statusColor(doc.status) }]} />
            <Text style={[styles.statusText, { color: statusColor(doc.status) }]}>
              {dismissalStatusLabel(doc.status)}
            </Text>
          </View>
        </View>

        {isPending ? (
          <View style={styles.pendingHint}>
            <Text style={styles.pendingHintText}>
              Требуется ваша подпись — подписать или оспорить
            </Text>
            <Feather name="chevron-right" size={16} color={colors.accent} />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Документы"
        subtitle={
          pending.length > 0
            ? `Ожидают подписи: ${pending.length}`
            : 'Договоры об увольнении'
        }
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            onRefresh={() => {
              setRefreshing(true);
              void refreshMine().finally(() => setRefreshing(false));
            }}
          />
        }>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ожидают подписи · {pending.length}</Text>
          {pending.length === 0 ? (
            <Empty text="Нет договоров, требующих подписи" />
          ) : (
            pending.map((item) => renderRow(item, true))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>История · {history.length}</Text>
          {history.length === 0 ? (
            <Empty text="История документов пока пуста" />
          ) : (
            history.map((item) => renderRow(item, false))
          )}
        </View>

        <Button
          title="Каталог организаций"
          variant="ghost"
          icon="globe"
          onPress={() => router.push('/catalog')}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    padding: 16,
    gap: 22,
    paddingBottom: 40,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
    gap: 10,
    marginBottom: 4,
  },
  cardPending: {
    borderColor: 'rgba(124,108,246,0.5)',
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  cardMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  statusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pendingHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pendingHintText: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
  },
});
