import { verifyToken } from './auth.js'
import {
  findUserById,
  findChannel,
  findMember,
  isChannelMember,
  channelMemberIds,
  touchChannelRead,
  run,
  get,
} from './db.js'
import { requireChannelAccess } from './access.js'
import { newId, publicUser, str } from './util.js'
import { HttpError } from './util.js'

// ---------- presence ----------
const socketsByUser = new Map() // userId -> Set<socketId>
const onlineUsers = new Set()
let mainIo = null // set in initSockets — used by admin ban (SPEC v4 §23)

/** Online users count for GET /api/admin/stats. */
export function onlineCount() {
  return onlineUsers.size
}

/** Disconnect every active socket of a user (ban, SPEC v4 §23). Returns sockets dropped. */
export function disconnectUserSockets(userId) {
  if (!mainIo) return 0
  const set = socketsByUser.get(userId)
  const count = set ? set.size : 0
  if (count) mainIo.in(`user:${userId}`).disconnectSockets(true)
  return count
}

// ---------- typing throttle: per socket+channel, >=1 per 2s ----------
const lastTypingAt = new Map() // `${socketId}:${channelId}` -> ts

// ---------- in-memory active calls (1:1 only) ----------
const calls = new Map() // callId -> call
const callByUser = new Map() // userId -> callId

function registerSocket(socket, user) {
  const set = socketsByUser.get(user.id) || new Set()
  set.add(socket.id)
  socketsByUser.set(user.id, set)
}

function unregisterSocket(socket, userId) {
  const set = socketsByUser.get(userId)
  if (!set) return
  set.delete(socket.id)
  if (set.size === 0) {
    socketsByUser.delete(userId)
    onlineUsers.delete(userId)
    socket.broadcast.emit('presence:update', { userId, online: false })
  }
}

function isOnline(userId) {
  return onlineUsers.has(userId)
}

function emitToUser(io, userId, event, payload) {
  io.to(`user:${userId}`).emit(event, payload)
}

function emitToUsers(io, userIds, event, payload) {
  for (const id of userIds) io.to(`user:${id}`).emit(event, payload)
}

function endCall(io, call, event) {
  if (!call) return
  calls.delete(call.id)
  if (callByUser.get(call.callerId) === call.id) callByUser.delete(call.callerId)
  if (callByUser.get(call.calleeId) === call.id) callByUser.delete(call.calleeId)
  if (event) {
    emitToUser(io, call.callerId, event, { callId: call.id })
    emitToUser(io, call.calleeId, event, { callId: call.id })
  }
}

