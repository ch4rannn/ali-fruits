import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, MessageCircle, Truck } from 'lucide-react'
import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ORDER_RECEIVED_MESSAGE } from '../../../shared/brand'
import { Badge, Button, Card, Dialog, EmptyState, Input, Notice, QueryError, Spinner, Textarea, cx } from '../../components/ui'
import { api, ApiRequestError, errorMessage, mediaUrl } from '../../lib/api'
import { useConfig, usePageTitle, whatsappHref } from '../../lib/data'
import { formatDateTime, formatINR, parseRupees } from '../../lib/format'

type Item = {
  id: string
  product_name: string
  variant_label: string
  requested_qty: number | null
  requested_unit_price_paise: number | null
  confirmed_qty: number | null
  confirmed_unit_price_paise: number | null
  confirmed_line_total_paise: number | null
  line_status: 'REQUESTED' | 'CONFIRMED' | 'REMOVED' | 'ADDED'
  substitute_for_item_id: string | null
}
type Tracking = {
  orderNumber: string
  orderType: 'ORDER' | 'ENQUIRY'
  status: string
  statusLabel: string
  createdAt: string
  address: { line: string; locality: string; pinCode: string; landmark: string }
  slotLabel: string
  estimate: { subtotalPaise: number; deliveryPaise: number; totalPaise: number; deliveryToBeQuoted: boolean }
  final: { subtotalPaise: number; deliveryPaise: number; discountPaise: number; otherChargesPaise: number; totalPaise: number } | null
  currentRevision: number
  paymentMethod: 'UPI' | 'COD' | null
  paymentPreference: string
  paymentStatus: string
  canCancel: boolean
  items: Item[]
  revisions: Array<{ revision_number: number; reason: string; total_paise: number; created_at: string; customer_response: string | null }>
  history: Array<{ status: string; label: string; at: string }>
  payments: Array<{ amount_paise: number; method: string; status: string; txn_ref: string; created_at: string }>
  upi: { id: string; displayName: string; qrKey: string | null; instructions: string } | null
  delivery: { status: string; provider: string | null; trackingUrl: string | null; otp: string | null } | null
}

const STEPS = ['Received', 'Checked', 'Confirmed', 'Buying and packing', 'On the way', 'Delivered']
const STEP_OF: Record<string, number> = {
  PENDING_REVIEW: 0, AWAITING_CUSTOMER_APPROVAL: 1, CONFIRMED: 2, PROCUREMENT_IN_PROGRESS: 3, PROCUREMENT_COMPLETED: 3, PACKING: 3, READY_FOR_PICKUP: 3,
  ASSIGNED_TO_RIDER: 4, PICKED_UP: 4, OUT_FOR_DELIVERY: 4, DELIVERED: 5,
}
const ENDED = ['REJECTED', 'CANCELLED', 'FAILED_DELIVERY', 'REFUND_PENDING', 'REFUNDED']

function Stepper({ status }: { status: string }) {
  if (ENDED.includes(status)) return null
  const current = STEP_OF[status] ?? 0
  return (
    <ol className="grid grid-cols-6 gap-1" aria-label="Order progress">
      {STEPS.map((label, index) => (
        <li key={label} className="text-center" aria-current={index === current ? 'step' : undefined}>
          <span className={cx('mx-auto grid size-7 place-items-center rounded-full text-xs font-bold', index < current ? 'bg-forest text-paper' : index === current ? 'bg-citrus text-ink ring-2 ring-forest' : 'bg-mist text-ink-soft')}>
            {index < current ? <Check className="size-4" aria-hidden /> : index + 1}
          </span>
          <span className={cx('mt-1 block text-[11px] leading-tight', index === current ? 'font-semibold' : 'text-ink-soft')}>{label}</span>
        </li>
      ))}
    </ol>
  )
}

