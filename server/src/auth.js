import jwt from 'jsonwebtoken'
import { findUserById, findMember, get } from './db.js'
import { unauthorized, forbidden, notFound, publicUser, rankOf } from './util.js'

const SECRET = process.env.JWT_SECRET || 'atrium-dev-secret'
const EXPIRES_IN = '30d'

export function signToken(user) {
  return jwt.sign({ sub: user.id }, SECRET, { expiresIn: EXPIRES_IN })
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, SECRET)
    return payload && typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

/** Express middleware: requires `Authorization: Bearer <token>`, sets req.user (public shape) + req.userId */
export function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const m = /^Bearer\s+(.+)$/i.exec(header)
    if (!m) throw unauthorized('Требуется авторизация')
    const userId = verifyToken(m[1])
    if (!userId) throw unauthorized('Недействительный или истёкший токен')
    const row = findUserById(userId)
    if (!row) throw unauthorized('Пользователь не найден')
    req.user = publicUser(row)
    req.userId = row.id
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Membership guard for /api/orgs/:id/* routes.
 * Sets req.org, req.member ({role, joinedAt}), req.rank.
 * 404 if org missing, 403 if not a member.
 */
export function requireOrgMember(req, res, next) {
  try {
    const org = findOrgSafe(req.params.id)
    const member = findMember(org.id, req.userId)
    if (!member) throw forbidden('Вы не являетесь участником этой организации')
    req.org = org
    req.member = member
    req.rank = rankOf(member.role)
    next()
  } catch (err) {
    next(err)
  }
}

/** Rank guard factory: `requireRank(60)` etc. (call after requireOrgMember) */
export function requireRank(minRank, message = 'Недостаточно прав') {
  return (req, res, next) => {
    if (req.rank >= minRank) return next()
    next(forbidden(message))
  }
}

export function findOrgSafe(id) {
  const org = typeof id === 'string' ? get('SELECT * FROM orgs WHERE id = ?', id) : null
  if (!org) throw notFound('Организация не найдена')
  return org
}
