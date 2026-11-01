import { beforeAll, describe, expect, it } from 'vitest'
import { call, checkout, createProduct, createRider, createZone, enableLiveOrders, env, ok, orderReadyForPickup, setupDatabase, testEnv } from './helpers'

let admin: string
let zone: { id: string; slotId: string }
let apple: { productId: string; variantId: string }
let banana: { productId: string; variantId: string }
let orange: { productId: string; variantId: string }
let guava: { productId: string; variantId: string }

beforeAll(async () => {
  admin = await setupDatabase()
  await enableLiveOrders()
  zone = await createZone(admin)
  apple = await createProduct(admin, 'Shimla Apple', 18000, 12000)
  banana = await createProduct(admin, 'Banana', 6000, 4000)
  orange = await createProduct(admin, 'Orange', 10000, 7000)
  guava = await createProduct(admin, 'Guava', 8000, 5000)
})

const orderIdOf = async (orderNumber: string) => (await env.DB.prepare('SELECT id FROM orders WHERE order_number = ?').bind(orderNumber).first<{ id: string }>())!.id

describe('full order: customer to admin to procurement to rider', () => {
  it('runs the whole zero-inventory workflow and calculates the money correctly', async () => {
    const catalog = await ok('/api/public/catalog')
    expect(catalog.products.map((p: { name: string }) => p.name)).toContain('Shimla Apple')
    expect(JSON.stringify(catalog)).not.toMatch(/wholesale/i)

    const body = checkout(zone, [
      { variantId: apple.variantId, qty: 1 },
      { variantId: banana.variantId, qty: 1 },
      { variantId: orange.variantId, qty: 1 },
    ])
    const placed = await call('/api/public/orders', { body })
    expect(placed.status).toBe(201)
    expect(placed.json.status).toBe('PENDING_REVIEW')
    expect(placed.json.orderNumber).toMatch(/^FR\d{6}-/)
    const token = placed.json.trackingToken as string
    const orderId = await orderIdOf(placed.json.orderNumber)

    const tracked = await ok(`/api/public/track/${token}`)
    expect(tracked.status).toBe('PENDING_REVIEW')
    expect(tracked.estimate.subtotalPaise).toBe(34000)
    expect(tracked.estimate.deliveryPaise).toBe(2500)

    // Buying fruit before review is refused.
    expect((await call(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'PROCUREMENT_IN_PROGRESS' } })).status).toBe(409)
    expect((await call(`/api/admin/procurement/orders/${orderId}/records`, { cookie: admin, body: { orderItemId: 'x', supplierId: 'sup-default', purchasedQuantity: 1, unit: 'g', totalCostPaise: 1 } })).status).toBe(409)

    // Admin finds oranges unavailable, changes the apple price and substitutes guava.
    const detail = await ok(`/api/admin/orders/${orderId}`, { cookie: admin })
    const line = (name: string) => detail.items.find((i: { product_name: string }) => i.product_name === name)
    await ok(`/api/admin/orders/${orderId}/revisions`, {
      cookie: admin,
      body: {
        reason: 'Oranges unavailable today; apple price changed at the mandi',
        deliveryFeePaise: 2500,
        items: [
          { itemId: line('Shimla Apple').id, qty: 1, unitPricePaise: 19000 },
          { itemId: line('Banana').id, qty: 2, unitPricePaise: 6000 },
          { itemId: line('Orange').id, qty: 0, unitPricePaise: 10000 },
          { variantId: guava.variantId, qty: 1, unitPricePaise: 8000, substituteForItemId: line('Orange').id },
        ],
      },
    })

    // The original request and estimate are preserved next to the revision.
    const revised = await ok(`/api/admin/orders/${orderId}`, { cookie: admin })
    expect(revised.order.status).toBe('AWAITING_CUSTOMER_APPROVAL')
    expect(revised.order.estimated_total_paise).toBe(36500)
    expect(revised.order.total_paise).toBe(19000 + 12000 + 8000 + 2500)
    const appleLine = revised.items.find((i: { product_name: string }) => i.product_name === 'Shimla Apple')
    expect(appleLine.requested_unit_price_paise).toBe(18000)
    expect(appleLine.confirmed_unit_price_paise).toBe(19000)
    const orangeLine = revised.items.find((i: { product_name: string }) => i.product_name === 'Orange')
    expect(orangeLine.line_status).toBe('REMOVED')
    expect(orangeLine.requested_qty).toBe(1)
    const guavaLine = revised.items.find((i: { product_name: string }) => i.product_name === 'Guava')
    expect(guavaLine.substitute_for_item_id).toBe(orangeLine.id)
    expect(revised.revisions[0].reason).toContain('Oranges unavailable')
    expect(revised.customerMessages[0].whatsappUrl).toContain('https://wa.me/91')

    // Still no procurement while waiting for the customer.
    expect((await call(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'PROCUREMENT_IN_PROGRESS' } })).status).toBe(409)

    // Customer approves and chooses cash on delivery.
    await ok(`/api/public/track/${token}/respond`, { body: { action: 'ACCEPT_ORDER', revision: 1, paymentMethod: 'COD' } })
    expect((await ok(`/api/public/track/${token}`)).status).toBe('CONFIRMED')

    // Procurement is recorded with real costs, and cannot complete with lines missing.
    await ok(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'PROCUREMENT_IN_PROGRESS' } })
    const incomplete = await call(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'PROCUREMENT_COMPLETED' } })
    expect(incomplete.status).toBe(409)
    expect(incomplete.json.error.code).toBe('PROCUREMENT_INCOMPLETE')
    const costs: Record<string, number> = { 'Shimla Apple': 13000, Banana: 8000, Guava: 5000 }
    for (const [name, cost] of Object.entries(costs)) {
      const item = revised.items.find((i: { product_name: string }) => i.product_name === name)
      await ok(`/api/admin/procurement/orders/${orderId}/records`, { cookie: admin, body: { orderItemId: item.id, supplierId: 'sup-default', purchasedQuantity: 1000, unit: 'g', totalCostPaise: cost } })
    }
    await ok(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'PROCUREMENT_COMPLETED' } })
    await ok(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'PACKING' } })
    await ok('/api/admin/finance/expenses', { cookie: admin, body: { category: 'PACKAGING', amountPaise: 500, expenseDate: '2026-11-01', orderId } })
    await ok(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'READY_FOR_PICKUP' } })

    // Admin assigns a rider, who works only through the rider API.
    const rider = await createRider(admin)
    await ok('/api/admin/deliveries/assign', { cookie: admin, body: { orderId, riderId: rider.riderId } })
    const list = await ok('/api/rider/deliveries', { cookie: rider.cookie })
    expect(list.open).toHaveLength(1)
    const deliveryId = list.open[0].id as string
    const view = await ok(`/api/rider/deliveries/${deliveryId}`, { cookie: rider.cookie })
    expect(view.customer.phone).toBe(body.phone)
    expect(view.payment.cashToCollectPaise).toBe(41500)
    expect(JSON.stringify(view)).not.toMatch(/wholesale|cost|internal_notes/i)

    await ok(`/api/rider/deliveries/${deliveryId}/accept`, { cookie: rider.cookie, method: 'POST' })
    await ok(`/api/rider/deliveries/${deliveryId}/pickup`, { cookie: rider.cookie, method: 'POST' })
    await ok(`/api/rider/deliveries/${deliveryId}/out`, { cookie: rider.cookie, method: 'POST' })
    expect((await ok(`/api/public/track/${token}`)).status).toBe('OUT_FOR_DELIVERY')

    // A cash order cannot be closed without saying how much was collected.
    const noCash = await call(`/api/rider/deliveries/${deliveryId}/delivered`, { cookie: rider.cookie, body: {} })
    expect(noCash.json.error.code).toBe('COD_AMOUNT_REQUIRED')
    await ok(`/api/rider/deliveries/${deliveryId}/delivered`, { cookie: rider.cookie, body: { codCollectedPaise: 41500 } })

    // The customer sees the final status, and cash collection is recorded.
    const finished = await ok(`/api/public/track/${token}`)
    expect(finished.status).toBe('DELIVERED')
    expect(finished.paymentStatus).toBe('PAID')
    expect(finished.history.map((h: { status: string }) => h.status)).toEqual(
      ['PENDING_REVIEW', 'AWAITING_CUSTOMER_APPROVAL', 'CONFIRMED', 'PROCUREMENT_IN_PROGRESS', 'PROCUREMENT_COMPLETED', 'PACKING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_RIDER', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'],
    )
    const events = await ok(`/api/admin/deliveries/${deliveryId}/events`, { cookie: admin })
    expect(events.events.map((e: { status: string }) => e.status)).toEqual(['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'])

    // Financials: revenue 41,500; fruit 26,000; packaging 500; rider 2,000 per-delivery pay.
    const final = await ok(`/api/admin/orders/${orderId}`, { cookie: admin })
    expect(final.finance.revenue).toBe(41500)
    expect(final.finance.fruitCost).toBe(26000)
    expect(final.finance.grossProfit).toBe(39000 - 26000)
    expect(final.finance.packaging).toBe(500)
    expect(final.finance.deliveryCost).toBe(2000)
    expect(final.finance.contribution).toBe(41500 - 26000 - 500 - 2000)

    // Reports and CSV export use the same figures.
    const report = await ok('/api/admin/finance/reports/orders', { cookie: admin })
    const row = report.rows.find((r: { order: string }) => r.order === placed.json.orderNumber)
    expect(row.revenue).toBe(415)
    expect(row.contribution).toBe(130)
    const csv = await call('/api/admin/finance/reports/orders?format=csv', { cookie: admin })
    expect(csv.headers.get('Content-Type')).toContain('text/csv')
    expect(csv.text).toContain(placed.json.orderNumber)
  })
})