function attachCalls(socket, io, userId) {
  const ack = (res) => typeof res === 'function' ? res : () => {}

  // call:invite {calleeId, kind, channelId?} -> {ok, callId}
  socket.on('call:invite', (payload, res) => {
    const reply = ack(res)
    try {
      const body = payload || {}
      const calleeId = str(body.calleeId)
      const kind = str(body.kind)
      const channelId = str(body.channelId) || null
      if (!calleeId || calleeId === userId) throw new HttpError(400, 'Некорректный собеседник')
      if (kind !== 'video' && kind !== 'audio') throw new HttpError(400, 'Некорректный тип звонка')

      const callee = findUserById(calleeId)
      if (!callee) throw new HttpError(404, 'Пользователь не найден')

      // callee must share >=1 org with caller
      const shared = get(
        'SELECT 1 AS x FROM members a JOIN members b ON a.org_id = b.org_id WHERE a.user_id = ? AND b.user_id = ? LIMIT 1',
        userId, calleeId
      )
      if (!shared) throw new HttpError(403, 'Пользователь не состоит с вами в одной организации')
      if (!isOnline(calleeId)) throw new HttpError(409, 'Пользователь не в сети')

      if (callByUser.has(calleeId)) throw new HttpError(409, 'Пользователь уже разговаривает')
      if (callByUser.has(userId)) throw new HttpError(409, 'Вы уже разговариваете')

      const callId = newId('call')
      const call = {
        id: callId,
        callerId: userId,
        calleeId,
        kind,
        channelId,
        state: 'ringing',
        createdAt: Date.now(),
      }
      calls.set(callId, call)
      callByUser.set(userId, callId)
      callByUser.set(calleeId, callId)

      emitToUser(io, calleeId, 'call:incoming', {
        callId,
        // spec: from:{user, displayName, ...} — expose both access styles
        from: { ...publicUser(findUserById(userId)), user: publicUser(findUserById(userId)) },
        kind,
        channelId,
      })
      reply({ ok: true, callId })
    } catch (err) {
      reply({ error: err.message || 'Ошибка вызова' })
    }
  })

  // call:accept {callId} -> {ok}; caller gets call:accepted
  socket.on('call:accept', (payload, res) => {
    const reply = ack(res)
    try {
      const call = calls.get(payload?.callId)
      if (!call) throw new HttpError(404, 'Звонок не найден')
      if (call.calleeId !== userId) throw new HttpError(403, 'Принять звонок может только адресат')
      if (call.state === 'accepted') throw new HttpError(409, 'Звонок уже принят')
      call.state = 'accepted'
      emitToUser(io, call.callerId, 'call:accepted', { callId: call.id })
      reply({ ok: true })
    } catch (err) {
      reply({ error: err.message || 'Ошибка' })
    }
  })

  // call:reject {callId} -> {ok}; caller gets call:rejected
  socket.on('call:reject', (payload, res) => {
    const reply = ack(res)
    try {
      const call = calls.get(payload?.callId)
      if (!call) throw new HttpError(404, 'Звонок не найден')
      if (call.calleeId !== userId) throw new HttpError(403, 'Отклонить звонок может только адресат')
      emitToUser(io, call.callerId, 'call:rejected', { callId: call.id })
      endCall(io, call, null)
      reply({ ok: true })
    } catch (err) {
      reply({ error: err.message || 'Ошибка' })
    }
  })

  // call:leave {callId} -> {ok}; other peer gets call:left; call removed
  socket.on('call:leave', (payload, res) => {
    const reply = ack(res)
    try {
      const call = calls.get(payload?.callId)
      if (!call) throw new HttpError(404, 'Звонок не найден')
      if (call.callerId !== userId && call.calleeId !== userId) {
        throw new HttpError(403, 'Вы не участвуете в этом звонке')
      }
      const other = call.callerId === userId ? call.calleeId : call.callerId
      emitToUser(io, other, 'call:left', { callId: call.id })
      endCall(io, call, null)
      reply({ ok: true })
    } catch (err) {
      reply({ error: err.message || 'Ошибка' })
    }
  })

  // call:state {callId, muted, cameraOff} -> relayed to peer as call:state
  socket.on('call:state', (payload) => {
    const call = calls.get(payload?.callId)
    if (!call) return
    if (call.callerId !== userId && call.calleeId !== userId) return
    const other = call.callerId === userId ? call.calleeId : call.callerId
    emitToUser(io, other, 'call:state', {
      callId: call.id,
      muted: !!payload?.muted,
      cameraOff: !!payload?.cameraOff,
    })
  })

  // rtc:sdp {callId, to, sdp} -> relayed as {callId, from, sdp}
  socket.on('rtc:sdp', (payload) => {
    const call = calls.get(payload?.callId)
    if (!call) return
    if (call.callerId !== userId && call.calleeId !== userId) return
    const to = str(payload?.to)
    const other = call.callerId === userId ? call.calleeId : call.callerId
    if (to !== other || payload?.sdp === undefined) return
    emitToUser(io, other, 'rtc:sdp', { callId: call.id, from: userId, sdp: payload.sdp })
  })

  // rtc:ice {callId, to, candidate} -> relayed as {callId, from, candidate}
  socket.on('rtc:ice', (payload) => {
    const call = calls.get(payload?.callId)
    if (!call) return
    if (call.callerId !== userId && call.calleeId !== userId) return
    const to = str(payload?.to)
    const other = call.callerId === userId ? call.calleeId : call.callerId
    if (to !== other || payload?.candidate === undefined) return
    emitToUser(io, other, 'rtc:ice', { callId: call.id, from: userId, candidate: payload.candidate })
  })
}

