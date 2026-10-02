/**
 * Join applications (SPEC v2 §12) — documents.type = 'join_application'.
 * Applicant signs the join contract at submission; staff (rank >= 40)
 * accepts (creates membership with role `member`) or rejects; applicant can cancel.
 */
import { Router } from 'express'
import {
  run,
  get,
  all,
  findUserById,
  findOrg,
  findMember,
  orgStaffIds,
} from '../db.js'
import { requireAuth, requireOrgMember, requireRank, findOrgSafe } from '../auth.js'
import {
  newId,
  bad,
  conflict,
  forbidden,
  notFound,
  str,
  documentDto,
  publicUser,
  rankOf,
  contractSignature,
  requireSignedName,
} from '../util.js'
import { buildContractText } from '../contract.js'
import { emitToOrg, emitToUser, emitToUsers } from '../bus.js'
import { logActivity, phrases } from '../activity.js'

const router = Router()

const PENDING_FIRST = "ORDER BY (status = 'pending') DESC, created_at DESC"

function requireApplication(id) {
  const doc = typeof id === 'string' ? get('SELECT * FROM documents WHERE id = ?', id) : null
  if (!doc || doc.type !== 'join_application') throw notFound('Заявление не найдено')
  return doc
}

function orgRef(org) {
  return {
    id: org.id,
    name: org.name,
    isPublic: org.is_public === undefined || org.is_public === null ? true : !!org.is_public,
  }
}

