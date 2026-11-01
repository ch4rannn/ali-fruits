import { Hono } from 'hono'
import { PROCUREMENT_RECORDING_STATUSES, type OrderStatus } from '../../shared/order-state'
import { procurementInput, supplierInput } from '../../shared/schemas'
import { istRangeToUtc } from '../../shared/time'
import { auditStatement } from '../lib/audit'
import { requirePermission } from '../lib/auth'
import { insert, update } from '../lib/db'
import { ApiError, newId, nowIso, pageParams, parseBody, type AppEnv } from '../lib/http'
import { ACTIVE_LINE, getOrder } from '../lib/orders'

export const adminProcurementRoutes = new Hono<AppEnv>()

/** Orders that are approved and ready to buy for, or being bought for. */
adminProcurementRoutes.get('/queue', requirePermission('procurement.write'), async (c) => {
  const db = c.env.DB
  const [orders, items, records] = await db.batch<Record<string, unknown>>([
    db.prepare(
      `SELECT id, order_number, status, customer_name, locality, slot_label, payment_method, payment_status, total_paise, created_at
       FROM orders WHERE status IN ('CONFIRMED','PROCUREMENT_IN_PROGRESS','PROCUREMENT_COMPLETED') ORDER BY created_at LIMIT 100`,
    ),
    db.prepare(
      `SELECT i.id, i.order_id, i.product_id, i.product_name, i.variant_label, i.confirmed_qty, i.confirmed_unit_price_paise, v.unit_kind, v.unit_size, v.wholesale_price_paise
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN product_variants v ON v.id = i.variant_id
       WHERE o.status IN ('CONFIRMED','PROCUREMENT_IN_PROGRESS','PROCUREMENT_COMPLETED') AND i.${ACTIVE_LINE}`,
    ),
    db.prepare(
      `SELECT p.*, s.name AS supplier_name FROM procurement_records p JOIN suppliers s ON s.id = p.supplier_id JOIN orders o ON o.id = p.order_id
       WHERE o.status IN ('CONFIRMED','PROCUREMENT_IN_PROGRESS','PROCUREMENT_COMPLETED')`,
    ),
  ])
  const itemRows = items!.results as Array<{ order_id: string }>
  const recordRows = records!.results as Array<{ order_id: string }>
  return c.json({
    orders: (orders!.results as Array<{ id: string }>).map((order) => ({
      ...order,
      items: itemRows.filter((item) => item.order_id === order.id),
      records: recordRows.filter((record) => record.order_id === order.id),
    })),
  })
})

