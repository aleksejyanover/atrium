import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, RoleBadge } from '@/components/avatar';
import { Button, Empty, Field, IconButton } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { AuthGuard } from '@/components/screen';
import { orgsApi } from '@/lib/endpoints';
import { pluralizeMembers } from '@/lib/format';
import { unwrapUser } from '@/lib/socket-events';
import { colors, radius } from '@/lib/theme';
import { useAuth } from '@/state/auth';
import { useOrgs } from '@/state/orgs';
import { useSocketEvent } from '@/state/socket';
import { useToast } from '@/state/toast';

export default function OrgPickerRoute() {
  return (
    <AuthGuard>
      <OrgPickerScreen />
    </AuthGuard>
  );
}

function OrgPickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { show } = useToast();
  const { orgs, invites, loading, refresh } = useOrgs();

  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [invitesOpen, setInvitesOpen] = useState(false);

  const [orgName, setOrgName] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [creating, setCreating] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // Realtime: new invite → badge update + navigate-friendly toast.
  useSocketEvent('invite:new', (payload) => {
    void refresh();
    const name = payload.org?.name ?? 'организацию';
    show(`Приглашение в организацию «${name}»`, {
      onPress: () => router.push(`/contract/${payload.invite.id}`),
    });
  });

  const createOrg = async () => {
    const name = orgName.trim();
    if (!name) {
      Alert.alert('Создать организацию', 'Введите название');
      return;
    }
    setCreating(true);
    try {
      const res = await orgsApi.create({
        name,
        description: orgDescription.trim() || undefined,
      });
      setCreateOpen(false);
      setOrgName('');
      setOrgDescription('');
      await refresh();
      router.push(`/org/${res.org.id}`);
    } catch (e) {
      Alert.alert('Создать организацию', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setCreating(false);
    }
  };

  const confirmLogout = () => {
    Alert.alert('Выйти', 'Выйти из аккаунта?', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 14 }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>ATRIUM</Text>
          <Text style={styles.headerTitle}>Организации</Text>
        </View>
        <View style={styles.headerActions}>
          <View>
            <IconButton name="mail" onPress={() => setInvitesOpen(true)} size={18} />
            {invites.length > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {invites.length > 9 ? '9+' : invites.length}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void refresh().finally(() => setRefreshing(false));
            }}
            tintColor={colors.accent}
          />
        }>
        {orgs.length === 0 && !loading ? (
          <Empty text={'Нет организаций\nСоздайте организацию, чтобы начать'} />
        ) : null}

        {orgs.map((org) => (
          <Pressable
            key={org.id}
            onPress={() => router.push(`/org/${org.id}`)}
            style={({ pressed }) => [styles.orgCard, pressed && { opacity: 0.8 }]}>
            <View style={styles.orgRow}>
              <Avatar name={org.name} color={colors.accent} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.orgName} numberOfLines={1}>
                  {org.name}
                </Text>
                {org.description ? (
                  <Text style={styles.orgDescription} numberOfLines={1}>
                    {org.description}
                  </Text>
                ) : null}
                <Text style={styles.orgMeta}>{pluralizeMembers(org.membersCount)}</Text>
              </View>
              <RoleBadge role={org.role} />
            </View>
          </Pressable>
        ))}

        <Button
          title="Создать организацию"
          icon="plus"
          variant="ghost"
          onPress={() => setCreateOpen(true)}
          style={{ marginTop: 6 }}
        />
      </ScrollView>

      <View style={[styles.profile, { paddingBottom: insets.bottom + 12 }]}>
        <Avatar
          name={user?.displayName ?? '?'}
          color={user?.avatarColor ?? colors.accent}
          size={40}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.profileName} numberOfLines={1}>
            {user?.displayName ?? '…'}
          </Text>
          <Text style={styles.profileMeta} numberOfLines={1}>
            @{user?.username ?? '—'}
          </Text>
        </View>
        <Button title="Выйти" variant="ghost" small icon="log-out" onPress={confirmLogout} />
      </View>

      <AppModal
        visible={createOpen}
        title="Создать организацию"
        onClose={() => setCreateOpen(false)}
        footer={<Button title="Создать" onPress={() => void createOrg()} loading={creating} />}>
        <Field
          label="Название"
          value={orgName}
          onChangeText={setOrgName}
          placeholder="Название организации"
          maxLength={80}
        />
        <Field
          label="Описание (необязательно)"
          value={orgDescription}
          onChangeText={setOrgDescription}
          placeholder="О чём организация"
          maxLength={200}
          multiline
        />
      </AppModal>

      <AppModal
        visible={invitesOpen}
        title="Входящие приглашения"
        onClose={() => setInvitesOpen(false)}>
        {invites.length === 0 ? (
          <Empty text="Нет приглашений" />
        ) : (
          invites.map((item) => (
            <Pressable
              key={item.invite.id}
              style={styles.inviteRow}
              onPress={() => {
                setInvitesOpen(false);
                router.push(`/contract/${item.invite.id}`);
              }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inviteOrg} numberOfLines={1}>
                  {item.org.name}
                </Text>
                <Text style={styles.inviteMeta} numberOfLines={1}>
                  от @{unwrapUser(item.inviter)?.username ?? '—'}
                </Text>
              </View>
              <RoleBadge role={item.role} />
              <Feather name="chevron-right" size={18} color={colors.muted} />
            </Pressable>
          ))
        )}
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    color: colors.accent,
    fontSize: 11,
    letterSpacing: 3,
    fontWeight: '700',
  },
  headerTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  body: {
    padding: 18,
    paddingTop: 4,
    gap: 12,
    paddingBottom: 32,
  },
  orgCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
  },
  orgRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    marginTop: 2,
  },
  orgMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
  },
  inviteOrg: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  inviteMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.panel,
  },
  profileName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  profileMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
});
