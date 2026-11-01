import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { presetRange, RANGE_PRESETS, type RangePreset } from '../../../shared/time'
import { Button, Input, Notice, Select, cx } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { formatINR, parseRupees } from '../../lib/format'

export type Me = { id: string; name: string; email: string; role: string; mustChangePassword: boolean; permissions: string[] }

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: async () => (await api<{ user: Me }>('/auth/me')).user, retry: false, staleTime: 60_000 })

export function useCan() {
  const me = useMe().data
  return (...permissions: string[]) => permissions.some((permission) => me?.permissions.includes(permission))
}

/** Sends a change to the server and then refreshes everything on screen, so no part of a page shows stale numbers. */
export function useDo(onDone?: () => void) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (action: { path: string; method?: string; body?: unknown; formData?: FormData }) => api(`/admin${action.path}`, { method: action.method, body: action.body, formData: action.formData }),
    onSuccess: () => {
      void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
      onDone?.()
    },
  })
}

export const useAdminQuery = <T,>(path: string, options: { enabled?: boolean; refetchInterval?: number } = {}) =>
  useQuery({ queryKey: ['admin', path], queryFn: () => api<T>(`/admin${path}`), ...options })

export function ErrorNote({ error }: { error: unknown }) {
  return error ? <Notice tone="bad">{errorMessage(error)}</Notice> : null
}

export function PageHead({ title, children, sub }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink-soft">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-paper">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-cream text-left text-ink-soft">
          <tr>{head.map((label, index) => <th key={index} className="px-3 py-2 font-medium">{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty}
    </div>
  )
}

export const td = 'px-3 py-2 align-top'

/** A rupee field that holds whole paise. Typing is free-form; the value is only set when it is a valid amount. */
export function MoneyInput({ label, value, onChange, className, optional, hint }: { label: string; value: number | null; onChange: (paise: number | null) => void; className?: string; optional?: boolean; hint?: string }) {
  const [text, setText] = useState(value === null ? '' : String(value / 100))
  useEffect(() => {
    if (value !== parseRupees(text)) setText(value === null ? '' : String(value / 100))
    // Only re-sync when the value changes from outside, never while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const invalid = text.trim() !== '' && parseRupees(text) === null
  return (
    <Input
      label={label}
      className={className}
      optional={optional}
      hint={hint}
      inputMode="decimal"
      value={text}
      error={invalid ? 'Enter an amount like 150 or 150.50' : undefined}
      onChange={(event) => {
        setText(event.target.value)
        onChange(event.target.value.trim() === '' ? null : parseRupees(event.target.value))
      }}
    />
  )
}

const PRESET_LABELS: Record<RangePreset, string> = { today: 'Today', yesterday: 'Yesterday', last7: 'Last 7 days', last30: 'Last 30 days', month: 'This month', custom: 'Custom range' }

export function useRange(initial: Exclude<RangePreset, 'custom'> = 'today') {
  const [preset, setPreset] = useState<RangePreset>(initial)
  const [custom, setCustom] = useState(() => presetRange('last7'))
  const range = preset === 'custom' ? custom : presetRange(preset)
  return { preset, setPreset, custom, setCustom, range }
}

export function RangePicker({ state }: { state: ReturnType<typeof useRange> }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select label="Period" value={state.preset} onChange={(event) => state.setPreset(event.target.value as RangePreset)}>
        {RANGE_PRESETS.map((preset) => <option key={preset} value={preset}>{PRESET_LABELS[preset]}</option>)}
      </Select>
      {state.preset === 'custom' && (
        <>
          <Input label="From" type="date" value={state.custom.from} max={state.custom.to} onChange={(event) => state.setCustom({ ...state.custom, from: event.target.value })} />
          <Input label="To" type="date" value={state.custom.to} min={state.custom.from} onChange={(event) => state.setCustom({ ...state.custom, to: event.target.value })} />
        </>
      )}
    </div>
  )
}

export function Money({ paise, tone }: { paise: number | null | undefined; tone?: boolean }) {
  if (paise === null || paise === undefined) return <>–</>
  return <span className={cx(tone && paise < 0 && 'text-berry', tone && paise > 0 && 'text-forest')}>{formatINR(paise)}</span>
}

export function ConfirmButton({ children, onConfirm, ...rest }: { children: ReactNode; onConfirm: () => void } & Omit<React.ComponentProps<typeof Button>, 'onClick'>) {
  const [asking, setAsking] = useState(false)
  if (!asking) return <Button {...rest} onClick={() => setAsking(true)}>{children}</Button>
  return (
    <span className="inline-flex items-center gap-1">
      <Button {...rest} variant="danger" onClick={() => { setAsking(false); onConfirm() }}>Confirm</Button>
      <Button variant="ghost" size={rest.size} onClick={() => setAsking(false)}>Cancel</Button>
    </span>
  )
}
