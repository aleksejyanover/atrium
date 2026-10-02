import { Router } from 'express'
import { run, get, all, findUserById, findOrg, findMember } from '../db.js'
import { requireAuth } from '../auth.js'
import {
  conflict,
  forbidden,
  notFound,
  publicUser,
  contractSignature,
  requireSignedName,
} from '../util.js'
import { canCancelInvite } from '../permissions.js'
import { emitToOrg } from '../bus.js'
import { logActivity, phrases } from '../activity.js'
import { inviteDto } from './orgs.js'

const router = Router()
router.use('/invites', requireAuth)

// GET /api/invites -> {invites:[ {invite, org:{id,name}, inviter:{user}, role, contractText, createdAt} ]}
router.get('/invites', (req, res, next) => {
  try {
    const rows = all(
      "SELECT * FROM invites WHERE invitee_id = ? AND status = 'pending' ORDER BY created_at DESC",
      req.userId
    )
    const invites = rows.map((row) => ({
      invite: inviteDto(row),
      org: (() => {
        const o = findOrg(row.org_id)
        return o ? { id: o.id, name: o.name } : null
      })(),
      inviter: { user: publicUserSafe(row.inviter_id) },
      role: row.role,
      contractText: row.contract_text,
      createdAt: row.created_at,
    }))
    res.json({ invites })
  } catch (err) {
    next(err)
  }
})

function publicUserSafe(id) {
  const row = findUserById(id)
  return row ? publicUser(row) : null
}

// POST /api/invites/:id/accept {signatureDataUrl | signatureText, signedName} -> {org, role}
// SPEC v2.1 §17: EITHER a drawn image (data:image/...) OR a typed signatureText is accepted.
router.post('/invites/:id/accept', (req, res, next) => {
  try {
    const invite = requireInvite(req.params.id)
    if (invite.invitee_id !== req.userId) throw forbidden('Приглашение адресовано другому пользователю')
    if (invite.status !== 'pending') throw conflict('Приглашение уже неактивно')

    const sig = contractSignature(req.body)
    const signedName = requireSignedName(req.body)
    // SPEC v5 §29: a card owner (is_owner) ALWAYS becomes `owner` of the org on join —
    // the invited role is ignored (several owners per org are allowed).
    const invitee = findUserById(req.userId)
    const role = invitee?.is_owner ? 'owner' : invite.role

    const signedAt = Date.now()
    run(
      "UPDATE invites SET status = 'accepted', signature = ?, signature_kind = ?, signature_text = ?, signed_name = ?, signed_at = ? WHERE id = ?",
      sig.signature, sig.signatureKind, sig.signatureText, signedName, signedAt, invite.id
    )

    // create membership (idempotent); card owners are (re)forced to `owner`
    if (!findMember(invite.org_id, req.userId)) {
      run('INSERT INTO members (org_id, user_id, role, joined_at) VALUES (?,?,?,?)',
        invite.org_id, req.userId, role, signedAt)
    } else if (role !== invite.role) {
      run('UPDATE members SET role = ? WHERE org_id = ? AND user_id = ?', role, invite.org_id, req.userId)
    }
    // add to all existing org channels
    const channels = all("SELECT id FROM channels WHERE org_id = ? AND type = 'channel'", invite.org_id)
    for (const c of channels) {
      run('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?,?)', c.id, req.userId)
    }

    const orgRow = findOrg(invite.org_id)
    const org = {
      id: orgRow.id,
      name: orgRow.name,
      description: orgRow.description || '',
      createdAt: orgRow.created_at,
      membersCount: get('SELECT COUNT(*) AS c FROM members WHERE org_id = ?', orgRow.id).c,
      channelsCount: get("SELECT COUNT(*) AS c FROM channels WHERE org_id = ? AND type = 'channel'", orgRow.id).c,
      isPublic: orgRow.is_public === undefined || orgRow.is_public === null ? true : !!orgRow.is_public,
    }

    const user = publicUserSafe(req.userId)
    emitToOrg(invite.org_id, 'member:joined', { orgId: invite.org_id, user, role })
    logActivity(invite.org_id, 'invite.accepted', {
      actorId: req.userId,
      targetUserId: req.userId,
      details: phrases.inviteAccepted(req.userId, role),
    })
    logActivity(invite.org_id, 'member.joined', {
      actorId: req.userId,
      targetUserId: req.userId,
      details: phrases.memberJoined(req.userId),
    })

    res.json({ org, role })
  } catch (err) {
    next(err)
  }
})

// POST /api/invites/:id/decline -> {ok:true}
router.post('/invites/:id/decline', (req, res, next) => {
  try {
    const invite = requireInvite(req.params.id)
    if (invite.invitee_id !== req.userId) throw forbidden('Приглашение адресовано другому пользователю')
    if (invite.status !== 'pending') throw conflict('Приглашение уже неактивно')
    run("UPDATE invites SET status = 'rejected' WHERE id = ?", invite.id)
    logActivity(invite.org_id, 'invite.declined', {
      actorId: req.userId,
      targetUserId: req.userId,
      details: phrases.inviteDeclined(req.userId),
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/invites/:id -> {ok:true} (cancel pending; inviter self, owner, or rank >= 60)
router.delete('/invites/:id', (req, res, next) => {
  try {
    const invite = requireInvite(req.params.id)
    if (invite.status !== 'pending') throw conflict('Приглашение уже неактивно')

    const member = findMember(invite.org_id, req.userId)
    if (!member) throw forbidden('Вы не являетесь участником этой организации')
    canCancelInvite({ userId: req.userId, role: member.role }, invite)

    run("UPDATE invites SET status = 'canceled' WHERE id = ?", invite.id)
    logActivity(invite.org_id, 'invite.canceled', {
      actorId: req.userId,
      targetUserId: invite.invitee_id,
      details: phrases.inviteCanceled(req.userId, invite.invitee_id),
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

function requireInvite(id) {
  const invite = typeof id === 'string' ? get('SELECT * FROM invites WHERE id = ?', id) : null
  if (!invite) throw notFound('Приглашение не найдено')
  return invite
}

export default router
