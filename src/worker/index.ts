import { app } from './app'

export default {
  fetch: app.fetch,

  /** Daily housekeeping: removes expired sessions and rate-limit counters. */
  async scheduled(_controller, env) {
    const now = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL').bind(now),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now),
    ])
  },
} satisfies ExportedHandler<Env>
