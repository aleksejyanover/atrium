/**
 * Organization activity log (SPEC v3 §18).
 * `details` is a ready-made human-readable Russian phrase built on the server.
 * logActivity() inserts the row and emits `activity:new` to all org members.
 */
import { run, get, findUserById } from './db.js'
import { newId, publicUser, roleLabel, rankOf } from './util.js'
import { emitToOrg } from './bus.js'
import { logAudit } from './audit.js'

// ---- Russian phrase helpers ----

const nameOf = (id) => (id ? findUserById(id)?.display_name || 'Пользователь' : 'Система')

/**
 * Rough accusative for Russian personal names:
 * Иван → Ивана, Алексей → Алексея, Алиса → Алису, Мария → Марию.
 * Non-standard names (latin, digits, punctuation) are left as-is.
 */
function accusative(name) {
  return String(name || '')
    .split(/\s+/)
    .map((w) => {
      if (!/^[А-ЯЁ][а-яё]+$/.test(w)) return w
      if (/ия$/.test(w)) return `${w.slice(0, -1)}ю` // Мария → Марию
      if (/а$/.test(w)) return `${w.slice(0, -1)}у` // Анна → Анну
      if (/я$/.test(w)) return `${w.slice(0, -1)}ю` // Наталья → Наталью
      if (/й$/.test(w)) return `${w.slice(0, -1)}я` // Алексей → Алексея
      if (/ь$/.test(w)) return `${w.slice(0, -1)}я` // Игорь → Игоря
      if (/[бвгджзклмнпрстфхцчшщ]$/.test(w)) return `${w}а` // Иван → Ивана
      return w
    })
    .join(' ')
}

export const phrases = {
  inviteCreated: (actorId, targetId) =>
    `${nameOf(actorId)} пригласил(а) ${accusative(nameOf(targetId))} в организацию`,
  inviteAccepted: (targetId, role) =>
    `${nameOf(targetId)} подписал(а) договор о вступлении (роль: ${roleLabel(role)})`,
  inviteDeclined: (targetId) =>
    `${nameOf(targetId)} отклонил(а) приглашение в организацию`,
  inviteCanceled: (actorId, targetId) =>
    `${nameOf(actorId)} отменил(а) приглашение пользователя ${nameOf(targetId)}`,

  applicationSubmitted: (actorId) =>
    `${nameOf(actorId)} подал(а) заявление на вступление в организацию`,
  applicationApproved: (actorId, targetId) =>
    `${nameOf(actorId)} принял(а) заявление пользователя ${nameOf(targetId)}`,
  applicationRejected: (actorId, targetId) =>
    `${nameOf(actorId)} отклонил(а) заявление пользователя ${nameOf(targetId)}`,
  applicationCanceled: (actorId) =>
    `${nameOf(actorId)} отозвал(а) заявление на вступление`,

  dismissalCreated: (actorId, targetId) =>
    `${nameOf(actorId)} отправил(а) сотруднику ${nameOf(targetId)} договор об увольнении`,
  dismissalSigned: (targetId) =>
    `${nameOf(targetId)} подписал(а) договор об увольнении`,
  dismissalRejected: (targetId) =>
    `${nameOf(targetId)} оспорил(а) договор об увольнении`,
  dismissalCanceled: (actorId, targetId) =>
    `${nameOf(actorId)} отменил(а) договор об увольнении для сотрудника ${nameOf(targetId)}`,
  dismissalTerminated: (actorId, targetId) =>
    `${nameOf(actorId)} уволил(а) ${accusative(nameOf(targetId))} в одностороннем порядке`,

  memberJoined: (targetId) => `${nameOf(targetId)} вступил(а) в организацию`,
  memberLeft: (targetId) => `${nameOf(targetId)} покинул(а) организацию`,
  roleChanged: (actorId, targetId, oldRole, newRole) => {
    const who = accusative(nameOf(targetId))
    if (rankOf(newRole) > rankOf(oldRole)) {
      return `${nameOf(actorId)} повысил(а) ${who} до роли «${roleLabel(newRole)}»`
    }
    if (rankOf(newRole) < rankOf(oldRole)) {
      return `${nameOf(actorId)} понизил(а) ${who} до роли «${roleLabel(newRole)}»`
    }
    return `${nameOf(actorId)} изменил(а) роль ${nameOf(targetId)} на «${roleLabel(newRole)}»`
  },
  channelCreated: (actorId, channelName) =>
    `${nameOf(actorId)} создал(а) канал #${channelName}`,
  orgUpdated: (actorId, parts) =>
    `${nameOf(actorId)} обновил(а) организацию${parts?.length ? `: ${parts.join(', ')}` : ''}`,
  messageDeleted: (actorId, where) =>
    `${nameOf(actorId)} удалил(а) сообщение в ${where}`,
}

// ---- storage ----

export function activityDto(row, actor, targetUser) {
  return {
    id: row.id,
    action: row.action,
    details: row.details,
    actor: actor ? publicUser(actor) : null,
    targetUser: targetUser ? publicUser(targetUser) : null,
    createdAt: row.created_at,
  }
}

/** Insert an activity row and broadcast `activity:new` to org members. */
export function logActivity(orgId, action, { actorId = null, targetUserId = null, details, botText, botSubject }) {
  const id = newId('a')
  const createdAt = Date.now()
  run(
    'INSERT INTO activity (id, org_id, actor_id, action, target_user_id, details, created_at) VALUES (?,?,?,?,?,?,?)',
    id,
    orgId,
    actorId,
    action,
    targetUserId,
    details ?? '',
    createdAt
  )
  const row = get('SELECT * FROM activity WHERE id = ?', id)
  const dto = activityDto(
    row,
    actorId ? findUserById(actorId) : null,
    targetUserId ? findUserById(targetUserId) : null
  )
  emitToOrg(orgId, 'activity:new', { activity: dto })
  // SPEC v4 §23: the same handler also writes the global audit journal
  logAudit({ orgId, actorId, action, targetUserId, details: details ?? '', botText, botSubject })
  return dto
}