describe('order edge cases', () => {
  it('refuses unavailable fruit at checkout', async () => {
    const off = await createProduct(admin, 'Off Season Mango', 20000, 15000, 'SEASONAL')
    const result = await call('/api/public/orders', { body: checkout(zone, [{ variantId: off.variantId, qty: 1 }]) })
    expect(result.status).toBe(422)
    expect(result.json.error.code).toBe('CART_INVALID')
  })

  it('asks the customer to accept a changed price before submitting', async () => {
    const fruit = await createProduct(admin, 'Price Change Plum', 15000)
    await ok('/api/admin/catalog/pricing', { cookie: admin, body: { prices: [{ variantId: fruit.variantId, retailPricePaise: 17000 }] } })
    const stale = await call('/api/public/orders', { body: checkout(zone, [{ variantId: fruit.variantId, qty: 1, expectedUnitPaise: 15000 }]) })
    expect(stale.status).toBe(409)
    expect(stale.json.error.code).toBe('PRICE_CHANGED')
    expect(stale.json.error.details.lines[0].unitPaise).toBe(17000)
    const accepted = await call('/api/public/orders', { body: checkout(zone, [{ variantId: fruit.variantId, qty: 1, expectedUnitPaise: 17000 }]) })
    expect(accepted.status).toBe(201)
  })

  it('ignores any price or total a browser tries to send', async () => {
    const result = await ok('/api/public/orders', {
      body: { ...checkout(zone, [{ variantId: apple.variantId, qty: 1 }]), unitPricePaise: 1, totalPaise: 1, estimated_total_paise: 1 },
    })
    const order = await env.DB.prepare('SELECT estimated_subtotal_paise FROM orders WHERE order_number = ?').bind(result.orderNumber).first<{ estimated_subtotal_paise: number }>()
    expect(order!.estimated_subtotal_paise).toBe(18000)
  })

  it('treats a repeated submission as one order', async () => {
    const body = checkout(zone, [{ variantId: apple.variantId, qty: 1 }])
    const first = await call('/api/public/orders', { body })
    const second = await call('/api/public/orders', { body })
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(second.json.duplicate).toBe(true)
    expect(second.json.orderNumber).toBe(first.json.orderNumber)
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM orders WHERE idempotency_key = ?').bind(body.idempotencyKey).first<{ total: number }>()
    expect(count!.total).toBe(1)
  })

  it('refuses invalid quantities and steps', async () => {
    const zero = await call('/api/public/orders', { body: checkout(zone, [{ variantId: apple.variantId, qty: 0 }]) })
    expect(zero.status).toBe(422)
    const { id } = await ok('/api/admin/catalog/products', {
      cookie: admin,
      body: { name: 'Stepped Grapes', categoryId: 'cat-grapes', variants: [{ label: '500 g', unitKind: 'WEIGHT', unitSize: 500, retailPricePaise: 5000, minQty: 2, qtyStep: 2 }] },
    })
    const variant = await env.DB.prepare('SELECT id FROM product_variants WHERE product_id = ?').bind(id).first<{ id: string }>()
    expect((await call('/api/public/orders', { body: checkout(zone, [{ variantId: variant!.id, qty: 1 }]) })).status).toBe(422)
    expect((await call('/api/public/orders', { body: checkout(zone, [{ variantId: variant!.id, qty: 3 }]) })).status).toBe(422)
    expect((await call('/api/public/orders', { body: checkout(zone, [{ variantId: variant!.id, qty: 4 }]) })).status).toBe(201)
  })

  it('checks that the area and PIN code are served', async () => {
    const wrongPin = await call('/api/public/orders', { body: checkout(zone, [{ variantId: apple.variantId, qty: 1 }], { pinCode: '110001' }) })
    expect(wrongPin.json.error.code).toBe('PIN_NOT_SERVICED')
    const inactive = await ok('/api/admin/system/zones', {
      cookie: admin,
      body: { name: 'Not Yet Served', pinCodes: '140413', isActive: false, slots: [{ label: 'Evening', isActive: true }] },
    })
    const closed = await call('/api/public/orders', { body: checkout({ id: inactive.id, slotId: 'x' }, [{ variantId: apple.variantId, qty: 1 }], { pinCode: '140413' }) })
    expect(closed.json.error.code).toBe('ZONE_UNAVAILABLE')
    const zones = await ok('/api/public/zones')
    expect(zones.zones.map((z: { name: string }) => z.name)).not.toContain('Not Yet Served')
  })

  async function pendingApproval() {
    const placed = await ok('/api/public/orders', { body: checkout(zone, [{ variantId: apple.variantId, qty: 1 }]) })
    const orderId = await orderIdOf(placed.orderNumber)
    const item = await env.DB.prepare('SELECT id FROM order_items WHERE order_id = ?').bind(orderId).first<{ id: string }>()
    await ok(`/api/admin/orders/${orderId}/revisions`, { cookie: admin, body: { reason: 'Checked', deliveryFeePaise: 2500, items: [{ itemId: item!.id, qty: 1, unitPricePaise: 18000 }] } })
    return { token: placed.trackingToken as string, orderId, itemId: item!.id }
  }

  it('stops all procurement once the customer rejects', async () => {
    const { token, orderId, itemId } = await pendingApproval()
    await ok(`/api/public/track/${token}/respond`, { body: { action: 'REJECT_ORDER', revision: 1, note: 'Too expensive' } })
    expect((await ok(`/api/public/track/${token}`)).status).toBe('REJECTED')
    expect((await call(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'PROCUREMENT_IN_PROGRESS' } })).status).toBe(409)
    const record = await call(`/api/admin/procurement/orders/${orderId}/records`, { cookie: admin, body: { orderItemId: itemId, supplierId: 'sup-default', purchasedQuantity: 1, unit: 'g', totalCostPaise: 1 } })
    expect(record.status).toBe(409)
  })

  it('sends a change request back to review and keeps revision history', async () => {
    const { token, orderId, itemId } = await pendingApproval()
    await ok(`/api/public/track/${token}/respond`, { body: { action: 'REQUEST_CHANGE', revision: 1, note: 'Please send 2 kg' } })
    const after = await ok(`/api/admin/orders/${orderId}`, { cookie: admin })
    expect(after.order.status).toBe('PENDING_REVIEW')
    expect(after.order.customer_note).toBe('Please send 2 kg')

    await ok(`/api/admin/orders/${orderId}/revisions`, { cookie: admin, body: { reason: 'Changed to 2 kg', deliveryFeePaise: 2500, items: [{ itemId, qty: 2, unitPricePaise: 18000 }] } })
    // Approving the old version is refused, so nobody approves a price they did not see.
    const stale = await call(`/api/public/track/${token}/respond`, { body: { action: 'ACCEPT_ORDER', revision: 1, paymentMethod: 'COD' } })
    expect(stale.json.error.code).toBe('REVISION_OUTDATED')
    await ok(`/api/public/track/${token}/respond`, { body: { action: 'ACCEPT_ORDER', revision: 2, paymentMethod: 'COD' } })
    const final = await ok(`/api/admin/orders/${orderId}`, { cookie: admin })
    expect(final.revisions).toHaveLength(2)
    expect(final.revisions[1].customer_response).toBe('REQUEST_CHANGE')
    expect(final.revisions[0].customer_response).toBe('ACCEPT_ORDER')
  })

  it('lets a customer cancel before buying starts, but not after', async () => {
    const { token, orderId } = await pendingApproval()
    await ok(`/api/public/track/${token}/respond`, { body: { action: 'ACCEPT_ORDER', revision: 1, paymentMethod: 'COD' } })
    await ok(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'PROCUREMENT_IN_PROGRESS' } })
    expect((await call(`/api/public/track/${token}/cancel`, { method: 'POST' })).status).toBe(409)

    const early = await ok('/api/public/orders', { body: checkout(zone, [{ variantId: apple.variantId, qty: 1 }]) })
    await ok(`/api/public/track/${early.trackingToken}/cancel`, { method: 'POST' })
    expect((await ok(`/api/public/track/${early.trackingToken}`)).status).toBe('CANCELLED')
  })

  it('does not allow arbitrary status jumps', async () => {
    const { orderId } = await pendingApproval()
    for (const to of ['DELIVERED', 'CONFIRMED', 'REFUNDED', 'PICKED_UP']) {
      expect((await call(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to } })).status).toBe(409)
    }
    expect((await call(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'MADE_UP' } })).status).toBe(422)
  })
})

