/**
 * Dismissal documents (SPEC v2 §11–12) — documents.type = 'dismissal'.
 * Staff (rank >= 60, SPEC v3 §19) initiates a dismissal contract; the employee
 * signs it (membership removed) or disputes it (membership kept). Staff may
 * cancel it or terminate unilaterally (membership removed).
 * Membership is NEVER removed by merely creating the document.
 */
import { Router } from 'express'
import { run, get, all, findUserById, findOrg, findMember, orgStaffIds, removeMemberFromOrg } from '../db.js'
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
import { canDismiss, canTerminate } from '../permissions.js'
import { buildDismissalContractText } from '../contract.js'
import { emitToOrg, emitToUser, emitToUsers } from '../bus.js'
import { logActivity, phrases } from '../activity.js'

const router = Router()

const PENDING_FIRST = "ORDER BY (status = 'pending') DESC, created_at DESC"

function requireDismissal(id) {
  const doc = typeof id === 'string' ? get('SELECT * FROM documents WHERE id = ?', id) : null
  if (!doc || doc.type !== 'dismissal') throw notFound('Документ не найден')
  return doc
}

function createdByRef(doc) {
  return { user: publicUser(findUserById(doc.created_by)) }
}

function orgRef(org) {
  return { id: org.id, name: org.name }
}

/** Broadcast `document:update` to target + staff (all outcomes, §13). */
function emitDocumentUpdate(doc, org) {
  emitToUser(doc.target_user_id, 'document:update', {
    document: documentDto(doc),
    org: orgRef(org),
  })
  emitToUsers(orgStaffIds(org.id), 'document:update', {
    document: documentDto(doc),
    org: orgRef(org),
  })
}

// ---------- create ----------

// POST /api/orgs/:id/dismissals {userId, reason?} -> 201 {document}
router.post('/orgs/:id/dismissals', requireOrgMember, (req, res, next) => {
  try {
    if (!canDismiss(req.rank)) throw forbidden('Увольнять участников может только админ и выше')

    const targetId = str(req.body?.userId)
    if (!targetId) throw bad('Укажите участника')
    const target = findMember(req.org.id, targetId)
    if (!target) throw conflict('Пользователь не является участником организации')
    if (target.role === 'owner') throw forbidden('Владелец не может быть уволен')
    if (rankOf(target.role) >= req.rank) throw forbidden('Можно уволить только участника с более низкой ролью')

    const existing = get(
      "SELECT id FROM documents WHERE org_id = ? AND target_user_id = ? AND type = 'dismissal' AND status = 'pending'",
      req.org.id,
      targetId
    )
    if (existing) throw conflict('На этого участника уже есть договор об увольнении')

    const reason = str(req.body?.reason) ?? ''
    if (reason.length > 300) throw bad('Причина: не более 300 символов')

    const id = newId('d')
    const createdAt = Date.now()
    const contractText = buildDismissalContractText({
      orgName: req.org.name,
      role: target.role,
      reason,
      initiatedByTarget: false,
      createdAt,
    })

    run(
      `INSERT INTO documents (id, org_id, type, target_user_id, created_by, status, message,
        contract_text, created_at)
       VALUES (?,?, 'dismissal', ?, ?, 'pending', ?, ?, ?)`,
      id, req.org.id, targetId, req.userId, reason || null, contractText, createdAt
    )

    const doc = get('SELECT * FROM documents WHERE id = ?', id)
    emitToUser(targetId, 'document:new', { document: documentDto(doc), org: orgRef(req.org) })
    logActivity(req.org.id, 'dismissal.created', {
      actorId: req.userId,
      targetUserId: targetId,
      details: phrases.dismissalCreated(req.userId, targetId),
    })
    res.status(201).json({ document: documentDto(doc) })
  } catch (err) {
    next(err)
  }
})

// ---------- listings ----------

// GET /api/documents/mine -> {documents:[{document, org:{id,name}, createdBy:{user}}]}
router.get('/documents/mine', requireAuth, (req, res, next) => {
  try {
    const rows = all(
      `SELECT * FROM documents WHERE target_user_id = ? ${PENDING_FIRST} LIMIT 50`,
      req.userId
    )
    const documents = rows.map((row) => {
      const org = findOrg(row.org_id)
      return {
        document: documentDto(row),
        org: org ? orgRef(org) : null,
        createdBy: createdByRef(row),
      }
    })
    res.json({ documents })
  } catch (err) {
    next(err)
  }
})

// GET /api/orgs/:id/dismissals -> {documents:[{document, targetUser, createdBy:{user}}]} (rank >= 40)
router.get('/orgs/:id/dismissals', requireOrgMember, requireRank(40, 'Просмотр увольнений доступен только помощнику админа и выше'), (req, res, next) => {
  try {
    const rows = all(
      `SELECT * FROM documents WHERE org_id = ? AND type = 'dismissal' ${PENDING_FIRST} LIMIT 50`,
      req.org.id
    )
    const documents = rows.map((row) => ({
      document: documentDto(row),
      targetUser: publicUser(findUserById(row.target_user_id)),
      createdBy: createdByRef(row),
    }))
    res.json({ documents })
  } catch (err) {
    next(err)
  }
})

// ---------- employee actions ----------

