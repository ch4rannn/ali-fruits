import { Download, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { STATUS_LABELS, type OrderStatus } from '../../../shared/order-state'
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Input, Notice, Pagination, QueryError, Select, Spinner, Textarea } from '../../components/ui'
import { formatDateTime, formatINR } from '../../lib/format'
import { statusTone } from './Orders'
import { ConfirmButton, ErrorNote, Money, MoneyInput, PageHead, RangePicker, Table, td, useAdminQuery, useCan, useDo, useRange } from './shared'

export function Procurement() {
  const can = useCan()
  const range = useRange('last7')
  const [page, setPage] = useState(1)
  const queue = useAdminQuery<{ orders: Array<{ id: string; order_number: string; status: OrderStatus; customer_name: string; locality: string; payment_method: string | null; payment_status: string; items: Array<{ id: string; product_name: string; variant_label: string; confirmed_qty: number; wholesale_price_paise: number | null }>; records: Array<{ order_item_id: string }> }> }>('/procurement/queue', { refetchInterval: 30_000 })
  const records = useAdminQuery<{ records: Array<{ id: string; order_number: string; product_name: string; variant_label: string; supplier_name: string; purchased_quantity: number; unit: string; total_cost_paise: number; purchased_at: string; responsible_employee: string; invoice_reference: string }>; total: number; pageSize: number }>(`/procurement/records?from=${range.range.from}&to=${range.range.to}&page=${page}`, { enabled: can('costs.read') })
  const suppliers = useAdminQuery<{ suppliers: Array<{ id: string; name: string; phone: string; notes: string; is_active: number }> }>('/procurement/suppliers')
  const [editing, setEditing] = useState<null | { id?: string; name: string; phone: string; notes: string; isActive: boolean }>(null)
  const act = useDo(() => setEditing(null))
  return (
    <>
      <PageHead title="Procurement" sub="We buy fruit only for orders the customer has approved. Nothing is stocked in advance." />
      <h2 className="mb-2 text-xl">To buy now</h2>
      {queue.isPending ? <Spinner /> : queue.isError ? <QueryError error={queue.error} /> : queue.data.orders.length === 0 ? <EmptyState title="Nothing to buy right now">Orders appear here after the customer approves them.</EmptyState> : (
        <div className="space-y-3">{queue.data.orders.map((order) => {
          const bought = new Set(order.records.map((r) => r.order_item_id))
          const blocked = order.status === 'CONFIRMED' && order.payment_method === 'UPI' && order.payment_status !== 'PAID'
          return (
            <Card key={order.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><Link className="font-display text-lg font-bold text-forest underline" to={`/admin/orders/${order.id}`}>{order.order_number}</Link><span className="flex gap-2"><Badge tone={statusTone(order.status)}>{STATUS_LABELS[order.status]}</Badge>{blocked && <Badge tone="warn">Waiting for UPI payment</Badge>}</span></div>
              <p className="text-sm text-ink-soft">{order.customer_name} · {order.locality}</p>
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{order.items.map((item) => <li key={item.id} className="flex justify-between gap-2 rounded-md bg-cream px-2 py-1"><span>{item.product_name} ({item.variant_label}) × {item.confirmed_qty}</span><span>{bought.has(item.id) ? <Badge tone="good">Bought</Badge> : can('costs.read') && item.wholesale_price_paise ? <span className="text-ink-soft">last {formatINR(item.wholesale_price_paise)}</span> : null}</span></li>)}</ul>
            </Card>
          )
        })}</div>
      )}

      {can('costs.read') && (
        <section className="mt-8">
          <PageHead title="Purchase records"><RangePicker state={range} /></PageHead>
          {records.isPending ? <Spinner /> : records.isError ? <QueryError error={records.error} /> : (
            <>
              <Table head={['When', 'Order', 'Fruit', 'Supplier', 'Quantity', 'Cost', 'Bought by', 'Bill']}>
                {records.data.records.map((r) => <tr key={r.id}><td className={td}>{formatDateTime(r.purchased_at)}</td><td className={td}>{r.order_number}</td><td className={td}>{r.product_name} ({r.variant_label})</td><td className={td}>{r.supplier_name}</td><td className={td}>{r.purchased_quantity} {r.unit}</td><td className={td}><Money paise={r.total_cost_paise} /></td><td className={td}>{r.responsible_employee}</td><td className={td}>{r.invoice_reference}</td></tr>)}
              </Table>
              <Pagination page={page} pageSize={records.data.pageSize} total={records.data.total} onChange={setPage} />
            </>
          )}
        </section>
      )}

      <section className="mt-8">
        <PageHead title="Suppliers"><Button size="sm" onClick={() => setEditing({ name: '', phone: '', notes: '', isActive: true })}><Plus className="size-4" /> Add supplier</Button></PageHead>
        <Table head={['Name', 'Phone', 'Notes', 'Active', '']}>
          {suppliers.data?.suppliers.map((s) => <tr key={s.id}><td className={td}>{s.name}</td><td className={td}>{s.phone}</td><td className={td}>{s.notes}</td><td className={td}>{s.is_active ? 'Yes' : 'No'}</td><td className={td}><Button size="sm" variant="ghost" onClick={() => setEditing({ id: s.id, name: s.name, phone: s.phone, notes: s.notes, isActive: !!s.is_active })}>Edit</Button></td></tr>)}
        </Table>
      </section>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? 'Edit supplier' : 'Add supplier'}>
        {editing && <div className="space-y-3"><Input label="Name" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /><Input label="Phone" optional value={editing.phone} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} /><Textarea label="Notes" optional value={editing.notes} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /><Checkbox label="Active" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} /><ErrorNote error={act.error} /><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Back</Button><Button disabled={!editing.name.trim()} loading={act.isPending} onClick={() => act.mutate({ path: editing.id ? `/procurement/suppliers/${editing.id}` : '/procurement/suppliers', method: editing.id ? 'PUT' : 'POST', body: { name: editing.name.trim(), phone: editing.phone, notes: editing.notes, isActive: editing.isActive } })}>Save</Button></div></div>}
      </Dialog>
    </>
  )
}

