import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, RoleBadge } from '@/components/avatar';
import { Button, Empty } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { chatApi, orgsApi } from '@/lib/endpoints';
import {
  ROLE_LABELS,
  assignableRoles,
  canChangeRole,
  canCreateChannel,
  canLeaveOrg,
  canRemoveMember,
} from '@/lib/roles';
import { colors, radius } from '@/lib/theme';
import { Member, Role } from '@/lib/types';

interface Props {
  orgId: string;
  members: Member[];
  actorRole: Role;
  meId: string;
  onOpenDm(channelId: string): void;
  onMembersChanged(): Promise<void>;
  onLeave(): void;
}

export function MembersTab({
  orgId,
  members,
  actorRole,
  meId,
  onOpenDm,
  onMembersChanged,
  onLeave,
}: Props) {
  const [selected, setSelected] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => setSelected(null);

  const changeRole = async (target: Member, role: Role) => {
    if (!canChangeRole(actorRole, target.role, role) || role === target.role) return;
    setBusy(true);
    try {
      await orgsApi.setMemberRole(orgId, target.user.id, role);
      await onMembersChanged();
      close();
    } catch (e) {
      Alert.alert('Изменить роль', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = (target: Member) => {
    Alert.alert(
      'Удалить из организации',
      `Удалить ${target.user.displayName} из организации?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await orgsApi.removeMember(orgId, target.user.id);
                await onMembersChanged();
                close();
              } catch (e) {
                Alert.alert('Удаление', e instanceof Error ? e.message : 'Ошибка');
              }
            })();
          },
        },
      ],
    );
  };

  const openDm = async (target: Member) => {
    setBusy(true);
    try {
      const res = await chatApi.createDm(orgId, target.user.id);
      close();
      onOpenDm(res.channel.id);
    } catch (e) {
      Alert.alert('Сообщение', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const confirmLeave = () => {
    Alert.alert('Покинуть организацию', 'Вы уверены, что хотите выйти?', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Выйти',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await orgsApi.leave(orgId);
              onLeave();
            } catch (e) {
              Alert.alert('Выход', e instanceof Error ? e.message : 'Ошибка');
            }
          })();
        },
      },
    ]);
  };

  const options = selected ? assignableRoles(actorRole, selected.role) : [];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Участники · {members.length}</Text>
        {canCreateChannel(actorRole) ? (
          <View style={styles.hintChip}>
            <Feather name="shield" size={12} color={colors.muted} />
            <Text style={styles.hintText}>{ROLE_LABELS[actorRole]}</Text>
          </View>
        ) : null}
      </View>

      {members.length === 0 ? (
        <Empty text="Нет участников" />
      ) : (
        members.map((member) => (
          <Pressable
            key={member.user.id}
            disabled={member.user.id === meId}
            onPress={() => setSelected(member)}
            style={({ pressed }) => [
              styles.row,
              member.user.id === meId && { borderColor: 'rgba(124,108,246,0.4)' },
              pressed && { opacity: 0.75 },
            ]}>
            <Avatar name={member.user.displayName} color={member.user.avatarColor} size={38} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {member.user.displayName}
                {member.user.id === meId ? (
                  <Text style={styles.you}> · вы</Text>
                ) : null}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                @{member.user.username}
              </Text>
            </View>
            <RoleBadge role={member.role} />
            {member.user.id !== meId ? (
              <Feather name="chevron-right" size={18} color={colors.muted} />
            ) : null}
          </Pressable>
        ))
      )}

      {canLeaveOrg(actorRole) ? (
        <Button
          title="Покинуть организацию"
          variant="ghost"
          icon="log-out"
          style={{ marginTop: 18, borderColor: 'rgba(240,80,110,0.5)' }}
          onPress={confirmLeave}
        />
      ) : null}

      <AppModal
        visible={selected !== null}
        title={selected ? selected.user.displayName : ''}
        onClose={close}>
        {selected ? (
          <View style={{ gap: 16 }}>
            <View style={styles.profileRow}>
              <Avatar
                name={selected.user.displayName}
                color={selected.user.avatarColor}
                size={48}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{selected.user.displayName}</Text>
                <Text style={styles.rowMeta}>@{selected.user.username}</Text>
              </View>
              <RoleBadge role={selected.role} />
            </View>

            <View>
              <Text style={styles.modalLabel}>Изменить роль</Text>
              {options.length === 0 ? (
                <Text style={styles.rowMeta}>Нет доступных ролей для назначения</Text>
              ) : (
                options.map((role) => {
                  const current = role === selected.role;
                  return (
                    <Pressable
                      key={role}
                      disabled={busy || current}
                      onPress={() => void changeRole(selected, role)}
                      style={({ pressed }) => [
                        styles.roleRow,
                        current && { borderColor: colors.accent },
                        pressed && { opacity: 0.75 },
                      ]}>
                      <Text
                        style={[styles.roleRowText, current && { color: colors.accent, fontWeight: '600' }]}>
                        {ROLE_LABELS[role]}
                      </Text>
                      {current ? <Feather name="check" size={16} color={colors.accent} /> : null}
                    </Pressable>
                  );
                })
              )}
            </View>

            <View style={{ gap: 10 }}>
              <Button
                title="Написать сообщение"
                variant="ghost"
                icon="message-circle"
                loading={busy}
                onPress={() => void openDm(selected)}
              />
              {canRemoveMember(actorRole, selected.role) ? (
                <Button
                  title="Удалить из организации"
                  variant="ghost"
                  icon="user-x"
                  onPress={() => removeMember(selected)}
                  style={{ borderColor: 'rgba(240,80,110,0.5)' }}
                />
              ) : null}
            </View>
          </View>
        ) : null}
      </AppModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  hintChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  hintText: {
    color: colors.muted,
    fontSize: 11,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  you: {
    color: colors.muted,
    fontWeight: '400',
  },
  rowMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
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
});
