const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function formatDaySeparator(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = dayKey(now.getTime());
  const yesterday = dayKey(now.getTime() - 86400000);
  const key = dayKey(ts);
  if (key === today) return 'Сегодня';
  if (key === yesterday) return 'Вчера';
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function formatCallDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${pad(m)}:${pad(s)}`;
}

/** Целые рубли с пробелами между разрядами: 12500 → «12 500» (SPEC v4 §24). */
export function rubNumber(value: number): string {
  const n = Math.trunc(Number(value) || 0);
  const sign = n < 0 ? '-' : '';
  return `${sign}${String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

/** Деньги: «12 500 ₽» (SPEC v4 §24). */
export function rub(value: number): string {
  return `${rubNumber(value)} ₽`;
}

/** Сумма со знаком операции: «+1 000 ₽» / «−500 ₽». */
export function rubSigned(value: number, incoming: boolean): string {
  return `${incoming ? '+' : '−'}${rubNumber(Math.abs(value))} ₽`;
}

/** Номер карты с маской ввода 0000 0000 0000 0000 (SPEC v4 §24). */
export function formatCardNumber(digits: string): string {
  const only = digits.replace(/\D/g, '').slice(0, 16);
  return only.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** Баланс — обычное число рублей, у владельца тоже (SPEC v6 §32). */
export function formatBalance(value: number | null | undefined): string {
  return rub(value ?? 0);
}

/** Маска номера карты: «•••• •••• •••• 1234» (SPEC v6 §32). */
export function maskCardNumber(number: string): string {
  const only = number.replace(/\D/g, '');
  return only ? `•••• •••• •••• ${only.slice(-4)}` : '•••• •••• •••• ••••';
}

/** Детерминированный серийный номер карточки владельца: OWNER-XXXX от id (SPEC v5 §30). */
export function ownerSerial(userId: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 4; i++) {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    out += alphabet[hash % alphabet.length];
  }
  return `OWNER-${out}`;
}

/** «5 участников», «21 участник», «11 участников» */
export function pluralizeMembers(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} участник`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} участника`;
  return `${count} участников`;
}
