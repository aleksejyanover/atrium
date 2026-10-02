# Atrium — Specification (source of truth)

**Atrium** — a dark, minimalistic messenger for companies/organizations.
Monorepo with three parts:

```
atrium/
  SPEC.md          <- this file (the contract between all parts)
  server/          <- Node 20 backend (REST + Socket.IO + SQLite)
  web/             <- React + Vite web app (responsive, works on phones too)
  mobile/          <- Expo (React Native) mobile app
```

**All UI text is in Russian.** Code/identifiers in English.

Environment notes:
- Node `v20.20.2` via nvm. Every shell command must start with
  `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`.
- No TypeScript type-checking is shared between parts; each part owns its own types.
- Server port: **4000**. Web dev port: **5173** (proxy `/api` and `/socket.io` → `http://localhost:4000`).

---

## 1. Design language (dark, minimalistic)

No light theme. Only dark. CSS variables (web) / StyleSheet constants (mobile):

| Token          | Value     | Usage                          |
|----------------|-----------|--------------------------------|
| `--bg`         | `#0A0A0C` | app background                 |
| `--panel`      | `#121216` | sidebars, cards                |
| `--panel-2`    | `#17171C` | hover / secondary surfaces     |
| `--border`     | `#232329` | 1px hairline borders           |
| `--text`       | `#ECECEF` | primary text                   |
| `--muted`      | `#8B8B94` | secondary text                 |
| `--accent`     | `#7C6CF6` | violet accent (buttons, active)|
| `--accent-2`   | `#6C5CE7` | accent hover                   |
| `--danger`     | `#F0506E` | destructive actions            |
| `--ok`         | `#3ECF8E` | online / success               |

Rules:
- Font: `Inter, -apple-system, system-ui, sans-serif` (load Inter from Google Fonts in web).
- Border radius: 10–14px. Borders 1px `--border`. No heavy shadows (max `0 8px 30px rgba(0,0,0,.4)` on modals).
- Buttons: accent-filled primary, hairline ghost secondary. Subtle 150ms transitions.
- Icons: inline SVG (simple strokes) or `lucide-react` on web; `@expo/vector-icons` (Feather) on mobile.
- Avatars: colored circle with 1–2 initials, color from `avatarColor` field.
- Empty states: small muted text, centered.

---

## 2. Roles

Enum `role` (stored as string):

| role               | ru label                | rank |
|--------------------|-------------------------|------|
| `owner`            | Владелец                | 100  |
| `assistant_owner`  | Помощник владельца      | 80   |
| `admin`            | Админ                   | 60   |
| `assistant_admin`  | Помощник админа         | 40   |
| `member`           | Участник                | 20   |

Permission matrix (`actor` = acting member of org, `target` = another member):

| Action                                   | Rule |
|------------------------------------------|------|
| Invite user to org                       | rank ≥ 40 |
| Change role of target                    | owner → any target except owner; otherwise actor.rank > target.rank AND newRole.rank < actor.rank |
| Remove target from org                   | owner → anyone except owner; else actor.rank > target.rank |
| Leave org (self)                         | anyone except owner |
| Create channel                           | rank ≥ 40 |
| Edit org (name/description)              | rank ≥ 60 |
| View pending invites of org              | rank ≥ 40 |
| Cancel pending invite                    | inviter self, or owner, or rank ≥ 60 |
| Delete any message                       | author, or rank ≥ 60 |
| Chat / calls (all members)               | always |

---

## 3. REST API

Base: `http://localhost:4000`. All authed routes: header `Authorization: Bearer <token>`.
Errors: JSON `{ "error": "human-readable Russian message" }` with proper HTTP status (400/401/403/404/409).
Success: JSON object directly (no envelope).

### Auth
- `POST /api/auth/register` `{username, displayName, email, password}` → `201 {token, user}`
  - username: 3–20 chars, `[a-z0-9_]`, unique (case-insensitive); email unique; password ≥ 6 chars.
- `POST /api/auth/login` `{login, password}` → `{token, user}` (`login` = username or email).
- `GET /api/me` → `{user}`.

`user` shape:
```json
{ "id": "u_xxx", "username": "alex", "displayName": "Алексей", "email": "a@b.c",
  "avatarColor": "#7C6CF6", "createdAt": 1712345678000 }
```
`avatarColor` picked deterministically from a palette of 12 muted colors by hash of id; never accepted from client.

### Users
- `GET /api/users/search?q=` → `{users: [user, ...]}` — up to 15 matches by username/displayName (substring), any authed user.

### Organizations
- `POST /api/orgs` `{name, description?}` → `201 {org, role: "owner"}`
  - creator becomes `owner`; creates default channel `#general` (name `general`); description optional.
  - `org` shape: `{id, name, description, createdAt, membersCount, channelsCount}`.
- `GET /api/orgs` → `{orgs: [{...org, role, unread?:0}]}` — orgs the caller belongs to.
- `GET /api/orgs/:id` → `{org, role, members: [{user, role, joinedAt}], channels: [{id, name, createdAt}]}` (member only, else 403/404).
- `PATCH /api/orgs/:id` `{name?, description?}` → `{org}` (rank ≥ 60).
- `POST /api/orgs/:id/leave` → `{ok:true}` (owner cannot leave → 409).

### Invitations + contract
- `POST /api/orgs/:id/invite` `{usernameOrEmail, role}` → `201 {invite}`
  - rank rules per matrix; `role` must be rank < actor.rank (owner exception: any except owner); target must be a real user, not a member, no existing pending invite (409 otherwise).
  - On creation, server snapshots `contractText` (template below) into the invite row.
  - `invite` (for inviter side): `{id, orgId, invitee:{user}, inviter:{user}, role, status:"pending", createdAt, contractText}`.
- `GET /api/invites` → `{invites: [ {invite, org:{id,name}, inviter:{user}, role, contractText, createdAt} ] }` — caller's incoming **pending** invites.
- `GET /api/orgs/:id/invites` → `{invites:[invite...]}` — org's pending invites (rank ≥ 40).
- `POST /api/invites/:id/accept` `{signatureDataUrl, signedName}` → `{org, role}`
  - `signatureDataUrl` = `data:image/png;base64,...` drawn by user (required, must start with `data:image/`); `signedName` = 2+ chars full name typed by user (required).
  - Sets `status:"accepted"`, stores `signature`, `signedName`, `signedAt`; creates membership row.
- `POST /api/invites/:id/decline` → `{ok:true}` (sets `status:"rejected"`).
- `DELETE /api/invites/:id` → `{ok:true}` — cancel pending (permission per matrix).

**Contract template** (Russian, stored per invite; may include org/user/role names, filled at creation):

```
ДОГОРОР О ПРИСОЕДИНЕНИИ К ОРГАНИЗАЦИИ «{orgName}»

Я, нижеподписавшийся(яся) ______________ (ФИО), через настоящее соглашение
подтверждаю своё добровольное присоединение к организации «{orgName}»
в роли «{roleLabel}».

1. Я ознакомился(лась) с правилами организации и обязуюсь их соблюдать.
2. Я получаю доступ к внутренним каналам связи, чатам и звонкам организации.
3. Я согласен(на) на обработку данных, необходимых для работы внутри организации.
4. Настоящий договор вступает в силу с момента подписания и может быть
   расторгнут мною в любой момент через выход из организации.

Дата подписи: {date}
Роль: {roleLabel}

Подпись: {signature image is appended by the app after drawing}
```

### Members
- `PATCH /api/orgs/:id/members/:userId` `{role}` → `{member:{user, role, joinedAt}}` (matrix rules).
- `DELETE /api/orgs/:id/members/:userId` → `{ok:true}` (matrix rules; or self-leave).

### Channels & messages
- `GET /api/orgs/:id/channels` → `{channels:[{id, orgId, name, type:"channel", createdAt}]}`.
- `POST /api/orgs/:id/channels` `{name}` → `201 {channel}` (rank ≥ 40; name 1–40 chars, unique per org, case-insensitive).
- `GET /api/dms` → `{dms:[{channel, peer:user, org:{id,name}}]}` — all DM channels of caller (both members).
- `POST /api/dms` `{orgId, userId}` → `{channel, peer}` — find-or-create DM between caller and `userId` inside `orgId` (both must be org members). Self → 400.
- `GET /api/channels/:id` → `{channel, org:{id,name}, peer?:user}` — caller must have access (org member for `type:"channel"`, member of dm for `type:"dm"`).
- `GET /api/channels/:id/messages?before=<messageId>&limit=50` → `{messages:[msg...], hasMore:boolean}`
  - `msg`: `{id, channelId, sender:{id,username,displayName,avatarColor}, text, createdAt}` ordered by `createdAt` ASC; fetch the **page immediately before** `before` (or latest page when no `before`); `limit` default 50, max 100.
