import { Router } from 'express'
import {
  run,
  get,
  all,
  findUserById,
  findOrg,
  findMember,
  transaction,
} from '../db.js'
import { requireAuth, requireOrgMember, requireRank } from '../auth.js'
import { logAudit } from '../audit.js'
import { logActivity } from '../activity.js'
import { emitToUser } from '../bus.js'
import { bad, conflict, notFound, str, rub, publicUser, newId } from '../util.js'

const router = Router()

// ---------- helpers ----------

/** Integer rubles bounds check (SPEC v4 §24). */
function amountOf(value, min, max, message) {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < min || n > max) throw bad(message)
  return n
}

function paymentRow(row) {
  return {
    id: row.id,
    orgId: row.org_id ?? null,
    fromUserId: row.from_user_id ?? null,
    toUserId: row.to_user_id ?? null,
    kind: row.kind,
    amount: row.amount,
    note: row.note ?? null,
    cardMask: row.card_mask ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  }
}

/** Payment as seen in GET /api/wallet history. */
function walletPaymentDto(row, meId) {
  const direction = row.to_user_id === meId ? 'in' : 'out'
  let counterparty = null
  if (row.kind === 'transfer') {
    const otherId = direction === 'in' ? row.from_user_id : row.to_user_id
    const other = otherId ? findUserById(otherId) : null
    counterparty = other ? { user: publicUser(other) } : null
  } else if (row.kind === 'salary' || row.kind === 'treasury_deposit') {
    const org = row.org_id ? findOrg(row.org_id) : null
    counterparty = org ? { org: { id: org.id, name: org.name } } : null
  }
  return {
    id: row.id,
    kind: row.kind,
    amount: row.amount,
    direction,
    counterparty,
    note: row.note ?? null,
    cardMask: row.card_mask ?? null,
    createdAt: row.created_at,
  }
}

const nameOf = (id) => (id ? findUserById(id)?.display_name || 'Пользователь' : 'Пользователь')

// ---------- personal wallet (SPEC v4 §24) ----------

