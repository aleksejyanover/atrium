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
} from '../db.js'
import { requireAuth, requireOrgMember, requireRank, findOrgSafe } from '../auth.js'
import {
  newId,
  publicUser,
  publicOrg,
  publicChannel,
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
  }
}

// ---------- Organizations ----------

// POST /api/orgs {name, description?} -> 201 {org, role:"owner"}
router.post('/orgs', (req, res, next) => {
  try {
    const body = req.body || {}
    const name = str(body.name)
    const description = str(body.description) ?? ''
    if (!name || name.length > 100) throw bad('Название организации обязательно (1–100 символов)')
    if (description.length > 500) throw bad('Описание: не более 500 символов')

    const orgId = newId('o')
    const createdAt = Date.now()
    const generalId = newId('c')

    run('INSERT INTO orgs (id, name, description, created_by, created_at) VALUES (?,?,?,?,?)',
      orgId, name, description, req.userId, createdAt)
    run('INSERT INTO members (org_id, user_id, role, joined_at) VALUES (?,?,?,?)',
      orgId, req.userId, 'owner', createdAt)
    // default channel #general
    run("INSERT INTO channels (id, org_id, type, name, created_by, created_at) VALUES (?,?,'channel',?,?,?)",
      generalId, orgId, 'general', req.userId, createdAt)
    run('INSERT INTO channel_members (channel_id, user_id) VALUES (?,?)', generalId, req.userId)

    const org = publicOrg(findOrg(orgId), 1, 1)
    res.status(201).json({ org, role: 'owner' })
  } catch (err) {
    next(err)
  }
})

// GET /api/orgs -> {orgs:[{...org, role, unread:0}]}
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
      unread: 0,
    }))
    res.json({ orgs })
  } catch (err) {
    next(err)
  }
})

// GET /api/orgs/:id -> {org, role, members, channels} (member only)
router.get('/orgs/:id', requireOrgMember, (req, res, next) => {
  try {
    const org = publicOrg(req.org, countOrgMembers(req.org.id), countOrgChannels(req.org.id))
    const members = orgMembers(req.org.id).map(memberDto)
    const channels = orgChannels(req.org.id).map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.created_at,
    }))
    res.json({ org, role: req.member.role, members, channels })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/orgs/:id {name?, description?} -> {org} (rank >= 60)
router.patch('/orgs/:id', requireOrgMember, requireRank(60, 'Редактировать организацию может только админ'), (req, res, next) => {
  try {
    const body = req.body || {}
    const name = body.name !== undefined ? str(body.name) : undefined
    const description = body.description !== undefined ? str(body.description) : undefined
    if (body.name !== undefined && (!name || name.length > 100)) throw bad('Название организации обязательно (1–100 символов)')
    if (description !== undefined && description.length > 500) throw bad('Описание: не более 500 символов')

    if (name !== undefined) run('UPDATE orgs SET name = ? WHERE id = ?', name, req.org.id)
    if (description !== undefined) run('UPDATE orgs SET description = ? WHERE id = ?', description, req.org.id)

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
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/** Delete membership + remove from all channel_members of org's channels. */
function removeMemberFromOrg(orgId, userId) {
  run('DELETE FROM members WHERE org_id = ? AND user_id = ?', orgId, userId)
  run(
    `DELETE FROM channel_members
     WHERE user_id = ?
       AND channel_id IN (SELECT id FROM channels WHERE org_id = ?)`,
    userId,
    orgId
  )
}

// ---------- Org channels ----------

// GET /api/orgs/:id/channels -> {channels:[...]}
router.get('/orgs/:id/channels', requireOrgMember, (req, res, next) => {
  try {
    res.json({ channels: orgChannels(req.org.id).map(publicChannel) })
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

export { inviteDto, memberDto, findChannelRow }
export default router
