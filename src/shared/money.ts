/** All money is stored and calculated as integer paise. Floats are only used at the display edge. */
export function formatINR(paise: number): string {
  const rupees = paise / 100
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees)
}

export function rupeesToPaise(rupees: string | number): number {
  const value = typeof rupees === 'number' ? rupees : Number(rupees)
  if (!Number.isFinite(value)) throw new Error('Invalid rupee amount')
  return Math.round(value * 100)
}

export function paiseToRupees(paise: number): string {
  return (paise / 100).toFixed(2).replace(/\.00$/, '')
}

export const MAX_MONEY_PAISE = 100_000_000 // ₹10 lakh: a sanity limit that catches mistyped amounts.
