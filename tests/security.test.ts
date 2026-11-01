import { beforeAll, describe, expect, it } from 'vitest'
import { call, checkout, createProduct, createRider, createZone, enableLiveOrders, env, login, ok, setupDatabase, testEnv } from './helpers'

let admin: string
let zone: { id: string; slotId: string }
let apple: { productId: string; variantId: string }

beforeAll(async () => {
  admin = await setupDatabase()
  zone = await createZone(admin)
  apple = await createProduct(admin, 'Security Apple', 18000, 12000)
})

async function staffWithRole(role: string) {
  const email = `${role.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}@example.test`
  await ok('/api/admin/system/staff', { cookie: admin, body: { name: role, email, role, temporaryPassword: 'temporary-password-1' } })
  const first = await login(email, 'temporary-password-1')
  await ok('/api/auth/change-password', { cookie: first, body: { currentPassword: 'temporary-password-1', newPassword: 'a-new-long-password' } })
  return login(email, 'a-new-long-password')
}

describe('access control', () => {
  it('refuses every admin API without a session', async () => {
    for (const path of ['/api/admin/orders', '/api/admin/catalog/pricing', '/api/admin/finance/overview', '/api/admin/system/staff', '/api/admin/system/audit', '/api/admin/deliveries/riders']) {
      expect((await call(path)).status, path).toBe(401)
    }
  })
  it('refuses every rider API without a session', async () => {
    expect((await call('/api/rider/deliveries')).status).toBe(401)
  })
  it('keeps riders out of the admin API even with a valid session', async () => {
    const rider = await createRider(admin)
    for (const path of ['/api/admin/orders', '/api/admin/catalog/pricing', '/api/admin/finance/reports/sales', '/api/admin/system/settings']) {
      expect((await call(path, { cookie: rider.cookie })).status, path).toBe(403)
    }
  })
  it('keeps office staff out of the rider API', async () => {
    expect((await call('/api/rider/deliveries', { cookie: admin })).status).toBe(403)
  })
  it('keeps one rider away from another rider\'s delivery', async () => {
    const one = await createRider(admin)
    const two = await createRider(admin)
    const order = await (async () => {
      const { orderReadyForPickup } = await import('./helpers')
      await enableLiveOrders()
      return orderReadyForPickup(admin, zone, apple, 18000)
    })()
    await ok('/api/admin/deliveries/assign', { cookie: admin, body: { orderId: order.orderId, riderId: one.riderId } })
    const { open } = await ok('/api/rider/deliveries', { cookie: one.cookie })
    expect((await call(`/api/rider/deliveries/${open[0].id}`, { cookie: two.cookie })).status).toBe(404)
    expect((await call(`/api/rider/deliveries/${open[0].id}/pickup`, { cookie: two.cookie, method: 'POST' })).status).toBe(404)
    expect((await ok('/api/rider/deliveries', { cookie: two.cookie })).open).toHaveLength(0)
  })
  it('applies each staff role\'s limits on the server', async () => {
    const finance = await staffWithRole('FINANCE')
    const ops = await staffWithRole('OPERATIONS')
    const delivery = await staffWithRole('DELIVERY_MANAGER')
    expect((await call('/api/admin/finance/reports/sales', { cookie: finance })).status).toBe(200)
    expect((await call('/api/admin/catalog/pricing', { cookie: finance })).status).toBe(403)
    expect((await call('/api/admin/finance/reports/sales', { cookie: ops })).status).toBe(403)
    expect((await call('/api/admin/catalog/pricing', { cookie: ops })).status).toBe(200)
    expect((await call('/api/admin/system/staff', { cookie: ops })).status).toBe(403)
    expect((await call('/api/admin/procurement/queue', { cookie: delivery })).status).toBe(403)
    expect((await call('/api/admin/deliveries/ready', { cookie: delivery })).status).toBe(200)
    expect((await call('/api/admin/system/settings/go-live', { cookie: ops, body: { key: 'ONLINE_SALES_ENABLED', value: true } })).status).toBe(403)
  })
  it('hides costs from staff who should not see them', async () => {
    const delivery = await staffWithRole('DELIVERY_MANAGER')
    const placed = await ok('/api/public/orders', { body: checkout(zone, [{ variantId: apple.variantId, qty: 1 }]) })
    const order = await env.DB.prepare('SELECT id FROM orders WHERE order_number = ?').bind(placed.orderNumber).first<{ id: string }>()
    const detail = await ok(`/api/admin/orders/${order!.id}`, { cookie: delivery })
    expect(detail.finance).toBeNull()
    expect(detail.procurement).toEqual([])
  })
  it('only lets a super admin manage go-live and staff', async () => {
    const adminRole = await staffWithRole('ADMIN')
    expect((await call('/api/admin/system/settings/go-live', { cookie: adminRole, body: { key: 'ONLINE_SALES_ENABLED', value: false } })).status).toBe(403)
    expect((await call('/api/admin/system/staff', { cookie: adminRole })).status).toBe(403)
  })
})

