/**
 * Channel access rules shared by REST routes and socket handlers:
 *  - type "channel": any member of the channel's org
 *  - type "dm":      listed in channel_members (exactly two users)
 */
import { findChannel, findMember, isChannelMember, findOrg } from './db.js'
import { forbidden, notFound } from './util.js'

/**
 * Returns { channel, org, memberIds } when userId has access,
 * otherwise throws (404 unknown channel, 403 no access).
 */
export function requireChannelAccess(channelId, userId) {
  const channel = typeof channelId === 'string' ? findChannel(channelId) : null
  if (!channel) throw notFound('Канал не найден')

  if (channel.type === 'channel') {
    const org = findOrg(channel.org_id)
    if (!org) throw notFound('Организация не найдена')
    if (!findMember(channel.org_id, userId)) throw forbidden('У вас нет доступа к этому каналу')
    return { channel, org }
  }

  // dm
  if (!isChannelMember(channel.id, userId)) throw forbidden('У вас нет доступа к этому каналу')
  const org = findOrg(channel.org_id)
  return { channel, org }
}
