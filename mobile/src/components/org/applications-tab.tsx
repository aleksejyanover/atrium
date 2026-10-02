import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, Empty } from '@/components/controls';
import { ContractText } from '@/components/contract-text';
import { applicationsApi } from '@/lib/endpoints';
import { formatDate } from '@/lib/format';
import { applicationStatusLabel } from '@/lib/status';
import { colors, radius } from '@/lib/theme';
import { OrgApplicationItem } from '@/lib/types';

interface Props {
  items: OrgApplicationItem[];
  onChanged(): Promise<void>;
}

/**
 * «Входящие заявки» (SPEC v2 §15.3): аватар + пользователь, сообщение,
 * договор по раскрытию, кнопки «Принять» / «Отклонить» (rank ≥ 40).
 */
export function ApplicationsTab({ items, onChanged }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = async (
    application: OrgApplicationItem['application'],
    action: 'accept' | 'reject',
  ) => {
    const title = action === 'accept' ? 'Принять заявление?' : 'Отклонить заявление?';
    const name = application.message?.trim();
    Alert.alert(title, name ? `«${name.slice(0, 120)}»` : 'Без сообщения', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: action === 'accept' ? 'Принять' : 'Отклонить',
        style: action === 'accept' ? 'default' : 'destructive',
        onPress: () => {
          void (async () => {
            setBusyId(application.id);
            try {
              if (action === 'accept') await applicationsApi.accept(application.id);
              else await applicationsApi.reject(application.id);
              setExpandedId((prev) => (prev === application.id ? null : prev));
              await onChanged();
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

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Входящие заявки · {items.length}</Text>
      </View>

      {items.length === 0 ? (
        <Empty text={'Нет заявок\nКак только кто-то подаст заявление, оно появится здесь'} />
      ) : (
        items.map(({ application, user }) => {
          const expanded = expandedId === application.id;
          const pending = application.status === 'pending';
          return (
            <View key={application.id} style={styles.card}>
              <Pressable
                onPress={() => setExpandedId(expanded ? null : application.id)}
                style={({ pressed }) => [styles.cardHead, pressed && { opacity: 0.75 }]}>
                <Avatar name={user.displayName} color={user.avatarColor} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {user.displayName}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    @{user.username} · {formatDate(application.createdAt)}
                  </Text>
                </View>
                <Feather
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.muted}
                />
              </Pressable>

              {application.message ? (
                <Text style={styles.message} numberOfLines={expanded ? undefined : 2}>
                  {application.message}
                </Text>
              ) : null}

              {expanded ? (
                <ContractText
                  text={application.contractText}
                  title="Договор о присоединении"
                  height={240}
                />
              ) : null}

              {pending ? (
                <View style={styles.actions}>
                  <Button
                    title="Принять"
                    small
                    loading={busyId === application.id}
                    onPress={() => void decide(application, 'accept')}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Отклонить"
                    variant="danger"
                    small
                    disabled={busyId === application.id}
                    onPress={() => void decide(application, 'reject')}
                    style={{ flex: 1 }}
                  />
                </View>
              ) : (
                <Text style={styles.resolved}>
                  {applicationStatusLabel(application.status)} ·{' '}
                  {formatDate(application.resolvedAt ?? application.createdAt)}
                </Text>
              )}
            </View>
          );
        })
      )}
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
    marginBottom: 4,
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
    borderRadius: radius.md,
    padding: 12,
    gap: 10,
    marginBottom: 4,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  message: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  resolved: {
    color: colors.muted,
    fontSize: 12,
  },
});
