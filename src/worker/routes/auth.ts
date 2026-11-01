import { Hono } from 'hono'
import { ROLE_PERMISSIONS, type Role } from '../../shared/permissions'
import { bootstrapRequest, changePasswordRequest, loginRequest } from '../../shared/schemas'
import { auditStatement } from '../lib/audit'
import { createSession, currentTokenHash, destroySession, requireSession, revokeUserSessions } from '../lib/auth'
import { hashPassword, secretsMatch, verifyPassword } from '../lib/crypto'
import { insert, update } from '../lib/db'
import { ApiError, newId, nowIso, parseBody, type AppEnv } from '../lib/http'
import { rateLimit } from '../lib/rate-limit'

export const authRoutes = new Hono<AppEnv>()

async function hasSuperAdmin(db: D1Database): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1").first()) !== null
}

authRoutes.get('/bootstrap-status', async (c) => {
  return c.json({ needed: !(await hasSuperAdmin(c.env.DB)) })
})

/** One-time setup: needs the deployment secret and stops working once a super admin exists. */
authRoutes.post('/bootstrap', async (c) => {
  await rateLimit(c, 'bootstrap', 10, 3600)
  const body = await parseBody(c, bootstrapRequest)
  const secret = c.env.BOOTSTRAP_TOKEN
  if (!secret || !(await secretsMatch(body.token, secret))) {
    throw new ApiError(403, 'INVALID_BOOTSTRAP_TOKEN', 'The setup token is not correct.')
  }
  if (await hasSuperAdmin(c.env.DB)) throw new ApiError(409, 'ALREADY_BOOTSTRAPPED', 'Setup has already been completed.')
  const now = nowIso()
  const id = newId()
  await c.env.DB.batch([
    insert(c.env.DB, 'users', {
      id,
      name: body.name,
      email: body.email,
      phone: '',
      role: 'SUPER_ADMIN',
      password_hash: await hashPassword(body.password),
      must_change_password: 0,
      is_active: 1,
      last_login_at: null,
      created_at: now,
      updated_at: now,
    }),
    auditStatement(c.env.DB, { id, name: body.name }, 'BOOTSTRAP_ADMIN', 'user', id),
  ])
  return c.json({ ok: true }, 201)
})

authRoutes.post('/login', async (c) => {
  const body = await parseBody(c, loginRequest)
  await rateLimit(c, 'login-ip', 30, 900)
  await rateLimit(c, 'login-account', 10, 900, body.email.toLowerCase())
  const user = await c.env.DB.prepare(
    'SELECT id, name, email, role, password_hash, must_change_password, is_active FROM users WHERE email = ?',
  )
    .bind(body.email)
    .first<{ id: string; name: string; email: string; role: Role; password_hash: string; must_change_password: number; is_active: number }>()
  const valid = await verifyPassword(body.password, user?.password_hash ?? null)
  if (!user || !valid || !user.is_active) throw new ApiError(401, 'INVALID_LOGIN', 'The email or password is not correct.')
  await createSession(c, user)
  await update(c.env.DB, 'users', { last_login_at: nowIso() }, 'id = ?', user.id).run()
  return c.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: Boolean(user.must_change_password) } })
})

authRoutes.post('/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})

authRoutes.get('/me', requireSession, (c) => {
  const user = c.get('user')
  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: Boolean(user.must_change_password),
      permissions: ROLE_PERMISSIONS[user.role],
    },
  })
})

authRoutes.post('/change-password', requireSession, async (c) => {
  const user = c.get('user')
  await rateLimit(c, 'change-password', 10, 900, user.id)
  const body = await parseBody(c, changePasswordRequest)
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first<{ password_hash: string }>()
  if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) {
    throw new ApiError(400, 'WRONG_PASSWORD', 'Your current password is not correct.')
  }
  if (body.currentPassword === body.newPassword) {
    throw new ApiError(400, 'SAME_PASSWORD', 'Choose a password different from your current one.')
  }
  await c.env.DB.batch([
    update(c.env.DB, 'users', { password_hash: await hashPassword(body.newPassword), must_change_password: 0, updated_at: nowIso() }, 'id = ?', user.id),
    revokeUserSessions(c.env.DB, user.id, await currentTokenHash(c)),
    auditStatement(c.env.DB, user, 'CHANGE_PASSWORD', 'user', user.id),
  ])
  return c.json({ ok: true })
})
