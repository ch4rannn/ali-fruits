import { Hono } from 'hono'
import { CUSTOMER_CANCELLABLE, CUSTOMER_STATUS_LABELS, type OrderStatus } from '../../shared/order-state'
import { checkoutRequest, customerResponse, orderLookup, paymentReference, quoteRequest, ticketRequest } from '../../shared/schemas'
import { istDate } from '../../shared/time'
import { randomCode, randomToken } from '../lib/crypto'
import { insert, insertIfOrderStatus, isUniqueViolation, update } from '../lib/db'
import { ApiError, newId, nowIso, parseBody, siteUrl, type AppContext, type AppEnv } from '../lib/http'
import { notifyStatement, type NotifyContext } from '../lib/notify'
import { getOrderByToken, runTransitionBatch, transitionStatements, type OrderRow } from '../lib/orders'
import { buildQuote, type ZoneRow } from '../lib/quote'
import { rateLimit } from '../lib/rate-limit'
import { goLiveState, loadSettings, PAGE_KEYS, publicConfig } from '../lib/settings'

export const publicRoutes = new Hono<AppEnv>()

const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300'

/** Column list for public catalogue queries. Wholesale price is deliberately absent. */
const PUBLIC_VARIANT_COLUMNS = 'id, product_id, label, unit_kind, unit_size, retail_price_paise, min_qty, qty_step, sort_order'

type PublicProduct = {
  id: string
  category_id: string
  name: string
  slug: string
  description: string
  availability: string
  is_featured: number
  is_seasonal: number
  is_combo: number
  display_priority: number
}
type PublicVariant = { id: string; product_id: string; label: string; unit_kind: string; unit_size: number; retail_price_paise: number; min_qty: number; qty_step: number }
type PublicImage = { product_id: string; object_key: string; alt: string }

function shapeProduct(product: PublicProduct, variants: PublicVariant[], images: PublicImage[], categorySlug?: string) {
  return {
    id: product.id,
    categoryId: product.category_id,
    categorySlug,
    name: product.name,
    slug: product.slug,
    description: product.description,
    availability: product.availability,
    isFeatured: Boolean(product.is_featured),
    isSeasonal: Boolean(product.is_seasonal),
    isCombo: Boolean(product.is_combo),
    displayPriority: product.display_priority,
    variants: variants.map((v) => ({
      id: v.id,
      label: v.label,
      unitKind: v.unit_kind,
      unitSize: v.unit_size,
      pricePaise: v.retail_price_paise,
      minQty: v.min_qty,
      qtyStep: v.qty_step,
    })),
    images: images.map((image) => ({ key: image.object_key, alt: image.alt })),
  }
}

export async function loadCatalog(db: D1Database) {
  const [categories, products, variants, images] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT id, name, slug, description, image_key, sort_order FROM product_categories WHERE is_active = 1 ORDER BY sort_order, name'),
    db.prepare(
      `SELECT p.id, p.category_id, p.name, p.slug, p.description, p.availability, p.is_featured, p.is_seasonal, p.is_combo, p.display_priority
       FROM products p JOIN product_categories c ON c.id = p.category_id
       WHERE p.is_active = 1 AND c.is_active = 1 ORDER BY p.display_priority DESC, p.name`,
    ),
    db.prepare(`SELECT ${PUBLIC_VARIANT_COLUMNS} FROM product_variants WHERE is_active = 1 ORDER BY sort_order, retail_price_paise`),
    db.prepare('SELECT product_id, object_key, alt FROM product_images ORDER BY sort_order'),
  ])
  const categoryRows = categories!.results as Array<{ id: string; name: string; slug: string; description: string; image_key: string | null }>
  const slugById = new Map(categoryRows.map((category) => [category.id, category.slug]))
  const groupBy = <T extends { product_id: string }>(rows: T[]) => {
    const map = new Map<string, T[]>()
    for (const row of rows) map.set(row.product_id, [...(map.get(row.product_id) ?? []), row])
    return map
  }
  const variantMap = groupBy(variants!.results as unknown as PublicVariant[])
  const imageMap = groupBy(images!.results as unknown as PublicImage[])
  return {
    categories: categoryRows.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      imageKey: category.image_key,
    })),
    products: (products!.results as unknown as PublicProduct[])
      .filter((product) => variantMap.has(product.id))
      .map((product) => shapeProduct(product, variantMap.get(product.id) ?? [], imageMap.get(product.id) ?? [], slugById.get(product.category_id))),
  }
}

