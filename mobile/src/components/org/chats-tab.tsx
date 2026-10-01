import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, Empty, Field } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { orgsApi } from '@/lib/endpoints';
import { colors, radius } from '@/lib/theme';
import { Channel, DMItem } from '@/lib/types';
import { useSocket } from '@/state/socket';

interface Props {
  orgId: string;
  channels: Channel[];
  dms: DMItem[];
  canCreate: boolean;
  onOpen(channelId: string): void;
  onRefresh(): Promise<void>;
  onChannelCreated(channel: Channel): void;
}

export function ChatsTab({
  orgId,
  channels,
  dms,
  canCreate,
  onOpen,
  onRefresh,
  onChannelCreated,
}: Props) {
  const { isOnline } = useSocket();
  const [createOpen, setCreateOpen] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
          channels.map((channel) => (
            <Pressable
              key={channel.id}
              onPress={() => onOpen(channel.id)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}>
              <View style={styles.hashBox}>
                <Feather name="hash" size={16} color={colors.muted} />
              </View>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {channel.name}
              </Text>
              <Feather name="chevron-right" size={18} color={colors.muted} />
            </Pressable>
          ))
        )}
      </View>

      <View>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Прямые сообщения</Text>
        </View>
        {dms.length === 0 ? (
          <Empty text={'Нет личных сообщений\nНапишите участнику из вкладки «Участники»'} />
        ) : (
          dms.map((dm) => (
            <Pressable
              key={dm.channel.id}
              onPress={() => onOpen(dm.channel.id)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}>
              <Avatar
                name={dm.peer.displayName}
                color={dm.peer.avatarColor}
                size={36}
                online={isOnline(dm.peer.id)}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {dm.peer.displayName}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  @{dm.peer.username} · {isOnline(dm.peer.id) ? 'в сети' : 'не в сети'}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.muted} />
            </Pressable>
          ))
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
  rowMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
  },
});
