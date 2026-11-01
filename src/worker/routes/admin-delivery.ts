import { Hono } from 'hono'
import { allocateCost } from '../../shared/pricing'
import { assignRider, batchCreate, manualDeliveryUpdate, riderCreate, riderUpdate, thirdPartyBooking } from '../../shared/schemas'
import { istDate } from '../../shared/time'
import { auditStatement } from '../lib/audit'
import { requirePermission, revokeUserSessions } from '../lib/auth'
import { hashPassword, randomOtp } from '../lib/crypto'
import { insert, isUniqueViolation, update } from '../lib/db'
import { advanceDelivery, deliveryEvent, releaseDelivery, type DeliveryRow } from '../lib/delivery'
import { ApiError, newId, nowIso, pageParams, parseBody, siteUrl, type AppContext, type AppEnv } from '../lib/http'
import { notifyStatement } from '../lib/notify'
import { runTransitionBatch, transitionStatements, type OrderRow } from '../lib/orders'
import { loadSettings } from '../lib/settings'

export const adminDeliveryRoutes = new Hono<AppEnv>()

// Riders

adminDeliveryRoutes.get('/riders', requirePermission('riders.manage', 'costs.read'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, u.name, u.email, u.is_active, u.last_login_at,
       (SELECT COUNT(*) FROM deliveries d WHERE d.rider_id = r.id AND d.status IN ('ASSIGNED','ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY')) AS open_deliveries,
       (SELECT COUNT(*) FROM deliveries d WHERE d.rider_id = r.id AND d.status = 'DELIVERED') AS completed_deliveries
     FROM riders r JOIN users u ON u.id = r.user_id ORDER BY u.is_active DESC, u.name`,
  ).all()
  return c.json({ riders: results })
})

adminDeliveryRoutes.post('/riders', requirePermission('riders.manage'), async (c) => {
  const db = c.env.DB
  const body = await parseBody(c, riderCreate)
  const now = nowIso()
  const userId = newId()
  const riderId = newId()
  try {
    await db.batch([
      insert(db, 'users', {
        id: userId,
        name: body.name,
        email: body.email,
        phone: body.phone,
        role: 'RIDER',
        password_hash: await hashPassword(body.temporaryPassword),
        must_change_password: 1,
        is_active: 1,
        created_at: now,
        updated_at: now,
      }),
      insert(db, 'riders', {
        id: riderId,
        user_id: userId,
        phone: body.phone,
        vehicle_type: body.vehicleType,
        compensation_type: body.compensationType,
        compensation_amount_paise: body.compensationAmountPaise,
        notes: body.notes,
        created_at: now,
        updated_at: now,
      }),
      auditStatement(db, c.get('user'), 'CREATE_RIDER', 'rider', riderId, { name: body.name }),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'EMAIL_TAKEN', 'An account with that email already exists.')
    throw error
  }
  return c.json({ id: riderId }, 201)
})

adminDeliveryRoutes.patch('/riders/:id', requirePermission('riders.manage'), async (c) => {
  const db = c.env.DB
  const body = await parseBody(c, riderUpdate)
  const rider = await db.prepare('SELECT id, user_id, phone, vehicle_type, compensation_type, compensation_amount_paise, notes FROM riders WHERE id = ?').bind(c.req.param('id')).first<{
    id: string
    user_id: string
    phone: string
    vehicle_type: string
    compensation_type: string
    compensation_amount_paise: number
    notes: string
  }>()
  if (!rider) throw new ApiError(404, 'NOT_FOUND', 'Rider not found.')
  const now = nowIso()
  const statements = [
    update(db, 'riders', {
      phone: body.phone ?? rider.phone,
      vehicle_type: body.vehicleType ?? rider.vehicle_type,
      compensation_type: body.compensationType ?? rider.compensation_type,
      compensation_amount_paise: body.compensationAmountPaise ?? rider.compensation_amount_paise,
      notes: body.notes ?? rider.notes,
      updated_at: now,
    }, 'id = ?', rider.id),
    auditStatement(db, c.get('user'), 'UPDATE_RIDER', 'rider', rider.id, { isActive: body.isActive }),
  ]
  if (body.isActive !== undefined) {
    statements.push(update(db, 'users', { is_active: body.isActive ? 1 : 0, updated_at: now }, 'id = ?', rider.user_id))
    if (!body.isActive) statements.push(revokeUserSessions(db, rider.user_id))
  }
  await db.batch(statements)
  return c.json({ ok: true })
})

// Delivery board

/** Orders ready to send, with the zone and slot used to group them into shared trips. */
adminDeliveryRoutes.get('/ready', requirePermission('deliveries.manage'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.order_number, o.customer_name, o.locality, o.slot_label, o.address_line, o.landmark, o.payment_method, o.total_paise, o.created_at,
            z.own_rider_enabled, z.third_party_enabled
     FROM orders o JOIN delivery_zones z ON z.id = o.zone_id
     WHERE o.status = 'READY_FOR_PICKUP' ORDER BY o.locality, o.slot_label, o.created_at`,
  ).all()
  return c.json({ orders: results })
})