export async function loadActiveZones(db: D1Database) {
  const [zones, slots] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT * FROM delivery_zones WHERE is_active = 1 ORDER BY name'),
    db.prepare('SELECT id, zone_id, label FROM delivery_slots WHERE is_active = 1 ORDER BY sort_order'),
  ])
  const slotRows = slots!.results as Array<{ id: string; zone_id: string; label: string }>
  return (zones!.results as unknown as Array<ZoneRow & { publish_landing_page: number; landing_description: string }>).map((zone) => ({
    id: zone.id,
    name: zone.name,
    slug: zone.slug,
    pinCodes: zone.pin_codes.split(',').map((pin) => pin.trim()),
    minOrderPaise: zone.min_order_paise,
    deliveryChargePaise: zone.delivery_charge_paise,
    smallOrderBelowPaise: zone.small_order_below_paise,
    smallOrderChargePaise: zone.small_order_charge_paise,
    freeAbovePaise: zone.free_above_paise,
    quoteOnly: Boolean(zone.quote_only),
    estimatedTime: zone.estimated_time,
    hasLandingPage: Boolean(zone.publish_landing_page),
    landingDescription: zone.landing_description,
    slots: slotRows.filter((slot) => slot.zone_id === zone.id).map((slot) => ({ id: slot.id, label: slot.label })),
  }))
}

async function notifyCtx(c: AppContext): Promise<NotifyContext> {
  const settings = await loadSettings(c.env.DB)
  return { db: c.env.DB, brand: settings.brand_name ?? '', baseUrl: siteUrl(c) }
}

publicRoutes.get('/config', async (c) => {
  const settings = await loadSettings(c.env.DB)
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(publicConfig(c.env, settings))
})

publicRoutes.get('/catalog', async (c) => {
  c.header('Cache-Control', PUBLIC_CACHE)
  return c.json(await loadCatalog(c.env.DB))
})

publicRoutes.get('/zones', async (c) => {
  c.header('Cache-Control', PUBLIC_CACHE)
  return c.json({ zones: await loadActiveZones(c.env.DB) })
})

publicRoutes.get('/pages/:slug', async (c) => {
  const key = PAGE_KEYS[c.req.param('slug')]
  if (!key) throw new ApiError(404, 'NOT_FOUND', 'Page not found.')
  const settings = await loadSettings(c.env.DB)
  c.header('Cache-Control', 'public, max-age=300')
  return c.json({ content: settings[key] ?? '' })
})

publicRoutes.post('/quote', async (c) => {
  const body = await parseBody(c, quoteRequest)
  return c.json(await buildQuote(c.env.DB, body.items, body.zoneId))
})