// POST /api/documents/:id/sign {signatureDataUrl|signatureText, signedName} -> {document}
// target only, pending only; in one flow: signature -> signed -> membership removed
router.post('/documents/:id/sign', requireAuth, (req, res, next) => {
  try {
    const doc = requireDismissal(req.params.id)
    if (doc.target_user_id !== req.userId) throw forbidden('Договор адресован другому пользователю')
    if (doc.status !== 'pending') throw conflict('Договор уже неактивен')

    const sig = contractSignature(req.body)
    const signedName = requireSignedName(req.body)

    const org = findOrgSafe(doc.org_id)
    if (!findMember(org.id, req.userId)) throw conflict('Вы не являетесь участником этой организации')

    const now = Date.now()
    run(
      "UPDATE documents SET status = 'signed', signature = ?, signature_kind = ?, signature_text = ?, signed_name = ?, signed_at = ?, resolved_at = ? WHERE id = ?",
      sig.signature, sig.signatureKind, sig.signatureText, signedName, now, now, doc.id
    )
    removeMemberFromOrg(org.id, req.userId)

    const updated = get('SELECT * FROM documents WHERE id = ?', doc.id)
    emitDocumentUpdate(updated, org)
    emitToOrg(org.id, 'member:left', { orgId: org.id, userId: req.userId })
    logActivity(org.id, 'dismissal.signed', {
      actorId: req.userId,
      targetUserId: req.userId,
      details: phrases.dismissalSigned(req.userId),
    })
    logActivity(org.id, 'member.left', {
      actorId: req.userId,
      targetUserId: req.userId,
      details: phrases.memberLeft(req.userId),
    })
    res.json({ document: documentDto(updated) })
  } catch (err) {
    next(err)
  }
})

// POST /api/documents/:id/reject -> {document} — target, pending; membership kept («оспорил»)
router.post('/documents/:id/reject', requireAuth, (req, res, next) => {
  try {
    const doc = requireDismissal(req.params.id)
    if (doc.target_user_id !== req.userId) throw forbidden('Договор адресован другому пользователю')
    if (doc.status !== 'pending') throw conflict('Договор уже неактивен')

    const now = Date.now()
    run("UPDATE documents SET status = 'rejected', resolved_at = ? WHERE id = ?", now, doc.id)
    const updated = get('SELECT * FROM documents WHERE id = ?', doc.id)
    const org = findOrgSafe(doc.org_id)
    emitDocumentUpdate(updated, org)
    logActivity(org.id, 'dismissal.rejected', {
      actorId: req.userId,
      targetUserId: req.userId,
      details: phrases.dismissalRejected(req.userId),
    })
    res.json({ document: documentDto(updated) })
  } catch (err) {
    next(err)
  }
})

// ---------- staff actions ----------

// POST /api/documents/:id/cancel -> {document} — creator OR actor.rank > target.rank; membership kept
router.post('/documents/:id/cancel', requireAuth, (req, res, next) => {
  try {
    const doc = requireDismissal(req.params.id)
    if (doc.status !== 'pending') throw conflict('Договор уже неактивен')
    const org = findOrgSafe(doc.org_id)

    const actor = findMember(org.id, req.userId)
    const target = findMember(org.id, doc.target_user_id)
    const isCreator = doc.created_by === req.userId
    if (!isCreator) {
      if (!actor) throw forbidden('Вы не являетесь участником этой организации')
      const targetRank = target ? rankOf(target.role) : rankOf('member')
      if (rankOf(actor.role) <= targetRank) {
        throw forbidden('Отменить договор может только создатель или сотрудник с более высокой ролью')
      }
    }

    run("UPDATE documents SET status = 'canceled', resolved_at = ? WHERE id = ?", Date.now(), doc.id)
    const updated = get('SELECT * FROM documents WHERE id = ?', doc.id)
    emitDocumentUpdate(updated, org)
    logActivity(org.id, 'dismissal.canceled', {
      actorId: req.userId,
      targetUserId: doc.target_user_id,
      details: phrases.dismissalCanceled(req.userId, doc.target_user_id),
    })
    res.json({ document: documentDto(updated) })
  } catch (err) {
    next(err)
  }
})

// POST /api/documents/:id/terminate -> {document} — pending; rank >= 60 AND actor.rank > target.rank
// (§19: one-sided termination) -> status terminated + membership removed
router.post('/documents/:id/terminate', requireAuth, (req, res, next) => {
  try {
    const doc = requireDismissal(req.params.id)
    if (doc.status !== 'pending') throw conflict('Договор уже неактивен')
    const org = findOrgSafe(doc.org_id)

    const actor = findMember(org.id, req.userId)
    if (!actor) throw forbidden('Вы не являетесь участником этой организации')
    if (!canTerminate(rankOf(actor.role))) {
      throw forbidden('Расторгнуть договор в одностороннем порядке может только админ и выше')
    }
    const target = findMember(org.id, doc.target_user_id)
    if (!target) throw conflict('Пользователь не является участником организации')
    if (rankOf(target.role) >= rankOf(actor.role)) {
      throw forbidden('Можно расторгнуть договор только с участником с более низкой ролью')
    }

    const now = Date.now()
    run("UPDATE documents SET status = 'terminated', resolved_at = ? WHERE id = ?", now, doc.id)
    removeMemberFromOrg(org.id, doc.target_user_id)

    const updated = get('SELECT * FROM documents WHERE id = ?', doc.id)
    emitDocumentUpdate(updated, org)
    emitToOrg(org.id, 'member:left', { orgId: org.id, userId: doc.target_user_id })
    logActivity(org.id, 'dismissal.terminated', {
      actorId: req.userId,
      targetUserId: doc.target_user_id,
      details: phrases.dismissalTerminated(req.userId, doc.target_user_id),
    })
    logActivity(org.id, 'member.left', {
      actorId: doc.target_user_id,
      targetUserId: doc.target_user_id,
      details: phrases.memberLeft(doc.target_user_id),
    })
    res.json({ document: documentDto(updated) })
  } catch (err) {
    next(err)
  }
})

export default router
