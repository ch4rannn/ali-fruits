import { calculateDeliveryFee, orderTotal } from '../../shared/pricing'
import { ApiError } from './http'

export type ZoneRow = {
  id: string
  name: string
  slug: string
  pin_codes: string
  min_order_paise: number
  delivery_charge_paise: number
  small_order_below_paise: number
  small_order_charge_paise: number
  free_above_paise: number | null
  quote_only: number
  estimated_time: string
  own_rider_enabled: number
  third_party_enabled: number
  is_active: number
}

export type QuoteLine = {
  variantId: string
  productId: string
  productName: string
  variantLabel: string
  qty: number
  unitPaise: number
  lineTotalPaise: number
  priceChanged: boolean
  issue: string | null
}

export type Quote = {
  lines: QuoteLine[]
  subtotalPaise: number
  deliveryPaise: number
  deliveryToBeQuoted: boolean
  totalPaise: number
  minimumOrderPaise: number
  belowMinimum: boolean
  hasIssues: boolean
  hasPriceChanges: boolean
}

type VariantJoin = {
  id: string
  label: string
  retail_price_paise: number
  min_qty: number
  qty_step: number
  variant_active: number
  product_id: string
  product_name: string
  availability: string
  product_active: number
}

/** The only place customer totals are calculated. Prices always come from D1, never from the browser. */
export async function buildQuote(db: D1Database, items: Array<{ variantId: string; qty: number; expectedUnitPaise?: number }>, zoneId?: string): Promise<Quote> {
  const merged = new Map<string, { qty: number; expectedUnitPaise?: number }>()
  for (const item of items) {
    const existing = merged.get(item.variantId)
    merged.set(item.variantId, { qty: (existing?.qty ?? 0) + item.qty, expectedUnitPaise: item.expectedUnitPaise ?? existing?.expectedUnitPaise })
  }
  const { results } = await db
    .prepare(
      `SELECT v.id, v.label, v.retail_price_paise, v.min_qty, v.qty_step, v.is_active AS variant_active,
              p.id AS product_id, p.name AS product_name, p.availability, p.is_active AS product_active
       FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify([...merged.keys()]))
    .all<VariantJoin>()
  const byId = new Map(results.map((row) => [row.id, row]))

  const lines: QuoteLine[] = [...merged.entries()].map(([variantId, request]) => {
    const row = byId.get(variantId)
    if (!row) {
      return { variantId, productId: '', productName: 'Unavailable item', variantLabel: '', qty: request.qty, unitPaise: 0, lineTotalPaise: 0, priceChanged: false, issue: 'This item is no longer sold.' }
    }
    let issue: string | null = null
    if (!row.product_active || !row.variant_active || row.availability !== 'AVAILABLE') issue = `${row.product_name} is not available right now.`
    else if (request.qty < row.min_qty) issue = `The minimum for ${row.product_name} (${row.label}) is ${row.min_qty}.`
    else if ((request.qty - row.min_qty) % row.qty_step !== 0) issue = `${row.product_name} (${row.label}) is sold in steps of ${row.qty_step}.`
    return {
      variantId,
      productId: row.product_id,
      productName: row.product_name,
      variantLabel: row.label,
      qty: request.qty,
      unitPaise: row.retail_price_paise,
      lineTotalPaise: row.retail_price_paise * request.qty,
      priceChanged: request.expectedUnitPaise !== undefined && request.expectedUnitPaise !== row.retail_price_paise,
      issue,
    }
  })

  const subtotalPaise = lines.filter((line) => !line.issue).reduce((sum, line) => sum + line.lineTotalPaise, 0)
  let deliveryPaise = 0
  let deliveryToBeQuoted = false
  let minimumOrderPaise = 0
  if (zoneId) {
    const zone = await db.prepare('SELECT * FROM delivery_zones WHERE id = ? AND is_active = 1').bind(zoneId).first<ZoneRow>()
    if (!zone) throw new ApiError(422, 'ZONE_UNAVAILABLE', 'We do not deliver to this area yet.')
    const fee = calculateDeliveryFee(zone, subtotalPaise)
    deliveryToBeQuoted = fee === null
    deliveryPaise = fee ?? 0
    minimumOrderPaise = zone.min_order_paise
  }
  return {
    lines,
    subtotalPaise,
    deliveryPaise,
    deliveryToBeQuoted,
    totalPaise: orderTotal({ subtotal: subtotalPaise, delivery: deliveryPaise }),
    minimumOrderPaise,
    belowMinimum: subtotalPaise < minimumOrderPaise,
    hasIssues: lines.some((line) => line.issue),
    hasPriceChanges: lines.some((line) => line.priceChanged),
  }
}
