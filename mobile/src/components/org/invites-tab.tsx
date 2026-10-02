import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, OwnerBadge, RoleBadge } from '@/components/avatar';
import { Button, Empty, Field } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { invitesApi, orgsApi, usersApi } from '@/lib/endpoints';
import { formatDate } from '@/lib/format';
import { ROLE_LABELS, canCancelInvite, canInvite, canViewOrgInvites, invitableRoles } from '@/lib/roles';
import { colors, radius } from '@/lib/theme';
import { IncomingInvite, Invite, Role, User } from '@/lib/types';
import { unwrapUser } from '@/lib/socket-events';

interface Props {
  orgId: string;
  actorRole: Role;
  meId: string;
  incoming: IncomingInvite[];
  outgoing: Invite[];
  onOpenContract(inviteId: string): void;
  onChanged(): Promise<void>;
}

export function InvitesTab({
  orgId,
  actorRole,
  meId,
  incoming,
  outgoing,
  onOpenContract,
  onChanged,
}: Props) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searchedQ, setSearchedQ] = useState<string | null>(null);
  const [selected, setSelected] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [sending, setSending] = useState(false);
  const [canceling, setCanceling] = useState<string | null>(null);

  const mayView = canViewOrgInvites(actorRole);
  const mayInvite = canInvite(actorRole);
  const roles = invitableRoles(actorRole);

  const q = query.trim();
  const searching = q.length > 0 && searchedQ !== q;
  const shownResults = q.length > 0 && searchedQ === q ? results : [];

  // debounced user search (GET /api/users/search?q=)
  useEffect(() => {
    if (q.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      usersApi
        .search(q)
        .then((res) => {
          if (!cancelled) {
            setResults(res.users.slice(0, 15));
            setSearchedQ(q);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setSearchedQ(q);
          }
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const openInvite = () => {
    setQuery('');
    setResults([]);
    setSearchedQ(null);
    setSelected(null);
    setRole(roles.length > 0 ? roles[roles.length - 1] : null);
    setInviteOpen(true);
  };

  const sendInvite = async () => {
    if (!selected || !role) return;
    setSending(true);
    try {
      await orgsApi.invite(orgId, selected.username, role);
      setInviteOpen(false);
      await onChanged();
      Alert.alert('Приглашение', `Приглашение отправлено пользователю @${selected.username}`);
    } catch (e) {
      Alert.alert('Приглашение', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSending(false);
    }
  };

  const cancelInvite = (invite: Invite) => {
    Alert.alert('Отменить приглашение', 'Приглашение будет отозвано', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отозвать',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setCanceling(invite.id);
            try {
              await invitesApi.cancel(invite.id);
              await onChanged();
            } catch (e) {
              Alert.alert('Отмена приглашения', e instanceof Error ? e.message : 'Ошибка');
            } finally {
              setCanceling(null);
            }
          })();
        },
      },
    ]);
  };

  const inviterOf = (item: IncomingInvite) => unwrapUser(item.inviter ?? item.invite?.inviter);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {mayView ? (
        <View>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Исходящие приглашения</Text>
            {mayInvite ? (
              <Pressable onPress={openInvite} hitSlop={8} style={styles.addButton}>
                <Feather name="user-plus" size={14} color={colors.accent} />
                <Text style={styles.addText}>Пригласить участника</Text>
              </Pressable>
            ) : null}
          </View>

          {outgoing.length === 0 ? (
            <Empty text="Нет исходящих приглашений" />
          ) : (
            outgoing.map((invite) => {
              const invitee = unwrapUser(invite.invitee);
              const mayCancel = canCancelInvite(
                actorRole,
                meId,
                unwrapUser(invite.inviter)?.id ?? null,
              );
              return (
                <View key={invite.id} style={styles.card}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      @{invitee?.username ?? '—'}
                    </Text>
                    <Text style={styles.cardMeta}>
                      {ROLE_LABELS[invite.role] ?? invite.role} · {formatDate(invite.createdAt)}
                    </Text>
                  </View>
                  {mayCancel ? (
                    <Button
                      title={canceling === invite.id ? '…' : 'Отменить'}
                      variant="ghost"
                      small
                      onPress={() => cancelInvite(invite)}
                    />
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      ) : null}

      <View>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Входящие приглашения</Text>
        </View>
        {incoming.length === 0 ? (
          <Empty text="Нет входящих приглашений" />
        ) : (
          incoming.map((item) => {
            const inviter = inviterOf(item);
            return (
              <Pressable
                key={item.invite.id}
                onPress={() => onOpenContract(item.invite.id)}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.75 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.org.name}
                  </Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    от @{inviter?.username ?? '—'} · {ROLE_LABELS[item.role] ?? item.role} ·{' '}
                    {formatDate(item.createdAt)}
                  </Text>
                </View>
                <RoleBadge role={item.role} />
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Pressable>
            );
          })
        )}
      </View>

      <AppModal
        visible={inviteOpen}
        title="Пригласить участника"
        onClose={() => setInviteOpen(false)}
        footer={
          <Button
            title="Пригласить"
            disabled={!selected || !role}
            loading={sending}
            onPress={() => void sendInvite()}
          />
        }>
        <Field
          label="Пользователь"
          value={query}
          onChangeText={setQuery}
          placeholder="Поиск по имени или логину"
          autoCapitalize="none"
          autoCorrect={false}
        />

        {searching ? <Text style={styles.hint}>Поиск…</Text> : null}
        {!searching && q.length > 0 && shownResults.length === 0 ? (
          <Text style={styles.hint}>Ничего не найдено</Text>
        ) : null}

        {shownResults.map((user) => {
          const active = selected?.id === user.id;
          return (
            <Pressable
              key={user.id}
              onPress={() => setSelected(user)}
              style={[styles.userRow, active && { borderColor: colors.accent }]}>
              <Avatar name={user.displayName} color={user.avatarColor} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {user.displayName}
                </Text>
                <Text style={styles.cardMeta}>@{user.username}</Text>
              </View>
              {user.isOwner ? <OwnerBadge compact /> : null}
              {active ? <Feather name="check" size={16} color={colors.accent} /> : null}
            </Pressable>
          );
        })}

        <View>
          <Text style={styles.modalLabel}>Роль</Text>
          {roles.map((r) => {
            const active = role === r;
            return (
              <Pressable
                key={r}
                onPress={() => setRole(r)}
                style={[styles.roleRow, active && { borderColor: colors.accent }]}>
                <Text style={[styles.roleRowText, active && { color: colors.accent, fontWeight: '600' }]}>
                  {ROLE_LABELS[r]}
                </Text>
                {active ? <Feather name="check" size={16} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
      </AppModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 24,
    paddingBottom: 40,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 10,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  addText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  cardMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  modalLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
  },
  roleRowText: {
    color: colors.text,
    fontSize: 14,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
  },
});
