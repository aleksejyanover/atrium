import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/controls';
import { AuthGuard, ScreenHeader } from '@/components/screen';
import { chatApi, orgsApi } from '@/lib/endpoints';
import { formatDaySeparator, formatTime } from '@/lib/format';
import { canDeleteMessage } from '@/lib/roles';
import { colors, radius } from '@/lib/theme';
import { Message, Role, User } from '@/lib/types';
import { useAuth } from '@/state/auth';
import { useCall } from '@/state/call';
import { useSocket, useSocketEvent } from '@/state/socket';

type RenderItem =
  | { kind: 'date'; key: string; ts: number }
  | { kind: 'message'; key: string; message: Message; showAuthor: boolean };

const MAX_TEXT = 4000;

export default function ChatRoute() {
  return (
    <AuthGuard>
      <ChatScreen />
    </AuthGuard>
  );
}

function ChatScreen() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { socket, isOnline } = useSocket();
  const { startCall } = useCall();

  const [title, setTitle] = useState('Чат');
  const [subtitle, setSubtitle] = useState<string | undefined>();
  const [channelType, setChannelType] = useState<'channel' | 'dm'>('channel');
  const [peer, setPeer] = useState<User | null>(null);
  const [actorRole, setActorRole] = useState<Role | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const lastTypingEmit = useRef(0);
  const listRef = useRef<FlatList<RenderItem>>(null);

  // ---- initial load -----------------------------------------------------
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    (async () => {
      try {
        const [info, page] = await Promise.all([
          chatApi.channel(channelId),
          chatApi.messages(channelId),
        ]);
        if (cancelled) return;
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setChannelType(info.channel.type);
        if (info.channel.type === 'dm' && info.peer) {
          setTitle(info.peer.displayName);
          setPeer(info.peer);
          setSubtitle(`@${info.peer.username}`);
        } else {
          setTitle(info.channel.name ? `# ${info.channel.name}` : 'Чат');
          setSubtitle(info.org?.name);
        }
        // Role (for delete permissions) is not part of GET /api/channels/:id.
        if (info.org?.id) {
          try {
            const detail = await orgsApi.get(info.org.id);
            if (!cancelled) setActorRole(detail.role);
          } catch {
            // permission-sensitive actions stay hidden if the role is unknown
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Не удалось открыть чат');
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const loadOlder = useCallback(async () => {
    if (!channelId || loadingOlder || messages.length === 0 || !hasMore) return;
    setLoadingOlder(true);
    try {
      const page = await chatApi.messages(channelId, messages[0].id);
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const older = page.messages.filter((m) => !known.has(m.id));
        return [...older, ...prev];
      });
      setHasMore(page.hasMore);
    } catch {
      // keep current page on error
    } finally {
      setLoadingOlder(false);
    }
  }, [channelId, hasMore, loadingOlder, messages]);

  // ---- realtime ----------------------------------------------------------
  useSocketEvent('message:new', (payload) => {
    const message = payload.message;
    if (!channelId || message.channelId !== channelId) return;
    const tempId = (message as Message & { tempId?: string }).tempId;
    setMessages((prev) => {
      const base = tempId ? prev.filter((m) => m.id !== tempId) : prev;
      return base.some((m) => m.id === message.id) ? base : [...base, message];
    });
    setTypingNames((prev) => prev.filter((n) => n !== message.sender.displayName));
  });

  useSocketEvent('typing', (payload) => {
    if (!channelId || payload.channelId !== channelId) return;
    if (payload.user?.id === user?.id) return;
    const name = payload.user?.displayName ?? 'Кто-то';
    if (payload.typing) {
      setTypingNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
    } else {
      setTypingNames((prev) => prev.filter((n) => n !== name));
    }
  });

  // auto-clear stale typing labels
  useEffect(() => {
    if (typingNames.length === 0) return;
    const id = setTimeout(() => setTypingNames([]), 4000);
    return () => clearTimeout(id);
  }, [typingNames]);

  // scroll to bottom whenever a message arrives
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToEnd({ animated: messages.length > 1 });
      } catch {
        // list may not be laid out yet
      }
    }, 60);
    return () => clearTimeout(t);
  }, [messages.length]);

  const send = useCallback(() => {
    if (!channelId || !socket) return;
    const value = text.trim();
    if (!value || value.length > MAX_TEXT) return;
    setText('');
    lastTypingEmit.current = 0;
    socket.emit('typing', { channelId, typing: false });

    const tempId = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const temp: Message = {
      id: tempId,
      channelId,
      sender: {
        id: user?.id ?? 'me',
        username: user?.username ?? '',
        displayName: user?.displayName ?? '',
        avatarColor: user?.avatarColor ?? colors.accent,
      },
      text: value,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, temp]);
    socket.emit('message:send', { channelId, text: value, tempId }, (res) => {
      if (res?.error) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setText((current) => current || value);
        return;
      }
      const real = res?.message;
      if (real) {
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          if (withoutTemp.some((m) => m.id === real.id)) return withoutTemp;
          return [...withoutTemp, real];
        });
      }
    });
  }, [channelId, socket, text, user]);

  const onInputChange = (value: string) => {
    setText(value);
    if (!channelId || !socket) return;
    const now = Date.now();
    if (now - lastTypingEmit.current > 2000 && value.trim()) {
      lastTypingEmit.current = now;
      socket.emit('typing', { channelId, typing: true });
    }
  };

  const tryDelete = useCallback(
    (message: Message) => {
      if (!user) return;
      if (!canDeleteMessage(actorRole, user.id, message.sender.id)) return;
      Alert.alert('Удалить сообщение?', message.text.slice(0, 80), [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await chatApi.deleteMessage(message.id);
                setMessages((prev) => prev.filter((m) => m.id !== message.id));
              } catch (e) {
                Alert.alert('Удаление', e instanceof Error ? e.message : 'Ошибка');
              }
            })();
          },
        },
      ]);
    },
    [actorRole, user],
  );

  const startVideo = () => {
    if (channelType !== 'dm' || !peer) {
      Alert.alert('Звонок', 'Звонки доступны только в личных сообщениях (1:1)');
      return;
    }
    void startCall(peer, 'video', channelId);
  };

  const startAudio = () => {
    if (channelType !== 'dm' || !peer) {
      Alert.alert('Звонок', 'Звонки доступны только в личных сообщениях (1:1)');
      return;
    }
    void startCall(peer, 'audio', channelId);
  };

  const data = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = [];
    let prevDay = '';
    let prevSender: string | null = null;
    let prevTs = 0;
    for (const message of messages) {
      const day = new Date(message.createdAt).toDateString();
      if (day !== prevDay) {
        items.push({ kind: 'date', key: `d_${message.id}`, ts: message.createdAt });
        prevDay = day;
        prevSender = null;
      }
      const sameSender = prevSender === message.sender.id;
      const closeInTime = message.createdAt - prevTs < 2 * 60 * 1000;
      items.push({
        kind: 'message',
        key: message.id,
        message,
        showAuthor: !(sameSender && closeInTime),
      });
      prevSender = message.sender.id;
      prevTs = message.createdAt;
    }
    return items;
  }, [messages]);

  if (loadError) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Чат" onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Button title="Назад" variant="ghost" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        onBack={() => router.back()}
        right={
          <View style={styles.headerActions}>
            <HeaderAction icon="video" onPress={startVideo} label="Видеозвонок" />
            <HeaderAction icon="phone" onPress={startAudio} label="Аудиозвонок" />
          </View>
        }
      />
      {channelType === 'dm' && peer ? (
        <View style={styles.presenceRow}>
          <View
            style={[
              styles.presenceDot,
              { backgroundColor: isOnline(peer.id) ? colors.ok : colors.muted },
            ]}
          />
          <Text style={styles.presenceText}>
            {isOnline(peer.id) ? 'в сети' : 'не в сети'}
          </Text>
        </View>
      ) : null}

      {initialLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
          <FlatList
            ref={listRef}
            data={data}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) =>
              item.kind === 'date' ? (
                <View style={styles.dateRow}>
                  <Text style={styles.dateText}>{formatDaySeparator(item.ts)}</Text>
                </View>
              ) : (
                <MessageRow
                  message={item.message}
                  showAuthor={item.showAuthor}
                  own={item.message.sender.id === user?.id}
                  canDelete={canDeleteMessage(
                    actorRole,
                    user?.id ?? '',
                    item.message.sender.id,
                  )}
                  onDelete={() => tryDelete(item.message)}
                />
              )
            }
            ListHeaderComponent={
              hasMore ? (
                <View style={styles.olderWrap}>
                  <Button
                    title={loadingOlder ? 'Загрузка…' : 'Загрузить ещё'}
                    variant="ghost"
                    small
                    loading={loadingOlder}
                    onPress={() => void loadOlder()}
                  />
                </View>
              ) : null
            }
            ListEmptyComponent={<Text style={styles.empty}>Сообщений пока нет</Text>}
          />

          <View style={[styles.typingRow, { minHeight: 22 }]}>
            {typingNames.length > 0 ? (
              <Text style={styles.typingText}>
                {typingNames.join(', ')} печатает…
              </Text>
            ) : null}
          </View>

          <View style={[styles.inputBar, { paddingBottom: insets.bottom + 10 }]}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={onInputChange}
              placeholder="Напишите сообщение…"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={MAX_TEXT}
            />
            <Pressable
              onPress={send}
              disabled={!text.trim()}
              style={({ pressed }) => [
                styles.sendButton,
                { opacity: !text.trim() ? 0.4 : pressed ? 0.8 : 1 },
              ]}>
              <Feather name="send" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

