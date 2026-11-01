import { Download, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EXPENSE_CATEGORIES } from '../../../shared/schemas'
import { Badge, Button, Dialog, EmptyState, Input, Pagination, QueryError, Select, Spinner, Stat } from '../../components/ui'
import { formatDateTime, formatINR, titleCase, todayIst } from '../../lib/format'
import { ConfirmButton, ErrorNote, Money, MoneyInput, PageHead, RangePicker, Table, td, useAdminQuery, useCan, useDo, useRange } from './shared'

export function Payments() {
  const can = useCan()
  const [status, setStatus] = useState('PENDING')
  const [page, setPage] = useState(1)
  const list = useAdminQuery<{ payments: Array<{ id: string; order_id: string; order_number: string; customer_name: string; kind: string; method: string; amount_paise: number; txn_ref: string; status: string; source: string; total_paise: number; payment_status: string; verified_by_name: string | null; created_at: string }>; total: number; pageSize: number }>(`/finance/payments?page=${page}${status ? `&status=${status}` : ''}`, { refetchInterval: 30_000 })
  const act = useDo()
  return (
    <>
      <PageHead title="Payments" sub="A payment only counts once you have seen it in your actual bank or UPI account. Customer screenshots are not proof." />
      <div className="mb-4 max-w-xs"><Select label="Show" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="PENDING">Waiting to be checked</option><option value="VERIFIED">Verified</option><option value="FAILED">Not received</option><option value="">Everything</option></Select></div>
      <ErrorNote error={act.error} />
      {list.isPending ? <Spinner /> : list.isError ? <QueryError error={list.error} /> : list.data.payments.length === 0 ? <EmptyState title="Nothing here" /> : (
        <>
          <Table head={['Order', 'Type', 'Amount', 'Reference', 'Status', 'When', '']}>
            {list.data.payments.map((p) => <tr key={p.id}>
              <td className={td}><Link className="font-semibold text-forest underline" to={`/admin/orders/${p.order_id}`}>{p.order_number}</Link><div className="text-xs text-ink-soft">{p.customer_name}</div></td>
              <td className={td}>{p.kind === 'REFUND' ? 'Refund' : 'Payment'} · {p.method}<div className="text-xs text-ink-soft">{p.source.toLowerCase()}</div></td>
              <td className={td}>{formatINR(p.amount_paise)}<div className="text-xs text-ink-soft">order {formatINR(p.total_paise)}</div></td>
              <td className={`${td} break-all`}>{p.txn_ref}</td>
              <td className={td}><Badge tone={p.status === 'VERIFIED' ? 'good' : p.status === 'FAILED' ? 'bad' : 'warn'}>{p.status.toLowerCase()}</Badge>{p.verified_by_name && <div className="text-xs text-ink-soft">{p.verified_by_name}</div>}</td>
              <td className={td}>{formatDateTime(p.created_at)}</td>
              <td className={td}>{can('payments.write') && p.status === 'PENDING' && p.kind === 'PAYMENT' && <span className="flex gap-1"><Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: `/finance/payments/${p.id}/verify`, body: { decision: 'VERIFIED' } })}>Seen in bank</Button><Button size="sm" variant="dangerOutline" onClick={() => act.mutate({ path: `/finance/payments/${p.id}/verify`, body: { decision: 'FAILED' } })}>Not received</Button></span>}</td>
            </tr>)}
          </Table>
          <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />
        </>
      )}
    </>
  )
}

const CATEGORY_LABELS: Record<string, string> = { PACKAGING: 'Packaging', RIDER: 'Rider pay', THIRD_PARTY_DELIVERY: 'Third-party delivery', OTHER_VARIABLE: 'Other variable cost', FIXED: 'Fixed cost' }