function Lines({ data }: { data: Tracking }) {
  const showFinal = data.currentRevision > 0
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-ink-soft">
            <th className="py-2 pr-2 font-medium">Fruit</th>
            <th className="py-2 pr-2 font-medium">You asked for</th>
            {showFinal && <th className="py-2 pr-2 font-medium">Final</th>}
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => {
            const removed = item.line_status === 'REMOVED'
            const substitute = item.substitute_for_item_id ? data.items.find((other) => other.id === item.substitute_for_item_id) : null
            return (
              <tr key={item.id} className="border-b border-line/60 align-top">
                <td className="py-2 pr-2">
                  <span className={cx('font-semibold', removed && 'text-ink-soft line-through')}>{item.product_name}</span> <span className="text-ink-soft">({item.variant_label})</span>
                  {item.line_status === 'ADDED' && <div><Badge tone="info">{substitute ? `Substitute for ${substitute.product_name}` : 'Added by us'}</Badge></div>}
                  {removed && <div><Badge tone="warn">Not available</Badge></div>}
                </td>
                <td className="py-2 pr-2">{item.requested_qty === null ? '–' : `${item.requested_qty} × ${formatINR(item.requested_unit_price_paise ?? 0)}`}</td>
                {showFinal && <td className="py-2 pr-2 font-semibold">{removed || item.confirmed_qty === null ? '–' : `${item.confirmed_qty} × ${formatINR(item.confirmed_unit_price_paise ?? 0)} = ${formatINR(item.confirmed_line_total_paise ?? 0)}`}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Approval({ data, token }: { data: Tracking; token: string }) {
  const client = useQueryClient()
  const [payment, setPayment] = useState<'UPI' | 'COD'>(data.paymentPreference === 'UPI' ? 'UPI' : 'COD')
  const [mode, setMode] = useState<null | 'REJECT_ORDER' | 'REQUEST_CHANGE'>(null)
  const [note, setNote] = useState('')
  const respond = useMutation({
    mutationFn: (action: 'ACCEPT_ORDER' | 'REJECT_ORDER' | 'REQUEST_CHANGE') =>
      api(`/public/track/${token}/respond`, { body: { action, revision: data.currentRevision, paymentMethod: payment, note } }),
    onSuccess: () => { setMode(null); void client.invalidateQueries({ queryKey: ['track', token] }) },
  })
  const final = data.final!
  const latest = data.revisions[0]
  return (
    <Card className="border-2 border-forest p-5">
      <h2 className="text-2xl">Please check your final order</h2>
      <p className="mt-1 text-sm text-ink-soft">We have checked availability and today&rsquo;s prices. We will buy your fruit only after you accept.</p>
      {latest?.reason && <Notice className="mt-3" title="What changed">{latest.reason}</Notice>}
      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between"><dt>Fruit</dt><dd>{formatINR(final.subtotalPaise)}</dd></div>
        <div className="flex justify-between"><dt>Delivery</dt><dd>{final.deliveryPaise === 0 ? 'Free' : formatINR(final.deliveryPaise)}</dd></div>
        {final.otherChargesPaise > 0 && <div className="flex justify-between"><dt>Other charges</dt><dd>{formatINR(final.otherChargesPaise)}</dd></div>}
        {final.discountPaise > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>-{formatINR(final.discountPaise)}</dd></div>}
        <div className="flex justify-between border-t border-line pt-2 font-display text-xl font-bold"><dt>Final total</dt><dd>{formatINR(final.totalPaise)}</dd></div>
      </dl>
      <fieldset className="mt-4">
        <legend className="mb-1 text-sm font-semibold">How will you pay?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {([['COD', 'Cash on delivery'], ['UPI', 'UPI']] as const).map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center gap-2 rounded-md border border-line p-3 has-[:checked]:border-forest has-[:checked]:bg-leaf-soft">
              <input type="radio" name="pay" className="accent-forest" checked={payment === value} onChange={() => setPayment(value)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {respond.error && <Notice tone="bad" className="mt-3">{errorMessage(respond.error)}</Notice>}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Button size="lg" loading={respond.isPending && respond.variables === 'ACCEPT_ORDER'} onClick={() => respond.mutate('ACCEPT_ORDER')}>Accept order</Button>
        <Button size="lg" variant="secondary" onClick={() => setMode('REQUEST_CHANGE')}>Ask for a change</Button>
        <Button size="lg" variant="dangerOutline" onClick={() => setMode('REJECT_ORDER')}>Decline</Button>
      </div>
      <Dialog open={mode !== null} onClose={() => setMode(null)} title={mode === 'REJECT_ORDER' ? 'Decline this order' : 'What would you like changed?'}>
        <Textarea label={mode === 'REJECT_ORDER' ? 'Reason' : 'Your request'} optional={mode === 'REJECT_ORDER'} value={note} onChange={(event) => setNote(event.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setMode(null)}>Back</Button>
          <Button variant={mode === 'REJECT_ORDER' ? 'danger' : 'primary'} loading={respond.isPending} disabled={mode === 'REQUEST_CHANGE' && !note.trim()} onClick={() => mode && respond.mutate(mode)}>
            {mode === 'REJECT_ORDER' ? 'Decline order' : 'Send request'}
          </Button>
        </div>
      </Dialog>
    </Card>
  )
}

function UpiPayment({ data, token }: { data: Tracking; token: string }) {
  const client = useQueryClient()
  const upi = data.upi!
  const total = data.final?.totalPaise ?? 0
  const [txnRef, setTxnRef] = useState('')
  const [amount, setAmount] = useState(String(total / 100))
  const pending = data.payments.find((payment) => payment.status === 'PENDING')
  const report = useMutation({
    mutationFn: () => api(`/public/track/${token}/payment`, { body: { txnRef: txnRef.trim(), amountPaise: parseRupees(amount) } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['track', token] }),
  })
  const deepLink = upi.id ? `upi://pay?pa=${encodeURIComponent(upi.id)}&pn=${encodeURIComponent(upi.displayName || 'Fruit order')}&am=${(total / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(data.orderNumber)}` : null
  return (
    <Card className="p-5">
      <h2 className="text-2xl">Pay {formatINR(total)} by UPI</h2>
      {!upi.id ? (
        <Notice className="mt-3">We will message you our UPI details shortly. You can also choose cash on delivery by telling us.</Notice>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-[auto_1fr]">
          {upi.qrKey && <img src={mediaUrl(upi.qrKey)!} alt={`UPI QR code for ${upi.displayName}`} className="size-40 rounded-md border border-line" />}
          <div className="space-y-1 text-sm">
            {upi.displayName && <p>Pay to: <strong>{upi.displayName}</strong></p>}
            <p>UPI ID: <strong className="select-all">{upi.id}</strong></p>
            <p>Add the order number <strong>{data.orderNumber}</strong> in the note.</p>
            {upi.instructions && <p className="text-ink-soft">{upi.instructions}</p>}
            {deepLink && <a href={deepLink} className="mt-2 inline-flex h-11 items-center rounded-md bg-forest px-5 font-semibold text-paper md:hidden">Open UPI app</a>}
          </div>
        </div>
      )}
      <div className="mt-5 border-t border-line pt-4">
        {pending ? (
          <Notice tone="info">You told us you paid {formatINR(pending.amount_paise)} (reference {pending.txn_ref}). We will confirm it against our bank or UPI account before we go ahead.</Notice>
        ) : (
          <>
            <p className="mb-2 text-sm font-semibold">Already paid? Tell us the transaction reference.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="UPI transaction reference" value={txnRef} onChange={(event) => setTxnRef(event.target.value)} />
              <Input label="Amount paid (₹)" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </div>
            {report.error && <Notice tone="bad" className="mt-3">{errorMessage(report.error)}</Notice>}
            <Button className="mt-3" loading={report.isPending} disabled={!txnRef.trim() || !parseRupees(amount)} onClick={() => report.mutate()}>I have paid</Button>
            <p className="mt-2 text-xs text-ink-soft">We check every payment against our actual bank or UPI record. A screenshot is not accepted as proof.</p>
          </>
        )}
      </div>
    </Card>
  )
}

export default function OrderPage() {
  const { token = '' } = useParams()
  const [params] = useSearchParams()
  const client = useQueryClient()
  const config = useConfig().data
  usePageTitle(`Your order | ${config?.brandName ?? ''}`)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const query = useQuery({
    queryKey: ['track', token],
    queryFn: () => api<Tracking>(`/public/track/${token}`),
    refetchInterval: 20_000,
    retry: (count, error) => !(error instanceof ApiRequestError && error.status === 404) && count < 2,
  })
  const cancel = useMutation({
    mutationFn: () => api(`/public/track/${token}/cancel`, { method: 'POST' }),
    onSuccess: () => { setConfirmCancel(false); void client.invalidateQueries({ queryKey: ['track', token] }) },
  })

  if (query.isPending) return <Spinner label="Finding your order" />
  if (query.isError) {
    const missing = query.error instanceof ApiRequestError && query.error.status === 404
    return <div className="mx-auto max-w-2xl px-4 py-10">{missing ? <EmptyState title="We could not find that order">Check the link, or use Track order and enter your order number and phone number.</EmptyState> : <QueryError error={query.error} retry={() => void query.refetch()} />}</div>
  }
  const data = query.data
  const enquiry = data.orderType === 'ENQUIRY'
  const message = `Hello, this is about order ${data.orderNumber}.`

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ink-soft">{enquiry ? 'Enquiry' : 'Order'}</p>
          <h1 className="text-3xl">{data.orderNumber}</h1>
          <p className="text-sm text-ink-soft">Placed {formatDateTime(data.createdAt)}</p>
        </div>
        <Badge tone={data.status === 'DELIVERED' ? 'good' : ENDED.includes(data.status) ? 'bad' : 'info'} className="text-sm">{data.statusLabel}</Badge>
      </div>

      {params.get('placed') && <Notice tone="good" title={enquiry ? 'Your enquiry has been sent' : 'Order request received'}>{enquiry ? 'Online ordering is not open yet, so this is a non-binding enquiry. We will reply to you directly.' : ORDER_RECEIVED_MESSAGE}<p className="mt-1">Save this page&rsquo;s link to check your order any time.</p></Notice>}

      <Card className="p-5"><Stepper status={data.status} />{ENDED.includes(data.status) && <p className="text-sm text-ink-soft">This order is {data.statusLabel.toLowerCase()}.</p>}</Card>

      {data.status === 'AWAITING_CUSTOMER_APPROVAL' && data.final && <Approval data={data} token={token} />}
      {data.status === 'CONFIRMED' && data.paymentMethod === 'UPI' && data.upi && data.paymentStatus !== 'PAID' && <UpiPayment data={data} token={token} />}
      {data.status === 'CONFIRMED' && data.paymentMethod === 'COD' && <Notice tone="good" title="Order confirmed">Pay in cash when your fruit arrives. We are now buying it for you.</Notice>}

      {data.delivery && (
        <Card className="space-y-2 p-5">
          <h2 className="flex items-center gap-2 text-xl"><Truck className="size-5" aria-hidden /> Delivery</h2>
          {data.delivery.provider && <p className="text-sm">Booked with {data.delivery.provider}.</p>}
          {data.delivery.trackingUrl && <a className="text-sm font-semibold text-forest underline" href={data.delivery.trackingUrl} target="_blank" rel="noopener noreferrer">Track your delivery</a>}
          {data.delivery.otp && <Notice tone="info" title={`Delivery code: ${data.delivery.otp}`}>Tell this code to the rider when you receive your fruit.</Notice>}
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-2 text-xl">Items</h2>
        <Lines data={data} />
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          {data.final ? (
            <div className="flex justify-between font-display text-lg font-bold"><dt>Final total</dt><dd>{formatINR(data.final.totalPaise)}</dd></div>
          ) : (
            <>
              <div className="flex justify-between"><dt>Estimated total</dt><dd className="font-semibold">{formatINR(data.estimate.totalPaise)}</dd></div>
              <p className="text-xs text-ink-soft">Estimated. We will send the final total for your approval.</p>
            </>
          )}
          <div className="flex justify-between gap-4"><dt>Payment</dt><dd className="text-right">{data.paymentMethod === 'COD' ? 'Cash on delivery' : data.paymentMethod === 'UPI' ? 'UPI' : data.paymentPreference === 'UPI' ? 'UPI (to be confirmed)' : 'Cash on delivery (to be confirmed)'} · {data.paymentStatus.replace('_', ' ').toLowerCase()}</dd></div>
        </dl>
      </Card>

      <Card className="p-5 text-sm">
        <h2 className="mb-2 text-xl">Delivering to</h2>
        <p>{data.address.line}</p>
        <p>{data.address.locality} {data.address.pinCode}</p>
        {data.address.landmark && <p className="text-ink-soft">Near {data.address.landmark}</p>}
        <p className="mt-1 text-ink-soft">Slot: {data.slotLabel}</p>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-xl">Progress</h2>
        <ol className="space-y-1 text-sm">{[...data.history].reverse().map((entry, index) => <li key={index} className="flex justify-between gap-3"><span>{entry.label}</span><span className="text-ink-soft">{formatDateTime(entry.at)}</span></li>)}</ol>
      </Card>

      <div className="flex flex-wrap gap-3">
        {config?.whatsapp && <a className="inline-flex h-11 items-center gap-2 rounded-md border border-forest px-4 font-semibold text-forest hover:bg-leaf-soft" href={whatsappHref(config.whatsapp, message)} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-4" aria-hidden /> Message us about this order</a>}
        {data.canCancel && <Button variant="dangerOutline" onClick={() => setConfirmCancel(true)}>Cancel order</Button>}
      </div>
      <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancel this order?">
        <p className="text-sm text-ink-soft">We have not bought your fruit yet, so you can cancel now without any charge.</p>
        {cancel.error && <Notice tone="bad" className="mt-3">{errorMessage(cancel.error)}</Notice>}
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep order</Button><Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel order</Button></div>
      </Dialog>
    </div>
  )
}
