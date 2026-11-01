import { Loader2 } from 'lucide-react'
import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')
export { cx }

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none whitespace-nowrap'
const buttonVariants = {
  primary: 'bg-forest text-paper hover:bg-forest-deep',
  accent: 'bg-citrus text-ink hover:brightness-95',
  secondary: 'border border-forest text-forest bg-transparent hover:bg-leaf-soft',
  ghost: 'text-forest hover:bg-mist',
  danger: 'bg-berry text-paper hover:brightness-90',
  dangerOutline: 'border border-berry text-berry hover:bg-berry-soft',
}
const buttonSizes = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-5 text-base', lg: 'min-h-[52px] px-7 text-base' }

type ButtonStyle = { variant?: keyof typeof buttonVariants; size?: keyof typeof buttonSizes; full?: boolean }

export const buttonClass = ({ variant = 'primary', size = 'md', full }: ButtonStyle = {}) => cx(buttonBase, buttonVariants[variant], buttonSizes[size], full && 'w-full')

export function Button({ variant, size, full, loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyle & { loading?: boolean }) {
  return (
    <button type="button" {...rest} disabled={disabled || loading} className={cx(buttonClass({ variant, size, full }), className)}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function LinkButton({ variant, size, full, className, ...rest }: LinkProps & ButtonStyle) {
  return <Link {...rest} className={cx(buttonClass({ variant, size, full }), className)} />
}

export function ExternalButton({ variant, size, full, className, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & ButtonStyle) {
  return <a {...rest} className={cx(buttonClass({ variant, size, full }), className)} />
}

type FieldProps = { label: string; error?: string; hint?: string; className?: string; optional?: boolean }

function FieldShell({ label, error, hint, className, optional, id, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-ink-soft">(optional)</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-sm text-ink-soft">{hint}</p>}
      {error && (
        <p className="mt-1 text-sm font-medium text-berry" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

const inputClass = (error?: string) =>
  cx('block w-full rounded-md border bg-paper px-3 py-2.5 text-base text-ink placeholder:text-ink-soft/60', error ? 'border-berry' : 'border-line hover:border-ink-soft/40')

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(function Input({ label, error, hint, className, optional, ...rest }, ref) {
  const id = useId()
  return (
    <FieldShell {...{ label, error, hint, className, optional, id }}>
      <input ref={ref} id={id} aria-invalid={Boolean(error)} {...rest} className={inputClass(error)} />
    </FieldShell>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(function Textarea({ label, error, hint, className, optional, ...rest }, ref) {
  const id = useId()
  return (
    <FieldShell {...{ label, error, hint, className, optional, id }}>
      <textarea ref={ref} id={id} rows={3} aria-invalid={Boolean(error)} {...rest} className={inputClass(error)} />
    </FieldShell>
  )
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps>(function Select({ label, error, hint, className, optional, children, ...rest }, ref) {
  const id = useId()
  return (
    <FieldShell {...{ label, error, hint, className, optional, id }}>
      <select ref={ref} id={id} aria-invalid={Boolean(error)} {...rest} className={inputClass(error)}>
        {children}
      </select>
    </FieldShell>
  )
})

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx('flex items-start gap-3 text-sm', className)}>
      <input type="checkbox" {...rest} className="mt-0.5 size-5 shrink-0 accent-forest" />
      <span>{label}</span>
    </label>
  )
}

const tones = {
  neutral: 'bg-mist text-ink',
  good: 'bg-leaf-soft text-forest',
  warn: 'bg-amber-soft text-[#7a5a00]',
  bad: 'bg-berry-soft text-berry',
  info: 'bg-citrus-soft text-ink',
}
export function Badge({ tone = 'neutral', children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-lg border border-line bg-paper', className)}>{children}</div>
}

export function Notice({ tone = 'info', title, children, className }: { tone?: 'info' | 'warn' | 'bad' | 'good'; title?: string; children: ReactNode; className?: string }) {
  const style = { info: 'bg-citrus-soft border-citrus', warn: 'bg-amber-soft border-[#e0b44c]', bad: 'bg-berry-soft border-berry', good: 'bg-leaf-soft border-leaf' }[tone]
  return (
    <div className={cx('rounded-md border-l-4 px-4 py-3 text-sm', style, className)} role={tone === 'bad' ? 'alert' : 'status'}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-ink-soft" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-soft">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function QueryError({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <Notice tone="bad" title="Could not load this">
      <p>{error instanceof Error ? error.message : 'Please try again.'}</p>
      {retry && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={retry}>
          Try again
        </Button>
      )}
    </Notice>
  )
}

/** A native dialog, so focus is trapped and Escape closes it without extra code. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={ref} onClose={onClose} onClick={(event) => event.target === ref.current && onClose()} className="m-auto w-[min(92vw,30rem)] rounded-lg border border-line bg-paper p-0 text-ink">
      <div className="p-5">
        <h2 className="mb-3 text-xl">{title}</h2>
        {open && children}
      </div>
    </dialog>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg border border-line bg-paper p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className={cx('mt-1 font-display text-2xl font-bold', tone === 'good' && 'text-forest', tone === 'bad' && 'text-berry')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-soft">{sub}</p>}
    </div>
  )
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
      <span className="text-ink-soft">
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  )
}
