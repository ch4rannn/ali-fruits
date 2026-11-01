import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LogOut, MapPin, Navigation, Phone } from 'lucide-react'
import { useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { ChangePassword, SignIn, useLogout } from '../../components/auth'
import { InstallButton } from '../../components/install'
import { Badge, Button, Card, EmptyState, Input, Notice, QueryError, Spinner } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { formatDateTime, formatINR, parseRupees } from '../../lib/format'
import { useAppManifest } from '../../lib/pwa'
import { useMe } from '../admin/shared'

type Open = { id: string; status: string; batch_id: string | null; order_number: string; customer_name: string; customer_phone: string; address_line: string; locality: string; pin_code: string; landmark: string; instructions: string; slot_label: string }
type Recent = { id: string; status: string; updated_at: string; order_number: string; locality: string }

const STATUS_TEXT: Record<string, string> = { ASSIGNED: 'New: accept it', ACCEPTED: 'Accepted: go to pickup', PICKED_UP: 'Picked up', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', FAILED: 'Not delivered' }

function Frame({ title, back, children }: { title: string; back?: boolean; children: React.ReactNode }) {
  const logout = useLogout()
  return (
    <div className="min-h-dvh bg-cream">
      <header className="safe-top sticky top-0 z-10 bg-forest-deep text-paper">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-2 px-3">
          {back && <Link to="/rider" aria-label="Back to my deliveries" className="grid size-10 place-items-center rounded-md hover:bg-forest"><ArrowLeft className="size-5" /></Link>}
          <h1 className="font-display text-xl text-paper">{title}</h1>
          <button type="button" className="ml-auto grid size-10 place-items-center rounded-md hover:bg-forest" aria-label="Sign out" onClick={() => logout.mutate()}><LogOut className="size-5" /></button>
        </div>
      </header>
      <main className="mx-auto max-w-xl space-y-4 p-3 pb-16">
        <InstallButton />
        {children}
      </main>
    </div>
  )
}

function List() {
  const query = useQuery({ queryKey: ['rider', 'list'], queryFn: () => api<{ open: Open[]; recent: Recent[] }>('/rider/deliveries'), refetchInterval: 20_000 })
  if (query.isPending) return <Spinner />
  if (query.isError) return <QueryError error={query.error} retry={() => void query.refetch()} />
  const { open, recent } = query.data
  const fresh = open.filter((d) => d.status === 'ASSIGNED')
  const active = open.filter((d) => d.status !== 'ASSIGNED')
  const Row = ({ d }: { d: Open }) => (
    <li><Link to={`/rider/${d.id}`} className="block rounded-lg border border-line bg-paper p-4 active:bg-mist">
      <div className="flex items-start justify-between gap-2"><p className="font-display text-lg font-bold">{d.order_number}</p><Badge tone={d.status === 'ASSIGNED' ? 'warn' : 'info'}>{STATUS_TEXT[d.status]}</Badge></div>
      <p className="mt-1 text-sm">{d.customer_name}</p>
      <p className="text-sm text-ink-soft">{d.address_line}</p>
      <p className="text-sm text-ink-soft">{d.locality} · {d.slot_label}</p>
    </Link></li>
  )
  return (
    <>
      {open.length === 0 && <EmptyState title="No deliveries right now">New ones appear here when the shop assigns them to you.</EmptyState>}
      {fresh.length > 0 && <section><h2 className="mb-2 text-lg">New pickups ({fresh.length})</h2><ul className="space-y-2">{fresh.map((d) => <Row key={d.id} d={d} />)}</ul></section>}
      {active.length > 0 && <section><h2 className="mb-2 text-lg">Active ({active.length})</h2><ul className="space-y-2">{active.map((d) => <Row key={d.id} d={d} />)}</ul></section>}
      {recent.length > 0 && <section><h2 className="mb-2 text-lg">Done recently</h2><ul className="divide-y divide-line rounded-lg border border-line bg-paper">{recent.map((d) => <li key={d.id} className="flex items-center justify-between p-3 text-sm"><span>{d.order_number} · {d.locality}</span><span className="text-ink-soft">{d.status === 'DELIVERED' ? 'Delivered' : 'Not delivered'} · {formatDateTime(d.updated_at)}</span></li>)}</ul></section>}
    </>
  )
}

type Detail = {
  id: string; status: string; otpRequired: boolean; orderNumber: string; locality: string; pinCode: string; slotLabel: string
  customer: null | { name: string; phone: string; address: string; landmark: string; instructions: string }
  packageItems: Array<{ product_name: string; variant_label: string; confirmed_qty: number }>
  payment: { method: string | null; cashToCollectPaise: number }
}

function DeliveryScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['rider', id], queryFn: () => api<Detail>(`/rider/deliveries/${id}`), refetchInterval: 20_000 })
  const [otp, setOtp] = useState('')
  const [cash, setCash] = useState('')
  const [reason, setReason] = useState('')
  const [failing, setFailing] = useState(false)
  const act = useMutation({
    mutationFn: (step: { path: string; body?: unknown }) => api(`/rider/deliveries/${id}/${step.path}`, { method: 'POST', body: step.body }),
    onSuccess: (_, step) => {
      void client.invalidateQueries({ queryKey: ['rider'] })
      if (step.path === 'delivered' || step.path === 'failed' || step.path === 'decline') navigate('/rider', { replace: true })
    },
  })
  if (query.isPending) return <Spinner />
  if (query.isError) return <QueryError error={query.error} retry={() => void query.refetch()} />
  const d = query.data
  const c = d.customer
  const mapsUrl = c ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.address}, ${d.locality} ${d.pinCode}`)}` : null
  const needsCash = d.payment.method === 'COD'
  const cashPaise = parseRupees(cash)
  return (
    <>
      <Card className="p-4">
        <div className="flex items-start justify-between"><h2 className="text-2xl">{d.orderNumber}</h2><Badge tone="info">{STATUS_TEXT[d.status]}</Badge></div>
        <p className="text-sm text-ink-soft">Slot: {d.slotLabel}</p>
      </Card>
      {c ? (
        <Card className="space-y-3 p-4">
          <p className="text-lg font-semibold">{c.name}</p>
          <p className="flex gap-2"><MapPin className="mt-0.5 size-5 shrink-0 text-forest" />{c.address}, {d.locality} {d.pinCode}</p>
          {c.landmark && <p className="text-sm text-ink-soft">Landmark: {c.landmark}</p>}
          {c.instructions && <Notice tone="info">{c.instructions}</Notice>}
          <div className="grid grid-cols-2 gap-2">
            <a href={`tel:${c.phone}`} className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-md bg-forest font-semibold text-paper"><Phone className="size-5" /> Call</a>
            <a href={mapsUrl!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-md border border-forest font-semibold text-forest"><Navigation className="size-5" /> Navigate</a>
          </div>
        </Card>
      ) : <Notice>This delivery is finished.</Notice>}

      <Card className="p-4"><h3 className="mb-2 text-lg">Package</h3><ul className="space-y-1 text-sm">{d.packageItems.map((item, index) => <li key={index} className="flex justify-between"><span>{item.product_name} ({item.variant_label})</span><span>× {item.confirmed_qty}</span></li>)}</ul></Card>

      {needsCash ? <Notice tone="warn" title={`Collect ${formatINR(d.payment.cashToCollectPaise)} in cash`}>Count the cash before you hand over the fruit.</Notice> : d.payment.method === 'UPI' ? <Notice tone="good">Paid by UPI. Do not collect any money.</Notice> : null}

      {act.error && <Notice tone="bad">{errorMessage(act.error)}</Notice>}

      {c && d.status === 'ASSIGNED' && <div className="grid gap-2"><Button size="lg" loading={act.isPending} onClick={() => act.mutate({ path: 'accept' })}>Accept delivery</Button><Button size="lg" variant="dangerOutline" onClick={() => act.mutate({ path: 'decline' })}>I can't take this one</Button></div>}
      {c && d.status === 'ACCEPTED' && <Button size="lg" full loading={act.isPending} onClick={() => act.mutate({ path: 'pickup' })}>I have picked up the package</Button>}
      {c && d.status === 'PICKED_UP' && <Button size="lg" full loading={act.isPending} onClick={() => act.mutate({ path: 'out' })}>Start delivery</Button>}
      {c && d.status === 'OUT_FOR_DELIVERY' && (
        <Card className="space-y-3 p-4">
          <h3 className="text-lg">Hand over</h3>
          {d.otpRequired && <Input label="Delivery code from the customer" inputMode="numeric" maxLength={4} autoComplete="off" value={otp} onChange={(event) => setOtp(event.target.value)} />}
          {needsCash && <Input label="Cash collected (₹)" inputMode="decimal" value={cash} onChange={(event) => setCash(event.target.value)} error={cash && cashPaise === null ? 'Enter an amount like 415' : undefined} />}
          <Button size="lg" full loading={act.isPending} disabled={(d.otpRequired && otp.length !== 4) || (needsCash && cashPaise === null)} onClick={() => act.mutate({ path: 'delivered', body: { otp: d.otpRequired ? otp : undefined, codCollectedPaise: needsCash ? cashPaise : undefined } })}>Mark delivered</Button>
        </Card>
      )}
      {c && ['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(d.status) && (
        failing ? (
          <Card className="space-y-3 p-4"><Input label="What went wrong?" value={reason} onChange={(event) => setReason(event.target.value)} /><div className="grid grid-cols-2 gap-2"><Button variant="ghost" onClick={() => setFailing(false)}>Back</Button><Button variant="danger" disabled={!reason.trim()} loading={act.isPending} onClick={() => act.mutate({ path: 'failed', body: { reason: reason.trim() } })}>Report failed delivery</Button></div></Card>
        ) : <Button full variant="dangerOutline" onClick={() => setFailing(true)}>Report a failed delivery</Button>
      )}
    </>
  )
}

export default function RiderApp() {
  useAppManifest('rider')
  const me = useMe()
  if (me.isPending) return <Spinner />
  if (me.isError) return <SignIn title="Rider sign-in" />
  if (me.data.mustChangePassword) return <ChangePassword />
  if (me.data.role !== 'RIDER') {
    return <div className="grid min-h-dvh place-items-center p-6"><EmptyState title="This is the rider app" action={<Link className="font-semibold text-forest underline" to="/admin">Go to the staff dashboard</Link>}>Office staff sign in on the admin dashboard.</EmptyState></div>
  }
  return (
    <Routes>
      <Route index element={<Frame title={`Hello, ${me.data.name.split(' ')[0]}`}><List /></Frame>} />
      <Route path=":id" element={<Frame title="Delivery" back><DeliveryScreen /></Frame>} />
    </Routes>
  )
}