publicRoutes.post('/orders', async (c) => {
  const body = await parseBody(c, checkoutRequest)
  await rateLimit(c, 'order-create', 15, 600)
  const db = c.env.DB

  // A retried submission returns the original order instead of creating a duplicate.
  const replay = await db
    .prepare('SELECT order_number, tracking_token, customer_phone, status, order_type FROM orders WHERE idempotency_key = ?')
    .bind(body.idempotencyKey)
    .first<Pick<OrderRow, 'order_number' | 'tracking_token' | 'customer_phone' | 'status' | 'order_type'>>()
  if (replay) {
    if (replay.customer_phone !== body.phone) throw new ApiError(409, 'DUPLICATE_KEY', 'Please refresh the page and submit again.')
    return c.json({ orderNumber: replay.order_number, trackingToken: replay.tracking_token, status: replay.status, orderType: replay.order_type, duplicate: true })
  }

  const blocked = await db.prepare('SELECT is_blocked FROM customers WHERE phone = ?').bind(body.phone).first<{ is_blocked: number }>()
  if (blocked?.is_blocked) throw new ApiError(403, 'ORDER_NOT_ALLOWED', 'We cannot take this order online. Please contact us directly.')

  const zone = await db.prepare('SELECT * FROM delivery_zones WHERE id = ? AND is_active = 1').bind(body.zoneId).first<ZoneRow>()
  if (!zone) throw new ApiError(422, 'ZONE_UNAVAILABLE', 'We do not deliver to this area yet.')
  if (!zone.pin_codes.split(',').map((pin) => pin.trim()).includes(body.pinCode)) {
    throw new ApiError(422, 'PIN_NOT_SERVICED', `PIN code ${body.pinCode} is not part of ${zone.name}. Check the PIN code or choose another area.`)
  }
  const slot = await db.prepare('SELECT id, label FROM delivery_slots WHERE id = ? AND zone_id = ? AND is_active = 1').bind(body.slotId, body.zoneId).first<{ id: string; label: string }>()
  if (!slot) throw new ApiError(422, 'SLOT_UNAVAILABLE', 'That delivery slot is no longer offered. Please choose another.')

  const quote = await buildQuote(db, body.items, body.zoneId)
  if (quote.hasIssues) throw new ApiError(422, 'CART_INVALID', 'Some items in your cart need attention.', quote)
  if (quote.belowMinimum) throw new ApiError(422, 'BELOW_MINIMUM', 'This order is below the minimum for your area.', quote)
  const totalChanged = body.acceptedTotalPaise !== undefined && body.acceptedTotalPaise !== quote.totalPaise
  if (quote.hasPriceChanges || totalChanged) {
    throw new ApiError(409, 'PRICE_CHANGED', 'Prices have changed since you added these items. Please review the new total.', quote)
  }

  const settings = await loadSettings(db)
  const orderType = goLiveState(c.env, settings).live ? 'ORDER' : 'ENQUIRY'
  const now = nowIso()
  const customer = await db
    .prepare(
      `INSERT INTO customers (id, name, phone, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET name = excluded.name, email = CASE WHEN excluded.email <> '' THEN excluded.email ELSE customers.email END, updated_at = excluded.updated_at
       RETURNING id`,
    )
    .bind(newId(), body.name, body.phone, body.email, now, now)
    .first<{ id: string }>()

  const orderId = newId()
  const order = {
    id: orderId,
    order_number: `FR${istDate().slice(2).replaceAll('-', '')}-${randomCode(5)}`,
    tracking_token: randomToken(24),
    idempotency_key: body.idempotencyKey,
    order_type: orderType,
    customer_id: customer!.id,
    status: 'PENDING_REVIEW',
    customer_name: body.name,
    customer_phone: body.phone,
    customer_email: body.email,
    pin_code: body.pinCode,
    locality: zone.name,
    address_line: body.addressLine,
    landmark: body.landmark,
    instructions: body.instructions,
    zone_id: zone.id,
    slot_id: slot.id,
    slot_label: slot.label,
    estimated_subtotal_paise: quote.subtotalPaise,
    estimated_delivery_paise: quote.deliveryPaise,
    estimated_total_paise: quote.totalPaise,
    delivery_to_be_quoted: quote.deliveryToBeQuoted ? 1 : 0,
    payment_preference: body.paymentPreference,
    created_at: now,
    updated_at: now,
  }
  const ctx = { db, brand: settings.brand_name ?? '', baseUrl: siteUrl(c) }
  const shape = { ...order, total_paise: quote.totalPaise }
  try {
    await db.batch([
      insert(db, 'orders', order),
      ...quote.lines.map((line) =>
        insert(db, 'order_items', {
          id: newId(),
          order_id: orderId,
          product_id: line.productId,
          variant_id: line.variantId,
          product_name: line.productName,
          variant_label: line.variantLabel,
          requested_qty: line.qty,
          requested_unit_price_paise: line.unitPaise,
          line_status: 'REQUESTED',
          created_at: now,
        }),
      ),
      insert(db, 'order_status_history', {
        id: newId(),
        order_id: orderId,
        previous_status: null,
        new_status: 'PENDING_REVIEW',
        changed_by_kind: 'customer',
        changed_by_user_id: null,
        reason: orderType === 'ENQUIRY' ? 'Non-binding enquiry: online sales are not enabled' : 'Order request submitted',
        created_at: now,
      }),
      db
        .prepare(
          `INSERT INTO customer_addresses (id, customer_id, zone_id, pin_code, locality, address_line, landmark, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(customer_id, pin_code, address_line) DO UPDATE SET landmark = excluded.landmark, zone_id = excluded.zone_id, updated_at = excluded.updated_at`,
        )
        .bind(newId(), customer!.id, zone.id, body.pinCode, zone.name, body.addressLine, body.landmark, now, now),
      notifyStatement(ctx, 'NEW_ORDER', shape),
      notifyStatement(ctx, 'ORDER_RECEIVED', shape),
    ])
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // Two identical submissions raced: the other one won, so return it.
    const winner = await db
      .prepare('SELECT order_number, tracking_token, status, order_type FROM orders WHERE idempotency_key = ?')
      .bind(body.idempotencyKey)
      .first<Pick<OrderRow, 'order_number' | 'tracking_token' | 'status' | 'order_type'>>()
    if (!winner) throw error
    return c.json({ orderNumber: winner.order_number, trackingToken: winner.tracking_token, status: winner.status, orderType: winner.order_type, duplicate: true })
  }
  return c.json({ orderNumber: order.order_number, trackingToken: order.tracking_token, status: order.status, orderType }, 201)
})

