import { applyD1Migrations } from 'cloudflare:test'
import { env as baseEnv } from 'cloudflare:workers'
import { app } from '../src/worker/app'

export const env = baseEnv as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }

const ORIGIN = 'https://shop.test'
const htmlShell = '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>'
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext

export function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, ASSETS: { fetch: async () => new Response(htmlShell, { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher, ...overrides }
}

type CallOptions = { method?: string; body?: unknown; cookie?: string; ip?: string; origin?: string | null; env?: Env; formData?: FormData }

export async function call(path: string, options: CallOptions = {}) {
  const headers = new Headers({
    Host: 'shop.test',
    // A different address per call, so rate limits only trigger in the tests aimed at them.
    'CF-Connecting-IP': options.ip ?? `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
  })
  if (options.origin !== null) headers.set('Origin', options.origin ?? ORIGIN)
  if (options.cookie) headers.set('Cookie', options.cookie)
  let body: BodyInit | undefined
  if (options.formData) body = options.formData
  else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.body)
  }
  const method = options.method ?? (body ? 'POST' : 'GET')
  const response = await app.fetch(new Request(`${ORIGIN}${path}`, { method, headers, body }), options.env ?? testEnv(), ctx)
  const text = await response.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: response.status, json, text, headers: response.headers }
}

export async function ok(path: string, options: CallOptions = {}) {
  const result = await call(path, options)
  if (result.status >= 400) throw new Error(`${options.method ?? 'POST/GET'} ${path} failed with ${result.status}: ${result.text}`)
  return result.json
}

export async function login(email: string, password: string): Promise<string> {
  const result = await call('/api/auth/login', { body: { email, password } })
  if (result.status !== 200) throw new Error(`Login failed: ${result.text}`)
  return result.headers.get('Set-Cookie')!.split(';')[0]!
}

export const ADMIN_EMAIL = 'owner@example.test'
export const ADMIN_PASSWORD = 'correct-horse-battery'

export async function setupDatabase() {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  await ok('/api/auth/bootstrap', { body: { token: 'test-bootstrap-token', name: 'Owner', email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })
  return login(ADMIN_EMAIL, ADMIN_PASSWORD)
}

export async function enableLiveOrders() {
  await env.DB.prepare("UPDATE business_settings SET value = 'true' WHERE key IN ('SELLER_DETAILS_VERIFIED','FSSAI_COVERAGE_VERIFIED','ONLINE_SALES_ENABLED')").run()
  await env.DB.prepare("UPDATE business_settings SET value = 'Test Seller' WHERE key = 'legal_seller_name'").run()
}

export async function createZone(admin: string, overrides: Record<string, unknown> = {}) {
  const { id } = await ok('/api/admin/system/zones', {
    cookie: admin,
    body: {
      name: `Test zone ${crypto.randomUUID().slice(0, 6)}`,
      pinCodes: '140301',
      deliveryChargePaise: 2500,
      smallOrderBelowPaise: 19900,
      smallOrderChargePaise: 3000,
      freeAbovePaise: 99900,
      isActive: true,
      ownRiderEnabled: true,
      thirdPartyEnabled: true,
      slots: [{ label: 'Evening', isActive: true }],
      ...overrides,
    },
  })
  const { zones } = await ok('/api/public/zones')
  const zone = zones.find((z: { id: string }) => z.id === id)
  return { id, slotId: zone.slots[0].id as string }
}

export async function createProduct(admin: string, name: string, retail: number, wholesale = Math.round(retail * 0.7), availability = 'AVAILABLE') {
  const { id } = await ok('/api/admin/catalog/products', {
    cookie: admin,
    body: {
      name,
      categoryId: 'cat-other',
      availability,
      variants: [{ label: '1 kg', unitKind: 'WEIGHT', unitSize: 1000, retailPricePaise: retail, wholesalePricePaise: wholesale }],
    },
  })
  const row = await env.DB.prepare('SELECT id FROM product_variants WHERE product_id = ?').bind(id).first<{ id: string }>()
  return { productId: id as string, variantId: row!.id }
}

let phoneCounter = 0
export function nextPhone() {
  phoneCounter += 1
  return `98${String(Date.now() % 100000000 + phoneCounter).padStart(8, '0').slice(-8)}`
}

export function checkout(zone: { id: string; slotId: string }, items: Array<{ variantId: string; qty: number; expectedUnitPaise?: number }>, overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: crypto.randomUUID(),
    items,
    name: 'Test Customer',
    phone: nextPhone(),
    email: '',
    pinCode: '140301',
    zoneId: zone.id,
    slotId: zone.slotId,
    addressLine: 'Room 12, Test PG, Sunny Enclave',
    landmark: 'Near the gate',
    instructions: 'Call on arrival',
    paymentPreference: 'COD',
    termsAccepted: true,
    ...overrides,
  }
}

export async function createRider(admin: string) {
  const email = `rider-${crypto.randomUUID().slice(0, 8)}@example.test`
  const { id } = await ok('/api/admin/deliveries/riders', {
    cookie: admin,
    body: { name: 'Test Rider', email, phone: '9876543210', vehicleType: 'Scooter', compensationType: 'PER_DELIVERY', compensationAmountPaise: 2000, temporaryPassword: 'temporary-password-1' },
  })
  const first = await login(email, 'temporary-password-1')
  await ok('/api/auth/change-password', { cookie: first, body: { currentPassword: 'temporary-password-1', newPassword: 'rider-password-22' } })
  return { riderId: id as string, email, cookie: await login(email, 'rider-password-22') }
}

/** Takes a fresh order all the way to ready-for-pickup, using the same API calls staff use. */
export async function orderReadyForPickup(admin: string, zone: { id: string; slotId: string }, variant: { variantId: string }, retail: number, costPaise = 10000) {
  const placed = await ok('/api/public/orders', { body: checkout(zone, [{ variantId: variant.variantId, qty: 1 }]) })
  const order = await env.DB.prepare('SELECT id FROM orders WHERE order_number = ?').bind(placed.orderNumber).first<{ id: string }>()
  const orderId = order!.id
  const item = await env.DB.prepare('SELECT id FROM order_items WHERE order_id = ?').bind(orderId).first<{ id: string }>()
  await ok(`/api/admin/orders/${orderId}/revisions`, {
    cookie: admin,
    body: { reason: 'Checked at the shop', deliveryFeePaise: 2500, items: [{ itemId: item!.id, qty: 1, unitPricePaise: retail }] },
  })
  await ok(`/api/public/track/${placed.trackingToken}/respond`, { body: { action: 'ACCEPT_ORDER', revision: 1, paymentMethod: 'COD' } })
  await ok(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'PROCUREMENT_IN_PROGRESS' } })
  await ok(`/api/admin/procurement/orders/${orderId}/records`, {
    cookie: admin,
    body: { orderItemId: item!.id, supplierId: 'sup-default', purchasedQuantity: 1000, unit: 'g', totalCostPaise: costPaise },
  })
  for (const to of ['PROCUREMENT_COMPLETED', 'PACKING', 'READY_FOR_PICKUP']) {
    await ok(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to } })
  }
  return { orderId, token: placed.trackingToken as string, orderNumber: placed.orderNumber as string, itemId: item!.id }
}