adminDeliveryRoutes.get('/', requirePermission('deliveries.manage'), async (c) => {
  const { page, pageSize, limit, offset } = pageParams(c)
  const status = c.req.query('status')
  const db = c.env.DB
  const clause = status === 'open' ? "WHERE d.status IN ('ASSIGNED','ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY')" : status ? 'WHERE d.status = ?' : ''
  const params = status && status !== 'open' ? [status] : []
  const [rows, count] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT d.id, d.order_id, d.batch_id, d.mode, d.status, d.provider, d.booking_reference, d.booking_date, d.tracking_url, d.actual_cost_paise, d.failure_reason, d.notes, d.created_at, d.updated_at,
                o.order_number, o.locality, o.slot_label, o.customer_name, u.name AS rider_name, b.name AS batch_name
         FROM deliveries d JOIN orders o ON o.id = d.order_id
         LEFT JOIN riders r ON r.id = d.rider_id LEFT JOIN users u ON u.id = r.user_id LEFT JOIN delivery_batches b ON b.id = d.batch_id
         ${clause} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM deliveries d ${clause}`).bind(...params),
  ])
  return c.json({ deliveries: rows!.results, total: (count!.results[0] as { total: number }).total, page, pageSize })
})

async function loadActiveRider(db: D1Database, riderId: string) {
  const rider = await db
    .prepare('SELECT r.id, r.compensation_type, r.compensation_amount_paise, u.is_active, u.name FROM riders r JOIN users u ON u.id = r.user_id WHERE r.id = ?')
    .bind(riderId)
    .first<{ id: string; compensation_type: string; compensation_amount_paise: number; is_active: number; name: string }>()
  if (!rider || !rider.is_active) throw new ApiError(422, 'RIDER_UNAVAILABLE', 'That rider is not active. Choose another rider.')
  return rider
}

async function loadReadyOrder(db: D1Database, orderId: string): Promise<OrderRow & { own_rider_enabled: number; third_party_enabled: number }> {
  const order = await db
    .prepare('SELECT o.*, z.own_rider_enabled, z.third_party_enabled FROM orders o JOIN delivery_zones z ON z.id = o.zone_id WHERE o.id = ?')
    .bind(orderId)
    .first<OrderRow & { own_rider_enabled: number; third_party_enabled: number }>()
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found.')
  if (order.status !== 'READY_FOR_PICKUP') throw new ApiError(409, 'ORDER_NOT_READY', `Order ${order.order_number} is not ready for pickup.`)
  return order
}

async function deliveryContext(c: AppContext) {
  const settings = await loadSettings(c.env.DB)
  return { db: c.env.DB, brand: settings.brand_name ?? '', baseUrl: siteUrl(c), otpEnabled: settings.delivery_otp_enabled === 'true' }
}

function assignmentStatements(
  c: AppContext,
  ctx: Awaited<ReturnType<typeof deliveryContext>>,
  order: OrderRow,
  fields: { mode: 'OWN_RIDER' | 'THIRD_PARTY'; riderId?: string; batchId?: string; costPaise: number; provider?: string; bookingReference?: string; bookingDate?: string; trackingUrl?: string; notes?: string },
) {
  const db = c.env.DB
  const user = c.get('user')
  const id = newId()
  const now = nowIso()
  const reason = fields.mode === 'THIRD_PARTY' ? `Booked with ${fields.provider}` : 'Assigned to rider'
  return {
    id,
    statements: [
      insert(db, 'deliveries', {
        id,
        order_id: order.id,
        batch_id: fields.batchId ?? null,
        mode: fields.mode,
        rider_id: fields.riderId ?? null,
        provider: fields.provider ?? '',
        booking_reference: fields.bookingReference ?? '',
        booking_date: fields.bookingDate ?? null,
        tracking_url: fields.trackingUrl ?? '',
        status: 'ASSIGNED',
        actual_cost_paise: fields.costPaise,
        delivery_otp: ctx.otpEnabled && fields.mode === 'OWN_RIDER' ? randomOtp() : null,
        notes: fields.notes ?? '',
        created_at: now,
        updated_at: now,
      }),
      deliveryEvent(db, id, 'ASSIGNED', reason, user.id),
      ...transitionStatements(db, order, 'ASSIGNED_TO_RIDER', { kind: 'staff', userId: user.id }, reason),
    ],
  }
}

adminDeliveryRoutes.post('/assign', requirePermission('deliveries.manage'), async (c) => {
  const db = c.env.DB
  const body = await parseBody(c, assignRider)
  const order = await loadReadyOrder(db, body.orderId)
  if (!order.own_rider_enabled) throw new ApiError(409, 'OWN_RIDER_DISABLED', `Own riders are turned off for ${order.locality}. Book a third-party delivery instead.`)
  const rider = await loadActiveRider(db, body.riderId)
  const ctx = await deliveryContext(c)
  const cost = body.costPaise ?? (rider.compensation_type === 'PER_DELIVERY' ? rider.compensation_amount_paise : 0)
  const { statements } = assignmentStatements(c, ctx, order, { mode: 'OWN_RIDER', riderId: rider.id, costPaise: cost })
  statements.push(notifyStatement(ctx, 'RIDER_ASSIGNED', order, { riderId: rider.id }), auditStatement(db, c.get('user'), 'ASSIGN_RIDER', 'order', order.id, { riderId: rider.id }))
  try {
    await runTransitionBatch(db, statements, 3)
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'ALREADY_ASSIGNED', 'This order already has an open delivery.')
    throw error
  }
  return c.json({ ok: true }, 201)
})

/** One trip for several orders, with its single cost split across them. */
adminDeliveryRoutes.post('/batches', requirePermission('deliveries.manage'), async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const body = await parseBody(c, batchCreate)
  const orderIds = [...new Set(body.orderIds)]
  const rider = await loadActiveRider(db, body.riderId)
  const orders = await Promise.all(orderIds.map((id) => loadReadyOrder(db, id)))
  const blocked = orders.find((order) => !order.own_rider_enabled)
  if (blocked) throw new ApiError(409, 'OWN_RIDER_DISABLED', `Own riders are turned off for ${blocked.locality}.`)
  const ctx = await deliveryContext(c)
  const shares = allocateCost(body.totalCostPaise, orders.length)
  const batchId = newId()
  const now = nowIso()
  const statements: D1PreparedStatement[] = [
    insert(db, 'delivery_batches', {
      id: batchId,
      name: body.name,
      locality: body.locality,
      slot_label: body.slotLabel,
      rider_id: rider.id,
      total_cost_paise: body.totalCostPaise,
      created_by: user.id,
      created_at: now,
      updated_at: now,
    }),
  ]
  const transitionIndexes: number[] = []
  orders.forEach((order, index) => {
    const built = assignmentStatements(c, ctx, order, { mode: 'OWN_RIDER', riderId: rider.id, batchId, costPaise: shares[index]! })
    transitionIndexes.push(statements.length + 3)
    statements.push(...built.statements, notifyStatement(ctx, 'RIDER_ASSIGNED', order, { riderId: rider.id }))
  })
  statements.push(auditStatement(db, user, 'CREATE_BATCH', 'batch', batchId, { orders: orders.length, totalCostPaise: body.totalCostPaise }))
  let results: D1Result[]
  try {
    results = await db.batch(statements)
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'ALREADY_ASSIGNED', 'One of these orders already has an open delivery.')
    throw error
  }
  if (transitionIndexes.some((index) => !results[index]?.meta.changes)) {
    throw new ApiError(409, 'ORDER_CHANGED', 'One of these orders just changed. Refresh and check the batch.')
  }
  return c.json({ id: batchId }, 201)
})

adminDeliveryRoutes.get('/batches', requirePermission('deliveries.manage', 'costs.read'), async (c) => {
  const { limit, offset } = pageParams(c)
  const { results } = await c.env.DB.prepare(
    `SELECT b.*, u.name AS rider_name, COUNT(CASE WHEN d.status <> 'CANCELLED' THEN 1 END) AS order_count,
            COUNT(CASE WHEN d.status = 'DELIVERED' THEN 1 END) AS delivered_count
     FROM delivery_batches b JOIN riders r ON r.id = b.rider_id JOIN users u ON u.id = r.user_id LEFT JOIN deliveries d ON d.batch_id = b.id
     GROUP BY b.id ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all()
  return c.json({ batches: results })
})