/** Recovers a lost tracking link. Needs both the order number and phone, and is rate limited against guessing. */
publicRoutes.post('/orders/lookup', async (c) => {
  await rateLimit(c, 'order-lookup', 10, 900)
  const body = await parseBody(c, orderLookup)
  const row = await c.env.DB.prepare('SELECT tracking_token FROM orders WHERE order_number = ? AND customer_phone = ?')
    .bind(body.orderNumber.trim().toUpperCase(), body.phone)
    .first<{ tracking_token: string }>()
  if (!row) throw new ApiError(404, 'ORDER_NOT_FOUND', 'We could not find an order with that number and phone.')
  return c.json({ trackingToken: row.tracking_token })
})

publicRoutes.get('/track/:token', async (c) => {
  const db = c.env.DB
  const order = await getOrderByToken(db, c.req.param('token'))
  c.header('Cache-Control', 'no-store')
  const [items, revisions, history, payments, deliveries] = await db.batch<Record<string, unknown>>([
    db.prepare(
      `SELECT id, product_name, variant_label, requested_qty, requested_unit_price_paise, confirmed_qty, confirmed_unit_price_paise, confirmed_line_total_paise, line_status, substitute_for_item_id
       FROM order_items WHERE order_id = ? ORDER BY created_at`,
    ).bind(order.id),
    db.prepare('SELECT revision_number, reason, total_paise, created_at, customer_response FROM order_revisions WHERE order_id = ? ORDER BY revision_number DESC').bind(order.id),
    db.prepare('SELECT new_status, created_at FROM order_status_history WHERE order_id = ? ORDER BY created_at').bind(order.id),
    db.prepare("SELECT amount_paise, method, status, txn_ref, created_at FROM payment_records WHERE order_id = ? AND kind = 'PAYMENT' ORDER BY created_at DESC").bind(order.id),
    db.prepare("SELECT status, mode, provider, tracking_url, delivery_otp FROM deliveries WHERE order_id = ? AND status NOT IN ('CANCELLED') ORDER BY created_at DESC LIMIT 1").bind(order.id),
  ])
  const settings = await loadSettings(db)
  const needsUpi = order.status === 'CONFIRMED' && order.payment_method === 'UPI' && order.payment_status !== 'PAID'
  const delivery = deliveries!.results[0] as { status: string; mode: string; provider: string; tracking_url: string; delivery_otp: string | null } | undefined
  return c.json({
    orderNumber: order.order_number,
    orderType: order.order_type,
    status: order.status,
    statusLabel: CUSTOMER_STATUS_LABELS[order.status],
    createdAt: order.created_at,
    customerName: order.customer_name,
    address: { line: order.address_line, locality: order.locality, pinCode: order.pin_code, landmark: order.landmark },
    slotLabel: order.slot_label,
    estimate: {
      subtotalPaise: order.estimated_subtotal_paise,
      deliveryPaise: order.estimated_delivery_paise,
      totalPaise: order.estimated_total_paise,
      deliveryToBeQuoted: Boolean(order.delivery_to_be_quoted),
    },
    final:
      order.current_revision > 0
        ? {
            subtotalPaise: order.subtotal_paise,
            deliveryPaise: order.delivery_fee_paise,
            discountPaise: order.discount_paise,
            otherChargesPaise: order.other_charges_paise,
            totalPaise: order.total_paise,
          }
        : null,
    currentRevision: order.current_revision,
    paymentMethod: order.payment_method,
    paymentPreference: order.payment_preference,
    paymentStatus: order.payment_status,
    canCancel: CUSTOMER_CANCELLABLE.includes(order.status),
    items: items!.results,
    revisions: revisions!.results,
    history: (history!.results as Array<{ new_status: OrderStatus; created_at: string }>).map((row) => ({
      status: row.new_status,
      label: CUSTOMER_STATUS_LABELS[row.new_status],
      at: row.created_at,
    })),
    payments: payments!.results,
    upi: needsUpi
      ? { id: settings.upi_id ?? '', displayName: settings.upi_display_name ?? '', qrKey: settings.upi_qr_key || null, instructions: settings.upi_instructions ?? '' }
      : null,
    delivery: delivery
      ? {
          status: delivery.status,
          provider: delivery.mode === 'THIRD_PARTY' ? delivery.provider : null,
          trackingUrl: delivery.tracking_url || null,
          otp: order.status === 'OUT_FOR_DELIVERY' || order.status === 'PICKED_UP' ? delivery.delivery_otp : null,
        }
      : null,
  })
})

