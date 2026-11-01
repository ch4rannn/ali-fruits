import { Phone, MessageCircle, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { STATUS_LABELS, type OrderStatus } from '../../../shared/order-state'
import { orderTotal } from '../../../shared/pricing'
import { Badge, Button, Card, Dialog, Input, Notice, QueryError, Select, Spinner, Textarea } from '../../components/ui'
import { formatDateTime, formatINR, todayIst } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { statusTone } from './Orders'
import { ConfirmButton, ErrorNote, Money, MoneyInput, useAdminQuery, useCan, useDo } from './shared'

type Item = {
  id: string; variant_id: string; product_name: string; variant_label: string; requested_qty: number | null; requested_unit_price_paise: number | null
  confirmed_qty: number | null; confirmed_unit_price_paise: number | null; confirmed_line_total_paise: number | null; line_status: string; substitute_for_item_id: string | null
}
type Detail = {
  order: Record<string, any>
  items: Item[]
  revisions: Array<{ revision_number: number; reason: string; total_paise: number; created_by_name: string | null; created_at: string; customer_response: string | null; response_note: string }>
  history: Array<{ new_status: string; previous_status: string | null; changed_by_kind: string; changed_by_name: string | null; reason: string; created_at: string }>
  payments: Array<{ id: string; kind: string; method: string; amount_paise: number; txn_ref: string; status: string; source: string; verified_by_name: string | null; created_at: string; notes: string }>
  deliveries: Array<{ id: string; mode: string; status: string; rider_name: string | null; provider: string; booking_reference: string; tracking_url: string; actual_cost_paise: number; failure_reason: string }>
  tickets: Array<{ id: string; ticket_type: string; status: string; message: string }>
  customerMessages: Array<{ id: string; event: string; body: string; created_at: string; whatsappUrl: string }>
  procurement: Array<{ id: string; order_item_id: string; supplier_name: string; purchased_quantity: number; unit: string; total_cost_paise: number; invoice_reference: string; responsible_employee: string }>
  expenses: Array<{ id: string; category: string; amount_paise: number; description: string }>
  finance: null | { revenue: number; fruitCost: number; grossProfit: number; packaging: number; deliveryCost: number; refundCost: number; otherVariable: number; contribution: number }
  allowedNext: OrderStatus[]
}

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  PROCUREMENT_IN_PROGRESS: 'Start buying fruit', PROCUREMENT_COMPLETED: 'Finish buying', PACKING: 'Start packing', READY_FOR_PICKUP: 'Packed: ready for pickup',
  PENDING_REVIEW: 'Edit the revision again', CANCELLED: 'Cancel order', REJECTED: 'Reject order',
}

type Line = { key: string; itemId?: string; variantId?: string; name: string; label: string; qty: number; price: number | null; requested: string; wholesale: number | null; substituteFor?: string }