// GET /api/wallet -> {balance, demo:true, payments:[...]} — 30 latest operations
// SPEC v5 §29: card owner balance is unlimited → null (∞ on the client)
router.get('/wallet', requireAuth, (req, res, next) => {
  try {
    const rows = all(
      `SELECT * FROM payments
       WHERE to_user_id = ? OR from_user_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 30`,
      req.userId,
      req.userId
    )
    const user = findUserById(req.userId)
    res.json({
      balance: user.is_owner ? null : (user.balance ?? 0),
      demo: true,
      payments: rows.map((r) => walletPaymentDto(r, req.userId)),
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/wallet/topup {amount, cardNumber} -> {balance, payment, demo:true}
// DEMO mode: no real charge; card_mask = '•••• ' + last 4 digits.
router.post('/wallet/topup', requireAuth, (req, res, next) => {
  try {
    const body = req.body || {}
    const amount = amountOf(body.amount, 100, 500000, 'Сумма пополнения: 100–500 000 ₽')
    const cardNumber = String(body.cardNumber ?? '').replace(/[\s-]/g, '')
    if (!/^\d{16}$/.test(cardNumber)) throw bad('Номер карты: 16 цифр')
    const cardMask = `•••• ${cardNumber.slice(-4)}`

    const balance = transaction(() => {
      run('UPDATE users SET balance = balance + ? WHERE id = ?', amount, req.userId)
      const id = newId('p')
      run(
        `INSERT INTO payments (id, org_id, from_user_id, to_user_id, kind, amount, note, card_mask, created_by, created_at)
         VALUES (?, NULL, NULL, ?, 'topup', ?, NULL, ?, ?, ?)`,
        id,
        req.userId,
        amount,
        cardMask,
        req.userId,
        Date.now()
      )
      const row = get('SELECT * FROM payments WHERE id = ?', id)
      const user = findUserById(req.userId)
      // SPEC v5 §29: owner balance is always reported as null (∞)
      return { payment: row, balance: user.is_owner ? null : (user.balance ?? 0) }
    })

    logAudit({
      actorId: req.userId,
      action: 'wallet.topup',
      details: `Пополнение кошелька: +${rub(amount)} ₽ (карта ${cardMask})`,
      botText: `💳 Пополнение: +${rub(amount)} ₽`,
      botSubject: req.userId,
    })
    emitToUser(req.userId, 'wallet:updated', { balance: balance.balance, reason: 'topup', amount })
    res.json({ balance: balance.balance, payment: paymentRow(balance.payment), demo: true })
  } catch (err) {
    next(err)
  }
})

// POST /api/wallet/transfer {toUserId, amount, note?} -> {balance, payment}
router.post('/wallet/transfer', requireAuth, (req, res, next) => {
  try {
    const body = req.body || {}
    const toUserId = str(body.toUserId)
    const amount = amountOf(body.amount, 1, 500000, 'Сумма перевода: 1–500 000 ₽')
    const note = str(body.note) ?? ''
    if (note.length > 300) throw bad('Комментарий: не более 300 символов')
    if (!toUserId) throw bad('Укажите получателя')
    if (toUserId === req.userId) throw bad('Нельзя переводить самому себе')

    const recipient = findUserById(toUserId)
    if (!recipient) throw notFound('Пользователь не найден')

    const result = transaction(() => {
      const sender = findUserById(req.userId)
      // SPEC v5 §29: card owner has unlimited funds — the check and the debit are skipped,
      // the payment row is still recorded with its amount.
      const infinite = !!sender.is_owner
      if (!infinite && (sender.balance ?? 0) < amount) throw conflict('Недостаточно средств')
      if (!infinite) run('UPDATE users SET balance = balance - ? WHERE id = ?', amount, req.userId)
      run('UPDATE users SET balance = balance + ? WHERE id = ?', amount, toUserId)
      const id = newId('p')
      run(
        `INSERT INTO payments (id, org_id, from_user_id, to_user_id, kind, amount, note, card_mask, created_by, created_at)
         VALUES (?, NULL, ?, ?, 'transfer', ?, ?, NULL, ?, ?)`,
        id,
        req.userId,
        toUserId,
        amount,
        note || null,
        req.userId,
        Date.now()
      )
      const row = get('SELECT * FROM payments WHERE id = ?', id)
      const after = findUserById(req.userId)
      return { payment: row, balance: infinite ? null : (after.balance ?? 0) }
    })

    const senderUser = findUserById(req.userId)
    logAudit({
      actorId: req.userId,
      targetUserId: toUserId,
      action: 'wallet.transfer',
      details: `Перевод: ${rub(amount)} ₽ → ${nameOf(toUserId)}`,
      botText: `💸 Перевод: ${rub(amount)} ₽ → ${nameOf(toUserId)}`,
      botSubject: toUserId,
    })
    emitToUser(toUserId, 'wallet:updated', {
      // SPEC v5 §29: card owner balance is always reported as null (∞)
      balance: recipient.is_owner ? null : (recipient.balance ?? 0) + amount,
      reason: 'transfer',
      from: publicUser(senderUser),
      amount,
    })
    res.json({ balance: result.balance, payment: paymentRow(result.payment) })
  } catch (err) {
    next(err)
  }
})

// ---------- org finance (SPEC v4 §24) ----------

// GET /api/orgs/:id/finance -> {balance, canManage, transactions, payrollTotals}
// rank >= 60: whole treasury; regular member: only own salary credits from this org.
router.get('/orgs/:id/finance', requireAuth, requireOrgMember, (req, res, next) => {
  try {
    const canManage = req.rank >= 60
    const rows = canManage
      ? all('SELECT * FROM payments WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50', req.org.id)
      : all(
          `SELECT * FROM payments
           WHERE org_id = ? AND kind = 'salary' AND to_user_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT 50`,
          req.org.id,
          req.userId
        )

    let payrollTotals = []
    if (canManage) {
      const totals = all(
        `SELECT to_user_id AS uid, SUM(amount) AS total
         FROM payments WHERE org_id = ? AND kind = 'salary'
         GROUP BY to_user_id`,
        req.org.id
      )
      payrollTotals = totals
        .map((t) => ({ user: t.uid ? publicUser(findUserById(t.uid)) : null, total: t.total }))
        .filter((t) => t.user)
    }

    const org = findOrg(req.org.id)
    res.json({
      balance: org.balance ?? 0,
      canManage,
      transactions: rows.map((r) => ({
        ...paymentRow(r),
        fromUser: r.from_user_id ? publicUser(findUserById(r.from_user_id)) : null,
        toUser: r.to_user_id ? publicUser(findUserById(r.to_user_id)) : null,
        createdAt: r.created_at,
      })),
      payrollTotals,
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/orgs/:id/treasury/deposit {amount} -> {balance} — rank >= 60,
// debits the author's personal balance (kind 'treasury_deposit').
router.post('/orgs/:id/treasury/deposit', requireAuth, requireOrgMember, requireRank(60, 'Управление финансами доступно только админу'), (req, res, next) => {
  try {
    const amount = amountOf(req.body?.amount, 1, 100000000, 'Сумма: положительное целое число (до 100 000 000 ₽)')

    const result = transaction(() => {
      const user = findUserById(req.userId)
      // SPEC v5 §29: owner deposits from an unlimited balance — no check, no debit
      const infinite = !!user.is_owner
      if (!infinite && (user.balance ?? 0) < amount) throw conflict('Недостаточно средств')
      if (!infinite) run('UPDATE users SET balance = balance - ? WHERE id = ?', amount, req.userId)
      run('UPDATE orgs SET balance = balance + ? WHERE id = ?', amount, req.org.id)
      const id = newId('p')
      run(
        `INSERT INTO payments (id, org_id, from_user_id, to_user_id, kind, amount, note, card_mask, created_by, created_at)
         VALUES (?, ?, ?, NULL, 'treasury_deposit', ?, NULL, NULL, ?, ?)`,
        id,
        req.org.id,
        req.userId,
        amount,
        req.userId,
        Date.now()
      )
      const org = findOrg(req.org.id)
      const after = findUserById(req.userId)
      return {
        orgBalance: org.balance ?? 0,
        userBalance: infinite ? null : (after.balance ?? 0),
      }
    })

    logAudit({
      orgId: req.org.id,
      actorId: req.userId,
      action: 'org.treasury_deposit',
      details: `Пополнение казначейства: +${rub(amount)} ₽ (орг «${req.org.name}»)`,
      botSubject: req.org.id,
    })
    emitToUser(req.userId, 'wallet:updated', {
      balance: result.userBalance,
      reason: 'treasury_deposit',
      amount,
    })
    res.json({ balance: result.orgBalance, orgBalance: result.orgBalance, userBalance: result.userBalance })
  } catch (err) {
    next(err)
  }
})

// POST /api/orgs/:id/payroll {userId, amount, note?} -> {orgBalance, payment} — rank >= 60
router.post('/orgs/:id/payroll', requireAuth, requireOrgMember, requireRank(60, 'Выплаты доступны только админу'), (req, res, next) => {
  try {
    const body = req.body || {}
    const targetId = str(body.userId)
    const amount = amountOf(body.amount, 1, 100000000, 'Сумма: положительное целое число (до 100 000 000 ₽)')
    const note = str(body.note) ?? ''
    if (note.length > 300) throw bad('Комментарий: не более 300 символов')
    if (!targetId) throw bad('Укажите сотрудника')

    const targetMember = findMember(req.org.id, targetId)
    if (!targetMember) throw notFound('Сотрудник не является участником организации')
    const target = findUserById(targetId)
    if (!target) throw notFound('Пользователь не найден')

    const result = transaction(() => {
      const org = findOrg(req.org.id)
      if ((org.balance ?? 0) < amount) throw conflict('Недостаточно средств в казначействе')
      run('UPDATE orgs SET balance = balance - ? WHERE id = ?', amount, req.org.id)
      run('UPDATE users SET balance = balance + ? WHERE id = ?', amount, targetId)
      const id = newId('p')
      run(
        `INSERT INTO payments (id, org_id, from_user_id, to_user_id, kind, amount, note, card_mask, created_by, created_at)
         VALUES (?, ?, NULL, ?, 'salary', ?, ?, NULL, ?, ?)`,
        id,
        req.org.id,
        targetId,
        amount,
        note || null,
        req.userId,
        Date.now()
      )
      const row = get('SELECT * FROM payments WHERE id = ?', id)
      const orgAfter = findOrg(req.org.id)
      const targetAfter = findUserById(targetId)
      return {
        payment: row,
        orgBalance: orgAfter.balance ?? 0,
        // SPEC v5 §29: card owner balance is reported as null (∞)
        targetBalance: targetAfter.is_owner ? null : (targetAfter.balance ?? 0),
      }
    })

    // SPEC v4 §24: activity + audit from the same handler, bot report «💸 Зарплата: …»
    logActivity(req.org.id, 'org.payroll', {
      actorId: req.userId,
      targetUserId: targetId,
      details: `${nameOf(req.userId)} выплатил(а) зарплату: ${rub(amount)} ₽ → ${nameOf(targetId)}`,
      botText: `💸 Зарплата: ${rub(amount)} ₽ → ${nameOf(targetId)} (org «${req.org.name}»)`,
      botSubject: targetId,
    })
    emitToUser(targetId, 'wallet:updated', {
      balance: result.targetBalance,
      reason: 'salary',
      from: publicUser(findUserById(req.userId)),
      amount,
    })
    res.json({ orgBalance: result.orgBalance, payment: paymentRow(result.payment) })
  } catch (err) {
    next(err)
  }
})

export default router
