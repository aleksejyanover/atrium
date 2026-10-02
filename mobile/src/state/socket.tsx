import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';

import { API_URL } from '@/lib/api';
import { AppSocket, ServerToClientEvents } from '@/lib/socket-events';
import { useAuth } from '@/state/auth';

interface SocketContextValue {
  socket: AppSocket | null;
  /** userId → online flag, fed by presence:update / presence:list. */
  online: Record<string, boolean>;
  isOnline(userId: string | undefined | null): boolean;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [online, setOnline] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!token) return;
    const s = io(API_URL, {
      auth: { token },
      reconnection: true,
    }) as unknown as AppSocket;
    // Socket.IO connection is an external system whose lifecycle is bound to the
    // auth token: there is no event for "instance created", so the state must be
    // mirrored here (allowed by React: effects subscribe to external systems).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [token]);

  useEffect(() => {
    if (!socket) return;
    const onUpdate = (payload: { userId: string; online: boolean }) => {
      setOnline((prev) => ({ ...prev, [payload.userId]: payload.online }));
    };
    // SPEC v8 §34: сервер присылает снапшот онлайн-пользователей при каждом
    // подключении/реконнекте — объединяем его с картой, не затирая более
    // свежие presence:update.
    const onList = (payload: { userIds: string[] }) => {
      if (!payload || !Array.isArray(payload.userIds)) return;
      setOnline((prev) => {
        const next = { ...prev };
        for (const id of payload.userIds) next[id] = true;
        return next;
      });
    };
    socket.on('presence:update', onUpdate);
    socket.on('presence:list', onList);
    return () => {
      socket.off('presence:update', onUpdate);
      socket.off('presence:list', onList);
    };
  }, [socket]);

  // SPEC v8 §34 п.5: пробуждение приложения не должно оставлять мёртвый
  // сокет — при возврате в 'active' принудительно переподключаемся.
  useEffect(() => {
    if (!socket) return;
    // На web AppState может быть недоступен — проверяем перед подпиской.
    if (!AppState || typeof AppState.addEventListener !== 'function' || !AppState.isAvailable) {
      return;
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !socket.connected) socket.connect();
    });
    return () => subscription.remove();
  }, [socket]);

  const value = useMemo<SocketContextValue>(
    () => ({
      socket,
      online,
      isOnline: (userId) => (userId ? online[userId] === true : false),
    }),
    [socket, online],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used inside SocketProvider');
  return ctx;
}

/**
 * Subscribe to a socket event for the lifetime of the component.
 * The handler is kept in a ref so it never needs to be memoized.
 */
export function useSocketEvent<K extends keyof ServerToClientEvents>(
  event: K,
  handler: ServerToClientEvents[K],
): void {
  const { socket } = useSocket();
  const ref = useRef(handler);

  useEffect(() => {
    ref.current = handler;
  });

  useEffect(() => {
    if (!socket) return;
    const listener = ((...args: unknown[]) => {
      (ref.current as (...a: unknown[]) => void)(...args);
    }) as ServerToClientEvents[K];
    socket.on(event, listener as never);
    return () => {
      socket.off(event, listener as never);
    };
  }, [socket, event]);
}
