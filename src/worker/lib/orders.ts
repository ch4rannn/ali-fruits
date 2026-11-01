import { canTransition, SETTLED_STATUSES, STATUS_LABELS, type ActorKind, type OrderStatus } from '../../shared/order-state'
import { insertIfOrderStatus } from './db'
import { ApiError, newId, nowIso } from './http'

export type OrderRow = {
  id: string
  order_number: string
  tracking_token: string
  order_type: 'ORDER' | 'ENQUIRY'
  customer_id: string
  status: OrderStatus
  customer_name: string
  customer_phone: string
  customer_email: string
  pin_code: string
  locality: string
  address_line: string
  landmark: string
  instructions: string
  zone_id: string
  slot_id: string | null
  slot_label: string
  estimated_subtotal_paise: number
  estimated_delivery_paise: number
  estimated_total_paise: number
  delivery_to_be_quoted: number
  subtotal_paise: number
  delivery_fee_paise: number
  discount_paise: number
  other_charges_paise: number
  total_paise: number
  current_revision: number
  payment_preference: string
  payment_method: 'UPI' | 'COD' | null
  payment_status: string
  internal_notes: string
  customer_note: string
  delivered_at: string | null
  settled_at: string | null
  created_at: string
  updated_at: string
}

export type Actor = { kind: ActorKind; userId: string | null }

export async function getOrder(db: D1Database, id: string): Promise<OrderRow> {
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<OrderRow>()
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found.')
  return order
}

export async function getOrderByToken(db: D1Database, token: string): Promise<OrderRow> {
  const order = await db.prepare('SELECT * FROM orders WHERE tracking_token = ?').bind(token).first<OrderRow>()
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found.')
  return order
}

/**
 * Builds the two statements of a status change: the history row, then the status update. Both only
 * apply while the order is still in the status it was read in. Other statements in the same batch
 * should use insertIfOrderStatus or a status guard and run before these, and the batch result should
 * go through runTransitionBatch, so two simultaneous requests cannot both succeed.
 */
export function transitionStatements(db: D1Database, order: Pick<OrderRow, 'id' | 'status'>, to: OrderStatus, actor: Actor, reason = ''): D1PreparedStatement[] {
  if (!canTransition(order.status, to, actor.kind)) {
    throw new ApiError(409, 'INVALID_TRANSITION', `An order cannot move from "${STATUS_LABELS[order.status]}" to "${STATUS_LABELS[to]}".`)
  }
  const now = nowIso()
  const sets = ['status = ?', 'updated_at = ?']
  const values: Array<string | null> = [to, now]
  if (SETTLED_STATUSES.includes(to)) {
    sets.push('settled_at = ?')
    values.push(now)
  } else if (order.status === 'FAILED_DELIVERY' && to === 'READY_FOR_PICKUP') {
    sets.push('settled_at = NULL') // A retry reopens the order, so it is dated when it finishes.
  }
  if (to === 'DELIVERED') {
    sets.push('delivered_at = ?')
    values.push(now)
  }
  return [
    insertIfOrderStatus(
      db,
      'order_status_history',
      {
        id: newId(),
        order_id: order.id,
        previous_status: order.status,
        new_status: to,
        changed_by_kind: actor.kind,
        changed_by_user_id: actor.userId,
        reason,
        created_at: now,
      },
      order.id,
      order.status,
    ),
    db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ? AND status = ?`).bind(...values, order.id, order.status),
  ]
}

/** Runs a batch containing a guarded status update at transitionIndex, and reports a lost race clearly. */
export async function runTransitionBatch(db: D1Database, statements: D1PreparedStatement[], transitionIndex: number): Promise<void> {
  const results = await db.batch(statements)
  if ((results[transitionIndex]?.meta.changes ?? 0) === 0) {
    throw new ApiError(409, 'ORDER_CHANGED', 'This order was just changed by someone else. Refresh and try again.')
  }
}

/** Recalculates payment status from records. Refund states are left alone because staff control them. */
export function paymentStatusStatement(db: D1Database, orderId: string): D1PreparedStatement {
  const received = `(SELECT COALESCE(SUM(amount_paise), 0) FROM payment_records p
    WHERE p.order_id = orders.id AND p.kind = 'PAYMENT'
      AND (p.status = 'VERIFIED' OR (p.method = 'COD' AND p.collected_at IS NOT NULL AND p.status <> 'FAILED')))`
  return db
    .prepare(
      `UPDATE orders SET updated_at = ?, payment_status = CASE
         WHEN ${received} >= total_paise AND total_paise > 0 THEN 'PAID'
         WHEN ${received} > 0 THEN 'PARTIALLY_PAID'
         WHEN EXISTS (SELECT 1 FROM payment_records p WHERE p.order_id = orders.id AND p.kind = 'PAYMENT' AND p.status = 'FAILED')
           AND NOT EXISTS (SELECT 1 FROM payment_records p WHERE p.order_id = orders.id AND p.kind = 'PAYMENT' AND p.status = 'PENDING') THEN 'FAILED'
         ELSE 'PENDING' END
       WHERE id = ? AND payment_status NOT IN ('REFUND_PENDING', 'REFUNDED')`,
    )
    .bind(nowIso(), orderId)
}

export const ACTIVE_LINE = "line_status IN ('CONFIRMED', 'ADDED')"
