import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { rankOf, ADMIN_USERNAMES } from './util.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_PATH = process.env.ATRIUM_DB_PATH || path.join(DATA_DIR, 'atrium.db')

fs.mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = OFF')

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  display_name TEXT,
  avatar_color TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS orgs(
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  created_by TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS members(
  org_id TEXT,
  user_id TEXT,
  role TEXT,
  joined_at INTEGER,
  PRIMARY KEY(org_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites(
  id TEXT PRIMARY KEY,
  org_id TEXT,
  inviter_id TEXT,
  invitee_id TEXT,
  role TEXT,
  status TEXT CHECK(status IN ('pending','accepted','rejected','canceled')),
  contract_text TEXT,
  signature TEXT,
  signed_name TEXT,
  signed_at INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS channels(
  id TEXT PRIMARY KEY,
  org_id TEXT,
  type TEXT CHECK(type IN ('channel','dm')),
  name TEXT,
  created_by TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS channel_members(
  channel_id TEXT,
  user_id TEXT,
  PRIMARY KEY(channel_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  sender_id TEXT,
  text TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_org ON channels(org_id);
CREATE INDEX IF NOT EXISTS idx_invites_invitee ON invites(invitee_id, status);
CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);

-- ---------- SPEC v2 (§10): catalog + documents ----------
CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('join_application','dismissal')),
  target_user_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN
    ('pending','approved','signed','rejected','canceled','terminated')),
  message TEXT,
  contract_text TEXT NOT NULL,
  signature TEXT,
  signed_name TEXT,
  signed_at INTEGER,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS documents_target ON documents(target_user_id, status);
CREATE INDEX IF NOT EXISTS documents_org ON documents(org_id, type, status);

-- ---------- SPEC v3 (§18): read receipts + activity log ----------
CREATE TABLE IF NOT EXISTS channel_reads(
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE IF NOT EXISTS activity(
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_org ON activity(org_id, created_at DESC);

-- ---------- SPEC v4 (§23): creator panel ----------
CREATE TABLE IF NOT EXISTS login_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  success INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_created ON audit_log(created_at DESC);
CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT);

-- ---------- SPEC v4 (§24): finance ----------
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  from_user_id TEXT,
  to_user_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('topup','transfer','salary','treasury_deposit')),
  amount INTEGER NOT NULL CHECK(amount > 0),
  note TEXT,
  card_mask TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_user ON payments(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_org ON payments(org_id, created_at DESC);
`)

// ---- idempotent column migrations (SPEC v2 §10, v2.1 §17) ----
// NEVER touch the DB file itself: guarded ALTER TABLE with PRAGMA table_info check.
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all()
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${ddl}`)
  }
}

ensureColumn('orgs', 'is_public', 'INTEGER DEFAULT 1') // visible in catalog
ensureColumn('users', 'full_name', 'TEXT') // ФИО для договоров (SPEC v3 §17)
ensureColumn('users', 'signature', 'TEXT') // signature image (data:image/...)
ensureColumn('users', 'signature_kind', "TEXT") // 'drawn' | 'text' | NULL
ensureColumn('users', 'signature_text', 'TEXT') // text signature (kind='text')
ensureColumn('invites', 'signature_kind', "TEXT") // 'png' | 'text' (NULL => 'png')
ensureColumn('invites', 'signature_text', 'TEXT')
ensureColumn('documents', 'signature_kind', "TEXT") // 'png' | 'text'
ensureColumn('documents', 'signature_text', 'TEXT')

// ---- SPEC v4 §23: creator panel + §24: finance ----
ensureColumn('users', 'banned', 'INTEGER DEFAULT 0')
ensureColumn('users', 'last_login_at', 'INTEGER')
ensureColumn('users', 'balance', 'INTEGER DEFAULT 0') // personal wallet, integer rubles
ensureColumn('orgs', 'balance', 'INTEGER DEFAULT 0') // org treasury, integer rubles

/** Run fn inside a single SQLite transaction (all balance mutations, SPEC v4 §24). */
export function transaction(fn) {
  return db.transaction(fn)()
}

// ---- statement cache + query helpers ----
const stmtCache = new Map()
function prep(sql) {
  let s = stmtCache.get(sql)
  if (!s) {
    s = db.prepare(sql)
    stmtCache.set(sql, s)
  }
  return s
}

export function get(sql, ...params) {
  return prep(sql).get(...params)
}
export function all(sql, ...params) {
  return prep(sql).all(...params)
}
export function run(sql, ...params) {
  return prep(sql).run(...params)
}

// ---- common data-access helpers ----
export const findUserById = (id) => get('SELECT * FROM users WHERE id = ?', id)
export const findUserByUsername = (username) => get('SELECT * FROM users WHERE username = ?', username)
export const findUserByEmail = (email) => get('SELECT * FROM users WHERE email = ?', email)

export const findOrg = (id) => get('SELECT * FROM orgs WHERE id = ?', id)
export const findMember = (orgId, userId) =>
  get('SELECT * FROM members WHERE org_id = ? AND user_id = ?', orgId, userId)

export const orgMembers = (orgId) =>
  all(
    `SELECT u.*, m.role AS m_role, m.joined_at AS m_joined_at
     FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = ?
     ORDER BY m.joined_at ASC`,
    orgId
  )

export const orgMemberIds = (orgId) =>
  all('SELECT user_id FROM members WHERE org_id = ?', orgId).map((r) => r.user_id)

/** Members of org with rank >= 40 (staff: assistant_admin, admin, assistant_owner, owner). */
export const orgStaffIds = (orgId) =>
  all('SELECT user_id, role FROM members WHERE org_id = ?', orgId)
    .filter((r) => rankOf(r.role) >= 40)
    .map((r) => r.user_id)

export const orgChannels = (orgId) =>
  all("SELECT * FROM channels WHERE org_id = ? AND type = 'channel' ORDER BY created_at ASC", orgId)

export const countOrgMembers = (orgId) =>
  get('SELECT COUNT(*) AS c FROM members WHERE org_id = ?', orgId).c

export const countOrgChannels = (orgId) =>
  get("SELECT COUNT(*) AS c FROM channels WHERE org_id = ? AND type = 'channel'", orgId).c

export const findChannel = (id) => get('SELECT * FROM channels WHERE id = ?', id)

export const isChannelMember = (channelId, userId) =>
  !!get('SELECT 1 AS x FROM channel_members WHERE channel_id = ? AND user_id = ?', channelId, userId)

export const channelMemberIds = (channelId) =>
  all('SELECT user_id FROM channel_members WHERE channel_id = ?', channelId).map((r) => r.user_id)

export const findInvite = (id) => get('SELECT * FROM invites WHERE id = ?', id)

export const userById = (id) => findUserById(id)

// ---- SPEC v3 §18: read receipts + unread counts ----

/** Unread message count of one channel for user (capped at last 100 messages). */
export const channelUnread = (channelId, userId) =>
  get(
    `SELECT COUNT(*) AS c FROM (
       SELECT 1 FROM messages m
       LEFT JOIN channel_reads r ON r.channel_id = m.channel_id AND r.user_id = ?
       WHERE m.channel_id = ? AND m.created_at > COALESCE(r.last_read_at, 0)
       ORDER BY m.created_at DESC
       LIMIT 100)`,
    userId,
    channelId
  ).c

/** Total unread of an org for user: its channels + user's DMs inside the org. */
export const orgUnread = (orgId, userId) =>
  get(
    `SELECT COUNT(*) AS c FROM (
       SELECT m.id FROM messages m
       JOIN channels c ON c.id = m.channel_id
       LEFT JOIN channel_reads r ON r.channel_id = c.id AND r.user_id = ?
       WHERE c.org_id = ?
         AND m.created_at > COALESCE(r.last_read_at, 0)
         AND (c.type = 'channel'
              OR EXISTS (SELECT 1 FROM channel_members cm
                         WHERE cm.channel_id = c.id AND cm.user_id = ?))
       ORDER BY m.created_at DESC
       LIMIT 100)`,
    userId,
    orgId,
    userId
  ).c

/** Set last_read_at = max(current, at) for (channel, user). */
export const touchChannelRead = (channelId, userId, at) =>
  run(
    `INSERT INTO channel_reads (channel_id, user_id, last_read_at) VALUES (?,?,?)
     ON CONFLICT(channel_id, user_id)
     DO UPDATE SET last_read_at = MAX(last_read_at, excluded.last_read_at)`,
    channelId,
    userId,
    at
  )

export const channelReads = (channelId) =>
  all('SELECT user_id, last_read_at FROM channel_reads WHERE channel_id = ?', channelId)
    .map((r) => ({ userId: r.user_id, lastReadAt: r.last_read_at }))

/** User ids of org members having a pending dismissal document. */
export const pendingDismissalUserIds = (orgId) =>
  all(
    "SELECT target_user_id FROM documents WHERE org_id = ? AND type = 'dismissal' AND status = 'pending'",
    orgId
  ).map((r) => r.target_user_id)

export const countPendingApplications = (orgId) =>
  get(
    "SELECT COUNT(*) AS c FROM documents WHERE org_id = ? AND type = 'join_application' AND status = 'pending'",
    orgId
  ).c

// ---- membership removal (used by kick/leave/dismissal) ----

/** Delete membership + remove user from all channel_members of org's channels. */
export function removeMemberFromOrg(orgId, userId) {
  run('DELETE FROM members WHERE org_id = ? AND user_id = ?', orgId, userId)
  run(
    `DELETE FROM channel_members
     WHERE user_id = ?
       AND channel_id IN (SELECT id FROM channels WHERE org_id = ?)`,
    userId,
    orgId
  )
}

// ---- SPEC v4 §23: superadmin (creator) helpers ----

/** Ids of registered users whose username is in the superadmin list (env ATRIUM_ADMIN). */
export const superadminIds = () => {
  if (!ADMIN_USERNAMES.length) return []
  const holes = ADMIN_USERNAMES.map(() => '?').join(',')
  return all(`SELECT id FROM users WHERE username IN (${holes})`, ...ADMIN_USERNAMES).map((r) => r.id)
}

/** System bot user id (SPEC v4 §23), exists only once created lazily. */
export const BOT_ID = 'u_bot'