/** Records a booking made by hand in the provider's own app. There is no provider API integration. */
adminDeliveryRoutes.post('/third-party', requirePermission('deliveries.manage'), async (c) => {
  const db = c.env.DB
  const body = await parseBody(c, thirdPartyBooking)
  const order = await loadReadyOrder(db, body.orderId)
  if (!order.third_party_enabled) throw new ApiError(409, 'THIRD_PARTY_DISABLED', `Third-party delivery is turned off for ${order.locality}. Change this under Delivery zones if it is available there.`)
  const ctx = await deliveryContext(c)
  const { statements } = assignmentStatements(c, ctx, order, {
    mode: 'THIRD_PARTY',
    costPaise: body.actualFeePaise,
    provider: body.provider,
    bookingReference: body.bookingReference,
    bookingDate: body.bookingDate ?? istDate(),
    trackingUrl: body.trackingUrl,
    notes: body.notes,
  })
  statements.push(auditStatement(db, c.get('user'), 'BOOK_THIRD_PARTY', 'order', order.id, { provider: body.provider, feePaise: body.actualFeePaise }))
  try {
    await runTransitionBatch(db, statements, 3)
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'ALREADY_ASSIGNED', 'This order already has an open delivery.')
    throw error
  }
  return c.json({ ok: true }, 201)
})

