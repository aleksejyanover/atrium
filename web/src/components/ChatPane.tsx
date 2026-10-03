import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { emitAck } from '../socket';
import { useApp } from '../store';
import { useCall } from './CallProvider';
import { canDeleteMessage } from '../permissions';
import { isRecord, pluralRu, unwrapUser, type Message, type ReadEntry, type User } from '../types';
import { Avatar } from './Avatar';
import { ConfirmModal } from './Modal';
import { CallTargetModal } from './CallTargetModal';
import { HashIcon, MenuIcon, PhoneIcon, SendIcon, TrashIcon, UsersIcon, VideoIcon, InfoIcon, BotIcon } from './icons';

/* ---------------- formatting helpers ---------------- */

const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

function formatDay(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return dayFmt.format(d);
}

function upsertMessage(list: Message[], incoming: Message, tempId?: string): Message[] {
  if (list.some((m) => m.id === incoming.id)) return list;
  const marker = tempId ?? incoming.tempId;
  if (marker) {
    const idx = list.findIndex((m) => m.id === marker);
    if (idx >= 0) {
      const next = [...list];
      next[idx] = incoming;
      return next;
    }
  }
  return [...list, incoming];
}

interface TypingEntry {
  name: string;
}

interface ChatPaneProps {
  channelId: string;
  onOpenNav: () => void;
}

