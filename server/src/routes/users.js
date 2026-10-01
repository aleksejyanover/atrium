import { Router } from 'express'
import { all } from '../db.js'
import { requireAuth } from '../auth.js'
import { publicUser } from '../util.js'

const router = Router()

// GET /api/users/search?q= -> {users:[user,...]} up to 15, substring by username/displayName
router.get('/users/search', requireAuth, (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (!q) return res.json({ users: [] })
    const needle = q.toLowerCase()
    // SQLite LIKE is case-sensitive for non-ASCII, so filter in JS (small scale)
    const rows = all('SELECT * FROM users')
      .filter(
        (r) =>
          r.username.toLowerCase().includes(needle) ||
          r.display_name.toLowerCase().includes(needle)
      )
      .sort((a, b) => (a.username < b.username ? -1 : 1))
      .slice(0, 15)
    res.json({ users: rows.map(publicUser) })
  } catch (err) {
    next(err)
  }
})

export default router
