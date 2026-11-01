import { Hono } from 'hono'
import { riderDelivered, riderFailed } from '../../shared/schemas'
import { requireRider } from '../lib/auth'
import { advanceDelivery, deliveryEvent, releaseDelivery, type DeliveryRow } from '../lib/delivery'
import { ApiError, nowIso, parseBody, type AppContext, type AppEnv } from '../lib/http'

export const riderRoutes = new Hono<AppEnv>()
riderRoutes.use('*', requireRider)

const OPEN = "('ASSIGNED','ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY')"

/** Every rider query filters on the signed-in rider, so another rider's delivery looks like it does not exist. */
async function ownDelivery(c: AppContext): Promise<DeliveryRow> {
  const delivery = await c.env.DB.prepare('SELECT * FROM deliveries WHERE id = ? AND rider_id = ?')
    .bind(c.req.param('id'), c.get('user').rider_id)
    .first<DeliveryRow>()
  if (!delivery) throw new ApiError(404, 'NOT_FOUND', 'Delivery not found.')
  return delivery
}

riderRoutes.get('/me', (c) => {
  const user = c.get('user')
  return c.json({ name: user.name })
})

riderRoutes.get('/deliveries', async (c) => {
  const db = c.env.DB
  const riderId = c.get('user').rider_id
  const [open, recent] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT d.id, d.status, d.batch_id, o.order_number, o.customer_name, o.customer_phone, o.address_line, o.locality, o.pin_code, o.landmark, o.instructions, o.slot_label
         FROM deliveries d JOIN orders o ON o.id = d.order_id
         WHERE d.rider_id = ? AND d.status IN ${OPEN} ORDER BY o.locality, d.created_at`,
      )
      .bind(riderId),
    // Finished deliveries keep the area only: a rider has no further need for a customer's phone or address.
    db
      .prepare(
        `SELECT d.id, d.status, d.updated_at, o.order_number, o.locality
         FROM deliveries d JOIN orders o ON o.id = d.order_id
         WHERE d.rider_id = ? AND d.status IN ('DELIVERED','FAILED') ORDER BY d.updated_at DESC LIMIT 50`,
      )
      .bind(riderId),
  ])
  c.header('Cache-Control', 'no-store')
  return c.json({ open: open!.results, recent: recent!.results })
})

riderRoutes.get('/deliveries/:id', async (c) => {
  const db = c.env.DB
  const delivery = await ownDelivery(c)
  const isOpen = ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(delivery.status)
  const [orders, items, payments] = await db.batch<Record<string, unknown>>([
    db
      .prepare('SELECT order_number, customer_name, customer_phone, address_line, locality, pin_code, landmark, instructions, slot_label, payment_method, payment_status, total_paise FROM orders WHERE id = ?')
      .bind(delivery.order_id),
    db.prepare("SELECT product_name, variant_label, confirmed_qty FROM order_items WHERE order_id = ? AND line_status IN ('CONFIRMED','ADDED')").bind(delivery.order_id),
    db
      .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS paid FROM payment_records WHERE order_id = ? AND kind = 'PAYMENT' AND status = 'VERIFIED'")
      .bind(delivery.order_id),
  ])
  const order = orders!.results[0] as {
    order_number: string
    customer_name: string
    customer_phone: string
    address_line: string
    locality: string
    pin_code: string
    landmark: string
    instructions: string
    slot_label: string
    payment_method: string | null
    payment_status: string
    total_paise: number
  }
  const paid = (payments!.results[0] as { paid: number }).paid
  c.header('Cache-Control', 'no-store')
  return c.json({
    id: delivery.id,
    status: delivery.status,
    otpRequired: Boolean(delivery.delivery_otp),
    orderNumber: order.order_number,
    locality: order.locality,
    pinCode: order.pin_code,
    slotLabel: order.slot_label,
    customer: isOpen
      ? { name: order.customer_name, phone: order.customer_phone, address: order.address_line, landmark: order.landmark, instructions: order.instructions }
      : null,
    packageItems: items!.results,
    // The only money a rider sees is the cash to collect. No prices, totals or costs.
    payment: { method: order.payment_method, cashToCollectPaise: order.payment_method === 'COD' ? Math.max(0, order.total_paise - paid) : 0 },
  })
})

riderRoutes.post('/deliveries/:id/accept', async (c) => {
  const db = c.env.DB
  const delivery = await ownDelivery(c)
  if (delivery.status !== 'ASSIGNED') throw new ApiError(409, 'INVALID_DELIVERY_STEP', 'This delivery has already been accepted.')
  await db.batch([
    db.prepare("UPDATE deliveries SET status = 'ACCEPTED', updated_at = ? WHERE id = ? AND status = 'ASSIGNED'").bind(nowIso(), delivery.id),
    deliveryEvent(db, delivery.id, 'ACCEPTED', '', c.get('user').id),
  ])
  return c.json({ ok: true })
})

riderRoutes.post('/deliveries/:id/decline', async (c) => {
  const delivery = await ownDelivery(c)
  await releaseDelivery(c, delivery, { kind: 'rider', userId: c.get('user').id }, 'Rider unavailable')
  return c.json({ ok: true })
})

const actor = (c: AppContext) => ({ kind: 'rider' as const, userId: c.get('user').id })

riderRoutes.post('/deliveries/:id/pickup', async (c) => {
  await advanceDelivery(c, await ownDelivery(c), 'PICKED_UP', { actor: actor(c), enforceOtp: true })
  return c.json({ ok: true })
})

riderRoutes.post('/deliveries/:id/out', async (c) => {
  await advanceDelivery(c, await ownDelivery(c), 'OUT_FOR_DELIVERY', { actor: actor(c), enforceOtp: true })
  return c.json({ ok: true })
})

riderRoutes.post('/deliveries/:id/delivered', async (c) => {
  const body = await parseBody(c, riderDelivered)
  await advanceDelivery(c, await ownDelivery(c), 'DELIVERED', { actor: actor(c), enforceOtp: true, otp: body.otp, codCollectedPaise: body.codCollectedPaise, note: body.note })
  return c.json({ ok: true })
})

riderRoutes.post('/deliveries/:id/failed', async (c) => {
  const body = await parseBody(c, riderFailed)
  await advanceDelivery(c, await ownDelivery(c), 'FAILED', { actor: actor(c), enforceOtp: true, note: body.reason })
  return c.json({ ok: true })
})
