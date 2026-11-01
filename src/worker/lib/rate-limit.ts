import { sha256Hex } from './crypto'
import { ApiError, clientIp, type AppContext } from './http'

/** Fixed-window counter in D1. Identifiers are hashed so raw IP addresses and phone numbers are not stored. */
export async function rateLimit(c: AppContext, scope: string, limit: number, windowSeconds: number, identifier?: string) {
  const windowIndex = Math.floor(Date.now() / (windowSeconds * 1000))
  const hashed = await sha256Hex(identifier ?? clientIp(c))
  const bucket = `${scope}:${hashed.slice(0, 32)}:${windowIndex}`
  const expiresAt = new Date((windowIndex + 1) * windowSeconds * 1000).toISOString()
  const row = await c.env.DB.prepare(
    `INSERT INTO rate_limits (bucket, count, expires_at) VALUES (?, 1, ?)
     ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count`,
  )
    .bind(bucket, expiresAt)
    .first<{ count: number }>()
  if (row && row.count > limit) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.')
  }
}