- `DELETE /api/messages/:id` → `{ok:true}` (author or rank ≥ 60 in the message's org).

### Health
- `GET /api/health` → `{ok:true}`.

---

## 4. Socket.IO protocol

Connect: `io("http://localhost:4000", { auth: { token } })`. Server validates JWT in `handshake.auth.token`; rejects connection if invalid.

### Client → Server (all use acks: `socket.emit(event, payload, (res)=>...)`, response is `{ok:true, ...}` or `{error:"..."}`)
- `message:send` `{channelId, text, tempId?}` → ack `{ok, message}` — text 1..4000 trimmed; caller must have channel access; server also emits `message:new` **only to sender** with `tempId` included so sender can reconcile (or just return message in ack — sender does not need `message:new`); other recipients get `message:new`.
- `typing` `{channelId, typing:true|false}` → no ack needed; server relays `typing` `{channelId, user:{id,...}}` to other members (throttled server-side ≥1 per 2s per channel).
- `call:invite` `{calleeId, kind:"video"|"audio", channelId?}` → ack `{ok, callId}` — callee must share ≥1 org with caller; 409-like `{error}` if callee already in a call (server tracks in-memory). Server emits `call:incoming` `{callId, from:{user,displayName...}, kind, channelId?}` to callee.
- `call:accept` `{callId}` → ack `{ok}`; server emits `call:accepted` `{callId}` to caller.
- `call:reject` `{callId}` → ack `{ok}`; server emits `call:rejected` `{callId}` to caller.
- `call:leave` `{callId}` → ack `{ok}`; server emits `call:left` `{callId}` to the other peer; removes call.
- `call:state` `{callId, muted, cameraOff}` → relayed to peer as `call:state`.
- `rtc:sdp` `{callId, to, sdp}` → relayed to `to` as `rtc:sdp` `{callId, from, sdp}`.
- `rtc:ice` `{callId, to, candidate}` → relayed as `rtc:ice` `{callId, from, candidate}`.

### Server → Client
- `message:new` `{message}` (message includes `tempId?` when it came from sender — sender normally gets it via ack instead; server MAY also emit to sender with tempId, client must be idempotent by `id`).
- `typing` `{channelId, user, typing}`.
- `invite:new` `{invite, org, inviter}` — to invitee when an invite is created.
- `member:joined` `{orgId, user, role}` / `member:left` `{orgId, userId}` / `role:changed` `{orgId, userId, role}` — to all org members (fan-out via server-side membership lookup; small scale, OK to emit per member socket).
- `channel:created` `{orgId, channel}` — to org members.
- `call:incoming` / `call:accepted` / `call:rejected` / `call:left` / `call:state` / `rtc:sdp` / `rtc:ice` — as above.
- `presence:update` `{userId, online:boolean}` — broadcast on connect/disconnect.

### Call flow (WebRTC, 1:1, server is signaling only)
1. Caller `call:invite` → gets `callId`, shows "вызов…" state, creates `RTCPeerConnection`, creates offer → `rtc:sdp`.
2. Callee gets `call:incoming`, shows incoming modal (Accept/Decline). On accept: `call:accept`, creates PC, receives offer → answer via `rtc:sdp`. Both exchange `rtc:ice`.
3. Either side `call:leave` ends it. 1:1 only. STUN: `stun:stun.l.google.com:19302`. No TURN (document limitation).
4. `channelId` present when call started from a chat — UI shows "звонок в чате" but messages are unrelated.

---

## 5. SQLite schema (server, WAL mode)

```sql
users(id TEXT PK, username TEXT UNIQUE COLLATE NOCASE, email TEXT UNIQUE COLLATE NOCASE,
      password_hash TEXT, display_name TEXT, avatar_color TEXT, created_at INTEGER)
orgs(id TEXT PK, name TEXT, description TEXT, created_by TEXT, created_at INTEGER)
members(org_id TEXT, user_id TEXT, role TEXT, joined_at INTEGER, PRIMARY KEY(org_id,user_id))
invites(id TEXT PK, org_id TEXT, inviter_id TEXT, invitee_id TEXT, role TEXT,
        status TEXT CHECK(status IN ('pending','accepted','rejected','canceled')),
        contract_text TEXT, signature TEXT, signed_name TEXT, signed_at INTEGER, created_at INTEGER)
channels(id TEXT PK, org_id TEXT, type TEXT CHECK(type IN ('channel','dm')), name TEXT,
         created_by TEXT, created_at INTEGER)
channel_members(channel_id TEXT, user_id TEXT, PRIMARY KEY(channel_id,user_id))
messages(id TEXT PK, channel_id TEXT, sender_id TEXT, text TEXT, created_at INTEGER)
```
- DM channel: `type='dm'`, `channel_members` = exactly the two users, `name = NULL`.
- `#general` channel is created for every org.
- Ids: `u_`, `o_`, `i_`, `c_`, `m_` prefixes + 12 random hex chars.
- Passwords: `bcryptjs` (pure JS, no native build). JWT: `jsonwebtoken`, secret from `process.env.JWT_SECRET || 'atrium-dev-secret'`, expiry 30d.

Dependencies (server): `express`, `cors`, `socket.io`, `better-sqlite3`, `bcryptjs`, `jsonwebtoken`.
If `better-sqlite3` native build fails → fallback to `node:sqlite` polyfill is NOT available on Node 20; use `sql.js`? **No** — try `better-sqlite3` prebuilds first (they exist for Node 20 arm64); if install fails, use plain JSON-file storage ONLY as last resort and keep the same data-access functions.

Data file: `server/data/atrium.db` (gitignored). `POST /api/auth/register` seeds nothing else.

---

## 6. Web app (`web/`)

Stack: **Vite + React 18 + TypeScript**, `react-router-dom`, `socket.io-client`, no UI framework (hand-written CSS with the tokens above). Dev proxy in `vite.config.ts` for `/api` and `/socket.io` (ws:true) → `http://localhost:4000`.

Routes:
- `/login`, `/register` — auth pages (centered card on `--bg`, subtle violet gradient glow behind card).
- `/` — main app (redirect to `/login` if no token).
  - Layout: left sidebar (org switcher at top, channel list, "Прямые сообщения" list with peers, + создать канал (rank≥40), invites badge, profile at bottom with logout).
  - Main pane: chat header (name, members count, call buttons 🎥/📞), messages list (date separators, own messages right-aligned accent-tinted bubble, others left with avatar), typing indicator, message input with Enter-to-send, hover actions (delete if allowed).
  - Right panel (toggle): Участники (list w/ role badges + role menu for permitted users), Приглашения (pending, with cancel), Информация (org, edit if permitted), button "Покинуть организацию".
  - Invites screen: accessible from sidebar badge → list of incoming invites with **contract view + signature pad**: scrollable contract text, `<input>` for ФИО ("Введите ФИО как в документе"), canvas signature drawing (pointer events; mouse/touch; "Очистить" button), submit disabled until both name (≥2 chars) and a drawn stroke exist; confirm modal showing signature, then accept → org appears in sidebar.
- Top-right global: incoming call modal (caller avatar/name/kind, Accept/Decline with pulse animation), and fullscreen active-call view: local video (mirrored, small pip + big remote), mute mic / camera off / hang up buttons, connection status.
- Calls: hook `useWebRTC` manages `RTCPeerConnection`, getUserMedia (audio+video for video call, audio only for audio call), ICE, and call state machine: `idle | outgoing | incoming | connecting | active | ended`.

Behavior:
- Auth token in `localStorage` (`atrium_token`). On 401 → logout.
- Socket connects after login; reconnect on token change; store messages in component state per channel; on channel switch load last 50 messages; scroll to bottom on new; load older on scroll top ("Загрузить ещё").
- Unread counts optional (nice-to-have, not required).
- All copy in Russian, e.g.: «Войти», «Регистрация», «Создать организацию», «Пригласить участника», «Договор о присоединении», «Распишитесь здесь», «Очистить», «Подписать и вступить», «Видеозвонок», «Аудиозвонок», «Входящий вызов…», «Нет участников», «Напишите сообщение…».
- `npm run build` must pass with zero TS errors; dev server `npm run dev`.

## 7. Mobile app (`mobile/`)

Stack: **Expo (latest SDK) + TypeScript**, `expo-router` (default template), `socket.io-client`, `@react-native-async-storage/async-storage` (token), `react-native-webrtc` (add via `npx expo install react-native-webrtc` + app.json plugin config), `@expo/vector-icons` (Feather).

Screens (dark theme, same tokens, same Russian copy):
- Auth: `/login`, `/register` — same as web.
- `/(app)/index` — org list (or last org shortcut) → actually: org picker screen: cards with name, role badge, members count; «Создать организацию» button; badge for incoming invites.
- `/(app)/org/[id]` — tabs: **Чаты** (channels + DMs), **Участники** (roles, role editor via bottom sheet/action modal if permitted), **Приглашения** (incoming list → contract signing screen; pending outgoing list if permitted).
- `/(app)/chat/[channelId]` — messages, input, typing, header with call buttons; realtime via socket.
- Contract signing screen: scrollable contract text (react-native-webview NOT needed — plain ScrollView text), TextInput ФИО, **signature pad drawn with PanResponder** (store array of strokes, render with `react-native-svg` Paths; «Очистить»; submit disabled until name + strokes), confirm alert with preview → POST accept.
- Incoming call modal (full screen) + active call screen with `react-native-webrtc` (RTCView remote/local, mute, camera flip/off, hang up).
- Profile/logout somewhere on org picker screen.

Since native camera can't run in this environment, correctness is verified by `npx tsc --noEmit` passing (add tsconfig if template lacks one) — document in README how to run: `npm install`, `npx expo start`, scan QR with Expo Go (note: video calls require a development build OR Expo Go with webrtc included — if uncertain, note both options in README).

Reuse identical REST + socket protocol from this SPEC. API base URL configurable: `EXPO_PUBLIC_API_URL` env, default `http://localhost:4000` (phone: use LAN IP — README explains).

## 8. Repo / README

- Root `README.md` (Russian): what Atrium is, features list, screenshot placeholder, how to run server / web / mobile, roles table, tech stack, limitations (1:1 calls, no TURN, no file uploads).
- `.gitignore` at root: `node_modules`, `dist`, `.expo`, `server/data`, `*.db`, `.env`.
- `server/package.json` scripts: `dev` (node --watch or nodemon), `start`. Root README documents ports.

## 9. Definition of done

1. `cd server && npm i && npm run dev` → `GET /api/health` = ok; DB auto-created.
2. `cd web && npm i && npm run dev` → full flow works in browser (two accounts: register, create org, invite, sign contract with drawn signature, chat realtime, role change, video call UI works between two tabs*).
3. `cd mobile && npm i && npx tsc --noEmit` → 0 errors.
4. Dark-only, minimal, coherent UI everywhere; all copy Russian.
5. No leftover TODOs in critical paths; no console errors in web during normal flow.

---

# SPEC v2 — Каталог организаций, заявления, договор об увольнении

Всё ниже ДОПОЛНЯЕТ разделы 1–7 (не отменяет). Требование ко всем частям:
**работать с существующей БД `server/data/atrium.db` без потери данных** —
миграции только идемпотентные (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... `
обёрнутый в try/catch, `PRAGMA table_info` проверка колонки). Удалять/пересоздавать
файл БД ЗАПРЕЩЕНО (там уже есть аккаунты и организации пользователей).

## 10. Новая модель данных

```sql
ALTER TABLE orgs ADD COLUMN is_public INTEGER DEFAULT 1;   -- публична ли в каталоге

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('join_application','dismissal')),
  target_user_id TEXT NOT NULL,      -- кто подписывает (заявитель / увольняемый)
  created_by TEXT NOT NULL,          -- кто инициировал
  status TEXT NOT NULL CHECK(status IN
    ('pending','approved','signed','rejected','canceled','terminated')),
  message TEXT,                      -- комментарий к заявлению / причина увольнения
  contract_text TEXT NOT NULL,
  signature TEXT,                    -- data:image/... после подписи
  signed_name TEXT,
  signed_at INTEGER,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS documents_target ON documents(target_user_id, status);
CREATE INDEX IF NOT EXISTS documents_org ON documents(org_id, type, status);
```

Статусы:
- `join_application`: `pending` → `approved` (штат принял, участник создан) | `rejected` (штат отклонил) | `canceled` (заявитель отозвал).
- `dismissal`: `pending` → `signed` (сотрудник подписал → членство удалено) | `rejected` (сотрудник оспорил, остаётся) | `canceled` (штат отменил, остаётся) | `terminated` (штат расторг в одностороннем порядке → членство удалено).

Старый поток приглашений (`invites`) остаётся как есть (это тоже договор на вступление).

## 11. Тексты договоров

- **Заявление на вступление** (`join_application.contract_text`) — ТОТ ЖЕ шаблон
  «ДОГОРОР О ПРИСОЕДИНЕНИИ...», что в `invites` (см. раздел 3, единая функция).
- **Договор об увольнении** (`dismissal.contract_text`), русский, поля заполняются
  при создании:

```
ДОГОВОР ОБ УВОЛЬНЕНИИ ИЗ ОРГАНИЗАЦИИ «{orgName}»

Я, нижеподписавшийся(яся) ______________ (ФИО), настоящим подтверждаю
прекращение моего участия в организации «{orgName}» в роли «{roleLabel}».

Причина: {reason | "по собственному желанию" если инициатор — сам сотрудник,
         иначе "по инициативе организации"}

1. С моего участия в организация снимаются все обязательства, связанные
   с доступом к каналам, чатам и звонкам организации.
2. Доступ к внутренним ресурсам организации прекращается с момента подписи.
3. Настоящий договор вступает в силу с момента подписи и является окончательным.

Дата: {date}
Роль: {roleLabel}

Подпись: {изображение подписи добавляется приложением после отрисовки}
```

## 12. REST API v2 (все — Authorization: Bearer)

### Организации (изменения)
- `POST /api/orgs` — принимает дополнительно `isPublic?: boolean` (по умолчанию `true`).
- `PATCH /api/orgs/:id` — принимает `isPublic?` (rank ≥ 60).
- `GET /api/orgs/:id` — в ответ добавить: `pendingApplications` (count, для rank≥40, иначе 0),
  в каждый элемент `members[]` поле `dismissalPending?: true` если у участника
  pending-dismissal документ (видно rank≥40, остальным скрывать).

### Каталог (новое)
- `GET /api/discover?q=` → `200 {orgs: [{id, name, description, createdAt,
  membersCount, isMember:boolean, myRole|null}]}`
  - только `is_public = 1`; до 30 штук, сортировка `membersCount DESC, name ASC`;
  - `q` — подстрока по name/description (без учёта регистра), без `q` — все.
  - доступно любому авторизованному пользователю.

### Заявления на вступление (новое, `documents.type='join_application'`)
- `POST /api/orgs/:id/applications` `{message?, signatureDataUrl, signedName}` → `201 {application}`
  - доступ: авторизован, НЕ член организации; валидация подписи как в `/invites/:id/accept`
    (`data:image/` обязателен, `signedName` ≥ 2 символов, `message` ≤ 500);
  - 409 если уже член / уже pending-заявление / уже pending-приглашение;
  - `contract_text` шаблон вступления (заполняется на момент создания);
  - `created_by = target_user_id = applicant`.
- `GET /api/applications/mine` → `{applications: [{application, org:{id,name,isPublic}}]}`
  — мои заявления (все статусы, 50 последних, pending сверху).
- `GET /api/orgs/:id/applications` → `{applications: [{application, user:{...applicant}}]}`
  — заявления организации, rank ≥ 40 (50 последних, pending сверху); 403 иначе.
- `POST /api/applications/:id/accept` → `{application}` — rank ≥ 40 в орг.: статус
  `approved`, создаётся `members` (роль: **`member`** всегда — повышает штат),
  возвращается 409 если заявление не pending.
- `POST /api/applications/:id/reject` → `{application}` — rank ≥ 40, только pending.
- `POST /api/applications/:id/cancel` → `{application}` — только автор заявления, только pending.

### Увольнение (новое, `documents.type='dismissal'`)
- `POST /api/orgs/:id/dismissals` `{userId, reason?}` → `201 {document}`
  - доступ: `actor.rank > target.rank`, target ≠ owner; `reason` ≤ 300;
  - 409 если уже есть pending-dismissal на этого человека или он не член;
  - `contract_text` из шаблона раздела 11; статус `pending`; **членство НЕ удаляется**.
- `GET /api/documents/mine` → `{documents: [{document, org:{id,name}, createdBy:{user}}]}`
  — все документы где `target_user_id = я` (50 последних, pending сверху).
- `GET /api/orgs/:id/dismissals` → `{documents: [{document, targetUser:{...}, createdBy:{user}}]}`
  — rank ≥ 40 в орг.
- `POST /api/documents/:id/sign` `{signatureDataUrl, signedName}` → `{document}`
  — только target; только pending; в одной транзакции: подпись → `signed` →
  УДАЛИТЬ членство (как `member:left`); уже не член → 409.
- `POST /api/documents/:id/reject` → `{document}` — только target, pending;
  статус `rejected`, членство сохраняется («оспорил»).
- `POST /api/documents/:id/cancel` → `{document}` — pending; кто-то из: создатель
  документа ИЛИ `actor.rank > target.rank` в этой орг.; статус `canceled`.
- `POST /api/documents/:id/terminate` → `{document}` — pending; `actor.rank > target.rank`;
  статус `terminated` + удаление членства (односторонний разрыв).
- `DELETE /api/orgs/:id/members/:userId` — **оставить как раньше (мгновенное
  исключение) только для API-совместимости/smoke-тестов; в UI v2 НЕ ИСПОЛЬЗОВАТЬ**
  (все «увольнения» идут через dismissal-документы). Самовыход `POST /leave` — как раньше.

### Семантика контракта
Пользователь подпись = реальная отрисовка (`signatureDataUrl`) + ФИО (`signedName`).
Все обязательные подписи (принятие заявления, увольнение) — **до** смены статуса.

## 13. Socket.IO v2 (новые события)

- `application:new` `{application, org, user}` → во все сокеты staff орг. (rank ≥ 40).
- `application:update` `{application, org}` → автору заявления (accept/reject) и
  staff орг. (cancel).
- `document:new` `{document, org}` → во все сокеты target_user_id.
- `document:update` `{document, org}` → target_user_id И staff орг. (все исходы).

Остальные события — без изменений. Аck-конвенция та же.

## 14. Web v2

1. **Каталог** — пункт в левой колонке (иконка globe, под организациями):
   «Каталог организаций»; строка поиска «Найти организацию» (debounce 300ms);
   карточки: название, описание, число участников, бейдж «Ваша организация»
   либо кнопка «Подать заявление».
2. **Модалка «Подать заявление»**: название орг., textarea «Сообщение (необязательно)»,
   прокручиваемый текст договора, поле ФИО, signature-pad (переиспользовать
   существующий компонент), кнопка «Подать заявление» активна только при ФИО ≥2
   и ≥1 штрихе; после отправки — toast «Заявление отправлено».
3. **Экран «Заявления»** (иконка в сайдбаре со счётчиком pending, если я член орг.):
   секция «Входящие заявки» (для каждой моей орг., где rank≥40): аватар+ФИО,
   организация, сообщение, дата, договор (раскрытие), кнопки «Принять»/«Отклонить»;
   секция «Мои заявки»: орг., статус (На рассмотрении / Принято / Отклонено /
   Отозвано), для pending кнопка «Отозвать».
4. **Экран «Документы»** (иконка со счётчиком моих pending-dismissal):
   список: организация, тип «Договор об увольнении», статус, дата; для pending —
   открытие: прокручиваемый текст, ФИО, signature-pad, кнопки «Подписать и
   уволиться» (danger) и «Оспорить»; история со статусами.
5. **Создание организации**: добавить тумблер «Публичная организация (видна
   в каталоге)» — по умолчанию включён. В «Информации» организации (rank≥60) —
   тот же тумблер.
6. **Панель участников**: кнопка «Уволить» (danger, вместо «Удалить») → confirm-модалка
   «Сотруднику будет отправлен договор об увольнении, который он должен подписать
   от руки» → POST dismissals. Для участника с pending-dismissal: бейдж
   «Ожидает подписи», кнопки «Отменить увольнение» (cancel) и
   «Расторгнуть в одностороннем порядке» (terminate, с confirm).
7. **Реалтайм**: обработать `application:new/update`, `document:new/update`
   (счётчики сайдбара, тосты «Новое заявление», «Вам отправлен договор
   об увольнении», обновление списков без перезагрузки).
8. Новая типизация в `types.ts`, новые вызовы в `api.ts`, всё по-русски,
   дизайн-токены прежние. `npm run build` — 0 ошибок.

## 15. Mobile v2

Те же функции, те же эндпоинты/события:
1. На экране выбора организаций — пункт «Каталог организаций» (поиск + карточки +
   «Подать заявление»).
2. Экран подачи заявления: сообщение, договор (ScrollView), ФИО, существующий
   signature-pad (PanResponder/SVG), submit до ФИО+штрихов.
3. Экран «Заявления» (вкладка внутри организации — входящие для rank≥40; плюс
   мои заявления в каталоге/на главном экране), кнопки Принять/Отклонить/Отозвать.
4. Экран «Документы» (список моих договоров, pending → подписание тем же pad,
   кнопки «Подписать и уволиться» / «Оспорить»).
5. Тумблер «Публичная» при создании организации; кнопка «Уволить» в участниках
   (вместо удаления), бейдж «Ожидает подписи», «Отменить» / «Расторгнуть».
6. Обработка socket-событий v2 (бейджи, тосты).
7. Гейт: `npx tsc --noEmit` — 0 ошибок.

## 16. Smoke v2 (server/scripts/smoke.mjs — расширить)

Добавить проверки: discover (публичные видны, приватные нет, поиск); заявление
(валидация подписи 400, дубль 409,非-член ок, член 409, staff видит, accept →
member создан роль member, повторный accept 409); reject/cancel ветки; dismissal
(нельзя уволить owner/self/lower rank → 403/409, документ pending, членство цело,
GET mine/staff, sign → членство удалено, reject → остался, cancel, terminate →
удалено); ранние проверки не сломать. Итог по-прежнему «SMOKE PASSED», exit 0.

---

# SPEC v2.1 — Профиль с подписью + адаптивность

## 17. Профиль и личная подпись

### Модель (идемпотентные миграции!)
```sql
ALTER TABLE users    ADD COLUMN signature TEXT;       -- data:image/... нарисованная подпись
ALTER TABLE users    ADD COLUMN signature_kind TEXT;  -- 'drawn' | 'text' | NULL (нет подписи)
ALTER TABLE users    ADD COLUMN signature_text TEXT;  -- текст подписи (kind='text')
ALTER TABLE invites  ADD COLUMN signature_kind TEXT;  -- 'png' | 'text'
ALTER TABLE invites  ADD COLUMN signature_text TEXT;
ALTER TABLE documents ADD COLUMN signature_kind TEXT;
ALTER TABLE documents ADD COLUMN signature_text TEXT;
```
Старые строки с `signature_kind = NULL` трактовать как `'png'` (изображение).

### API профиля
- `GET /api/me` → user + поля `signature`, `signatureKind`, `signatureText` (только свои).
- `PUT /api/me` `{displayName?}` (2..50) → `{user}`.
- `PUT /api/me/signature` — три варианта тела:
  - `{kind:"text", text}` — text 2..80 символов (trim);
  - `{kind:"drawn", dataUrl}` — `data:image/...`;
  - `{kind:null}` — удалить подпись.
  → `{user}`. Ошибки 400 по валидации.
- **Подпись любого контракта** (invite accept, создание заявления, sign документа)
  теперь принимает **ЛИБО** `signatureDataUrl` (`data:image/...`) **ЛИБО**
  `signatureText` (2..80) — хотя бы одно обязательно, иначе 400
  «Добавьте подпись». `signedName` (ФИО) по-прежнему обязателен.
- Во всех ответах о подписанных сущностях (invites, applications, documents)
  возвращать: `signature` (image|null), `signatureKind` (`'png'|'text'`), `signatureText`,
  `signedName`, `signedAt` — клиент сам рисует: изображение через `<img>`,
  текст — шрифтом Caveat (кириллица).

### UI профиля (web + mobile)
- Вход: клик по аватару/строке пользователя внизу сайдбара (web) / строка профиля
  на экране выбора организаций (mobile) → экран «Профиль».
- Содержимое: аватар + отображаемое имя (редактируется, `PUT /api/me`),
  username (только чтение), email (только чтение), раздел **«Моя подпись»**.
- Раздел подписи — переключатель **«Напечатать» (по умолчанию)** / **«Нарисовать»**:
  - *Напечатать*: поле ввода + живое превью шрифтом **Caveat** (подключить с
    кириллицей: web — Google Fonts `Caveat`, mobile — `@expo-google-fonts/caveat`,
    если пакет недоступен — локальный ttf через `expo-font`, фолбэк — системный
    курсив). Подсказка: «Введите имя или фразу — так будет выглядеть ваша подпись».
  - *Нарисовать*: существующий signature-pad. Подсказка: «Или нарисуйте подпись
    курсором / пальцем».
  - Кнопки «Сохранить подпись» и «Удалить подпись».
- **Подсказка при отсутствии подписи**: баннер «Создайте свою подпись — она
  понадобится для подписи договоров» + кнопка «Создать подпись» → профиль.
  Показывать: на экране «Документы», в модалке подачи заявления, в модалке
  подписи увольнения.
- **Модалка подписи любого документа**: если подпись уже есть — превью + кнопка
  **«Подписать моей подписью»** (один клик: text → `signatureText`, drawn →
  `signatureDataUrl`), плюс ссылка «Подписать иначе» (печат/рисунок inline).
  ФИО (`signedName`) подставляется из displayName, но остаётся редактируемым.
- Просмотр подписанных договоров (история): изображение — `<img>`, текст —
  строкой Caveat 28–36px в цвете акцента под «Подпись:».
- Никакой конвертации текста в картинку не требуется нигде.

## 18. Адаптивность: телефон и планшет (web)

Один и тот же публичный HTTPS-ссылка открывается в браузере телефона/планшета
без установки; звонки просят доступ к камере/микрофону обычным промптом (HTTPS есть).

Breakpoints:
- **< 768px (телефон)** — один столбец:
  - левая колонка — drawer: кнопка-гамбургер в шапке чата, backdrop-затемнение,
    закрытие по тапу на backdrop / выборе канала;
  - правая панель (участники/приглашения/инфо) — полноэкранный оверлей со своей
    шапкой и крестиком;
  - шапка чата: гамбургер слева, имя канала по центру/справа, кнопки звонков
    компактно;
  - поле ввода прижато к низу с `padding-bottom: env(safe-area-inset-bottom)`,
    кнопка отправки ≥44px;
  - инпуты `font-size: 16px` (защита от зума iOS), все tap-targets ≥44px;
  - модалки: почти во всю ширину, поля/кнопки вертикально; signature-pad
    `touch-action: none`, рисование пальцем обязательно работает;
  - сайдбар и панели — `position: fixed`, `100dvh` высота.
- **768–1099px (планшет/малый ноут)** — сайдбар 260–300px виден, правая панель — overlay-drawer.
- **≥ 1100px** — текущий трёхколоночный layout без изменений.
- `index.html` уже имеет viewport + `viewport-fit=cover` + `color-scheme: dark`;
  добавить safe-area отступы где нужно.
- Гейт web: `npm run build` зелёный + ручная проверка вёрстки на ширинах
  390 / 834 / 1440 (dev-server или чтение CSS — по возможности скриншоты).
- Mobile app (Expo) — уже нативно адаптивна; на планшете допустимо простое
  масштабирование с макс. шириной контента ~830px по центру.

Приоритет выполнения: сначала бэкенд-часть всех SPEC v2/v2.1 разделов,
затем UI.

---

# SPEC v3 — Профиль, подпись, прочтено, история, роли, адаптив, звонки

Дополняет всё выше.

## 17. Профиль и сохранённая подпись

### Данные (users — идемпотентная миграция)
```sql
ALTER TABLE users ADD COLUMN full_name TEXT;       -- ФИО для договоров
ALTER TABLE users ADD COLUMN signature TEXT;        -- data:image/... (typed|drawn)
ALTER TABLE users ADD COLUMN signature_kind TEXT CHECK(signature_kind IN ('typed','drawn'));
```

### API
- `GET /api/me` → добавить `fullName`, `signature`, `signatureKind`.
- `PATCH /api/me` `{displayName?, fullName?, signature?, signatureKind?, email?, currentPassword?}`
  — `signature` обязателен при указании `signatureKind`; `currentPassword` нужен
  только при смене пароля (`password` — новое значение, ≥6). 400 на кривые данные.

### Подпись: два вида
1. **Печатная** (`typed`): пользователь вводит ФИО/подпись текстом («Алексей Иванов»),
   приложение рисует её курсивным шрифтом (на web: canvas/SVG с шрифтом вроде
   «Caveat» с Google Fonts; на мобильном: Text в курсиве/шрифте Caveat —
   подпись = `data:image/svg+xml;base64,...` c текстом), `signatureKind:'typed'`.
2. **Рукописная** (`drawn`): тот же signature-pad что в договорах.

### UX (web + mobile)
- Страница «Профиль» (аватар, отображаемое имя, username, email, ФИО, выход).
- Блок «Моя подпись»: если подписи нет — иллюстрация-заглушка и подсказка
  «Создайте свою подпись — потом будете подписывать документы в один клик»,
  две кнопки: «Напечатать подпись» (ввод текста + превью курсивом) и
  «Нарисовать подпись» (pad). Если есть — превью + «Изменить»/«Удалить».
- При подписании любого документа (вступление/увольнение): если подпись
  сохранена — сверху панель «Использовать мою подпись» (один клик: подставляет
  подпись и ФИО из профиля; ФИО можно поправить) + ссылка «Изменить подпись»;
  рисование всегда доступно как альтернатива. Если подпись не сохранена —
  подсказка со ссылкой в профиль («Создайте свою подпись в профиле — подписание
  займёт один клик»).

## 18. Прочтено и история действий

### Прочтено (read receipts)
```sql
CREATE TABLE IF NOT EXISTS channel_reads (
  channel_id TEXT NOT NULL, user_id TEXT NOT NULL,
  last_read_at INTEGER NOT NULL, PRIMARY KEY (channel_id, user_id));
```
- `POST /api/channels/:id/read` `{at?}` (по умолчанию now) → `{ok:true}` —
  ставит `last_read_at = max(текущее, at)`; доступ к каналу обязателен.
- `GET /api/channels/:id/read-status` → `{reads: [{userId, lastReadAt}]}` — все
  участники (для DM и для каналов).
- `GET /api/channels/:id/messages` — к каждому сообщению клиента добавляет
  (клиентская сторона, не сервер): для СВОИХ сообщений — статус прочтения.
- Сокет `channel:read` `{channelId, userId, lastReadAt}` → другим участникам канала
  (громкно не спамить: только при открытии канала, при новом входящем сообщении
  и при прокрутке вниз; клиент шлёт не чаще 1 раза/3с на канал).
- Отображение: у **своих** сообщений в **DM** — «Прочитано HH:MM» когда peer
  `lastRead_at ≥ message.createdAt`, иначе «Доставлено» (галочка). В **каналах** —
  «Прочитано: N из M» (число участников с `lastRead_at ≥ createdAt`; у последнего
  сообщения). Текст мелким muted-шрифтом под сообщением.
- Непрочитанные: `GET /api/orgs` и список каналов дополнительно возвращают
  `unread` (число сообщений с `createdAt > last_read_at` для каналов орг.; для DM —
  счётчик непрочитанных). **Бейджи** на каналах в сайдбаре (web) и списке чатов
  (mobile), сброс при открытии. Допустимо считать по-простому (до 100 последних).

### История действий организации (activity log)
```sql
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, actor_id TEXT,
  action TEXT NOT NULL, target_user_id TEXT,
  details TEXT,            -- человекочитаемая строка готовым текстом на русском
  created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS activity_org ON activity(org_id, created_at DESC);
```
- `details` формируется сервером сразу фразой, например:
  «Алексей пригласил(а) Ивана в организацию», «Иван подписал договор о
  вступлении (роль: Участник)», «Алексей повысил(а) Ивана до Админа»,
  «Иван подписал договор об увольнении», «Алексей удалил(а) сообщение в #general».
- События (записывать из существующих обработчиков): `invite.created`,
  `invite.accepted`, `invite.declined`, `invite.canceled`, `application.submitted`,
  `application.approved`, `application.rejected`, `application.canceled`,
  `dismissal.created`, `dismissal.signed`, `dismissal.rejected`, `dismissal.canceled`,
  `dismissal.terminated`, `member.joined`, `member.left`, `role.changed`,
  `channel.created`, `org.updated`, `message.deleted` (только для rank≥40,
  не для автора — иначе не пишем).
- `GET /api/orgs/:id/activity?before=<id>&limit=50` → `{activity:[{id, action,
  details, actor:{...}|null, targetUser:{...}|null, createdAt}], hasMore}`
  — доступно всем членам организации.
- Сокет `activity:new` `{activity}` → членам организации (realtime-таймлайн).

## 19. Роли — уточнённая матрица (заменяет §2 в части прав)

| Действие | owner | assistant_owner | admin | assistant_admin | member |
|---|---|---|---|---|---|
| Приглашать | ✓ | ✓ | ✓ | ✓ | — |
| Принимать/отклонять заявления | ✓ | ✓ | ✓ | ✓ | — |
| Создавать каналы | ✓ | ✓ | ✓ | ✓ | — |
| **Удалять сообщения** (любые, не свои) | ✓ | ✓ | ✓ | **✓ (новое)** | — |
| Увольнять (dismissal, rank<своей) | ✓ | ✓ | ✓ | — | — |
| Односторонний разрыв (terminate) | ✓ | ✓ | ✓ | — | — |
| Менять роли (owner: любые кроме owner; иначе rank > цели и новая < своей) | ✓ | ✓ | ✓ (только ниже admin) | — | — |
| Редактировать организацию, публичность | ✓ | ✓ | ✓ | — | — |
| Просмотр заявок/увольнений орг. | ✓ | ✓ | ✓ | ✓ | — |
| Просмотр истории действий | ✓ | ✓ | ✓ | ✓ | ✓ |
| Чаты, звонки, каталог, подача заявлений | ✓ | ✓ | ✓ | ✓ | ✓ |

- Изменения smoke: удаление сообщения rank≥40 (assistant_admin может, member нет).
- В панели организации (web) и на мобильном — раздел **«Роли и права»**:
  таблица выше (тёмный минимализм), чтобы каждый видел возможности своей роли.

## 20. Адаптив: телефон и планшет (web)

Один и тот же публичный URL должен быть полностью удобен на телефоне и планшете.

- **< 768px (телефон)**: колонки-сайдбара нет — вместо неё «гамбургер»
  (иконка в шапке чата) открывает сайдбар **оверлеем** (выезжает слева,
  затемнение-бэкдроп, закрытие тапом по бэкдропу/крестику). Правая панель —
  полноэкранный оверлей со своим крестиком. Чат на всю ширину. Поле ввода
  прижато к низу с учётом `env(safe-area-inset-bottom)`; кнопки и тапы ≥ 44px;
  шрифт в инпутах ≥16px (иначе iOS зумит); модалки — во всю ширину с отступами
  (не шире 92vw), signature-pad ресайзится и имеет `touch-action:none`.
- **768–1100px (планшет portrait)**: сайдбар постоянный ~260px, правая панель —
  оверлей. **> 1100px**: текущая 3-колоночная раскладка.
- Вызовы-кнопки в шапке чата, индикатор набора, попапы не должны обрезаться;
  видео-звонок: удалённое видео на весь экран, локальное — pip с учётом safe-area.
- Проверить экраны: логин/регистрация, каталог, документы (pad!), чат (длинные
  сообщения, даты), участники, звонок.
- Гейт: `npm run build` зелёный; вёрстка проверена на ширинах 390 / 768 / 1440
  (насколько возможно в этой среде — вёрстка через CSS-медиазапросы, без JS-хаков).

## 21. Починка звонков (веб — приоритет)

Симптом: у пользователя звонки «не работают» (тест с двух аккаунтов в разных
сетях). Диагноз: `ICE_SERVERS` — только `stun:stun.l.google.com:19302`
(в РФ часто блокируется), нет TURN → ICE не проходит между разными сетями.

1. В `web/src/hooks/useWebRTC.ts` заменить ICE-серверы:
```ts
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.voipgate.com:3478',
           'stun:stun.sipgate.net:3478', 'stun:stun.l.google.com:19302'] },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443',
           'turn:openrelay.metered.ca:443?transport=tcp'],
    username: 'openrelayproject', credential: 'openrelayproject' },
];
```
> **ФИКС звонков (v7):** только формат `?transport=tcp`. Вариант `?tcp`
> невалиден — Chrome бросает исключение уже при конструировании
> `RTCPeerConnection`, из-за чего звонок «само сбрасывался» через 20–30 секунд.
> Клиенты (web/mobile) обёрнуты в try/catch: при ошибке конфигурации —
> понятное уведомление, а не молчаливый сбой.
2. Следить за `iceConnectionState`/`connectionState`: через 20с в состоянии
   connecting/без `connected` → показать понятную ошибку «Не удалось установить
   соединение. Проверьте интернет у собеседника» и завершить вызов (кнопкой
   «Завершить»), при `failed` — то же. При `disconnected` — статус «Соединение
   нестабильно».
3. Никогда не оставлять пользователя в вечном «Вызов…»: если `call:invite`
   не подтверждён за 12с (emitAck и так таймаутит) — сообщение и сброс.
4. Логгировать на сервере вызовы (`console.log('[call]', action, ...)` в
   call:* хендлерах) — для диагностики.
5. То же самое ICE-набор — в мобильном приложении (`state/call.ts`).
6. Smoke: сигнальный хендшейк остаётся (уже есть).

## 22. Smoke v3

Расширить `server/scripts/smoke.mjs`: PATCH /me (профиль+подпись), оба вида
подписи в договоре через сохранённую подпись (приём: accept с `signature`
из профиля допустим — НЕТ: контракт всё равно подписывается полем
`signatureDataUrl`; проверить можно только API-валидацию), read-status/read/
unread, activity (создание заявления → запись в истории, GET activity),
новая матрица прав (assistant_admin удаляет сообщение — 200, member — 403),
discover/is_public. Итог «SMOKE PASSED», exit 0. Существующие проверки не ломать.

---

# SPEC v4 — Панель создателя с ботом + финансы и зарплата

## 23. Панель создателя (только для владельца приложения)

### Доступ
- Superadmin = пользователь, чей `username` входит в список:
  `process.env.ATRIUM_ADMIN?.split(',').map(s=>s.trim()) || ['alex']`.
- Любой роутер `/api/admin/*` под `requireAuth + requireAdmin`; иначе 403
  «Доступ запрещён». Клиент прячет весь UI, если `GET /api/me` не вернул
  `isAdmin: true` (поле добавить в ответ `/api/me` и в объект user — вычислять
  на сервере, не принимать от клиента).

### Данные (идемпотентные миграции)
```sql
ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at INTEGER;
CREATE TABLE IF NOT EXISTS login_log (
  id TEXT PRIMARY KEY, user_id TEXT, success INTEGER NOT NULL,
  ip TEXT, user_agent TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, org_id TEXT, actor_id TEXT, action TEXT NOT NULL,
  target_user_id TEXT, details TEXT, ip TEXT, user_agent TEXT,
  created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS audit_created ON audit_log(created_at DESC);
CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT);
```
- `audit_log` пишется ПАРАЛЛЕЛЬНО `activity` (§18) из всех тех же обработчиков
  (те же details-фразы) + события авторизации и кошелька:
  `auth.login` (в т.ч. неудачные: details «Неудачный вход»), `auth.logout`,
  `auth.register`, `wallet.topup`, `wallet.transfer`, `org.payroll`,
  `user.ban`, `user.unban`.
- Каждый запрос superadmin-роутов и логинов пишет `ip` + `user_agent`
  (из `req.ip` / header; за туннелем — `X-Forwarded-For` если есть).

### Бот-отчётчик
- Системный пользователь `id:'u_bot'`, `username:'atrium_bot'`,
  displayName «Atrium Бот», фиксированный avatarColor, создаётся лениво
  при первом отчёте (паролю не нужен, в каталоге не виден, залогиниться нельзя).
- Бот отправляет superadmin'у ЛС (DM-канал bot↔admin без org_id, создаётся
  лениво) сообщения-отчёты текстом: «🔴 Вход: alex_123 (IP 1.2.3.4) в 14:32»,
  «📨 Заявление: Иван → ООО «Ромашка»», «💸 Зарплата: 50 000 ₽ → Иван (org «папа»)».
  Отправляется через существующий механизм `message:new` (уведомления как обычно).
- Настройки бота: `GET /api/admin/bot` → `{enabled, events:[...]}`,
  `PUT /api/admin/bot` `{enabled?, events?}` — хранение: `admin_settings.key='bot'`
  (JSON). Каталог событий (для чекбоксов в UI): `auth.login`, `auth.logout`,
  `auth.register`, `org.create`, `member.joined`, `member.left`, `role.changed`,
  `invite.created`, `application.*`, `dismissal.*`, `message.deleted`,
  `wallet.topup`, `wallet.transfer`, `org.payroll`, `user.ban`.
  По умолчанию `enabled:true`, `events` = все.
- **Дедупликация**: одинаковые события одного типа по одному пользователю
  складываются в одну сводку в течение 60с («Вход: alex ×3 за минуту»).

### Эндпоинты
- `GET /api/admin/stats` → `{users, usersToday, usersActive24h, orgs, orgsPublic,
  members, messages, messages24h, invitesPending, callsToday (по login/activity
  не надо — считать из audit/call-логов если легко, иначе 0), onlineNow,
  totalBalance (сумма балансов), paidTotal (сумма salary-платежей)}`
- `GET /api/admin/audit?before=<id>&limit=50&action=<filter>&q=<поиск>` →
  `{items:[{id, action, details, actor:{...}|null, targetUser:{...}|null,
  orgName|null, ip, createdAt}], hasMore}` — все организации, глобально.
- `GET /api/admin/logins?limit=50` → `{items:[{id, user:{...}|null, success,
  ip, userAgent, createdAt}]}`
- `GET /api/admin/users?query=&limit=30` → `{items:[{...user, banned, lastLoginAt,
  orgsCount, balance}]}`
- `POST /api/admin/users/:id/ban` / `POST /api/admin/users/:id/unban` →
  ставит/снимает `banned`; активные сокеты этого пользователя отключаются
  (и повторный вход невозможен: login → 403 «Аккаунт заблокирован»;
  `requireAuth` тоже проверяет banned → 401 с сообщением).
- Сокет `admin:event` `{item}` → ТОЛЬКО сокетам superadmin (live-лента журнала).

### UI (web, раздел «Панель создателя», вход из профиля и сайдбара — виден только admin)
- **Обзор**: карточки статистики (пользователи/онлайн/организации/сообщения
  за 24ч/балансы/выплачено).
- **Журнал**: live-лента `admin:event` + пагинация, фильтр по типу, поиск;
  каждая строка: время, актор, действие, детали, IP.
- **Входы**: таблица входов (кто, когда, IP, устройство, успех/нет).
- **Пользователи**: поиск, баланс, число организаций, бан/разбан.
- **Бот**: переключатель вкл/выкл + чекбоксы событий; превью «как будет
  выглядеть отчёт»; ссылка «Открыть чат с ботом» (DM).

## 24. Финансы: кошелёк, переводы, зарплата (общая функция приложения)

> ⚠️ **Демо-режим**: реальные платежи НЕ проводятся (нет договора с эквайрингом).
> Везде в UI — плашка «Демо-режим: карта не списывается, реальные деньги
> не участвуют». Интеграция с ЮKassa/Stripe — отдельная задача после подключения.

### Данные
```sql
ALTER TABLE users ADD COLUMN balance INTEGER DEFAULT 0;   -- рублей, целые
ALTER TABLE orgs  ADD COLUMN balance INTEGER DEFAULT 0;    -- казначейство организации
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, org_id TEXT, from_user_id TEXT, to_user_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('topup','transfer','salary','treasury_deposit')),
  amount INTEGER NOT NULL CHECK(amount > 0), note TEXT, card_mask TEXT,
  created_by TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS payments_user ON payments(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_org ON payments(org_id, created_at DESC);
```
Все изменения балансов — **в одной транзакции** (begin/commit), отрицательный
баланс невозможен (409 «Недостаточно средств»).

### Эндпоинты
- `GET /api/wallet` → `{balance, demo:true, payments:[{id, kind, amount(+/-),
  direction:'in'|'out', counterparty:{user}|{org}, note, cardMask, createdAt}]}`
  — 30 последних операций пользователя (и как получатель, и как отправитель).
- `POST /api/wallet/topup` `{amount, cardNumber}` → `{balance, payment, demo:true}`
  - amount 100..500000; cardNumber — 16 цифр (пробелы/дефисы убрать, валидация
    Luhn опционально, мягко); `card_mask = '•••• ' + последние4`; kind `topup`;
    audit `wallet.topup`.
- `POST /api/wallet/transfer` `{toUserId, amount, note?}` → `{balance, payment}`
  - amount 1..500000; себе → 400; не найден → 404; нет средств → 409;
    kind `transfer`; audit `wallet.transfer`; получателю тост
    «💸 Перевод: +N ₽ от Имя» (сокет `wallet:updated` + toast).
- `GET /api/orgs/:id/finance` → `{balance, canManage:boolean,
  transactions:[{...payment, fromUser, toUser, createdAt}] (50, rank≥60 — всё
  казначейство; обычный участник только свои начисления этой орг.),
  payrollTotals:[{user, total}] (rank≥60)}`
- `POST /api/orgs/:id/treasury/deposit` `{amount}` → `{balance}` — rank ≥ 60;
  списывает с личного баланса автора (недостаточно → 409), kind
  `treasury_deposit` (from_user=автор, to=NULL, org_id=орг); audit `org.payroll`
  нет — отдельный `wallet.topup`? → action `org.treasury_deposit`.
- `POST /api/orgs/:id/payroll` `{userId, amount, note?}` → `{orgBalance, payment}` 
  - rank ≥ 60; цель — член орг.; `org.balance >= amount` иначе 409
    «Недостаточно средств в казначестве»; `users.balance += amount`,
    `orgs.balance -= amount`; kind `salary`; audit `org.payroll`;
    activity-запись «Алексей выплатил(а) зарплату: 50 000 ₽ → Иван»;
    получателю `wallet:updated` + тост «💸 Начислена зарплата: +50 000 ₽».

### Сокеты
- `wallet:updated` `{balance, reason?, from?}` → только владельцу счёта.

### UI (web + mobile, все тексты по-русски)
- **«Кошелёк»** (в профиле + пункт в сайдбаре): баланс крупно («12 500 ₽»),
  кнопки «Пополнить» и «Перевести», история операций (значок, контрагент,
  комментарий, время, ±сумма; для topup — маска карты и бейдж «Демо»).
- **Модалка пополнения**: сумма (быстрые чипы 500/1000/5000), номер карты
  (маска ввода 0000 0000 0000 0000), плашка «Демо-режим…», кнопка «Пополнить».
- **Модалка перевода**: поиск пользователей (GET /api/users/search), сумма,
  комментарий, итог, кнопка «Перевести»; успех → тост.
- **«Финансы организации»** (в правой панели, rank≥60): казначейство, кнопки
  «Пополнить казначейство» (сумма, списывается с автора) и «Выплатить зарплату»
  (выбор участника, сумма, комментарий), история операций, колонка
  «Выплачено» на участника. Обычный участник видит только раздел
  «Мои начисления» от этой организации.
- Всюду подписи «Демо-режим».

## 25. Общее

- `GET /api/me` добавить `isAdmin`, `balance`.
- Новые события realtime: `admin:event`, `wallet:updated`.
- Smoke v4: admin-роуты (403 для не-создателя, 200 stats/audit/logins/users,
  ban → login 401/403, unban → ок), wallet-цепочка (topup → transfer → нет
  средств 409 → deposit в казначейство → payroll списывает ровно, балансы
  сходятся), bot-настройки GET/PUT, DM бота создаётся и сообщение приходит.
  Итог «SMOKE PASSED», exit 0; все прежние проверки остаются зелёными.

---

## 26. РЕШЕНИЕ КОНФЛИКТОВ (читать обязательно, имеет приоритет)

В SPEC появились два разных описания профиля/подписи («SPEC v2.1 §17» и
«SPEC v3 §17»). Единая истина:

1. **Модель подписи — по v2.1 §17** (более полная):
   - `users.signature` (data:image только для нарисованной),
     `users.signature_text` (для текстовой), `users.signature_kind ∈ {'text','drawn'}` (NULL = подписи нет);
   - в подписанных сущностях (invites/applications/documents):
     `signature_kind ∈ {'png','text'}` (старые NULL → `'png'`), `signature_text` для текстовых.
2. **Сервер принимает ВСЕ варианты сохранения профиля** (толерантность):
   - `PUT /api/me/signature` `{kind:'text', text}` | `{kind:'drawn', dataUrl}` | `{kind:null}` — обязательный канон (v2.1);
   - `PATCH /api/me` и `PUT /api/me` `{displayName?, fullName?, email?, password?, currentPassword?}` — оба метода как алиасы;
   - при сохранении `signatureKind:'typed'` трактовать как `'text'`.
3. **Подпись договора** принимает ЛИБО `signatureDataUrl` (`data:image/...`),
   ЛИБО `signatureText` (2..80) — хотя бы одно обязательно; `signedName` обязателен.
   Клиент (web/mobile) при «напечатанной» подписи шлёт `signatureText`, при
   нарисованной — `signatureDataUrl`. Конвертация текста в картинку НЕ используется.
4. `fullName` — опциональное поле (если реализовано, префилл ФИО, иначе displayName).
5. **Разделы без конфликтов остаются в силе**: v2 §10–16, v2.1 §18 (адаптив,
   дублирует v3 §20 — при расхождениях собирать объединённую/более строгую
   версию), v3 §18 (прочтено/история), v3 §19 (роли), v3 §21 (починка звонков —
   приоритет), v4 §23–25 (панель создателя, финансы).
6. Нумерация секций может дублироваться (17/18) — ориентироваться на заголовки
   версий `# SPEC v2 / v2.1 / v3 / v4` и этот раздел.

---

# SPEC v5 — Карточка владельца + чистые формулировки денег

## 29. Карточка владельца (`is_owner`)

### Миграция
```sql
ALTER TABLE users ADD COLUMN is_owner INTEGER DEFAULT 0;
```

### Активация
- Код владельца: `process.env.ATRIUM_OWNER_CODE || 'OWNER-ATRIUM-777'`
  (trim, сравнение без учёта регистра).
- `POST /api/owner/claim` `{code}` →200 `{ok:true, isOwner:true}` (повторная
  активация — `{ok:true, already:true}`); неверный код → 400 «Неверный код».
- `GET /api/me` → +`isOwner`.
- Аудит: action `owner.claim`, запись боту «👑 Карточка владельца активирована: {user}».
- `GET /api/users/search` → в результаты добавить `isOwner` (чтобы приглашающий
  видел, что приглашает владельца).

### Семантика владельца
1. **Бесконечность денег**: сервер считает баланс владельца неограниченным —
   все проверки «Недостаточно средств» (topup/transfer/treasury deposit/payroll
   ОТ владельца... в первую очередь transfer и deposit) для `is_owner` пропускаются;
   в API `balance` для владельца возвращается как `null` (клиент рисует «∞»);
   исходящие платежи ЗАПИСЫВАЮТСЯ с суммами, но баланс не уменьшается.
2. **Всегда владелец в организации**: приглашение или заявление пользователя с
   `is_owner` → при вступлении роль **всегда `owner`** (игнорируется выбранная
   роль и правило «role < своей»), даже если в организации уже есть владелец —
   **несколько владельцев допускаются** (проверить все ранговые правила: они
   ранговые, owner=100 — конфликтов нет; правило «нельзя назначить роль owner»
   действует ТОЛЬКО для пользователей без is_owner).
3. **Защита**: бан пользователя с `is_owner` → 409 «Владельца нельзя заблокировать».
4. **Бейдж**: поле `isOwner` отображается везде, где виден пользователь:
   списки участников, профиль, модалка выбора получателя перевода, поиск людей,
   панель «Пользователи» админки — значок/пилюля **«Владелец»** (золотисто-жёлтая:
   фон `rgba(245,190,65,.15)`, текст `#F5BE41`, как и акцент на карточке).
5. Бот и журнал: вход/выход владельца, переводы владельца — как обычно.

## 30. Деньги: чистые формулировки (web + mobile)

- **УДАЛИТЬ из UI все надписи**: «Демо-режим», «карта не списывается»,
  «реальные деньги не участвуют», бейдж «Демо» в истории операций,
  «Демо» у маски карты. Поле `demo:true` в API остаётся, но НЕ отображается.
- Нейтральные банковские тексты: «Номер карты», «Пополнить счёт», «Карта •••• 4242»,
  «Перевод», «Операция выполнена», «История операций», «Казначейство организации».
- Баланс владельца: **«∞»** вместо числа (по `isOwner`/`balance===null`), везде.
- **Карточка владельца** — раздел в Профиле (web + mobile):
  - НЕ владелец: поле «Код владельца» + кнопка «Активировать», пояснение
    «Введите код, чтобы получить карточку владельца»; ошибка «Неверный код»;
    успех → тост «👑 Карточка владельца активирована».
  - Владелец: стилизованная карточка (градиент `#2A2140 → #17171C`, рамка
    `#F5BE41`, надпись «ВЛАДЕЛЕЦ», имя пользователя, «Баланс: ∞», серийный номер
    `OWNER-XXXX` — детерминированная маска от id пользователя), кнопка
    «Показать код для приглашения» — подсказка «Вас всегда делают владельцем
    организации при вступлении».
  - Бейдж «Владелец» рядом с именем в профиле (шапка), в списках участников,
    в поиске людей.
- Золотой акцент `#F5BE41` добавить в токены (web `--gold`, mobile theme).

## 31. Smoke v5

Новые проверки (прежние 149 остаются зелёными): claim с неверным кодом → 400,
с верным → isOwner; баланс владельца в /me → null; перевод владельца при
балансе 0 → 200 (проверка пропущена), платёж записан, баланс не уменьшился;
приглашение владельца с ролью member → accept → роль `owner` (второй владелец
в организации допустим); бан owner → 409; users/search содержит isOwner;
итог «SMOKE PASSED», exit 0.

---

# SPEC v6 — Карта владельца: пароль на каждую операцию

## 32. Карта с PIN (смена семантики §29 по решению владельца)

### Миграция
```sql
ALTER TABLE users ADD COLUMN card_number TEXT;  -- 16 цифр, только у is_owner
ALTER TABLE users ADD COLUMN card_pin TEXT;     -- 4 цифры, только у is_owner
```
- Генерация при `POST /api/owner/claim` + лениво на старте сервера для уже
  существующих `is_owner=1 AND card_number IS NULL`:
  `card_number` = `4242` + 12 случайных цифр, `card_pin` = 4 случайные цифры.
- Номер и пароль видит ТОЛЬКО сам владелец (`GET /api/me` → `card:{number,pin}`
  исключительно при `is_owner`; другим пользователям/эндпоинтам — никогда).

### Деньги: баланс — обычное число, пароль обязателен
1. **Убрать `balance:null`/«∞»**: `/api/me` и `/api/wallet` возвращают владельцу
   обычное число (v5-правило «null=∞» отменяется).
2. **PIN на каждую исходящую операцию владельца** (topup, transfer,
   treasury/deposit, payroll): поле `pin` обязателен, иначе 400
   «Неверный пароль карты» (и неверный тоже). Невладельцы — без изменений
   (pin не нужен, не принимается в расчёт).
3. **Лимиты для владельца сняты**: у topup сумма 100–500 000 больше не
   действует (для владельца: amount — целое ≥ 1, без верхней границы);
   transfer — без верхней границы. У НЕ-владельца лимиты как раньше.
4. **Карта без ограничений по остатку** (сохранить из §29): исходящие операции
   владельца не блокируются «Недостаточно средств» и НЕ уменьшают его баланс
   (бухгалтерия платежей — с суммами, как в §29). Входящие — зачисляются
   как обычно (баланс растёт обычным числом).
5. Остальное из §29 остаётся: forced owner при вступлении, ban 409,
   `isOwner` в DTO, бейджи, аудит/бот.

### UI (web + mobile)
- **«∞» удалить везде**: баланс владельца — обычное число (кошелёк, сайдбар,
  профиль, «Доступно», финансы, админка).
- Профиль → карточка владельца: на карте добавить **номер карты**
  (маска `•••• •••• •••• 1234`, кнопка «Показать номер» → полный) и
  **«Пароль карты: XXXX»** + подпись «Пароль запрашивается при каждой
  операции с деньгами». Серийник OWNER-XXXX — оставить.
- Модалки денег (пополнение, перевод, казначейство, зарплата): у владельца
  добавить поле «Пароль карты» (4 цифры, inputmode=numeric, pattern [0-9]*);
  серверный 400 «Неверный пароль карты» → показать сообщение в модалке/тост.
  Поле суммы пополнения: у владельца убрать максимум 500 000 (можно любую
  сумму). У НЕ-владельца поля пароля нет, лимиты прежние.
- Для владельца-не-владельца ничего не меняется.

## 33. Smoke v6

Новые проверки (прежние 161 остаются зелёными, поправить v5-проверки,
которые ожидали `balance:null` у владельца → теперь число):
- /me владельца: card.number 16 цифр, card.pin 4 цифры; у обычного юзера
  card отсутствует; чужой /me чужой карты не отдаёт (поля нет).
- topup владельца без pin → 400 «Неверный пароль карты»; с неверным → 400;
  с верным и amount=1000000 (>500k) → 200, баланс вырос на 1000000.
- transfer владельца без pin → 400; с верным pin → 200, баланс не уменьшился.
- treasury deposit / payroll владельца: без pin → 400, с pin → 200.
- обычный юзер: topup без pin (обычная сумма) → 200; amount=500001 → 400
  (лимит сохранился); transfer без pin → 200 (parol не требуется).
- итог «SMOKE PASSED», exit 0.

---

# SPEC v8 — Бан с причиной и уведомлением + чиним «не в сети»

## 34. Присутствие: ложное «Пользователь не в сети»

Проблемы: (а) клиенты знают о присутствии ТОЛЬКО из `presence:update`, который
сервер шлёт лишь при первом подключении пользователя — если собеседник уже был
онлайн, вы никогда не получили его статус → подзаголовок «не в сети» лжёт;
(б) `call:invite` мгновенно отвечает409, если сокет собеседника в момент
запроса отвалился (ребект через туннель/пробуждение телефона) — звонок падает,
хотя человек «готов принять».

### Сервер
1. При **каждом** подключении сокета отправлять ему снапшот
   `presence:list {userIds:[...все сейчас онлайн...]}` (после join/register;
   повторяется при каждом реконнекте — клиент всегда в курсе).
2. `call:invite`: если callee не в сети — вместо мгновенного409 дождаться его
   появления до **6 секунд** (проверка каждые400мс, await, не блокируя event
   loop); появился → штатный сценарий; не появился →409 «Пользователь не в сети
   — приложение собеседника, похоже, закрыто или свёрнуто».
3. Остальная механика (refcount сокетов, очистка звонков) — корректна, не трогать.

### Клиенты (web + mobile)
4. Подписаться на `presence:list` → объединять id в карту онлайн-состояния
   (не затирая актуальные `presence:update`). Подзаголовки «в сети/не в сети»
   в чатах и списках начинают показывать правду.
5. Mobile: при `AppState` → «active» — если сокет не подключён, вызвать
   `socket.connect()` (пробуждение приложения не должно оставлять мёртвый сокет).
6. Звонок НЕ форсируется локальной проверкой «онлайн» — сервер авторитетен.

## 35. Бан: обязательная причина + уведомление «Вас забанил…»

### Миграция
```sql
ALTER TABLE users ADD COLUMN ban_reason TEXT;   -- причина (1–500)
ALTER TABLE users ADD COLUMN ban_by_name TEXT;  -- кто забанил (display_name на момент бана)
```

### API
1. `POST /api/admin/users/:id/ban` принимает `{reason}` — **обязательное**
   (trim,1–500 символов), иначе400 «Укажите причину блокировки» (и бан НЕ
   ставится). Сохранять `ban_reason`, `ban_by_name` (имя банящего админа).
2. Порядок действий: записать бан → **отправить жертве сокет-событие**
   `user:banned {byName, reason}` (`emitToUser`) → отключить её сокеты
   (`disconnectUserSockets`) → audit + бот. В audit details и отчёте бота —
   причина: «🚫 {admin} заблокировал(а) {user}. Причина: {reason}».
3. Вход забаненного: сервер отвечает текстом **«Аккаунт заблокирован. Вас
   забанил(а) {ban_by_name}. Причина: {ban_reason}»** (старый токен — тоже этот
   текст; если полей нет — прежняя форма «Аккаунт заблокирован»).
4. `unban`: обнулить `ban_reason`, `ban_by_name`.
5. `GET /api/admin/users` → +`banReason`, `banByName`.

### UI web
6. Модалка бана: вместо ConfirmModal — форма с **обязательным полем
   «Причина блокировки»** (textarea,1–500; кнопка «Заблокировать» неактивна,
   пока пусто) + предупреждение «активные сессии будут отключены». Ошибки API
   (например409 «Владельца нельзя заблокировать») — тостом с серверным текстом.
7. В «Пользователи» у забаненных: бейдж «Заблокирован» + строка причины
   (muted, обрезанной, полный текст в title).
8. **Экран для забаненного**: подписка на `user:banned` → затемняющее окно на
   весь экран: «⚠️ Внимание! Вас забанил(а) {byName}. Причина: {reason}» +
   кнопка «Выйти» (сброс токена → логин). Крестика нет. Дальше API и так
   вернёт401 с текстом причины, логин покажет её же.

### UI mobile
9. Подписка на `user:banned` → Blocking Alert/экран «Вас забанил(а) X.
   Причина: Y» → выход на экран входа; текст логин-ошибки — серверный (с
   причиной). Если в mobile есть экран бана (панель создателя) — добавить
   обязательную причину так же; если бана в mobile нет — только уведомление.

## 36. Smoke v8

Прежние167 — адаптировать под обязательную причину (существующая проверка бана
без reason теперь ждёт400 — исправить на три шага). Новые проверки:
- ban без reason →400 «Укажите причину блокировки», banned остаётся0;
- ban c reason →200; сокет жертвы получает `user:banned {byName, reason}` ДО
  отключения; в admin list — banReason/banByName;
- логин жертвы → ошибка содержит «забанил» и текст причины; старый токен →
  ошибка с тем же текстом;
- unban → причина очищена, вход работает;
- `presence:list`: собеседник, подключившийся раньше, присутствует в снапшоте
  нового подключения;
- офлайн-калея звонка: callee подключается через ~2с после invite → НЕ409;
  совсем офлайн >6с →409;
- итог «SMOKE PASSED», exit 0.
