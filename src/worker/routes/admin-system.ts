import { Hono } from 'hono'
import { customerUpdate, goLiveUpdate, settingsUpdate, staffCreate, staffUpdate, ticketUpdate, zoneInput } from '../../shared/schemas'
import { auditStatement } from '../lib/audit'
import { requirePermission, revokeUserSessions } from '../lib/auth'
import { hashPassword } from '../lib/crypto'
import { insert, isUniqueViolation, update } from '../lib/db'
import { ApiError, csvResponse, likeTerm, newId, nowIso, pageParams, parseBody, slugify, type AppEnv } from '../lib/http'
import { integrationStatus } from '../lib/notify'
import { EDITABLE_SETTING_KEYS, goLiveState, loadSettings } from '../lib/settings'

export const adminSystemRoutes = new Hono<AppEnv>()

// Customers

const CUSTOMER_STATS = `
  (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.order_type = 'ORDER') AS total_orders,
  (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.delivered_at IS NOT NULL) AS completed_orders,
  (SELECT COALESCE(SUM(o.total_paise), 0) FROM orders o WHERE o.customer_id = c.id AND o.delivered_at IS NOT NULL) AS total_spent_paise,
  (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.id) AS last_order_at`

adminSystemRoutes.get('/customers', requirePermission('customers.read'), async (c) => {
  const { page, pageSize, limit, offset } = pageParams(c)
  const q = c.req.query('q')?.trim()
  const clause = q ? "WHERE c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\'" : ''
  const params = q ? [likeTerm(q), likeTerm(q)] : []
  const db = c.env.DB
  const [rows, count] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT c.id, c.name, c.phone, c.email, c.is_blocked, c.created_at, ${CUSTOMER_STATS} FROM customers c ${clause} ORDER BY last_order_at DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM customers c ${clause}`).bind(...params),
  ])
  return c.json({ customers: rows!.results, total: (count!.results[0] as { total: number }).total, page, pageSize })
})

adminSystemRoutes.get('/customers/export', requirePermission('customers.export'), async (c) => {
  const db = c.env.DB
  const { results } = await db.prepare(`SELECT c.name, c.phone, c.email, c.is_blocked, c.created_at, ${CUSTOMER_STATS} FROM customers c ORDER BY c.created_at`).all<Record<string, unknown>>()
  await auditStatement(db, c.get('user'), 'EXPORT_CUSTOMERS', 'customer', '', { rows: results.length }).run()
  return csvResponse('customers.csv', results)
})

adminSystemRoutes.get('/customers/:id', requirePermission('customers.read'), async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const [customer, addresses, orders, repeats] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT c.*, ${CUSTOMER_STATS} FROM customers c WHERE c.id = ?`).bind(id),
    db.prepare('SELECT id, pin_code, locality, address_line, landmark, updated_at FROM customer_addresses WHERE customer_id = ? ORDER BY updated_at DESC').bind(id),
    db.prepare('SELECT id, order_number, status, order_type, total_paise, estimated_total_paise, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100').bind(id),
    db.prepare(
      `SELECT i.product_name, COUNT(*) AS times_ordered FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.customer_id = ? AND i.line_status IN ('CONFIRMED','ADDED','REQUESTED') GROUP BY i.product_id ORDER BY times_ordered DESC LIMIT 10`,
    ).bind(id),
  ])
  if (!customer!.results[0]) throw new ApiError(404, 'NOT_FOUND', 'Customer not found.')
  c.header('Cache-Control', 'no-store')
  return c.json({ customer: customer!.results[0], addresses: addresses!.results, orders: orders!.results, repeatedProducts: repeats!.results })
})

adminSystemRoutes.patch('/customers/:id', requirePermission('customers.write'), async (c) => {
  const db = c.env.DB
  const body = await parseBody(c, customerUpdate)
  const id = c.req.param('id')
  const set: Record<string, string | number> = { updated_at: nowIso() }
  if (body.isBlocked !== undefined) set.is_blocked = body.isBlocked ? 1 : 0
  if (body.internalNotes !== undefined) set.internal_notes = body.internalNotes
  await db.batch([update(db, 'customers', set, 'id = ?', id), auditStatement(db, c.get('user'), 'UPDATE_CUSTOMER', 'customer', id, { isBlocked: body.isBlocked })])
  return c.json({ ok: true })
})

// Staff

adminSystemRoutes.get('/staff', requirePermission('staff.manage'), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, email, phone, role, is_active, must_change_password, last_login_at, created_at FROM users WHERE role <> 'RIDER' ORDER BY is_active DESC, name").all()
  return c.json({ staff: results })
})

