import { describe, expect, it } from 'vitest'
import { formatINR, rupeesToPaise } from '../src/shared/money'
import { canTransition, ORDER_STATUSES, ORDER_TRANSITIONS } from '../src/shared/order-state'
import { can } from '../src/shared/permissions'
import { allocateCost, calculateDeliveryFee, grossMarginPercent, orderFinancials, orderTotal } from '../src/shared/pricing'
import { checkoutRequest, indianPhone } from '../src/shared/schemas'
import { istDate, istRangeToUtc, presetRange } from '../src/shared/time'

const zone = { delivery_charge_paise: 2500, small_order_below_paise: 19900, small_order_charge_paise: 3000, free_above_paise: 39900, quote_only: 0 }

describe('money', () => {
  it('formats paise as rupees', () => {
    expect(formatINR(18000)).toContain('180')
    expect(formatINR(18050)).toContain('180.50')
  })
  it('avoids floating point drift when converting', () => {
    expect(rupeesToPaise('19.99')).toBe(1999)
    expect(rupeesToPaise(0.07)).toBe(7)
  })
})

describe('delivery fees', () => {
  it('applies the small-order, normal and free tiers from zone settings', () => {
    expect(calculateDeliveryFee(zone, 10000)).toBe(3000)
    expect(calculateDeliveryFee(zone, 25000)).toBe(2500)
    expect(calculateDeliveryFee(zone, 39900)).toBe(0)
  })
  it('leaves long-distance fees to be quoted by staff', () => {
    expect(calculateDeliveryFee({ ...zone, quote_only: 1 }, 25000)).toBeNull()
  })
  it('never produces a negative total', () => {
    expect(orderTotal({ subtotal: 100, delivery: 0, discount: 500 })).toBe(0)
  })
})

describe('batch cost allocation', () => {
  it('splits a trip cost across orders with no paise lost', () => {
    expect(allocateCost(10000, 3)).toEqual([3334, 3333, 3333])
    expect(allocateCost(10000, 3).reduce((a, b) => a + b)).toBe(10000)
  })
  it('handles an empty batch', () => {
    expect(allocateCost(5000, 0)).toEqual([])
  })
})

describe('order state machine', () => {
  it('cannot reach procurement without passing through customer confirmation', () => {
    const reachable = new Set<string>(['PENDING_REVIEW'])
    let grew = true
    while (grew) {
      grew = false
      for (const from of [...reachable]) {
        for (const rule of ORDER_TRANSITIONS[from as keyof typeof ORDER_TRANSITIONS]) {
          if (rule.to !== 'CONFIRMED' && !reachable.has(rule.to)) {
            reachable.add(rule.to)
            grew = true
          }
        }
      }
    }
    expect(reachable.has('PROCUREMENT_IN_PROGRESS')).toBe(false)
    expect(reachable.has('DELIVERED')).toBe(false)
  })
  it('only lets confirmation come from the approval stage', () => {
    for (const status of ORDER_STATUSES) {
      if (status !== 'AWAITING_CUSTOMER_APPROVAL') expect(canTransition(status, 'CONFIRMED', 'staff')).toBe(false)
    }
  })
  it('limits what each actor may do', () => {
    expect(canTransition('AWAITING_CUSTOMER_APPROVAL', 'CONFIRMED', 'customer')).toBe(true)
    expect(canTransition('PENDING_REVIEW', 'AWAITING_CUSTOMER_APPROVAL', 'customer')).toBe(false)
    expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED', 'rider')).toBe(true)
    expect(canTransition('CONFIRMED', 'PROCUREMENT_IN_PROGRESS', 'rider')).toBe(false)
    expect(canTransition('PROCUREMENT_IN_PROGRESS', 'CANCELLED', 'customer')).toBe(false)
  })
  it('treats rejected and refunded orders as final', () => {
    expect(ORDER_TRANSITIONS.REJECTED).toEqual([])
    expect(ORDER_TRANSITIONS.REFUNDED).toEqual([])
  })
})

