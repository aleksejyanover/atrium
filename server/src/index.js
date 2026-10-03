import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { Server } from 'socket.io'

import './db.js'
import { setIo } from './bus.js'
import { runWithContext } from './audit.js'
import { HttpError } from './util.js'
import { initSockets } from './sockets.js'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import orgRoutes from './routes/orgs.js'
import inviteRoutes from './routes/invites.js'
import channelRoutes from './routes/channels.js'
import discoverRoutes from './routes/discover.js'
import applicationRoutes from './routes/applications.js'
import documentRoutes from './routes/documents.js'
import walletRoutes from './routes/wallet.js'
import adminRoutes from './routes/admin.js'
import moderationRoutes from './routes/moderation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 4000

const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '2mb' }))

// SPEC v4 §23: ip + user-agent of every request available to audit/login_log
// (X-Forwarded-For in front of the serveo tunnel when present)
app.use((req, res, next) => {
  const forwarded = req.headers['x-forwarded-for']
  const ip =
    (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) ||
    req.ip ||
    req.socket?.remoteAddress ||
    null
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null
  runWithContext({ ip, userAgent }, next)
})

// ---------- health ----------
app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

// ---------- REST API ----------
app.use('/api', authRoutes)
app.use('/api', userRoutes)
app.use('/api', orgRoutes)
app.use('/api', inviteRoutes)
app.use('/api', channelRoutes)
app.use('/api', discoverRoutes)
app.use('/api', applicationRoutes)
app.use('/api', documentRoutes)
app.use('/api', walletRoutes)
app.use('/api', adminRoutes)
app.use('/api', moderationRoutes)

// 404 for unknown API routes (JSON, not HTML)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Маршрут не найден' })
})

// ---------- static web build (SPA fallback) ----------
const webDist = path.join(__dirname, '..', '..', 'web', 'dist')
app.use(express.static(webDist)) // no-op until web/dist exists (checked per request below)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next()
  const indexPath = path.join(webDist, 'index.html')
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath)
  next()
})
console.log(`[atrium] serving web statics from ${webDist} (when built)`)

// ---------- JSON body / error handling ----------
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Некорректный JSON в запросе' })
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message })
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Слишком большой запрос' })
  }
  console.error('[atrium] error:', err)
  res.status(500).json({ error: 'Внутренняя ошибка сервера' })
})

// ---------- http + socket.io ----------
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: true, credentials: true },
})
setIo(io)
initSockets(io)

server.listen(PORT, () => {
  console.log(`[atrium] server listening on http://localhost:${PORT}`)
})

// graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    io.close()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref()
  })
}
