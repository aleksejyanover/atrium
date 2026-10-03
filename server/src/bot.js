/**
 * Atrium Bot (SPEC v4 §23) — system user that DMs superadmins audit reports.
 *  - user id 'u_bot' / username 'atrium_bot' created lazily on first report
 *    (no usable password, not searchable, cannot log in);
 *  - DM channel (org_id NULL, members: u_bot + admin) created lazily;
 *  - reports go through the normal message:new mechanism → normal chat notifications;
 *  - settings live in admin_settings key 'bot' (JSON {enabled, events});
 *  - identical events (same action + same subject user) within 60s are deduped:
 *    first report is sent immediately, a summary «Вход: alex ×3 за минуту» is
 *    sent when the 60-second window closes.
 */
import { run, get, all, channelMemberIds, findUserById, superadminIds, BOT_ID } from './db.js'
import { newId } from './util.js'
import { emitToUser } from './bus.js'

const BOT_AVATAR = '#4DA3FF'

/** Event catalog for the settings checkboxes (default = all). */
export const BOT_EVENTS = [
  'auth.login',
  'auth.logout',
  'auth.register',
  'org.create',
  'member.joined',
  'member.left',
  'role.changed',
  'invite.created',
  'application.*',
  'dismissal.*',
  'message.deleted',
  'wallet.topup',
  'wallet.transfer',
  'org.payroll',
  'user.ban',
  'owner.claim',
  // SPEC v9: авто-модерация каналов + банковские операции
  'moderation.delete',
  'bank.withdraw',
  'bank.topup',
]

/**
 * Exact previous defaults — a saved settings object equal to any of them is
 * replaced with the current catalog (explicit user edits are kept untouched).
 * v4 default: no owner.claim, no v9 events. v5–v8 default: no v9 events.
 */
const PREVIOUS_DEFAULTS = [
  BOT_EVENTS.filter((e) => e !== 'owner.claim' && !e.startsWith('moderation.') && !e.startsWith('bank.')),
  BOT_EVENTS.filter((e) => !e.startsWith('moderation.') && !e.startsWith('bank.')),
]

const EMOJI = {
  'auth.login': '🔴',
  'auth.logout': '⚪',
  'auth.register': '🟢',
  'org.create': '🏢',
  'member.joined': '➕',
  'member.left': '➖',
  'role.changed': '🔄',
  'invite.created': '✉️',
  'application.submitted': '📨',
  'application.approved': '✅',
  'application.rejected': '❌',
  'application.canceled': '↩️',
  'dismissal.created': '📄',
  'dismissal.signed': '✍️',
  'dismissal.rejected': '🚫',
  'dismissal.canceled': '↩️',
  'dismissal.terminated': '⚡',
  'message.deleted': '🗑️',
  'wallet.topup': '💳',
  'wallet.transfer': '💸',
  'org.payroll': '💸',
  'org.treasury_deposit': '🏦',
  'user.ban': '⛔',
  'user.unban': '♻️',
  'owner.claim': '👑',
  'moderation.delete': '🤖',
  'bank.withdraw': '🏦',
  'bank.topup': '💳',
}

/** Short labels for 60s dedupe summaries («Вход: alex ×3 за минуту»). */
const SUMMARY_LABEL = {
  'auth.login': 'Вход',
  'auth.logout': 'Выход',
  'auth.register': 'Регистрация',
  'org.create': 'Организация',
  'member.joined': 'Вступление',
  'member.left': 'Выход из организации',
  'role.changed': 'Смена роли',
  'invite.created': 'Приглашение',
  'application.submitted': 'Заявление',
  'application.approved': 'Заявление принято',
  'application.rejected': 'Заявление отклонено',
  'application.canceled': 'Заявление отозвано',
  'dismissal.created': 'Увольнение',
  'dismissal.signed': 'Увольнение подписано',
  'dismissal.rejected': 'Увольнение оспорено',
  'dismissal.canceled': 'Увольнение отменено',
  'dismissal.terminated': 'Увольнение расторгнуто',
  'message.deleted': 'Удаление сообщения',
  'wallet.topup': 'Пополнение',
  'wallet.transfer': 'Перевод',
  'org.payroll': 'Зарплата',
  'org.treasury_deposit': 'Казначейство',
  'user.ban': 'Блокировка',
  'user.unban': 'Разблокировка',
  'owner.claim': 'Карточка владельца',
  'moderation.delete': 'Модерация: автоудаление',
  'bank.withdraw': 'Вывод на банковскую карту',
  'bank.topup': 'Пополнение с банковской карты',
}

// ---- settings (admin_settings key 'bot') ----

export function getBotSettings() {
  const row = get('SELECT value FROM admin_settings WHERE key = ?', 'bot')
  if (!row) return { enabled: true, events: [...BOT_EVENTS] }
  try {
    const parsed = JSON.parse(row.value)
    let events = Array.isArray(parsed.events)
      ? parsed.events.filter((e) => typeof e === 'string' && e)
      : [...BOT_EVENTS]
    if (!events.length) events = [...BOT_EVENTS]
    // SPEC v5 §29/v9: settings saved with an exact previous default are
    // upgraded to the current catalog (explicit user edits are kept).
    const isPreviousDefault = PREVIOUS_DEFAULTS.some(
      (def) => events.length === def.length && def.every((e) => events.includes(e))
    )
    if (isPreviousDefault) events = [...BOT_EVENTS]
    return { enabled: parsed.enabled !== false, events }
  } catch {
    return { enabled: true, events: [...BOT_EVENTS] }
  }
}

