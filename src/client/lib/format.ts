export { formatDateTime } from '../../shared/time'
export { formatINR, paiseToRupees } from '../../shared/money'

/** Reads a rupee amount typed by a person and returns whole paise, or null when it is not a valid amount. */
export function parseRupees(input: string): number | null {
  const trimmed = input.trim().replace(/[₹,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  return Math.round(Number(trimmed) * 100)
}

export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

export function unitText(unitKind: string, unitSize: number): string {
  if (unitKind === 'COUNT') return unitSize === 12 ? 'dozen' : unitSize === 1 ? 'piece' : `${unitSize} pieces`
  return unitSize >= 1000 ? `${unitSize / 1000} kg` : `${unitSize} g`
}

export function titleCase(text: string): string {
  return text.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
