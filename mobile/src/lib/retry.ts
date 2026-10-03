import { ApiError } from '@/lib/api';

/**
 * SPEC v9 §39: повтор запроса при сетевых сбоях и 5xx (обрыв туннеля,
 * рестарт сервера при деплое) — backoff 1с / 2с / 4с.
 * Клиентские ошибки (4xx) и 401 не повторяются: они не лечатся ещё одной
 * попыткой.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  delaysMs: number[] = [1000, 2000, 4000],
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // status 0 — «Не удалось связаться с сервером» (обрыв сети)
      const retriable = !(e instanceof ApiError) || e.status === 0 || e.status >= 500;
      if (!retriable || attempt === delaysMs.length) throw e;
      await new Promise((r) => setTimeout(r, delaysMs[attempt]));
    }
  }
  throw lastErr;
}
