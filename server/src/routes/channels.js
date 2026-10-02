import { Router } from 'express'
import {
  run,
  get,
  all,
  findUserById,
  findOrg,
  findMember,
  isChannelMember,
  channelMemberIds,
  channelUnread,
  channelReads,
  touchChannelRead,
} from '../db.js'
import { requireAuth } from '../auth.js'
import { requireChannelAccess } from '../access.js'
import {
  newId,
  publicUser,
  publicChannel,
  bad,
  conflict,
  forbidden,
  notFound,
  str,
  rankOf,
} from '../util.js'
import { canDeleteAnyMessage } from '../permissions.js'
import { logActivity, phrases } from '../activity.js'

const router = Router()
router.use(['/dms', '/channels', '/messages'], requireAuth)

function userSafe(id) {
  const row = findUserById(id)
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
  }
}

// ---------- DMs ----------

// GET /api/dms -> {dms:[{channel, peer:user, org:{id,name}, unread}]}
router.get('/dms', (req, res, next) => {
  try {
    const rows = all(
      `SELECT c.* FROM channels c
       JOIN channel_members cm ON cm.channel_id = c.id
       WHERE c.type = 'dm' AND cm.user_id = ?
       ORDER BY c.created_at DESC`,
      req.userId
    )
    const dms = rows.map((c) => {
      const peers = channelMemberIds(c.id).filter((id) => id !== req.userId)
      const org = findOrg(c.org_id)
      return {
        channel: publicChannel(c),
        peer: userSafe(peers[0]),
        org: org ? { id: org.id, name: org.name } : null,
        unread: channelUnread(c.id, req.userId),
      }
    })
    res.json({ dms })
  } catch (err) {
    next(err)
  }
})

// POST /api/dms {orgId, userId} -> {channel, peer} — find-or-create DM inside orgId
router.post('/dms', (req, res, next) => {
  try {
    const orgId = str(req.body?.orgId)
    const userId = str(req.body?.userId)
    if (!orgId || !userId) throw bad('Укажите организацию и пользователя')
    if (userId === req.userId) throw bad('Нельзя создать диалог с самим собой')

    const org = findOrg(orgId)
    if (!org) throw notFound('Организация не найдена')
    if (!findMember(orgId, req.userId)) throw forbidden('Вы не являетесь участником этой организации')
    const target = findUserById(userId)
    if (!target) throw notFound('Пользователь не найден')
    if (!findMember(orgId, userId)) throw forbidden('Пользователь не является участником этой организации')

    // find existing dm between the two inside this org
    const existing = all(
      `SELECT c.id FROM channels c
       WHERE c.type = 'dm' AND c.org_id = ? AND c.id IN (
         SELECT channel_id FROM channel_members WHERE user_id = ?
       ) AND c.id IN (
         SELECT channel_id FROM channel_members WHERE user_id = ?
       )`,
      orgId, req.userId, userId
    )
    for (const row of existing) {
      const members = channelMemberIds(row.id)
      if (members.length === 2 && members.includes(req.userId) && members.includes(userId)) {
        const c = get('SELECT * FROM channels WHERE id = ?', row.id)
        return res.json({ channel: publicChannel(c), peer: userSafe(userId) })
      }
    }

    const id = newId('c')
    const createdAt = Date.now()
    run("INSERT INTO channels (id, org_id, type, name, created_by, created_at) VALUES (?,?,'dm',NULL,?,?)",
      id, orgId, req.userId, createdAt)
    run('INSERT INTO channel_members (channel_id, user_id) VALUES (?,?)', id, req.userId)
    run('INSERT INTO channel_members (channel_id, user_id) VALUES (?,?)', id, userId)

    const c = get('SELECT * FROM channels WHERE id = ?', id)
    // spec does not mark this endpoint 201; find-or-create returns 200 either way
    res.json({ channel: publicChannel(c), peer: userSafe(userId) })
  } catch (err) {
    next(err)
  }
})

// ---------- Channel detail & messages ----------