async function loadDelivery(db: D1Database, id: string): Promise<DeliveryRow> {
  const delivery = await db.prepare('SELECT * FROM deliveries WHERE id = ?').bind(id).first<DeliveryRow>()
  if (!delivery) throw new ApiError(404, 'NOT_FOUND', 'Delivery not found.')
  return delivery
}

/** Lets a manager update a third-party booking, or step in when a rider cannot use the app. */
adminDeliveryRoutes.post('/:id/status', requirePermission('deliveries.manage'), async (c) => {
  const body = await parseBody(c, manualDeliveryUpdate)
  const delivery = await loadDelivery(c.env.DB, c.req.param('id'))
  await advanceDelivery(c, delivery, body.status, {
    actor: { kind: 'staff', userId: c.get('user').id },
    note: body.note,
    enforceOtp: false,
    actualCostPaise: body.actualCostPaise,
    codCollectedPaise: body.codCollectedPaise,
  })
  return c.json({ ok: true })
})

adminDeliveryRoutes.post('/:id/unassign', requirePermission('deliveries.manage'), async (c) => {
  const delivery = await loadDelivery(c.env.DB, c.req.param('id'))
  await releaseDelivery(c, delivery, { kind: 'staff', userId: c.get('user').id }, 'Unassigned by delivery manager')
  return c.json({ ok: true })
})

adminDeliveryRoutes.get('/:id/events', requirePermission('deliveries.manage'), async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT e.*, u.name AS changed_by_name FROM delivery_events e LEFT JOIN users u ON u.id = e.changed_by_user_id WHERE e.delivery_id = ? ORDER BY e.created_at',
  )
    .bind(c.req.param('id'))
    .all()
  return c.json({ events: results })
})