publicRoutes.post('/track/:token/respond', async (c) => {
  await rateLimit(c, 'order-respond', 20, 600)
  const body = await parseBody(c, customerResponse)
  const db = c.env.DB
  const order = await getOrderByToken(db, c.req.param('token'))
  if (order.status !== 'AWAITING_CUSTOMER_APPROVAL') throw new ApiError(409, 'NOT_AWAITING_APPROVAL', 'This order is not waiting for your approval.')
  if (body.revision !== order.current_revision) {
    throw new ApiError(409, 'REVISION_OUTDATED', 'The order was updated after you opened it. Please review the latest version.')
  }
  const ctx = await notifyCtx(c)
  const actor = { kind: 'customer' as const, userId: null }
  const note = body.action === 'ACCEPT_ORDER' ? '' : body.note
  const responded = db
    .prepare(
      `UPDATE order_revisions SET customer_response = ?, response_note = ?, responded_at = ?
       WHERE order_id = ? AND revision_number = ? AND customer_response IS NULL
         AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'AWAITING_CUSTOMER_APPROVAL')`,
    )
    .bind(body.action, note, nowIso(), order.id, body.revision, order.id)

  if (body.action === 'ACCEPT_ORDER') {
    const setPayment = db
      .prepare("UPDATE orders SET payment_method = ? WHERE id = ? AND status = 'AWAITING_CUSTOMER_APPROVAL'")
      .bind(body.paymentMethod, order.id)
    const statements = [responded, setPayment, ...transitionStatements(db, order, 'CONFIRMED', actor, `Customer approved revision ${body.revision}`), notifyStatement(ctx, 'ORDER_CONFIRMED', order)]
    await runTransitionBatch(db, statements, 3)
  } else if (body.action === 'REJECT_ORDER') {
    const statements = [responded, ...transitionStatements(db, order, 'REJECTED', actor, note || 'Customer rejected the revised order'), notifyStatement(ctx, 'ORDER_REJECTED', order, { reason: note })]
    await runTransitionBatch(db, statements, 2)
  } else {
    const setNote = db.prepare("UPDATE orders SET customer_note = ? WHERE id = ? AND status = 'AWAITING_CUSTOMER_APPROVAL'").bind(note, order.id)
    const statements = [responded, setNote, ...transitionStatements(db, order, 'PENDING_REVIEW', actor, `Customer requested a change: ${note}`), notifyStatement(ctx, 'CHANGE_REQUESTED', order, { reason: note })]
    await runTransitionBatch(db, statements, 3)
  }
  return c.json({ ok: true })
})

