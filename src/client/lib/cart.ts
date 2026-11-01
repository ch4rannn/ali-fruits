import { uuid } from './uuid'
import { createStore } from './store'

export type CartLine = {
  variantId: string
  productId: string
  productName: string
  productSlug: string
  variantLabel: string
  qty: number
  unitPaise: number
  minQty: number
  qtyStep: number
  image: string | null
}

type CartState = { lines: CartLine[]; idempotencyKey: string }

const store = createStore<CartState>('fd_cart_v1', { lines: [], idempotencyKey: uuid() })

export const useCart = store.use
export const getCart = store.get

export function addToCart(line: Omit<CartLine, 'qty'> & { qty?: number }) {
  store.set((cart) => {
    const existing = cart.lines.find((item) => item.variantId === line.variantId)
    const lines = existing
      ? cart.lines.map((item) => (item.variantId === line.variantId ? { ...item, qty: item.qty + (line.qty ?? line.minQty), unitPaise: line.unitPaise } : item))
      : [...cart.lines, { ...line, qty: line.qty ?? line.minQty }]
    return { ...cart, lines }
  })
}

export function setQty(variantId: string, qty: number) {
  store.set((cart) => ({ ...cart, lines: cart.lines.map((line) => (line.variantId === variantId ? { ...line, qty: Math.max(line.minQty, Math.min(999, qty)) } : line)) }))
}

export function removeLine(variantId: string) {
  store.set((cart) => ({ ...cart, lines: cart.lines.filter((line) => line.variantId !== variantId) }))
}

/** Switching a unit replaces the line, so the quantity restarts at that unit's minimum. */
export function changeVariant(oldVariantId: string, next: Omit<CartLine, 'qty'>) {
  store.set((cart) => {
    if (cart.lines.some((line) => line.variantId === next.variantId && next.variantId !== oldVariantId)) {
      return { ...cart, lines: cart.lines.filter((line) => line.variantId !== oldVariantId) }
    }
    return { ...cart, lines: cart.lines.map((line) => (line.variantId === oldVariantId ? { ...next, qty: next.minQty } : line)) }
  })
}

/** Records the prices the customer has just seen and agreed to. */
export function acceptPrices(prices: Record<string, number>) {
  store.set((cart) => ({ ...cart, lines: cart.lines.map((line) => (prices[line.variantId] !== undefined ? { ...line, unitPaise: prices[line.variantId]! } : line)) }))
}

export function dropLines(variantIds: string[]) {
  store.set((cart) => ({ ...cart, lines: cart.lines.filter((line) => !variantIds.includes(line.variantId)) }))
}

export function clearCart() {
  store.set({ lines: [], idempotencyKey: uuid() })
}

const orders = createStore<{ tokens: Array<{ token: string; orderNumber: string; at: string }> }>('fd_orders_v1', { tokens: [] })
export const useMyOrders = orders.use
export function rememberOrder(token: string, orderNumber: string) {
  orders.set((state) => ({ tokens: [{ token, orderNumber, at: new Date().toISOString() }, ...state.tokens.filter((item) => item.token !== token)].slice(0, 10) }))
}

const zone = createStore<{ zoneId: string | null }>('fd_zone_v1', { zoneId: null })
export const useChosenZone = zone.use
export const setChosenZone = (zoneId: string | null) => zone.set({ zoneId })
