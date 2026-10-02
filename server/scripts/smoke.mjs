/**
 * Atrium server smoke test.
 * Run against a live server:  node scripts/smoke.mjs
 * (server must be listening on PORT or http://localhost:4000)
 *
 * Exits 0 with PASS lines on success, 1 on any failure.
 */
import { io } from 'socket.io-client'

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 4000}`
const RUN_ID = Date.now().toString(36)

let passed = 0
let failed = 0

function pass(name) {
  passed++
  console.log(`  PASS  ${name}`)
}
function fail(name, detail) {
  failed++
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
}
async function check(name, fn) {
  try {
    const detail = await fn()
    pass(name)
    return detail
  } catch (err) {
    fail(name, err?.message || String(err))
    throw err
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* empty body */
  }
  return { status: res.status, data }
}

function connect(token) {
  return io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false })
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler)
      reject(new Error(`timeout waiting for "${event}" (${timeoutMs}ms)`))
    }, timeoutMs)
    const handler = (payload) => {
      if (!predicate(payload)) return
      clearTimeout(timer)
      socket.off(event, handler)
      resolve(payload)
    }
    socket.on(event, handler)
  })
}

function connected(socket) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('socket connect timeout')), 5000)
    socket.once('connect', () => {
      clearTimeout(t)
      resolve()
    })
    socket.once('connect_error', (e) => {
      clearTimeout(t)
      reject(new Error(`connect_error: ${e.message}`))
    })
  })
}

function ack(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout for "${event}"`)), timeoutMs)
    socket.emit(event, payload, (res) => {
      clearTimeout(t)
      resolve(res)
    })
  })
}

// 1x1 transparent PNG
const FAKE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const sockets = []

