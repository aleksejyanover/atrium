#!/usr/bin/env node
/**
 * Полный сброс данных Atrium (SPEC v7 / запрос владельца):
 *  - ВСЁ содержимое стирается: организации, участники, каналы, сообщения,
 *    приглашения, документы, кошельки-платежи, журналы (activity/audit/login).
 *  - Аккаунты (строки users) СОХРАНЯЮТСЯ — войти можно тем же логином/паролем,
 *    но данные будут пустыми: balance=0, подпись удалена, is_owner=0,
 *    карта очищена, баны сняты.
 *  - Владелец (OWNER_USER, по умолчанию alex) получает пароль OWNER_PASS,
 *    is_owner=1 (карта с PIN генерируется при старте сервера) и снова
 *    является суперадмином через ATRIUM_ADMIN.
 *
 * Запуск (сервер лучше остановить):
 *   OWNER_PASS=... node scripts/reset-all.mjs
 */
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = process.env.ATRIUM_DB || path.join(root, 'data', 'atrium.db');
const ownerUser = process.env.OWNER_USER || 'alex';
const ownerPass = process.env.OWNER_PASS;

if (!ownerPass) {
  console.error('OWNER_PASS не задан — пароль владельца не изменён. Запуск отменён.');
  process.exit(1);
}

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');

// всё содержимое (связано с организациями/сообщениями/деньгами/журналами)
const emptyTables = [
  'activity',
  'audit_log',
  'login_log',
  'channel_members',
  'channel_reads',
  'channels',
  'documents',
  'invites',
  'members',
  'messages',
  'orgs',
  'payments',
];

const ownerHash = bcrypt.hashSync(String(ownerPass), 10);

const tx = db.transaction(() => {
  for (const t of emptyTables) db.prepare(`DELETE FROM "${t}"`).run();

  // данные пользователей обнуляются, аккаунты остаются
  db.prepare(
    `UPDATE users SET balance = 0, signature = NULL, signature_kind = NULL,
       signature_text = NULL, is_owner = 0, card_number = NULL, card_pin = NULL,
       banned = 0, last_login_at = NULL`,
  ).run();

  const owner = db.prepare('SELECT id FROM users WHERE username = ?').get(ownerUser);
  if (!owner) throw new Error(`Аккаунт владельца «${ownerUser}» не найден — сброс отменён`);

  db.prepare(
    `UPDATE users SET password_hash = ?, is_owner = 1, banned = 0, balance = 0
     WHERE id = ?`,
  ).run(ownerHash, owner.id);

  return owner.id;
});

const ownerId = tx();

const count = (t) => db.prepare(`SELECT count(*) c FROM "${t}"`).get().c;
console.log('=== RESET DONE ===');
console.log('аккаунтов (сохранены):', count('users'));
for (const t of emptyTables) console.log(`  ${t}: ${count(t)}`);
const owner = db.prepare(
  'SELECT username, is_owner, balance, card_number FROM users WHERE id = ?',
).get(ownerId);
console.log('владелец:', JSON.stringify(owner));
console.log('admin_settings (настройки бота) сохранены:', count('admin_settings'));
db.close();
