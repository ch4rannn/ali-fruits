import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ORDER_RECEIVED_MESSAGE } from '../../../shared/brand'
import { indianPhone, pinCode } from '../../../shared/schemas'
import { useChosenZoneDetails, ZonePicker } from '../../components/storefront'
import { Button, Checkbox, Input, Notice, Select, Spinner, Textarea } from '../../components/ui'
import { api, ApiRequestError, errorMessage } from '../../lib/api'
import { acceptPrices, clearCart, dropLines, rememberOrder, useCart } from '../../lib/cart'
import { useConfig, usePageTitle } from '../../lib/data'
import { formatINR } from '../../lib/format'
import { useQuote, type Quote } from './Cart'

const formSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(100),
  phone: indianPhone,
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]),
  pinCode,
  addressLine: z.string().trim().min(5, 'Enter your full delivery address').max(400),
  landmark: z.string().trim().max(200),
  instructions: z.string().trim().max(400),
  slotId: z.string().min(1, 'Choose a delivery slot'),
  paymentPreference: z.enum(['UPI', 'COD']),
  termsAccepted: z.literal(true, { error: 'Please accept the terms to continue' }),
})
type FormValues = z.input<typeof formSchema>

export default function Checkout() {
  const config = useConfig().data
  usePageTitle(`Checkout | ${config?.brandName ?? ''}`)
  const navigate = useNavigate()
  const cart = useCart()
  const { zone } = useChosenZoneDetails()
  const quote = useQuote()
  const q = quote.data
  const placed = useRef(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', phone: '', email: '', pinCode: '', addressLine: '', landmark: '', instructions: '', slotId: '', paymentPreference: 'COD', termsAccepted: undefined as unknown as true },
  })

  const submit = useMutation({
    mutationFn: (values: z.output<typeof formSchema>) =>
      api<{ orderNumber: string; trackingToken: string; orderType: string }>('/public/orders', {
        body: {
          ...values,
          idempotencyKey: cart.idempotencyKey,
          zoneId: zone!.id,
          items: cart.lines.map((line) => ({ variantId: line.variantId, qty: line.qty, expectedUnitPaise: line.unitPaise })),
          acceptedTotalPaise: q?.totalPaise,
        },
      }),
    onSuccess: (result) => {
      // Set first: emptying the cart re-renders this page, which must not then redirect to the empty cart.
      placed.current = true
      rememberOrder(result.trackingToken, result.orderNumber)
      navigate(`/order/${result.trackingToken}?placed=1`, { replace: true })
      clearCart()
    },
  })

  if (cart.lines.length === 0 && !placed.current) return <Navigate to="/cart" replace />
  if (!zone) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center">
        <h1 className="text-3xl">Where should we deliver?</h1>
        <p className="mt-2 text-ink-soft">We need your area to check delivery and show your slots.</p>
        <div className="mt-4 flex justify-center"><ZonePicker /></div>
      </div>
    )
  }

  const error = submit.error
  const apiQuote = error instanceof ApiRequestError ? (error.details as Quote | undefined) : undefined
  const live = config?.liveOrders ?? false

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => submit.mutate(formSchema.parse(values)))}
      className="mx-auto grid max-w-5xl gap-8 px-4 py-6 md:grid-cols-[1fr_20rem]"
    >
      <div className="space-y-5">
        <h1 className="text-4xl">{live ? 'Checkout' : 'Send your enquiry'}</h1>
        {!live && <Notice tone="warn" title="Online ordering is not open yet">This sends us a non-binding enquiry. Nothing is bought and no payment is taken. We will reply to you directly.</Notice>}

        <fieldset className="space-y-4">
          <legend className="mb-1 font-display text-xl font-bold">Your details</legend>
          <Input label="Full name" autoComplete="name" error={form.formState.errors.name?.message} {...form.register('name')} />
          <Input label="Mobile number" type="tel" inputMode="numeric" autoComplete="tel-national" hint="We call or message this number about your order." error={form.formState.errors.phone?.message} {...form.register('phone')} />
          <Input label="Email" type="email" autoComplete="email" optional error={form.formState.errors.email?.message} {...form.register('email')} />
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-1 font-display text-xl font-bold">Delivery</legend>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">Delivering to <ZonePicker /></div>
          <Input label="PIN code" inputMode="numeric" maxLength={6} autoComplete="postal-code" error={form.formState.errors.pinCode?.message} {...form.register('pinCode')} />
          <Textarea label="Complete delivery address" autoComplete="street-address" hint="Flat or room number, building or PG name, street." error={form.formState.errors.addressLine?.message} {...form.register('addressLine')} />
          <Input label="Landmark" optional error={form.formState.errors.landmark?.message} {...form.register('landmark')} />
          <Textarea label="Delivery instructions" optional error={form.formState.errors.instructions?.message} {...form.register('instructions')} />
          <Select label="Preferred delivery slot" error={form.formState.errors.slotId?.message} {...form.register('slotId')}>
            <option value="">Choose a slot</option>
            {zone.slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label}</option>)}
          </Select>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-display text-xl font-bold">How would you like to pay?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([['COD', 'Cash on delivery', 'Pay the rider when the fruit arrives.'], ['UPI', 'UPI', 'Pay after you approve the final total.']] as const).map(([value, title, text]) => (
              <label key={value} className="flex cursor-pointer gap-3 rounded-lg border border-line p-3 has-[:checked]:border-forest has-[:checked]:bg-leaf-soft">
                <input type="radio" value={value} className="mt-1 accent-forest" {...form.register('paymentPreference')} />
                <span><span className="block font-semibold">{title}</span><span className="text-sm text-ink-soft">{text}</span></span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-ink-soft">You do not pay anything now. You choose how to pay when you approve the final order.</p>
        </fieldset>

        <div className="space-y-2">
          <Checkbox label={<>I agree to the <Link className="underline" to="/policies/terms" target="_blank">terms and conditions</Link> and have read the <Link className="underline" to="/policies/privacy" target="_blank">privacy policy</Link>.</>} {...form.register('termsAccepted')} />
          {form.formState.errors.termsAccepted && <p className="text-sm font-medium text-berry" role="alert">{form.formState.errors.termsAccepted.message}</p>}
        </div>
      </div>

      <aside className="h-fit rounded-lg border border-line bg-cream p-5 md:sticky md:top-20">
        <h2 className="text-2xl">Your order</h2>
        {!q ? <Spinner /> : (
          <>
            <ul className="mt-3 space-y-1 text-sm">
              {q.lines.map((line) => (
                <li key={line.variantId} className="flex justify-between gap-2"><span>{line.productName} ({line.variantLabel}) × {line.qty}</span><span>{formatINR(line.lineTotalPaise)}</span></li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between"><dt>Delivery</dt><dd>{q.deliveryToBeQuoted ? 'We will confirm' : q.deliveryPaise === 0 ? 'Free' : formatINR(q.deliveryPaise)}</dd></div>
              <div className="flex justify-between font-display text-lg font-bold"><dt>Estimated total</dt><dd>{formatINR(q.totalPaise)}</dd></div>
            </dl>
          </>
        )}
        <p className="mt-3 text-xs text-ink-soft">Estimated. Availability and final prices are verified before your order is accepted.</p>

        {error && !apiQuote && <Notice tone="bad" className="mt-3">{errorMessage(error)}</Notice>}
        {error instanceof ApiRequestError && error.code === 'PRICE_CHANGED' && apiQuote && (
          <Notice tone="warn" title="Prices changed" className="mt-3">
            {error.message}
            <Button size="sm" className="mt-2" onClick={() => { acceptPrices(Object.fromEntries(apiQuote.lines.map((line) => [line.variantId, line.unitPaise]))); submit.reset() }}>Accept new prices</Button>
          </Notice>
        )}
        {error instanceof ApiRequestError && (error.code === 'CART_INVALID' || error.code === 'BELOW_MINIMUM') && apiQuote && (
          <Notice tone="bad" className="mt-3">
            {apiQuote.lines.filter((line) => line.issue).map((line) => <p key={line.variantId}>{line.issue}</p>)}
            {apiQuote.belowMinimum && <p>Minimum order is {formatINR(apiQuote.minimumOrderPaise)}.</p>}
            <Button size="sm" variant="dangerOutline" className="mt-2" onClick={() => { dropLines(apiQuote.lines.filter((line) => line.issue).map((line) => line.variantId)); submit.reset() }}>Remove unavailable items</Button>
          </Notice>
        )}

        <Button type="submit" size="lg" full className="mt-4" loading={submit.isPending} disabled={!q || q.hasIssues || q.belowMinimum}>
          {live ? 'Send order request' : 'Send enquiry'}
        </Button>
        <p className="mt-2 text-xs text-ink-soft">{ORDER_RECEIVED_MESSAGE}</p>
      </aside>
    </form>
  )
}