adminSystemRoutes.post('/staff', requirePermission('staff.manage'), async (c) => {
  const db = c.env.DB
  const body = await parseBody(c, staffCreate)
  if (body.role === 'RIDER') throw new ApiError(422, 'USE_RIDER_FORM', 'Add riders from the Riders page, so their delivery details are saved too.')
  const id = newId()
  const now = nowIso()
  try {
    await db.batch([
      insert(db, 'users', {
        id,
        name: body.name,
        email: body.email,
        phone: body.phone,
        role: body.role,
        password_hash: await hashPassword(body.temporaryPassword),
        must_change_password: 1,
        is_active: 1,
        created_at: now,
        updated_at: now,
      }),
      auditStatement(db, c.get('user'), 'CREATE_STAFF', 'user', id, { role: body.role }),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'EMAIL_TAKEN', 'An account with that email already exists.')
    throw error
  }
  return c.json({ id }, 201)
})

adminSystemRoutes.patch('/staff/:id', requirePermission('staff.manage'), async (c) => {
  const db = c.env.DB
  const actor = c.get('user')
  const body = await parseBody(c, staffUpdate)
  const id = c.req.param('id')
  const target = await db.prepare('SELECT id, name, phone, role, is_active FROM users WHERE id = ?').bind(id).first<{ id: string; name: string; phone: string; role: string; is_active: number }>()
  if (!target || target.role === 'RIDER') throw new ApiError(404, 'NOT_FOUND', 'Staff member not found.')
  if (body.role === 'RIDER') throw new ApiError(422, 'USE_RIDER_FORM', 'Add riders from the Riders page.')
  const losesSuperAdmin = target.role === 'SUPER_ADMIN' && ((body.role && body.role !== 'SUPER_ADMIN') || body.isActive === false)
  if (losesSuperAdmin) {
    const others = await db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'SUPER_ADMIN' AND is_active = 1 AND id <> ?").bind(id).first<{ total: number }>()
    if (!others?.total) throw new ApiError(409, 'LAST_SUPER_ADMIN', 'Add another super admin first, so the business is never locked out.')
  }
  const set: Record<string, string | number> = {
    name: body.name ?? target.name,
    phone: body.phone ?? target.phone,
    role: body.role ?? target.role,
    is_active: body.isActive === undefined ? target.is_active : body.isActive ? 1 : 0,
    updated_at: nowIso(),
  }
  if (body.temporaryPassword) {
    set.password_hash = await hashPassword(body.temporaryPassword)
    set.must_change_password = 1
  }
  const statements = [update(db, 'users', set, 'id = ?', id), auditStatement(db, actor, 'UPDATE_STAFF', 'user', id, { role: body.role, isActive: body.isActive, passwordReset: Boolean(body.temporaryPassword) })]
  if (body.isActive === false || body.temporaryPassword || body.role) statements.push(revokeUserSessions(db, id))
  await db.batch(statements)
  return c.json({ ok: true })
})

// Delivery zones

adminSystemRoutes.get('/zones', requirePermission('zones.manage', 'orders.write'), async (c) => {
  const db = c.env.DB
  const [zones, slots] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT * FROM delivery_zones ORDER BY is_active DESC, name'),
    db.prepare('SELECT * FROM delivery_slots ORDER BY sort_order'),
  ])
  const slotRows = slots!.results as Array<{ zone_id: string }>
  return c.json({ zones: (zones!.results as Array<{ id: string }>).map((zone) => ({ ...zone, slots: slotRows.filter((slot) => slot.zone_id === zone.id) })) })
})

function zoneFields(body: ReturnType<typeof zoneInput.parse>, slug: string) {
  return {
    name: body.name,
    slug,
    pin_codes: body.pinCodes.split(',').map((pin) => pin.trim()).join(','),
    min_order_paise: body.minOrderPaise,
    delivery_charge_paise: body.deliveryChargePaise,
    small_order_below_paise: body.smallOrderBelowPaise,
    small_order_charge_paise: body.smallOrderChargePaise,
    free_above_paise: body.freeAbovePaise,
    quote_only: body.quoteOnly ? 1 : 0,
    estimated_time: body.estimatedTime,
    own_rider_enabled: body.ownRiderEnabled ? 1 : 0,
    third_party_enabled: body.thirdPartyEnabled ? 1 : 0,
    publish_landing_page: body.publishLandingPage ? 1 : 0,
    landing_description: body.landingDescription,
    is_active: body.isActive ? 1 : 0,
    updated_at: nowIso(),
  }
}