export function Customers() {
  const can = useCan()
  const [params, setParams] = useSearchParams()
  const page = Number(params.get('page') ?? 1)
  const q = params.get('q') ?? ''
  const list = useAdminQuery<{ customers: Array<{ id: string; name: string; phone: string; is_blocked: number; total_orders: number; completed_orders: number; total_spent_paise: number; last_order_at: string | null }>; total: number; pageSize: number }>(`/system/customers?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
  return (
    <>
      <PageHead title="Customers" sub="Phone numbers and addresses are personal data. Only open them when you need them.">
        {can('customers.export') && <a className="inline-flex h-9 items-center gap-2 rounded-md border border-forest px-3 text-sm font-semibold text-forest hover:bg-leaf-soft" href="/api/admin/system/customers/export"><Download className="size-4" /> Export CSV</a>}
      </PageHead>
      <div className="mb-4 max-w-sm"><Input label="Search" placeholder="Name or phone" defaultValue={q} onChange={(event) => { const next = new URLSearchParams(); if (event.target.value.trim()) next.set('q', event.target.value.trim()); setParams(next, { replace: true }) }} /></div>
      {list.isPending ? <Spinner /> : list.isError ? <QueryError error={list.error} /> : list.data.customers.length === 0 ? <EmptyState title="No customers yet" /> : (
        <>
          <Table head={['Customer', 'Orders', 'Completed', 'Spent', 'Last order']}>
            {list.data.customers.map((c) => <tr key={c.id}><td className={td}><Link className="font-semibold text-forest underline" to={`/admin/customers/${c.id}`}>{c.name}</Link>{c.is_blocked ? <Badge tone="bad" className="ml-2">Blocked</Badge> : null}<div className="text-xs text-ink-soft">{c.phone}</div></td><td className={td}>{c.total_orders}</td><td className={td}>{c.completed_orders}</td><td className={td}><Money paise={c.total_spent_paise} /></td><td className={td}>{c.last_order_at ? formatDateTime(c.last_order_at) : '–'}</td></tr>)}
          </Table>
          <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onChange={(next) => { const p = new URLSearchParams(params); p.set('page', String(next)); setParams(p) }} />
        </>
      )}
    </>
  )
}

export function CustomerDetail() {
  const { id } = useParams()
  const can = useCan()
  const query = useAdminQuery<{ customer: any; addresses: any[]; orders: any[]; repeatedProducts: Array<{ product_name: string; times_ordered: number }> }>(`/system/customers/${id}`)
  const [notes, setNotes] = useState<string | null>(null)
  const act = useDo()
  if (query.isPending) return <Spinner />
  if (query.isError) return <QueryError error={query.error} />
  const { customer: c, addresses, orders, repeatedProducts } = query.data
  const text = notes ?? c.internal_notes
  return (
    <>
      <PageHead title={c.name} sub={<>{c.phone}{c.email ? ` · ${c.email}` : ''}</>}><Link className="text-sm text-forest underline" to="/admin/customers">All customers</Link></PageHead>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card className="p-4"><h2 className="mb-2 text-xl">Orders</h2><Table head={['Order', 'Status', 'Total', 'Placed']}>{orders.map((o) => <tr key={o.id}><td className={td}><Link className="text-forest underline" to={`/admin/orders/${o.id}`}>{o.order_number}</Link></td><td className={td}><Badge tone={statusTone(o.status)}>{STATUS_LABELS[o.status as OrderStatus]}</Badge></td><td className={td}>{formatINR(o.total_paise || o.estimated_total_paise)}</td><td className={td}>{formatDateTime(o.created_at)}</td></tr>)}</Table></Card>
          <Card className="p-4"><h2 className="mb-2 text-xl">Addresses</h2><ul className="space-y-2 text-sm">{addresses.map((a) => <li key={a.id}>{a.address_line}, {a.locality} {a.pin_code}{a.landmark ? ` (near ${a.landmark})` : ''}</li>)}</ul></Card>
        </div>
        <div className="space-y-5">
          <Card className="space-y-1 p-4 text-sm"><h2 className="mb-1 text-xl">Summary</h2><p>Orders: {c.total_orders}</p><p>Delivered: {c.completed_orders}</p><p>Total spent: {formatINR(c.total_spent_paise)}</p>{repeatedProducts.length > 0 && <><h3 className="pt-2 text-base">Orders most often</h3><ul>{repeatedProducts.map((p) => <li key={p.product_name}>{p.product_name} × {p.times_ordered}</li>)}</ul></>}</Card>
          {can('customers.write') && (
            <Card className="space-y-3 p-4">
              <Textarea label="Internal notes" value={text} onChange={(event) => setNotes(event.target.value)} />
              <Button size="sm" variant="secondary" disabled={notes === null} loading={act.isPending} onClick={() => act.mutate({ path: `/system/customers/${id}`, method: 'PATCH', body: { internalNotes: text } })}>Save notes</Button>
              <div className="border-t border-line pt-3">
                {c.is_blocked ? <Button variant="secondary" onClick={() => act.mutate({ path: `/system/customers/${id}`, method: 'PATCH', body: { isBlocked: false } })}>Unblock customer</Button> : <ConfirmButton variant="dangerOutline" onConfirm={() => act.mutate({ path: `/system/customers/${id}`, method: 'PATCH', body: { isBlocked: true } })}>Block this customer</ConfirmButton>}
                <p className="mt-1 text-xs text-ink-soft">A blocked customer cannot place new orders online.</p>
              </div>
              <ErrorNote error={act.error} />
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

const PAY_TYPES = { PER_DELIVERY: 'Per delivery', PER_SHIFT: 'Per shift', FIXED_DAILY: 'Fixed daily amount', CUSTOM: 'Custom' } as const

export function Riders() {
  const list = useAdminQuery<{ riders: Array<{ id: string; name: string; email: string; phone: string; vehicle_type: string; compensation_type: keyof typeof PAY_TYPES; compensation_amount_paise: number; is_active: number; open_deliveries: number; completed_deliveries: number; last_login_at: string | null }> }>('/deliveries/riders')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', vehicleType: '', compensationType: 'PER_DELIVERY' as keyof typeof PAY_TYPES, temporaryPassword: '' })
  const [pay, setPay] = useState<number | null>(0)
  const act = useDo(() => setOpen(false))
  const toggle = useDo()
  return (
    <>
      <PageHead title="Riders" sub="Rider accounts are created here. There is no public sign-up."><Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" /> Add rider</Button></PageHead>
      {list.isPending ? <Spinner /> : list.isError ? <QueryError error={list.error} /> : list.data.riders.length === 0 ? <EmptyState title="No riders yet" /> : (
        <Table head={['Rider', 'Vehicle', 'Pay', 'Open', 'Delivered', 'Account', '']}>
          {list.data.riders.map((r) => <tr key={r.id}><td className={td}><span className="font-semibold">{r.name}</span><div className="text-xs text-ink-soft">{r.phone} · {r.email}</div></td><td className={td}>{r.vehicle_type}</td><td className={td}>{PAY_TYPES[r.compensation_type]}{r.compensation_amount_paise ? ` · ${formatINR(r.compensation_amount_paise)}` : ''}</td><td className={td}>{r.open_deliveries}</td><td className={td}>{r.completed_deliveries}</td><td className={td}>{r.is_active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Off</Badge>}</td>
            <td className={td}>{r.is_active ? <ConfirmButton size="sm" variant="ghost" onConfirm={() => toggle.mutate({ path: `/deliveries/riders/${r.id}`, method: 'PATCH', body: { isActive: false } })}>Deactivate</ConfirmButton> : <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ path: `/deliveries/riders/${r.id}`, method: 'PATCH', body: { isActive: true } })}>Activate</Button>}</td></tr>)}
        </Table>
      )}
      <ErrorNote error={toggle.error} />
      <Dialog open={open} onClose={() => setOpen(false)} title="Add rider">
        <div className="space-y-3">
          <Input label="Full name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Input label="Mobile number" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          <Input label="Email (used to sign in)" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          <Input label="Vehicle" optional value={form.vehicleType} onChange={(event) => setForm({ ...form, vehicleType: event.target.value })} />
          <Select label="How are they paid?" value={form.compensationType} onChange={(event) => setForm({ ...form, compensationType: event.target.value as keyof typeof PAY_TYPES })}>{Object.entries(PAY_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
          <MoneyInput label="Amount (₹)" hint="Per delivery, per shift or per day, depending on the choice above. Own riders and shop workers are never treated as free." value={pay} onChange={setPay} />
          <Input label="Temporary password" type="text" hint="At least 10 characters. They must change it when they first sign in." value={form.temporaryPassword} onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })} />
          <ErrorNote error={act.error} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Back</Button><Button loading={act.isPending} disabled={!form.name.trim() || !form.email || !form.phone || form.temporaryPassword.length < 10} onClick={() => act.mutate({ path: '/deliveries/riders', body: { ...form, compensationAmountPaise: pay ?? 0 } })}>Create rider</Button></div>
        </div>
      </Dialog>
    </>
  )
}

export function Deliveries() {
  const ready = useAdminQuery<{ orders: Array<{ id: string; order_number: string; customer_name: string; locality: string; slot_label: string; address_line: string; landmark: string; payment_method: string | null; total_paise: number; own_rider_enabled: number }> }>('/deliveries/ready', { refetchInterval: 30_000 })
  const riders = useAdminQuery<{ riders: Array<{ id: string; name: string; is_active: number }> }>('/deliveries/riders')
  const deliveries = useAdminQuery<{ deliveries: Array<{ id: string; order_id: string; order_number: string; locality: string; slot_label: string; customer_name: string; mode: string; provider: string; status: string; rider_name: string | null; batch_name: string | null; actual_cost_paise: number }> }>('/deliveries?status=open', { refetchInterval: 30_000 })
  const batches = useAdminQuery<{ batches: Array<{ id: string; name: string; locality: string; slot_label: string; rider_name: string; total_cost_paise: number; order_count: number; delivered_count: number; created_at: string }> }>('/deliveries/batches')
  const [picked, setPicked] = useState<string[]>([])
  const [batchOpen, setBatchOpen] = useState(false)
  const [name, setName] = useState('')
  const [riderId, setRiderId] = useState('')
  const [cost, setCost] = useState<number | null>(null)
  const act = useDo(() => { setBatchOpen(false); setPicked([]); setName(''); setCost(null) })
  const groups = new Map<string, NonNullable<typeof ready.data>['orders']>()
  for (const order of ready.data?.orders ?? []) groups.set(`${order.locality} · ${order.slot_label}`, [...(groups.get(`${order.locality} · ${order.slot_label}`) ?? []), order])
  const chosen = ready.data?.orders.filter((o) => picked.includes(o.id)) ?? []

  return (
    <>
      <PageHead title="Deliveries" sub="Group orders going to the same place into one trip, so the cost is shared.">{picked.length > 0 && <Button size="sm" onClick={() => { setName(chosen[0] ? `${chosen[0].locality} ${chosen[0].slot_label}` : ''); setBatchOpen(true) }}>Make a trip of {picked.length}</Button>}</PageHead>
      <h2 className="mb-2 text-xl">Packed and waiting</h2>
      {ready.isPending ? <Spinner /> : ready.isError ? <QueryError error={ready.error} /> : ready.data.orders.length === 0 ? <EmptyState title="Nothing is waiting for delivery" /> : (
        <div className="space-y-4">{[...groups.entries()].map(([group, orders]) => (
          <Card key={group} className="p-4">
            <div className="mb-2 flex items-center justify-between"><h3 className="text-lg">{group}</h3><Button size="sm" variant="ghost" onClick={() => setPicked([...new Set([...picked, ...orders.map((o) => o.id)])])}>Select all here</Button></div>
            <ul className="space-y-2">{orders.map((o) => <li key={o.id} className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-5 accent-forest" aria-label={`Select ${o.order_number}`} checked={picked.includes(o.id)} onChange={(event) => setPicked(event.target.checked ? [...picked, o.id] : picked.filter((id) => id !== o.id))} /><div><Link className="font-semibold text-forest underline" to={`/admin/orders/${o.id}`}>{o.order_number}</Link> · {o.customer_name}<div className="text-ink-soft">{o.address_line}{o.landmark ? `, near ${o.landmark}` : ''}</div>{o.payment_method === 'COD' && <Badge tone="warn">Collect {formatINR(o.total_paise)}</Badge>}</div></li>)}</ul>
          </Card>
        ))}</div>
      )}
      <ErrorNote error={act.error} />

      <h2 className="mb-2 mt-8 text-xl">On the road</h2>
      {deliveries.data && deliveries.data.deliveries.length === 0 ? <p className="text-sm text-ink-soft">No open deliveries.</p> : (
        <Table head={['Order', 'Area', 'By', 'Trip', 'Status']}>{deliveries.data?.deliveries.map((d) => <tr key={d.id}><td className={td}><Link className="text-forest underline" to={`/admin/orders/${d.order_id}`}>{d.order_number}</Link><div className="text-xs text-ink-soft">{d.customer_name}</div></td><td className={td}>{d.locality}<div className="text-xs text-ink-soft">{d.slot_label}</div></td><td className={td}>{d.mode === 'THIRD_PARTY' ? d.provider : d.rider_name}</td><td className={td}>{d.batch_name ?? '–'}</td><td className={td}><Badge tone="info">{d.status.replace('_', ' ').toLowerCase()}</Badge></td></tr>)}</Table>
      )}

      <h2 className="mb-2 mt-8 text-xl">Recent trips</h2>
      <Table head={['Trip', 'Rider', 'Orders', 'Delivered', 'Total cost', 'Share per order']}>{batches.data?.batches.map((b) => <tr key={b.id}><td className={td}><span className="font-semibold">{b.name}</span><div className="text-xs text-ink-soft">{formatDateTime(b.created_at)}</div></td><td className={td}>{b.rider_name}</td><td className={td}>{b.order_count}</td><td className={td}>{b.delivered_count}</td><td className={td}><Money paise={b.total_cost_paise} /></td><td className={td}>{b.order_count ? formatINR(Math.round(b.total_cost_paise / b.order_count)) : '–'}</td></tr>)}</Table>

      <Dialog open={batchOpen} onClose={() => setBatchOpen(false)} title="Make a delivery trip">
        <div className="space-y-3">
          <Notice>{chosen.length} orders: {chosen.map((o) => o.order_number).join(', ')}</Notice>
          <Input label="Trip name" value={name} onChange={(event) => setName(event.target.value)} />
          <Select label="Rider" value={riderId} onChange={(event) => setRiderId(event.target.value)}><option value="">Choose</option>{riders.data?.riders.filter((r) => r.is_active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
          <MoneyInput label="Total cost of this trip (₹)" hint="Split evenly across the orders. Use the rider's real pay or fuel for the trip." value={cost} onChange={setCost} />
          {cost !== null && chosen.length > 0 && <p className="text-sm text-ink-soft">About {formatINR(Math.round(cost / chosen.length))} per order.</p>}
          <ErrorNote error={act.error} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setBatchOpen(false)}>Back</Button><Button disabled={!name.trim() || !riderId || cost === null} loading={act.isPending} onClick={() => act.mutate({ path: '/deliveries/batches', body: { name: name.trim(), locality: chosen[0]?.locality ?? '', slotLabel: chosen[0]?.slot_label ?? '', riderId, totalCostPaise: cost, orderIds: picked } })}>Assign trip</Button></div>
        </div>
      </Dialog>
    </>
  )
}
