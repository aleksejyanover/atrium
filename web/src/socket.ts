/** Socket.IO singleton for the Atrium web client (SPEC §4). */

import { io, type Socket } from 'socket.io-client';

/**
 * Same-origin by default: when the app is served by the Node server (incl. any
 * public tunnel URL) sockets go through the same host, and in `npm run dev`
 * the Vite proxy handles `/socket.io`. Override with `VITE_API_URL` if the
 * API lives elsewhere.
 */
const apiOverride = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL;
export const SOCKET_URL: string =
  apiOverride || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');

let socket: Socket | null = null;
let socketToken: string | null = null;

export function connectSocket(token: string): Socket {
  if (socket && socketToken === token) {
    if (!socket.connected) socket.connect();
    return socket;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  socketToken = token;
  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    socketToken = null;
  }
}

/** Ack payload convention: `{ok:true, ...}` or `{error:"..."}` (SPEC §4). */
export interface AckResult {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * `socket.emit(event, payload, ack)` as a promise that never hangs:
 * resolves with the ack payload, or `{error}` after a timeout / socket absence.
 */
export function emitAck<T extends AckResult = AckResult>(
  sock: Socket | null,
  event: string,
  payload: Record<string, unknown>,
  timeoutMs = 12000,
): Promise<T> {
  return new Promise((resolve) => {
    if (!sock) {
      resolve({ ok: false, error: 'Нет соединения с сервером' } as T);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: 'Сервер не ответил' } as T);
      }
    }, timeoutMs);
    sock.emit(event, payload, (res: T | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res ?? ({ ok: false, error: 'Пустой ответ сервера' } as T));
    });
  });
}