export function initSockets(io) {
  mainIo = io

  // auth handshake
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      const userId = token ? verifyToken(token) : null
      if (!userId) return next(new Error('unauthorized'))
      const user = findUserById(userId)
      if (!user) return next(new Error('unauthorized'))
      if (user.banned) return next(new Error('unauthorized')) // SPEC v4 §23
      socket.data.user = user
      next()
    } catch {
      next(new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user
    socket.join(`user:${user.id}`)
    registerSocket(socket, user)

    const firstConnect = !onlineUsers.has(user.id)
    onlineUsers.add(user.id)
    if (firstConnect) {
      io.emit('presence:update', { userId: user.id, online: true })
    }

    // ---------- message:send ----------
    socket.on('message:send', (payload, res) => {
      const reply = typeof res === 'function' ? res : () => {}
      try {
        const body = payload || {}
        const channelId = str(body.channelId)
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (!channelId) throw new HttpError(400, 'Укажите канал')
        if (!text || text.length > 4000) throw new HttpError(400, 'Сообщение: 1–4000 символов')

        requireChannelAccess(channelId, user.id)

        const id = newId('m')
        const createdAt = Date.now()
        run('INSERT INTO messages (id, channel_id, sender_id, text, created_at) VALUES (?,?,?,?,?)',
          id, channelId, user.id, text, createdAt)

        const message = {
          id,
          channelId,
          sender: {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            avatarColor: user.avatar_color,
            isOwner: !!user.is_owner, // SPEC v5 §29
          },
          text,
          createdAt,
        }
        if (body.tempId) message.tempId = body.tempId

        const memberIds = channelMemberIds(channelId)
        for (const uid of memberIds) {
          if (uid === user.id) {
            // sender gets message:new with tempId (idempotent reconcile)
            emitToUser(io, uid, 'message:new', { message })
          } else {
            const { tempId, ...rest } = message
            emitToUser(io, uid, 'message:new', { message: rest })
          }
        }
        reply({ ok: true, message })
      } catch (err) {
        reply({ error: err.message || 'Не удалось отправить сообщение' })
      }
    })

    // ---------- typing (relay to other members, throttle >=1 per 2s per channel) ----------
    socket.on('typing', (payload) => {
      try {
        const channelId = str(payload?.channelId)
        const typing = payload?.typing !== false
        if (!channelId) return
        requireChannelAccess(channelId, user.id)

        const key = `${socket.id}:${channelId}`
        const now = Date.now()
        const last = lastTypingAt.get(key) || 0
        if (typing && now - last < 2000) return
        lastTypingAt.set(key, now)

        const memberIds = channelMemberIds(channelId)
        for (const uid of memberIds) {
          if (uid === user.id) continue
          emitToUser(io, uid, 'typing', {
            channelId,
            user: {
              id: user.id,
              username: user.username,
              displayName: user.display_name,
              avatarColor: user.avatar_color,
              isOwner: !!user.is_owner, // SPEC v5 §29
            },
            typing,
          })
        }
      } catch {
        // ignore relay errors
      }
    })

    // ---------- channel:read (SPEC v3 §18) ----------
    // payload {channelId, lastReadAt?} -> relayed to other members as
    // {channelId, userId, lastReadAt}; also persisted for unread counters.
    socket.on('channel:read', (payload) => {
      try {
        const channelId = str(payload?.channelId)
        if (!channelId) return
        requireChannelAccess(channelId, user.id)

        let at = Date.now()
        if (payload?.lastReadAt !== undefined && Number.isFinite(Number(payload.lastReadAt))) {
          at = Number(payload.lastReadAt)
        }
        touchChannelRead(channelId, user.id, at)

        for (const uid of channelMemberIds(channelId)) {
          if (uid === user.id) continue
          emitToUser(io, uid, 'channel:read', { channelId, userId: user.id, lastReadAt: at })
        }
      } catch {
        // ignore relay errors
      }
    })

    attachCalls(socket, io, user.id)

    socket.on('disconnect', () => {
      lastTypingAt.forEach((_, k) => { if (k.startsWith(`${socket.id}:`)) lastTypingAt.delete(k) })
      unregisterSocket(socket, user.id)

      // if user has no more sockets, drop their active call
      if (!socketsByUser.has(user.id)) {
        const callId = callByUser.get(user.id)
        if (callId) {
          const call = calls.get(callId)
          if (call) {
            const other = call.callerId === user.id ? call.calleeId : call.callerId
            emitToUser(io, other, 'call:left', { callId: call.id })
            endCall(io, call, null)
          }
        }
      }
    })
  })
}