// POST /api/orgs/:id/applications {message?, signatureDataUrl|signatureText, signedName} -> 201 {application}
router.post('/orgs/:id/applications', requireAuth, (req, res, next) => {
  try {
    const org = findOrgSafe(req.params.id)
    if (findMember(org.id, req.userId)) throw conflict('Вы уже являетесь участником организации')

    const dup = get(
      "SELECT id FROM documents WHERE org_id = ? AND target_user_id = ? AND type = 'join_application' AND status = 'pending'",
      org.id,
      req.userId
    )
    if (dup) throw conflict('Ваше заявление в эту организацию уже рассматривается')

    const pendingInvite = get(
      "SELECT id FROM invites WHERE org_id = ? AND invitee_id = ? AND status = 'pending'",
      org.id,
      req.userId
    )
    if (pendingInvite) throw conflict('Вам уже отправлено приглашение — примите его вместо заявления')

    const body = req.body || {}
    const message = str(body.message) ?? ''
    if (message.length > 500) throw bad('Сообщение: не более 500 символов')
    const sig = contractSignature(body)
    const signedName = requireSignedName(body)

    const id = newId('d')
    const createdAt = Date.now()
    // роль в договоре — «Участник»: принимаемое заявление всегда создаёт member (§12)
    const contractText = buildContractText({ orgName: org.name, role: 'member', createdAt })

    run(
      `INSERT INTO documents (id, org_id, type, target_user_id, created_by, status, message,
        contract_text, signature, signature_kind, signature_text, signed_name, signed_at, created_at)
       VALUES (?,?, 'join_application', ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, org.id, req.userId, req.userId, message || null, contractText,
      sig.signature, sig.signatureKind, sig.signatureText, signedName, createdAt, createdAt
    )

    const doc = get('SELECT * FROM documents WHERE id = ?', id)
    const application = documentDto(doc)
    const staff = orgStaffIds(org.id)
    emitToUsers(staff, 'application:new', {
      application,
      org: orgRef(org),
      user: publicUser(findUserById(req.userId)),
    })
    logActivity(org.id, 'application.submitted', {
      actorId: req.userId,
      targetUserId: req.userId,
      details: phrases.applicationSubmitted(req.userId),
    })

    res.status(201).json({ application })
  } catch (err) {
    next(err)
  }
})

// GET /api/applications/mine -> {applications:[{application, org:{id,name,isPublic}}]}
// my join applications, all statuses, 50 latest, pending first
router.get('/applications/mine', requireAuth, (req, res, next) => {
  try {
    const rows = all(
      `SELECT * FROM documents
       WHERE target_user_id = ? AND type = 'join_application'
       ${PENDING_FIRST} LIMIT 50`,
      req.userId
    )
    const applications = rows.map((row) => {
      const org = findOrg(row.org_id)
      return { application: documentDto(row), org: org ? orgRef(org) : null }
    })
    res.json({ applications })
  } catch (err) {
    next(err)
  }
})

// GET /api/orgs/:id/applications -> {applications:[{application, user}]} (rank >= 40)
router.get('/orgs/:id/applications', requireOrgMember, requireRank(40, 'Просмотр заявок доступен только помощнику админа и выше'), (req, res, next) => {
  try {
    const rows = all(
      `SELECT * FROM documents
       WHERE org_id = ? AND type = 'join_application'
       ${PENDING_FIRST} LIMIT 50`,
      req.org.id
    )
    const applications = rows.map((row) => ({
      application: documentDto(row),
      user: publicUser(findUserById(row.target_user_id)),
    }))
    res.json({ applications })
  } catch (err) {
    next(err)
  }
})

// POST /api/applications/:id/accept -> {application} — rank >= 40, pending only (409 otherwise)
router.post('/applications/:id/accept', requireAuth, (req, res, next) => {
  try {
    const doc = requireApplication(req.params.id)
    const org = findOrgSafe(doc.org_id)
    const member = findMember(org.id, req.userId)
    if (!member) throw forbidden('Вы не являетесь участником этой организации')
    if (rankOf(member.role) < 40) throw forbidden('Принимать заявления может только помощник админа и выше')
    if (doc.status !== 'pending') throw conflict('Заявление уже рассмотрено')

    const now = Date.now()
    run("UPDATE documents SET status = 'approved', resolved_at = ? WHERE id = ?", now, doc.id)

    // membership with role `member` (§12: роль member всегда)
    if (!findMember(org.id, doc.target_user_id)) {
      run('INSERT INTO members (org_id, user_id, role, joined_at) VALUES (?,?,?,?)',
        org.id, doc.target_user_id, 'member', now)
      const channels = all("SELECT id FROM channels WHERE org_id = ? AND type = 'channel'", org.id)
      for (const c of channels) {
        run('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?,?)', c.id, doc.target_user_id)
      }
    }

    const application = documentDto(get('SELECT * FROM documents WHERE id = ?', doc.id))
    emitToUser(doc.target_user_id, 'application:update', { application, org: orgRef(org) })
    emitToOrg(org.id, 'member:joined', {
      orgId: org.id,
      user: publicUser(findUserById(doc.target_user_id)),
      role: 'member',
    })
    logActivity(org.id, 'application.approved', {
      actorId: req.userId,
      targetUserId: doc.target_user_id,
      details: phrases.applicationApproved(req.userId, doc.target_user_id),
    })
    logActivity(org.id, 'member.joined', {
      actorId: doc.target_user_id,
      targetUserId: doc.target_user_id,
      details: phrases.memberJoined(doc.target_user_id),
    })

    res.json({ application })
  } catch (err) {
    next(err)
  }
})

// POST /api/applications/:id/reject -> {application} — rank >= 40, pending only
router.post('/applications/:id/reject', requireAuth, (req, res, next) => {
  try {
    const doc = requireApplication(req.params.id)
    const org = findOrgSafe(doc.org_id)
    const member = findMember(org.id, req.userId)
    if (!member) throw forbidden('Вы не являетесь участником этой организации')
    if (rankOf(member.role) < 40) throw forbidden('Отклонять заявления может только помощник админа и выше')
    if (doc.status !== 'pending') throw conflict('Заявление уже рассмотрено')

    run("UPDATE documents SET status = 'rejected', resolved_at = ? WHERE id = ?", Date.now(), doc.id)
    const application = documentDto(get('SELECT * FROM documents WHERE id = ?', doc.id))
    emitToUser(doc.target_user_id, 'application:update', { application, org: orgRef(org) })
    logActivity(org.id, 'application.rejected', {
      actorId: req.userId,
      targetUserId: doc.target_user_id,
      details: phrases.applicationRejected(req.userId, doc.target_user_id),
    })
    res.json({ application })
  } catch (err) {
    next(err)
  }
})

// POST /api/applications/:id/cancel -> {application} — only the author, only pending
router.post('/applications/:id/cancel', requireAuth, (req, res, next) => {
  try {
    const doc = requireApplication(req.params.id)
    if (doc.target_user_id !== req.userId) throw forbidden('Заявление подавали не вы')
    if (doc.status !== 'pending') throw conflict('Заявление уже рассмотрено')

    run("UPDATE documents SET status = 'canceled', resolved_at = ? WHERE id = ?", Date.now(), doc.id)
    const application = documentDto(get('SELECT * FROM documents WHERE id = ?', doc.id))
    const org = findOrg(doc.org_id)
    if (org) {
      emitToUsers(orgStaffIds(org.id), 'application:update', { application, org: orgRef(org) })
    }
    logActivity(doc.org_id, 'application.canceled', {
      actorId: req.userId,
      targetUserId: req.userId,
      details: phrases.applicationCanceled(req.userId),
    })
    res.json({ application })
  } catch (err) {
    next(err)
  }
})

export default router
