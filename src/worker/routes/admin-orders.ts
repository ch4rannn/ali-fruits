import { Hono } from 'hono'
import { can } from '../../shared/permissions'
import { whatsappLink, type NotificationEvent } from '../../shared/notifications'
import { type OrderStatus, ORDER_STATUSES, nextStatuses } from '../../shared/order-state'
import { orderFinancials, orderTotal } from '../../shared/pricing'
import { notesInput, recordApprovalInput, revisionInput, transitionInput } from '../../shared/schemas'
import { istRangeToUtc } from '../../shared/time'
import { auditStatement } from '../lib/audit'
import { requirePermission } from '../lib/auth'
import { insertIfOrderStatus, isUniqueViolation, update } from '../lib/db'
import { deliveryEvent, reallocateBatch, type DeliveryRow } from '../lib/delivery'
import { ApiError, likeTerm, newId, nowIso, pageParams, parseBody, siteUrl, type AppEnv } from '../lib/http'
import { notifyStatement } from '../lib/notify'
import { ACTIVE_LINE, getOrder, runTransitionBatch, transitionStatements } from '../lib/orders'
import { goLiveState, loadSettings } from '../lib/settings'

export const adminOrderRoutes = new Hono<AppEnv>()

/** These moves have their own endpoint, because each needs more than a status change. */
const DEDICATED_ROUTE: OrderStatus[] = ['AWAITING_CUSTOMER_APPROVAL', 'CONFIRMED', 'ASSIGNED_TO_RIDER', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED_DELIVERY', 'REFUND_PENDING', 'REFUNDED']

const STATUS_EVENT: Partial<Record<OrderStatus, NotificationEvent>> = {
  PROCUREMENT_COMPLETED: 'PROCUREMENT_COMPLETED',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  CANCELLED: 'ORDER_CANCELLED',
  REJECTED: 'ORDER_CANCELLED',
}

adminOrderRoutes.get('/', requirePermission('orders.read'), async (c) => {
  const { page, pageSize, limit, offset } = pageParams(c)
  const { q, status, from, to } = c.req.query()
  const where: string[] = []
  const params: Array<string | number> = []
  if (q?.trim()) {
    where.push("(order_number LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR customer_phone LIKE ? ESCAPE '\\')")
    const term = likeTerm(q.trim())
    params.push(term, term, term)
  }
  if (status && ORDER_STATUSES.includes(status as OrderStatus)) {
    where.push('status = ?')
    params.push(status)
  }
  if (from && to) {
    const range = istRangeToUtc(from, to)
    where.push('created_at >= ? AND created_at < ?')
    params.push(range.start, range.end)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const db = c.env.DB
  const [rows, count, pending] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT id, order_number, order_type, status, customer_name, customer_phone, locality, slot_label, payment_method, payment_preference, payment_status,
                estimated_total_paise, total_paise, current_revision, created_at
         FROM orders ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM orders ${clause}`).bind(...params),
    db.prepare("SELECT COUNT(*) AS total FROM orders WHERE status = 'PENDING_REVIEW'"),
  ])
  return c.json({
    orders: rows!.results,
    total: (count!.results[0] as { total: number }).total,
    pendingReview: (pending!.results[0] as { total: number }).total,
    page,
    pageSize,
  })
})

adminOrderRoutes.get('/:id', requirePermission('orders.read'), async (c) => {
  const db = c.env.DB
  const order = await getOrder(db, c.req.param('id'))
  const user = c.get('user')
  const showCosts = can(user.role, 'costs.read')
  const [items, revisions, history, payments, deliveries, messages, procurement, expenses, tickets] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at').bind(order.id),
    db.prepare('SELECT r.*, u.name AS created_by_name FROM order_revisions r LEFT JOIN users u ON u.id = r.created_by WHERE r.order_id = ? ORDER BY revision_number DESC').bind(order.id),
    db.prepare('SELECT h.*, u.name AS changed_by_name FROM order_status_history h LEFT JOIN users u ON u.id = h.changed_by_user_id WHERE h.order_id = ? ORDER BY h.created_at DESC').bind(order.id),
    db.prepare('SELECT p.*, u.name AS verified_by_name FROM payment_records p LEFT JOIN users u ON u.id = p.verified_by WHERE p.order_id = ? ORDER BY p.created_at DESC').bind(order.id),
    db.prepare(
      `SELECT d.*, u.name AS rider_name FROM deliveries d LEFT JOIN riders r ON r.id = d.rider_id LEFT JOIN users u ON u.id = r.user_id
       WHERE d.order_id = ? ORDER BY d.created_at DESC`,
    ).bind(order.id),
    db.prepare("SELECT id, event, body, created_at FROM notification_logs WHERE order_id = ? AND audience = 'CUSTOMER' ORDER BY created_at DESC LIMIT 6").bind(order.id),
    db.prepare('SELECT p.*, s.name AS supplier_name FROM procurement_records p JOIN suppliers s ON s.id = p.supplier_id WHERE p.order_id = ? ORDER BY p.created_at').bind(order.id),
    db.prepare('SELECT * FROM business_expenses WHERE order_id = ? ORDER BY created_at').bind(order.id),
    db.prepare('SELECT id, ticket_type, status, message, created_at FROM support_tickets WHERE order_id = ? ORDER BY created_at DESC').bind(order.id),
  ])
  const procurementRows = procurement!.results as Array<{ total_cost_paise: number }>
  const expenseRows = expenses!.results as Array<{ category: string; amount_paise: number }>
  const paymentRows = payments!.results as Array<{ kind: string; status: string; amount_paise: number }>
  const deliveryRows = deliveries!.results as Array<{ mode: string; status: string; actual_cost_paise: number }>
  const sumExpense = (category: string) => expenseRows.filter((e) => e.category === category).reduce((sum, e) => sum + e.amount_paise, 0)
  const liveDeliveries = deliveryRows.filter((d) => d.status !== 'CANCELLED')
  const sumDelivery = (mode: string) => liveDeliveries.filter((d) => d.mode === mode).reduce((sum, d) => sum + d.actual_cost_paise, 0)
  const finance = orderFinancials({
    delivered: Boolean(order.delivered_at),
    subtotal: order.subtotal_paise,
    deliveryFee: order.delivery_fee_paise,
    otherCharges: order.other_charges_paise,
    discount: order.discount_paise,
    fruitCost: procurementRows.reduce((sum, p) => sum + p.total_cost_paise, 0),
    packaging: sumExpense('PACKAGING'),
    ownRider: sumDelivery('OWN_RIDER') + sumExpense('RIDER'),
    thirdParty: sumDelivery('THIRD_PARTY') + sumExpense('THIRD_PARTY_DELIVERY'),
    refunds: paymentRows.filter((p) => p.kind === 'REFUND' && p.status === 'VERIFIED').reduce((sum, p) => sum + p.amount_paise, 0),
    otherVariable: sumExpense('OTHER_VARIABLE'),
  })
  c.header('Cache-Control', 'no-store')
  return c.json({
    order: {
      ...order,
      tracking_url: `${siteUrl(c)}/order/${order.tracking_token}`,
    },
    items: items!.results,
    revisions: revisions!.results,
    history: history!.results,
    payments: payments!.results,
    deliveries: deliveries!.results,
    tickets: tickets!.results,
    customerMessages: (messages!.results as Array<{ id: string; event: string; body: string; created_at: string }>).map((m) => ({
      ...m,
      whatsappUrl: whatsappLink(order.customer_phone, m.body),
    })),
    procurement: showCosts ? procurement!.results : [],
    expenses: showCosts ? expenses!.results : [],
    finance: showCosts ? finance : null,
    allowedNext: nextStatuses(order.status, 'staff').filter((status) => !DEDICATED_ROUTE.includes(status) && !(status === 'READY_FOR_PICKUP' && order.status === 'ASSIGNED_TO_RIDER')),
  })
})

adminOrderRoutes.patch('/:id/notes', requirePermission('orders.write'), async (c) => {
  const body = await parseBody(c, notesInput)
  const result = await update(c.env.DB, 'orders', { internal_notes: body.internalNotes, updated_at: nowIso() }, 'id = ?', c.req.param('id')).run()
  if (!result.meta.changes) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found.')
  return c.json({ ok: true })
})

/**
 * Records staff's checked quantities and prices, then asks the customer to approve them. The customer's
 * requested_* columns are never touched, and each revision keeps a full snapshot.
 */
adminOrderRoutes.post('/:id/revisions', requirePermission('orders.write'), async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const body = await parseBody(c, revisionInput)
  const order = await getOrder(db, c.req.param('id'))
  const settings = await loadSettings(db)
  if (order.order_type === 'ENQUIRY' || !goLiveState(c.env, settings).live) {
    throw new ApiError(409, 'ONLINE_SALES_OFF', 'This is a non-binding enquiry. Live orders can only be confirmed once online sales are enabled, so please reply to the customer directly.')
  }
  if (order.status !== 'PENDING_REVIEW') throw new ApiError(409, 'NOT_IN_REVIEW', 'Reopen this order for review before changing it.')

  const { results: existing } = await db.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(order.id).all<{
    id: string
    requested_qty: number | null
    product_name: string
    variant_label: string
    variant_id: string
    product_id: string
  }>()
  const existingById = new Map(existing.map((item) => [item.id, item]))
  const statusGuard = 'EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = ?)'
  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  const snapshot: Array<Record<string, unknown>> = []
  const mentioned = new Set<string>()
  let subtotal = 0

  for (const line of body.items) {
    const lineTotal = line.qty * line.unitPricePaise
    if (line.itemId) {
      const item = existingById.get(line.itemId)
      if (!item) throw new ApiError(422, 'UNKNOWN_ITEM', 'One of the items does not belong to this order.')
      mentioned.add(item.id)
      const lineStatus = line.qty === 0 ? 'REMOVED' : item.requested_qty === null ? 'ADDED' : 'CONFIRMED'
      statements.push(
        update(db, 'order_items', {
          confirmed_qty: line.qty,
          confirmed_unit_price_paise: line.unitPricePaise,
          confirmed_line_total_paise: lineTotal,
          line_status: lineStatus,
        }, `id = ? AND ${statusGuard}`, item.id, order.id, order.status),
      )
      snapshot.push({ item: item.product_name, unit: item.variant_label, qty: line.qty, unitPricePaise: line.unitPricePaise, lineStatus })
    } else {
      if (!line.variantId || line.qty === 0) throw new ApiError(422, 'INVALID_ITEM', 'A new item needs a product and a quantity.')
      if (line.substituteForItemId && !existingById.has(line.substituteForItemId)) throw new ApiError(422, 'UNKNOWN_ITEM', 'The item being substituted is not part of this order.')
      const variant = await db
        .prepare('SELECT v.id, v.label, p.id AS product_id, p.name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1')
        .bind(line.variantId)
        .first<{ id: string; label: string; product_id: string; name: string }>()
      if (!variant) throw new ApiError(422, 'UNKNOWN_VARIANT', 'That product is not available to add.')
      statements.push(
        insertIfOrderStatus(db, 'order_items', {
          id: newId(),
          order_id: order.id,
          product_id: variant.product_id,
          variant_id: variant.id,
          product_name: variant.name,
          variant_label: variant.label,
          confirmed_qty: line.qty,
          confirmed_unit_price_paise: line.unitPricePaise,
          confirmed_line_total_paise: lineTotal,
          line_status: 'ADDED',
          substitute_for_item_id: line.substituteForItemId ?? null,
          created_at: now,
        }, order.id, order.status),
      )
      snapshot.push({ item: variant.name, unit: variant.label, qty: line.qty, unitPricePaise: line.unitPricePaise, lineStatus: 'ADDED', substituteFor: line.substituteForItemId ?? null })
    }
    subtotal += lineTotal
  }
  for (const item of existing) {
    if (!mentioned.has(item.id)) {
      statements.push(update(db, 'order_items', { confirmed_qty: 0, confirmed_line_total_paise: 0, line_status: 'REMOVED' }, `id = ? AND ${statusGuard}`, item.id, order.id, order.status))
    }
  }
  if (subtotal <= 0) throw new ApiError(422, 'EMPTY_ORDER', 'Keep at least one item, or reject the order instead.')

  const total = orderTotal({ subtotal, delivery: body.deliveryFeePaise, other: body.otherChargesPaise, discount: body.discountPaise })
  const revisionNumber = order.current_revision + 1
  const ctx = { db, brand: settings.brand_name ?? '', baseUrl: siteUrl(c) }
  statements.push(
    insertIfOrderStatus(db, 'order_revisions', {
      id: newId(),
      order_id: order.id,
      revision_number: revisionNumber,
      snapshot_json: JSON.stringify(snapshot),
      subtotal_paise: subtotal,
      delivery_fee_paise: body.deliveryFeePaise,
      discount_paise: body.discountPaise,
      other_charges_paise: body.otherChargesPaise,
      total_paise: total,
      reason: body.reason,
      created_by: user.id,
      created_at: now,
    }, order.id, order.status),
    update(db, 'orders', {
      subtotal_paise: subtotal,
      delivery_fee_paise: body.deliveryFeePaise,
      discount_paise: body.discountPaise,
      other_charges_paise: body.otherChargesPaise,
      total_paise: total,
      current_revision: revisionNumber,
      customer_note: '',
      internal_notes: body.internalNote || order.internal_notes,
    }, 'id = ? AND status = ?', order.id, order.status),
  )
  const index = statements.length + 1
  statements.push(
    ...transitionStatements(db, order, 'AWAITING_CUSTOMER_APPROVAL', { kind: 'staff', userId: user.id }, body.reason),
    notifyStatement(ctx, 'APPROVAL_REQUIRED', { ...order, total_paise: total }),
    auditStatement(db, user, 'SEND_REVISION', 'order', order.id, { revision: revisionNumber, totalPaise: total }),
  )
  try {
    await runTransitionBatch(db, statements, index)
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'ORDER_CHANGED', 'This order was just changed by someone else. Refresh and try again.')
    throw error
  }
  return c.json({ ok: true, revision: revisionNumber, totalPaise: total }, 201)
})

/** For approval given by phone or WhatsApp. It needs a note and is written to the audit log. */
adminOrderRoutes.post('/:id/record-approval', requirePermission('orders.write'), async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const body = await parseBody(c, recordApprovalInput)
  const order = await getOrder(db, c.req.param('id'))
  if (order.status !== 'AWAITING_CUSTOMER_APPROVAL') throw new ApiError(409, 'NOT_AWAITING_APPROVAL', 'This order is not waiting for customer approval.')
  if (body.revision !== order.current_revision) throw new ApiError(409, 'REVISION_OUTDATED', 'This is not the latest revision of the order.')
  const settings = await loadSettings(db)
  const ctx = { db, brand: settings.brand_name ?? '', baseUrl: siteUrl(c) }
  const statements = [
    db
      .prepare(
        `UPDATE order_revisions SET customer_response = 'ACCEPT_ORDER', response_note = ?, responded_at = ?
         WHERE order_id = ? AND revision_number = ? AND customer_response IS NULL`,
      )
      .bind(`Recorded by ${user.name}: ${body.note}`, nowIso(), order.id, body.revision),
    update(db, 'orders', { payment_method: body.paymentMethod }, "id = ? AND status = 'AWAITING_CUSTOMER_APPROVAL'", order.id),
    ...transitionStatements(db, order, 'CONFIRMED', { kind: 'staff', userId: user.id }, `Customer approval recorded by staff: ${body.note}`),
    notifyStatement(ctx, 'ORDER_CONFIRMED', order),
    auditStatement(db, user, 'RECORD_CUSTOMER_APPROVAL', 'order', order.id, { revision: body.revision, note: body.note }),
  ]
  await runTransitionBatch(db, statements, 3)
  return c.json({ ok: true })
})

adminOrderRoutes.post('/:id/transition', requirePermission('orders.write'), async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const body = await parseBody(c, transitionInput)
  const order = await getOrder(db, c.req.param('id'))
  const to = body.to

  if (DEDICATED_ROUTE.includes(to) || (to === 'READY_FOR_PICKUP' && order.status === 'ASSIGNED_TO_RIDER')) {
    throw new ApiError(409, 'USE_DEDICATED_ACTION', 'Use the matching action on the order page for this change.')
  }
  if (order.order_type === 'ENQUIRY' && to !== 'REJECTED' && to !== 'CANCELLED') {
    throw new ApiError(409, 'ONLINE_SALES_OFF', 'A non-binding enquiry can only be closed.')
  }
  if ((to === 'CANCELLED' || to === 'REJECTED') && !body.reason) {
    throw new ApiError(422, 'REASON_REQUIRED', 'Enter a reason so the customer can be told why.')
  }
  // Zero-inventory rule: fruit is bought only after approval and after payment or a cash-on-delivery choice.
  if (to === 'PROCUREMENT_IN_PROGRESS' && order.payment_method !== 'COD' && order.payment_status !== 'PAID') {
    throw new ApiError(409, 'PAYMENT_REQUIRED', 'Verify the UPI payment, or switch the order to cash on delivery, before buying fruit.')
  }
  if (to === 'PROCUREMENT_COMPLETED') {
    const missing = await db
      .prepare(`SELECT product_name FROM order_items WHERE order_id = ? AND ${ACTIVE_LINE} AND id NOT IN (SELECT order_item_id FROM procurement_records WHERE order_id = ?)`)
      .bind(order.id, order.id)
      .all<{ product_name: string }>()
    if (missing.results.length) {
      throw new ApiError(409, 'PROCUREMENT_INCOMPLETE', `Record what was paid for: ${missing.results.map((row) => row.product_name).join(', ')}.`)
    }
  }

  const statements: D1PreparedStatement[] = []
  if (to === 'CANCELLED') {
    const open = await db.prepare("SELECT * FROM deliveries WHERE order_id = ? AND status IN ('ASSIGNED','ACCEPTED')").bind(order.id).first<DeliveryRow>()
    if (open) {
      statements.push(
        update(db, 'deliveries', { status: 'CANCELLED', actual_cost_paise: 0, updated_at: nowIso() }, 'id = ?', open.id),
        deliveryEvent(db, open.id, 'CANCELLED', body.reason, user.id),
        ...(open.batch_id ? await reallocateBatch(db, open.batch_id, open.id) : []),
      )
    }
    if (order.payment_status === 'PAID' || order.payment_status === 'PARTIALLY_PAID') {
      statements.push(update(db, 'orders', { payment_status: 'REFUND_PENDING' }, 'id = ? AND status = ?', order.id, order.status))
    }
  }
  const index = statements.length + 1
  statements.push(...transitionStatements(db, order, to, { kind: 'staff', userId: user.id }, body.reason))
  const event = STATUS_EVENT[to]
  if (event) {
    const settings = await loadSettings(db)
    statements.push(notifyStatement({ db, brand: settings.brand_name ?? '', baseUrl: siteUrl(c) }, event, order, { reason: body.reason }))
  }
  statements.push(auditStatement(db, user, 'CHANGE_ORDER_STATUS', 'order', order.id, { from: order.status, to, reason: body.reason }))
  await runTransitionBatch(db, statements, index)
  return c.json({ ok: true })
})