/** A customer's report that they paid. It proves nothing until staff check the actual bank or UPI receipt. */
publicRoutes.post('/track/:token/payment', async (c) => {
  await rateLimit(c, 'payment-report', 10, 600)
  const body = await parseBody(c, paymentReference)
  const db = c.env.DB
  const order = await getOrderByToken(db, c.req.param('token'))
  if (order.status !== 'CONFIRMED' || order.payment_method !== 'UPI') throw new ApiError(409, 'PAYMENT_NOT_EXPECTED', 'This order is not waiting for a UPI payment.')
  const ctx = await notifyCtx(c)
  try {
    await db.batch([
      insertIfOrderStatus(db, 'payment_records', {
        id: newId(),
        order_id: order.id,
        kind: 'PAYMENT',
        method: 'UPI',
        amount_paise: body.amountPaise,
        txn_ref: body.txnRef,
        status: 'PENDING',
        source: 'CUSTOMER',
        created_at: nowIso(),
      }, order.id, 'CONFIRMED'),
      notifyStatement(ctx, 'PAYMENT_RECEIVED', order),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'DUPLICATE_REFERENCE', 'This transaction reference has already been submitted.')
    throw error
  }
  return c.json({ ok: true }, 201)
})

publicRoutes.post('/track/:token/cancel', async (c) => {
  await rateLimit(c, 'order-cancel', 10, 600)
  const db = c.env.DB
  const order = await getOrderByToken(db, c.req.param('token'))
  if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
    throw new ApiError(409, 'CANNOT_CANCEL', 'This order can no longer be cancelled online. Please contact us.')
  }
  const ctx = await notifyCtx(c)
  const statements: D1PreparedStatement[] = []
  if (order.payment_status === 'PAID' || order.payment_status === 'PARTIALLY_PAID') {
    statements.push(update(db, 'orders', { payment_status: 'REFUND_PENDING' }, 'id = ? AND status = ?', order.id, order.status))
  }
  const index = statements.length + 1
  statements.push(...transitionStatements(db, order, 'CANCELLED', { kind: 'customer', userId: null }, 'Cancelled by customer'), notifyStatement(ctx, 'ORDER_CANCELLED', order))
  await runTransitionBatch(db, statements, index)
  return c.json({ ok: true })
})

publicRoutes.post('/tickets', async (c) => {
  await rateLimit(c, 'ticket-create', 8, 3600)
  const body = await parseBody(c, ticketRequest)
  const db = c.env.DB
  const now = nowIso()
  const number = body.orderNumber.trim().toUpperCase()
  const match = number
    ? await db.prepare('SELECT id FROM orders WHERE order_number = ? AND customer_phone = ?').bind(number, body.phone).first<{ id: string }>()
    : null
  await insert(db, 'support_tickets', {
    id: newId(),
    ticket_type: body.type,
    order_id: match?.id ?? null,
    customer_name: body.name,
    customer_phone: body.phone,
    order_number: number,
    message: body.message,
    status: 'OPEN',
    created_at: now,
    updated_at: now,
  }).run()
  return c.json({ ok: true }, 201)
})
