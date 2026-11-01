import { Hono } from 'hono'
import { can } from '../../shared/permissions'
import { paiseToRupees } from '../../shared/money'
import { STATUS_LABELS, type OrderStatus } from '../../shared/order-state'
import { expenseInput, paymentInput, paymentVerify, rangeQuery, refundInput } from '../../shared/schemas'
import { istDate, istRangeToUtc, presetRange } from '../../shared/time'
import { auditStatement } from '../lib/audit'
import { requirePermission } from '../lib/auth'
import { insert, isUniqueViolation, update } from '../lib/db'
import { loadFinanceRows, periodKey, repeatCustomers, rowFinancials, summarize, unlinkedExpenses } from '../lib/finance'
import { ApiError, csvResponse, newId, nowIso, pageParams, parseBody, parseQuery, siteUrl, type AppContext, type AppEnv } from '../lib/http'
import { notifyStatement } from '../lib/notify'
import { getOrder, paymentStatusStatement, runTransitionBatch, transitionStatements } from '../lib/orders'
import { loadSettings } from '../lib/settings'

export const adminFinanceRoutes = new Hono<AppEnv>()

// Overview

adminFinanceRoutes.get('/overview', requirePermission('dashboard.read'), async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const fallback = presetRange('today')
  const query = parseQuery(c, rangeQuery.partial())
  const from = query.from ?? fallback.from
  const to = query.to ?? fallback.to
  const { start, end } = istRangeToUtc(from, to)
  const [created, current] = await db.batch<{ status: string; total: number }>([
    db.prepare("SELECT status, COUNT(*) AS total FROM orders WHERE created_at >= ? AND created_at < ? AND order_type = 'ORDER' GROUP BY status").bind(start, end),
    db.prepare(
      `SELECT status, COUNT(*) AS total FROM orders WHERE order_type = 'ORDER' AND status IN
       ('PENDING_REVIEW','AWAITING_CUSTOMER_APPROVAL','CONFIRMED','PROCUREMENT_IN_PROGRESS','PROCUREMENT_COMPLETED','PACKING','READY_FOR_PICKUP','ASSIGNED_TO_RIDER','PICKED_UP','OUT_FOR_DELIVERY','REFUND_PENDING') GROUP BY status`,
    ),
  ])
  const createdRows = created!.results
  const currentRows = current!.results
  const countOf = (rows: Array<{ status: string; total: number }>, statuses: string[]) =>
    rows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.total, 0)
  const enquiries = await db.prepare("SELECT COUNT(*) AS total FROM orders WHERE order_type = 'ENQUIRY' AND status = 'PENDING_REVIEW'").first<{ total: number }>()
  const tickets = await db.prepare("SELECT COUNT(*) AS total FROM support_tickets WHERE status IN ('OPEN','IN_PROGRESS')").first<{ total: number }>()

  const counts = {
    ordersInRange: createdRows.reduce((sum, row) => sum + row.total, 0),
    pending: countOf(currentRows, ['PENDING_REVIEW']),
    awaitingApproval: countOf(currentRows, ['AWAITING_CUSTOMER_APPROVAL']),
    confirmed: countOf(currentRows, ['CONFIRMED']),
    inProgress: countOf(currentRows, ['PROCUREMENT_IN_PROGRESS', 'PROCUREMENT_COMPLETED', 'PACKING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_RIDER', 'PICKED_UP', 'OUT_FOR_DELIVERY']),
    refundPending: countOf(currentRows, ['REFUND_PENDING']),
    completed: countOf(createdRows, ['DELIVERED', 'REFUND_PENDING', 'REFUNDED']),
    cancelled: countOf(createdRows, ['CANCELLED', 'REJECTED']),
    openEnquiries: enquiries?.total ?? 0,
    openTickets: tickets?.total ?? 0,
  }
  if (!can(user.role, 'reports.read')) return c.json({ from, to, counts, finance: null })

  const today = presetRange('today')
  const month = presetRange('month')
  const [rangeRows, todayRows, monthRows, unlinked, repeat] = await Promise.all([
    loadFinanceRows(db, from, to),
    loadFinanceRows(db, today.from, today.to),
    loadFinanceRows(db, month.from, month.to),
    unlinkedExpenses(db, from, to),
    repeatCustomers(db, from, to),
  ])
  const summary = summarize(rangeRows)
  c.header('Cache-Control', 'no-store')
  return c.json({
    from,
    to,
    counts,
    finance: {
      ...summary,
      todayRevenue: summarize(todayRows).revenue,
      monthRevenue: summarize(monthRows).revenue,
      unlinkedVariableExpenses: unlinked.variable,
      fixedExpenses: unlinked.fixed,
      contributionAfterUnlinked: summary.contribution - unlinked.variable,
      ...repeat,
    },
  })
})