describe('financials', () => {
  const base = { subtotal: 30000, deliveryFee: 2500, otherCharges: 0, discount: 0, fruitCost: 20000, packaging: 500, ownRider: 2000, thirdParty: 0, refunds: 0, otherVariable: 0 }

  it('keeps gross profit and contribution separate, and never treats revenue as profit', () => {
    const f = orderFinancials({ ...base, delivered: true })
    expect(f.revenue).toBe(32500)
    expect(f.grossProfit).toBe(10000)
    expect(f.contribution).toBe(32500 - 20000 - 500 - 2000)
  })
  it('counts a discount once, through revenue', () => {
    const f = orderFinancials({ ...base, delivered: true, discount: 1000 })
    expect(f.revenue).toBe(31500)
    expect(f.contribution).toBe(31500 - 22500)
  })
  it('shows the loss on a cancelled order after fruit was bought', () => {
    const f = orderFinancials({ ...base, delivered: false, packaging: 0, ownRider: 0 })
    expect(f.revenue).toBe(0)
    expect(f.grossProfit).toBe(-20000)
    expect(f.contribution).toBe(-20000)
  })
  it('counts a refund as a cost only when revenue was recognised', () => {
    expect(orderFinancials({ ...base, delivered: true, refunds: 5000 }).contribution).toBe(32500 - 22500 - 5000)
    expect(orderFinancials({ ...base, delivered: false, packaging: 0, ownRider: 0, fruitCost: 0, refunds: 5000 }).contribution).toBe(0)
  })
  it('reports margin only when there are sales', () => {
    expect(grossMarginPercent(10000, 30000)).toBe(33.3)
    expect(grossMarginPercent(0, 0)).toBeNull()
  })
})

describe('India time ranges', () => {
  it('uses the India date, not the UTC date', () => {
    expect(istDate(new Date('2026-11-01T20:00:00.000Z'))).toBe('2026-11-02')
  })
  it('converts an India day to the right UTC window', () => {
    expect(istRangeToUtc('2026-11-02', '2026-11-02')).toEqual({ start: '2026-11-01T18:30:00.000Z', end: '2026-11-02T18:30:00.000Z' })
  })
  it('builds this month from the India calendar', () => {
    expect(presetRange('month', new Date('2026-10-31T20:00:00.000Z'))).toEqual({ from: '2026-11-01', to: '2026-11-01' })
  })
})

describe('validation', () => {
  it('normalises Indian mobile numbers', () => {
    expect(indianPhone.parse('+91 98765-43210')).toBe('9876543210')
    expect(indianPhone.parse('09876543210')).toBe('9876543210')
    expect(indianPhone.safeParse('12345').success).toBe(false)
    expect(indianPhone.safeParse('1234567890').success).toBe(false)
  })
  it('rejects zero or fractional checkout quantities', () => {
    const base = { idempotencyKey: crypto.randomUUID(), name: 'A', phone: '9876543210', pinCode: '140301', zoneId: 'z', slotId: 's', addressLine: 'x', paymentPreference: 'COD', termsAccepted: true }
    expect(checkoutRequest.safeParse({ ...base, items: [{ variantId: 'v', qty: 0 }] }).success).toBe(false)
    expect(checkoutRequest.safeParse({ ...base, items: [{ variantId: 'v', qty: 1.5 }] }).success).toBe(false)
    expect(checkoutRequest.safeParse({ ...base, items: [{ variantId: 'v', qty: 1 }] }).success).toBe(true)
  })
})

describe('permissions', () => {
  it('keeps riders away from every office permission', () => {
    expect(can('RIDER', 'orders.read')).toBe(false)
    expect(can('RIDER', 'costs.read')).toBe(false)
  })
  it('limits staff to their own area', () => {
    expect(can('FINANCE', 'reports.read')).toBe(true)
    expect(can('FINANCE', 'orders.write')).toBe(false)
    expect(can('DELIVERY_MANAGER', 'costs.read')).toBe(false)
    expect(can('OPERATIONS', 'staff.manage')).toBe(false)
    expect(can('ADMIN', 'golive.manage')).toBe(false)
    expect(can('SUPER_ADMIN', 'golive.manage')).toBe(true)
  })
})