describe('sessions and passwords', () => {
  it('requires a temporary password to be replaced before anything else', async () => {
    const email = `temp-${crypto.randomUUID().slice(0, 6)}@example.test`
    await ok('/api/admin/system/staff', { cookie: admin, body: { name: 'Temp', email, role: 'OPERATIONS', temporaryPassword: 'temporary-password-1' } })
    const cookie = await login(email, 'temporary-password-1')
    const blocked = await call('/api/admin/orders', { cookie })
    expect(blocked.status).toBe(403)
    expect(blocked.json.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
  })
  it('rejects short passwords and wrong logins without revealing which was wrong', async () => {
    const short = await call('/api/auth/bootstrap', { body: { token: 'x', name: 'A', email: 'a@b.test', password: 'short' } })
    expect(short.status).toBe(422)
    const unknown = await call('/api/auth/login', { body: { email: 'nobody@example.test', password: 'whatever-long' } })
    const wrong = await call('/api/auth/login', { body: { email: 'owner@example.test', password: 'whatever-long' } })
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(unknown.json.error.message).toBe(wrong.json.error.message)
  })
  it('never stores or returns a password', async () => {
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE email = 'owner@example.test'").first<{ password_hash: string }>()
    expect(row!.password_hash.startsWith('pbkdf2$')).toBe(true)
    expect(row!.password_hash).not.toContain('correct-horse')
    const me = await ok('/api/auth/me', { cookie: admin })
    expect(JSON.stringify(me)).not.toMatch(/password_hash|passwordHash|pbkdf2/i)
  })
  it('sets a hardened session cookie', async () => {
    const result = await call('/api/auth/login', { body: { email: 'owner@example.test', password: 'correct-horse-battery' }, env: testEnv({ ENVIRONMENT: 'production' }) })
    const cookie = result.headers.get('Set-Cookie')!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=Strict/i)
  })
  it('ends a session on logout and when a password changes', async () => {
    const cookie = await login('owner@example.test', 'correct-horse-battery')
    expect((await call('/api/auth/me', { cookie })).status).toBe(200)
    await ok('/api/auth/logout', { cookie, method: 'POST' })
    expect((await call('/api/auth/me', { cookie })).status).toBe(401)
  })
  it('signs out a staff member the moment they are deactivated', async () => {
    const email = `gone-${crypto.randomUUID().slice(0, 6)}@example.test`
    const { id } = await ok('/api/admin/system/staff', { cookie: admin, body: { name: 'Gone', email, role: 'OPERATIONS', temporaryPassword: 'temporary-password-1' } })
    const first = await login(email, 'temporary-password-1')
    await ok('/api/auth/change-password', { cookie: first, body: { currentPassword: 'temporary-password-1', newPassword: 'a-new-long-password' } })
    const cookie = await login(email, 'a-new-long-password')
    await ok(`/api/admin/system/staff/${id}`, { cookie: admin, method: 'PATCH', body: { isActive: false } })
    expect((await call('/api/admin/orders', { cookie })).status).toBe(401)
    expect((await call('/api/auth/login', { body: { email, password: 'a-new-long-password' } })).status).toBe(401)
  })
  it('blocks login guessing', async () => {
    const ip = '203.0.113.9'
    let last = 0
    for (let i = 0; i < 12; i++) last = (await call('/api/auth/login', { ip, body: { email: 'guess@example.test', password: `wrong-password-${i}` } })).status
    expect(last).toBe(429)
  })
  it('cannot lock the business out by demoting the last super admin', async () => {
    const { staff } = await ok('/api/admin/system/staff', { cookie: admin })
    const owner = staff.find((s: { email: string }) => s.email === 'owner@example.test')
    const result = await call(`/api/admin/system/staff/${owner.id}`, { cookie: admin, method: 'PATCH', body: { role: 'ADMIN' } })
    expect(result.json.error.code).toBe('LAST_SUPER_ADMIN')
  })
  it('allows setup only once, and only with the deployment token', async () => {
    const again = await call('/api/auth/bootstrap', { body: { token: 'test-bootstrap-token', name: 'Second', email: 'second@example.test', password: 'long-enough-password' } })
    expect(again.status).toBe(409)
    const wrongToken = await call('/api/auth/bootstrap', { body: { token: 'guess', name: 'Second', email: 'second@example.test', password: 'long-enough-password' } })
    expect(wrongToken.status).toBe(403)
  })
})

