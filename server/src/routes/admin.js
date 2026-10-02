import { Router } from 'express'
import { run, get, all, findUserById } from '../db.js'
import { requireAuth, requireAdmin } from '../auth.js'
import { auditDto, logAudit } from '../audit.js'
import { getBotSettings, setBotSettings, BOT_EVENTS } from '../bot.js'
import { onlineCount, disconnectUserSockets } from '../sockets.js'
import { emitToUser } from '../bus.js'
import { publicUser, bad, conflict, notFound, str } from '../util.js'

const router = Router()
// SPEC v4 §23: every /api/admin/* route requires auth + superadmin, else 403 «Доступ запрещён»
router.use('/admin', requireAuth, requireAdmin)

const DAY = 86400000

// GET /api/admin/stats -> {...} (SPEC v4 §23)
router.get('/admin/stats', (req, res, next) => {
  try {
    const now = Date.now()
    const dayAgo = now - DAY
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const todayStart = today.getTime()

    const count = (sql, ...params) => get(sql, ...params).c

    const stats = {
      users: count('SELECT COUNT(*) AS c FROM users'),
      usersToday: count('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', todayStart),
      usersActive24h: get(
        `SELECT COUNT(DISTINCT uid) AS c FROM (
           SELECT actor_id AS uid FROM audit_log WHERE created_at >= ? AND actor_id IS NOT NULL
           UNION SELECT sender_id FROM messages WHERE created_at >= ?
           UNION SELECT user_id FROM login_log WHERE created_at >= ? AND success = 1)`,
        dayAgo, dayAgo, dayAgo
      ).c,
      orgs: count('SELECT COUNT(*) AS c FROM orgs'),
      orgsPublic: count('SELECT COUNT(*) AS c FROM orgs WHERE is_public = 1'),
      members: count('SELECT COUNT(*) AS c FROM members'),
      messages: count('SELECT COUNT(*) AS c FROM messages'),
      messages24h: count('SELECT COUNT(*) AS c FROM messages WHERE created_at >= ?', dayAgo),
      invitesPending: count("SELECT COUNT(*) AS c FROM invites WHERE status = 'pending'"),
      // counted from audit call-* rows when present, otherwise 0 (per §23)
      callsToday: count("SELECT COUNT(*) AS c FROM audit_log WHERE action LIKE 'call.%' AND created_at >= ?", todayStart),
      onlineNow: onlineCount(),
      totalBalance: get('SELECT COALESCE(SUM(balance), 0) AS c FROM users').c,
      paidTotal: get("SELECT COALESCE(SUM(amount), 0) AS c FROM payments WHERE kind = 'salary'").c,
    }
    res.json(stats)
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/audit?before=&limit=&action=&q= -> {items, hasMore} (global, §23)
router.get('/admin/audit', (req, res, next) => {
  try {
    let limit = Number.parseInt(req.query.limit, 10)
    if (!Number.isFinite(limit) || limit < 1) limit = 50
    if (limit > 100) limit = 100
    const before = typeof req.query.before === 'string' && req.query.before ? req.query.before : null
    const action = typeof req.query.action === 'string' && req.query.action ? req.query.action : null
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''

    // newest first; `action` matches exactly or as a prefix ('application' → 'application.*')
    const where = action ? 'WHERE action = ? OR action LIKE ?' : ''
    const params = action ? [action, `${action}.%`] : []
    let rows = all(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC, rowid DESC`, ...params)
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.details || '').toLowerCase().includes(q) ||
          (r.action || '').toLowerCase().includes(q)
      )
    }

    let start = 0
    if (before) {
      const idx = rows.findIndex((r) => r.id === before)
      start = idx >= 0 ? idx + 1 : 0
    }
    const page = rows.slice(start, start + limit)
    const hasMore = rows.length > start + limit
    res.json({ items: page.map(auditDto), hasMore })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/logins?limit=50 -> {items} (§23)
router.get('/admin/logins', (req, res, next) => {
  try {
    let limit = Number.parseInt(req.query.limit, 10)
    if (!Number.isFinite(limit) || limit < 1) limit = 50
    if (limit > 200) limit = 200
    const rows = all('SELECT * FROM login_log ORDER BY created_at DESC, rowid DESC LIMIT ?', limit)
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        user: r.user_id ? publicUser(findUserById(r.user_id)) : null,
        success: !!r.success,
        ip: r.ip ?? null,
        userAgent: r.user_agent ?? null,
        createdAt: r.created_at,
      })),
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/users?query=&limit=30 -> {items} (§23)
router.get('/admin/users', (req, res, next) => {
  try {
    let limit = Number.parseInt(req.query.limit, 10)
    if (!Number.isFinite(limit) || limit < 1) limit = 30
    if (limit > 100) limit = 100
    const query = typeof req.query.query === 'string' ? req.query.query.trim().toLowerCase() : ''

    let rows = all('SELECT * FROM users ORDER BY created_at DESC')
    if (query) {
      rows = rows.filter(
        (r) =>
          r.username.toLowerCase().includes(query) ||
          (r.display_name || '').toLowerCase().includes(query) ||
          (r.email || '').toLowerCase().includes(query)
      )
    }
    rows = rows.slice(0, limit)
    res.json({
      items: rows.map((r) => ({
        ...publicUser(r),
        banned: !!r.banned,
        banReason: r.ban_reason ?? null, // SPEC v8 §35
        banByName: r.ban_by_name ?? null, // SPEC v8 §35
        lastLoginAt: r.last_login_at ?? null,
        orgsCount: get('SELECT COUNT(*) AS c FROM members WHERE user_id = ?', r.id).c,
        balance: r.balance ?? 0,
      })),
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/users/:id/ban -> {ok:true, banned:true} (§23 + SPEC v8 §35)
router.post('/admin/users/:id/ban', (req, res, next) => {
  try {
    const target = findUserById(req.params.id)
    if (!target) throw notFound('Пользователь не найден')
    if (target.id === req.userId) throw bad('Нельзя заблокировать собственный аккаунт')
    // SPEC v5 §29: card owners are protected from bans
    if (target.is_owner) throw conflict('Владельца нельзя заблокировать')

    // SPEC v8 §35: {reason} is mandatory — trim, 1..500 chars, else 400 (ban NOT set)
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
    if (!reason || reason.length > 500) throw bad('Укажите причину блокировки')

    const actor = findUserById(req.userId)
    const byName = (actor && (actor.display_name || actor.username)) || 'Администратор'

    run(
      'UPDATE users SET banned = 1, ban_reason = ?, ban_by_name = ? WHERE id = ?',
      reason, byName, target.id
    )

    // SPEC v8 §35: notify the victim BEFORE her sockets are dropped
    emitToUser(target.id, 'user:banned', { byName, reason })
    const dropped = disconnectUserSockets(target.id) // active sockets off immediately

    logAudit({
      actorId: req.userId,
      targetUserId: target.id,
      action: 'user.ban',
      details: `🚫 ${byName} заблокировал(а) ${target.display_name} (@${target.username}). Причина: ${reason}`,
      botText: `⛔ Блокировка: ${byName} заблокировал(а) ${target.display_name} (@${target.username}). Причина: ${reason}`,
      botSubject: target.username,
    })
    res.json({ ok: true, banned: true, disconnected: dropped })
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/users/:id/unban -> {ok:true, banned:false} (§23 + SPEC v8 §35: reason cleared)
router.post('/admin/users/:id/unban', (req, res, next) => {
  try {
    const target = findUserById(req.params.id)
    if (!target) throw notFound('Пользователь не найден')

    run('UPDATE users SET banned = 0, ban_reason = NULL, ban_by_name = NULL WHERE id = ?', target.id)
    logAudit({
      actorId: req.userId,
      targetUserId: target.id,
      action: 'user.unban',
      details: `Разблокировка пользователя: ${target.display_name} (@${target.username})`,
      botSubject: target.username,
    })
    res.json({ ok: true, banned: false })
  } catch (err) {
    next(err)
  }
})

// ---------- bot settings (§23) ----------

const EVENT_NAME_RE = /^(\*|[a-z_]+(\.[a-z_*]+)+)$/

// GET /api/admin/bot -> {enabled, events, catalog}
router.get('/admin/bot', (req, res) => {
  const settings = getBotSettings()
  res.json({ enabled: settings.enabled, events: settings.events, catalog: BOT_EVENTS })
})

// PUT /api/admin/bot {enabled?, events?} -> {enabled, events, catalog}
router.put('/admin/bot', (req, res, next) => {
  try {
    const body = req.body || {}
    let events
    if (body.events !== undefined) {
      if (!Array.isArray(body.events)) throw bad('events должен быть массивом')
      events = body.events.map((e) => {
        const name = str(e)
        if (!name || !EVENT_NAME_RE.test(name)) throw bad(`Некорректное событие: ${JSON.stringify(e)}`)
        return name
      })
    }
    const settings = setBotSettings({ enabled: body.enabled, events })
    res.json({ enabled: settings.enabled, events: settings.events, catalog: BOT_EVENTS })
  } catch (err) {
    next(err)
  }
})

export default router
