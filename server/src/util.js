import crypto from 'node:crypto'

// ---- Roles / ranks (SPEC §2) ----
export const ROLES = {
  owner: { rank: 100, label: 'Владелец' },
  assistant_owner: { rank: 80, label: 'Помощник владельца' },
  admin: { rank: 60, label: 'Админ' },
  assistant_admin: { rank: 40, label: 'Помощник админа' },
  member: { rank: 20, label: 'Участник' },
}

export const isValidRole = (role) => Object.prototype.hasOwnProperty.call(ROLES, role)
export const rankOf = (role) => (ROLES[role] ? ROLES[role].rank : -1)
export const roleLabel = (role) => (ROLES[role] ? ROLES[role].label : role)

// ---- Ids: prefixes u_ o_ i_ c_ m_ + 12 random hex chars ----
export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`
}

// ---- avatarColor: palette of 12 muted colors, deterministic by id hash ----
const AVATAR_PALETTE = [
  '#7C6CF6', '#6C5CE7', '#3ECF8E', '#F0B429',
  '#F0506E', '#4DA3FF', '#B06CF6', '#3EC4C4',
  '#E8823A', '#8B8B94', '#5FBF7E', '#E05C9E',
]

export function avatarColorFor(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}

// ---- user row → public user shape ----
export function publicUser(row) {
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

// ---- org row → org shape ----
export function publicOrg(row, membersCount, channelsCount) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    createdAt: row.created_at,
    membersCount,
    channelsCount,
  }
}

// ---- channel row → channel shape ----
export function publicChannel(row) {
  if (!row) return null
  return {
    id: row.id,
    orgId: row.org_id,
    type: row.type,
    name: row.name,
    createdAt: row.created_at,
  }
}

// ---- validation helpers (Russian errors) ----
export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export const bad = (msg) => new HttpError(400, msg)
export const unauthorized = (msg = 'Требуется авторизация') => new HttpError(401, msg)
export const forbidden = (msg = 'Недостаточно прав') => new HttpError(403, msg)
export const notFound = (msg = 'Не найдено') => new HttpError(404, msg)
export const conflict = (msg = 'Конфликт') => new HttpError(409, msg)

// trim helper: returns trimmed string or null if not a string
export const str = (v) => (typeof v === 'string' ? v.trim() : null)

export function nowMs() {
  return Date.now()
}