describe('cross-site and injection protection', () => {
  it('refuses writes that do not come from this site', async () => {
    const foreign = await call('/api/public/quote', { origin: 'https://evil.example', body: { items: [{ variantId: apple.variantId, qty: 1 }] } })
    expect(foreign.status).toBe(403)
    const missing = await call('/api/public/quote', { origin: null, body: { items: [{ variantId: apple.variantId, qty: 1 }] } })
    expect(missing.status).toBe(403)
    expect((await call('/api/public/quote', { body: { items: [{ variantId: apple.variantId, qty: 1 }] } })).status).toBe(200)
  })
  it('treats SQL in input as plain text', async () => {
    const { orders } = await ok("/api/admin/orders?q=' OR 1=1 --", { cookie: admin })
    expect(orders).toEqual([])
    const placed = await ok('/api/public/orders', { body: checkout(zone, [{ variantId: apple.variantId, qty: 1 }], { name: "Robert'); DROP TABLE orders;--" }) })
    expect(placed.orderNumber).toBeTruthy()
    expect((await env.DB.prepare('SELECT COUNT(*) AS total FROM orders').first<{ total: number }>())!.total).toBeGreaterThan(0)
  })
  it('escapes search wildcards', async () => {
    expect((await ok('/api/admin/orders?q=%25', { cookie: admin })).orders).toEqual([])
  })
  it('neutralises spreadsheet formulas in CSV exports', async () => {
    await ok('/api/public/orders', { body: checkout(zone, [{ variantId: apple.variantId, qty: 1 }], { name: '=HYPERLINK("http://evil.test")' }) })
    const csv = await call('/api/admin/system/customers/export', { cookie: admin })
    expect(csv.text).toContain("'=HYPERLINK")
    expect(csv.text).not.toMatch(/(^|,)=HYPERLINK/m)
  })
})

describe('customer privacy', () => {
  it('never exposes wholesale prices or private notes to the public', async () => {
    const catalog = await call('/api/public/catalog')
    expect(catalog.text).not.toMatch(/wholesale|12000/i)
    const placed = await ok('/api/public/orders', { body: checkout(zone, [{ variantId: apple.variantId, qty: 1 }]) })
    const tracking = await call(`/api/public/track/${placed.trackingToken}`)
    expect(tracking.text).not.toMatch(/wholesale|internal_notes|customer_phone/i)
  })
  it('makes order links impossible to guess', async () => {
    expect((await call('/api/public/track/FR261101-AAAAA')).status).toBe(404)
    expect((await call('/api/public/track/' + 'a'.repeat(48))).status).toBe(404)
    const placed = await ok('/api/public/orders', { body: checkout(zone, [{ variantId: apple.variantId, qty: 1 }]) })
    expect(placed.trackingToken).toMatch(/^[0-9a-f]{48}$/)
  })
  it('rate limits order lookups by number and phone', async () => {
    const ip = '203.0.113.50'
    let last = 0
    for (let i = 0; i < 12; i++) last = (await call('/api/public/orders/lookup', { ip, body: { orderNumber: 'FR000000-AAAAA', phone: '9876543210' } })).status
    expect(last).toBe(429)
  })
  it('refuses to take orders from a blocked customer', async () => {
    const body = checkout(zone, [{ variantId: apple.variantId, qty: 1 }])
    await ok('/api/public/orders', { body })
    const customer = await env.DB.prepare('SELECT id FROM customers WHERE phone = ?').bind(body.phone).first<{ id: string }>()
    await ok(`/api/admin/system/customers/${customer!.id}`, { cookie: admin, method: 'PATCH', body: { isBlocked: true } })
    const again = await call('/api/public/orders', { body: { ...body, idempotencyKey: crypto.randomUUID() } })
    expect(again.json.error.code).toBe('ORDER_NOT_ALLOWED')
  })
  it('records customer exports in the audit log', async () => {
    await ok('/api/admin/system/customers/export', { cookie: admin })
    const { logs } = await ok('/api/admin/system/audit', { cookie: admin })
    expect(logs.some((log: { action: string }) => log.action === 'EXPORT_CUSTOMERS')).toBe(true)
  })
})

