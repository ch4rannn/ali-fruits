/** The business runs on India time, while timestamps are stored as UTC ISO strings. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

export function istDate(date: Date = new Date()): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

export function shiftDate(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** UTC bounds for IST dates: from is inclusive at the start of its day, end is exclusive. */
export function istRangeToUtc(from: string, to: string): { start: string; end: string } {
  const start = new Date(new Date(`${from}T00:00:00.000Z`).getTime() - IST_OFFSET_MS).toISOString()
  const end = new Date(new Date(`${shiftDate(to, 1)}T00:00:00.000Z`).getTime() - IST_OFFSET_MS).toISOString()
  return { start, end }
}

export const RANGE_PRESETS = ['today', 'yesterday', 'last7', 'last30', 'month', 'custom'] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

export function presetRange(preset: Exclude<RangePreset, 'custom'>, now: Date = new Date()): { from: string; to: string } {
  const today = istDate(now)
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const day = shiftDate(today, -1)
      return { from: day, to: day }
    }
    case 'last7':
      return { from: shiftDate(today, -6), to: today }
    case 'last30':
      return { from: shiftDate(today, -29), to: today }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso))
}
