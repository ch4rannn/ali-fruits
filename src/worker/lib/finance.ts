import { grossMarginPercent, orderFinancials } from '../../shared/pricing'
import { istDate, istRangeToUtc } from '../../shared/time'

export type FinanceRow = {
  id: string
  order_number: string
  status: string
  customer_id: string
  locality: string
  settled_at: string
  delivered_at: string | null
  subtotal_paise: number
  delivery_fee_paise: number
  other_charges_paise: number
  discount_paise: number
  fruit_cost: number
  packaging: number
  own_rider: number
  third_party: number
  refunds: number
  other_variable: number
}

/**
 * Each order is dated by when it finished (delivered, cancelled, rejected or failed), so its revenue
 * and costs land in the same period. Orders still in progress are not in any report yet.
 */
export async function loadFinanceRows(db: D1Database, from: string, to: string): Promise<FinanceRow[]> {
  const { start, end } = istRangeToUtc(from, to)
  const expense = (category: string) =>
    `COALESCE((SELECT SUM(e.amount_paise) FROM business_expenses e WHERE e.order_id = o.id AND e.category = '${category}'), 0)`
  const delivery = (mode: string) =>
    `COALESCE((SELECT SUM(d.actual_cost_paise) FROM deliveries d WHERE d.order_id = o.id AND d.mode = '${mode}' AND d.status <> 'CANCELLED'), 0)`
  const { results } = await db
    .prepare(
      `SELECT o.id, o.order_number, o.status, o.customer_id, o.locality, o.settled_at, o.delivered_at,
              o.subtotal_paise, o.delivery_fee_paise, o.other_charges_paise, o.discount_paise,
              COALESCE((SELECT SUM(p.total_cost_paise) FROM procurement_records p WHERE p.order_id = o.id), 0) AS fruit_cost,
              ${expense('PACKAGING')} AS packaging,
              ${delivery('OWN_RIDER')} + ${expense('RIDER')} AS own_rider,
              ${delivery('THIRD_PARTY')} + ${expense('THIRD_PARTY_DELIVERY')} AS third_party,
              COALESCE((SELECT SUM(r.amount_paise) FROM payment_records r WHERE r.order_id = o.id AND r.kind = 'REFUND' AND r.status = 'VERIFIED'), 0) AS refunds,
              ${expense('OTHER_VARIABLE')} AS other_variable
       FROM orders o
       WHERE o.settled_at >= ? AND o.settled_at < ? AND o.order_type = 'ORDER'
       ORDER BY o.settled_at`,
    )
    .bind(start, end)
    .all<FinanceRow>()
  return results
}

export function rowFinancials(row: FinanceRow) {
  return orderFinancials({
    delivered: Boolean(row.delivered_at),
    subtotal: row.subtotal_paise,
    deliveryFee: row.delivery_fee_paise,
    otherCharges: row.other_charges_paise,
    discount: row.discount_paise,
    fruitCost: row.fruit_cost,
    packaging: row.packaging,
    ownRider: row.own_rider,
    thirdParty: row.third_party,
    refunds: row.refunds,
    otherVariable: row.other_variable,
  })
}

export function summarize(rows: FinanceRow[]) {
  const totals = {
    revenue: 0,
    fruitRevenue: 0,
    fruitCost: 0,
    grossProfit: 0,
    packaging: 0,
    deliveryCost: 0,
    refundCost: 0,
    otherVariable: 0,
    contribution: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    settledOrders: rows.length,
  }
  for (const row of rows) {
    const f = rowFinancials(row)
    totals.revenue += f.revenue
    totals.fruitRevenue += f.fruitRevenue
    totals.fruitCost += f.fruitCost
    totals.grossProfit += f.grossProfit
    totals.packaging += f.packaging
    totals.deliveryCost += f.deliveryCost
    totals.refundCost += f.refundCost
    totals.otherVariable += f.otherVariable
    totals.contribution += f.contribution
    if (row.delivered_at) totals.completedOrders += 1
    if (row.status === 'CANCELLED' || row.status === 'REJECTED') totals.cancelledOrders += 1
  }
  return {
    ...totals,
    grossMarginPercent: grossMarginPercent(totals.grossProfit, totals.fruitRevenue),
    averageOrderValue: totals.completedOrders ? Math.round(totals.revenue / totals.completedOrders) : 0,
    averageContribution: totals.completedOrders ? Math.round(totals.contribution / totals.completedOrders) : 0,
    cancellationRate: rows.length ? Math.round((totals.cancelledOrders / rows.length) * 1000) / 10 : 0,
  }
}

export function periodKey(iso: string, groupBy: 'day' | 'week' | 'month'): string {
  const day = istDate(new Date(iso))
  if (groupBy === 'day') return day
  if (groupBy === 'month') return day.slice(0, 7)
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)) // Monday of that week
  return date.toISOString().slice(0, 10)
}

/** Expenses not tied to an order. Variable ones reduce contribution, while fixed ones are shown separately. */
export async function unlinkedExpenses(db: D1Database, from: string, to: string) {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN category <> 'FIXED' THEN amount_paise END), 0) AS variable,
              COALESCE(SUM(CASE WHEN category = 'FIXED' THEN amount_paise END), 0) AS fixed
       FROM business_expenses WHERE order_id IS NULL AND expense_date >= ? AND expense_date <= ?`,
    )
    .bind(from, to)
    .first<{ variable: number; fixed: number }>()
  return { variable: row?.variable ?? 0, fixed: row?.fixed ?? 0 }
}

/** Of the customers who received an order in this period, how many have received more than one ever. */
export async function repeatCustomers(db: D1Database, from: string, to: string) {
  const { start, end } = istRangeToUtc(from, to)
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS customers, COALESCE(SUM(CASE WHEN lifetime > 1 THEN 1 ELSE 0 END), 0) AS repeat_customers FROM (
         SELECT o.customer_id, (SELECT COUNT(*) FROM orders x WHERE x.customer_id = o.customer_id AND x.delivered_at IS NOT NULL) AS lifetime
         FROM orders o WHERE o.delivered_at >= ? AND o.delivered_at < ? GROUP BY o.customer_id
       )`,
    )
    .bind(start, end)
    .first<{ customers: number; repeat_customers: number }>()
  const customers = row?.customers ?? 0
  const repeat = row?.repeat_customers ?? 0
  return { customers, repeatCustomers: repeat, repeatRate: customers ? Math.round((repeat / customers) * 1000) / 10 : 0 }
}