describe('go-live controls', () => {
  it('takes enquiries but not live orders while selling is off', async () => {
    await env.DB.prepare("UPDATE business_settings SET value = 'false' WHERE key IN ('SELLER_DETAILS_VERIFIED','FSSAI_COVERAGE_VERIFIED','ONLINE_SALES_ENABLED')").run()
    const config = await ok('/api/public/config')
    expect(config.liveOrders).toBe(false)
    expect(config.fssaiNumber).toBe('')
    const placed = await ok('/api/public/orders', { body: checkout(zone, [{ variantId: apple.variantId, qty: 1 }]) })
    expect(placed.orderType).toBe('ENQUIRY')
    const order = await env.DB.prepare('SELECT id FROM orders WHERE order_number = ?').bind(placed.orderNumber).first<{ id: string }>()
    const revise = await call(`/api/admin/orders/${order!.id}/revisions`, { cookie: admin, body: { reason: 'x', deliveryFeePaise: 0, items: [{ variantId: apple.variantId, qty: 1, unitPricePaise: 100 }] } })
    expect(revise.json.error.code).toBe('ONLINE_SALES_OFF')
    const payment = await call('/api/admin/finance/payments', { cookie: admin, body: { orderId: order!.id, amountPaise: 100, method: 'UPI' } })
    expect(payment.status).toBe(409)
  })
  it('does not publish licence details until they are verified', async () => {
    await env.DB.prepare("UPDATE business_settings SET value = '10000000000000' WHERE key = 'fssai_number'").run()
    expect((await ok('/api/public/config')).fssaiNumber).toBe('')
    await env.DB.prepare("UPDATE business_settings SET value = 'true' WHERE key = 'FSSAI_COVERAGE_VERIFIED'").run()
    expect((await ok('/api/public/config')).fssaiNumber).toBe('10000000000000')
    await env.DB.prepare("UPDATE business_settings SET value = '' WHERE key = 'fssai_number'").run()
  })
  it('needs the deployment switch as well as the admin switch', async () => {
    await env.DB.prepare("UPDATE business_settings SET value = 'true' WHERE key IN ('SELLER_DETAILS_VERIFIED','FSSAI_COVERAGE_VERIFIED','ONLINE_SALES_ENABLED')").run()
    const off = testEnv({ ONLINE_SALES_ENABLED: 'false' } as Partial<Env>)
    expect((await call('/api/public/config', { env: off })).json.liveOrders).toBe(false)
    expect((await call('/api/public/config')).json.liveOrders).toBe(true)
  })
  it('stops going live until the real details have been entered, and records who confirmed', async () => {
    await env.DB.prepare("UPDATE business_settings SET value = 'false' WHERE key IN ('SELLER_DETAILS_VERIFIED','FSSAI_COVERAGE_VERIFIED','ONLINE_SALES_ENABLED')").run()
    await env.DB.prepare("UPDATE business_settings SET value = '' WHERE key IN ('legal_seller_name','business_address','fssai_number','fssai_category','fssai_valid_until')").run()
    const noDetails = await call('/api/admin/system/settings/go-live', { cookie: admin, body: { key: 'FSSAI_COVERAGE_VERIFIED', value: true, attestation: 'Checked' } })
    expect(noDetails.json.error.code).toBe('DETAILS_MISSING')
    const early = await call('/api/admin/system/settings/go-live', { cookie: admin, body: { key: 'ONLINE_SALES_ENABLED', value: true, attestation: 'Ready' } })
    expect(early.json.error.code).toBe('CHECKS_INCOMPLETE')
    await ok('/api/admin/system/settings', { cookie: admin, method: 'PUT', body: { values: { legal_seller_name: 'Test Seller', business_address: 'Sabzi Mandi, Kharar', fssai_number: '10000000000000', fssai_category: 'Wholesaler and Retailer', fssai_valid_until: '2099-01-01' } } })
    const noNote = await call('/api/admin/system/settings/go-live', { cookie: admin, body: { key: 'SELLER_DETAILS_VERIFIED', value: true } })
    expect(noNote.json.error.code).toBe('ATTESTATION_REQUIRED')
    for (const key of ['SELLER_DETAILS_VERIFIED', 'FSSAI_COVERAGE_VERIFIED', 'ONLINE_SALES_ENABLED']) {
      await ok('/api/admin/system/settings/go-live', { cookie: admin, body: { key, value: true, attestation: 'Checked the licence with the FSSAI portal' } })
    }
    expect((await ok('/api/public/config')).liveOrders).toBe(true)
    const { logs } = await ok('/api/admin/system/audit', { cookie: admin })
    expect(logs.some((log: { action: string; details_json: string }) => log.action === 'CHANGE_GO_LIVE_GATE' && log.details_json.includes('FSSAI portal'))).toBe(true)
  })
  it('turns selling off if the licence expires', async () => {
    await env.DB.prepare("UPDATE business_settings SET value = '2020-01-01' WHERE key = 'fssai_valid_until'").run()
    expect((await ok('/api/public/config')).liveOrders).toBe(false)
    await env.DB.prepare("UPDATE business_settings SET value = '2099-01-01' WHERE key = 'fssai_valid_until'").run()
  })
  it('does not let the settings form flip the go-live switches', async () => {
    const result = await call('/api/admin/system/settings', { cookie: admin, method: 'PUT', body: { values: { ONLINE_SALES_ENABLED: 'true' } } })
    expect(result.json.error.code).toBe('UNKNOWN_SETTING')
  })
})

