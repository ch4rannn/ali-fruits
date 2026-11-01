import { allocateCost } from '../../shared/pricing'
import { insert, insertIfOrderStatus, update } from './db'
import { ApiError, newId, nowIso, siteUrl, type AppContext } from './http'
import { notifyStatement } from './notify'
import { getOrder, paymentStatusStatement, runTransitionBatch, transitionStatements, type Actor } from './orders'
import { rateLimit } from './rate-limit'
import { loadSettings } from './settings'

export type DeliveryRow = {
  id: string
  order_id: string
  batch_id: string | null
  mode: 'OWN_RIDER' | 'THIRD_PARTY'
  rider_id: string | null
  provider: string
  status: 'ASSIGNED' | 'ACCEPTED' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'CANCELLED'
  actual_cost_paise: number
  delivery_otp: string | null
}

export function deliveryEvent(db: D1Database, deliveryId: string, status: string, note: string, userId: string | null): D1PreparedStatement {
  return insert(db, 'delivery_events', { id: newId(), delivery_id: deliveryId, status, note, changed_by_user_id: userId, created_at: nowIso() })
}

/** Re-splits a batch's cost across the deliveries still in it, so a dropped order costs nothing. */
export async function reallocateBatch(db: D1Database, batchId: string, excludeDeliveryId?: string): Promise<D1PreparedStatement[]> {
  const batch = await db.prepare('SELECT total_cost_paise FROM delivery_batches WHERE id = ?').bind(batchId).first<{ total_cost_paise: number }>()
  const { results } = await db
    .prepare("SELECT id FROM deliveries WHERE batch_id = ? AND status <> 'CANCELLED' AND id <> ? ORDER BY created_at, id")
    .bind(batchId, excludeDeliveryId ?? '')
    .all<{ id: string }>()
  const shares = allocateCost(batch?.total_cost_paise ?? 0, results.length)
  return results.map((row, index) => update(db, 'deliveries', { actual_cost_paise: shares[index]!, updated_at: nowIso() }, 'id = ?', row.id))
}

type AdvanceOptions = {
  actor: Actor
  note?: string
  otp?: string
  enforceOtp: boolean
  codCollectedPaise?: number
  actualCostPaise?: number
}

const NEXT: Record<'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED', { from: DeliveryRow['status'][]; order: 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED_DELIVERY' }> = {
  PICKED_UP: { from: ['ASSIGNED', 'ACCEPTED'], order: 'PICKED_UP' },
  OUT_FOR_DELIVERY: { from: ['PICKED_UP'], order: 'OUT_FOR_DELIVERY' },
  DELIVERED: { from: ['OUT_FOR_DELIVERY'], order: 'DELIVERED' },
  FAILED: { from: ['PICKED_UP', 'OUT_FOR_DELIVERY'], order: 'FAILED_DELIVERY' },
}

/** Moves a delivery and its order together, for riders and for managers updating third-party bookings. */
export async function advanceDelivery(c: AppContext, delivery: DeliveryRow, action: keyof typeof NEXT, options: AdvanceOptions): Promise<void> {
  const db = c.env.DB
  const step = NEXT[action]
  if (!step.from.includes(delivery.status)) {
    throw new ApiError(409, 'INVALID_DELIVERY_STEP', 'This delivery cannot make that change from its current status.')
  }
  const order = await getOrder(db, delivery.order_id)
  const settings = await loadSettings(db)
  const ctx = { db, brand: settings.brand_name ?? '', baseUrl: siteUrl(c) }
  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  const after: D1PreparedStatement[] = []

  if (action === 'DELIVERED') {
    if (options.enforceOtp && delivery.delivery_otp) {
      await rateLimit(c, 'delivery-otp', 6, 600, delivery.id)
      if (options.otp !== delivery.delivery_otp) throw new ApiError(422, 'WRONG_OTP', 'That delivery code is not correct. Ask the customer to check their order page.')
    }
    if (order.payment_method === 'COD') {
      if (options.codCollectedPaise === undefined) throw new ApiError(422, 'COD_AMOUNT_REQUIRED', 'Enter the cash collected from the customer.')
      if (options.codCollectedPaise > 0) {
        statements.push(
          insertIfOrderStatus(db, 'payment_records', {
            id: newId(),
            order_id: order.id,
            kind: 'PAYMENT',
            method: 'COD',
            amount_paise: options.codCollectedPaise,
            status: 'PENDING', // Finance confirms when the rider hands over the cash.
            source: 'RIDER',
            collected_at: now,
            notes: options.note ?? '',
            created_at: now,
          }, order.id, order.status),
        )
      }
      after.push(paymentStatusStatement(db, order.id))
    }
  }

  statements.push(
    db
      .prepare(`UPDATE deliveries SET status = ?, failure_reason = ?, actual_cost_paise = ?, updated_at = ? WHERE id = ? AND status = ?`)
      .bind(action, action === 'FAILED' ? (options.note ?? '') : '', options.actualCostPaise ?? delivery.actual_cost_paise, now, delivery.id, delivery.status),
    deliveryEvent(db, delivery.id, action, options.note ?? '', options.actor.userId),
  )
  const index = statements.length + 1
  statements.push(...transitionStatements(db, order, step.order, options.actor, options.note ?? ''), ...after)
  if (action === 'OUT_FOR_DELIVERY') statements.push(notifyStatement(ctx, 'OUT_FOR_DELIVERY', order))
  if (action === 'DELIVERED') statements.push(notifyStatement(ctx, 'DELIVERED', order))
  if (action === 'FAILED') statements.push(notifyStatement(ctx, 'DELIVERY_FAILED', order, { reason: options.note }))
  await runTransitionBatch(db, statements, index)
}

/** Takes an order off a rider before pickup: it returns to the ready list for reassignment. */
export async function releaseDelivery(c: AppContext, delivery: DeliveryRow, actor: Actor, note: string): Promise<void> {
  const db = c.env.DB
  if (delivery.status !== 'ASSIGNED' && delivery.status !== 'ACCEPTED') {
    throw new ApiError(409, 'CANNOT_RELEASE', 'This delivery has already been picked up.')
  }
  const order = await getOrder(db, delivery.order_id)
  const realloc = delivery.batch_id ? await reallocateBatch(db, delivery.batch_id, delivery.id) : []
  const statements = [
    db.prepare("UPDATE deliveries SET status = 'CANCELLED', actual_cost_paise = 0, notes = ?, updated_at = ? WHERE id = ?").bind(note, nowIso(), delivery.id),
    deliveryEvent(db, delivery.id, 'CANCELLED', note, actor.userId),
    ...realloc,
  ]
  const index = statements.length + 1
  statements.push(...transitionStatements(db, order, 'READY_FOR_PICKUP', actor, note))
  await runTransitionBatch(db, statements, index)
}
