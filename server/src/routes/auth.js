import { Router } from 'express'
import bcrypt from 'bcryptjs'
import {
  findUserById,
  findUserByUsername,
  findUserByEmail,
  run,
  get,
} from '../db.js'
import { signToken, requireAuth } from '../auth.js'
import { logAudit, requestInfo } from '../audit.js'
import {
  newId,
  avatarColorFor,
  publicUser,
  meUser,
  bad,
  conflict,
  forbidden,
  unauthorized,
  str,
} from '../util.js'

const router = Router()

const USERNAME_RE = /^[a-z0-9_]{3,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ---- SPEC v4 §23: login_log + audit for auth events ----

const hhmm = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

function writeLoginLog(userId, success) {
  const { ip, userAgent } = requestInfo()
  run(
    'INSERT INTO login_log (id, user_id, success, ip, user_agent, created_at) VALUES (?,?,?,?,?,?)',
    newId('lg'),
    userId,
    success ? 1 : 0,
    ip,
    userAgent,
    Date.now()
  )
}

// POST /api/auth/register {username, displayName, email, password} -> 201 {token, user}
router.post('/auth/register', (req, res, next) => {
  try {
    const body = req.body || {}
    const username = str(body.username)
    const displayName = str(body.displayName)
    const email = str(body.email)?.toLowerCase()
    const password = typeof body.password === 'string' ? body.password : ''

    if (!username || !USERNAME_RE.test(username)) {
      throw bad('Имя пользователя: 3–20 символов, только латинские буквы в нижнем регистре, цифры и _')
    }
    if (!displayName || displayName.length < 1 || displayName.length > 100) {
      throw bad('Отображаемое имя обязательно (1–100 символов)')
    }
    if (!email || !EMAIL_RE.test(email) || email.length > 254) {
      throw bad('Некорректный email')
    }
    if (password.length < 6) throw bad('Пароль должен содержать не менее 6 символов')

    if (findUserByUsername(username)) throw conflict('Имя пользователя уже занято')
    if (findUserByEmail(email)) throw conflict('Этот email уже зарегистрирован')

    const id = newId('u')
    const passwordHash = bcrypt.hashSync(password, 10)
    const createdAt = Date.now()
    const avatarColor = avatarColorFor(id)

    run(
      'INSERT INTO users (id, username, email, password_hash, display_name, avatar_color, created_at) VALUES (?,?,?,?,?,?,?)',
      id,
      username,
      email,
      passwordHash,
      displayName,
      avatarColor,
      createdAt
    )

    const user = meUser(findUserById(id))

    // SPEC v4 §23: auth audit (register also issues a token → counts as login)
    run('UPDATE users SET last_login_at = ? WHERE id = ?', createdAt, id)
    writeLoginLog(id, true)
    logAudit({
      actorId: id,
      action: 'auth.register',
      details: `Регистрация: ${username}`,
      botText: `🟢 Регистрация: ${username}`,
      botSubject: username,
    })

    res.status(201).json({ token: signToken(user), user })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/login {login, password} -> {token, user}
router.post('/auth/login', (req, res, next) => {
  try {
    const body = req.body || {}
    const login = str(body.login)
    const password = typeof body.password === 'string' ? body.password : ''
    if (!login || !password) throw bad('Укажите логин и пароль')

    const row =
      findUserByUsername(login) ||
      (login.includes('@') ? findUserByEmail(login.toLowerCase()) : null)

    // never throw on a malformed stored hash (e.g. system bot user)
    let ok = false
    if (row && row.password_hash) {
      try {
        ok = bcrypt.compareSync(password, row.password_hash)
      } catch {
        ok = false
      }
    }

    if (!ok) {
      writeLoginLog(row ? row.id : null, false)
      logAudit({
        actorId: row ? row.id : null,
        action: 'auth.login',
        details: 'Неудачный вход',
        botText: `🔴 Неудачный вход: ${login}`,
        botSubject: login,
      })
      throw unauthorized('Неверный логин или пароль')
    }

    if (row.banned) {
      // SPEC v4 §23: banned accounts cannot log in
      writeLoginLog(row.id, false)
      logAudit({
        actorId: row.id,
        action: 'auth.login',
        details: 'Неудачный вход',
        botText: `⛔ Вход отклонён: ${login} (аккаунт заблокирован)`,
        botSubject: login,
      })
      throw forbidden('Аккаунт заблокирован')
    }

    const now = Date.now()
    run('UPDATE users SET last_login_at = ? WHERE id = ?', now, row.id)
    writeLoginLog(row.id, true)
    const { ip } = requestInfo()
    logAudit({
      actorId: row.id,
      action: 'auth.login',
      details: `Вход: ${row.username}`,
      botText: `🔴 Вход: ${row.username}${ip ? ` (IP ${ip})` : ''} в ${hhmm(now)}`,
      botSubject: row.username,
    })

    const user = meUser(findUserById(row.id))
    res.json({ token: signToken(user), user })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/logout -> {ok:true} (SPEC v4 §23 audit `auth.logout`)
router.post('/auth/logout', requireAuth, (req, res, next) => {
  try {
    const row = findUserById(req.userId)
    logAudit({
      actorId: row.id,
      action: 'auth.logout',
      details: `Выход: ${row.username}`,
      botText: `⚪ Выход: ${row.username}`,
      botSubject: row.username,
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// GET /api/me -> {user} (SPEC v3 §17: + fullName, signature…; SPEC v4 §25: + isAdmin, balance)
router.get('/me', requireAuth, (req, res) => {
  const user = meUser(findUserById(req.userId))
  res.json({ user, isAdmin: user.isAdmin, balance: user.balance })
})

// ---- profile update (SPEC v2.1 §17 PUT, SPEC v3 §17 PATCH) ----
// Accepts: displayName? fullName? email? password? currentPassword?
//          signature? signatureKind? signatureText?
function applyProfileUpdate(userId, body) {
  const row = findUserById(userId)
  if (!row) throw unauthorized('Пользователь не найден')

  if (body.displayName !== undefined) {
    const displayName = str(body.displayName)
    if (!displayName || displayName.length < 2 || displayName.length > 50) throw bad('Отображаемое имя: 2–50 символов')
    run('UPDATE users SET display_name = ? WHERE id = ?', displayName, userId)
  }
  if (body.fullName !== undefined) {
    const fullName = str(body.fullName) ?? ''
    if (fullName && fullName.length < 2) throw bad('ФИО: не менее 2 символов')
    if (fullName.length > 120) throw bad('ФИО: не более 120 символов')
    run('UPDATE users SET full_name = ? WHERE id = ?', fullName || null, userId)
  }
  if (body.email !== undefined) {
    const email = str(body.email)?.toLowerCase()
    if (!email || !EMAIL_RE.test(email) || email.length > 254) throw bad('Некорректный email')
    const dup = findUserByEmail(email)
    if (dup && dup.id !== userId) throw conflict('Этот email уже зарегистрирован')
    run('UPDATE users SET email = ? WHERE id = ?', email, userId)
  }
  if (body.password !== undefined) {
    const password = typeof body.password === 'string' ? body.password : ''
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : ''
    if (!current || !bcrypt.compareSync(current, row.password_hash)) {
      throw bad('Неверный текущий пароль')
    }
    if (password.length < 6) throw bad('Пароль должен содержать не менее 6 символов')
    run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(password, 10), userId)
  }
  if (body.signatureKind !== undefined || body.signature !== undefined) {
    if (body.signatureKind === undefined || body.signature === undefined) {
      throw bad('Укажите подпись и её вид')
    }
    const kind = normalizeSignatureKind(body.signatureKind)
    if (kind === null) {
      run('UPDATE users SET signature = NULL, signature_kind = NULL, signature_text = NULL WHERE id = ?', userId)
    } else {
      const signature = typeof body.signature === 'string' ? body.signature.trim() : ''
      if (!signature.startsWith('data:image/')) throw bad('Подпись должна быть изображением data:image/...')
      let signatureText = null
      if (body.signatureText !== undefined) {
        signatureText = str(body.signatureText)
        if (signatureText && (signatureText.length < 2 || signatureText.length > 80)) {
          throw bad('Текст подписи: 2–80 символов')
        }
      }
      run('UPDATE users SET signature = ?, signature_kind = ?, signature_text = ? WHERE id = ?',
        signature, kind, signatureText, userId)
    }
  }
  return meUser(findUserById(userId))
}

/** 'typed' (canonical, SPEC v3) | 'drawn' | null (delete). v2.1 alias 'text' → 'typed'. */
function normalizeSignatureKind(kind) {
  if (kind === null || kind === undefined) return null
  if (kind === 'typed' || kind === 'text') return 'typed'
  if (kind === 'drawn') return 'drawn'
  throw bad('Вид подписи: «typed» или «drawn»')
}

// PATCH /api/me (SPEC v3 §17) -> {user}
router.patch('/me', requireAuth, (req, res, next) => {
  try {
    res.json({ user: applyProfileUpdate(req.userId, req.body || {}) })
  } catch (err) {
    next(err)
  }
})

// PUT /api/me (SPEC v2.1 §17) -> {user} — same semantics, superset of fields
router.put('/me', requireAuth, (req, res, next) => {
  try {
    res.json({ user: applyProfileUpdate(req.userId, req.body || {}) })
  } catch (err) {
    next(err)
  }
})

// PUT /api/me/signature (SPEC v2.1 §17) — three variants:
//   {kind:'text'|'typed', text, dataUrl?} | {kind:'drawn', dataUrl} | {kind:null} -> {user}
router.put('/me/signature', requireAuth, (req, res, next) => {
  try {
    const body = req.body || {}
    if (body.kind === undefined) throw bad('Укажите вид подписи')
    const kind = body.kind === null ? null : normalizeSignatureKind(body.kind)
    const userId = req.userId

    if (kind === null) {
      run('UPDATE users SET signature = NULL, signature_kind = NULL, signature_text = NULL WHERE id = ?', userId)
    } else if (kind === 'drawn') {
      const dataUrl = str(body.dataUrl)
      if (!dataUrl || !dataUrl.startsWith('data:image/')) throw bad('Нарисуйте подпись (data:image/...)')
      run('UPDATE users SET signature = ?, signature_kind = ?, signature_text = NULL WHERE id = ?',
        dataUrl, 'drawn', userId)
    } else {
      const text = str(body.text)
      if (!text || text.length < 2 || text.length > 80) throw bad('Текст подписи: 2–80 символов')
      const image = str(body.dataUrl) || null
      if (image && !image.startsWith('data:image/')) throw bad('Некорректное изображение подписи')
      run('UPDATE users SET signature = ?, signature_kind = ?, signature_text = ? WHERE id = ?',
        image, 'typed', text, userId)
    }
    res.json({ user: meUser(findUserById(userId)) })
  } catch (err) {
    next(err)
  }
})

export default router
