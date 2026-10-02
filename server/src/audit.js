/**
 * Global audit journal (SPEC v4 §23).
 * logAudit() inserts into audit_log, emits `admin:event` to superadmin sockets
 * only, and forwards the event to the Atrium Bot (deduped DM report).
 *
 * Request ip / user-agent come from an AsyncLocalStorage context installed by
 * index.js before the routers, so every handler (and logActivity() below) can
 * record them without threading `req` through all call sites.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { run, get, findUserById, findOrg, superadminIds } from './db.js'
import { newId, publicUser } from './util.js'
import { emitToUser } from './bus.js'
import { botOnAudit } from './bot.js'

const requestContext = new AsyncLocalStorage()

/** index.js: run the whole request pipeline with {ip, userAgent} in context. */
export function runWithContext(ctx, fn) {
  return requestContext.run(ctx, fn)
}

/** {ip, userAgent} of the current request (null outside HTTP, e.g. in tests). */
export function requestInfo() {
  const store = requestContext.getStore() || {}
  return { ip: store.ip ?? null, userAgent: store.userAgent ?? null }
}

/** audit_log row → API shape used by GET /api/admin/audit and `admin:event`. */
export function auditDto(row) {
  const org = row.org_id ? findOrg(row.org_id) : null
  return {
    id: row.id,
    action: row.action,
    details: row.details || '',
    actor: row.actor_id ? publicUser(findUserById(row.actor_id)) : null,
    targetUser: row.target_user_id ? publicUser(findUserById(row.target_user_id)) : null,
    orgName: org ? org.name : null,
    ip: row.ip ?? null,
    userAgent: row.user_agent ?? null,
    createdAt: row.created_at,
  }
}

/**
 * Insert an audit row + notify superadmins (live `admin:event` + bot report).
 * Called alongside activity logging from the same handlers, plus auth/wallet events.
 */
export function logAudit({
  orgId = null,
  actorId = null,
  action,
  targetUserId = null,
  details = '',
  ip,
  userAgent,
  botText,
  botSubject,
}) {
  const info = requestInfo()
  const id = newId('au')
  const createdAt = Date.now()
  run(
    `INSERT INTO audit_log (id, org_id, actor_id, action, target_user_id, details, ip, user_agent, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id,
    orgId,
    actorId,
    action,
    targetUserId,
    details || '',
    ip !== undefined ? ip : info.ip,
    userAgent !== undefined ? userAgent : info.userAgent,
    createdAt
  )
  const row = get('SELECT * FROM audit_log WHERE id = ?', id)
  const dto = auditDto(row)

  for (const adminId of superadminIds()) emitToUser(adminId, 'admin:event', { item: dto })
  botOnAudit(dto, { botText, botSubject })
  return dto
}