export function ChatPane({ channelId, onOpenNav }: ChatPaneProps) {
  const {
    user,
    socket,
    detail,
    dms,
    online,
    panelOpen,
    panelTab,
    openPanel,
    closePanel,
    toast,
    setChannelUnread,
  } = useApp();
  const { startCall } = useCall();

  const dm = dms.find((d) => d.channel.id === channelId) ?? null;
  const channel = detail?.channels.find((c) => c.id === channelId) ?? dm?.channel ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [typingUsers, setTypingUsers] = useState<Record<string, TypingEntry>>({});
  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);
  const [callKind, setCallKind] = useState<'video' | 'audio' | null>(null);
  const [reads, setReads] = useState<ReadEntry[]>([]);

  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const atBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const typingTimers = useRef<Record<string, number>>({});
  const lastTypingEmit = useRef(0);
  const userRef = useRef<User | null>(user);
  userRef.current = user;
  const readSentAt = useRef(0);
  const readTrailing = useRef<number | null>(null);

  messagesRef.current = messages;

  const actorId = user?.id ?? '';
  const actor = useMemo(() => ({ id: actorId, role: detail?.role ?? 'member' as const }), [actorId, detail]);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  /* ------------- read receipts (SPEC v3 §18) ------------- */

  const requestRead = useCallback(() => {
    const now = Date.now();
    const since = now - readSentAt.current;
    const send = () => {
      readSentAt.current = Date.now();
      readTrailing.current = null;
      void api
        .markRead(channelId)
        .then(() => setChannelUnread(channelId, 0))
        .catch(() => undefined);
    };
    if (since >= 3000) {
      send();
    } else if (readTrailing.current === null) {
      readTrailing.current = window.setTimeout(send, 3000 - since);
    }
  }, [channelId, setChannelUnread]);

  useEffect(() => {
    readSentAt.current = 0;
    if (readTrailing.current !== null) {
      window.clearTimeout(readTrailing.current);
      readTrailing.current = null;
    }
    return () => {
      if (readTrailing.current !== null) {
        window.clearTimeout(readTrailing.current);
        readTrailing.current = null;
      }
    };
  }, [channelId]);

  /* ------------- load messages on channel switch ------------- */

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setHasMore(false);
    setTypingUsers({});
    setReads([]);
    atBottomRef.current = true;
    Object.values(typingTimers.current).forEach((t) => window.clearTimeout(t));
    typingTimers.current = {};
    void (async () => {
      try {
        const page = await api.getMessages(channelId);
        if (cancelled) return;
        setMessages(page.messages);
        setHasMore(page.hasMore);
        requestAnimationFrame(() => scrollToBottom());
      } catch (e) {
        if (!cancelled) {
          toast(e instanceof Error ? e.message : 'Не удалось загрузить сообщения', 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    void api
      .readStatus(channelId)
      .then((r) => {
        if (!cancelled) setReads(r);
      })
      .catch(() => undefined);
    if (!cancelled) requestRead();
    return () => {
      cancelled = true;
    };
  }, [channelId, requestRead, scrollToBottom, toast]);

  /* ------------- socket: message:new + typing + channel:read ------------- */

  useEffect(() => {
    if (!socket) return;

    const onNew = (payload: unknown) => {
      if (!isRecord(payload) || !isRecord(payload.message)) return;
      const m = payload.message as unknown as Message;
      if (m.channelId !== channelId || typeof m.id !== 'string') return;
      const own = m.sender?.id !== undefined && m.sender.id === userRef.current?.id;
      const shouldScroll = atBottomRef.current || own;
      setMessages((prev) => upsertMessage(prev, m, m.tempId));
      if (!own && atBottomRef.current) requestRead();
      if (shouldScroll) requestAnimationFrame(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    };

    const onRead = (payload: unknown) => {
      if (!isRecord(payload) || payload.channelId !== channelId) return;
      const userId = typeof payload.userId === 'string' ? payload.userId : null;
      const lastReadAt =
        typeof payload.lastReadAt === 'number'
          ? payload.lastReadAt
          : typeof payload.last_read_at === 'number'
            ? payload.last_read_at
            : null;
      if (!userId || lastReadAt === null) return;
      if (userId === userRef.current?.id) return;
      setReads((prev) => {
        const idx = prev.findIndex((r) => r.userId === userId);
        if (idx >= 0) {
          if (prev[idx].lastReadAt >= lastReadAt) return prev;
          const next = [...prev];
          next[idx] = { userId, lastReadAt };
          return next;
        }
        return [...prev, { userId, lastReadAt }];
      });
    };

    const onTyping = (payload: unknown) => {
      if (!isRecord(payload) || payload.channelId !== channelId) return;
      const u = unwrapUser(payload.user);
      if (!u || u.id === userRef.current?.id) return;
      const existing = typingTimers.current[u.id];
      if (existing) window.clearTimeout(existing);
      if (payload.typing === true) {
        setTypingUsers((prev) => ({ ...prev, [u.id]: { name: u.displayName } }));
        typingTimers.current[u.id] = window.setTimeout(() => {
          delete typingTimers.current[u.id];
          setTypingUsers((prev) => {
            if (!(u.id in prev)) return prev;
            const { [u.id]: _drop, ...rest } = prev;
            return rest;
          });
        }, 3600);
      } else {
        delete typingTimers.current[u.id];
        setTypingUsers((prev) => {
          if (!(u.id in prev)) return prev;
          const { [u.id]: _drop, ...rest } = prev;
          return rest;
        });
      }
    };

    const onDeleted = (payload: unknown) => {
      // message:deleted (удаление модератором или другим участником)
      if (!isRecord(payload) || payload.channelId !== channelId) return;
      const id = typeof payload.messageId === 'string' ? payload.messageId : null;
      if (!id) return;
      setMessages((prev) => prev.filter((m) => m.id !== id));
    };

    socket.on('message:new', onNew);
    socket.on('message:deleted', onDeleted);
    socket.on('typing', onTyping);
    socket.on('channel:read', onRead);
    return () => {
      socket.off('message:new', onNew);
      socket.off('message:deleted', onDeleted);
      socket.off('typing', onTyping);
      socket.off('channel:read', onRead);
      Object.values(typingTimers.current).forEach((t) => window.clearTimeout(t));
      typingTimers.current = {};
    };
  }, [socket, channelId, requestRead]);

  /* ------------- pagination ------------- */

  const loadOlder = useCallback(async () => {
    if (!hasMore || loadingOlderRef.current) return;
    const current = messagesRef.current;
    if (current.length === 0) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await api.getMessages(channelId, current[0].id);
      setMessages((prev) => [
        ...page.messages.filter((m) => !prev.some((p) => p.id === m.id)),
        ...prev,
      ]);
      setHasMore(page.hasMore);
      requestAnimationFrame(() => {
        const node = listRef.current;
        if (node) node.scrollTop += node.scrollHeight - prevHeight;
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось загрузить сообщения', 'error');
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [channelId, hasMore, toast]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const wasAtBottom = atBottomRef.current;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottomRef.current && !wasAtBottom) requestRead();
    if (el.scrollTop < 60 && hasMore && !loadingOlderRef.current) {
      void loadOlder();
    }
  }, [hasMore, loadOlder, requestRead]);

  /* ------------- send ------------- */

  const sendTypingOff = useCallback(() => {
    if (socket && lastTypingEmit.current > 0) {
      lastTypingEmit.current = 0;
      socket.emit('typing', { channelId, typing: false });
    }
  }, [socket, channelId]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !socket || !user) return;
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: tempId,
      channelId,
      sender: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
      },
      text,
      createdAt: Date.now(),
      pending: true,
      tempId,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    if (composerRef.current) composerRef.current.style.height = 'auto';
    atBottomRef.current = true;
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    sendTypingOff();

    const res = await emitAck<{
      ok?: boolean;
      message?: Message;
      moderated?: boolean;
      error?: string;
    }>(socket, 'message:send', { channelId, text, tempId });
    if (res.ok && res.moderated === true) {
      // SPEC v9 §37: сообщение рассылалось и сразу удалено модератором —
      // message:deleted уже убрал его из списка, ошибку не показываем
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } else if (res.ok && res.message && typeof res.message.id === 'string') {
      const incoming = { ...res.message, tempId };
      setMessages((prev) => upsertMessage(prev, incoming, tempId));
      requestAnimationFrame(() => {
        const el = listRef.current;
        if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
      });
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(text);
      toast(res.error ?? 'Не удалось отправить сообщение', 'error');
    }
  }, [channelId, draft, sendTypingOff, socket, toast, user]);

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (!socket || !value.trim()) return;
    const now = Date.now();
    if (now - lastTypingEmit.current > 2000) {
      lastTypingEmit.current = now;
      socket.emit('typing', { channelId, typing: true });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteMessage(deleteTarget.id);
      const id = deleteTarget.id;
      setMessages((prev) => prev.filter((m) => m.id !== id));
      setDeleteTarget(null);
      toast('Сообщение удалено', 'success');
    } catch (e) {
      setDeleteTarget(null);
      toast(e instanceof Error ? e.message : 'Не удалось удалить сообщение', 'error');
    }
  };

  /* ------------- calls ------------- */

  const requestCall = (kind: 'video' | 'audio') => {
    if (!user) return;
    if (dm) {
      void startCall(
        { id: dm.peer.id, name: dm.peer.displayName, color: dm.peer.avatarColor },
        kind,
        channelId,
      );
      return;
    }
    setCallKind(kind);
  };

  const pickCallTarget = (peer: { id: string; name: string; color: string }) => {
    const kind = callKind;
    setCallKind(null);
    if (kind) void startCall(peer, kind, channelId);
  };

  /* ------------- header info ------------- */

  const membersCount = detail?.members.length ?? 0;
  const isBotDm = !!dm && (dm.peer.username === 'atrium_bot' || dm.peer.id === 'u_bot');
  // Фолбэк имени: у бота displayName может быть пустым — показываем @username.
  const peerName = dm ? dm.peer.displayName.trim() || `@${dm.peer.username}` : '';
  const title = dm ? peerName : (channel?.name ? `#${channel.name}` : 'Чат');
  const subtitle = isBotDm
    ? 'автоматические отчёты'
    : dm
      ? online.has(dm.peer.id)
        ? 'в сети'
        : 'не в сети'
      : `${membersCount} ${pluralRu(membersCount, 'участник', 'участника', 'участников')}`;

  const typingList = Object.values(typingUsers);
  const typingText =
    typingList.length === 1
      ? `${typingList[0].name} печатает…`
      : typingList.length === 2
        ? `${typingList[0].name} и ${typingList[1].name} печатают…`
        : typingList.length > 2
          ? `${typingList[0].name} и ещё ${typingList.length - 1} печатают…`
          : '';

  /* ------------- render messages ------------- */

  const renderReadStatus = (m: Message): ReactNode => {
    if (m.pending) return null;
    if (dm) {
      const peerRead = reads.find((r) => r.userId === dm.peer.id);
      if (peerRead && peerRead.lastReadAt >= m.createdAt) {
        return <div className="msg-read">Прочитано {timeFmt.format(peerRead.lastReadAt)}</div>;
      }
      return <div className="msg-read">✓ Доставлено</div>;
    }
    /* channel: only under the author's last own message */
    const members = detail?.members ?? [];
    const total = members.length;
    if (total === 0) return null;
    let lastOwnId: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender.id === user?.id && !messages[i].pending) {
        lastOwnId = messages[i].id;
        break;
      }
    }
    if (m.id !== lastOwnId) return null;
    const readCount = members.filter(
      (mem) =>
        mem.user.id === user?.id ||
        reads.some((r) => r.userId === mem.user.id && r.lastReadAt >= m.createdAt),
    ).length;
    return (
      <div className="msg-read">Прочитано: {readCount} из {total}</div>
    );
  };

  const renderMessages = () => {
    if (loading) return <div className="empty-state">Загрузка…</div>;
    if (messages.length === 0) {
      return <div className="empty-state">Пока нет сообщений — напишите первым</div>;
    }
    let prevDay = '';
    let prevAuthor = '';
    return (
      <>
        {hasMore && (
          <div className="load-more-wrap">
            <button className="btn btn-ghost btn-sm" onClick={() => void loadOlder()}>
              {loadingOlder ? 'Загрузка…' : 'Загрузить ещё'}
            </button>
          </div>
        )}
        {messages.map((m, i) => {
          const day = formatDay(m.createdAt);
          const showDay = day !== prevDay;
          prevDay = day;
          const own = m.sender.id === user?.id;
          const showName = m.sender.id !== prevAuthor || showDay;
          prevAuthor = m.sender.id;
          const next = messages[i + 1];
          const contiguous = !next || (next.sender.id === m.sender.id && formatDay(next.createdAt) === day);
          const canDelete = canDeleteMessage(m.sender.id, actor);
          // Системные сообщения бота: пустой displayName → @username вместо пустого места.
          const authorName = m.sender.displayName.trim() || `@${m.sender.username}`;
          return (
            <div key={m.id}>
              {showDay && (
                <div className="msg-day">
                  <span>{day}</span>
                </div>
              )}
              <div
                className={['msg-row', own ? 'own' : '', showName && !own ? 'with-name' : '']
                  .filter(Boolean)
                  .join(' ')}
                style={contiguous ? undefined : { marginBottom: 6 }}
              >
                {!own &&
                  (showName ? (
                    <Avatar
                      name={m.sender.displayName}
                      color={m.sender.avatarColor}
                      size={30}
                    />
                  ) : (
                    <div style={{ width: 30, flex: 'none' }} />
                  ))}
                <div className="body">
                  {showName && (
                    <div className="msg-meta">
                      <span
                        className="msg-author"
                        style={own ? undefined : { color: m.sender.avatarColor || undefined }}
                      >
                        {own ? 'Вы' : authorName}
                      </span>
                      <span className="msg-time">{timeFmt.format(m.createdAt)}</span>
                    </div>
                  )}
                  <div className={m.pending ? 'bubble pending' : 'bubble'}>{m.text}</div>
                  {own && renderReadStatus(m)}
                </div>
                {canDelete && !m.pending && (
                  <div className="msg-actions">
                    <button
                      className="icon-btn danger"
                      title="Удалить сообщение"
                      onClick={() => setDeleteTarget(m)}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </>
    );
  };

  /* ------------- shell ------------- */

  if (!channel && !dm) {
    return (
      <div className="chat">
        <div className="chat-header">
          <button className="icon-btn only-mobile" onClick={onOpenNav} title="Меню">
            <MenuIcon />
          </button>
          <div className="title">Чат</div>
        </div>
        <div className="chat-placeholder">
          <HashIcon size={34} />
          <div>Выберите канал, чтобы начать общение</div>
        </div>
      </div>
    );
  }

  const toggleMembers = () => {
    if (panelOpen && panelTab === 'members') closePanel();
    else openPanel('members');
  };

  return (
    <div className="chat">
      <div className="chat-header">
        <button className="icon-btn only-mobile" onClick={onOpenNav} title="Меню">
          <MenuIcon />
        </button>
        <div className="title">
          {dm ? (
            <Avatar name={peerName} color={dm.peer.avatarColor} size={26} />
          ) : (
            <HashIcon size={17} />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          <span className="sub">{subtitle}</span>
        </div>

        {!dm && (
          <button
            className={
              panelOpen && panelTab === 'members' ? 'members-toggle active' : 'members-toggle'
            }
            onClick={toggleMembers}
            title="Участники"
          >
            <UsersIcon size={14} />
            {membersCount}
          </button>
        )}

        <div className="spacer" />

        {!isBotDm && (
          <>
            <button className="icon-btn" title="Видеозвонок" onClick={() => requestCall('video')}>
              <VideoIcon size={17} />
            </button>
            <button className="icon-btn" title="Аудиозвонок" onClick={() => requestCall('audio')}>
              <PhoneIcon size={16} />
            </button>
          </>
        )}
        {!dm && (
          <button
            className="icon-btn only-desktop"
            title="Бот-модератор канала"
            onClick={() => (panelOpen && panelTab === 'channel' ? closePanel() : openPanel('channel'))}
          >
            <BotIcon size={17} />
          </button>
        )}
        {!isBotDm && (
          <button
            className="icon-btn"
            title="Информация об организации"
            onClick={() => (panelOpen && panelTab === 'info' ? closePanel() : openPanel('info'))}
          >
            <InfoIcon size={17} />
          </button>
        )}
      </div>

      <div className="messages" ref={listRef} onScroll={onScroll}>
        {renderMessages()}
      </div>

      <div className="typing-row">
        {typingText && (
          <>
            <span className="typing-dots">
              <i />
              <i />
              <i />
            </span>
            {typingText}
          </>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={composerRef}
          rows={1}
          placeholder="Напишите сообщение…"
          value={draft}
          onChange={(e) => {
            onDraftChange(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="send-btn" type="submit" disabled={!draft.trim()} title="Отправить">
          <SendIcon size={17} />
        </button>
      </form>

      {deleteTarget && (
        <ConfirmModal
          title="Удалить сообщение?"
          text="Сообщение будет удалено для всех участников чата. Это действие нельзя отменить."
          confirmLabel="Удалить"
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {callKind && (
        <CallTargetModal kind={callKind} onPick={pickCallTarget} onClose={() => setCallKind(null)} />
      )}
    </div>
  );
}
