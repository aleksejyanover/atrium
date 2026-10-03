/**
 * SPEC v9 §37: авто-модерация переписки в каналах, куда добавлен бот.
 *  - список нецензурных слов: admin_settings key 'profanity_list'
 *    (JSON-массив или строки через перевод строки), иначе встроенный;
 *  - счётчики channel_mod (messages / violations / last_rating_at);
 *  - предупреждение автору в ЛС бота (дедупликация: не чаще1 раза в60с);
 *  - включается/выключается целиком через ATRIUM_NO_MODERATION=1.
 */
import { get, run } from './db.js'
import { ensureBotDm, botSendMessage } from './bot.js'

/**
 * Встроенный список корней. Правило матчинга: граница слова ДО корня,
 * после — ничего не требуется («пизд» ловит «пиздец»/«пиздюля»).
 * Редактируется админом через admin_settings 'profanity_list'.
 */
const DEFAULT_PROFANITY = [
  // ru
  'бляд', 'блять', 'блящи',
  'хуй', 'хуя', 'хуе', 'хуё', 'хуйн',
  'нахуй', 'нахер',
  'пизд',
  'ебан', 'ебаш', 'ебнул', 'ебнут', 'ебля', 'ебл',
  'мудак', 'мудач',
  'гандон',
  'сука', 'сучк',
  'жоп',
  'пидор', 'пидар', 'педик',
  'гнида',
  'залуп',
  'долбоёб', 'долбоеб',
  'манда',
  'выебон',
  // en
  'fuck', 'shit', 'bitch', 'cunt', 'whore', 'nigger', 'faggot',
  'dick', 'pussy', 'asshole', 'bastard', 'piss',
]

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Current list (admin override or built-in). Read fresh — admin edits apply at once. */
export function profanityRoots() {
  const row = get(`SELECT value FROM admin_settings WHERE key = ?`, 'profanity_list')
  if (row && row.value) {
    try {
      const parsed = JSON.parse(row.value)
      if (Array.isArray(parsed)) {
        const roots = parsed
          .filter((r) => typeof r === 'string' && r.trim())
          .map((r) => r.trim().toLowerCase())
        if (roots.length) return roots
      }
    } catch {
      /* newline format */
    }
    const lines = row.value
      .split(/[\n,]/)
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean)
    if (lines.length) return lines
  }
  return DEFAULT_PROFANITY
}

/** Первый найденный корень или null (text длиной до4000 — по одному regex на корень).
 *  RU-корни матчаются без границы слева (русские корни имеют приставки:
 *  «охуеть», «заебать» — иначе они не находятся); EN-корни — со границей
 *  слева, чтобы не рвать обычные слова (классический Scunthorpe-проблема). */
export function findViolation(text) {
  if (process.env.ATRIUM_NO_MODERATION === '1') return null
  const lower = text.toLowerCase()
  for (const root of profanityRoots()) {
    const pattern = /^[a-z]/.test(root)
      ? `(^|[^a-z0-9])${escRe(root)}`
      : escRe(root)
    const re = new RegExp(pattern, 'i')
    if (re.test(lower)) return root
  }
  return null
}

/** +messages / +violations в channel_mod (создаёт строку при первом сообщении). */
export function recordChannelStat(channelId, { message = false, violation = false } = {}) {
  run(
    `INSERT INTO channel_mod (channel_id, messages, violations) VALUES (?,0,0)
     ON CONFLICT(channel_id) DO NOTHING`,
    channelId
  )
  if (message || violation) {
    run(
      'UPDATE channel_mod SET messages = messages + ?, violations = violations + ? WHERE channel_id = ?',
      message ? 1 : 0,
      violation ? 1 : 0,
      channelId
    )
  }
}

export function getChannelStat(channelId) {
  return (
    get('SELECT * FROM channel_mod WHERE channel_id = ?', channelId) || {
      channel_id: channelId,
      messages: 0,
      violations: 0,
      last_rating_at: null,
    }
  )
}

// ---- предупреждение автору в ЛС бота: не чаще1 раза в60с ----

const WARN_DEDUPE_MS = 60000
const lastWarnAt = new Map() // userId -> ts

export function warnAuthor(senderId, channelTitle) {
  const now = Date.now()
  const last = lastWarnAt.get(senderId) || 0
  if (now - last < WARN_DEDUPE_MS) return false
  lastWarnAt.set(senderId, now)
  const dm = ensureBotDm(senderId)
  if (!dm) return false
  botSendMessage(dm.id, `⚠️ Ваше сообщение в «${channelTitle}» удалено: нецензурная лексика`)
  return true
}