// Payments

adminFinanceRoutes.get('/payments', requirePermission('payments.read'), async (c) => {
  const { page, pageSize, limit, offset } = pageParams(c)
  const status = c.req.query('status')
  const db = c.env.DB
  const clause = status ? 'WHERE p.status = ?' : ''
  const params = status ? [status] : []
  const [rows, count] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT p.*, o.order_number, o.customer_name, o.total_paise, o.status AS order_status, o.payment_status, u.name AS verified_by_name
         FROM payment_records p JOIN orders o ON o.id = p.order_id LEFT JOIN users u ON u.id = p.verified_by
         ${clause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM payment_records p ${clause}`).bind(...params),
  ])
  return c.json({ payments: rows!.results, total: (count!.results[0] as { total: number }).total, page, pageSize })
})

/** Staff record money they have already seen in the bank or UPI account, so it counts as verified. */
adminFinanceRoutes.post('/payments', requirePermission('payments.write'), async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const body = await parseBody(c, paymentInput)
  const order = await getOrder(db, body.orderId)
  if (order.order_type === 'ENQUIRY') throw new ApiError(409, 'ONLINE_SALES_OFF', 'Payments cannot be taken against a non-binding enquiry.')
  if (order.current_revision === 0) throw new ApiError(409, 'NOT_CONFIRMED', 'Payment can only be recorded after the final price is set.')
  const now = nowIso()
  const id = newId()
  const settings = await loadSettings(db)
  try {
    await db.batch([
      insert(db, 'payment_records', {
        id,
        order_id: order.id,
        kind: 'PAYMENT',
        method: body.method,
        amount_paise: body.amountPaise,
        txn_ref: body.txnRef,
        status: 'VERIFIED',
        source: 'STAFF',
        verified_by: user.id,
        verified_at: now,
        collected_at: body.method === 'COD' ? now : null,
        notes: body.notes,
        created_at: now,
      }),
      paymentStatusStatement(db, order.id),
      notifyStatement({ db, brand: settings.brand_name ?? '', baseUrl: siteUrl(c) }, 'PAYMENT_VERIFIED', order),
      auditStatement(db, user, 'RECORD_PAYMENT', 'order', order.id, { amountPaise: body.amountPaise, method: body.method }),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'DUPLICATE_REFERENCE', 'That transaction reference is already recorded.')
    throw error
  }
  return c.json({ id }, 201)
})

adminFinanceRoutes.post('/payments/:id/verify', requirePermission('payments.write'), async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const body = await parseBody(c, paymentVerify)
  const payment = await db.prepare('SELECT id, order_id, status, kind FROM payment_records WHERE id = ?').bind(c.req.param('id')).first<{ id: string; order_id: string; status: string; kind: string }>()
  if (!payment) throw new ApiError(404, 'NOT_FOUND', 'Payment not found.')
  if (payment.status !== 'PENDING') throw new ApiError(409, 'ALREADY_DECIDED', 'This payment has already been checked.')
  const order = await getOrder(db, payment.order_id)
  const settings = await loadSettings(db)
  const now = nowIso()
  const statements = [
    update(db, 'payment_records', { status: body.decision, verified_by: user.id, verified_at: now, notes: body.notes }, "id = ? AND status = 'PENDING'", payment.id),
    paymentStatusStatement(db, payment.order_id),
    auditStatement(db, user, body.decision === 'VERIFIED' ? 'VERIFY_PAYMENT' : 'REJECT_PAYMENT', 'order', payment.order_id, { paymentId: payment.id }),
  ]
  if (body.decision === 'VERIFIED') statements.push(notifyStatement({ db, brand: settings.brand_name ?? '', baseUrl: siteUrl(c) }, 'PAYMENT_VERIFIED', order))
  await db.batch(statements)
  return c.json({ ok: true })
})

/** Moves a confirmed UPI order to cash on delivery, for example after a failed payment. */
adminFinanceRoutes.post('/orders/:orderId/use-cod', requirePermission('payments.write'), async (c) => {
  const db = c.env.DB
  const order = await getOrder(db, c.req.param('orderId'))
  if (order.status !== 'CONFIRMED') throw new ApiError(409, 'NOT_CONFIRMED', 'Only a confirmed order waiting for payment can switch to cash on delivery.')
  await db.batch([
    update(db, 'orders', { payment_method: 'COD', updated_at: nowIso() }, "id = ? AND status = 'CONFIRMED'", order.id),
    auditStatement(db, c.get('user'), 'SWITCH_TO_COD', 'order', order.id),
  ])
  return c.json({ ok: true })
})

adminFinanceRoutes.post('/orders/:orderId/refund-start', requirePermission('payments.write'), async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const order = await getOrder(db, c.req.param('orderId'))
  await runTransitionBatch(
    db,
    [
      update(db, 'orders', { payment_status: 'REFUND_PENDING' }, 'id = ? AND status = ?', order.id, order.status),
      ...transitionStatements(db, order, 'REFUND_PENDING', { kind: 'staff', userId: user.id }, 'Refund started'),
      auditStatement(db, user, 'START_REFUND', 'order', order.id),
    ],
    2,
  )
  return c.json({ ok: true })
})

/** Records a refund already made. It cannot exceed what was actually received. */
adminFinanceRoutes.post('/orders/:orderId/refund', requirePermission('payments.write'), async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const body = await parseBody(c, refundInput)
  const order = await getOrder(db, c.req.param('orderId'))
  if (order.status !== 'REFUND_PENDING') throw new ApiError(409, 'REFUND_NOT_STARTED', 'Start the refund on this order first.')
  const paid = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'PAYMENT' AND (status = 'VERIFIED' OR (method = 'COD' AND collected_at IS NOT NULL AND status <> 'FAILED')) THEN amount_paise END), 0) AS received,
              COALESCE(SUM(CASE WHEN kind = 'REFUND' AND status = 'VERIFIED' THEN amount_paise END), 0) AS refunded
       FROM payment_records WHERE order_id = ?`,
    )
    .bind(order.id)
    .first<{ received: number; refunded: number }>()
  const refundable = (paid?.received ?? 0) - (paid?.refunded ?? 0)
  if (body.amountPaise > refundable) throw new ApiError(422, 'REFUND_TOO_LARGE', `Only ${paiseToRupees(refundable)} rupees has been received and not yet refunded.`)
  const settings = await loadSettings(db)
  const now = nowIso()
  const statements = [
    insert(db, 'payment_records', {
      id: newId(),
      order_id: order.id,
      kind: 'REFUND',
      method: body.method,
      amount_paise: body.amountPaise,
      txn_ref: body.txnRef,
      status: 'VERIFIED',
      source: 'STAFF',
      verified_by: user.id,
      verified_at: now,
      notes: body.notes,
      created_at: now,
    }),
    update(db, 'orders', { payment_status: 'REFUNDED' }, "id = ? AND status = 'REFUND_PENDING'", order.id),
    ...transitionStatements(db, order, 'REFUNDED', { kind: 'staff', userId: user.id }, body.notes || 'Refund recorded'),
    notifyStatement({ db, brand: settings.brand_name ?? '', baseUrl: siteUrl(c) }, 'REFUND_RECORDED', { ...order, total_paise: body.amountPaise }),
    auditStatement(db, user, 'RECORD_REFUND', 'order', order.id, { amountPaise: body.amountPaise }),
  ]
  await runTransitionBatch(db, statements, 3)
  return c.json({ ok: true }, 201)
})

