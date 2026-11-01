import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { TICKET_TYPE_LABELS, TICKET_TYPES } from '../../../shared/constants'
import { PageLoading } from '../../components/loading'
import { WhatsAppButton } from '../../components/storefront'
import { Badge, Button, Card, EmptyState, Input, LinkButton, Notice, Select, Textarea, buttonClass } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useMyOrders } from '../../lib/cart'
import { useConfig, usePageTitle, useZones } from '../../lib/data'
import { formatINR } from '../../lib/format'

export function Policy({ slug, title }: { slug: string; title: string }) {
  const brand = useConfig().data?.brandName ?? ''
  usePageTitle(`${title} | ${brand}`)
  const page = useQuery({ queryKey: ['page', slug], queryFn: () => api<{ content: string }>(`/public/pages/${slug}`), staleTime: 300_000 })
  if (page.isPending) return <PageLoading />
  const blocks = (page.data?.content ?? '').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-4xl">{title}</h1>
      <div className="prose-policy mt-6">
        {blocks.length === 0 ? (
          <Notice tone="info">This page has not been published yet. If you have a question, please <Link className="underline" to="/contact">contact us</Link>.</Notice>
        ) : (
          blocks.map((block, index) => (block.startsWith('# ') ? <h2 key={index}>{block.slice(2)}</h2> : <p key={index} className="whitespace-pre-line">{block}</p>))
        )}
      </div>
    </div>
  )
}

export function BusinessDetails() {
  const config = useConfig().data
  usePageTitle(`Seller and business details | ${config?.brandName ?? ''}`)
  const rows: Array<[string, string]> = config
    ? ([
        ['Brand', config.brandName],
        ['Legal seller', config.legalSellerName],
        ['Business address', config.address],
        ['Phone', config.phone],
        ['Email', config.email],
        ['Operating hours', config.hours],
        ['FSSAI licence number', config.fssaiNumber],
        ['FSSAI licence category', config.fssaiCategory],
        ['FSSAI valid until', config.fssaiValidUntil],
        ['GSTIN', config.gstin],
      ] as Array<[string, string]>).filter(([, value]) => value)
    : []
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-4xl">Seller and business details</h1>
      {!config?.legalSellerName && <Notice className="mt-4">We will publish our registered seller and licence details here once they are confirmed.</Notice>}
      <dl className="mt-6 divide-y divide-line rounded-lg border border-line">
        {rows.map(([label, value]) => <div key={label} className="grid gap-1 p-4 sm:grid-cols-[12rem_1fr]"><dt className="text-sm text-ink-soft">{label}</dt><dd className="font-medium">{value}</dd></div>)}
      </dl>
    </div>
  )
}