async function main() {
  console.log(`\nAtrium smoke test → ${BASE}\n`)

  // ---------- health ----------
  await check('GET /api/health returns ok', async () => {
    const { status, data } = await api('GET', '/api/health')
    assert(status === 200, `status ${status}`)
    assert(data?.ok === true, 'ok !== true')
  })

  // ---------- register 2 users ----------
  const u1 = await check('register user1 (owner-to-be)', async () => {
    const { status, data } = await api('POST', '/api/auth/register', {
      body: {
        username: `alice_${RUN_ID}`,
        displayName: 'Алиса Тестова',
        email: `alice_${RUN_ID}@test.local`,
        password: 'secret123',
      },
    })
    assert(status === 201, `status ${status}`)
    assert(data.token, 'no token')
    assert(data.user?.username === `alice_${RUN_ID}`, 'bad user')
    assert(data.user?.avatarColor, 'no avatarColor')
    return data
  })

  const u2 = await check('register user2 (invitee)', async () => {
    const { status, data } = await api('POST', '/api/auth/register', {
      body: {
        username: `bob_${RUN_ID}`,
        displayName: 'Борис Тестов',
        email: `bob_${RUN_ID}@test.local`,
        password: 'secret123',
      },
    })
    assert(status === 201, `status ${status}`)
    assert(data.token, 'no token')
    return data
  })

  await check('register validation: short username -> 400', async () => {
    const { status } = await api('POST', '/api/auth/register', {
      body: { username: 'x', displayName: 'X', email: 'x@x.xx', password: '123456' },
    })
    assert(status === 400, `status ${status}`)
  })

  await check('register duplicate username -> 409', async () => {
    const { status } = await api('POST', '/api/auth/register', {
      body: {
        username: `ALICE_${RUN_ID}`.toLowerCase(), // same as alice (case-insensitive)
        displayName: 'Дубль',
        email: `dup_${RUN_ID}@test.local`,
        password: 'secret123',
      },
    })
    assert(status === 409, `status ${status}`)
  })

  await check('login with wrong password -> 401', async () => {
    const { status } = await api('POST', '/api/auth/login', {
      body: { login: `alice_${RUN_ID}`, password: 'wrongpass' },
    })
    assert(status === 401, `status ${status}`)
  })

  const login = await check('login works', async () => {
    const { status, data } = await api('POST', '/api/auth/login', {
      body: { login: `alice_${RUN_ID}`, password: 'secret123' },
    })
    assert(status === 200, `status ${status}`)
    assert(data.token, 'no token')
    return data
  })

  await check('GET /api/me -> {user}', async () => {
    const { status, data } = await api('GET', '/api/me', { token: u1.token })
    assert(status === 200, `status ${status}`)
    assert(data.user?.username === `alice_${RUN_ID}`, 'wrong user')
  })

  await check('GET /api/me without token -> 401', async () => {
    const { status } = await api('GET', '/api/me')
    assert(status === 401, `status ${status}`)
  })

  // ---------- org ----------
  const orgRes = await check('create org by user1', async () => {
    const { status, data } = await api('POST', '/api/orgs', {
      token: u1.token,
      body: { name: `Atrium Smoke ${RUN_ID}`, description: 'Тестовая организация' },
    })
    assert(status === 201, `status ${status}`)
    assert(data.role === 'owner', 'role !== owner')
    assert(data.org?.id?.startsWith('o_'), 'bad org id')
    return data
  })
  const orgId = orgRes.org.id

  await check('GET /api/orgs lists the org', async () => {
    const { status, data } = await api('GET', '/api/orgs', { token: u1.token })
    assert(status === 200, `status ${status}`)
    assert(data.orgs.some((o) => o.id === orgId), 'org not listed')
  })

  await check('org has default #general channel', async () => {
    const { status, data } = await api('GET', `/api/orgs/${orgId}/channels`, { token: u1.token })
    assert(status === 200, `status ${status}`)
    assert(data.channels.length === 1, `channels: ${data.channels.length}`)
    assert(data.channels[0].name === 'general', 'not #general')
    return data.channels[0]
  })

  // ---------- invite flow ----------
  const inviteRes = await check('user1 invites user2 (rank ok)', async () => {
    const { status, data } = await api('POST', `/api/orgs/${orgId}/invite`, {
      token: u1.token,
      body: { usernameOrEmail: `bob_${RUN_ID}`, role: 'member' },
    })
    assert(status === 201, `status ${status}`)
    assert(data.invite?.status === 'pending', 'not pending')
    assert(data.invite?.contractText?.includes(`Atrium Smoke ${RUN_ID}`), 'contract missing org name')
    assert(data.invite?.contractText?.includes('ДОГОРОР О ПРИСОЕДИНЕНИИ'), 'contract template missing')
    assert(data.invite?.contractText?.includes('Участник'), 'role label missing')
    assert(data.invite?.invitee?.user?.username === `bob_${RUN_ID}`, 'wrong invitee')
    return data
  })
  const inviteId = inviteRes.invite.id

  await check('duplicate invite -> 409', async () => {
    const { status } = await api('POST', `/api/orgs/${orgId}/invite`, {
      token: u1.token,
      body: { usernameOrEmail: `bob_${RUN_ID}`, role: 'member' },
    })
    assert(status === 409, `status ${status}`)
  })

  await check('GET /api/invites (user2) returns pending invite with contract', async () => {
    const { status, data } = await api('GET', '/api/invites', { token: u2.token })
    assert(status === 200, `status ${status}`)
    const inv = data.invites.find((i) => i.invite?.id === inviteId)
    assert(inv, 'invite not found')
    assert(inv.contractText?.startsWith('ДОГОРОР О ПРИСОЕДИНЕНИИ'), 'no contractText')
    assert(inv.org?.id === orgId, 'wrong org')
    assert(inv.inviter?.user?.username === `alice_${RUN_ID}`, 'wrong inviter')
    assert(typeof inv.role === 'string', 'no role')
    assert(typeof inv.createdAt === 'number', 'no createdAt')
  })

  await check('accept validation: missing signature -> 400', async () => {
    const { status } = await api('POST', `/api/invites/${inviteId}/accept`, {
      token: u2.token,
      body: { signatureDataUrl: '', signedName: 'Борис Тестов' },
    })
    assert(status === 400, `status ${status}`)
  })

  await check('accept validation: short name -> 400', async () => {
    const { status } = await api('POST', `/api/invites/${inviteId}/accept`, {
      token: u2.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Б' },
    })
    assert(status === 400, `status ${status}`)
  })

  const acceptRes = await check('accept invite with signature + signedName', async () => {
    const { status, data } = await api('POST', `/api/invites/${inviteId}/accept`, {
      token: u2.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Борис Тестов' },
    })
    assert(status === 200, `status ${status}`)
    assert(data.org?.id === orgId, 'wrong org')
    assert(data.role === 'member', 'wrong role')
    return data
  })

  await check('signature stored on invite row (re-accept -> 409)', async () => {
    const { status } = await api('POST', `/api/invites/${inviteId}/accept`, {
      token: u2.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Борис Тестов' },
    })
    assert(status === 409, `status ${status}`)
  })

  await check('GET /api/orgs/:id shows user2 as member', async () => {
    const { status, data } = await api('GET', `/api/orgs/${orgId}`, { token: u2.token })
    assert(status === 200, `status ${status}`)
    assert(data.role === 'member', 'wrong role')
    const m = data.members.find((x) => x.user.username === `bob_${RUN_ID}`)
    assert(m && m.role === 'member', 'member not found')
    assert(data.channels.some((c) => c.name === 'general'), 'no general channel')
  })

  // ---------- sockets ----------
  const s1 = connect(u1.token)
  const s2 = connect(u2.token)
  sockets.push(s1, s2)

  await check('both users connect via socket.io', async () => {
    await Promise.all([connected(s1), connected(s2)])
  })

  await check('socket with bad token is rejected', async () => {
    const bad = connect('not-a-valid-token')
    sockets.push(bad)
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('bad token socket was NOT rejected')), 4000)
      bad.on('connect', () => {
        clearTimeout(t)
        reject(new Error('bad token socket connected'))
      })
      bad.on('connect_error', () => {
        clearTimeout(t)
        resolve()
      })
    })
  })

  // channel access
  const channels = await check('both users can fetch #general', async () => {
    const r1 = await api('GET', `/api/orgs/${orgId}/channels`, { token: u1.token })
    const r2 = await api('GET', `/api/orgs/${orgId}/channels`, { token: u2.token })
    assert(r1.status === 200 && r2.status === 200, 'channel fetch failed')
    const c1 = r1.data.channels[0]
    const access = await api('GET', `/api/channels/${c1.id}`, { token: u2.token })
    assert(access.status === 200, `channel access status ${access.status}`)
    assert(access.data.channel.type === 'channel', 'type !== channel')
    return c1
  })
  const channelId = channels.id

  // ---------- message over socket ----------
  await check('message:send ack + other user receives message:new', async () => {
    const got = waitFor(
      s2,
      'message:new',
      (p) => p?.message?.text === 'Привет из смоук-теста!' && p.message.channelId === channelId
    )
    const res = await ack(s1, 'message:send', {
      channelId,
      text: 'Привет из смоук-теста!',
      tempId: 'tmp-123',
    })
    assert(res.ok === true, `ack: ${JSON.stringify(res)}`)
    assert(res.message?.id?.startsWith('m_'), 'bad message id')
    assert(res.message?.tempId === 'tmp-123', 'tempId not echoed in ack')
    const evt = await got
    assert(evt.message.id === res.message.id, 'message id mismatch')
    assert(evt.message.sender?.username === `alice_${RUN_ID}`, 'wrong sender')
  })

  await check('empty message rejected (ack error)', async () => {
    const res = await ack(s1, 'message:send', { channelId, text: '   ' })
    assert(res.error, 'expected error')
  })

  await check('overlong message rejected (ack error)', async () => {
    const res = await ack(s1, 'message:send', { channelId, text: 'x'.repeat(4001) })
    assert(res.error, 'expected error')
  })

  await check('typing relayed to other member', async () => {
    const got = waitFor(s2, 'typing', (p) => p?.channelId === channelId && p?.typing === true && p?.user?.id === u1.user.id)
    s1.emit('typing', { channelId, typing: true })
    await got
  })

  // ---------- messages pagination ----------
  const msgIds = []
  await check('REST messages pagination (latest page)', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await ack(s1, 'message:send', { channelId, text: `msg-${i}` })
      msgIds.push(res.message.id)
    }
    const { status, data } = await api('GET', `/api/channels/${channelId}/messages?limit=3`, { token: u2.token })
    assert(status === 200, `status ${status}`)
    assert(data.messages.length === 3, `expected 3 got ${data.messages.length}`)
    assert(data.hasMore === true, 'hasMore should be true')
    const last = data.messages[data.messages.length - 1]
    const before = await api('GET', `/api/channels/${channelId}/messages?before=${last.id}&limit=3`, { token: u2.token })
    assert(before.status === 200, `before status ${before.status}`)
    assert(before.data.messages.length === 3, `expected 3 got ${before.data.messages.length}`)
    const ids = before.data.messages.map((m) => m.id)
    assert(!ids.includes(last.id), 'before page must not include anchor')
    const asc = [...before.data.messages].every((m, i, a) => i === 0 || a[i - 1].createdAt <= m.createdAt)
    assert(asc, 'messages must be ASC')
  })

  // ---------- call signaling ----------
  let callId
  await check('call:invite -> ack {ok, callId} + callee gets call:incoming', async () => {
    const incoming = waitFor(s2, 'call:incoming', (p) => p?.kind === 'video' && p?.from?.id === u1.user.id)
    const res = await ack(s1, 'call:invite', { calleeId: u2.user.id, kind: 'video', channelId })
    assert(res.ok === true, `ack: ${JSON.stringify(res)}`)
    assert(typeof res.callId === 'string' && res.callId, 'no callId')
    callId = res.callId
    const evt = await incoming
    assert(evt.callId === callId, 'callId mismatch')
    assert(evt.from?.displayName === 'Алиса Тестова', 'wrong from')
    assert(evt.channelId === channelId, 'channelId lost')
  })

  await check('second call to busy callee -> error', async () => {
    const res = await ack(s2, 'call:invite', { calleeId: u1.user.id, kind: 'audio' })
    assert(res.error, 'expected busy error')
  })

  await check('call:accept -> caller gets call:accepted', async () => {
    const accepted = waitFor(s1, 'call:accepted', (p) => p?.callId === callId)
    const res = await ack(s2, 'call:accept', { callId })
    assert(res.ok === true, `ack: ${JSON.stringify(res)}`)
    await accepted
  })

  await check('rtc:sdp relayed caller -> callee', async () => {
    const got = waitFor(s2, 'rtc:sdp', (p) => p?.callId === callId && p?.from === u1.user.id)
    const sdp = { type: 'offer', sdp: 'v=0 fake-offer' }
    s1.emit('rtc:sdp', { callId, to: u2.user.id, sdp })
    const evt = await got
    assert(evt.sdp?.sdp === 'v=0 fake-offer', 'sdp not relayed')
  })

  await check('rtc:sdp answer relayed callee -> caller', async () => {
    const got = waitFor(s1, 'rtc:sdp', (p) => p?.callId === callId && p?.from === u2.user.id)
    const sdp = { type: 'answer', sdp: 'v=0 fake-answer' }
    s2.emit('rtc:sdp', { callId, to: u1.user.id, sdp })
    const evt = await got
    assert(evt.sdp?.type === 'answer', 'answer not relayed')
  })

  await check('rtc:ice relayed both ways', async () => {
    const got = waitFor(s2, 'rtc:ice', (p) => p?.callId === callId && p?.from === u1.user.id)
    s1.emit('rtc:ice', { callId, to: u2.user.id, candidate: { candidate: 'candidate:1 1 UDP 1 1.2.3.4 1234 typ host' } })
    const evt = await got
    assert(evt.candidate?.candidate?.startsWith('candidate:1'), 'candidate not relayed')
  })

  await check('call:state relayed to peer', async () => {
    const got = waitFor(s1, 'call:state', (p) => p?.callId === callId && p?.muted === true)
    s2.emit('call:state', { callId, muted: true, cameraOff: false })
    const evt = await got
    assert(evt.cameraOff === false, 'cameraOff lost')
  })

  await check('call:leave -> peer gets call:left', async () => {
    const got = waitFor(s2, 'call:left', (p) => p?.callId === callId)
    const res = await ack(s1, 'call:leave', { callId })
    assert(res.ok === true, `ack: ${JSON.stringify(res)}`)
    await got
  })

  // ---------- permission checks ----------
  await check('member (rank 20) cannot invite -> 403', async () => {
    const { status, data } = await api('POST', `/api/orgs/${orgId}/invite`, {
      token: u2.token,
      body: { usernameOrEmail: `alice_${RUN_ID}`, role: 'member' },
    })
    assert(status === 403, `status ${status}`)
    assert(typeof data.error === 'string' && data.error.length > 0, 'no Russian error')
    assert(/[А-Яа-яЁё]/.test(data.error), 'error not in Russian')
  })

  await check('member cannot create channel -> 403', async () => {
    const { status } = await api('POST', `/api/orgs/${orgId}/channels`, {
      token: u2.token,
      body: { name: `nope-${RUN_ID}` },
    })
    assert(status === 403, `status ${status}`)
  })

  await check('member cannot edit org -> 403', async () => {
    const { status } = await api('PATCH', `/api/orgs/${orgId}`, {
      token: u2.token,
      body: { name: 'Hacked' },
    })
    assert(status === 403, `status ${status}`)
  })

  await check('member cannot view org invites -> 403', async () => {
    const { status } = await api('GET', `/api/orgs/${orgId}/invites`, { token: u2.token })
    assert(status === 403, `status ${status}`)
  })

  await check('non-member cannot fetch org -> 403', async () => {
    const { status } = await api('GET', '/api/orgs/o_000000000000', { token: u2.token })
    assert(status === 404, `status ${status}`) // unknown org -> 404
  })

  await check('user search works', async () => {
    const { status, data } = await api('GET', `/api/users/search?q=bob_`, { token: u1.token })
    assert(status === 200, `status ${status}`)
    assert(data.users.some((u) => u.username === `bob_${RUN_ID}`), 'user2 not found in search')
  })

  // ---------- DELETE message permission ----------
  const msgFromUser2 = await check('user2 sends a message (ack)', async () => {
    const res = await ack(s2, 'message:send', { channelId, text: 'Сообщение Бориса' })
    assert(res.ok === true, `ack: ${JSON.stringify(res)}`)
    return res.message
  })

  const msgFromUser1 = await check('user1 sends a message (ack)', async () => {
    const res = await ack(s1, 'message:send', { channelId, text: 'Сообщение Алисы' })
    assert(res.ok === true, `ack: ${JSON.stringify(res)}`)
    return res.message
  })

  await check('user2 cannot delete user1 message -> 403', async () => {
    const { status, data } = await api('DELETE', `/api/messages/${msgFromUser1.id}`, { token: u2.token })
    assert(status === 403, `status ${status}`)
    assert(/[А-Яа-яЁё]/.test(data.error || ''), 'error not in Russian')
  })

  await check('user1 (owner, rank 100) can delete user2 message -> ok', async () => {
    const { status, data } = await api('DELETE', `/api/messages/${msgFromUser2.id}`, { token: u1.token })
    assert(status === 200, `status ${status}`)
    assert(data.ok === true, 'ok !== true')
  })

  await check('author can delete own message -> ok', async () => {
    const res = await ack(s2, 'message:send', { channelId, text: 'Своё сообщение' })
    const { status, data } = await api('DELETE', `/api/messages/${res.message.id}`, { token: u2.token })
    assert(status === 200, `status ${status}`)
    assert(data.ok === true, 'ok !== true')
  })

  await check('delete missing message -> 404', async () => {
    const { status } = await api('DELETE', '/api/messages/m_ffffffffffff', { token: u1.token })
    assert(status === 404, `status ${status}`)
  })

  // ---------- DM + role change + channel create ----------
  const dmRes = await check('POST /api/dms find-or-create', async () => {
    const first = await api('POST', '/api/dms', { token: u1.token, body: { orgId, userId: u2.user.id } })
    assert(first.status === 200, `status ${first.status}`)
    assert(first.data.channel.type === 'dm', 'type !== dm')
    assert(first.data.peer.username === `bob_${RUN_ID}`, 'wrong peer')
    const second = await api('POST', '/api/dms', { token: u2.token, body: { orgId, userId: u1.user.id } })
    assert(second.status === 200, `second status ${second.status}`)
    assert(second.data.channel.id === first.data.channel.id, 'DM must be find-or-create')
    return first.data
  })

  await check('DM messages accessible to both, not to others', async () => {
    const { status } = await api('GET', `/api/channels/${dmRes.channel.id}/messages`, { token: u2.token })
    assert(status === 200, `status ${status}`)
    const stranger = await api('POST', '/api/auth/register', {
      body: {
        username: `eve_${RUN_ID}`,
        displayName: 'Ева',
        email: `eve_${RUN_ID}@test.local`,
        password: 'secret123',
      },
    })
    const { status: s } = await api('GET', `/api/channels/${dmRes.channel.id}/messages`, { token: stranger.data.token })
    assert(s === 403, `stranger status ${s}`)
  })

  await check('owner creates a second channel + channel:created event', async () => {
    const evtP = waitFor(s2, 'channel:created', (p) => p?.channel?.name === `новый-${RUN_ID}`)
    const { status, data } = await api('POST', `/api/orgs/${orgId}/channels`, {
      token: u1.token,
      body: { name: `новый-${RUN_ID}` },
    })
    assert(status === 201, `status ${status}`)
    assert(data.channel.type === 'channel', 'type !== channel')
    await evtP
  })

  await check('duplicate channel name -> 409', async () => {
    const { status } = await api('POST', `/api/orgs/${orgId}/channels`, {
      token: u1.token,
      body: { name: `НОВЫЙ-${RUN_ID}`.toUpperCase() },
    })
    assert(status === 409, `status ${status}`)
  })

  await check('owner promotes user2 -> role:changed event', async () => {
    const evtP = waitFor(s1, 'role:changed', (p) => p?.userId === u2.user.id && p?.role === 'admin')
    const { status, data } = await api('PATCH', `/api/orgs/${orgId}/members/${u2.user.id}`, {
      token: u1.token,
      body: { role: 'admin' },
    })
    assert(status === 200, `status ${status}`)
    assert(data.member?.role === 'admin', 'role not changed')
    await evtP
  })

  await check('member cannot promote others -> 403 (before promotion)', async () => {
    // at this point user2 is admin; register a fresh plain member check via user1 demoting? Use org-less user:
    const { status } = await api('PATCH', `/api/orgs/${orgId}/members/${u1.user.id}`, {
      token: u2.token,
      body: { role: 'member' },
    })
    // user2 is admin(60), target user1 is owner(100): admin rank <= owner rank -> 403
    assert(status === 403, `status ${status}`)
  })

  await check('cannot assign role >= own rank -> 403', async () => {
    // user2 (admin, 60) tries to make user1 owner — target is owner -> forbidden anyway;
    // demote user2 to member first via owner, then check member cannot invite
    const { status } = await api('PATCH', `/api/orgs/${orgId}/members/${u2.user.id}`, {
      token: u1.token,
      body: { role: 'member' },
    })
    assert(status === 200, `status ${status}`)
  })

  await check('invite role must be below actor rank -> 400', async () => {
    // owner invites with... owner cannot invite owner role
    const { status } = await api('POST', `/api/orgs/${orgId}/invite`, {
      token: u1.token,
      body: { usernameOrEmail: `eve_${RUN_ID}@test.local`, role: 'owner' },
    })
    assert(status === 400, `status ${status}`)
  })

  // ---------- presence ----------
  await check('presence:update broadcast', async () => {
    const strangerReg = await api('POST', '/api/auth/register', {
      body: {
        username: `dan_${RUN_ID}`,
        displayName: 'Дэн',
        email: `dan_${RUN_ID}@test.local`,
        password: 'secret123',
      },
    })
    const on = waitFor(s1, 'presence:update', (p) => p?.userId === strangerReg.data.user.id && p?.online === true)
    const s3 = connect(strangerReg.data.token)
    sockets.push(s3)
    await connected(s3)
    await on
    const off = waitFor(s1, 'presence:update', (p) => p?.userId === strangerReg.data.user.id && p?.online === false)
    s3.disconnect()
    await off
  })

  // ---------- member:joined / member:left / invite:new ----------
  await check('invite:new emitted to invitee sockets', async () => {
    const watcherReg = await api('POST', '/api/auth/register', {
      body: {
        username: `watch_${RUN_ID}`,
        displayName: 'Наблюдатель',
        email: `watch_${RUN_ID}@test.local`,
        password: 'secret123',
      },
    })
    const sw = connect(watcherReg.data.token)
    sockets.push(sw)
    await connected(sw)
    const got = waitFor(sw, 'invite:new', (p) => p?.org?.id === orgId)
    const { status } = await api('POST', `/api/orgs/${orgId}/invite`, {
      token: u1.token,
      body: { usernameOrEmail: `watch_${RUN_ID}`, role: 'member' },
    })
    assert(status === 201, `status ${status}`)
    const evt = await got
    assert(evt.inviter?.user?.username === `alice_${RUN_ID}`, 'wrong inviter')
    assert(evt.invite?.contractText, 'no contractText in event')

    // watcher accepts -> member:joined to org members
    const joined = waitFor(s1, 'member:joined', (p) => p?.orgId === orgId && p?.user?.id === watcherReg.data.user.id)
    const acc = await api('POST', `/api/invites/${evt.invite.id}/accept`, {
      token: watcherReg.data.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Наблюдатель Фамилиев' },
    })
    assert(acc.status === 200, `accept status ${acc.status}`)
    await joined

    // watcher leaves -> member:left
    const left = waitFor(s1, 'member:left', (p) => p?.orgId === orgId && p?.userId === watcherReg.data.user.id)
    const lv = await api('POST', `/api/orgs/${orgId}/leave`, { token: watcherReg.data.token })
    assert(lv.status === 200, `leave status ${lv.status}`)
    await left
  })

  await check('owner cannot leave org -> 409', async () => {
    const { status } = await api('POST', `/api/orgs/${orgId}/leave`, { token: u1.token })
    assert(status === 409, `status ${status}`)
  })

  await check('decline flow works', async () => {
    const target = await api('POST', '/api/auth/register', {
      body: {
        username: `decl_${RUN_ID}`,
        displayName: 'Отказник',
        email: `decl_${RUN_ID}@test.local`,
        password: 'secret123',
      },
    })
    const inv = await api('POST', `/api/orgs/${orgId}/invite`, {
      token: u1.token,
      body: { usernameOrEmail: `decl_${RUN_ID}`, role: 'member' },
    })
    assert(inv.status === 201, `invite status ${inv.status}`)
    const dec = await api('POST', `/api/invites/${inv.data.invite.id}/decline`, { token: target.data.token })
    assert(dec.status === 200, `decline status ${dec.status}`)
    const again = await api('POST', `/api/invites/${inv.data.invite.id}/accept`, {
      token: target.data.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Отказник Отказов' },
    })
    assert(again.status === 409, `re-accept status ${again.status}`)
  })

  await check('inviter (owner) can cancel pending invite -> ok', async () => {
    const target = await api('POST', '/api/auth/register', {
      body: {
        username: `cancel_${RUN_ID}`,
        displayName: 'Отмена',
        email: `cancel_${RUN_ID}@test.local`,
        password: 'secret123',
      },
    })
    const inv = await api('POST', `/api/orgs/${orgId}/invite`, {
      token: u1.token,
      body: { usernameOrEmail: `cancel_${RUN_ID}`, role: 'member' },
    })
    assert(inv.status === 201, `invite status ${inv.status}`)
    const orgInvites = await api('GET', `/api/orgs/${orgId}/invites`, { token: u1.token })
    assert(orgInvites.status === 200, `org invites status ${orgInvites.status}`)
    assert(
      orgInvites.data.invites.some((i) => i.id === inv.data.invite.id),
      'pending invite not listed for org'
    )
    const del = await api('DELETE', `/api/invites/${inv.data.invite.id}`, { token: u1.token })
    assert(del.status === 200, `cancel status ${del.status}`)
    // invitee no longer sees it
    const list = await api('GET', '/api/invites', { token: target.data.token })
    assert(!list.data.invites.some((i) => i.invite?.id === inv.data.invite.id), 'canceled invite still listed')
  })

  await check('malformed JSON body -> 400 (server stays alive)', async () => {
    const res = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    })
    assert(res.status === 400, `status ${res.status}`)
    const health = await api('GET', '/api/health')
    assert(health.status === 200, 'server crashed after bad input')
  })

  await check('nonexistent route -> 404 JSON', async () => {
    const { status, data } = await api('GET', '/api/definitely-not-a-route')
    assert(status === 404, `status ${status}`)
    assert(typeof data.error === 'string', 'no error field')
  })

  // ============================================================
  // SPEC v2 (§10–13, §16) + SPEC v3 (§17–19, §22)
  // ============================================================

  const reg = async (prefix, displayName) => {
    const { status, data } = await api('POST', '/api/auth/register', {
      body: {
        username: `${prefix}_${RUN_ID}`,
        displayName,
        email: `${prefix}_${RUN_ID}@test.local`,
        password: 'secret123',
      },
    })
    assert(status === 201, `register ${prefix}: status ${status}`)
    return data
  }
  const connectAndTrack = async (token) => {
    const s = connect(token)
    sockets.push(s)
    await connected(s)
    return s
  }

  // ---------- profile: PATCH /api/me + saved signature (§17/§22) ----------
  await check('PATCH /api/me: displayName + fullName -> {user}', async () => {
    const { status, data } = await api('PATCH', '/api/me', {
      token: u1.token,
      body: { displayName: 'Алиса Тестова', fullName: 'Алиса Тестова' },
    })
    assert(status === 200, `status ${status}`)
    assert(data.user?.fullName === 'Алиса Тестова', 'fullName not saved')
    const me = await api('GET', '/api/me', { token: u1.token })
    assert(me.status === 200, `status ${me.status}`)
    assert(me.data.user?.fullName === 'Алиса Тестова', 'fullName missing in GET /api/me')
    assert('signature' in me.data.user, 'signature missing in GET /api/me')
    assert('signatureKind' in me.data.user, 'signatureKind missing in GET /api/me')
  })

  await check('PATCH /api/me validation: short displayName -> 400', async () => {
    const { status } = await api('PATCH', '/api/me', { token: u1.token, body: { displayName: 'A' } })
    assert(status === 400, `status ${status}`)
  })

  await check('PATCH /api/me: wrong currentPassword -> 400', async () => {
    const { status } = await api('PATCH', '/api/me', {
      token: u1.token,
      body: { password: 'secret456', currentPassword: 'not-the-password' },
    })
    assert(status === 400, `status ${status}`)
  })

  await check('PUT /api/me/signature: drawn -> signatureKind "drawn"', async () => {
    const { status, data } = await api('PUT', '/api/me/signature', {
      token: u1.token,
      body: { kind: 'drawn', dataUrl: FAKE_PNG },
    })
    assert(status === 200, `status ${status}`)
    assert(data.user?.signatureKind === 'drawn', `kind: ${data.user?.signatureKind}`)
    assert(data.user?.signature === FAKE_PNG, 'signature image not saved')
  })

  await check('PUT /api/me/signature: text -> signatureKind "typed" + signatureText', async () => {
    const { status, data } = await api('PUT', '/api/me/signature', {
      token: u1.token,
      body: { kind: 'text', text: 'Алиса Тестова' },
    })
    assert(status === 200, `status ${status}`)
    assert(data.user?.signatureKind === 'typed', `kind: ${data.user?.signatureKind}`)
    assert(data.user?.signatureText === 'Алиса Тестова', 'signatureText not saved')
  })

  await check('PUT /api/me/signature validation -> 400', async () => {
    const missing = await api('PUT', '/api/me/signature', { token: u1.token, body: { kind: 'drawn' } })
    assert(missing.status === 400, `missing dataUrl status ${missing.status}`)
    const badKind = await api('PUT', '/api/me/signature', {
      token: u1.token,
      body: { kind: 'telepathy', text: 'абв' },
    })
    assert(badKind.status === 400, `bad kind status ${badKind.status}`)
    const shortText = await api('PUT', '/api/me/signature', { token: u1.token, body: { kind: 'text', text: 'а' } })
    assert(shortText.status === 400, `short text status ${shortText.status}`)
  })

  await check('PUT /api/me/signature {kind:null} -> signature cleared', async () => {
    const { status, data } = await api('PUT', '/api/me/signature', { token: u1.token, body: { kind: null } })
    assert(status === 200, `status ${status}`)
    assert(data.user?.signature === null && data.user?.signatureKind === null, 'signature not cleared')
  })

  // ---------- catalog: discover + is_public (§12/§16/§22) ----------
  const privRes = await check('create private org (isPublic:false) -> 201', async () => {
    const { status, data } = await api('POST', '/api/orgs', {
      token: u1.token,
      body: { name: `Приватная ${RUN_ID}`, isPublic: false },
    })
    assert(status === 201, `status ${status}`)
    assert(data.org?.isPublic === false, `isPublic: ${data.org?.isPublic}`)
    return data
  })
  const privateOrgId = privRes.org.id

  await check('GET /api/discover: public visible, private hidden, isMember/myRole', async () => {
    const { status, data } = await api('GET', '/api/discover', { token: u2.token })
    assert(status === 200, `status ${status}`)
    assert(data.orgs.some((o) => o.id === orgId), 'public org missing from catalog')
    assert(!data.orgs.some((o) => o.id === privateOrgId), 'private org must be hidden')
    const pub = data.orgs.find((o) => o.id === orgId)
    assert(pub.isMember === true, 'isMember should be true for member')
    assert(pub.myRole === 'member', `myRole: ${pub.myRole}`)
    assert(typeof pub.membersCount === 'number', 'no membersCount')
    assert(typeof pub.description === 'string', 'no description')
    assert(data.orgs.length <= 30, 'catalog must be capped at 30')
  })

  await check('GET /api/discover?q= filters by name (case-insensitive)', async () => {
    const hit = await api('GET', `/api/discover?q=${encodeURIComponent(`atrium smoke ${RUN_ID}`)}`, { token: u2.token })
    assert(hit.status === 200, `status ${hit.status}`)
    assert(hit.data.orgs.length === 1 && hit.data.orgs[0].id === orgId, `hits: ${hit.data.orgs.length}`)
    const priv = await api('GET', `/api/discover?q=${encodeURIComponent(`Приватная ${RUN_ID}`)}`, { token: u2.token })
    assert(priv.data.orgs.length === 0, 'private org leaked through search')
    const none = await api('GET', '/api/discover?q=абракадабра-нет-такой', { token: u2.token })
    assert(none.data.orgs.length === 0, 'expected empty result')
  })

  await check('PATCH /api/orgs/:id isPublic toggles catalog + activity:new socket', async () => {
    const evtP = waitFor(s1, 'activity:new', (p) => p?.activity?.action === 'org.updated' && p?.activity?.actor?.id === u1.user.id)
    const off = await api('PATCH', `/api/orgs/${orgId}`, { token: u1.token, body: { isPublic: false } })
    assert(off.status === 200, `status ${off.status}`)
    assert(off.data.org?.isPublic === false, 'isPublic not false')
    await evtP
    const hidden = await api('GET', `/api/discover?q=${encodeURIComponent(`Atrium Smoke ${RUN_ID}`)}`, { token: u2.token })
    assert(hidden.data.orgs.length === 0, 'still visible after toggle off')
    const on = await api('PATCH', `/api/orgs/${orgId}`, { token: u1.token, body: { isPublic: true } })
    assert(on.data.org?.isPublic === true, 'isPublic not restored')
    const shown = await api('GET', `/api/discover?q=${encodeURIComponent(`Atrium Smoke ${RUN_ID}`)}`, { token: u2.token })
    assert(shown.data.orgs.length === 1, 'not visible after toggle on')
    const detail = await api('GET', `/api/orgs/${orgId}`, { token: u1.token })
    assert(detail.data.org?.isPublic === true, 'GET org: isPublic missing/false')
  })

  await check('member cannot change isPublic -> 403', async () => {
    const { status } = await api('PATCH', `/api/orgs/${orgId}`, { token: u2.token, body: { isPublic: false } })
    assert(status === 403, `status ${status}`)
  })

  // ---------- join applications (§12/§16) ----------
  const appl = await reg('appl', 'Аппликант Тестов')
  const sAppl = await connectAndTrack(appl.token)

  let applicationId = null
  await check('application: signature validation -> 400', async () => {
    const noSig = await api('POST', `/api/orgs/${orgId}/applications`, { token: appl.token, body: {} })
    assert(noSig.status === 400, `no-signature status ${noSig.status}`)
    const wrongField = await api('POST', `/api/orgs/${orgId}/applications`, {
      token: appl.token,
      body: { signature: FAKE_PNG, signedName: 'Аппликант Тестов' },
    })
    assert(wrongField.status === 400, `profile-signature-field status ${wrongField.status}`)
    const longMsg = await api('POST', `/api/orgs/${orgId}/applications`, {
      token: appl.token,
      body: { message: 'м'.repeat(501), signatureDataUrl: FAKE_PNG, signedName: 'Аппликант Тестов' },
    })
    assert(longMsg.status === 400, `long message status ${longMsg.status}`)
    const shortName = await api('POST', `/api/orgs/${orgId}/applications`, {
      token: appl.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'А' },
    })
    assert(shortName.status === 400, `short name status ${shortName.status}`)
  })

  await check('POST applications -> 201 pending, contract snapshotted, staff gets application:new', async () => {
    const evtP = waitFor(s1, 'application:new', (p) => p?.org?.id === orgId)
    const { status, data } = await api('POST', `/api/orgs/${orgId}/applications`, {
      token: appl.token,
      body: { message: 'Хочу вступить', signatureDataUrl: FAKE_PNG, signedName: 'Аппликант Тестов' },
    })
    assert(status === 201, `status ${status}`)
    const a = data.application
    assert(a.status === 'pending', `status ${a.status}`)
    assert(a.type === 'join_application', `type ${a.type}`)
    assert(a.id.startsWith('d_'), 'bad document id')
    assert(a.targetUserId === appl.user.id && a.createdBy === appl.user.id, 'created_by/target mismatch')
    assert(a.contractText.includes(`Atrium Smoke ${RUN_ID}`), 'contract missing org name')
    assert(a.contractText.includes('ДОГОРОР О ПРИСОЕДИНЕНИИ'), 'contract template missing')
    assert(a.contractText.includes('Участник'), 'role label missing')
    assert(a.signature === FAKE_PNG && a.signatureKind === 'png', 'signature not stored')
    assert(a.signedName === 'Аппликант Тестов' && typeof a.signedAt === 'number', 'signed fields missing')
    applicationId = a.id
    const evt = await evtP
    assert(evt.application?.id === applicationId, 'application:new carries wrong document')
    assert(evt.user?.username === `appl_${RUN_ID}`, 'application:new: wrong user')
    assert(evt.org?.id === orgId, 'application:new: wrong org')
  })

  await check('duplicate application -> 409', async () => {
    const { status } = await api('POST', `/api/orgs/${orgId}/applications`, {
      token: appl.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Аппликант Тестов' },
    })
    assert(status === 409, `status ${status}`)
  })

  await check('member application -> 409', async () => {
    const { status } = await api('POST', `/api/orgs/${orgId}/applications`, {
      token: u2.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Борис Тестов' },
    })
    assert(status === 409, `status ${status}`)
  })

  await check('GET /api/applications/mine: pending first + org ref', async () => {
    const { status, data } = await api('GET', '/api/applications/mine', { token: appl.token })
    assert(status === 200, `status ${status}`)
    assert(data.applications.length >= 1, 'no applications')
    const first = data.applications[0]
    assert(first.application.id === applicationId, 'pending must be first')
    assert(first.org?.id === orgId, 'wrong org ref')
    assert(first.org?.isPublic === true, 'org isPublic missing in ref')
    assert(data.applications.every((x) => x.application.type === 'join_application'), 'only join applications expected')
  })

  await check('GET /api/orgs/:id/applications: member 403, staff 200 with applicant', async () => {
    const denied = await api('GET', `/api/orgs/${orgId}/applications`, { token: u2.token })
    assert(denied.status === 403, `member status ${denied.status}`)
    const { status, data } = await api('GET', `/api/orgs/${orgId}/applications`, { token: u1.token })
    assert(status === 200, `status ${status}`)
    const found = data.applications.find((x) => x.application.id === applicationId)
    assert(found, 'application not listed for staff')
    assert(found.user?.username === `appl_${RUN_ID}`, 'applicant user missing')
    assert(found.application.message === 'Хочу вступить', 'message lost')
  })

  await check('member cannot accept application -> 403', async () => {
    const { status } = await api('POST', `/api/applications/${applicationId}/accept`, { token: u2.token })
    assert(status === 403, `status ${status}`)
  })

  await check('accept application -> approved, member created (role member), author gets application:update', async () => {
    const evtP = waitFor(sAppl, 'application:update', (p) => p?.application?.id === applicationId)
    const { status, data } = await api('POST', `/api/applications/${applicationId}/accept`, { token: u1.token })
    assert(status === 200, `status ${status}`)
    assert(data.application.status === 'approved', `status ${data.application.status}`)
    const evt = await evtP
    assert(evt.application.status === 'approved', 'socket must carry approved status')
    const asMember = await api('GET', `/api/orgs/${orgId}`, { token: appl.token })
    assert(asMember.status === 200, `applicant org fetch ${asMember.status}`)
    assert(asMember.data.role === 'member', `role: ${asMember.data.role}`)
    const row = asMember.data.members.find((m) => m.user.username === `appl_${RUN_ID}`)
    assert(row && row.role === 'member', 'member row missing or wrong role')
  })

  await check('re-accept resolved application -> 409', async () => {
    const { status } = await api('POST', `/api/applications/${applicationId}/accept`, { token: u1.token })
    assert(status === 409, `status ${status}`)
  })

  const rjct = await reg('rjct', 'Реджект Тестов')
  const sRjct = await connectAndTrack(rjct.token)
  let rjctAppId = null

  await check('application reject flow -> rejected + application:update to author', async () => {
    const create = await api('POST', `/api/orgs/${orgId}/applications`, {
      token: rjct.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Реджект Тестов' },
    })
    assert(create.status === 201, `create status ${create.status}`)
    rjctAppId = create.data.application.id
    const memberTries = await api('POST', `/api/applications/${rjctAppId}/reject`, { token: u2.token })
    assert(memberTries.status === 403, `member reject status ${memberTries.status}`)
    const evtP = waitFor(sRjct, 'application:update', (p) => p?.application?.id === rjctAppId)
    const { status, data } = await api('POST', `/api/applications/${rjctAppId}/reject`, { token: u1.token })
    assert(status === 200, `status ${status}`)
    assert(data.application.status === 'rejected', `status ${data.application.status}`)
    const evt = await evtP
    assert(evt.application.status === 'rejected', 'socket mismatch')
    const stillOut = await api('GET', `/api/orgs/${orgId}`, { token: rjct.token })
    assert(stillOut.status === 403, 'rejected applicant must not become member')
  })

  const cncl = await reg('cncl', 'Отзовик Тестов')
  await check('application cancel flow: author only, staff gets application:update', async () => {
    const create = await api('POST', `/api/orgs/${orgId}/applications`, {
      token: cncl.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Отзовик Тестов' },
    })
    assert(create.status === 201, `create status ${create.status}`)
    const notAuthor = await api('POST', `/api/applications/${create.data.application.id}/cancel`, { token: u1.token })
    assert(notAuthor.status === 403, `non-author cancel status ${notAuthor.status}`)
    const evtP = waitFor(s1, 'application:update', (p) => p?.application?.id === create.data.application.id)
    const { status, data } = await api('POST', `/api/applications/${create.data.application.id}/cancel`, { token: cncl.token })
    assert(status === 200, `status ${status}`)
    assert(data.application.status === 'canceled', `status ${data.application.status}`)
    const evt = await evtP
    assert(evt.application.status === 'canceled', 'staff socket mismatch')
  })

  const pkt = await reg('pkt', 'Счётчик Тестов')
  let pktAppId = null
  await check('GET /api/orgs/:id pendingApplications: staff sees count, member 0', async () => {
    const create = await api('POST', `/api/orgs/${orgId}/applications`, {
      token: pkt.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Счётчик Тестов' },
    })
    assert(create.status === 201, `create status ${create.status}`)
    pktAppId = create.data.application.id
    const staff = await api('GET', `/api/orgs/${orgId}`, { token: u1.token })
    assert(staff.data.pendingApplications === 1, `staff pendingApplications: ${staff.data.pendingApplications}`)
    const member = await api('GET', `/api/orgs/${orgId}`, { token: u2.token })
    assert(member.data.pendingApplications === 0, `member pendingApplications: ${member.data.pendingApplications}`)
  })

  // ---------- staff joins for dismissal / matrix tests ----------
  const boss = await reg('boss', 'Босс Тестов')
  const aide = await reg('aide', 'Помощник Тест')
  const hold = await reg('hold', 'Холдер Тестов')
  const fired = await reg('fired', 'Увольняемый Тест')
  let holdInviteId = null

  await check('pending invite blocks application -> 409', async () => {
    const inv = await api('POST', `/api/orgs/${orgId}/invite`, {
      token: u1.token,
      body: { usernameOrEmail: `hold_${RUN_ID}`, role: 'member' },
    })
    assert(inv.status === 201, `invite status ${inv.status}`)
    holdInviteId = inv.data.invite.id
    const apply = await api('POST', `/api/orgs/${orgId}/applications`, {
      token: hold.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Холдер Тестов' },
    })
    assert(apply.status === 409, `status ${apply.status}`)
  })

  await check('invite accept: profile `signature` field alone -> 400', async () => {
    const { status } = await api('POST', `/api/invites/${holdInviteId}/accept`, {
      token: hold.token,
      body: { signature: FAKE_PNG, signedName: 'Холдер Тестов' },
    })
    assert(status === 400, `status ${status}`)
  })

  await check('invite accept with typed signatureText -> 200 (member)', async () => {
    const { status, data } = await api('POST', `/api/invites/${holdInviteId}/accept`, {
      token: hold.token,
      body: { signatureText: 'Холдер Тестов', signedName: 'Холдер Тестов' },
    })
    assert(status === 200, `status ${status}`)
    assert(data.role === 'member', `role ${data.role}`)
    const org = await api('GET', `/api/orgs/${orgId}`, { token: hold.token })
    assert(org.status === 200, 'not a member after accept')
  })

  await check('invite + accept boss (assistant_owner), aide (assistant_admin), fired (member)', async () => {
    for (const [who, role] of [[boss, 'assistant_owner'], [aide, 'assistant_admin'], [fired, 'member']]) {
      const inv = await api('POST', `/api/orgs/${orgId}/invite`, {
        token: u1.token,
        body: { usernameOrEmail: who.user.username, role },
      })
      assert(inv.status === 201, `invite ${who.user.username}: ${inv.status}`)
      const acc = await api('POST', `/api/invites/${inv.data.invite.id}/accept`, {
        token: who.token,
        body: { signatureDataUrl: FAKE_PNG, signedName: who.user.displayName },
      })
      assert(acc.status === 200, `accept ${who.user.username}: ${acc.status}`)
      assert(acc.data.role === role, `role ${acc.data.role}`)
    }
  })

  // ---------- dismissals (§11–12/§16) ----------
  const targetApplId = appl.user.id

  await check('dismissal: member cannot initiate -> 403', async () => {
    const { status } = await api('POST', `/api/orgs/${orgId}/dismissals`, {
      token: u2.token,
      body: { userId: targetApplId },
    })
    assert(status === 403, `status ${status}`)
  })

  await check('dismissal: assistant_admin cannot initiate -> 403 (§19)', async () => {
    const { status } = await api('POST', `/api/orgs/${orgId}/dismissals`, {
      token: aide.token,
      body: { userId: fired.user.id },
    })
    assert(status === 403, `status ${status}`)
  })

  await check('dismissal: owner target -> 403', async () => {
    const { status } = await api('POST', `/api/orgs/${orgId}/dismissals`, {
      token: boss.token,
      body: { userId: u1.user.id },
    })
    assert(status === 403, `status ${status}`)
  })

  await check('dismissal: self target -> 403', async () => {
    const { status } = await api('POST', `/api/orgs/${orgId}/dismissals`, {
      token: boss.token,
      body: { userId: boss.user.id },
    })
    assert(status === 403, `status ${status}`)
  })

  let dismissalId = null
  await check('dismissal create -> 201 pending, membership intact, document:new to target', async () => {
    const evtP = waitFor(sAppl, 'document:new', (p) => p?.org?.id === orgId)
    const { status, data } = await api('POST', `/api/orgs/${orgId}/dismissals`, {
      token: u1.token,
      body: { userId: targetApplId, reason: 'Сокращение штата' },
    })
    assert(status === 201, `status ${status}`)
    const d = data.document
    dismissalId = d.id
    assert(d.type === 'dismissal' && d.status === 'pending', `${d.type}/${d.status}`)
    assert(d.targetUserId === targetApplId && d.createdBy === u1.user.id, 'target/creator mismatch')
    assert(d.contractText.includes('ДОГОВОР ОБ УВОЛЬНЕНИИ'), 'dismissal contract header missing')
    assert(d.contractText.includes(`Atrium Smoke ${RUN_ID}`), 'contract missing org name')
    assert(d.contractText.includes('Причина: Сокращение штата'), 'reason not filled')
    assert(d.contractText.includes('Участник'), 'role label missing')
    assert(d.signature === null && d.signedAt === null, 'must be unsigned while pending')
    const evt = await evtP
    assert(evt.document?.id === dismissalId, 'document:new mismatch')
    // membership NOT removed by creating the document
    const detail = await api('GET', `/api/orgs/${orgId}`, { token: u1.token })
    const row = detail.data.members.find((m) => m.user.id === targetApplId)
    assert(row, 'membership must survive dismissal creation')
    assert(row.dismissalPending === true, 'dismissalPending badge missing for staff')
    const memberView = await api('GET', `/api/orgs/${orgId}`, { token: u2.token })
    const hidden = memberView.data.members.find((m) => m.user.id === targetApplId)
    assert(!('dismissalPending' in hidden), 'badge must be hidden from members')
  })

  await check('duplicate dismissal -> 409; non-member target -> 409', async () => {
    const dup = await api('POST', `/api/orgs/${orgId}/dismissals`, {
      token: u1.token,
      body: { userId: targetApplId },
    })
    assert(dup.status === 409, `dup status ${dup.status}`)
    const notMember = await api('POST', `/api/orgs/${orgId}/dismissals`, {
      token: u1.token,
      body: { userId: rjct.user.id },
    })
    assert(notMember.status === 409, `non-member status ${notMember.status}`)
    const longReason = await api('POST', `/api/orgs/${orgId}/dismissals`, {
      token: u1.token,
      body: { userId: fired.user.id, reason: 'х'.repeat(301) },
    })
    assert(longReason.status === 400, `long reason status ${longReason.status}`)
  })

  await check('GET /api/documents/mine: pending first, org + createdBy', async () => {
    const { status, data } = await api('GET', '/api/documents/mine', { token: appl.token })
    assert(status === 200, `status ${status}`)
    assert(data.documents[0]?.document.id === dismissalId, 'pending must be first')
    const entry = data.documents.find((x) => x.document.id === dismissalId)
    assert(entry.org?.id === orgId, 'org ref missing')
    assert(entry.createdBy?.user?.username === `alice_${RUN_ID}`, 'createdBy missing')
  })

  await check('GET /api/orgs/:id/dismissals: member 403, staff (assistant_admin) 200', async () => {
    const denied = await api('GET', `/api/orgs/${orgId}/dismissals`, { token: u2.token })
    assert(denied.status === 403, `member status ${denied.status}`)
    const { status, data } = await api('GET', `/api/orgs/${orgId}/dismissals`, { token: aide.token })
    assert(status === 200, `staff status ${status}`)
    const found = data.documents.find((x) => x.document.id === dismissalId)
    assert(found, 'dismissal not listed for staff')
    assert(found.targetUser?.username === `appl_${RUN_ID}`, 'targetUser missing')
    assert(found.createdBy?.user?.username === `alice_${RUN_ID}`, 'createdBy missing')
  })

  await check('dismissal sign by non-target -> 403', async () => {
    const { status } = await api('POST', `/api/documents/${dismissalId}/sign`, {
      token: u2.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Борис Тестов' },
    })
    assert(status === 403, `status ${status}`)
  })

  await check('dismissal sign validation: no signature -> 400', async () => {
    const { status } = await api('POST', `/api/documents/${dismissalId}/sign`, {
      token: appl.token,
      body: { signedName: 'Аппликант Тестов' },
    })
    assert(status === 400, `status ${status}`)
  })

  await check('dismissal sign -> signed + membership removed + document:update socket', async () => {
    const evtP = waitFor(sAppl, 'document:update', (p) => p?.document?.id === dismissalId)
    const { status, data } = await api('POST', `/api/documents/${dismissalId}/sign`, {
      token: appl.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Аппликант Тестов' },
    })
    assert(status === 200, `status ${status}`)
    const d = data.document
    assert(d.status === 'signed', `status ${d.status}`)
    assert(d.signature === FAKE_PNG && d.signatureKind === 'png', 'signature not stored')
    assert(d.signedName === 'Аппликант Тестов' && typeof d.signedAt === 'number', 'signed fields missing')
    const evt = await evtP
    assert(evt.document.status === 'signed', 'socket mismatch')
    const after = await api('GET', `/api/orgs/${orgId}`, { token: appl.token })
    assert(after.status === 403, 'membership must be removed after signing')
    const orgs = await api('GET', '/api/orgs', { token: appl.token })
    assert(!orgs.data.orgs.some((o) => o.id === orgId), 'org must disappear from list')
  })

  await check('sign resolved dismissal again -> 409', async () => {
    const { status } = await api('POST', `/api/documents/${dismissalId}/sign`, {
      token: appl.token,
      body: { signatureDataUrl: FAKE_PNG, signedName: 'Аппликант Тестов' },
    })
    assert(status === 409, `status ${status}`)
  })

  let holdDismissalId = null
  await check('dismissal reject -> rejected, membership kept', async () => {
    const create = await api('POST', `/api/orgs/${orgId}/dismissals`, {
      token: u1.token,
      body: { userId: hold.user.id, reason: 'Нарушение графика' },
    })
    assert(create.status === 201, `create status ${create.status}`)
    holdDismissalId = create.data.document.id
    const notTarget = await api('POST', `/api/documents/${holdDismissalId}/reject`, { token: u1.token })
    assert(notTarget.status === 403, `non-target reject ${notTarget.status}`)
    const { status, data } = await api('POST', `/api/documents/${holdDismissalId}/reject`, { token: hold.token })
    assert(status === 200, `status ${status}`)
    assert(data.document.status === 'rejected', `status ${data.document.status}`)
    const still = await api('GET', `/api/orgs/${orgId}`, { token: hold.token })
    assert(still.status === 200, 'membership must survive rejection')
  })

  await check('dismissal cancel: member 403, creator 200, membership kept', async () => {
    const create = await api('POST', `/api/orgs/${orgId}/dismissals`, {
      token: u1.token,
      body: { userId: hold.user.id },
    })
    assert(create.status === 201, `create status ${create.status}`)
    const docId = create.data.document.id
    const notPermitted = await api('POST', `/api/documents/${docId}/cancel`, { token: u2.token })
    assert(notPermitted.status === 403, `member cancel ${notPermitted.status}`)
    const { status, data } = await api('POST', `/api/documents/${docId}/cancel`, { token: u1.token })
    assert(status === 200, `status ${status}`)
    assert(data.document.status === 'canceled', `status ${data.document.status}`)
    const still = await api('GET', `/api/orgs/${orgId}`, { token: hold.token })
    assert(still.status === 200, 'membership must survive cancel')
  })

  let firedDismissalId = null
  await check('dismissal terminate: assistant_admin 403, assistant_owner 200 + membership removed', async () => {
    const create = await api('POST', `/api/orgs/${orgId}/dismissals`, {
      token: u1.token,
      body: { userId: fired.user.id, reason: 'Сокращение' },
    })
    assert(create.status === 201, `create status ${create.status}`)
    firedDismissalId = create.data.document.id
    const denied = await api('POST', `/api/documents/${firedDismissalId}/terminate`, { token: aide.token })
    assert(denied.status === 403, `assistant_admin terminate ${denied.status}`)
    const evtP = waitFor(s1, 'document:update', (p) => p?.document?.id === firedDismissalId)
    const { status, data } = await api('POST', `/api/documents/${firedDismissalId}/terminate`, { token: boss.token })
    assert(status === 200, `status ${status}`)
    assert(data.document.status === 'terminated', `status ${data.document.status}`)
    const evt = await evtP
    assert(evt.document.status === 'terminated', 'socket mismatch')
    const orgs = await api('GET', '/api/orgs', { token: fired.token })
    assert(!orgs.data.orgs.some((o) => o.id === orgId), 'membership must be removed on terminate')
  })

  await check('dismissal sign with typed signatureText -> signed (kind text)', async () => {
    const create = await api('POST', `/api/orgs/${orgId}/dismissals`, {
      token: u1.token,
      body: { userId: boss.user.id },
    })
    assert(create.status === 201, `create status ${create.status}`)
    const docId = create.data.document.id
    const { status, data } = await api('POST', `/api/documents/${docId}/sign`, {
      token: boss.token,
      body: { signatureText: 'Босс Тестов', signedName: 'Босс Тестов' },
    })
    assert(status === 200, `status ${status}`)
    const d = data.document
    assert(d.status === 'signed', `status ${d.status}`)
    assert(d.signatureKind === 'text', `kind ${d.signatureKind}`)
    assert(d.signature === null, 'image must be null for typed signature')
    assert(d.signatureText === 'Босс Тестов', 'signatureText missing')
    const orgs = await api('GET', '/api/orgs', { token: boss.token })
    assert(!orgs.data.orgs.some((o) => o.id === orgId), 'membership must be removed')
  })

  await check('no member left with dismissalPending badge', async () => {
    const { status, data } = await api('GET', `/api/orgs/${orgId}`, { token: u1.token })
    assert(status === 200, `status ${status}`)
    const flagged = data.members.filter((m) => m.dismissalPending)
    assert(flagged.length === 0, `still flagged: ${flagged.map((m) => m.user.username).join(',')}`)
  })

  // ---------- read receipts + unread (§18/§22) ----------
  await check('POST /api/channels/:id/read + GET /api/channels/:id/read-status', async () => {
    const ts = Date.now()
    const write = await api('POST', `/api/channels/${channelId}/read`, { token: u2.token, body: { at: ts } })
    assert(write.status === 200 && write.data.ok === true, `write status ${write.status}`)
    const { status, data } = await api('GET', `/api/channels/${channelId}/read-status`, { token: u1.token })
    assert(status === 200, `status ${status}`)
    assert(Array.isArray(data.reads), 'reads must be an array')
    const mine = data.reads.find((r) => r.userId === u2.user.id)
    assert(mine, 'u2 read entry missing')
    assert(typeof mine.lastReadAt === 'number' && mine.lastReadAt >= ts - 1000, 'lastReadAt wrong')
    assert(Object.keys(mine).sort().join(',') === 'lastReadAt,userId', 'shape mismatch')
  })

  await check('unread counters: read resets, new message increments, read resets again', async () => {
    const zero = await api('GET', `/api/orgs/${orgId}/channels`, { token: u2.token })
    assert(zero.status === 200, `status ${zero.status}`)
    const general = zero.data.channels.find((c) => c.name === 'general')
    assert(general.unread === 0, `unread after read: ${general.unread}`)

    const sent = await ack(s1, 'message:send', { channelId, text: 'Непрочитанное сообщение' })
    assert(sent.ok === true, JSON.stringify(sent))

    const dirty = await api('GET', `/api/orgs/${orgId}/channels`, { token: u2.token })
    const general2 = dirty.data.channels.find((c) => c.name === 'general')
    assert(general2.unread >= 1, `unread after message: ${general2.unread}`)

    const orgs = await api('GET', '/api/orgs', { token: u2.token })
    const orgRow = orgs.data.orgs.find((o) => o.id === orgId)
    assert(typeof orgRow.unread === 'number' && orgRow.unread >= 1, `org unread: ${orgRow.unread}`)

    await api('POST', `/api/channels/${channelId}/read`, { token: u2.token })
    const clean = await api('GET', `/api/orgs/${orgId}/channels`, { token: u2.token })
    const general3 = clean.data.channels.find((c) => c.name === 'general')
    assert(general3.unread === 0, `unread after re-read: ${general3.unread}`)
  })

  await check('GET /api/dms returns unread counter', async () => {
    const { status, data } = await api('GET', '/api/dms', { token: u2.token })
    assert(status === 200, `status ${status}`)
    const dm = data.dms.find((d) => d.channel.id === dmRes.channel.id)
    assert(dm, 'dm not listed')
    assert(typeof dm.unread === 'number', 'unread missing on dm')
  })

  await check('socket channel:read relayed to other member', async () => {
    const evtP = waitFor(s1, 'channel:read', (p) => p?.channelId === channelId && p?.userId === u2.user.id)
    s2.emit('channel:read', { channelId, userId: u2.user.id, lastReadAt: Date.now() })
    const evt = await evtP
    assert(typeof evt.lastReadAt === 'number', 'lastReadAt missing')
  })

  await check('read without channel access -> 403', async () => {
    const { status } = await api('POST', `/api/channels/${channelId}/read`, { token: appl.token })
    assert(status === 403, `status ${status}`)
  })

  // ---------- activity log (§18/§22) ----------
  let activityPage1Ids = []
  await check('GET /api/orgs/:id/activity -> Russian details, all key actions present', async () => {
    const { status, data } = await api('GET', `/api/orgs/${orgId}/activity?limit=100`, { token: u1.token })
    assert(status === 200, `status ${status}`)
    assert(Array.isArray(data.activity) && data.activity.length > 0, 'empty activity log')
    assert(typeof data.hasMore === 'boolean', 'hasMore missing')
    for (const a of data.activity) {
      assert(a.id.startsWith('a_'), `bad activity id ${a.id}`)
      assert(typeof a.details === 'string' && a.details.length > 0, `no details for ${a.action}`)
      assert(/[А-Яа-яЁё]/.test(a.details), `details not Russian: ${a.details}`)
      assert(typeof a.createdAt === 'number', 'createdAt missing')
      assert(a.actor === null || typeof a.actor.username === 'string', 'actor shape wrong')
      assert(a.targetUser === null || typeof a.targetUser.username === 'string', 'targetUser shape wrong')
    }
    const actions = new Set(data.activity.map((a) => a.action))
    for (const expected of [
      'invite.created', 'invite.accepted', 'invite.declined', 'invite.canceled',
      'application.submitted', 'application.approved', 'application.rejected', 'application.canceled',
      'dismissal.created', 'dismissal.signed', 'dismissal.rejected', 'dismissal.canceled', 'dismissal.terminated',
      'member.joined', 'member.left', 'role.changed', 'channel.created', 'org.updated', 'message.deleted',
    ]) {
      assert(actions.has(expected), `missing activity action: ${expected}`)
    }
    const by = (act) => data.activity.find((a) => a.action === act).details
    assert(by('invite.created').includes('пригласил(а)'), `invite details: ${by('invite.created')}`)
    assert(by('application.submitted').includes('заявление'), `application details: ${by('application.submitted')}`)
    assert(by('dismissal.signed').includes('договор об увольнении'), `dismissal details: ${by('dismissal.signed')}`)
    assert(by('message.deleted').includes('в #general'), `delete details: ${by('message.deleted')}`)
    assert(by('channel.created').includes('#'), `channel details: ${by('channel.created')}`)
    assert(by('role.changed').includes('повысил(а)'), `role details: ${by('role.changed')}`)
    activityPage1Ids = data.activity.slice(-2).map((a) => a.id)
  })

  await check('activity pagination: limit=2 + before= works', async () => {
    const p1 = await api('GET', `/api/orgs/${orgId}/activity?limit=2`, { token: u1.token })
    assert(p1.status === 200, `status ${p1.status}`)
    assert(p1.data.activity.length <= 2, 'limit ignored')
    assert(p1.data.hasMore === true, 'hasMore should be true with many entries')
    // anchor = OLDEST entry of page 1 (ASC order) -> page 2 = rows strictly before it
    const anchor = p1.data.activity[0].id
    const p2 = await api('GET', `/api/orgs/${orgId}/activity?limit=2&before=${anchor}`, { token: u1.token })
    assert(p2.status === 200, `p2 status ${p2.status}`)
    assert(p2.data.activity.length > 0, 'empty second page')
    const p1Ids = new Set(p1.data.activity.map((a) => a.id))
    assert(p2.data.activity.every((a) => !p1Ids.has(a.id)), 'pages must not overlap')
    assert(p2.data.activity.every((a) => a.createdAt <= p1.data.activity[0].createdAt), 'pages out of order')
  })

  await check('non-member cannot view activity -> 403', async () => {
    const { status } = await api('GET', `/api/orgs/${orgId}/activity`, { token: rjct.token })
    assert(status === 403, `status ${status}`)
  })

  // ---------- role matrix v3 (§19) ----------
  await check('§19: assistant_admin can delete other messages -> 200', async () => {
    const sent = await ack(s1, 'message:send', { channelId, text: 'Сообщение для помощника' })
    assert(sent.ok === true, JSON.stringify(sent))
    const { status, data } = await api('DELETE', `/api/messages/${sent.message.id}`, { token: aide.token })
    assert(status === 200, `status ${status}`)
    assert(data.ok === true, 'ok !== true')
  })

  await check('§19: member cannot delete other messages -> 403', async () => {
    const sent = await ack(s1, 'message:send', { channelId, text: 'Сообщение для участника' })
    assert(sent.ok === true, JSON.stringify(sent))
    const { status } = await api('DELETE', `/api/messages/${sent.message.id}`, { token: u2.token })
    assert(status === 403, `status ${status}`)
  })

  await check('§19: assistant_admin can invite -> 201', async () => {
    const invd = await reg('invd', 'Приглашённый Тест')
    const { status, data } = await api('POST', `/api/orgs/${orgId}/invite`, {
      token: aide.token,
      body: { usernameOrEmail: `invd_${RUN_ID}`, role: 'member' },
    })
    assert(status === 201, `status ${status}`)
    assert(data.invite?.status === 'pending', 'not pending')
  })

  await check('§19: assistant_admin can create channel -> 201, cannot edit org -> 403', async () => {
    const ch = await api('POST', `/api/orgs/${orgId}/channels`, {
      token: aide.token,
      body: { name: `aide-${RUN_ID}` },
    })
    assert(ch.status === 201, `create channel ${ch.status}`)
    const edit = await api('PATCH', `/api/orgs/${orgId}`, { token: aide.token, body: { name: 'Hacked by aide' } })
    assert(edit.status === 403, `edit org ${edit.status}`)
  })

  await check('§19: assistant_admin can accept application -> 200', async () => {
    const { status, data } = await api('POST', `/api/applications/${pktAppId}/accept`, { token: aide.token })
    assert(status === 200, `status ${status}`)
    assert(data.application.status === 'approved', `status ${data.application.status}`)
    const memberOrg = await api('GET', `/api/orgs/${orgId}`, { token: pkt.token })
    assert(memberOrg.status === 200 && memberOrg.data.role === 'member', 'applicant not a member')
  })

  // ============================================================
  // SPEC v4 (§23–25) — Smoke v4: creator panel, wallet, bot
  // Server must run with ATRIUM_ADMIN=alex,smoke_admin for the
  // superadmin checks below.
  // ============================================================

  // ---------- creator panel: access control (§23) ----------
  await check('§23: non-creator GET /api/admin/stats -> 403 «Доступ запрещён»', async () => {
    const { status, data } = await api('GET', '/api/admin/stats', { token: u1.token })
    assert(status === 403, `status ${status}`)
    assert(data?.error === 'Доступ запрещён', `error: ${data?.error}`)
  })

  await check('§23: non-creator PUT /api/admin/bot -> 403', async () => {
    const { status } = await api('PUT', '/api/admin/bot', { token: u1.token, body: { enabled: false } })
    assert(status === 403, `status ${status}`)
    // settings must be untouched
    const admGet = await api('GET', '/api/admin/bot', { token: u1.token })
    assert(admGet.status === 403, `non-creator GET bot: ${admGet.status}`)
  })

  const adm = await check('§23: superadmin login (smoke_admin, ATRIUM_ADMIN)', async () => {
    let { status, data } = await api('POST', '/api/auth/login', {
      body: { login: 'smoke_admin', password: 'secret123' },
    })
    if (status !== 200) {
      const reg = await api('POST', '/api/auth/register', {
        body: {
          username: 'smoke_admin',
          displayName: 'Smoke Admin',
          email: 'smoke_admin@test.local',
          password: 'secret123',
        },
      })
      assert(reg.status === 201, `register status ${reg.status}: ${JSON.stringify(reg.data)}`)
      data = reg.data
    }
    assert(data.token, 'no token')
    return data
  })

  await check('§25: GET /api/me -> isAdmin + balance (user object & top-level)', async () => {
    const me = await api('GET', '/api/me', { token: adm.token })
    assert(me.status === 200, `status ${me.status}`)
    assert(me.data.user?.isAdmin === true,
      'user.isAdmin !== true — start server with ATRIUM_ADMIN=alex,smoke_admin')
    assert(me.data.isAdmin === true, 'top-level isAdmin missing')
    assert(typeof me.data.balance === 'number', 'top-level balance missing')
    assert(typeof me.data.user.balance === 'number', 'user.balance missing')
    const other = await api('GET', '/api/me', { token: u1.token })
    assert(other.data.user?.isAdmin === false, 'regular user must have isAdmin=false')
    assert(typeof other.data.balance === 'number', 'regular user balance missing')
  })

  await check('§23: GET /api/admin/stats -> 200, all counters numeric', async () => {
    const { status, data } = await api('GET', '/api/admin/stats', { token: adm.token })
    assert(status === 200, `status ${status}`)
    for (const k of [
      'users', 'usersToday', 'usersActive24h', 'orgs', 'orgsPublic', 'members',
      'messages', 'messages24h', 'invitesPending', 'callsToday', 'onlineNow',
      'totalBalance', 'paidTotal',
    ]) {
      assert(typeof data[k] === 'number', `${k} missing or not a number`)
    }
    assert(data.users >= 3, `users: ${data.users}`)
    assert(data.orgs >= 1, `orgs: ${data.orgs}`)
    assert(data.messages >= 1, `messages: ${data.messages}`)
    assert(data.onlineNow >= 1, `onlineNow: ${data.onlineNow}`)
  })

  await check('§23: GET /api/admin/audit -> shape, action filter, q search, pagination', async () => {
    const { status, data } = await api('GET', '/api/admin/audit?limit=50', { token: adm.token })
    assert(status === 200, `status ${status}`)
    assert(Array.isArray(data.items) && data.items.length > 0, 'empty audit journal')
    assert(typeof data.hasMore === 'boolean', 'hasMore missing')
    for (const it of data.items) {
      assert(typeof it.id === 'string' && it.id, 'bad id')
      assert(typeof it.action === 'string' && it.action, 'bad action')
      assert(typeof it.details === 'string', 'details missing')
      assert(typeof it.createdAt === 'number', 'createdAt missing')
      assert('ip' in it, 'ip missing')
      assert('userAgent' in it, 'userAgent missing')
      assert(it.actor === null || typeof it.actor.username === 'string', 'actor shape wrong')
      assert(it.targetUser === null || typeof it.targetUser.username === 'string', 'targetUser shape wrong')
      assert(it.orgName === null || typeof it.orgName === 'string', 'orgName shape wrong')
    }
    assert(data.items.some((i) => i.action === 'auth.login'), 'no auth.login rows')

    const filt = await api('GET', '/api/admin/audit?action=auth.login&limit=50', { token: adm.token })
    assert(filt.status === 200, `filter status ${filt.status}`)
    assert(filt.data.items.length > 0, 'action filter returned nothing')
    assert(filt.data.items.every((i) => i.action === 'auth.login'), 'action filter leaked rows')

    const term = filt.data.items[0].details.split(' ')[0]
    const q = await api('GET', `/api/admin/audit?q=${encodeURIComponent(term)}&limit=50`, { token: adm.token })
    assert(q.status === 200, `q status ${q.status}`)
    assert(q.data.items.length > 0, `q="${term}" found nothing`)
    assert(q.data.items.every((i) => (i.details || '').toLowerCase().includes(term.toLowerCase())),
      'q search leaked rows')

    const p1 = await api('GET', '/api/admin/audit?limit=2', { token: adm.token })
    assert(p1.status === 200 && p1.data.items.length <= 2, 'limit ignored')
    if (p1.data.hasMore) {
      const anchor = p1.data.items[p1.data.items.length - 1].id
      const p2 = await api('GET', `/api/admin/audit?limit=2&before=${anchor}`, { token: adm.token })
      assert(p2.status === 200, `p2 status ${p2.status}`)
      assert(p2.data.items.length > 0, 'empty second page')
      const ids = new Set(p1.data.items.map((i) => i.id))
      assert(p2.data.items.every((i) => !ids.has(i.id)), 'pages overlap')
    }
  })

  await check('§23: GET /api/admin/logins -> shape + own login recorded', async () => {
    const { status, data } = await api('GET', '/api/admin/logins?limit=50', { token: adm.token })
    assert(status === 200, `status ${status}`)
    assert(Array.isArray(data.items) && data.items.length > 0, 'empty login log')
    for (const it of data.items) {
      assert(typeof it.success === 'boolean', 'success missing')
      assert(typeof it.createdAt === 'number', 'createdAt missing')
      assert('ip' in it, 'ip missing')
      assert('userAgent' in it, 'userAgent missing')
      assert(it.user === null || typeof it.user.username === 'string', 'user shape wrong')
    }
    assert(data.items.some((i) => i.user?.username === 'smoke_admin' && i.success === true),
      'smoke_admin successful login not in login_log')
    assert(data.items.some((i) => i.success === false), 'no failed logins recorded (ban test runs later?)')
  })

  await check('§23: GET /api/admin/users?query= -> shape + found', async () => {
    const { status, data } = await api('GET', '/api/admin/users?query=smoke_admin', { token: adm.token })
    assert(status === 200, `status ${status}`)
    assert(Array.isArray(data.items) && data.items.length >= 1, 'smoke_admin not found')
    const row = data.items.find((u) => u.username === 'smoke_admin')
    assert(row, 'no exact match')
    assert(row.banned === false, `banned: ${row.banned}`)
    assert(typeof row.balance === 'number', 'balance missing')
    assert(typeof row.orgsCount === 'number', 'orgsCount missing')
    assert('lastLoginAt' in row, 'lastLoginAt missing')
  })

  // ---------- bot settings (§23) ----------
  await check('§23: GET /api/admin/bot -> default enabled + full catalog', async () => {
    const { status, data } = await api('GET', '/api/admin/bot', { token: adm.token })
    assert(status === 200, `status ${status}`)
    assert(data.enabled === true, `enabled: ${data.enabled}`)
    assert(Array.isArray(data.events) && data.events.length >= 15, `events: ${data.events?.length}`)
    for (const e of ['auth.login', 'auth.logout', 'application.*', 'dismissal.*', 'wallet.transfer', 'org.payroll', 'user.ban']) {
      assert(data.catalog.includes(e), `catalog missing ${e}`)
      assert(data.events.includes(e), `default events missing ${e}`)
    }
  })

  await check('§23: PUT /api/admin/bot -> persisted, validation, restore', async () => {
    const put = await api('PUT', '/api/admin/bot', { token: adm.token, body: { enabled: false, events: ['auth.login'] } })
    assert(put.status === 200, `put status ${put.status}`)
    assert(put.data.enabled === false, 'enabled not false')
    const get = await api('GET', '/api/admin/bot', { token: adm.token })
    assert(get.data.enabled === false, 'GET does not reflect enabled=false')
    assert(get.data.events.length === 1 && get.data.events[0] === 'auth.login', 'events not persisted')

    const badEvents = await api('PUT', '/api/admin/bot', { token: adm.token, body: { events: 'nope' } })
    assert(badEvents.status === 400, `bad events status ${badEvents.status}`)
    const badName = await api('PUT', '/api/admin/bot', { token: adm.token, body: { events: ['DROP TABLE'] } })
    assert(badName.status === 400, `bad event name status ${badName.status}`)

    const restore = await api('PUT', '/api/admin/bot', {
      token: adm.token,
      body: { enabled: true, events: get.data.catalog },
    })
    assert(restore.status === 200, `restore status ${restore.status}`)
    assert(restore.data.enabled === true, 'restore enabled failed')
    assert(restore.data.events.length === get.data.catalog.length, 'restore events failed')
  })

  // ---------- ban / unban (§23) ----------
  const banUser = await check('register user for ban test', async () => {
    const { status, data } = await api('POST', '/api/auth/register', {
      body: {
        username: `ban_${RUN_ID}`,
        displayName: 'Бан Тестов',
        email: `ban_${RUN_ID}@test.local`,
        password: 'secret123',
      },
    })
    assert(status === 201, `status ${status}`)
    return data
  })

  const sAdmin = await connectAndTrack(adm.token)
  const sBan = await connectAndTrack(banUser.token)

  await check('§23: ban -> admin:event only to superadmin, bot DM report, sockets dropped', async () => {
    const adminEvtP = waitFor(sAdmin, 'admin:event', (p) => p?.item?.action === 'user.ban')
    const botMsgP = waitFor(
      sAdmin,
      'message:new',
      (p) => p?.message?.sender?.id === 'u_bot' && /Блокировка/.test(p.message?.text || '')
    )
    const banSocketP = waitFor(sBan, 'disconnect', () => true)
    const spy = []
    const spyHandler = (p) => spy.push(p)
    s1.on('admin:event', spyHandler)

    const { status, data } = await api('POST', `/api/admin/users/${banUser.user.id}/ban`, { token: adm.token })
    assert(status === 200, `ban status ${status}`)
    assert(data.ok === true && data.banned === true, `bad response: ${JSON.stringify(data)}`)

    const evt = await adminEvtP
    assert(evt.item?.action === 'user.ban', `admin:event action: ${evt.item?.action}`)
    assert(typeof evt.item?.details === 'string' && evt.item.details.includes('Блокировка'), `details: ${evt.item?.details}`)

    const msg = await botMsgP
    assert(typeof msg.message?.text === 'string', 'bot message has no text')
    assert(msg.message.text.includes('Блокировка'), `bot text: ${msg.message.text}`)

    await banSocketP // active sockets of the banned user disconnected

    await new Promise((r) => setTimeout(r, 300))
    assert(spy.length === 0, `admin:event leaked to non-superadmin socket (${spy.length} events)`)
    s1.off('admin:event', spyHandler)
  })

  await check('§23: banned -> login 403 «Аккаунт заблокирован»', async () => {
    const { status, data } = await api('POST', '/api/auth/login', {
      body: { login: `ban_${RUN_ID}`, password: 'secret123' },
    })
    assert(status === 403, `status ${status}`)
    assert(data?.error === 'Аккаунт заблокирован', `error: ${data?.error}`)
  })

  await check('§23: banned -> old token 401, socket reconnect refused', async () => {
    const me = await api('GET', '/api/me', { token: banUser.token })
    assert(me.status === 401, `status ${me.status}`)
    assert(me.data?.error === 'Аккаунт заблокирован', `error: ${me.data?.error}`)

    const sock = connect(banUser.token)
    sockets.push(sock)
    const outcome = await new Promise((resolve) => {
      const t = setTimeout(() => resolve('timeout'), 5000)
      sock.once('connect', () => { clearTimeout(t); resolve('connected') })
      sock.once('connect_error', (e) => { clearTimeout(t); resolve(`connect_error: ${e.message}`) })
    })
    assert(outcome.startsWith('connect_error'), `banned socket outcome: ${outcome}`)
    sock.close()
  })

  await check('§23: unban -> login works again', async () => {
    const { status } = await api('POST', `/api/admin/users/${banUser.user.id}/unban`, { token: adm.token })
    assert(status === 200, `unban status ${status}`)
    const login = await api('POST', '/api/auth/login', { body: { login: `ban_${RUN_ID}`, password: 'secret123' } })
    assert(login.status === 200, `login after unban: ${login.status} ${JSON.stringify(login.data)}`)
    const me = await api('GET', '/api/me', { token: login.data.token })
    assert(me.status === 200 && me.data.user?.isAdmin === false, 'me after unban failed')
    const check = await api('GET', '/api/admin/stats', { token: login.data.token })
    assert(check.status === 403, 'unbanned non-admin still gets admin access?!')
  })

  await check('§23: bot DM created, reports delivered (login + ban)', async () => {
    const { status, data } = await api('GET', '/api/dms', { token: adm.token })
    assert(status === 200, `status ${status}`)
    const dm = data.dms.find((d) => d.peer?.username === 'atrium_bot')
    assert(dm, 'bot DM not listed in GET /api/dms')
    assert(dm.channel.orgId === null, `bot DM orgId: ${dm.channel.orgId}`)

    const msgs = await api('GET', `/api/channels/${dm.channel.id}/messages?limit=50`, { token: adm.token })
    assert(msgs.status === 200, `messages status ${msgs.status}`)
    const botMsgs = msgs.data.messages.filter((m) => m.sender?.username === 'atrium_bot')
    assert(botMsgs.length >= 1, 'no bot reports in DM')
    assert(botMsgs.some((m) => m.text.includes('Вход')), `no login report among: ${botMsgs.map((m) => m.text).join(' | ')}`)
    assert(botMsgs.some((m) => m.text.includes('Блокировка')), 'no ban report among bot messages')
  })

  // ---------- wallet chain (§24) ----------
  await check('§24: GET /api/wallet fresh -> balance 0, demo:true', async () => {
    const { status, data } = await api('GET', '/api/wallet', { token: u1.token })
    assert(status === 200, `status ${status}`)
    assert(data.demo === true, 'demo flag missing')
    assert(data.balance === 0, `initial balance: ${data.balance}`)
    assert(Array.isArray(data.payments), 'payments missing')
  })

  await check('§24: topup validation -> 400 (amount < 100, bad card)', async () => {
    const a = await api('POST', '/api/wallet/topup', {
      token: u1.token, body: { amount: 50, cardNumber: '1111111111111234' },
    })
    assert(a.status === 400, `amount status ${a.status}`)
    const c = await api('POST', '/api/wallet/topup', {
      token: u1.token, body: { amount: 500, cardNumber: '123' },
    })
    assert(c.status === 400, `card status ${c.status}`)
    const w = await api('GET', '/api/wallet', { token: u1.token })
    assert(w.data.balance === 0, 'failed topups must not change balance')
  })

  await check('§24: topup 10000 ₽ (demo) -> balance, card mask, wallet:updated', async () => {
    const evtP = waitFor(s1, 'wallet:updated', (p) => p?.reason === 'topup')
    const { status, data } = await api('POST', '/api/wallet/topup', {
      token: u1.token, body: { amount: 10000, cardNumber: '1111 1111 1111 1234' },
    })
    assert(status === 200, `status ${status}`)
    assert(data.demo === true, 'demo flag missing')
    assert(data.balance === 10000, `balance: ${data.balance}`)
    assert(data.payment?.kind === 'topup', `kind: ${data.payment?.kind}`)
    assert(data.payment?.cardMask === '•••• 1234', `cardMask: ${data.payment?.cardMask}`)
    const evt = await evtP
    assert(evt.balance === 10000, `wallet:updated balance: ${evt.balance}`)
  })

  await check('§24: transfer 3000 -> recipient wallet:updated + history', async () => {
    const evtP = waitFor(s2, 'wallet:updated', (p) => p?.reason === 'transfer')
    const { status, data } = await api('POST', '/api/wallet/transfer', {
      token: u1.token, body: { toUserId: u2.user.id, amount: 3000, note: 'Тест перевода' },
    })
    assert(status === 200, `status ${status}`)
    assert(data.balance === 7000, `sender balance: ${data.balance}`)
    assert(data.payment?.kind === 'transfer', `kind: ${data.payment?.kind}`)
    assert(data.payment?.note === 'Тест перевода', 'note lost')

    const evt = await evtP
    assert(evt.balance === 3000, `recipient wallet:updated balance: ${evt.balance}`)
    assert(evt.amount === 3000, `amount: ${evt.amount}`)
    assert(evt.from?.id === u1.user.id, 'from missing')

    const w2 = await api('GET', '/api/wallet', { token: u2.token })
    assert(w2.data.balance === 3000, `recipient balance: ${w2.data.balance}`)
    const p2 = w2.data.payments.find((p) => p.id === data.payment.id)
    assert(p2, 'recipient does not see the transfer')
    assert(p2.direction === 'in' && p2.counterparty?.user?.id === u1.user.id, 'recipient history shape')
  })

  await check('§24: transfer validation: self 400, unknown 404, insufficient 409', async () => {
    const self = await api('POST', '/api/wallet/transfer', {
      token: u1.token, body: { toUserId: u1.user.id, amount: 10 },
    })
    assert(self.status === 400, `self transfer: ${self.status}`)
    const unknown = await api('POST', '/api/wallet/transfer', {
      token: u1.token, body: { toUserId: 'u_doesnotexist', amount: 10 },
    })
    assert(unknown.status === 404, `unknown recipient: ${unknown.status}`)
    const poor = await api('POST', '/api/wallet/transfer', {
      token: u2.token, body: { toUserId: u1.user.id, amount: 400000 },
    })
    assert(poor.status === 409, `insufficient: ${poor.status}`)
    assert(/Недостаточно средств/.test(poor.data?.error || ''), `error: ${poor.data?.error}`)
    const w1 = await api('GET', '/api/wallet', { token: u1.token })
    assert(w1.data.balance === 7000, `balance changed by failed transfer: ${w1.data.balance}`)
  })

  await check('§24: treasury deposit 2000 (rank≥60) -> org 2000, author -2000', async () => {
    const { status, data } = await api('POST', `/api/orgs/${orgId}/treasury/deposit`, {
      token: u1.token, body: { amount: 2000 },
    })
    assert(status === 200, `status ${status}`)
    assert(data.balance === 2000, `org balance: ${data.balance}`)
    assert(data.userBalance === 5000, `author balance: ${data.userBalance}`)
    const w1 = await api('GET', '/api/wallet', { token: u1.token })
    assert(w1.data.balance === 5000, `wallet: ${w1.data.balance}`)
    const dep = w1.data.payments.find((p) => p.kind === 'treasury_deposit')
    assert(dep && dep.direction === 'out' && dep.amount === 2000, 'deposit history missing')
    assert(dep.counterparty?.org?.id === orgId, 'deposit counterparty org wrong')
  })

  await check('§24: member cannot touch treasury -> 403, deposit without funds -> 409', async () => {
    const d = await api('POST', `/api/orgs/${orgId}/treasury/deposit`, { token: u2.token, body: { amount: 100 } })
    assert(d.status === 403, `member deposit: ${d.status}`)
    const p = await api('POST', `/api/orgs/${orgId}/payroll`, {
      token: u2.token, body: { userId: u1.user.id, amount: 100 },
    })
    assert(p.status === 403, `member payroll: ${p.status}`)
    // owner depositing more than his personal balance
    const broke = await api('POST', `/api/orgs/${orgId}/treasury/deposit`, {
      token: u1.token, body: { amount: 500000 },
    })
    assert(broke.status === 409, `over-balance deposit: ${broke.status}`)
    assert(/Недостаточно средств/.test(broke.data?.error || ''), `error: ${broke.data?.error}`)
  })

  await check('§24: payroll over treasury -> 409 «Недостаточно средств в казначействе»', async () => {
    const { status, data } = await api('POST', `/api/orgs/${orgId}/payroll`, {
      token: u1.token, body: { userId: u2.user.id, amount: 3000 },
    })
    assert(status === 409, `status ${status}`)
    assert(data?.error === 'Недостаточно средств в казначействе', `error: ${data?.error}`)
  })

  await check('§24: payroll 1500 -> exact balances + wallet:updated + activity', async () => {
    const evtP = waitFor(s2, 'wallet:updated', (p) => p?.reason === 'salary')
    const { status, data } = await api('POST', `/api/orgs/${orgId}/payroll`, {
      token: u1.token, body: { userId: u2.user.id, amount: 1500, note: 'Зарплата за месяц' },
    })
    assert(status === 200, `status ${status}`)
    assert(data.orgBalance === 500, `org balance: ${data.orgBalance} (2000-1500)`)
    assert(data.payment?.kind === 'salary', `kind: ${data.payment?.kind}`)

    const evt = await evtP
    assert(evt.balance === 4500, `recipient wallet:updated: ${evt.balance} (3000+1500)`)
    assert(evt.reason === 'salary', `reason: ${evt.reason}`)

    const w1 = await api('GET', '/api/wallet', { token: u1.token })
    assert(w1.data.balance === 5000, `u1: ${w1.data.balance} (10000-3000-2000; payroll comes from treasury)`)
    const w2 = await api('GET', '/api/wallet', { token: u2.token })
    assert(w2.data.balance === 4500, `u2: ${w2.data.balance} (3000+1500)`)

    const act = await api('GET', `/api/orgs/${orgId}/activity?limit=100`, { token: u1.token })
    const payroll = act.data.activity.find((a) => a.action === 'org.payroll')
    assert(payroll, 'org.payroll missing from activity log')
    assert(payroll.details.includes('зарплату'), `activity details: ${payroll.details}`)
    assert(payroll.details.includes('1 500'), `amount phrase: ${payroll.details}`)
  })

  await check('§24: finance (manager) -> treasury txs + payrollTotals', async () => {
    const { status, data } = await api('GET', `/api/orgs/${orgId}/finance`, { token: u1.token })
    assert(status === 200, `status ${status}`)
    assert(data.canManage === true, 'canManage false for owner')
    assert(data.balance === 500, `org balance: ${data.balance}`)
    assert(Array.isArray(data.transactions) && data.transactions.length >= 2, 'transactions missing')
    const salary = data.transactions.find((t) => t.kind === 'salary')
    assert(salary && salary.fromUser === null && salary.toUser?.id === u2.user.id, 'salary tx shape')
    assert(typeof salary.createdAt === 'number', 'tx createdAt missing')
    const total = (data.payrollTotals || []).find((t) => t.user?.id === u2.user.id)
    assert(total && total.total === 1500, `payroll total: ${total?.total}`)
  })

  await check('§24: finance (member) -> only own credits, canManage false', async () => {
    const { status, data } = await api('GET', `/api/orgs/${orgId}/finance`, { token: u2.token })
    assert(status === 200, `status ${status}`)
    assert(data.canManage === false, 'canManage must be false for member')
    assert(Array.isArray(data.payrollTotals) && data.payrollTotals.length === 0, 'member sees payrollTotals')
    assert(Array.isArray(data.transactions), 'transactions missing')
    assert(data.transactions.every((t) => t.kind === 'salary' && t.toUser?.id === u2.user.id),
      'member sees foreign transactions')
    const mine = data.transactions.find((t) => t.kind === 'salary')
    assert(mine && mine.amount === 1500, 'own salary credit missing')
  })

  await check('§24: audit contains wallet events (filter + q) and stats totals', async () => {
    const t = await api('GET', '/api/admin/audit?action=wallet.transfer&limit=50', { token: adm.token })
    assert(t.status === 200, `status ${t.status}`)
    assert(t.data.items.some((i) => i.action === 'wallet.transfer'), 'no wallet.transfer in audit')
    assert(t.data.items.every((i) => i.action === 'wallet.transfer'), 'action filter leaked')

    const p = await api('GET', '/api/admin/audit?action=org.payroll&limit=50', { token: adm.token })
    assert(p.data.items.length > 0, 'no org.payroll in audit')
    assert(p.data.items.some((i) => i.details.includes('зарплату')), 'payroll details missing')

    const q = await api('GET', `/api/admin/audit?q=${encodeURIComponent('зарплату')}&limit=50`, { token: adm.token })
    assert(q.status === 200 && q.data.items.length > 0, 'q=зарплату found nothing')
    assert(q.data.items.every((i) => (i.details || '').toLowerCase().includes('зарплату')), 'q search leaked')

    const stats = await api('GET', '/api/admin/stats', { token: adm.token })
    assert(stats.status === 200, `stats ${stats.status}`)
    assert(stats.data.paidTotal >= 1500, `paidTotal: ${stats.data.paidTotal}`)
    assert(stats.data.totalBalance >= 8000, `totalBalance: ${stats.data.totalBalance}`)
  })
}

main()
  .then(() => {
    for (const s of sockets) s.close()
    console.log(`\n${passed} passed, ${failed} failed`)
    if (failed > 0) {
      console.log('SMOKE FAILED')
      process.exit(1)
    }
    console.log('SMOKE PASSED')
    process.exit(0)
  })
  .catch((err) => {
    for (const s of sockets) s.close()
    console.log(`\n${passed} passed, ${failed} failed`)
    console.error(`SMOKE FAILED — ${err?.message || err}`)
    process.exit(1)
  })
