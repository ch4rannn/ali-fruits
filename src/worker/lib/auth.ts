import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { can, type Permission } from '../../shared/permissions'
import { randomToken, sha256Hex } from './crypto'
import { insert } from './db'
import { ApiError, nowIso, type AppContext, type AppEnv, type SessionUser } from './http'

const COOKIE = 'fd_session'
const STAFF_SESSION_HOURS = 12
const RIDER_SESSION_HOURS = 24 * 7

export async function createSession(c: AppContext, user: Pick<SessionUser, 'id' | 'role'>): Promise<void> {
  const token = randomToken()
  const hours = user.role === 'RIDER' ? RIDER_SESSION_HOURS : STAFF_SESSION_HOURS
  const expires = new Date(Date.now() + hours * 3_600_000)
  await insert(c.env.DB, 'sessions', {
    token_hash: await sha256Hex(token),
    user_id: user.id,
    expires_at: expires.toISOString(),
    revoked_at: null,
    created_at: nowIso(),
  }).run()
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT !== 'development',
    sameSite: 'Strict',
    path: '/api',
    expires,
  })
}

export async function destroySession(c: AppContext): Promise<void> {
  const token = getCookie(c, COOKIE)
  if (token) {
    await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?').bind(nowIso(), await sha256Hex(token)).run()
  }
  deleteCookie(c, COOKIE, { path: '/api' })
}

export function revokeUserSessions(db: D1Database, userId: string, exceptTokenHash?: string): D1PreparedStatement {
  return db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND token_hash <> ?')
    .bind(nowIso(), userId, exceptTokenHash ?? '')
}

export async function currentTokenHash(c: AppContext): Promise<string | undefined> {
  const token = getCookie(c, COOKIE)
  return token ? sha256Hex(token) : undefined
}

async function loadSessionUser(c: AppContext): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE)
  if (!token) return null
  return c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.must_change_password, r.id AS rider_id
     FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN riders r ON r.user_id = u.id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.is_active = 1`,
  )
    .bind(await sha256Hex(token), nowIso())
    .first<SessionUser>()
}

/** Any signed-in user, even one who still has to replace a temporary password. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const user = await loadSessionUser(c)
  if (!user) throw new ApiError(401, 'NOT_SIGNED_IN', 'Please sign in.')
  c.set('user', user)
  await next()
})

function assertPasswordCurrent(user: SessionUser) {
  if (user.must_change_password) {
    throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Replace your temporary password to continue.')
  }
}

/** Office staff only. Riders are refused even if they guess an admin URL. */
export const requireStaff = createMiddleware<AppEnv>(async (c, next) => {
  const user = await loadSessionUser(c)
  if (!user) throw new ApiError(401, 'NOT_SIGNED_IN', 'Please sign in.')
  if (user.role === 'RIDER') throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this.')
  assertPasswordCurrent(user)
  c.set('user', user)
  await next()
})

export const requireRider = createMiddleware<AppEnv>(async (c, next) => {
  const user = await loadSessionUser(c)
  if (!user) throw new ApiError(401, 'NOT_SIGNED_IN', 'Please sign in.')
  if (user.role !== 'RIDER' || !user.rider_id) throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this.')
  assertPasswordCurrent(user)
  c.set('user', user)
  await next()
})

export function requirePermission(...permissions: Permission[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    assertPermission(c, ...permissions)
    await next()
  })
}

/** Passes when the user holds at least one of the listed permissions. */
export function assertPermission(c: AppContext, ...permissions: Permission[]) {
  const user = c.get('user')
  if (!permissions.some((permission) => can(user.role, permission))) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this.')
  }
}