function HeaderAction({
  icon,
  onPress,
  label,
}: {
  icon: keyof typeof Feather.glyphMap;
  onPress(): void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.6 : 1 }]}>
      <Feather name={icon} size={19} color={colors.text} />
    </Pressable>
  );
}

function MessageRow({
  message,
  showAuthor,
  own,
  canDelete,
  onDelete,
}: {
  message: Message;
  showAuthor: boolean;
  own: boolean;
  canDelete: boolean;
  onDelete(): void;
}) {
  const bubble = (
    <View
      style={[
        styles.bubble,
        own ? styles.bubbleOwn : styles.bubbleOther,
        !showAuthor && (own ? styles.bubbleOwnCompact : styles.bubbleOtherCompact),
      ]}>
      {!own && showAuthor ? (
        <Text style={[styles.author, { color: message.sender.avatarColor }]}>
          {message.sender.displayName}
        </Text>
      ) : null}
      <Text style={styles.messageText}>{message.text}</Text>
      <Text style={styles.time}>{formatTime(message.createdAt)}</Text>
    </View>
  );

  return (
    <Pressable
      onLongPress={() => {
        if (canDelete) onDelete();
      }}
      delayLongPress={350}
      style={[styles.messageRow, own ? styles.messageRowOwn : styles.messageRowOther]}>
      {!own && showAuthor ? (
        <View style={{ marginRight: 8 }}>
          <Avatar
            name={message.sender.displayName}
            color={message.sender.avatarColor}
            size={30}
          />
        </View>
      ) : !own ? (
        <View style={{ width: 30, marginRight: 8 }} />
      ) : null}
      {bubble}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerAction: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: colors.panel,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  presenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  presenceText: {
    color: colors.muted,
    fontSize: 12,
  },
  listContent: {
    padding: 14,
    paddingBottom: 6,
  },
  olderWrap: {
    alignItems: 'center',
    paddingBottom: 12,
  },
  dateRow: {
    alignItems: 'center',
    marginVertical: 12,
  },
  dateText: {
    color: colors.muted,
    fontSize: 12,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'flex-end',
  },
  messageRowOwn: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  bubbleOwn: {
    backgroundColor: 'rgba(124,108,246,0.18)',
    borderColor: 'rgba(124,108,246,0.35)',
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleOwnCompact: {
    marginTop: 2,
  },
  bubbleOtherCompact: {
    marginTop: 2,
  },
  author: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 3,
  },
  messageText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  time: {
    color: colors.muted,
    fontSize: 10,
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  empty: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: 40,
    fontSize: 14,
  },
  typingRow: {
    paddingHorizontal: 16,
    paddingVertical: 2,
  },
  typingText: {
    color: colors.muted,
    fontSize: 12,
    fontStyle: 'italic',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
  },
});
