import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

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
`)

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
