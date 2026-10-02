/**
 * Локальное состояние прочтения каналов (SPEC v3 §18).
 *
 * Мобильный клиент отправляет POST /api/channels/:id/read не чаще 1 раза
 * в 3 секунды на канал; бейджи непрочитанных в списке чатов должны
 * обнуляться сразу при открытии чата, не дожидаясь ответа сервера.
 * Этот модуль — крошечный внешний store без React (подписка через subscribeReadState).
 */

type Listener = () => void;

const listeners = new Set<Listener>();
const readTimes = new Map<string, number>();
let openChannelId: string | null = null;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Подписка на изменения (вернуть функцию отписки). */
export function subscribeReadState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Чат открыт (сообщения «прочитаны» локально, бейджи обнуляются). */
export function setOpenChannelId(channelId: string | null): void {
  if (openChannelId === channelId) return;
  openChannelId = channelId;
  notify();
}

export function getOpenChannelId(): string | null {
  return openChannelId;
}

/** Зафиксировать отправленный POST .../read. */
export function noteLocalRead(channelId: string, at: number): void {
  const current = readTimes.get(channelId) ?? 0;
  if (at <= current) return;
  readTimes.set(channelId, at);
  notify();
}

export function localReadAt(channelId: string): number {
  return readTimes.get(channelId) ?? 0;
}

/** Сообщение уже прочитано локально? */
export function isLocallyRead(channelId: string, ts: number): boolean {
  return ts <= localReadAt(channelId);
}
