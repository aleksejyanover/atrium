import { Router } from 'express'
import { all, findMember } from '../db.js'
import { requireAuth } from '../auth.js'

const router = Router()
router.use('/discover', requireAuth)

const CATALOG_LIMIT = 30

// GET /api/discover?q= -> {orgs:[{id, name, description, createdAt, membersCount, isMember, myRole}]}
// SPEC v2 §12: only is_public = 1, up to 30, membersCount DESC, name ASC.
// `q` — case-insensitive substring over name/description; without q — all public orgs.
router.get('/discover', (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''
    const rows = all(
      'SELECT o.*, (SELECT COUNT(*) FROM members m WHERE m.org_id = o.id) AS mc FROM orgs o WHERE o.is_public = 1'
    )
    const filtered = rows.filter((r) => {
      if (!q) return true
      return (
        String(r.name || '').toLowerCase().includes(q) ||
        String(r.description || '').toLowerCase().includes(q)
      )
    })
    filtered.sort((a, b) => {
      if (b.mc !== a.mc) return b.mc - a.mc
      const an = String(a.name || '')
      const bn = String(b.name || '')
      return an < bn ? -1 : an > bn ? 1 : 0
    })
    const orgs = filtered.slice(0, CATALOG_LIMIT).map((r) => {
      const member = findMember(r.id, req.userId)
      return {
        id: r.id,
        name: r.name,
        description: r.description || '',
        createdAt: r.created_at,
        membersCount: r.mc,
        isMember: !!member,
        myRole: member ? member.role : null,
      }
    })
    res.json({ orgs })
  } catch (err) {
    next(err)
  }
})

export default router
