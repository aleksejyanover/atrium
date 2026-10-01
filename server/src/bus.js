/**
 * Small bus bridging REST handlers and Socket.IO:
 * lets routes emit socket events without importing index.js (avoids cycles).
 * index.js calls `setIo(io)` on startup.
 */
import { orgMemberIds } from './db.js'

let io = null

export function setIo(instance) {
  io = instance
}

export function getIo() {
  return io
}

/** Emit event to every socket of a specific user. */
export function emitToUser(userId, event, payload) {
  if (!io) return
  io.to(`user:${userId}`).emit(event, payload)
}

/** Emit event to all sockets of all members of an org. */
export function emitToOrg(orgId, event, payload) {
  if (!io) return
  for (const id of orgMemberIds(orgId)) io.to(`user:${id}`).emit(event, payload)
}

/** Emit event to every socket of each user in list. */
export function emitToUsers(userIds, event, payload) {
  if (!io) return
  for (const id of userIds) io.to(`user:${id}`).emit(event, payload)
}