describe('uploads', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const form = (bytes: Uint8Array, name: string, type: string, folder = 'products') => {
    const data = new FormData()
    data.set('folder', folder)
    data.set('file', new File([bytes], name, { type }))
    return data
  }
  it('stores a real image under a random key and serves it publicly', async () => {
    const result = await call('/api/admin/uploads', { cookie: admin, formData: form(png, 'apple.png', 'image/png') })
    expect(result.status).toBe(201)
    expect(result.json.key).toMatch(/^products\/[0-9a-f-]{36}\.png$/)
    expect(result.json.key).not.toContain('apple')
    const served = await call(`/media/${result.json.key}`)
    expect(served.status).toBe(200)
    expect(served.headers.get('Cache-Control')).toContain('immutable')
  })
  it('judges a file by its contents, not its name or claimed type', async () => {
    const script = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect((await call('/api/admin/uploads', { cookie: admin, formData: form(script, 'x.png', 'image/png') })).status).toBe(415)
    expect((await call('/api/admin/uploads', { cookie: admin, formData: form(new TextEncoder().encode('<?php echo 1;'), 'x.jpg', 'image/jpeg') })).status).toBe(415)
  })
  it('refuses oversized files and unknown folders', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    big.set(png)
    expect((await call('/api/admin/uploads', { cookie: admin, formData: form(big, 'big.png', 'image/png') })).status).toBe(413)
    expect((await call('/api/admin/uploads', { cookie: admin, formData: form(png, 'a.png', 'image/png', '../secrets') })).status).toBe(422)
  })
  it('lets only authorised staff upload', async () => {
    const rider = await createRider(admin)
    expect((await call('/api/admin/uploads', { formData: form(png, 'a.png', 'image/png') })).status).toBe(401)
    expect((await call('/api/admin/uploads', { cookie: rider.cookie, formData: form(png, 'a.png', 'image/png') })).status).toBe(403)
    const finance = await staffWithRole('FINANCE')
    expect((await call('/api/admin/uploads', { cookie: finance, formData: form(png, 'a.png', 'image/png') })).status).toBe(403)
  })
  it('does not serve arbitrary paths from storage', async () => {
    expect((await call('/media/private/passport.png')).status).toBe(404)
    // An encoded ../ survives URL normalisation and reaches the handler, so this is the real traversal attempt.
    expect((await call('/media/products/%2e%2e%2f%2e%2e%2fsecret.png')).status).toBe(404)
  })
  it('reports a storage failure clearly without leaking details', async () => {
    const broken = { put: async () => { throw new Error('R2 internal secret detail') }, get: async () => null } as unknown as R2Bucket
    const result = await call('/api/admin/uploads', { cookie: admin, formData: form(png, 'a.png', 'image/png'), env: testEnv({ BUCKET: broken }) })
    expect(result.status).toBe(503)
    expect(result.json.error.code).toBe('UPLOAD_FAILED')
    expect(result.text).not.toContain('secret detail')
  })
})