function assertZoneUsable(body: ReturnType<typeof zoneInput.parse>) {
  if (body.isActive && !body.slots.some((slot) => slot.isActive)) throw new ApiError(422, 'SLOT_REQUIRED', 'An active zone needs at least one active delivery slot.')
  if (body.publishLandingPage && !body.isActive) throw new ApiError(422, 'LANDING_NEEDS_ACTIVE_ZONE', 'A location page can only be published for an area you actually deliver to.')
}

adminSystemRoutes.post('/zones', requirePermission('zones.manage'), async (c) => {
  const db = c.env.DB
  const body = await parseBody(c, zoneInput)
  assertZoneUsable(body)
  const id = newId()
  const now = nowIso()
  try {
    await db.batch([
      insert(db, 'delivery_zones', { id, created_at: now, ...zoneFields(body, body.slug || slugify(body.name)) }),
      ...body.slots.map((slot, index) => insert(db, 'delivery_slots', { id: newId(), zone_id: id, label: slot.label, sort_order: index, is_active: slot.isActive ? 1 : 0 })),
      auditStatement(db, c.get('user'), 'CREATE_ZONE', 'zone', id, { name: body.name }),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'ZONE_EXISTS', 'A zone with that web address already exists. Change the name.')
    throw error
  }
  return c.json({ id }, 201)
})

adminSystemRoutes.put('/zones/:id', requirePermission('zones.manage'), async (c) => {
  const db = c.env.DB
  const body = await parseBody(c, zoneInput)
  assertZoneUsable(body)
  const id = c.req.param('id')
  const zone = await db.prepare('SELECT id, slug FROM delivery_zones WHERE id = ?').bind(id).first<{ id: string; slug: string }>()
  if (!zone) throw new ApiError(404, 'NOT_FOUND', 'Zone not found.')
  const { results: oldSlots } = await db.prepare('SELECT id FROM delivery_slots WHERE zone_id = ?').bind(id).all<{ id: string }>()
  const kept = new Set(body.slots.map((slot) => slot.id).filter(Boolean))
  const statements = [update(db, 'delivery_zones', zoneFields(body, body.slug || zone.slug), 'id = ?', id)]
  body.slots.forEach((slot, index) => {
    statements.push(
      slot.id
        ? update(db, 'delivery_slots', { label: slot.label, sort_order: index, is_active: slot.isActive ? 1 : 0 }, 'id = ? AND zone_id = ?', slot.id, id)
        : insert(db, 'delivery_slots', { id: newId(), zone_id: id, label: slot.label, sort_order: index, is_active: slot.isActive ? 1 : 0 }),
    )
  })
  // Past orders reference old slots, so a removed slot is only hidden.
  for (const old of oldSlots) if (!kept.has(old.id)) statements.push(update(db, 'delivery_slots', { is_active: 0 }, 'id = ?', old.id))
  statements.push(auditStatement(db, c.get('user'), 'UPDATE_ZONE', 'zone', id, { name: body.name, isActive: body.isActive }))
  await db.batch(statements)
  return c.json({ ok: true })
})

// Business settings

adminSystemRoutes.get('/settings', requirePermission('settings.read'), async (c) => {
  const settings = await loadSettings(c.env.DB)
  return c.json({ settings, goLive: goLiveState(c.env, settings), integrations: integrationStatus() })
})

adminSystemRoutes.put('/settings', requirePermission('settings.write'), async (c) => {
  const db = c.env.DB
  const body = await parseBody(c, settingsUpdate)
  const entries = Object.entries(body.values)
  const refused = entries.find(([key]) => !EDITABLE_SETTING_KEYS.has(key))
  if (refused) throw new ApiError(422, 'UNKNOWN_SETTING', `"${refused[0]}" cannot be changed here.`)
  const now = nowIso()
  const user = c.get('user')
  await db.batch([
    ...entries.map(([key, value]) => update(db, 'business_settings', { value, updated_by: user.id, updated_at: now }, 'key = ?', key)),
    auditStatement(db, user, 'UPDATE_SETTINGS', 'settings', '', { keys: entries.map(([key]) => key) }),
  ])
  return c.json({ ok: true })
})

/**
 * Changes a go-live gate. This records the founders' own confirmation that a real-world check was done.
 * It is not itself regulatory approval, and the same gate must also be set true in the deployment.
 */
adminSystemRoutes.post('/settings/go-live', requirePermission('golive.manage'), async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const body = await parseBody(c, goLiveUpdate)
  const settings = await loadSettings(db)
  if (body.value) {
    if (!body.attestation) throw new ApiError(422, 'ATTESTATION_REQUIRED', 'Describe what was checked, and by whom.')
    if (body.key === 'SELLER_DETAILS_VERIFIED' && (!settings.legal_seller_name || !settings.business_address)) {
      throw new ApiError(422, 'DETAILS_MISSING', 'Enter the legal seller name and business address first.')
    }
    if (body.key === 'FSSAI_COVERAGE_VERIFIED' && (!settings.fssai_number || !settings.fssai_category || !settings.fssai_valid_until)) {
      throw new ApiError(422, 'DETAILS_MISSING', 'Enter the FSSAI number, category and validity date first.')
    }
    if (body.key === 'ONLINE_SALES_ENABLED' && (settings.SELLER_DETAILS_VERIFIED !== 'true' || settings.FSSAI_COVERAGE_VERIFIED !== 'true')) {
      throw new ApiError(409, 'CHECKS_INCOMPLETE', 'Confirm the seller details and FSSAI coverage before enabling online sales.')
    }
  }
  await db.batch([
    update(db, 'business_settings', { value: String(body.value), updated_by: user.id, updated_at: nowIso() }, 'key = ?', body.key),
    auditStatement(db, user, 'CHANGE_GO_LIVE_GATE', 'settings', body.key, { value: body.value, attestation: body.attestation ?? '' }),
  ])
  return c.json({ ok: true, goLive: goLiveState(c.env, await loadSettings(db)) })
})

