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
