import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

import { API_URL } from '@/lib/api';
import { AppSocket, ServerToClientEvents } from '@/lib/socket-events';
import { useAuth } from '@/state/auth';

interface SocketContextValue {
  socket: AppSocket | null;
  /** userId → online flag, fed by presence:update. */
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
    const handler = (payload: { userId: string; online: boolean }) => {
      setOnline((prev) => ({ ...prev, [payload.userId]: payload.online }));
    };
    socket.on('presence:update', handler);
    return () => {
      socket.off('presence:update', handler);
    };
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
