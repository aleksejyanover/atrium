import { Router } from 'express'
import {
  run,
  get,
  all,
  findUserById,
  findUserByUsername,
  findOrg,
  findMember,
  orgMembers,
  orgMemberIds,
  orgChannels,
  countOrgMembers,
  countOrgChannels,
  channelUnread,
  orgUnread,
  pendingDismissalUserIds,
  countPendingApplications,
  removeMemberFromOrg,
} from '../db.js'
import { requireAuth, requireOrgMember, requireRank, findOrgSafe } from '../auth.js'
import {
  newId,
  publicUser,
  publicOrg,
  publicChannel,
  signedFields,
  bad,
  conflict,
  forbidden,
  notFound,
  str,
  isValidRole,
  rankOf,
} from '../util.js'
import { canChangeRole, canRemoveMember, canInvite } from '../permissions.js'
import { buildContractText } from '../contract.js'
import { emitToOrg, emitToUser } from '../bus.js'
import { logActivity, phrases, activityDto } from '../activity.js'
import { logAudit } from '../audit.js'

const router = Router()
// auth only for /api/orgs/* paths (keeps unknown /api routes returning 404)
router.use('/orgs', requireAuth)

// ---------- helpers ----------

function memberDto(row) {
  return {
    user: publicUser({
      id: row.id,
      username: row.username,
      email: row.email,
      display_name: row.display_name,
      avatar_color: row.avatar_color,
      created_at: row.created_at,
    }),
    role: row.m_role,
    joinedAt: row.m_joined_at,
  }
}

function inviteDto(inviteRow) {
  const inviter = findUserById(inviteRow.inviter_id)
  const invitee = findUserById(inviteRow.invitee_id)
  return {
    id: inviteRow.id,
    orgId: inviteRow.org_id,
    invitee: { user: publicUser(invitee) },
    inviter: { user: publicUser(inviter) },
    role: inviteRow.role,
    status: inviteRow.status,
    createdAt: inviteRow.created_at,
    contractText: inviteRow.contract_text,
    ...signedFields(inviteRow),
  }
}

// ---------- Organizations ----------

// POST /api/orgs {name, description?, isPublic?} -> 201 {org, role:"owner"}
router.post('/orgs', (req, res, next) => {
  try {
    const body = req.body || {}
    const name = str(body.name)
    const description = str(body.description) ?? ''
    if (!name || name.length > 100) throw bad('Название организации обязательно (1–100 символов)')
    if (description.length > 500) throw bad('Описание: не более 500 символов')
    const isPublic = body.isPublic === undefined ? true : !!body.isPublic

    const orgId = newId('o')
    const createdAt = Date.now()
    const generalId = newId('c')

    run('INSERT INTO orgs (id, name, description, created_by, created_at, is_public) VALUES (?,?,?,?,?,?)',
      orgId, name, description, req.userId, createdAt, isPublic ? 1 : 0)
    run('INSERT INTO members (org_id, user_id, role, joined_at) VALUES (?,?,?,?)',
      orgId, req.userId, 'owner', createdAt)
    // default channel #general
    run("INSERT INTO channels (id, org_id, type, name, created_by, created_at) VALUES (?,?,'channel',?,?,?)",
      generalId, orgId, 'general', req.userId, createdAt)
    run('INSERT INTO channel_members (channel_id, user_id) VALUES (?,?)', generalId, req.userId)

    const org = publicOrg(findOrg(orgId), 1, 1)
    // SPEC v4 §23: global audit (org creation has no activity row of its own)
    logAudit({
      orgId,
      actorId: req.userId,
      action: 'org.create',
      details: `Создана организация «${name}»`,
      botText: `🏢 Организация: «${name}» создана`,
      botSubject: name,
    })
    res.status(201).json({ org, role: 'owner' })
  } catch (err) {
    next(err)
  }
})

// GET /api/orgs -> {orgs:[{...org, role, unread}]} (unread per SPEC v3 §18)
router.get('/orgs', (req, res, next) => {
  try {
    const rows = all(
      `SELECT o.*, m.role AS m_role FROM orgs o
       JOIN members m ON m.org_id = o.id
       WHERE m.user_id = ?
       ORDER BY o.created_at ASC`,
      req.userId
    )
    const orgs = rows.map((r) => ({
      ...publicOrg(r, countOrgMembers(r.id), countOrgChannels(r.id)),
      role: r.m_role,
      unread: orgUnread(r.id, req.userId),
    }))
    res.json({ orgs })
  } catch (err) {
    next(err)
  }
})

