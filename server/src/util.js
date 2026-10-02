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

// ---- Superadmin list (SPEC v4 §23): usernames, NOT roles ----
export const ADMIN_USERNAMES = (
  process.env.ATRIUM_ADMIN?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
) || ['alex']

export const isAdminUsername = (username) =>
  !!username && ADMIN_USERNAMES.includes(String(username).toLowerCase())

// ---- Money: integer rubles, space thousands (SPEC v4 §24) ----
export const rub = (n) => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

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

/** publicUser + own signature fields (SPEC v2.1/v3 §17) — for /api/me responses ONLY. */
export function meUser(row) {
  if (!row) return null
  return {
    ...publicUser(row),
    fullName: row.full_name ?? null,
    signature: row.signature ?? null,
    signatureKind: row.signature_kind ?? null,
    signatureText: row.signature_text ?? null,
    // SPEC v4 §23/§25: computed on the server, never accepted from the client
    isAdmin: isAdminUsername(row.username),
    balance: row.balance ?? 0,
  }
}

/** User reference usable both flat and nested: {id, ..., user:{id,...}} (house style). */
export function userRef(row) {
  const u = publicUser(row)
  return u ? { ...u, user: u } : { user: null }
}

/**
 * Relaxed contract signature (SPEC §17): EITHER signatureDataUrl (data:image/...)
 * OR signatureText (2..80 chars) is required, otherwise 400 «Добавьте подпись».
 * Returns { signature, signatureKind:'png'|'text', signatureText }.
 */
export function contractSignature(body) {
  const dataUrl = typeof body?.signatureDataUrl === 'string' ? body.signatureDataUrl.trim() : ''
  const text = typeof body?.signatureText === 'string' ? body.signatureText.trim() : ''
  if (dataUrl.startsWith('data:image/')) {
    return { signature: dataUrl, signatureKind: 'png', signatureText: null }
  }
  if (text) {
    if (text.length < 2 || text.length > 80) throw bad('Текст подписи: 2–80 символов')
    return { signature: null, signatureKind: 'text', signatureText: text }
  }
  throw bad('Добавьте подпись')
}

/** ФИО check for contract signing. */
export function requireSignedName(body) {
  const signedName = str(body?.signedName)
  if (!signedName || signedName.length < 2) throw bad('Укажите ФИО (не менее 2 символов)')
  return signedName
}

/**
 * Signature fields of a signed entity row (invites/documents), SPEC §17.
 * Legacy rows with signature_kind = NULL are treated as 'png'.
 */
export function signedFields(row) {
  const hasSignature = !!row.signature || !!row.signature_text
  return {
    signature: row.signature ?? null,
    signatureKind: hasSignature ? row.signature_kind || 'png' : null,
    signatureText: row.signature_text ?? null,
    signedName: row.signed_name ?? null,
    signedAt: row.signed_at ?? null,
  }
}

/**
 * documents row → API shape (SPEC v2 §10–12, v2.1 §17).
 * Used for both `join_application` and `dismissal` documents.
 */
export function documentDto(row) {
  if (!row) return null
  return {
    id: row.id,
    orgId: row.org_id,
    type: row.type,
    targetUserId: row.target_user_id,
    createdBy: row.created_by,
    status: row.status,
    message: row.message ?? null,
    contractText: row.contract_text,
    ...signedFields(row),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
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
    // SPEC v2 §12: catalog visibility. Missing column value (legacy row) => public.
    isPublic: row.is_public === undefined || row.is_public === null ? true : !!row.is_public,
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