describe('search engine output', () => {
  it('publishes real pages and keeps private ones out of the sitemap', async () => {
    const sitemap = await call('/sitemap.xml')
    expect(sitemap.text).toContain('/shop')
    expect(sitemap.text).toContain('/products/security-apple')
    expect(sitemap.text).not.toMatch(/admin|rider|checkout|cart|order\//)
    const robots = await call('/robots.txt')
    expect(robots.text).toContain('Disallow: /admin')
    expect(robots.text).toContain('Sitemap:')
  })
  it('gives each page its own title, description, canonical and structured data', async () => {
    const page = await call('/products/security-apple')
    expect(page.status).toBe(200)
    expect(page.text).toContain('<title>Security Apple |')
    expect(page.text).toContain('rel="canonical" href="https://shop.test/products/security-apple"')
    expect(page.text).toContain('"@type":"Product"')
    expect(page.text).toContain('"priceCurrency":"INR"')
  })
  it('does not invent pages or location claims', async () => {
    expect((await call('/products/not-a-real-fruit')).status).toBe(404)
    expect((await call('/areas/gharuan')).status).toBe(404)
    // The business schema appears only from details the founders entered and confirmed.
    await env.DB.prepare("UPDATE business_settings SET value = 'false' WHERE key = 'SELLER_DETAILS_VERIFIED'").run()
    expect((await call('/')).text).not.toContain('LocalBusiness')
    await env.DB.prepare("UPDATE business_settings SET value = 'true' WHERE key = 'SELLER_DETAILS_VERIFIED'").run()
    const verified = await call('/')
    expect(verified.text).toContain('LocalBusiness')
    expect(verified.text).toContain('Sabzi Mandi, Kharar')
  })
  it('marks private pages noindex and the staging site fully private', async () => {
    expect((await call('/admin/orders')).text).toContain('noindex')
    expect((await call('/checkout')).text).toContain('noindex')
    const staging = testEnv({ ENVIRONMENT: 'staging' })
    expect((await call('/robots.txt', { env: staging })).text).toContain('Disallow: /')
    expect((await call('/shop', { env: staging })).headers.get('X-Robots-Tag')).toContain('noindex')
  })
  it('serves installable app definitions named after the brand', async () => {
    for (const [path, name, start] of [['/manifest.webmanifest', 'Ali Fruits', '/?source=app'], ['/admin.webmanifest', 'Ali Fruits Admin', '/admin'], ['/rider.webmanifest', 'Ali Fruits Rider', '/rider']] as const) {
      const result = await call(path)
      expect(result.status, path).toBe(200)
      expect(result.headers.get('Content-Type')).toContain('application/manifest+json')
      expect(result.json.name).toBe(name)
      expect(result.json.start_url).toBe(start)
      expect(result.json.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true)
    }
  })
  it('hands file requests to static assets rather than the page handler', async () => {
    const seen: string[] = []
    const assets = { fetch: async (request: Request) => { seen.push(new URL(request.url).pathname); return new Response('asset') } } as unknown as Fetcher
    const local = testEnv({ ASSETS: assets })
    for (const path of ['/src/client/main.tsx', '/@vite/client', '/some/file.js']) {
      expect((await call(path, { env: local })).text, path).toBe('asset')
    }
    expect(seen).toEqual(['/src/client/main.tsx', '/@vite/client', '/some/file.js'])
  })
  it('answers a missing file with 404, not the HTML page or a server error', async () => {
    expect((await call('/missing-file.png')).status).toBe(404)
  })
  it('describes the business for AI assistants using only real data', async () => {
    const result = await call('/llms.txt')
    expect(result.status).toBe(200)
    expect(result.text).toMatch(/^# Ali Fruits/)
    expect(result.text).toContain('/shop')
  })
  it('sends security headers', async () => {
    const result = await call('/shop', { env: testEnv({ ENVIRONMENT: 'production' }) })
    expect(result.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})