export function Expenses() {
  const range = useRange('month')
  const [page, setPage] = useState(1)
  const list = useAdminQuery<{ expenses: Array<{ id: string; category: string; amount_paise: number; expense_date: string; description: string; order_number: string | null; rider_name: string | null; created_by_name: string | null }>; total: number; sumPaise: number; pageSize: number }>(`/finance/expenses?from=${range.range.from}&to=${range.range.to}&page=${page}`)
  const riders = useAdminQuery<{ riders: Array<{ id: string; name: string }> }>('/deliveries/riders')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ category: 'PACKAGING', expenseDate: todayIst(), description: '', riderId: '', orderNumber: '' })
  const [amount, setAmount] = useState<number | null>(null)
  const act = useDo(() => { setOpen(false); setAmount(null); setForm({ ...form, description: '', riderId: '', orderNumber: '' }) })
  const del = useDo()
  return (
    <>
      <PageHead title="Expenses" sub="Record costs as they happen. Costs tied to an order are counted in that order's contribution."><Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" /> Add expense</Button></PageHead>
      <div className="mb-4 flex flex-wrap items-end gap-4"><RangePicker state={range} />{list.data && <Stat label="Total in period" value={formatINR(list.data.sumPaise)} />}</div>
      <ErrorNote error={del.error} />
      {list.isPending ? <Spinner /> : list.isError ? <QueryError error={list.error} /> : list.data.expenses.length === 0 ? <EmptyState title="No expenses in this period" /> : (
        <>
          <Table head={['Date', 'Type', 'Amount', 'Details', 'Added by', '']}>
            {list.data.expenses.map((e) => <tr key={e.id}><td className={td}>{e.expense_date}</td><td className={td}>{CATEGORY_LABELS[e.category]}</td><td className={td}>{formatINR(e.amount_paise)}</td><td className={td}>{e.description}{e.order_number && <div className="text-xs text-ink-soft">Order {e.order_number}</div>}{e.rider_name && <div className="text-xs text-ink-soft">Rider {e.rider_name}</div>}</td><td className={td}>{e.created_by_name}</td><td className={td}><ConfirmButton size="sm" variant="ghost" onConfirm={() => del.mutate({ path: `/finance/expenses/${e.id}`, method: 'DELETE' })}>Delete</ConfirmButton></td></tr>)}
          </Table>
          <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />
        </>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Add expense">
        <div className="space-y-3">
          <Select label="Type" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</Select>
          <MoneyInput label="Amount (₹)" value={amount} onChange={setAmount} />
          <Input label="Date" type="date" value={form.expenseDate} onChange={(event) => setForm({ ...form, expenseDate: event.target.value })} />
          {form.category === 'RIDER' && <Select label="Rider" optional value={form.riderId} onChange={(event) => setForm({ ...form, riderId: event.target.value })}><option value="">Not tied to one rider</option>{riders.data?.riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}
          <Input label="What was it for?" optional value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          <ErrorNote error={act.error} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Back</Button><Button disabled={!amount} loading={act.isPending} onClick={() => act.mutate({ path: '/finance/expenses', body: { category: form.category, amountPaise: amount, expenseDate: form.expenseDate, description: form.description, riderId: form.riderId || null } })}>Save</Button></div>
        </div>
      </Dialog>
    </>
  )
}

const REPORTS = [
  ['sales', 'Sales and profit'], ['orders', 'Orders'], ['products', 'Product performance'], ['delivery', 'Delivery costs'], ['riders', 'Rider expenses'],
  ['customers', 'Repeat customers'], ['procurement', 'Procurement'], ['refunds', 'Refunds'], ['expenses', 'Expenses'],
] as const
const MONEY_COLUMNS = /revenue|cost|profit|packaging|refunds|contribution|spent|amount|fees|total|pay|collected/i

export function Analytics() {
  const range = useRange('month')
  const [report, setReport] = useState<(typeof REPORTS)[number][0]>('sales')
  const [groupBy, setGroupBy] = useState('day')
  const base = `/finance/reports/${report}?from=${range.range.from}&to=${range.range.to}${report === 'sales' ? `&groupBy=${groupBy}` : ''}`
  const query = useAdminQuery<{ rows: Array<Record<string, string | number>>; summary?: Record<string, number | null> }>(base)
  const columns = query.data?.rows[0] ? Object.keys(query.data.rows[0]) : []
  const s = query.data?.summary
  return (
    <>
      <PageHead title="Analytics" sub="Management reports from your own records. They do not replace formal accounting or tax records.">
        <a className="inline-flex h-9 items-center gap-2 rounded-md border border-forest px-3 text-sm font-semibold text-forest hover:bg-leaf-soft" href={`/api/admin${base}&format=csv`}><Download className="size-4" /> Download CSV</a>
      </PageHead>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select label="Report" value={report} onChange={(event) => setReport(event.target.value as typeof report)}>{REPORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
        {report === 'sales' && <Select label="Group by" value={groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></Select>}
        <RangePicker state={range} />
      </div>
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Revenue" value={formatINR(Number(s.revenue))} />
          <Stat label="Fruit cost" value={formatINR(Number(s.fruitCost))} />
          <Stat label="Gross profit" value={formatINR(Number(s.grossProfit))} tone={Number(s.grossProfit) < 0 ? 'bad' : 'good'} sub={s.grossMarginPercent === null ? undefined : `${s.grossMarginPercent}% margin`} />
          <Stat label="Contribution" value={formatINR(Number(s.contribution))} tone={Number(s.contribution) < 0 ? 'bad' : 'good'} />
          <Stat label="Packaging" value={formatINR(Number(s.packaging))} />
          <Stat label="Delivery cost" value={formatINR(Number(s.deliveryCost))} />
          <Stat label="Average order value" value={formatINR(Number(s.averageOrderValue))} sub={`${s.completedOrders} delivered`} />
          <Stat label="Repeat customer rate" value={`${s.repeatRate}%`} sub={`Cancellation rate ${s.cancellationRate}%`} />
        </div>
      )}
      {query.isPending ? <Spinner /> : query.isError ? <QueryError error={query.error} /> : query.data.rows.length === 0 ? <EmptyState title="No data in this period" /> : (
        <Table head={columns.map((c) => titleCase(c))}>
          {query.data.rows.map((row, index) => <tr key={index}>{columns.map((c) => <td key={c} className={td}>{typeof row[c] === 'number' && MONEY_COLUMNS.test(c) && !/percent/i.test(c) ? <Money paise={Math.round(Number(row[c]) * 100)} tone={/profit|contribution/i.test(c)} /> : String(row[c] ?? '')}</td>)}</tr>)}
        </Table>
      )}
    </>
  )
}
