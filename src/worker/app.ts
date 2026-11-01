import { Hono } from 'hono'
import { ZodError } from 'zod'
import { requireStaff } from './lib/auth'
import { ApiError, type AppEnv } from './lib/http'
import { adminCatalogRoutes } from './routes/admin-catalog'
import { adminDeliveryRoutes } from './routes/admin-delivery'
import { adminFinanceRoutes } from './routes/admin-finance'
import { adminOrderRoutes } from './routes/admin-orders'
import { adminProcurementRoutes } from './routes/admin-procurement'
import { adminSystemRoutes } from './routes/admin-system'
import { authRoutes } from './routes/auth'
import { adminUploadRoutes, mediaRoutes } from './routes/media'
import { publicRoutes } from './routes/public'
import { riderRoutes } from './routes/rider'
import { renderPage, seoRoutes } from './seo'

export const app = new Hono<AppEnv>()

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (c.env.ENVIRONMENT !== 'development') {
    c.res.headers.set('Strict-Transport-Security', 'max-age=31536000')
    c.res.headers.set('Content-Security-Policy', CSP) // Vite's dev server needs inline scripts, so it is skipped there.
  }
})

/** Blocks writes from other websites. Together with SameSite=Strict cookies, this is the CSRF protection. */
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin')
    const host = c.req.header('Host') ?? new URL(c.req.url).host
    let sameOrigin = false
    try {
      sameOrigin = origin !== undefined && new URL(origin).host === host
    } catch {
      sameOrigin = false
    }
    if (!sameOrigin) throw new ApiError(403, 'BAD_ORIGIN', 'This request was blocked because it did not come from this site.')
  }
  await next()
  if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store')
})

app.route('/api/auth', authRoutes)
app.route('/api/public', publicRoutes)
app.route('/api/rider', riderRoutes)

const admin = new Hono<AppEnv>()
admin.use('*', requireStaff)
admin.route('/orders', adminOrderRoutes)
admin.route('/catalog', adminCatalogRoutes)
admin.route('/procurement', adminProcurementRoutes)
admin.route('/deliveries', adminDeliveryRoutes)
admin.route('/finance', adminFinanceRoutes)
admin.route('/system', adminSystemRoutes)
admin.route('/uploads', adminUploadRoutes)
app.route('/api/admin', admin)

app.all('/api/*', () => {
  throw new ApiError(404, 'NOT_FOUND', 'This API route does not exist.')
})

app.route('/media', mediaRoutes)
app.route('/', seoRoutes)
// Anything that looks like a file (or a Vite development module) is served from the static assets.
// Only real page addresses get the server-rendered page, and those never contain a dot.
app.get('*', async (c) => {
  const path = new URL(c.req.url).pathname
  const isFile = (path.split('/').pop() ?? '').includes('.') || /^\/(@|src\/|node_modules\/)/.test(path)
  if (!isFile) return renderPage(c)
  const asset = await c.env.ASSETS.fetch(new Request(c.req.url))
  // Single-page fallback answers a missing file with the HTML page. A missing file should be a plain 404.
  const isHtml = asset.headers.get('Content-Type')?.includes('text/html')
  return asset.ok && !isHtml ? asset : c.text('Not found', 404)
})

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: { code: error.code, message: error.message, details: error.details } }, error.status)
  }
  if (error instanceof ZodError) {
    const fields = error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    return c.json({ error: { code: 'VALIDATION_FAILED', message: fields[0]?.message ?? 'Please check the form.', details: { fields } } }, 422)
  }
  // Full detail goes to the logs only. Visitors never see internal errors.
  const message = error instanceof Error ? error.message : String(error)
  console.error(JSON.stringify({ event: 'unhandled_error', path: new URL(c.req.url).pathname, method: c.req.method, message }))
  const isDatabase = /D1_|SQLITE|database/i.test(message)
  return c.json(
    {
      error: {
        code: isDatabase ? 'SERVICE_BUSY' : 'INTERNAL_ERROR',
        message: isDatabase ? 'The service is busy right now. Please try again in a moment.' : 'Something went wrong. Please try again.',
      },
    },
    isDatabase ? 503 : 500,
  )
})