describe('payments', () => {
  async function confirmedUpi() {
    const placed = await ok('/api/public/orders', { body: checkout(zone, [{ variantId: apple.variantId, qty: 1 }], { paymentPreference: 'UPI' }) })
    const orderId = await orderIdOf(placed.orderNumber)
    const item = await env.DB.prepare('SELECT id FROM order_items WHERE order_id = ?').bind(orderId).first<{ id: string }>()
    await ok(`/api/admin/orders/${orderId}/revisions`, { cookie: admin, body: { reason: 'Checked', deliveryFeePaise: 2500, items: [{ itemId: item!.id, qty: 1, unitPricePaise: 18000 }] } })
    await ok(`/api/public/track/${placed.trackingToken}/respond`, { body: { action: 'ACCEPT_ORDER', revision: 1, paymentMethod: 'UPI' } })
    return { orderId, token: placed.trackingToken as string, itemId: item!.id }
  }

  it('does not trust a customer payment report until staff verify it', async () => {
    const { orderId, token } = await confirmedUpi()
    const ref = `UPI${crypto.randomUUID().slice(0, 10)}`
    await ok(`/api/public/track/${token}/payment`, { body: { txnRef: ref, amountPaise: 20500 } })
    expect((await ok(`/api/public/track/${token}`)).paymentStatus).toBe('PENDING')
    const blocked = await call(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'PROCUREMENT_IN_PROGRESS' } })
    expect(blocked.json.error.code).toBe('PAYMENT_REQUIRED')
    expect((await call(`/api/public/track/${token}/payment`, { body: { txnRef: ref, amountPaise: 20500 } })).status).toBe(409)

    const { payments } = await ok('/api/admin/finance/payments?status=PENDING', { cookie: admin })
    const payment = payments.find((p: { txn_ref: string }) => p.txn_ref === ref)
    await ok(`/api/admin/finance/payments/${payment.id}/verify`, { cookie: admin, body: { decision: 'VERIFIED' } })
    expect((await ok(`/api/public/track/${token}`)).paymentStatus).toBe('PAID')
    await ok(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'PROCUREMENT_IN_PROGRESS' } })
  })

  it('marks a failed payment and lets the order switch to cash', async () => {
    const { orderId, token } = await confirmedUpi()
    await ok(`/api/public/track/${token}/payment`, { body: { txnRef: `BAD${crypto.randomUUID().slice(0, 10)}`, amountPaise: 20500 } })
    const row = await env.DB.prepare("SELECT id FROM payment_records WHERE order_id = ? AND status = 'PENDING'").bind(orderId).first<{ id: string }>()
    await ok(`/api/admin/finance/payments/${row!.id}/verify`, { cookie: admin, body: { decision: 'FAILED' } })
    expect((await ok(`/api/public/track/${token}`)).paymentStatus).toBe('FAILED')
    await ok(`/api/admin/finance/orders/${orderId}/use-cod`, { cookie: admin, method: 'POST' })
    await ok(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'PROCUREMENT_IN_PROGRESS' } })
  })

  it('records a refund, capped at what was received, without counting it as a sale', async () => {
    const { orderId } = await confirmedUpi()
    await ok('/api/admin/finance/payments', { cookie: admin, body: { orderId, amountPaise: 20500, method: 'UPI', txnRef: `OK${crypto.randomUUID().slice(0, 10)}` } })
    await ok(`/api/admin/orders/${orderId}/transition`, { cookie: admin, body: { to: 'CANCELLED', reason: 'Shop closed unexpectedly' } })
    await ok(`/api/admin/finance/orders/${orderId}/refund-start`, { cookie: admin, method: 'POST' })
    const tooMuch = await call(`/api/admin/finance/orders/${orderId}/refund`, { cookie: admin, body: { amountPaise: 99999, method: 'UPI' } })
    expect(tooMuch.json.error.code).toBe('REFUND_TOO_LARGE')
    await ok(`/api/admin/finance/orders/${orderId}/refund`, { cookie: admin, body: { amountPaise: 20500, method: 'UPI', txnRef: 'R1' } })
    const detail = await ok(`/api/admin/orders/${orderId}`, { cookie: admin })
    expect(detail.order.status).toBe('REFUNDED')
    expect(detail.order.payment_status).toBe('REFUNDED')
    expect(detail.finance.revenue).toBe(0)
    expect(detail.finance.contribution).toBe(0)
  })
})

