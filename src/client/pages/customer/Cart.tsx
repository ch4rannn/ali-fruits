import { useQuery } from '@tanstack/react-query'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AVAILABILITY_NOTICE } from '../../../shared/brand'
import { useChosenZoneDetails, ZonePicker } from '../../components/storefront'
import { Button, EmptyState, LinkButton, Notice, Select, Spinner } from '../../components/ui'
import { api } from '../../lib/api'
import { acceptPrices, changeVariant, dropLines, removeLine, setQty, useCart } from '../../lib/cart'
import { useCatalog, useConfig, usePageTitle } from '../../lib/data'
import { formatINR } from '../../lib/format'

export type Quote = {
  lines: Array<{ variantId: string; productName: string; variantLabel: string; qty: number; unitPaise: number; lineTotalPaise: number; priceChanged: boolean; issue: string | null }>
  subtotalPaise: number
  deliveryPaise: number
  deliveryToBeQuoted: boolean
  totalPaise: number
  minimumOrderPaise: number
  belowMinimum: boolean
  hasIssues: boolean
  hasPriceChanges: boolean
}

export function useQuote() {
  const cart = useCart()
  const { zone } = useChosenZoneDetails()
  const payload = { items: cart.lines.map((line) => ({ variantId: line.variantId, qty: line.qty, expectedUnitPaise: line.unitPaise })), zoneId: zone?.id }
  return useQuery({
    queryKey: ['quote', payload],
    queryFn: () => api<Quote>('/public/quote', { body: payload }),
    enabled: cart.lines.length > 0,
    placeholderData: (previous) => previous,
  })
}

export default function CartPage() {
  usePageTitle(`Your cart | ${useConfig().data?.brandName ?? ''}`)
  const cart = useCart()
  const catalog = useCatalog().data
  const { zone } = useChosenZoneDetails()
  const quote = useQuote()
  const q = quote.data

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <EmptyState title="Your cart is empty" action={<LinkButton to="/shop">Browse fruit</LinkButton>}>Add some fruit and we will check it for you.</EmptyState>
      </div>
    )
  }

  const issueByVariant = new Map(q?.lines.filter((line) => line.issue).map((line) => [line.variantId, line.issue!]))
  const changed = q?.lines.filter((line) => line.priceChanged) ?? []

  const switchUnit = (variantId: string, productId: string, nextId: string) => {
    const product = catalog?.products.find((item) => item.id === productId)
    const variant = product?.variants.find((item) => item.id === nextId)
    const line = cart.lines.find((item) => item.variantId === variantId)
    if (!product || !variant || !line) return
    changeVariant(variantId, { ...line, variantId: variant.id, variantLabel: variant.label, unitPaise: variant.pricePaise, minQty: variant.minQty, qtyStep: variant.qtyStep })
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-6 md:grid-cols-[1fr_20rem]">
      <div>
        <h1 className="text-4xl">Your cart</h1>
        <p className="mt-1 text-sm text-ink-soft">{AVAILABILITY_NOTICE}</p>

        {changed.length > 0 && (
          <Notice tone="warn" title="Some prices have changed" className="mt-4">
            <ul className="mt-1 list-disc pl-5">
              {changed.map((line) => <li key={line.variantId}>{line.productName} ({line.variantLabel}) is now {formatINR(line.unitPaise)}</li>)}
            </ul>
            <Button size="sm" className="mt-3" onClick={() => acceptPrices(Object.fromEntries(changed.map((line) => [line.variantId, line.unitPaise])))}>Accept new prices</Button>
          </Notice>
        )}

        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {cart.lines.map((line) => {
            const product = catalog?.products.find((item) => item.id === line.productId)
            const issue = issueByVariant.get(line.variantId)
            const priced = q?.lines.find((item) => item.variantId === line.variantId)
            return (
              <li key={line.variantId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Link to={`/products/${line.productSlug}`} className="font-display text-lg font-bold hover:underline">{line.productName}</Link>
                  {product && product.variants.length > 1 ? (
                    <Select label="Unit" className="mt-1 max-w-40 [&_label]:sr-only" value={line.variantId} onChange={(event) => switchUnit(line.variantId, line.productId, event.target.value)}>
                      {product.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.label}</option>)}
                    </Select>
                  ) : (
                    <p className="text-sm text-ink-soft">{line.variantLabel}</p>
                  )}
                  {issue && <p className="mt-1 text-sm font-medium text-berry" role="alert">{issue}</p>}
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex h-10 items-center rounded-md border border-line">
                    <button type="button" className="grid size-10 place-items-center" aria-label={`Fewer ${line.productName}`} disabled={line.qty <= line.minQty} onClick={() => setQty(line.variantId, line.qty - line.qtyStep)}><Minus className="size-4" /></button>
                    <span className="w-8 text-center font-semibold" aria-live="polite">{line.qty}</span>
                    <button type="button" className="grid size-10 place-items-center" aria-label={`More ${line.productName}`} onClick={() => setQty(line.variantId, line.qty + line.qtyStep)}><Plus className="size-4" /></button>
                  </div>
                  <p className="w-20 text-right font-display text-lg font-bold">{formatINR((priced?.unitPaise ?? line.unitPaise) * line.qty)}</p>
                  <button type="button" className="grid size-10 place-items-center rounded-md text-ink-soft hover:bg-berry-soft hover:text-berry" aria-label={`Remove ${line.productName}`} onClick={() => removeLine(line.variantId)}><Trash2 className="size-4" /></button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <aside className="h-fit rounded-lg border border-line bg-cream p-5 md:sticky md:top-20">
        <h2 className="text-2xl">Estimate</h2>
        {!q ? <Spinner /> : (
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt>Fruit</dt><dd>{formatINR(q.subtotalPaise)}</dd></div>
            <div className="flex justify-between"><dt>Delivery</dt><dd>{!zone ? 'Choose an area' : q.deliveryToBeQuoted ? 'We will confirm' : q.deliveryPaise === 0 ? 'Free' : formatINR(q.deliveryPaise)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 font-display text-lg font-bold"><dt>Estimated total</dt><dd>{formatINR(q.totalPaise)}</dd></div>
          </dl>
        )}
        <p className="mt-3 text-xs text-ink-soft">This is an estimate. We confirm availability and the day&rsquo;s price, then ask you to approve the final total before anything is bought.</p>
        <div className="mt-4"><ZonePicker className="w-full justify-center" /></div>
        {q?.belowMinimum && <p className="mt-3 text-sm font-medium text-berry">Minimum order for {zone?.name} is {formatINR(q.minimumOrderPaise)}.</p>}
        {q?.hasIssues && (
          <Button variant="dangerOutline" full className="mt-3" onClick={() => dropLines(q.lines.filter((line) => line.issue).map((line) => line.variantId))}>Remove unavailable items</Button>
        )}
        {q && !q.hasIssues && !q.belowMinimum && zone && !q.hasPriceChanges ? (
          <LinkButton to="/checkout" full size="lg" className="mt-3">Continue to checkout</LinkButton>
        ) : (
          <Button full size="lg" className="mt-3" disabled>{!zone ? 'Choose your area to continue' : 'Continue to checkout'}</Button>
        )}
      </aside>
    </div>
  )
}