// GET /api/channels/:id -> {channel, org:{id,name}, peer?}
router.get('/channels/:id', (req, res, next) => {
  try {
    const { channel, org } = requireChannelAccess(req.params.id, req.userId)
    const payload = { channel: publicChannel(channel), org: org ? { id: org.id, name: org.name } : null }
    if (channel.type === 'dm') {
      const peerId = channelMemberIds(channel.id).find((id) => id !== req.userId)
      payload.peer = userSafe(peerId)
    }
    res.json(payload)
  } catch (err) {
    next(err)
  }
})

// GET /api/channels/:id/messages?before=<messageId>&limit=50 -> {messages, hasMore}
router.get('/channels/:id/messages', (req, res, next) => {
  try {
    const { channel } = requireChannelAccess(req.params.id, req.userId)

    let limit = Number.parseInt(req.query.limit, 10)
    if (!Number.isFinite(limit) || limit < 1) limit = 50
    if (limit > 100) limit = 100

    const before = typeof req.query.before === 'string' && req.query.before ? req.query.before : null

    const toMsg = (row) => {
      const s = findUserById(row.sender_id)
      return {
        id: row.id,
        channelId: row.channel_id,
        sender: s
          ? { id: s.id, username: s.username, displayName: s.display_name, avatarColor: s.avatar_color }
          : { id: row.sender_id, username: '', displayName: '', avatarColor: '#8B8B94' },
        text: row.text,
        createdAt: row.created_at,
      }
    }

    let rows
    if (before) {
      const anchor = get('SELECT rowid AS rid, * FROM messages WHERE id = ? AND channel_id = ?', before, channel.id)
      if (!anchor) throw notFound('Сообщение не найдено')
      rows = all(
        `SELECT * FROM messages
         WHERE channel_id = ? AND (created_at < ? OR (created_at = ? AND rowid < ?))
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
        channel.id, anchor.created_at, anchor.created_at, anchor.rid, limit + 1
      )
    } else {
      rows = all(
        'SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
        channel.id, limit + 1
      )
    }

    const hasMore = rows.length > limit
    const page = (hasMore ? rows.slice(0, limit) : rows).reverse()
    res.json({ messages: page.map(toMsg), hasMore })
  } catch (err) {
    next(err)
  }
})

// ---------- Read receipts (SPEC v3 §18) ----------

// POST /api/channels/:id/read {at?} -> {ok:true} — last_read_at = max(current, at)
router.post('/channels/:id/read', (req, res, next) => {
  try {
    const { channel } = requireChannelAccess(req.params.id, req.userId)
    const body = req.body || {}
    let at = Date.now()
    if (body.at !== undefined) {
      at = Number(body.at)
      if (!Number.isFinite(at) || at <= 0) throw bad('Некорректное время прочтения')
    }
    touchChannelRead(channel.id, req.userId, at)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// GET /api/channels/:id/read-status -> {reads:[{userId, lastReadAt}]} (all participants)
router.get('/channels/:id/read-status', (req, res, next) => {
  try {
    const { channel } = requireChannelAccess(req.params.id, req.userId)
    res.json({ reads: channelReads(channel.id) })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/messages/:id -> {ok:true} (author or rank >= 40 — SPEC v3 §19)
router.delete('/messages/:id', (req, res, next) => {
  try {
    const msg = get('SELECT * FROM messages WHERE id = ?', req.params.id)
    if (!msg) throw notFound('Сообщение не найдено')
    const channel = get('SELECT * FROM channels WHERE id = ?', msg.channel_id)
    if (!channel) throw notFound('Канал не найден')

    const member = findMember(channel.org_id, req.userId)
    if (!member) throw forbidden('У вас нет доступа к этому каналу')
    // author, or rank >= 40 (assistant_admin and above, SPEC v3 §19)
    if (msg.sender_id !== req.userId && !canDeleteAnyMessage(rankOf(member.role))) {
      throw forbidden('Удалить это сообщение может только его автор или помощник админа и выше')
    }

    run('DELETE FROM messages WHERE id = ?', msg.id)

    // SPEC v3 §18: log only staff deletions of other people's messages
    if (msg.sender_id !== req.userId && rankOf(member.role) >= 40) {
      const where = channel.type === 'channel' ? `в #${channel.name || 'канал'}` : 'в личной переписке'
      logActivity(channel.org_id, 'message.deleted', {
        actorId: req.userId,
        targetUserId: msg.sender_id,
        details: phrases.messageDeleted(req.userId, where),
      })
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
