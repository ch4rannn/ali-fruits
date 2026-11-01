export type ZoneFeeRules = {
  delivery_charge_paise: number
  small_order_below_paise: number
  small_order_charge_paise: number
  free_above_paise: number | null
  quote_only: number | boolean
}

/** Fee from the zone's admin-set rules. Quote-only zones return null: staff set the fee during review. */
export function calculateDeliveryFee(zone: ZoneFeeRules, subtotalPaise: number): number | null {
  if (zone.quote_only) return null
  if (zone.free_above_paise !== null && subtotalPaise >= zone.free_above_paise) return 0
  if (subtotalPaise < zone.small_order_below_paise) return zone.small_order_charge_paise
  return zone.delivery_charge_paise
}

export function orderTotal(parts: { subtotal: number; delivery: number; other?: number; discount?: number }): number {
  return Math.max(0, parts.subtotal + parts.delivery + (parts.other ?? 0) - (parts.discount ?? 0))
}

/** Splits a batch cost across orders with no paise lost. The first orders absorb any remainder. */
export function allocateCost(totalPaise: number, count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor(totalPaise / count)
  const remainder = totalPaise - base * count
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0))
}

export type OrderMoney = {
  delivered: boolean
  subtotal: number
  deliveryFee: number
  otherCharges: number
  discount: number
  fruitCost: number
  packaging: number
  ownRider: number
  thirdParty: number
  refunds: number
  otherVariable: number
}

/**
 * Revenue only counts once an order is delivered, but costs always count: fruit bought for
 * a cancelled order is still money spent. Discounts reduce revenue once and are not also
 * counted as a cost. Refunds only count as a cost when revenue was recognised, otherwise
 * they are simply money being returned.
 */
export function orderFinancials(m: OrderMoney) {
  const fruitRevenue = m.delivered ? m.subtotal : 0
  const revenue = m.delivered ? orderTotal({ subtotal: m.subtotal, delivery: m.deliveryFee, other: m.otherCharges, discount: m.discount }) : 0
  const refundCost = m.delivered ? m.refunds : 0
  const deliveryCost = m.ownRider + m.thirdParty
  const variableCost = m.fruitCost + m.packaging + deliveryCost + refundCost + m.otherVariable
  return {
    revenue,
    fruitRevenue,
    fruitCost: m.fruitCost,
    grossProfit: fruitRevenue - m.fruitCost,
    packaging: m.packaging,
    deliveryCost,
    refundCost,
    otherVariable: m.otherVariable,
    variableCost,
    contribution: revenue - variableCost,
  }
}

export function grossMarginPercent(grossProfit: number, fruitRevenue: number): number | null {
  if (fruitRevenue <= 0) return null
  return Math.round((grossProfit / fruitRevenue) * 1000) / 10
}
