import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, RoleBadge } from '@/components/avatar';
import { Button, Empty } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { RolesMatrix } from '@/components/roles-matrix';
import { chatApi, dismissalsApi, orgsApi } from '@/lib/endpoints';
import {
  ROLE_LABELS,
  assignableRoles,
  canChangeRole,
  canCreateChannel,
  canDismiss,
  canLeaveOrg,
  canReviewDismissals,
  canTerminate,
} from '@/lib/roles';
import { colors, radius } from '@/lib/theme';
import { Member, OrgDismissalItem, Role } from '@/lib/types';

interface Props {
  orgId: string;
  members: Member[];
  actorRole: Role;
  meId: string;
  /** Договоры об увольнении организации (rank ≥ 40). */
  dismissals: OrgDismissalItem[];
  onOpenDm(channelId: string): void;
  onMembersChanged(): Promise<void>;
  onLeave(): void;
}

export function MembersTab({
  orgId,
  members,
  actorRole,
  meId,
  dismissals,
  onOpenDm,
  onMembersChanged,
  onLeave,
}: Props) {
  const [selected, setSelected] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [matrixOpen, setMatrixOpen] = useState(false);

  const close = () => setSelected(null);

  const pendingDismissalFor = (userId: string): OrgDismissalItem | null =>
    dismissals.find(
      (item) => item.document.targetUserId === userId && item.document.status === 'pending',
    ) ?? null;

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

  /** Увольнение через dismissal-документ (SPEC v2 §12 — вместо удаления). */
  const dismissMember = (target: Member) => {
    Alert.alert(
      'Уволить сотрудника?',
      'Сотруднику будет отправлен договор об увольнении, который он должен подписать от руки',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Отправить договор',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await dismissalsApi.create(orgId, { userId: target.user.id });
                await onMembersChanged();
                close();
              } catch (e) {
                Alert.alert('Увольнение', e instanceof Error ? e.message : 'Ошибка');
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  const cancelDismissal = (target: Member) => {
    const pending = pendingDismissalFor(target.user.id);
    if (!pending) return;
    Alert.alert('Отменить увольнение?', `Сотрудник ${target.user.displayName} останется`, [
      { text: 'Назад', style: 'cancel' },
      {
        text: 'Отменить увольнение',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await dismissalsApi.cancel(pending.document.id);
              await onMembersChanged();
              close();
            } catch (e) {
              Alert.alert('Отмена увольнения', e instanceof Error ? e.message : 'Ошибка');
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  const terminateMember = (target: Member) => {
    const pending = pendingDismissalFor(target.user.id);
    if (!pending) return;
    Alert.alert(
      'Расторгнуть в одностороннем порядке?',
      'Членство будет прекращено немедленно, без подписи сотрудника',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Расторгнуть',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await dismissalsApi.terminate(pending.document.id);
                await onMembersChanged();
                close();
              } catch (e) {
                Alert.alert('Расторжение', e instanceof Error ? e.message : 'Ошибка');
              } finally {
                setBusy(false);
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
  const selectedPending = selected ? pendingDismissalFor(selected.user.id) : null;
  const selectedDismissable =
    selected && !selectedPending && canDismiss(actorRole, selected.role);
  const canTerminateSelected =
    selectedPending !== null && selected && canTerminate(actorRole, selected.role);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Участники · {members.length}</Text>
        <View style={styles.headerChips}>
          <Pressable onPress={() => setMatrixOpen(true)} style={styles.hintChip}>
            <Feather name="shield" size={12} color={colors.muted} />
            <Text style={styles.hintText}>Роли и права</Text>
          </Pressable>
          {canCreateChannel(actorRole) ? (
            <View style={styles.hintChip}>
              <Feather name="award" size={12} color={colors.muted} />
              <Text style={styles.hintText}>{ROLE_LABELS[actorRole]}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {members.length === 0 ? (
        <Empty text="Нет участников" />
      ) : (
        members.map((member) => {
          const pending =
            canReviewDismissals(actorRole) && pendingDismissalFor(member.user.id) !== null;
          return (
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
              {pending ? (
                <View style={styles.pendingChip}>
                  <Text style={styles.pendingChipText}>Ожидает подписи</Text>
                </View>
              ) : null}
              <RoleBadge role={member.role} />
              {member.user.id !== meId ? (
                <Feather name="chevron-right" size={18} color={colors.muted} />
              ) : null}
            </Pressable>
          );
        })
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
        visible={matrixOpen}
        title="Роли и права"
        onClose={() => setMatrixOpen(false)}>
        <RolesMatrix currentRole={actorRole} />
      </AppModal>

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

            {selectedPending ? (
              <View style={styles.pendingCard}>
                <View style={styles.pendingCardHead}>
                  <Feather name="clock" size={15} color={colors.accent} />
                  <Text style={styles.pendingCardTitle}>Ожидает подписи</Text>
                </View>
                <Text style={styles.pendingCardText}>
                  Сотруднику отправлен договор об увольнении от{' '}
                  {new Date(selectedPending.document.createdAt).toLocaleDateString('ru-RU')}
                </Text>
              </View>
            ) : null}

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
              {selectedDismissable ? (
                <Button
                  title="Уволить"
                  variant="danger"
                  icon="user-x"
                  disabled={busy}
                  onPress={() => dismissMember(selected)}
                />
              ) : null}
              {selectedPending ? (
                <Button
                  title="Отменить увольнение"
                  variant="ghost"
                  icon="rotate-ccw"
                  disabled={busy}
                  onPress={() => cancelDismissal(selected)}
                />
              ) : null}
              {canTerminateSelected ? (
                <Button
                  title="Расторгнуть в одностороннем порядке"
                  variant="danger"
                  icon="slash"
                  disabled={busy}
                  onPress={() => terminateMember(selected)}
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
    gap: 8,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  headerChips: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
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
    gap: 10,
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
  pendingChip: {
    backgroundColor: 'rgba(124,108,246,0.14)',
    borderColor: 'rgba(124,108,246,0.5)',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  pendingChipText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '600',
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
  pendingCard: {
    backgroundColor: 'rgba(124,108,246,0.08)',
    borderColor: 'rgba(124,108,246,0.4)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    gap: 6,
  },
  pendingCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pendingCardTitle: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  pendingCardText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
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