export function Areas() {
  const { slug } = useParams()
  const config = useConfig().data
  const zones = useZones()
  usePageTitle(`Delivery areas | ${config?.brandName ?? ''}`)
  if (zones.isPending) return <PageLoading />
  const list = zones.data?.zones ?? []
  const single = slug ? list.find((zone) => zone.slug === slug && zone.hasLandingPage) : null
  if (slug && !single) return <div className="mx-auto max-w-3xl px-4 py-10"><EmptyState title="We do not have a page for that area" action={<LinkButton to="/areas">See delivery areas</LinkButton>} /></div>
  const shown = single ? [single] : list
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-4xl">{single ? `Fresh fruit delivery in ${single.name}` : 'Delivery areas'}</h1>
      {single?.landingDescription && <p className="mt-3 max-w-2xl text-ink-soft">{single.landingDescription}</p>}
      {shown.length === 0 ? (
        <div className="mt-6"><EmptyState title="Delivery areas are being set up">We will list each area here once we are ready to deliver there. Message us to ask whether we can reach you.</EmptyState></div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {shown.map((zone) => (
            <li key={zone.id}>
              <Card className="h-full p-5">
                <h2 className="text-xl">{zone.hasLandingPage && !single ? <Link className="hover:underline" to={`/areas/${zone.slug}`}>{zone.name}</Link> : zone.name}</h2>
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-ink-soft">PIN codes</dt><dd>{zone.pinCodes.join(', ')}</dd></div>
                  {zone.estimatedTime && <div className="flex justify-between gap-3"><dt className="text-ink-soft">Usual time</dt><dd>{zone.estimatedTime}</dd></div>}
                  <div className="flex justify-between gap-3"><dt className="text-ink-soft">Delivery</dt><dd>{zone.quoteOnly ? 'Confirmed when we check your order' : zone.deliveryChargePaise === 0 ? 'Free' : formatINR(zone.deliveryChargePaise)}</dd></div>
                  {zone.freeAbovePaise !== null && !zone.quoteOnly && <div className="flex justify-between gap-3"><dt className="text-ink-soft">Free above</dt><dd>{formatINR(zone.freeAbovePaise)}</dd></div>}
                  {zone.minOrderPaise > 0 && <div className="flex justify-between gap-3"><dt className="text-ink-soft">Minimum order</dt><dd>{formatINR(zone.minOrderPaise)}</dd></div>}
                  {zone.slots.length > 0 && <div className="flex justify-between gap-3"><dt className="text-ink-soft">Slots</dt><dd className="text-right">{zone.slots.map((slot) => slot.label).join(', ')}</dd></div>}
                </dl>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <LinkButton to="/shop" className="mt-8">Shop fruit</LinkButton>
    </div>
  )
}

export function Contact() {
  const config = useConfig().data
  usePageTitle(`Contact and support | ${config?.brandName ?? ''}`)
  const [form, setForm] = useState({ type: 'ORDER_ENQUIRY', name: '', phone: '', orderNumber: '', message: '' })
  const send = useMutation({ mutationFn: () => api('/public/tickets', { body: form }) })
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value })
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-2">
      <div>
        <h1 className="text-4xl">Contact and support</h1>
        <p className="mt-2 text-ink-soft">Questions about an order, a delivery problem, a damaged or missing item, or a refund? Tell us and a person will reply.</p>
        <ul className="mt-5 space-y-2 text-sm">
          {config?.phone && <li>Phone: <a className="font-semibold underline" href={`tel:${config.phone}`}>{config.phone}</a></li>}
          {config?.email && <li>Email: <a className="font-semibold underline" href={`mailto:${config.email}`}>{config.email}</a></li>}
          {config?.hours && <li>Hours: {config.hours}</li>}
          {config?.address && <li>{config.address}</li>}
        </ul>
        <WhatsAppButton message="Hello, I need help with my order." className={`${buttonClass({ variant: 'secondary' })} mt-5`} />
        <p className="mt-6 text-sm text-ink-soft">Refunds and replacements follow our <Link className="underline" to="/policies/refund">refund and replacement policy</Link>.</p>
      </div>
      <Card className="p-5">
        {send.isSuccess ? (
          <Notice tone="good" title="Thank you, we have your message">Our team will get back to you on the number you gave.</Notice>
        ) : (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); send.mutate() }}>
            <Select label="What is this about?" value={form.type} onChange={set('type')}>{TICKET_TYPES.map((type) => <option key={type} value={type}>{TICKET_TYPE_LABELS[type]}</option>)}</Select>
            <Input label="Your name" required value={form.name} onChange={set('name')} />
            <Input label="Mobile number" type="tel" inputMode="numeric" required value={form.phone} onChange={set('phone')} />
            <Input label="Order number" optional value={form.orderNumber} onChange={set('orderNumber')} />
            <Textarea label="Message" required value={form.message} onChange={set('message')} />
            {send.error && <Notice tone="bad">{errorMessage(send.error)}</Notice>}
            <Button type="submit" full loading={send.isPending}>Send message</Button>
          </form>
        )}
      </Card>
    </div>
  )
}

export function TrackLookup() {
  usePageTitle('Track your order')
  const navigate = useNavigate()
  const mine = useMyOrders()
  const [orderNumber, setOrderNumber] = useState('')
  const [phone, setPhone] = useState('')
  const lookup = useMutation({
    mutationFn: () => api<{ trackingToken: string }>('/public/orders/lookup', { body: { orderNumber, phone } }),
    onSuccess: (result) => navigate(`/order/${result.trackingToken}`),
  })
  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-4xl">Track your order</h1>
      {mine.tokens.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-lg">Your recent orders</h2>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {mine.tokens.map((order) => <li key={order.token}><Link className="flex items-center justify-between p-3 hover:bg-mist" to={`/order/${order.token}`}><span className="font-semibold">{order.orderNumber}</span><Badge>View</Badge></Link></li>)}
          </ul>
        </section>
      )}
      <Card className="mt-6 p-5">
        <h2 className="text-xl">Find an order</h2>
        <p className="mb-3 text-sm text-ink-soft">Enter your order number and the mobile number you used.</p>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); lookup.mutate() }}>
          <Input label="Order number" value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} required />
          <Input label="Mobile number" type="tel" inputMode="numeric" value={phone} onChange={(event) => setPhone(event.target.value)} required />
          {lookup.error && <Notice tone="bad">{errorMessage(lookup.error)}</Notice>}
          <Button type="submit" full loading={lookup.isPending}>Find my order</Button>
        </form>
      </Card>
    </div>
  )
}

export function NotFound() {
  usePageTitle('Page not found')
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <EmptyState title="We could not find that page" action={<LinkButton to="/shop">Shop fruit</LinkButton>}>The link may be old or mistyped.</EmptyState>
    </div>
  )
}