// GET /api/orgs/:id -> {org, role, members, channels} (member only)
// SPEC v2 §12: +pendingApplications (rank>=40, else 0), members[].dismissalPending (rank>=40)
// SPEC v3 §18: channels[].unread
router.get('/orgs/:id', requireOrgMember, (req, res, next) => {
  try {
    const org = publicOrg(req.org, countOrgMembers(req.org.id), countOrgChannels(req.org.id))
    const staff = req.rank >= 40
    const dismissals = staff ? new Set(pendingDismissalUserIds(req.org.id)) : new Set()
    const members = orgMembers(req.org.id).map((row) => {
      const dto = memberDto(row)
      if (dismissals.has(row.id)) dto.dismissalPending = true
      return dto
    })
    const channels = orgChannels(req.org.id).map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.created_at,
      unread: channelUnread(c.id, req.userId),
    }))
    res.json({
      org,
      role: req.member.role,
      members,
      channels,
      pendingApplications: staff ? countPendingApplications(req.org.id) : 0,
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/orgs/:id {name?, description?, isPublic?} -> {org} (rank >= 60)
router.patch('/orgs/:id', requireOrgMember, requireRank(60, 'Редактировать организацию может только админ'), (req, res, next) => {
  try {
    const body = req.body || {}
    const name = body.name !== undefined ? str(body.name) : undefined
    const description = body.description !== undefined ? str(body.description) : undefined
    const isPublic = body.isPublic !== undefined ? !!body.isPublic : undefined
    if (body.name !== undefined && (!name || name.length > 100)) throw bad('Название организации обязательно (1–100 символов)')
    if (description !== undefined && description.length > 500) throw bad('Описание: не более 500 символов')

    const parts = []
    if (name !== undefined) {
      run('UPDATE orgs SET name = ? WHERE id = ?', name, req.org.id)
      parts.push(`название организации на «${name}»`)
    }
    if (description !== undefined) {
      run('UPDATE orgs SET description = ? WHERE id = ?', description, req.org.id)
      parts.push('описание организации')
    }
    if (isPublic !== undefined) {
      run('UPDATE orgs SET is_public = ? WHERE id = ?', isPublic ? 1 : 0, req.org.id)
      parts.push(isPublic ? 'организацию сделал публичной' : 'организацию сделал приватной')
    }
    if (parts.length) {
      logActivity(req.org.id, 'org.updated', {
        actorId: req.userId,
        details: phrases.orgUpdated(req.userId, parts),
      })
    }

    const org = publicOrg(findOrg(req.org.id), countOrgMembers(req.org.id), countOrgChannels(req.org.id))
    res.json({ org })
  } catch (err) {
    next(err)
  }
})

// POST /api/orgs/:id/leave -> {ok:true} (owner cannot leave -> 409)
router.post('/orgs/:id/leave', requireOrgMember, (req, res, next) => {
  try {
    if (req.member.role === 'owner') throw conflict('Владелец не может покинуть организацию')
    removeMemberFromOrg(req.org.id, req.userId)
    emitToOrg(req.org.id, 'member:left', { orgId: req.org.id, userId: req.userId })
    logActivity(req.org.id, 'member.left', {
      actorId: req.userId,
      targetUserId: req.userId,
      details: phrases.memberLeft(req.userId),
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ---------- Members ----------

// PATCH /api/orgs/:id/members/:userId {role} -> {member:{user, role, joinedAt}}
router.patch('/orgs/:id/members/:userId', requireOrgMember, (req, res, next) => {
  try {
    const newRole = str(req.body?.role)
    if (!isValidRole(newRole)) throw bad('Недопустимая роль')

    const target = findMember(req.org.id, req.params.userId)
    if (!target) throw notFound('Участник не найден в этой организации')
    if (target.user_id === req.userId && newRole !== req.member.role) {
      // still allow per matrix (owner may transfer), but validate normally below
    }
    canChangeRole(req.member.role, target.role, newRole)

    run('UPDATE members SET role = ? WHERE org_id = ? AND user_id = ?', newRole, req.org.id, target.user_id)
    emitToOrg(req.org.id, 'role:changed', { orgId: req.org.id, userId: target.user_id, role: newRole })
    logActivity(req.org.id, 'role.changed', {
      actorId: req.userId,
      targetUserId: target.user_id,
      details: phrases.roleChanged(req.userId, target.user_id, target.role, newRole),
    })

    const row = get(
      `SELECT u.*, m.role AS m_role, m.joined_at AS m_joined_at
       FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = ? AND m.user_id = ?`,
      req.org.id,
      target.user_id
    )
    res.json({ member: memberDto(row) })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/orgs/:id/members/:userId -> {ok:true} (matrix rules; or self-leave)
router.delete('/orgs/:id/members/:userId', requireOrgMember, (req, res, next) => {
  try {
    const targetId = req.params.userId
    const isSelf = targetId === req.userId
    const target = findMember(req.org.id, targetId)
    if (!target) throw notFound('Участник не найден в этой организации')

    if (isSelf) {
      if (target.role === 'owner') throw conflict('Владелец не может покинуть организацию')
    } else {
      canRemoveMember(req.member.role, target.role)
    }

    removeMemberFromOrg(req.org.id, targetId)
    emitToOrg(req.org.id, 'member:left', { orgId: req.org.id, userId: targetId })
    logActivity(req.org.id, 'member.left', {
      actorId: req.userId,
      targetUserId: targetId,
      details: phrases.memberLeft(targetId),
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ---------- Org channels ----------

// GET /api/orgs/:id/channels -> {channels:[...]} (+ unread per SPEC v3 §18)
router.get('/orgs/:id/channels', requireOrgMember, (req, res, next) => {
  try {
    const channels = orgChannels(req.org.id).map((c) => ({
      ...publicChannel(c),
      unread: channelUnread(c.id, req.userId),
    }))
    res.json({ channels })
  } catch (err) {
    next(err)
  }
})

// POST /api/orgs/:id/channels {name} -> 201 {channel} (rank >= 40)
router.post('/orgs/:id/channels', requireOrgMember, requireRank(40, 'Создавать каналы может только помощник админа и выше'), (req, res, next) => {
  try {
    const name = str(req.body?.name)
    if (!name || name.length > 40) throw bad('Название канала обязательно (1–40 символов)')

    // case-insensitive (Unicode-aware) uniqueness per org
    const lower = name.toLowerCase()
    const duplicate = orgChannels(req.org.id).some((c) => (c.name || '').toLowerCase() === lower)
    if (duplicate) throw conflict('Канал с таким названием уже существует')

    const id = newId('c')
    const createdAt = Date.now()
    run("INSERT INTO channels (id, org_id, type, name, created_by, created_at) VALUES (?,?,'channel',?,?,?)",
      id, req.org.id, name, req.userId, createdAt)
    // all current org members are channel members
    const members = orgMemberIds(req.org.id)
    const insertMember = (cid, uid) => run('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?,?)', cid, uid)
    for (const uid of members) insertMember(id, uid)

    const channel = publicChannel(findChannelRow(id))
    emitToOrg(req.org.id, 'channel:created', { orgId: req.org.id, channel })
    logActivity(req.org.id, 'channel.created', {
      actorId: req.userId,
      details: phrases.channelCreated(req.userId, name),
    })
    res.status(201).json({ channel })
  } catch (err) {
    next(err)
  }
})

function findChannelRow(id) {
  return get('SELECT * FROM channels WHERE id = ?', id)
}

// ---------- Org invites ----------

// POST /api/orgs/:id/invite {usernameOrEmail, role} -> 201 {invite}
router.post('/orgs/:id/invite', requireOrgMember, (req, res, next) => {
  try {
    if (!canInvite(req.rank)) throw forbidden('Приглашать участников может только помощник админа и выше')

    const usernameOrEmail = str(req.body?.usernameOrEmail)
    const role = str(req.body?.role)
    if (!usernameOrEmail) throw bad('Укажите имя пользователя или email')
    if (!isValidRole(role)) throw bad('Недопустимая роль')

    // role must be rank < actor.rank (owner exception: any except owner)
    if (req.member.role === 'owner') {
      if (role === 'owner') throw bad('Нельзя пригласить роль владельца')
    } else {
      if (rankOf(role) >= req.rank) throw bad('Можно приглашать только с ролью ниже вашей')
    }

    const target =
      findUserByUsername(usernameOrEmail) ||
      (usernameOrEmail.includes('@') ? get('SELECT * FROM users WHERE email = ?', usernameOrEmail.toLowerCase()) : null)
    if (!target) throw notFound('Пользователь не найден')

    if (findMember(req.org.id, target.id)) throw conflict('Этот пользователь уже является участником организации')

    const pending = get(
      "SELECT id FROM invites WHERE org_id = ? AND invitee_id = ? AND status = 'pending'",
      req.org.id,
      target.id
    )
    if (pending) throw conflict('Для этого пользователя уже есть ожидающее приглашение')

    const id = newId('i')
    const createdAt = Date.now()
    const contractText = buildContractText({ orgName: req.org.name, role, createdAt })

    run(
      `INSERT INTO invites (id, org_id, inviter_id, invitee_id, role, status, contract_text, signature, signed_name, signed_at, created_at)
       VALUES (?,?,?,?,?,'pending',?,NULL,NULL,NULL,?)`,
      id, req.org.id, req.userId, target.id, role, contractText, createdAt
    )

    const row = get('SELECT * FROM invites WHERE id = ?', id)
    const invite = inviteDto(row)
    const inviterUser = publicUser(findUserById(req.userId))
    const orgPublic = { id: req.org.id, name: req.org.name }

    // notify invitee sockets: `inviter` mirrors GET /api/invites (`{user}`)
    // and also spreads user fields so both access styles work
    emitToUser(target.id, 'invite:new', {
      invite,
      org: orgPublic,
      inviter: { ...inviterUser, user: inviterUser },
    })
    logActivity(req.org.id, 'invite.created', {
      actorId: req.userId,
      targetUserId: target.id,
      details: phrases.inviteCreated(req.userId, target.id),
    })

    res.status(201).json({ invite })
  } catch (err) {
    next(err)
  }
})

// GET /api/orgs/:id/invites -> {invites:[invite...]} (rank >= 40)
router.get('/orgs/:id/invites', requireOrgMember, requireRank(40, 'Просмотр приглашений доступен только помощнику админа и выше'), (req, res, next) => {
  try {
    const rows = all(
      "SELECT * FROM invites WHERE org_id = ? AND status = 'pending' ORDER BY created_at DESC",
      req.org.id
    )
    res.json({ invites: rows.map(inviteDto) })
  } catch (err) {
    next(err)
  }
})

// ---------- Activity log (SPEC v3 §18) ----------

// GET /api/orgs/:id/activity?before=<id>&limit=50 -> {activity, hasMore} (any member)
router.get('/orgs/:id/activity', requireOrgMember, (req, res, next) => {
  try {
    let limit = Number.parseInt(req.query.limit, 10)
    if (!Number.isFinite(limit) || limit < 1) limit = 50
    if (limit > 100) limit = 100
    const before = typeof req.query.before === 'string' && req.query.before ? req.query.before : null

    let rows
    if (before) {
      const anchor = get('SELECT rowid AS rid, * FROM activity WHERE id = ? AND org_id = ?', before, req.org.id)
      if (!anchor) throw notFound('Запись истории не найдена')
      rows = all(
        `SELECT * FROM activity
         WHERE org_id = ? AND (created_at < ? OR (created_at = ? AND rowid < ?))
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
        req.org.id, anchor.created_at, anchor.created_at, anchor.rid, limit + 1
      )
    } else {
      rows = all(
        'SELECT * FROM activity WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
        req.org.id, limit + 1
      )
    }

    const hasMore = rows.length > limit
    const page = (hasMore ? rows.slice(0, limit) : rows).reverse()
    const activity = page.map((row) =>
      activityDto(
        row,
        row.actor_id ? findUserById(row.actor_id) : null,
        row.target_user_id ? findUserById(row.target_user_id) : null
      )
    )
    res.json({ activity, hasMore })
  } catch (err) {
    next(err)
  }
})

export { inviteDto, memberDto, findChannelRow }
export default router