describe('delivery', () => {
  it('splits a shared trip across orders and re-splits if one drops out', async () => {
    const rider = await createRider(admin)
    const a = await orderReadyForPickup(admin, zone, apple, 18000)
    const b = await orderReadyForPickup(admin, zone, apple, 18000)
    const c = await orderReadyForPickup(admin, zone, apple, 18000)
    await ok('/api/admin/deliveries/batches', { cookie: admin, body: { name: 'Test PG evening', riderId: rider.riderId, totalCostPaise: 10000, orderIds: [a.orderId, b.orderId, c.orderId] } })
    const { results } = await env.DB.prepare('SELECT order_id, actual_cost_paise FROM deliveries WHERE order_id IN (?, ?, ?)').bind(a.orderId, b.orderId, c.orderId).all<{ order_id: string; actual_cost_paise: number }>()
    expect(results.reduce((sum, row) => sum + row.actual_cost_paise, 0)).toBe(10000)

    const list = await ok('/api/rider/deliveries', { cookie: rider.cookie })
    expect(list.open).toHaveLength(3)
    await ok(`/api/rider/deliveries/${list.open[0].id}/decline`, { cookie: rider.cookie, method: 'POST' })
    const after = await env.DB.prepare("SELECT actual_cost_paise FROM deliveries WHERE order_id IN (?, ?, ?) AND status <> 'CANCELLED'").bind(a.orderId, b.orderId, c.orderId).all<{ actual_cost_paise: number }>()
    expect(after.results.map((row) => row.actual_cost_paise).sort()).toEqual([5000, 5000])
  })

  it('returns an order to the ready list when a rider is unavailable', async () => {
    const rider = await createRider(admin)
    const order = await orderReadyForPickup(admin, zone, apple, 18000)
    await ok('/api/admin/deliveries/assign', { cookie: admin, body: { orderId: order.orderId, riderId: rider.riderId } })
    const again = await call('/api/admin/deliveries/assign', { cookie: admin, body: { orderId: order.orderId, riderId: rider.riderId } })
    expect(again.status).toBe(409)
    const { open } = await ok('/api/rider/deliveries', { cookie: rider.cookie })
    await ok(`/api/rider/deliveries/${open[0].id}/decline`, { cookie: rider.cookie, method: 'POST' })
    expect((await ok(`/api/admin/orders/${order.orderId}`, { cookie: admin })).order.status).toBe('READY_FOR_PICKUP')
    await ok('/api/admin/deliveries/assign', { cookie: admin, body: { orderId: order.orderId, riderId: rider.riderId } })
  })

  it('refuses a deactivated rider', async () => {
    const rider = await createRider(admin)
    await ok(`/api/admin/deliveries/riders/${rider.riderId}`, { cookie: admin, method: 'PATCH', body: { isActive: false } })
    const order = await orderReadyForPickup(admin, zone, apple, 18000)
    const result = await call('/api/admin/deliveries/assign', { cookie: admin, body: { orderId: order.orderId, riderId: rider.riderId } })
    expect(result.json.error.code).toBe('RIDER_UNAVAILABLE')
    expect((await call('/api/rider/deliveries', { cookie: rider.cookie })).status).toBe(401)
  })

  it('records a failed delivery, keeps its costs, and allows a retry', async () => {
    const rider = await createRider(admin)
    const order = await orderReadyForPickup(admin, zone, apple, 18000, 12000)
    await ok('/api/admin/deliveries/assign', { cookie: admin, body: { orderId: order.orderId, riderId: rider.riderId } })
    const { open } = await ok('/api/rider/deliveries', { cookie: rider.cookie })
    const id = open[0].id
    await ok(`/api/rider/deliveries/${id}/pickup`, { cookie: rider.cookie, method: 'POST' })
    await ok(`/api/rider/deliveries/${id}/out`, { cookie: rider.cookie, method: 'POST' })
    await ok(`/api/rider/deliveries/${id}/failed`, { cookie: rider.cookie, body: { reason: 'Customer not reachable' } })
    const failed = await ok(`/api/admin/orders/${order.orderId}`, { cookie: admin })
    expect(failed.order.status).toBe('FAILED_DELIVERY')
    expect(failed.finance.revenue).toBe(0)
    expect(failed.finance.contribution).toBe(-(12000 + 2000))
    await ok(`/api/admin/orders/${order.orderId}/transition`, { cookie: admin, body: { to: 'READY_FOR_PICKUP', reason: 'Retry tomorrow' } })
    expect((await ok(`/api/admin/orders/${order.orderId}`, { cookie: admin })).order.settled_at).toBeNull()
    await ok('/api/admin/deliveries/assign', { cookie: admin, body: { orderId: order.orderId, riderId: rider.riderId } })
  })

  it('records a manual third-party booking with its real fee', async () => {
    const order = await orderReadyForPickup(admin, zone, apple, 18000)
    await ok('/api/admin/deliveries/third-party', { cookie: admin, body: { orderId: order.orderId, provider: 'Porter', bookingReference: 'P-123', actualFeePaise: 6500, trackingUrl: 'https://example.test/track/123' } })
    const delivery = await env.DB.prepare('SELECT id FROM deliveries WHERE order_id = ?').bind(order.orderId).first<{ id: string }>()
    const tracked = await ok(`/api/public/track/${order.token}`)
    expect(tracked.delivery.provider).toBe('Porter')
    expect(tracked.delivery.trackingUrl).toBe('https://example.test/track/123')
    await ok(`/api/admin/deliveries/${delivery!.id}/status`, { cookie: admin, body: { status: 'PICKED_UP' } })
    await ok(`/api/admin/deliveries/${delivery!.id}/status`, { cookie: admin, body: { status: 'OUT_FOR_DELIVERY' } })
    await ok(`/api/admin/deliveries/${delivery!.id}/status`, { cookie: admin, body: { status: 'DELIVERED', codCollectedPaise: 20500 } })
    const detail = await ok(`/api/admin/orders/${order.orderId}`, { cookie: admin })
    expect(detail.order.status).toBe('DELIVERED')
    expect(detail.finance.deliveryCost).toBe(6500)
  })

  it('checks the delivery code when that option is on', async () => {
    await env.DB.prepare("UPDATE business_settings SET value = 'true' WHERE key = 'delivery_otp_enabled'").run()
    const rider = await createRider(admin)
    const order = await orderReadyForPickup(admin, zone, apple, 18000)
    await ok('/api/admin/deliveries/assign', { cookie: admin, body: { orderId: order.orderId, riderId: rider.riderId } })
    const { open } = await ok('/api/rider/deliveries', { cookie: rider.cookie })
    const id = open[0].id
    // The rider never receives the code. Only the customer's order page shows it.
    expect(JSON.stringify(await ok(`/api/rider/deliveries/${id}`, { cookie: rider.cookie }))).not.toContain('delivery_otp')
    await ok(`/api/rider/deliveries/${id}/pickup`, { cookie: rider.cookie, method: 'POST' })
    await ok(`/api/rider/deliveries/${id}/out`, { cookie: rider.cookie, method: 'POST' })
    const tracked = await ok(`/api/public/track/${order.token}`)
    expect(tracked.delivery.otp).toMatch(/^\d{4}$/)
    const wrong = tracked.delivery.otp === '0000' ? '1111' : '0000'
    expect((await call(`/api/rider/deliveries/${id}/delivered`, { cookie: rider.cookie, body: { otp: wrong, codCollectedPaise: 20500 } })).json.error.code).toBe('WRONG_OTP')
    await ok(`/api/rider/deliveries/${id}/delivered`, { cookie: rider.cookie, body: { otp: tracked.delivery.otp, codCollectedPaise: 20500 } })
    await env.DB.prepare("UPDATE business_settings SET value = 'false' WHERE key = 'delivery_otp_enabled'").run()
  })
})