export function setBotSettings({ enabled, events }) {
  const current = getBotSettings()
  const next = {
    enabled: enabled === undefined ? current.enabled : !!enabled,
    events: events === undefined ? current.events : events,
  }
  run(
    `INSERT INTO admin_settings (key, value) VALUES ('bot', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    JSON.stringify(next)
  )
  return next
}

/** Does the settings event list cover this audit action? ('application.*' etc.) */
export function matchesBotEvent(events, action) {
  if (!Array.isArray(events)) return false
  if (events.includes('*') || events.includes(action)) return true
  return events.some((e) => typeof e === 'string' && e.endsWith('.*') && action.startsWith(e.slice(0, -1)))
}

// ---- lazy system user + DM ----

export function ensureBotUser() {
  const existing = findUserById(BOT_ID)
  if (existing) return existing
  try {
    run(
      `INSERT INTO users (id, username, email, password_hash, display_name, avatar_color, created_at)
       VALUES (?, 'atrium_bot', NULL, '', 'Atrium Бот', ?, ?)`,
      BOT_ID,
      BOT_AVATAR,
      Date.now()
    )
  } catch {
    /* username already taken by a real user — bot stays disabled */
  }
  return findUserById(BOT_ID)
}

function findBotDm(adminId) {
  const rows = all(
    `SELECT c.id FROM channels c
     WHERE c.type = 'dm' AND c.org_id IS NULL
       AND c.id IN (SELECT channel_id FROM channel_members WHERE user_id = ?)
       AND c.id IN (SELECT channel_id FROM channel_members WHERE user_id = ?)`,
    BOT_ID,
    adminId
  )
  for (const r of rows) {
    const members = channelMemberIds(r.id)
    if (members.length === 2 && members.includes(BOT_ID) && members.includes(adminId)) {
      return get('SELECT * FROM channels WHERE id = ?', r.id)
    }
  }
  return null
}

/** Lazy DM channel bot ↔ admin (org_id NULL). */
export function ensureBotDm(adminId) {
  const existing = findBotDm(adminId)
  if (existing) return existing
  const id = newId('c')
  const createdAt = Date.now()
  run(`INSERT INTO channels (id, org_id, type, name, created_by, created_at)
       VALUES (?, NULL, 'dm', NULL, ?, ?)`, id, BOT_ID, createdAt)
  run('INSERT INTO channel_members (channel_id, user_id) VALUES (?,?)', id, BOT_ID)
  run('INSERT INTO channel_members (channel_id, user_id) VALUES (?,?)', id, adminId)
  return get('SELECT * FROM channels WHERE id = ?', id)
}

/** Insert a bot message and emit message:new to channel members (normal notifications). */
export function botSendMessage(channelId, text) {
  const id = newId('m')
  const createdAt = Date.now()
  run('INSERT INTO messages (id, channel_id, sender_id, text, created_at) VALUES (?,?,?,?,?)',
    id, channelId, BOT_ID, text, createdAt)
  const message = {
    id,
    channelId,
    sender: {
      id: BOT_ID,
      username: 'atrium_bot',
      displayName: 'Atrium Бот',
      avatarColor: BOT_AVATAR,
    },
    text,
    createdAt,
  }
  for (const uid of channelMemberIds(channelId)) emitToUser(uid, 'message:new', { message })
  return message
}

// ---- report formatting ----

function hhmm(createdAt) {
  return new Date(createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function defaultText(item) {
  const emoji = EMOJI[item.action] || '📌'
  return `${emoji} ${item.details || item.action}`
}

// ---- 60s dedupe: first report now, «Вход: alex ×3 за минуту» summary after the window ----

const DEDUPE_MS = 60000
const recent = new Map() // `${adminId}|${action}|${subject}` -> {count, firstAt}

function reportTo(adminId, action, subject, text) {
  const key = `${adminId}|${action}|${subject}`
  const now = Date.now()
  const state = recent.get(key)
  if (state && now - state.firstAt < DEDUPE_MS) {
    state.count++ // duplicate inside the window: folded into the summary
    return
  }
  recent.set(key, { count: 1, firstAt: now })
  const dm = ensureBotDm(adminId)
  if (dm) botSendMessage(dm.id, text)

  const window = recent.get(key)
  setTimeout(() => {
    if (recent.get(key) === window) recent.delete(key)
    if (window.count > 1) {
      const label = SUMMARY_LABEL[action] || action
      const chan = ensureBotDm(adminId)
      if (chan) botSendMessage(chan.id, `${label}: ${subject} ×${window.count} за минуту`)
    }
  }, DEDUPE_MS).unref?.()
}

/** Called from logAudit() for every audit row. */
export function botOnAudit(item, { botText, botSubject } = {}) {
  const settings = getBotSettings()
  if (!settings.enabled) return
  if (!matchesBotEvent(settings.events, item.action)) return
  if (!ensureBotUser()) return

  const text = botText || defaultText(item)
  const subject =
    botSubject ||
    item.targetUser?.username ||
    item.actor?.username ||
    item.details ||
    item.action

  for (const adminId of superadminIds()) reportTo(adminId, item.action, subject, text)
}
