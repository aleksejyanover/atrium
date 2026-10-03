/**
 * SPEC v9 §37: бот-модератор каналов.
 *  - POST   /api/orgs/:id/channels/:channelId/bot   — добавить бота НАПРЯМУЮ
 *    (channel_members insert, без приглашений/договоров), rank >= 60;
 *  - DELETE /api/orgs/:id/channels/:channelId/bot   — убрать бота;
 *  - GET    /api/orgs/:id/channels/:channelId/bot   — {inChannel};
 *  - POST   /api/orgs/:id/channels/:channelId/moderation/rating — бот публикует
 *    «📊 Оценка переписки: score/100 …» (score = max(0, 100 - violations*8)).
 */
import { Router } from 'express'
import { get, run, findChannel, isChannelMember, channelMemberIds, BOT_ID } from '../db.js'
import { requireAuth, requireOrgMember, requireRank } from '../auth.js'
import { bad, conflict, notFound } from '../util.js'
import { ensureBotUser, botSendMessage } from '../bot.js'
import { getChannelStat } from '../moderation.js'

const router = Router()

/** Channel of this org (type 'channel' — DMs are not moderatable). */
function findOrgChannel(req) {
  const channel = findChannel(req.params.channelId)
  if (!channel) throw notFound('Канал не найден')
  if (channel.org_id !== req.org.id) throw notFound('Канал не найден')
  if (channel.type !== 'channel') throw bad('Бот доступен только в каналах, не в личных сообщениях')
  return channel
}

function botUser() {
  const bot = ensureBotUser()
  if (!bot) throw conflict('Бот временно недоступен')
  return bot
}

const channelTitle = (c) => `#${c.name || 'канал'}`

// POST /api/orgs/:id/channels/:channelId/bot -> {ok:true, already?:true} (§37.1)
router.post('/orgs/:id/channels/:channelId/bot', requireAuth, requireOrgMember, requireRank(60, 'Добавлять бота может только админ и выше'), (req, res, next) => {
  try {
    const channel = findOrgChannel(req)
    botUser()
    if (isChannelMember(channel.id, BOT_ID)) {
      return res.json({ ok: true, already: true })
    }
    // SPEC v9 §37.1: прямое добавление — без приглашений, заявлений и договоров
    run('INSERT INTO channel_members (channel_id, user_id) VALUES (?,?)', channel.id, BOT_ID)
    botSendMessage(channel.id, `🤖 Бот-модератор добавлен в ${channelTitle(channel)}: следит за перепиской и удаляет нецензурные сообщения.`)
    res.json({ ok: true, already: false })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/orgs/:id/channels/:channelId/bot -> {ok:true} (§37.1)
router.delete('/orgs/:id/channels/:channelId/bot', requireAuth, requireOrgMember, requireRank(60, 'Убирать бота может только админ и выше'), (req, res, next) => {
  try {
    const channel = findOrgChannel(req)
    if (!isChannelMember(channel.id, BOT_ID)) throw notFound('Бот не добавлен в этот канал')
    run('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?', channel.id, BOT_ID)
    botSendMessage(channel.id, `🤖 Бот-модератор убран из ${channelTitle(channel)}.`)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// GET /api/orgs/:id/channels/:channelId/bot -> {inChannel} (§37.3)
router.get('/orgs/:id/channels/:channelId/bot', requireAuth, requireOrgMember, (req, res, next) => {
  try {
    const channel = findOrgChannel(req)
    res.json({ inChannel: isChannelMember(channel.id, BOT_ID) })
  } catch (err) {
    next(err)
  }
})

// POST /api/orgs/:id/channels/:channelId/moderation/rating -> {ok:true} (§37.8)
router.post('/orgs/:id/channels/:channelId/moderation/rating', requireAuth, requireOrgMember, requireRank(60, 'Оценку переписки запрашивает только админ и выше'), (req, res, next) => {
  try {
    const channel = findOrgChannel(req)
    if (!isChannelMember(channel.id, BOT_ID)) {
      throw bad('Сначала добавьте бота-модератора в канал')
    }
    botUser()
    const stat = getChannelStat(channel.id)
    if (stat.messages < 5) {
      botSendMessage(channel.id, `📊 Пока мало данных для оценки (сообщений: ${stat.messages})`)
    } else {
      const score = Math.max(0, 100 - stat.violations * 8)
      botSendMessage(
        channel.id,
        `📊 Оценка переписки: ${score}/100 · сообщений: ${stat.messages} · нарушений: ${stat.violations}`
      )
    }
    run(
      `INSERT INTO channel_mod (channel_id, last_rating_at) VALUES (?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET last_rating_at = excluded.last_rating_at`,
      channel.id,
      Date.now()
    )
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