adminProcurementRoutes.get('/records', requirePermission('costs.read'), async (c) => {
  const { limit, offset, page, pageSize } = pageParams(c)
  const { from, to } = c.req.query()
  const db = c.env.DB
  const range = from && to ? istRangeToUtc(from, to) : null
  const clause = range ? 'WHERE p.purchased_at >= ? AND p.purchased_at < ?' : ''
  const params = range ? [range.start, range.end] : []
  const [rows, count] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT p.*, s.name AS supplier_name, o.order_number, i.product_name, i.variant_label
         FROM procurement_records p JOIN suppliers s ON s.id = p.supplier_id JOIN orders o ON o.id = p.order_id JOIN order_items i ON i.id = p.order_item_id
         ${clause} ORDER BY p.purchased_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM procurement_records p ${clause}`).bind(...params),
  ])
  return c.json({ records: rows!.results, total: (count!.results[0] as { total: number }).total, page, pageSize })
})

adminProcurementRoutes.post('/orders/:orderId/records', requirePermission('procurement.write'), async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const body = await parseBody(c, procurementInput)
  const order = await getOrder(db, c.req.param('orderId'))
  // No purchase can be recorded for an order the customer has not approved, or has since rejected.
  if (!PROCUREMENT_RECORDING_STATUSES.includes(order.status as OrderStatus)) {
    throw new ApiError(409, 'PROCUREMENT_NOT_ALLOWED', 'Start procurement on an approved order before recording purchases.')
  }
  const item = await db
    .prepare(`SELECT id, product_id FROM order_items WHERE id = ? AND order_id = ? AND ${ACTIVE_LINE}`)
    .bind(body.orderItemId, order.id)
    .first<{ id: string; product_id: string }>()
  if (!item) throw new ApiError(422, 'UNKNOWN_ITEM', 'That item is not part of this confirmed order.')
  const supplier = await db.prepare('SELECT id FROM suppliers WHERE id = ?').bind(body.supplierId).first()
  if (!supplier) throw new ApiError(422, 'UNKNOWN_SUPPLIER', 'Choose a supplier from the list.')
  const id = newId()
  const now = nowIso()
  await db.batch([
    insert(db, 'procurement_records', {
      id,
      order_id: order.id,
      order_item_id: item.id,
      product_id: item.product_id,
      supplier_id: body.supplierId,
      purchased_quantity: body.purchasedQuantity,
      unit: body.unit,
      purchase_price_paise: body.purchasePricePaise ?? null,
      total_cost_paise: body.totalCostPaise,
      purchased_at: body.purchasedAt ?? now,
      responsible_employee: body.responsibleEmployee || user.name,
      invoice_reference: body.invoiceReference,
      notes: body.notes,
      created_by: user.id,
      created_at: now,
    }),
    auditStatement(db, user, 'RECORD_PROCUREMENT', 'order', order.id, { recordId: id, totalCostPaise: body.totalCostPaise }),
  ])
  return c.json({ id }, 201)
})

/** Corrects a mistyped purchase. Only possible until buying is marked complete, and always audited. */
adminProcurementRoutes.delete('/records/:id', requirePermission('procurement.write'), async (c) => {
  const db = c.env.DB
  const record = await db
    .prepare('SELECT p.id, p.order_id, p.total_cost_paise, o.status FROM procurement_records p JOIN orders o ON o.id = p.order_id WHERE p.id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string; order_id: string; total_cost_paise: number; status: string }>()
  if (!record) throw new ApiError(404, 'NOT_FOUND', 'Record not found.')
  if (record.status !== 'PROCUREMENT_IN_PROGRESS') throw new ApiError(409, 'RECORD_LOCKED', 'This record is locked because buying has been completed.')
  await db.batch([
    db.prepare('DELETE FROM procurement_records WHERE id = ?').bind(record.id),
    auditStatement(db, c.get('user'), 'DELETE_PROCUREMENT', 'order', record.order_id, { recordId: record.id, totalCostPaise: record.total_cost_paise }),
  ])
  return c.json({ ok: true })
})

// Suppliers

adminProcurementRoutes.get('/suppliers', requirePermission('procurement.write', 'costs.read'), async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM suppliers ORDER BY is_active DESC, name').all()
  return c.json({ suppliers: results })
})

adminProcurementRoutes.post('/suppliers', requirePermission('procurement.write'), async (c) => {
  const body = await parseBody(c, supplierInput)
  const db = c.env.DB
  const id = newId()
  const now = nowIso()
  await db.batch([
    insert(db, 'suppliers', { id, name: body.name, phone: body.phone, notes: body.notes, is_active: body.isActive ? 1 : 0, created_at: now, updated_at: now }),
    auditStatement(db, c.get('user'), 'CREATE_SUPPLIER', 'supplier', id, { name: body.name }),
  ])
  return c.json({ id }, 201)
})

adminProcurementRoutes.put('/suppliers/:id', requirePermission('procurement.write'), async (c) => {
  const body = await parseBody(c, supplierInput)
  const db = c.env.DB
  const id = c.req.param('id')
  await db.batch([
    update(db, 'suppliers', { name: body.name, phone: body.phone, notes: body.notes, is_active: body.isActive ? 1 : 0, updated_at: nowIso() }, 'id = ?', id),
    auditStatement(db, c.get('user'), 'UPDATE_SUPPLIER', 'supplier', id, { name: body.name }),
  ])
  return c.json({ ok: true })
})