describe('reports', () => {
  it('produces every report, as JSON and as CSV', async () => {
    for (const report of ['sales', 'orders', 'products', 'delivery', 'riders', 'customers', 'procurement', 'refunds', 'expenses']) {
      const json = await call(`/api/admin/finance/reports/${report}`, { cookie: admin })
      expect(json.status, report).toBe(200)
      expect(Array.isArray(json.json.rows), report).toBe(true)
      const csv = await call(`/api/admin/finance/reports/${report}?format=csv`, { cookie: admin })
      expect(csv.status, report).toBe(200)
      expect(csv.headers.get('Content-Type'), report).toContain('text/csv')
    }
  })
  it('groups sales by day, week and month', async () => {
    for (const groupBy of ['day', 'week', 'month']) {
      const result = await ok(`/api/admin/finance/reports/sales?groupBy=${groupBy}`, { cookie: admin })
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.summary.revenue).toBeGreaterThan(0)
    }
  })
  it('shows real overview numbers', async () => {
    const overview = await ok('/api/admin/finance/overview', { cookie: admin })
    expect(overview.counts.ordersInRange).toBeGreaterThan(0)
    expect(overview.finance.todayRevenue).toBeGreaterThan(0)
    expect(overview.finance.contribution).toBeLessThan(overview.finance.revenue)
  })
})

describe('failure handling', () => {
  it('returns a clean error when the database fails', async () => {
    const broken = {
      prepare() {
        throw new Error('D1_ERROR: exceeded daily quota')
      },
      batch() {
        throw new Error('D1_ERROR: exceeded daily quota')
      },
    } as unknown as D1Database
    const result = await call('/api/public/catalog', { env: testEnv({ DB: broken }) })
    expect(result.status).toBe(503)
    expect(result.json.error.code).toBe('SERVICE_BUSY')
    expect(result.text).not.toContain('quota')
  })
})
