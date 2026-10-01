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
import {
  newId,
  avatarColorFor,
  publicUser,
  bad,
  conflict,
  unauthorized,
  str,
} from '../util.js'

const router = Router()

const USERNAME_RE = /^[a-z0-9_]{3,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

    const user = publicUser(findUserById(id))
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
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      throw unauthorized('Неверный логин или пароль')
    }
    const user = publicUser(row)
    res.json({ token: signToken(user), user })
  } catch (err) {
    next(err)
  }
})

// GET /api/me -> {user}
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

export default router