// Expenses

adminFinanceRoutes.get('/expenses', requirePermission('expenses.write'), async (c) => {
  const { page, pageSize, limit, offset } = pageParams(c)
  const { from, to, category } = c.req.query()
  const where: string[] = []
  const params: string[] = []
  if (from && to) {
    where.push('e.expense_date >= ? AND e.expense_date <= ?')
    params.push(from, to)
  }
  if (category) {
    where.push('e.category = ?')
    params.push(category)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const db = c.env.DB
  const [rows, count] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT e.*, o.order_number, u.name AS rider_name, cu.name AS created_by_name
         FROM business_expenses e LEFT JOIN orders o ON o.id = e.order_id LEFT JOIN riders r ON r.id = e.rider_id
         LEFT JOIN users u ON u.id = r.user_id LEFT JOIN users cu ON cu.id = e.created_by
         ${clause} ORDER BY e.expense_date DESC, e.created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(e.amount_paise), 0) AS sum FROM business_expenses e ${clause}`).bind(...params),
  ])
  const summary = count!.results[0] as { total: number; sum: number }
  return c.json({ expenses: rows!.results, total: summary.total, sumPaise: summary.sum, page, pageSize })
})

/** Packing staff need to log packaging against an order, so operations may add expenses that are tied to one. */
adminFinanceRoutes.post('/expenses', async (c) => {
  const user = c.get('user')
  const body = await parseBody(c, expenseInput)
  const allowed = can(user.role, 'expenses.write') || (can(user.role, 'orders.write') && body.orderId && body.category === 'PACKAGING')
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this.')
  const db = c.env.DB
  const id = newId()
  await db.batch([
    insert(db, 'business_expenses', {
      id,
      category: body.category,
      amount_paise: body.amountPaise,
      expense_date: body.expenseDate,
      description: body.description,
      order_id: body.orderId ?? null,
      rider_id: body.riderId ?? null,
      created_by: user.id,
      created_at: nowIso(),
    }),
    auditStatement(db, user, 'CREATE_EXPENSE', 'expense', id, { category: body.category, amountPaise: body.amountPaise }),
  ])
  return c.json({ id }, 201)
})

adminFinanceRoutes.delete('/expenses/:id', requirePermission('expenses.write'), async (c) => {
  const db = c.env.DB
  const expense = await db.prepare('SELECT * FROM business_expenses WHERE id = ?').bind(c.req.param('id')).first<{ id: string; category: string; amount_paise: number }>()
  if (!expense) throw new ApiError(404, 'NOT_FOUND', 'Expense not found.')
  await db.batch([
    db.prepare('DELETE FROM business_expenses WHERE id = ?').bind(expense.id),
    auditStatement(db, c.get('user'), 'DELETE_EXPENSE', 'expense', expense.id, { category: expense.category, amountPaise: expense.amount_paise }),
  ])
  return c.json({ ok: true })
})

// Reports

function range(c: AppContext) {
  const fallback = { from: istDate().slice(0, 7) + '-01', to: istDate() }
  return parseQuery(c, rangeQuery.partial().transform((q) => ({ from: q.from ?? fallback.from, to: q.to ?? fallback.to })))
}

const rupees = (paise: number) => Number(paiseToRupees(paise))

function respond(c: AppContext, name: string, rows: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  if (c.req.query('format') === 'csv') {
    const { from, to } = range(c)
    return csvResponse(`${name}-${from}-to-${to}.csv`, rows)
  }
  return c.json({ rows, ...extra })
}

adminFinanceRoutes.get('/reports/sales', requirePermission('reports.read'), async (c) => {
  const { from, to } = range(c)
  const groupBy = (['day', 'week', 'month'] as const).find((g) => g === c.req.query('groupBy')) ?? 'day'
  const db = c.env.DB
  const [rows, unlinked, repeat] = await Promise.all([loadFinanceRows(db, from, to), unlinkedExpenses(db, from, to), repeatCustomers(db, from, to)])
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = periodKey(row.settled_at, groupBy)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const series = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, group]) => {
    const s = summarize(group)
    return {
      period,
      completed_orders: s.completedOrders,
      cancelled_orders: s.cancelledOrders,
      revenue: rupees(s.revenue),
      fruit_cost: rupees(s.fruitCost),
      gross_profit: rupees(s.grossProfit),
      gross_margin_percent: s.grossMarginPercent ?? '',
      packaging: rupees(s.packaging),
      delivery_cost: rupees(s.deliveryCost),
      refunds: rupees(s.refundCost),
      contribution: rupees(s.contribution),
    }
  })
  return respond(c, `sales-${groupBy}`, series, {
    summary: { ...summarize(rows), unlinkedVariableExpenses: unlinked.variable, fixedExpenses: unlinked.fixed, ...repeat },
  })
})

adminFinanceRoutes.get('/reports/orders', requirePermission('reports.read'), async (c) => {
  const { from, to } = range(c)
  const rows = await loadFinanceRows(c.env.DB, from, to)
  return respond(c, 'orders', rows.map((row) => {
    const f = rowFinancials(row)
    return {
      order: row.order_number,
      status: STATUS_LABELS[row.status as OrderStatus],
      area: row.locality,
      finished_at: row.settled_at,
      revenue: rupees(f.revenue),
      fruit_cost: rupees(f.fruitCost),
      gross_profit: rupees(f.grossProfit),
      packaging: rupees(f.packaging),
      delivery_cost: rupees(f.deliveryCost),
      refunds: rupees(f.refundCost),
      other_costs: rupees(f.otherVariable),
      contribution: rupees(f.contribution),
    }
  }))
})

adminFinanceRoutes.get('/reports/products', requirePermission('reports.read'), async (c) => {
  const { from, to } = range(c)
  const { start, end } = istRangeToUtc(from, to)
  const { results } = await c.env.DB.prepare(
    `SELECT i.product_name AS product, SUM(i.confirmed_qty) AS units_sold, COUNT(DISTINCT i.order_id) AS orders,
            SUM(i.confirmed_line_total_paise) AS revenue_paise,
            COALESCE((SELECT SUM(p.total_cost_paise) FROM procurement_records p JOIN orders po ON po.id = p.order_id
                      WHERE p.product_id = i.product_id AND po.delivered_at >= ? AND po.delivered_at < ?), 0) AS cost_paise
     FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.delivered_at >= ? AND o.delivered_at < ? AND i.line_status IN ('CONFIRMED','ADDED')
     GROUP BY i.product_id ORDER BY revenue_paise DESC`,
  )
    .bind(start, end, start, end)
    .all<{ product: string; units_sold: number; orders: number; revenue_paise: number; cost_paise: number }>()
  return respond(c, 'products', results.map((row) => ({
    product: row.product,
    units_sold: row.units_sold,
    orders: row.orders,
    revenue: rupees(row.revenue_paise),
    fruit_cost: rupees(row.cost_paise),
    gross_profit: rupees(row.revenue_paise - row.cost_paise),
    gross_margin_percent: row.revenue_paise ? Math.round(((row.revenue_paise - row.cost_paise) / row.revenue_paise) * 1000) / 10 : '',
  })))
})

adminFinanceRoutes.get('/reports/delivery', requirePermission('reports.read'), async (c) => {
  const { from, to } = range(c)
  const { start, end } = istRangeToUtc(from, to)
  const { results } = await c.env.DB.prepare(
    `SELECT o.locality AS area, d.mode, COALESCE(NULLIF(d.provider, ''), 'Own rider') AS provider, COUNT(*) AS deliveries,
            SUM(CASE WHEN d.status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN d.status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
            SUM(d.actual_cost_paise) AS cost_paise, SUM(CASE WHEN d.status = 'DELIVERED' THEN o.delivery_fee_paise ELSE 0 END) AS collected_paise
     FROM deliveries d JOIN orders o ON o.id = d.order_id
     WHERE d.created_at >= ? AND d.created_at < ? AND d.status <> 'CANCELLED'
     GROUP BY o.locality, d.mode, d.provider ORDER BY o.locality`,
  )
    .bind(start, end)
    .all<{ area: string; mode: string; provider: string; deliveries: number; delivered: number; failed: number; cost_paise: number; collected_paise: number }>()
  return respond(c, 'delivery-costs', results.map((row) => ({
    area: row.area,
    provider: row.provider,
    deliveries: row.deliveries,
    delivered: row.delivered,
    failed: row.failed,
    delivery_cost: rupees(row.cost_paise),
    delivery_fees_collected: rupees(row.collected_paise),
  })))
})

adminFinanceRoutes.get('/reports/riders', requirePermission('reports.read'), async (c) => {
  const { from, to } = range(c)
  const { start, end } = istRangeToUtc(from, to)
  const { results } = await c.env.DB.prepare(
    `SELECT u.name AS rider, r.compensation_type,
       (SELECT COUNT(*) FROM deliveries d WHERE d.rider_id = r.id AND d.status = 'DELIVERED' AND d.updated_at >= ? AND d.updated_at < ?) AS delivered,
       (SELECT COUNT(*) FROM deliveries d WHERE d.rider_id = r.id AND d.status = 'FAILED' AND d.updated_at >= ? AND d.updated_at < ?) AS failed,
       COALESCE((SELECT SUM(d.actual_cost_paise) FROM deliveries d WHERE d.rider_id = r.id AND d.status <> 'CANCELLED' AND d.updated_at >= ? AND d.updated_at < ?), 0) AS delivery_cost_paise,
       COALESCE((SELECT SUM(e.amount_paise) FROM business_expenses e WHERE e.rider_id = r.id AND e.expense_date >= ? AND e.expense_date <= ?), 0) AS other_paid_paise
     FROM riders r JOIN users u ON u.id = r.user_id ORDER BY u.name`,
  )
    .bind(start, end, start, end, start, end, from, to)
    .all<{ rider: string; compensation_type: string; delivered: number; failed: number; delivery_cost_paise: number; other_paid_paise: number }>()
  return respond(c, 'rider-expenses', results.map((row) => ({
    rider: row.rider,
    pay_type: row.compensation_type,
    delivered: row.delivered,
    failed: row.failed,
    delivery_cost: rupees(row.delivery_cost_paise),
    shift_or_other_pay: rupees(row.other_paid_paise),
    total: rupees(row.delivery_cost_paise + row.other_paid_paise),
  })))
})

/** Contains names but not phone numbers or addresses, so it stays within the reports permission. */
adminFinanceRoutes.get('/reports/customers', requirePermission('reports.read'), async (c) => {
  const { from, to } = range(c)
  const { start, end } = istRangeToUtc(from, to)
  const { results } = await c.env.DB.prepare(
    `SELECT cu.name AS customer, COUNT(*) AS orders_in_period, SUM(o.total_paise) AS spent_paise,
            (SELECT COUNT(*) FROM orders x WHERE x.customer_id = cu.id AND x.delivered_at IS NOT NULL) AS lifetime_orders
     FROM orders o JOIN customers cu ON cu.id = o.customer_id
     WHERE o.delivered_at >= ? AND o.delivered_at < ? GROUP BY cu.id ORDER BY lifetime_orders DESC, spent_paise DESC LIMIT 1000`,
  )
    .bind(start, end)
    .all<{ customer: string; orders_in_period: number; spent_paise: number; lifetime_orders: number }>()
  return respond(c, 'repeat-customers', results.map((row) => ({
    customer: row.customer,
    orders_in_period: row.orders_in_period,
    spent: rupees(row.spent_paise),
    lifetime_orders: row.lifetime_orders,
    repeat_customer: row.lifetime_orders > 1 ? 'Yes' : 'No',
  })))
})

adminFinanceRoutes.get('/reports/procurement', requirePermission('reports.read'), async (c) => {
  const { from, to } = range(c)
  const { start, end } = istRangeToUtc(from, to)
  const { results } = await c.env.DB.prepare(
    `SELECT p.purchased_at, o.order_number, i.product_name, i.variant_label, s.name AS supplier, p.purchased_quantity, p.unit, p.total_cost_paise, p.responsible_employee, p.invoice_reference
     FROM procurement_records p JOIN orders o ON o.id = p.order_id JOIN order_items i ON i.id = p.order_item_id JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.purchased_at >= ? AND p.purchased_at < ? ORDER BY p.purchased_at DESC LIMIT 5000`,
  )
    .bind(start, end)
    .all<{ purchased_at: string; order_number: string; product_name: string; variant_label: string; supplier: string; purchased_quantity: number; unit: string; total_cost_paise: number; responsible_employee: string; invoice_reference: string }>()
  return respond(c, 'procurement', results.map((row) => ({
    purchased_at: row.purchased_at,
    order: row.order_number,
    product: `${row.product_name} (${row.variant_label})`,
    supplier: row.supplier,
    quantity: `${row.purchased_quantity} ${row.unit}`,
    cost: rupees(row.total_cost_paise),
    bought_by: row.responsible_employee,
    invoice: row.invoice_reference,
  })))
})

adminFinanceRoutes.get('/reports/refunds', requirePermission('reports.read'), async (c) => {
  const { from, to } = range(c)
  const { start, end } = istRangeToUtc(from, to)
  const { results } = await c.env.DB.prepare(
    `SELECT p.created_at, o.order_number, p.method, p.amount_paise, p.txn_ref, p.notes, u.name AS recorded_by
     FROM payment_records p JOIN orders o ON o.id = p.order_id LEFT JOIN users u ON u.id = p.verified_by
     WHERE p.kind = 'REFUND' AND p.created_at >= ? AND p.created_at < ? ORDER BY p.created_at DESC`,
  )
    .bind(start, end)
    .all<{ created_at: string; order_number: string; method: string; amount_paise: number; txn_ref: string; notes: string; recorded_by: string }>()
  return respond(c, 'refunds', results.map((row) => ({
    refunded_at: row.created_at,
    order: row.order_number,
    method: row.method,
    amount: rupees(row.amount_paise),
    reference: row.txn_ref,
    notes: row.notes,
    recorded_by: row.recorded_by,
  })))
})

adminFinanceRoutes.get('/reports/expenses', requirePermission('reports.read'), async (c) => {
  const { from, to } = range(c)
  const { results } = await c.env.DB.prepare(
    `SELECT e.expense_date, e.category, e.amount_paise, e.description, o.order_number
     FROM business_expenses e LEFT JOIN orders o ON o.id = e.order_id
     WHERE e.expense_date >= ? AND e.expense_date <= ? ORDER BY e.expense_date DESC LIMIT 5000`,
  )
    .bind(from, to)
    .all<{ expense_date: string; category: string; amount_paise: number; description: string; order_number: string | null }>()
  return respond(c, 'expenses', results.map((row) => ({
    date: row.expense_date,
    category: row.category,
    amount: rupees(row.amount_paise),
    description: row.description,
    order: row.order_number ?? '',
  })))
})
