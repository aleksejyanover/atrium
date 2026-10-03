import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, Empty, Field } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { moderationApi, orgsApi } from '@/lib/endpoints';
import { getOpenChannelId, subscribeReadState } from '@/lib/read-state';
import { colors, radius } from '@/lib/theme';
import { Channel, DMItem } from '@/lib/types';
import { useSocket, useSocketEvent } from '@/state/socket';
import { useToast } from '@/state/toast';

interface Props {
  orgId: string;
  channels: Channel[];
  dms: DMItem[];
  canCreate: boolean;
  /** Управлять ботом-модератором — rank ≥ 60 (SPEC v9 §37). */
  canManageBot: boolean;
  onOpen(channelId: string): void;
  onRefresh(): Promise<void>;
  onChannelCreated(channel: Channel): void;
}

/** Окно, в течение которого закрытый чат остаётся «прочитанным» локально. */
const LOCAL_READ_GRACE_MS = 6000;

/**
 * Непрочитанные с учётом локального прочтения (SPEC v3 §18):
 * открытый канал — 0 сразу; только что закрытый — 0 до прихода свежих
 * счётчиков с сервера; входящие пока закрыт — локальный счётчик.
 */
function useUnreadCounts() {
  const [openId, setOpenId] = useState<string | null>(getOpenChannelId());
  const readAtRef = useRef<Record<string, number>>({});
  const bumpRef = useRef<Record<string, number>>({});
  const [, setTick] = useState(0);

  useEffect(() => subscribeReadState(() => setOpenId(getOpenChannelId())), []);

  // смена открытого канала: предыдущий считается прочитанным
  const prevOpenRef = useRef<string | null>(openId);
  useEffect(() => {
    const prev = prevOpenRef.current;
    if (prev && prev !== openId) {
      readAtRef.current[prev] = Date.now();
      bumpRef.current[prev] = 0;
    }
    if (openId) bumpRef.current[openId] = 0;
    prevOpenRef.current = openId;
  }, [openId]);

  // входящие в закрытые каналы — локальный прирост без ожидания сервера
  useSocketEvent('message:new', (payload) => {
    const channelId = payload.message.channelId;
    if (channelId === getOpenChannelId()) return;
    bumpRef.current[channelId] = (bumpRef.current[channelId] ?? 0) + 1;
    setTick((t) => t + 1);
  });

  const unreadOf = (channelId: string, serverUnread: number | undefined): number => {
    if (openId === channelId) return 0;
    const bump = bumpRef.current[channelId] ?? 0;
    if (bump > 0) return bump;
    const readAt = readAtRef.current[channelId];
    if (readAt && Date.now() - readAt < LOCAL_READ_GRACE_MS) return 0;
    return serverUnread ?? 0;
  };

  return unreadOf;
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export function ChatsTab({
  orgId,
  channels,
  dms,
  canCreate,
  canManageBot,
  onOpen,
  onRefresh,
  onChannelCreated,
}: Props) {
  const { isOnline } = useSocket();
  const { show } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [creating, setCreating] = useState(false);
  const [botBusy, setBotBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const unreadOf = useUnreadCounts();

  const createChannel = async () => {
    const name = channelName.trim();
    if (!name) {
      Alert.alert('Создать канал', 'Введите название канала');
      return;
    }
    setCreating(true);
    try {
      const res = await orgsApi.createChannel(orgId, name);
      setCreateOpen(false);
      setChannelName('');
      onChannelCreated(res.channel);
    } catch (e) {
      Alert.alert('Создать канал', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setCreating(false);
    }
  };

  /* ---- SPEC v9 §37: бот-модератор ---- */

  const runBotAction = async (
    channel: Channel,
    action: 'add' | 'remove' | 'rate',
  ): Promise<void> => {
    if (botBusy) return;
    setBotBusy(true);
    try {
      if (action === 'add') {
        await moderationApi.addBot(orgId, channel.id);
        show(`Бот-модератор добавлен в #${channel.name}`);
      } else if (action === 'remove') {
        await moderationApi.removeBot(orgId, channel.id);
        show(`Бот-модератор убран из #${channel.name}`);
      } else {
        await moderationApi.requestRating(orgId, channel.id);
        show('Бот опубликовал оценку переписки в канале');
      }
      await onRefresh();
    } catch (e) {
      Alert.alert('Бот-модератор', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBotBusy(false);
    }
  };

  const botAction = (channel: Channel) => {
    const inChannel = channel.botInChannel === true;
    Alert.alert(
      `Бот-модератор · #${channel.name}`,
      inChannel
        ? 'Бот следит за перепиской и удаляет нецензурные сообщения'
        : 'Бот не добавлен в этот канал',
      [
        { text: 'Отмена', style: 'cancel' },
        inChannel
          ? {
              text: 'Убрать бота',
              style: 'destructive',
              onPress: () => void runBotAction(channel, 'remove'),
            }
          : {
              text: 'Добавить бота',
              onPress: () => void runBotAction(channel, 'add'),
            },
        ...(inChannel
          ? [{ text: 'Оценить переписку', onPress: () => void runBotAction(channel, 'rate') }]
          : []),
      ],
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.accent}
          onRefresh={() => {
            setRefreshing(true);
            void onRefresh().finally(() => setRefreshing(false));
          }}
        />
      }>
      <View>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Каналы</Text>
          {canCreate ? (
            <Pressable onPress={() => setCreateOpen(true)} hitSlop={8} style={styles.addButton}>
              <Feather name="plus" size={14} color={colors.accent} />
              <Text style={styles.addText}>Создать канал</Text>
            </Pressable>
          ) : null}
        </View>

        {channels.length === 0 ? (
          <Empty text="Нет каналов" />
        ) : (
          channels.map((channel) => {
            const unread = unreadOf(channel.id, channel.unread);
            return (
              <Pressable
                key={channel.id}
                onPress={() => onOpen(channel.id)}
                style={({ pressed }) => [
                  styles.row,
                  unread > 0 && styles.rowUnread,
                  pressed && { opacity: 0.75 },
                ]}>
                <View style={styles.hashBox}>
                  <Feather
                    name="hash"
                    size={16}
                    color={unread > 0 ? colors.accent : colors.muted}
                  />
                </View>
                <Text
                  style={[styles.rowTitle, unread > 0 && styles.rowTitleUnread]}
                  numberOfLines={1}>
                  {channel.name}
                </Text>
                <UnreadBadge count={unread} />
                {canManageBot ? (
                  <Pressable
                    onPress={() => botAction(channel)}
                    hitSlop={8}
                    disabled={botBusy}
                    style={[styles.botChip, channel.botInChannel === true && styles.botChipOn]}>
                    <Feather
                      name="cpu"
                      size={12}
                      color={channel.botInChannel === true ? colors.accent : colors.muted}
                    />
                  </Pressable>
                ) : null}
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Pressable>
            );
          })
        )}
      </View>

      <View>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Прямые сообщения</Text>
        </View>
        {dms.length === 0 ? (
          <Empty text={'Нет личных сообщений\nНапишите участнику из вкладки «Участники»'} />
        ) : (
          dms.map((dm) => {
            const unread = unreadOf(dm.channel.id, dm.unread);
            return (
              <Pressable
                key={dm.channel.id}
                onPress={() => onOpen(dm.channel.id)}
                style={({ pressed }) => [
                  styles.row,
                  unread > 0 && styles.rowUnread,
                  pressed && { opacity: 0.75 },
                ]}>
                <Avatar
                  name={dm.peer.displayName}
                  color={dm.peer.avatarColor}
                  size={36}
                  online={isOnline(dm.peer.id)}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.rowTitle, unread > 0 && styles.rowTitleUnread]}
                    numberOfLines={1}>
                    {dm.peer.displayName}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    @{dm.peer.username} · {isOnline(dm.peer.id) ? 'в сети' : 'не в сети'}
                  </Text>
                </View>
                <UnreadBadge count={unread} />
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Pressable>
            );
          })
        )}
      </View>

      <AppModal
        visible={createOpen}
        title="Создать канал"
        onClose={() => setCreateOpen(false)}
        footer={<Button title="Создать" onPress={() => void createChannel()} loading={creating} />}>
        <Field
          label="Название"
          value={channelName}
          onChangeText={(v) => setChannelName(v.replace(/\s/g, '').toLowerCase())}
          placeholder="general"
          autoCapitalize="none"
          maxLength={40}
        />
        <Text style={styles.hint}>Буквы, цифры и дефисы, до 40 символов</Text>
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
    gap: 4,
  },
  addText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
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
    paddingVertical: 11,
    marginBottom: 8,
  },
  rowUnread: {
    borderColor: 'rgba(124,108,246,0.45)',
  },
  hashBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  rowTitleUnread: {
    fontWeight: '700',
    color: colors.text,
  },
  rowMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  botChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botChipOn: {
    borderColor: 'rgba(124,108,246,0.6)',
    backgroundColor: 'rgba(124,108,246,0.12)',
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
  },
});
