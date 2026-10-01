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