function RevisionEditor({ detail, wholesale }: { detail: Detail; wholesale: Map<string, number | null> }) {
  const { order, items } = detail
  const initial = useMemo<Line[]>(() => items.map((item) => ({
    key: item.id, itemId: item.id, variantId: item.variant_id, name: item.product_name, label: item.variant_label,
    qty: item.line_status === 'REMOVED' ? 0 : (item.confirmed_qty ?? item.requested_qty ?? 0),
    price: item.confirmed_unit_price_paise ?? item.requested_unit_price_paise,
    requested: item.requested_qty === null ? 'Added by us' : `${item.requested_qty} × ${formatINR(item.requested_unit_price_paise ?? 0)}`,
    wholesale: wholesale.get(item.variant_id) ?? null, substituteFor: item.substitute_for_item_id ?? undefined,
  })), [items, wholesale])
  const [lines, setLines] = useState<Line[]>(initial)
  const [delivery, setDelivery] = useState<number | null>(order.current_revision > 0 ? order.delivery_fee_paise : order.estimated_delivery_paise)
  const [discount, setDiscount] = useState<number | null>(order.discount_paise)
  const [other, setOther] = useState<number | null>(order.other_charges_paise)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const send = useDo()

  const subtotal = lines.reduce((sum, line) => sum + line.qty * (line.price ?? 0), 0)
  const total = orderTotal({ subtotal, delivery: delivery ?? 0, other: other ?? 0, discount: discount ?? 0 })
  const ready = reason.trim() && lines.every((line) => line.qty === 0 || line.price) && subtotal > 0 && delivery !== null
  const patch = (key: string, next: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...next } : line)))

  return (
    <Card className="p-4">
      <h2 className="text-xl">Check availability and set the final order</h2>
      <p className="mb-3 text-sm text-ink-soft">Confirm with the shop, then set the quantity and price for each line. Set a quantity of 0 for anything unavailable. The customer sees the old and new versions side by side.</p>
      {order.delivery_to_be_quoted ? <Notice tone="warn" className="mb-3">This area has quoted delivery. Set the delivery fee below.</Notice> : null}
      <div className="space-y-3">
        {lines.map((line) => (
          <div key={line.key} className="grid items-end gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_6rem_9rem_auto]">
            <div>
              <p className="font-semibold">{line.name} <span className="font-normal text-ink-soft">({line.label})</span></p>
              <p className="text-xs text-ink-soft">Requested: {line.requested}{line.wholesale !== null && <> · Last wholesale {formatINR(line.wholesale)}{line.price ? <> · margin {formatINR(line.price - line.wholesale)}</> : null}</>}</p>
              {line.substituteFor && <Badge tone="info">Substitute</Badge>}
            </div>
            <Input label="Quantity" type="number" min={0} max={999} value={line.qty} onChange={(event) => patch(line.key, { qty: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} />
            <MoneyInput label="Price each (₹)" value={line.price} onChange={(price) => patch(line.key, { price })} />
            <Button variant="ghost" size="sm" aria-label={line.itemId ? `Mark ${line.name} unavailable` : `Remove ${line.name}`} onClick={() => (line.itemId ? patch(line.key, { qty: 0 }) : setLines((current) => current.filter((item) => item.key !== line.key)))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
      </div>
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => setAdding(true)}><Plus className="size-4" /> Add a product or substitute</Button>
      <AddProduct open={adding} onClose={() => setAdding(false)} lines={lines} onAdd={(line) => { setLines((current) => [...current, line]); setAdding(false) }} />

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MoneyInput label="Delivery fee (₹)" value={delivery} onChange={setDelivery} />
        <MoneyInput label="Discount (₹)" value={discount} onChange={setDiscount} optional />
        <MoneyInput label="Other charges (₹)" value={other} onChange={setOther} optional />
      </div>
      <Textarea className="mt-3" label="Reason for any change" hint="The customer sees this, for example: Oranges unavailable today; apple price changed at the mandi." value={reason} onChange={(event) => setReason(event.target.value)} />
      <Textarea className="mt-3" label="Internal note" optional value={note} onChange={(event) => setNote(event.target.value)} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <p className="font-display text-xl font-bold">Final total {formatINR(total)}</p>
        <Button disabled={!ready} loading={send.isPending} onClick={() => send.mutate({ path: `/orders/${order.id}/revisions`, body: {
          reason: reason.trim(), internalNote: note.trim(), deliveryFeePaise: delivery ?? 0, discountPaise: discount ?? 0, otherChargesPaise: other ?? 0,
          items: lines.map((line) => ({ itemId: line.itemId, variantId: line.itemId ? undefined : line.variantId, qty: line.qty, unitPricePaise: line.price ?? 0, substituteForItemId: line.itemId ? undefined : line.substituteFor })),
        } })}>Send to customer for approval</Button>
      </div>
      <ErrorNote error={send.error} />
    </Card>
  )
}

function AddProduct({ open, onClose, lines, onAdd }: { open: boolean; onClose: () => void; lines: Line[]; onAdd: (line: Line) => void }) {
  const products = useAdminQuery<{ products: Array<{ id: string; name: string; availability: string; variants: Array<{ id: string; label: string; retail_price_paise: number; is_active: number }> }> }>('/catalog/products', { enabled: open })
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [replaces, setReplaces] = useState('')
  const product = products.data?.products.find((item) => item.id === productId)
  const variant = product?.variants.find((item) => item.id === variantId)
  return (
    <Dialog open={open} onClose={onClose} title="Add a product">
      <div className="space-y-3">
        <Select label="Product" value={productId} onChange={(event) => { setProductId(event.target.value); setVariantId('') }}>
          <option value="">Choose</option>
          {products.data?.products.filter((item) => item.availability === 'AVAILABLE').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        {product && <Select label="Unit" value={variantId} onChange={(event) => setVariantId(event.target.value)}><option value="">Choose</option>{product.variants.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.label} · {formatINR(item.retail_price_paise)}</option>)}</Select>}
        <Select label="This replaces" optional value={replaces} onChange={(event) => setReplaces(event.target.value)}>
          <option value="">Nothing (an extra item)</option>
          {lines.filter((line) => line.itemId).map((line) => <option key={line.key} value={line.itemId}>{line.name}</option>)}
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!variant} onClick={() => variant && product && onAdd({ key: uuid(), variantId: variant.id, name: product.name, label: variant.label, qty: 1, price: variant.retail_price_paise, requested: 'Added by us', wholesale: null, substituteFor: replaces || undefined })}>Add</Button>
        </div>
      </div>
    </Dialog>
  )
}

function ReasonDialog({ open, onClose, title, label, submit, pending, error, confirmText }: { open: boolean; onClose: () => void; title: string; label: string; submit: (reason: string) => void; pending: boolean; error: unknown; confirmText: string }) {
  const [reason, setReason] = useState('')
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <Textarea label={label} value={reason} onChange={(event) => setReason(event.target.value)} />
      <ErrorNote error={error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Back</Button><Button variant="danger" disabled={!reason.trim()} loading={pending} onClick={() => submit(reason.trim())}>{confirmText}</Button></div>
    </Dialog>
  )
}

export default function OrderDetail() {
  const { id } = useParams()
  const can = useCan()
  const query = useAdminQuery<Detail>(`/orders/${id}`, { refetchInterval: 30_000 })
  const pricing = useAdminQuery<{ prices: Array<{ variant_id: string; wholesale_price_paise: number | null }> }>('/catalog/pricing', { enabled: can('pricing.write') })
  const wholesale = useMemo(() => new Map((pricing.data?.prices ?? []).map((price) => [price.variant_id, price.wholesale_price_paise])), [pricing.data])
  const action = useDo()
  const [reasonFor, setReasonFor] = useState<OrderStatus | null>(null)
  const [approval, setApproval] = useState(false)
  const [approvalNote, setApprovalNote] = useState('')
  const [approvalPay, setApprovalPay] = useState<'COD' | 'UPI'>('COD')

  if (query.isPending) return <Spinner />
  if (query.isError) return <QueryError error={query.error} retry={() => void query.refetch()} />
  const d = query.data
  const o = d.order
  const status = o.status as OrderStatus
  const live = o.order_type === 'ORDER'
  const editable = can('orders.write')
  const run = (path: string, body?: unknown, method = 'POST') => action.mutate({ path, body, method })
  const itemById = new Map(d.items.map((item) => [item.id, item]))
  const activeItems = d.items.filter((item) => item.line_status === 'CONFIRMED' || item.line_status === 'ADDED')
  const received = d.payments.filter((p) => p.kind === 'PAYMENT' && (p.status === 'VERIFIED' || (p.method === 'COD' && p.status !== 'FAILED' && p.status !== 'PENDING'))).reduce((sum, p) => sum + p.amount_paise, 0)
  const canStartRefund = can('payments.write') && ['DELIVERED', 'CANCELLED', 'FAILED_DELIVERY'].includes(status) && received > 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/admin/orders" className="text-sm text-forest underline">All orders</Link>
          <h1 className="text-3xl">{o.order_number}</h1>
          <p className="text-sm text-ink-soft">Placed {formatDateTime(o.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">{!live && <Badge tone="warn">Enquiry</Badge>}<Badge tone={statusTone(status)} className="text-sm">{STATUS_LABELS[status]}</Badge></div>
      </div>
      <ErrorNote error={action.error} />

      {!live && <Notice tone="warn" title="This is a non-binding enquiry">Online ordering was not enabled when it was placed, so it cannot be confirmed or paid for here. Reply to the customer directly, or close it.</Notice>}
      {status === 'PENDING_REVIEW' && live && <Notice tone="warn" title="Check this order with the shop">Confirm availability and today&rsquo;s prices, then send the final order to the customer. Nothing should be bought yet.</Notice>}
      {status === 'AWAITING_CUSTOMER_APPROVAL' && <Notice tone="info" title="Waiting for the customer">Fruit is not bought until they accept. If they approved by phone or WhatsApp, record it below.</Notice>}
      {o.customer_note && status === 'PENDING_REVIEW' && <Notice tone="info" title="The customer asked for a change">{o.customer_note}</Notice>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {status === 'PENDING_REVIEW' && live && editable ? (
            <RevisionEditor key={`${o.current_revision}-${d.items.length}`} detail={d} wholesale={wholesale} />
          ) : (
            <Card className="p-4">
              <h2 className="mb-2 text-xl">Items</h2>
              <div className="overflow-x-auto"><table className="w-full min-w-[32rem] text-sm"><thead><tr className="border-b border-line text-left text-ink-soft"><th className="py-2 pr-2 font-medium">Item</th><th className="py-2 pr-2 font-medium">Requested</th><th className="py-2 pr-2 font-medium">Final</th></tr></thead><tbody>
                {d.items.map((item) => (
                  <tr key={item.id} className="border-b border-line/60 align-top">
                    <td className="py-2 pr-2"><span className={item.line_status === 'REMOVED' ? 'line-through text-ink-soft' : 'font-semibold'}>{item.product_name}</span> <span className="text-ink-soft">({item.variant_label})</span>{item.substitute_for_item_id && <div><Badge tone="info">Substitute for {itemById.get(item.substitute_for_item_id)?.product_name}</Badge></div>}{item.line_status === 'REMOVED' && <div><Badge tone="warn">Unavailable</Badge></div>}</td>
                    <td className="py-2 pr-2">{item.requested_qty === null ? '–' : `${item.requested_qty} × ${formatINR(item.requested_unit_price_paise ?? 0)}`}</td>
                    <td className="py-2 pr-2">{item.line_status === 'REMOVED' || item.confirmed_qty === null ? '–' : `${item.confirmed_qty} × ${formatINR(item.confirmed_unit_price_paise ?? 0)} = ${formatINR(item.confirmed_line_total_paise ?? 0)}`}</td>
                  </tr>
                ))}
              </tbody></table></div>
              <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                <div className="flex justify-between"><dt>Customer's estimate</dt><dd>{formatINR(o.estimated_total_paise)}</dd></div>
                {o.current_revision > 0 && <>
                  <div className="flex justify-between"><dt>Fruit</dt><dd>{formatINR(o.subtotal_paise)}</dd></div>
                  <div className="flex justify-between"><dt>Delivery</dt><dd>{formatINR(o.delivery_fee_paise)}</dd></div>
                  {o.other_charges_paise > 0 && <div className="flex justify-between"><dt>Other charges</dt><dd>{formatINR(o.other_charges_paise)}</dd></div>}
                  {o.discount_paise > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>-{formatINR(o.discount_paise)}</dd></div>}
                  <div className="flex justify-between font-display text-lg font-bold"><dt>Final total</dt><dd>{formatINR(o.total_paise)}</dd></div>
                </>}
              </dl>
            </Card>
          )}

          {editable && ['CONFIRMED', 'PROCUREMENT_IN_PROGRESS', 'PROCUREMENT_COMPLETED'].includes(status) && <Procurement detail={d} items={activeItems} />}
          {can('costs.read') && d.procurement.length > 0 && !['CONFIRMED', 'PROCUREMENT_IN_PROGRESS', 'PROCUREMENT_COMPLETED'].includes(status) && (
            <Card className="p-4"><h2 className="mb-2 text-xl">Fruit bought</h2><ul className="space-y-1 text-sm">{d.procurement.map((p) => <li key={p.id} className="flex justify-between"><span>{itemById.get(p.order_item_id)?.product_name} · {p.supplier_name}</span><Money paise={p.total_cost_paise} /></li>)}</ul></Card>
          )}

          <Payments detail={d} canPay={can('payments.write')} />
          {can('deliveries.manage') && ['READY_FOR_PICKUP'].includes(status) && live && <AssignRider orderId={o.id} />}
          {d.deliveries.length > 0 && <Deliveries detail={d} canManage={can('deliveries.manage')} />}

          <Card className="p-4">
            <h2 className="mb-2 text-xl">Messages for the customer</h2>
            <p className="mb-2 text-sm text-ink-soft">Nothing is sent automatically. Open WhatsApp to send each message yourself.</p>
            {d.customerMessages.length === 0 ? <p className="text-sm text-ink-soft">None yet.</p> : <ul className="space-y-2">{d.customerMessages.map((m) => <li key={m.id} className="rounded-md border border-line p-2 text-sm"><p>{m.body}</p><a className="mt-1 inline-flex items-center gap-1 font-semibold text-forest underline" href={m.whatsappUrl} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-4" /> Send on WhatsApp</a></li>)}</ul>}
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="space-y-1 p-4 text-sm">
            <h2 className="mb-1 text-xl">Customer</h2>
            <p className="font-semibold">{o.customer_name}</p>
            <p className="flex flex-wrap gap-3"><a className="inline-flex items-center gap-1 text-forest underline" href={`tel:${o.customer_phone}`}><Phone className="size-4" />{o.customer_phone}</a></p>
            {o.customer_email && <p>{o.customer_email}</p>}
            <p className="pt-2">{o.address_line}</p>
            <p>{o.locality} {o.pin_code}</p>
            {o.landmark && <p className="text-ink-soft">Near {o.landmark}</p>}
            {o.instructions && <p className="text-ink-soft">Note: {o.instructions}</p>}
            <p className="pt-2 text-ink-soft">Slot: {o.slot_label}</p>
            <a className="inline-flex items-center gap-1 pt-1 text-forest underline" href={`https://wa.me/91${o.customer_phone}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-4" /> WhatsApp</a>
            <p className="pt-2 text-xs text-ink-soft break-all">Customer link: {o.tracking_url}</p>
          </Card>

          <Card className="space-y-2 p-4">
            <h2 className="text-xl">Actions</h2>
            {editable && status === 'AWAITING_CUSTOMER_APPROVAL' && live && <Button full variant="secondary" onClick={() => setApproval(true)}>Record approval from phone or WhatsApp</Button>}
            {editable && d.allowedNext.filter((next) => live || next === 'CANCELLED' || next === 'REJECTED').map((next) => {
              const risky = next === 'CANCELLED' || next === 'REJECTED'
              return risky ? <Button key={next} full variant="dangerOutline" onClick={() => setReasonFor(next)}>{ACTION_LABEL[next] ?? STATUS_LABELS[next]}</Button> : (
                <Button key={next} full loading={action.isPending} onClick={() => run(`/orders/${o.id}/transition`, { to: next })}>{ACTION_LABEL[next] ?? STATUS_LABELS[next]}</Button>
              )
            })}
            {status === 'PROCUREMENT_IN_PROGRESS' && <p className="text-xs text-ink-soft">Record what you paid for every line before finishing.</p>}
            {canStartRefund && <ConfirmButton full variant="secondary" onConfirm={() => run(`/finance/orders/${o.id}/refund-start`)}>Start a refund</ConfirmButton>}
            {status === 'REFUND_PENDING' && can('payments.write') && <RefundForm orderId={o.id} />}
            {!editable && !can('payments.write') && !can('deliveries.manage') && <p className="text-sm text-ink-soft">You can view this order but not change it.</p>}
          </Card>

          {d.finance && (
            <Card className="p-4 text-sm">
              <h2 className="mb-2 text-xl">Money on this order</h2>
              <dl className="space-y-1">
                <div className="flex justify-between"><dt>Revenue</dt><dd><Money paise={d.finance.revenue} /></dd></div>
                <div className="flex justify-between"><dt>Fruit cost</dt><dd><Money paise={d.finance.fruitCost} /></dd></div>
                <div className="flex justify-between font-semibold"><dt>Gross profit</dt><dd><Money paise={d.finance.grossProfit} tone /></dd></div>
                <div className="flex justify-between"><dt>Packaging</dt><dd><Money paise={d.finance.packaging} /></dd></div>
                <div className="flex justify-between"><dt>Delivery cost</dt><dd><Money paise={d.finance.deliveryCost} /></dd></div>
                {d.finance.refundCost > 0 && <div className="flex justify-between"><dt>Refunds</dt><dd><Money paise={d.finance.refundCost} /></dd></div>}
                <div className="flex justify-between border-t border-line pt-1 font-display text-base font-bold"><dt>Contribution</dt><dd><Money paise={d.finance.contribution} tone /></dd></div>
              </dl>
              <p className="mt-2 text-xs text-ink-soft">Revenue counts only once delivered. Costs count even if the order fails.</p>
              {editable && <Packaging orderId={o.id} />}
            </Card>
          )}

          <Notes orderId={o.id} initial={o.internal_notes} disabled={!editable} />

          {d.tickets.length > 0 && <Card className="p-4 text-sm"><h2 className="mb-1 text-xl">Support requests</h2>{d.tickets.map((t) => <p key={t.id}><Badge>{t.status}</Badge> {t.ticket_type.replace('_', ' ').toLowerCase()}: {t.message}</p>)}</Card>}

          <Card className="p-4 text-sm">
            <h2 className="mb-2 text-xl">History</h2>
            <ol className="space-y-2">{d.history.map((h, index) => <li key={index}><p className="font-semibold">{STATUS_LABELS[h.new_status as OrderStatus]}</p><p className="text-xs text-ink-soft">{formatDateTime(h.created_at)} · {h.changed_by_name ?? h.changed_by_kind}{h.reason ? ` · ${h.reason}` : ''}</p></li>)}</ol>
            {d.revisions.length > 0 && <><h3 className="mb-1 mt-4 text-base">Revisions</h3><ul className="space-y-1">{d.revisions.map((r) => <li key={r.revision_number}>#{r.revision_number}: {formatINR(r.total_paise)} · {r.reason}{r.customer_response ? <> · <Badge tone={r.customer_response === 'ACCEPT_ORDER' ? 'good' : 'warn'}>{r.customer_response.replace('_', ' ').toLowerCase()}</Badge></> : null}</li>)}</ul></>}
          </Card>
        </div>
      </div>

      <ReasonDialog open={reasonFor !== null} onClose={() => setReasonFor(null)} title={reasonFor === 'REJECTED' ? 'Reject this order' : 'Cancel this order'} label="Reason (the customer may be told)" confirmText={reasonFor === 'REJECTED' ? 'Reject order' : 'Cancel order'} pending={action.isPending} error={action.error} submit={(reason) => reasonFor && action.mutate({ path: `/orders/${o.id}/transition`, body: { to: reasonFor, reason } }, { onSuccess: () => setReasonFor(null) })} />
      <Dialog open={approval} onClose={() => setApproval(false)} title="Record customer approval">
        <p className="mb-3 text-sm text-ink-soft">Only use this when the customer has clearly agreed to the final total. This is written to the audit log.</p>
        <Select label="Payment" value={approvalPay} onChange={(event) => setApprovalPay(event.target.value as 'COD' | 'UPI')}><option value="COD">Cash on delivery</option><option value="UPI">UPI</option></Select>
        <Textarea className="mt-3" label="How and when they approved" value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} />
        <ErrorNote error={action.error} />
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setApproval(false)}>Back</Button><Button disabled={!approvalNote.trim()} loading={action.isPending} onClick={() => action.mutate({ path: `/orders/${o.id}/record-approval`, body: { revision: o.current_revision, paymentMethod: approvalPay, note: approvalNote.trim() } }, { onSuccess: () => setApproval(false) })}>Record approval</Button></div>
      </Dialog>
    </div>
  )
}

function Notes({ orderId, initial, disabled }: { orderId: string; initial: string; disabled: boolean }) {
  const [text, setText] = useState(initial)
  const save = useDo()
  return (
    <Card className="p-4">
      <Textarea label="Internal notes" hint="Only staff see these." value={text} disabled={disabled} onChange={(event) => setText(event.target.value)} />
      {!disabled && <Button className="mt-2" size="sm" variant="secondary" loading={save.isPending} disabled={text === initial} onClick={() => save.mutate({ path: `/orders/${orderId}/notes`, method: 'PATCH', body: { internalNotes: text } })}>Save note</Button>}
      <ErrorNote error={save.error} />
    </Card>
  )
}

function Packaging({ orderId }: { orderId: string }) {
  const [amount, setAmount] = useState<number | null>(null)
  const add = useDo(() => setAmount(null))
  return (
    <div className="mt-3 border-t border-line pt-3">
      <MoneyInput label="Add packaging cost (₹)" value={amount} onChange={setAmount} />
      <Button className="mt-2" size="sm" variant="secondary" disabled={!amount} loading={add.isPending} onClick={() => add.mutate({ path: '/finance/expenses', body: { category: 'PACKAGING', amountPaise: amount, expenseDate: todayIst(), orderId } })}>Add</Button>
      <ErrorNote error={add.error} />
    </div>
  )
}

function Procurement({ detail, items }: { detail: Detail; items: Item[] }) {
  const suppliers = useAdminQuery<{ suppliers: Array<{ id: string; name: string; is_active: number }> }>('/procurement/suppliers')
  const can = useCan()
  const recordsByItem = new Map<string, Detail['procurement']>()
  for (const record of detail.procurement) recordsByItem.set(record.order_item_id, [...(recordsByItem.get(record.order_item_id) ?? []), record])
  const buying = detail.order.status === 'PROCUREMENT_IN_PROGRESS'
  return (
    <Card className="p-4">
      <h2 className="text-xl">Buying the fruit</h2>
      {detail.order.status === 'CONFIRMED' ? (
        <p className="mt-1 text-sm text-ink-soft">The customer has approved. {detail.order.payment_method === 'UPI' && detail.order.payment_status !== 'PAID' ? 'Verify their UPI payment, or switch to cash on delivery, before you start buying.' : 'You can start buying now.'}</p>
      ) : (
        <p className="mt-1 text-sm text-ink-soft">Record what you actually paid for each line.</p>
      )}
      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-md border border-line p-3">
            <p className="font-semibold">{item.product_name} <span className="font-normal text-ink-soft">({item.variant_label}) × {item.confirmed_qty}</span></p>
            {(recordsByItem.get(item.id) ?? []).map((record) => (
              <p key={record.id} className="flex items-center justify-between text-sm">
                <span>{record.supplier_name}: {record.purchased_quantity} {record.unit}{record.invoice_reference ? ` · ${record.invoice_reference}` : ''}</span>
                <span className="flex items-center gap-2">{can('costs.read') && <Money paise={record.total_cost_paise} />}{buying && <DeleteRecord id={record.id} />}</span>
              </p>
            ))}
            {buying && <RecordForm orderId={detail.order.id} item={item} suppliers={suppliers.data?.suppliers.filter((s) => s.is_active) ?? []} />}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function DeleteRecord({ id }: { id: string }) {
  const del = useDo()
  return <ConfirmButton size="sm" variant="ghost" onConfirm={() => del.mutate({ path: `/procurement/records/${id}`, method: 'DELETE' })}>Remove</ConfirmButton>
}

function RecordForm({ orderId, item, suppliers }: { orderId: string; item: Item; suppliers: Array<{ id: string; name: string }> }) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState<'g' | 'piece' | 'dozen' | 'box'>('g')
  const [cost, setCost] = useState<number | null>(null)
  const [invoice, setInvoice] = useState('')
  const save = useDo(() => { setQuantity(''); setCost(null); setInvoice('') })
  const sid = supplierId || suppliers[0]?.id || ''
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-6">
      <Select label="Bought from" className="sm:col-span-2" value={sid} onChange={(event) => setSupplierId(event.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      <Input label="Quantity" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
      <Select label="Unit" value={unit} onChange={(event) => setUnit(event.target.value as typeof unit)}><option value="g">grams</option><option value="piece">pieces</option><option value="dozen">dozen</option><option value="box">box</option></Select>
      <MoneyInput label="Total paid (₹)" value={cost} onChange={setCost} />
      <Input label="Bill no." optional value={invoice} onChange={(event) => setInvoice(event.target.value)} />
      <div className="sm:col-span-6"><Button size="sm" loading={save.isPending} disabled={!sid || !Number(quantity) || cost === null} onClick={() => save.mutate({ path: `/procurement/orders/${orderId}/records`, body: { orderItemId: item.id, supplierId: sid, purchasedQuantity: Math.floor(Number(quantity)), unit, totalCostPaise: cost, invoiceReference: invoice } })}>Record purchase</Button><ErrorNote error={save.error} /></div>
    </div>
  )
}

function Payments({ detail, canPay }: { detail: Detail; canPay: boolean }) {
  const o = detail.order
  const act = useDo()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState<number | null>(o.total_paise)
  const [method, setMethod] = useState<'UPI' | 'COD' | 'OTHER'>(o.payment_method ?? 'UPI')
  const [ref, setRef] = useState('')
  if (o.current_revision === 0 || o.order_type === 'ENQUIRY') return null
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between"><h2 className="text-xl">Payment</h2><Badge tone={o.payment_status === 'PAID' ? 'good' : o.payment_status === 'FAILED' ? 'bad' : 'warn'}>{o.payment_status.replace('_', ' ').toLowerCase()}</Badge></div>
      <p className="text-sm text-ink-soft">Customer chose {o.payment_method === 'COD' ? 'cash on delivery' : o.payment_method === 'UPI' ? 'UPI' : `${o.payment_preference === 'UPI' ? 'UPI' : 'cash on delivery'} (not yet confirmed)`}. Compare any UPI payment with your actual bank or UPI record. Never rely on a screenshot.</p>
      {detail.payments.length > 0 && <ul className="mt-3 space-y-2 text-sm">{detail.payments.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2">
          <span>{p.kind === 'REFUND' ? 'Refund' : 'Payment'} {formatINR(p.amount_paise)} · {p.method}{p.txn_ref ? ` · ${p.txn_ref}` : ''} <Badge tone={p.status === 'VERIFIED' ? 'good' : p.status === 'FAILED' ? 'bad' : 'warn'}>{p.status.toLowerCase()}</Badge> <span className="text-xs text-ink-soft">({p.source.toLowerCase()})</span></span>
          {canPay && p.status === 'PENDING' && <span className="flex gap-1"><Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: `/finance/payments/${p.id}/verify`, body: { decision: 'VERIFIED' } })}>I saw this in the bank</Button><Button size="sm" variant="dangerOutline" onClick={() => act.mutate({ path: `/finance/payments/${p.id}/verify`, body: { decision: 'FAILED' } })}>Not received</Button></span>}
        </li>))}</ul>}
      {canPay && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Record a payment I received</Button>
          {o.status === 'CONFIRMED' && o.payment_method === 'UPI' && o.payment_status !== 'PAID' && <ConfirmButton size="sm" variant="secondary" onConfirm={() => act.mutate({ path: `/finance/orders/${o.id}/use-cod`, method: 'POST' })}>Switch to cash on delivery</ConfirmButton>}
        </div>
      )}
      <ErrorNote error={act.error} />
      <Dialog open={open} onClose={() => setOpen(false)} title="Record a payment">
        <div className="space-y-3">
          <MoneyInput label="Amount received (₹)" value={amount} onChange={setAmount} />
          <Select label="Method" value={method} onChange={(event) => setMethod(event.target.value as typeof method)}><option value="UPI">UPI</option><option value="COD">Cash</option><option value="OTHER">Other</option></Select>
          <Input label="Transaction reference" optional value={ref} onChange={(event) => setRef(event.target.value)} />
          <ErrorNote error={act.error} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Back</Button><Button disabled={!amount} loading={act.isPending} onClick={() => act.mutate({ path: '/finance/payments', body: { orderId: o.id, amountPaise: amount, method, txnRef: ref } }, { onSuccess: () => setOpen(false) })}>Save</Button></div>
        </div>
      </Dialog>
    </Card>
  )
}

function RefundForm({ orderId }: { orderId: string }) {
  const [amount, setAmount] = useState<number | null>(null)
  const [method, setMethod] = useState<'UPI' | 'COD' | 'OTHER'>('UPI')
  const [ref, setRef] = useState('')
  const [notes, setNotes] = useState('')
  const act = useDo()
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="text-sm font-semibold">Record the refund you have made</p>
      <MoneyInput label="Amount refunded (₹)" value={amount} onChange={setAmount} />
      <Select label="Method" value={method} onChange={(event) => setMethod(event.target.value as typeof method)}><option value="UPI">UPI</option><option value="COD">Cash</option><option value="OTHER">Other</option></Select>
      <Input label="Reference" optional value={ref} onChange={(event) => setRef(event.target.value)} />
      <Input label="Notes" optional value={notes} onChange={(event) => setNotes(event.target.value)} />
      <ErrorNote error={act.error} />
      <Button full disabled={!amount} loading={act.isPending} onClick={() => act.mutate({ path: `/finance/orders/${orderId}/refund`, body: { amountPaise: amount, method, txnRef: ref, notes } })}>Record refund</Button>
    </div>
  )
}

function AssignRider({ orderId }: { orderId: string }) {
  const riders = useAdminQuery<{ riders: Array<{ id: string; name: string; is_active: number; open_deliveries: number }> }>('/deliveries/riders')
  const [riderId, setRiderId] = useState('')
  const [provider, setProvider] = useState('')
  const [fee, setFee] = useState<number | null>(null)
  const [reference, setReference] = useState('')
  const [tracking, setTracking] = useState('')
  const act = useDo()
  return (
    <Card className="p-4">
      <h2 className="text-xl">Send for delivery</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Select label="Our rider" value={riderId} onChange={(event) => setRiderId(event.target.value)}><option value="">Choose a rider</option>{riders.data?.riders.filter((r) => r.is_active).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.open_deliveries} open)</option>)}</Select>
        <Button disabled={!riderId} loading={act.isPending} onClick={() => act.mutate({ path: '/deliveries/assign', body: { orderId, riderId } })}>Assign rider</Button>
      </div>
      <details className="mt-4"><summary className="font-semibold">Book a third-party delivery instead</summary>
        <p className="my-2 text-sm text-ink-soft">Book in the provider&rsquo;s own app, then record it here. We do not connect to provider systems.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Provider" placeholder="Porter, Rapido, Shadowfax…" value={provider} onChange={(event) => setProvider(event.target.value)} />
          <MoneyInput label="Actual fee (₹)" value={fee} onChange={setFee} />
          <Input label="Booking reference" optional value={reference} onChange={(event) => setReference(event.target.value)} />
          <Input label="Tracking link" optional value={tracking} onChange={(event) => setTracking(event.target.value)} />
        </div>
        <Button className="mt-3" variant="secondary" disabled={!provider.trim() || fee === null} loading={act.isPending} onClick={() => act.mutate({ path: '/deliveries/third-party', body: { orderId, provider: provider.trim(), actualFeePaise: fee, bookingReference: reference, trackingUrl: tracking } })}>Record booking</Button>
      </details>
      <ErrorNote error={act.error} />
    </Card>
  )
}

function Deliveries({ detail, canManage }: { detail: Detail; canManage: boolean }) {
  const act = useDo()
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-xl">Delivery</h2>
      <ul className="space-y-3">{detail.deliveries.map((d) => (
        <li key={d.id} className="rounded-md border border-line p-3 text-sm">
          <p className="font-semibold">{d.mode === 'THIRD_PARTY' ? `${d.provider}${d.booking_reference ? ` · ${d.booking_reference}` : ''}` : `Rider ${d.rider_name ?? ''}`} <Badge tone={d.status === 'DELIVERED' ? 'good' : d.status === 'FAILED' || d.status === 'CANCELLED' ? 'bad' : 'info'}>{d.status.replace('_', ' ').toLowerCase()}</Badge></p>
          <p className="text-ink-soft">Delivery cost {formatINR(d.actual_cost_paise)}{d.failure_reason ? ` · ${d.failure_reason}` : ''}</p>
          {d.tracking_url && <a className="text-forest underline" href={d.tracking_url} target="_blank" rel="noopener noreferrer">Tracking link</a>}
          {canManage && !['DELIVERED', 'FAILED', 'CANCELLED'].includes(d.status) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {['ASSIGNED', 'ACCEPTED'].includes(d.status) && <><Button size="sm" onClick={() => act.mutate({ path: `/deliveries/${d.id}/status`, body: { status: 'PICKED_UP' } })}>Picked up</Button><ConfirmButton size="sm" variant="secondary" onConfirm={() => act.mutate({ path: `/deliveries/${d.id}/unassign`, method: 'POST' })}>Take back</ConfirmButton></>}
              {d.status === 'PICKED_UP' && <Button size="sm" onClick={() => act.mutate({ path: `/deliveries/${d.id}/status`, body: { status: 'OUT_FOR_DELIVERY' } })}>Out for delivery</Button>}
              {['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(d.status) && d.mode === 'THIRD_PARTY' && <DeliveredForm id={d.id} cod={detail.order.payment_method === 'COD'} total={detail.order.total_paise} />}
              {['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(d.status) && <Button size="sm" variant="dangerOutline" onClick={() => act.mutate({ path: `/deliveries/${d.id}/status`, body: { status: 'FAILED', note: 'Marked failed by manager' } })}>Failed</Button>}
            </div>
          )}
        </li>))}</ul>
      <ErrorNote error={act.error} />
    </Card>
  )
}

function DeliveredForm({ id, cod, total }: { id: string; cod: boolean; total: number }) {
  const [cash, setCash] = useState<number | null>(cod ? total : null)
  const act = useDo()
  return <span className="flex items-end gap-2">{cod && <MoneyInput label="Cash collected (₹)" value={cash} onChange={setCash} />}<Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: `/deliveries/${id}/status`, body: { status: 'DELIVERED', codCollectedPaise: cod ? (cash ?? 0) : undefined } })}>Delivered</Button><ErrorNote error={act.error} /></span>
}