// Audit log

adminSystemRoutes.get('/audit', requirePermission('audit.read'), async (c) => {
  const { page, pageSize, limit, offset } = pageParams(c, 50)
  const db = c.env.DB
  const [rows, count] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(limit, offset),
    db.prepare('SELECT COUNT(*) AS total FROM audit_logs'),
  ])
  return c.json({ logs: rows!.results, total: (count!.results[0] as { total: number }).total, page, pageSize })
})

// Dashboard notifications

adminSystemRoutes.get('/notifications', async (c) => {
  const db = c.env.DB
  const [rows, unread] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT n.id, n.event, n.body, n.order_id, n.read_at, n.created_at, o.order_number
         FROM notification_logs n LEFT JOIN orders o ON o.id = n.order_id
         WHERE n.audience = 'ADMIN' ORDER BY n.created_at DESC LIMIT 30`,
      ),
    db.prepare("SELECT COUNT(*) AS total FROM notification_logs WHERE audience = 'ADMIN' AND read_at IS NULL"),
  ])
  return c.json({ notifications: rows!.results, unread: (unread!.results[0] as { total: number }).total })
})

adminSystemRoutes.post('/notifications/read-all', async (c) => {
  await c.env.DB.prepare("UPDATE notification_logs SET read_at = ? WHERE audience = 'ADMIN' AND read_at IS NULL").bind(nowIso()).run()
  return c.json({ ok: true })
})

// Support tickets

adminSystemRoutes.get('/tickets', requirePermission('support.manage'), async (c) => {
  const { page, pageSize, limit, offset } = pageParams(c)
  const status = c.req.query('status')
  const db = c.env.DB
  const clause = status === 'open' ? "WHERE t.status IN ('OPEN','IN_PROGRESS')" : status ? 'WHERE t.status = ?' : ''
  const params = status && status !== 'open' ? [status] : []
  const [rows, count] = await db.batch<Record<string, unknown>>([
    db
      .prepare(`SELECT t.*, u.name AS resolved_by_name, o.id AS linked_order_id FROM support_tickets t LEFT JOIN users u ON u.id = t.resolved_by LEFT JOIN orders o ON o.id = t.order_id ${clause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM support_tickets t ${clause}`).bind(...params),
  ])
  return c.json({ tickets: rows!.results, total: (count!.results[0] as { total: number }).total, page, pageSize })
})

adminSystemRoutes.patch('/tickets/:id', requirePermission('support.manage'), async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const body = await parseBody(c, ticketUpdate)
  const id = c.req.param('id')
  const closing = body.status === 'RESOLVED' || body.status === 'CLOSED'
  await db.batch([
    update(db, 'support_tickets', { status: body.status, resolution: body.resolution, resolved_by: closing ? user.id : null, updated_at: nowIso() }, 'id = ?', id),
    auditStatement(db, user, 'UPDATE_TICKET', 'ticket', id, { status: body.status }),
  ])
  return c.json({ ok: true })
})
