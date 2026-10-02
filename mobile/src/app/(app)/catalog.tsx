import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, Empty } from '@/components/controls';
import { AuthGuard, ScreenHeader } from '@/components/screen';
import { applicationsApi, discoverApi } from '@/lib/endpoints';
import { formatDate, pluralizeMembers } from '@/lib/format';
import { applicationStatusLabel, statusColor } from '@/lib/status';
import { colors, radius } from '@/lib/theme';
import { DiscoverOrg } from '@/lib/types';
import { useOrgs } from '@/state/orgs';
import { useToast } from '@/state/toast';

const SEARCH_DEBOUNCE_MS = 300;

export default function CatalogRoute() {
  return (
    <AuthGuard>
      <CatalogScreen />
    </AuthGuard>
  );
}

function CatalogScreen() {
  const router = useRouter();
  const { show } = useToast();
  const { applications, orgs, refreshMine } = useOrgs();

  const [query, setQuery] = useState('');
  const [orgList, setOrgList] = useState<DiscoverOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string, signal?: { cancelled: boolean }) => {
    setLoading(true);
    try {
      const res = await discoverApi.search(q);
      if (signal?.cancelled) return;
      setOrgList(res.orgs);
      setError(null);
    } catch (e) {
      if (signal?.cancelled) return;
      setError(e instanceof Error ? e.message : 'Не удалось загрузить каталог');
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const signal = { cancelled: false };
      void load('', signal);
      void refreshMine();
      return () => {
        signal.cancelled = true;
      };
    }, [load, refreshMine]),
  );

  // Debounced search (SPEC v2 §14.1/§15.1 — 300ms).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const signal = { cancelled: false };
    debounceRef.current = setTimeout(() => {
      void load(query, signal);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      signal.cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, load]);

  const cancelApplication = (applicationId: string, orgName: string) => {
    Alert.alert('Отозвать заявление?', `Организация «${orgName}»`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отозвать',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusyId(applicationId);
            try {
              await applicationsApi.cancel(applicationId);
              await refreshMine();
              show('Заявление отозвано');
            } catch (e) {
              Alert.alert('Заявления', e instanceof Error ? e.message : 'Ошибка');
            } finally {
              setBusyId(null);
            }
          })();
        },
      },
    ]);
  };

  const memberOrgIds = new Set(orgs.map((org) => org.id));
  const myOrgIds = new Set(applications.map((item) => item.org.id));

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Каталог организаций" onBack={() => router.back()} />

      <View style={styles.searchWrap}>
        <Feather name="search" size={16} color={colors.muted} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Найти организацию"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          maxLength={80}
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Feather name="x" size={16} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            onRefresh={() => {
              setRefreshing(true);
              void load(query).finally(() => setRefreshing(false));
            }}
          />
        }>
        {/* ---- Мои заявления ---- */}
        {applications.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Мои заявления · {applications.length}</Text>
            {applications.map(({ application, org }) => (
              <View key={application.id} style={styles.applicationCard}>
                <Avatar name={org.name} color={colors.accent} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.orgName} numberOfLines={1}>
                    {org.name}
                  </Text>
                  <Text style={styles.applicationMeta} numberOfLines={1}>
                    {formatDate(application.createdAt)} ·{' '}
                    <Text style={{ color: statusColor(application.status) }}>
                      {applicationStatusLabel(application.status)}
                    </Text>
                  </Text>
                </View>
                {application.status === 'pending' ? (
                  <Button
                    title="Отозвать"
                    variant="ghost"
                    small
                    loading={busyId === application.id}
                    onPress={() => cancelApplication(application.id, org.name)}
                  />
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {/* ---- Каталог ---- */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {query.trim() ? 'Результаты поиска' : 'Публичные организации'}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {loading && orgList.length === 0 && !error ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : null}

          {!loading && !error && orgList.length === 0 ? (
            <Empty
              text={
                query.trim()
                  ? 'Ничего не найдено\nПопробуйте другой запрос'
                  : 'Нет публичных организаций'
              }
            />
          ) : null}

          {orgList.map((org) => {
            const isMember = org.isMember || memberOrgIds.has(org.id);
            const applied = myOrgIds.has(org.id);
            return (
              <View key={org.id} style={styles.card}>
                <View style={styles.cardRow}>
                  <Avatar name={org.name} color={colors.accent} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.orgName} numberOfLines={1}>
                      {org.name}
                    </Text>
                    {org.description ? (
                      <Text style={styles.orgDescription} numberOfLines={2}>
                        {org.description}
                      </Text>
                    ) : null}
                    <Text style={styles.orgMeta}>{pluralizeMembers(org.membersCount)}</Text>
                  </View>
                </View>

                {isMember ? (
                  <View style={styles.memberChip}>
                    <Feather name="check-circle" size={13} color={colors.ok} />
                    <Text style={styles.memberChipText}>Ваша организация</Text>
                  </View>
                ) : applied ? (
                  <View style={styles.pendingChip}>
                    <Feather name="clock" size={13} color={colors.accent} />
                    <Text style={styles.pendingChipText}>Заявление на рассмотрении</Text>
                  </View>
                ) : (
                  <Button
                    title="Подать заявление"
                    icon="edit-3"
                    small
                    onPress={() =>
                      router.push({ pathname: '/apply/[orgId]', params: { orgId: org.id, name: org.name } })
                    }
                  />
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    paddingHorizontal: 12,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: 42,
  },
  search: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 10,
  },
  body: {
    padding: 16,
    gap: 20,
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
  center: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
    gap: 12,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  orgName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  orgDescription: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 19,
    marginTop: 3,
  },
  orgMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(62,207,142,0.12)',
    borderColor: 'rgba(62,207,142,0.45)',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  memberChipText: {
    color: colors.ok,
    fontSize: 12,
    fontWeight: '600',
  },
  pendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(124,108,246,0.12)',
    borderColor: 'rgba(124,108,246,0.45)',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pendingChipText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  applicationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
  },
  applicationMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
});
