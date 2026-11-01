import { Minus, Plus, ShoppingBasket } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AVAILABILITY_LABELS } from '../../shared/constants'
import { addToCart, setQty, useCart } from '../lib/cart'
import { canOrder, type Product, type Variant } from '../lib/data'
import { formatINR } from '../lib/format'
import { mediaUrl } from '../lib/api'
import { Badge, Button, cx } from './ui'

const TINTS = ['bg-leaf-soft', 'bg-citrus-soft', 'bg-mist', 'bg-amber-soft']

/**
 * Shows the shop's own photograph when one has been uploaded. Until then the tile shows the fruit's
 * name in type, so no stock picture is ever passed off as the real fruit.
 */
export function ProductImage({ product, className }: { product: Product; className?: string }) {
  const image = product.images[0]
  if (image) {
    return <img src={mediaUrl(image.key)!} alt={image.alt || product.name} loading="lazy" decoding="async" width={480} height={360} className={cx('size-full object-cover', className)} />
  }
  const tint = TINTS[[...product.name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TINTS.length]
  return (
    <div className={cx('flex size-full items-center justify-center p-3 text-center', tint, className)} aria-hidden>
      <span className="font-display text-2xl font-bold leading-none text-forest/80 sm:text-3xl">{product.name}</span>
    </div>
  )
}

export function availabilityBadge(product: Product) {
  if (canOrder(product)) return null
  const label = AVAILABILITY_LABELS[product.availability]
  return <Badge tone="warn">{label}</Badge>
}

export function AddToCart({ product, compact }: { product: Product; compact?: boolean }) {
  const [variantId, setVariantId] = useState(product.variants[0]!.id)
  const variant: Variant = product.variants.find((item) => item.id === variantId) ?? product.variants[0]!
  const cart = useCart()
  const line = cart.lines.find((item) => item.variantId === variant.id)
  const orderable = canOrder(product)

  const add = () =>
    addToCart({
      variantId: variant.id,
      productId: product.id,
      productName: product.name,
      productSlug: product.slug,
      variantLabel: variant.label,
      unitPaise: variant.pricePaise,
      minQty: variant.minQty,
      qtyStep: variant.qtyStep,
      image: product.images[0]?.key ?? null,
      qty: variant.minQty,
    })

  return (
    <div className="space-y-2">
      {product.variants.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Unit for ${product.name}`}>
          {product.variants.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={item.id === variant.id}
              onClick={() => setVariantId(item.id)}
              className={cx('min-h-9 rounded-md border px-2.5 text-sm font-medium', item.id === variant.id ? 'border-forest bg-forest text-paper' : 'border-line bg-paper text-ink hover:border-forest')}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : (
        !compact && <p className="text-sm text-ink-soft">{variant.label}</p>
      )}
      <p className="font-display text-xl font-bold text-forest">{formatINR(variant.pricePaise)}</p>
      {!orderable ? (
        <Button variant="secondary" full disabled>
          Not available
        </Button>
      ) : line ? (
        <div className="flex h-11 items-center justify-between rounded-md border border-forest">
          <button type="button" className="grid size-11 place-items-center text-forest" aria-label={`Fewer ${product.name}`} onClick={() => setQty(variant.id, line.qty - variant.qtyStep)} disabled={line.qty <= variant.minQty}>
            <Minus className="size-4" />
          </button>
          <span className="font-semibold" aria-live="polite">
            {line.qty} in cart
          </span>
          <button type="button" className="grid size-11 place-items-center text-forest" aria-label={`More ${product.name}`} onClick={() => setQty(variant.id, line.qty + variant.qtyStep)}>
            <Plus className="size-4" />
          </button>
        </div>
      ) : (
        <Button full onClick={add}>
          <ShoppingBasket className="size-4" aria-hidden />
          Add to cart
        </Button>
      )}
    </div>
  )
}

export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-line bg-paper">
      <Link to={`/products/${product.slug}`} className="block aspect-[4/3] overflow-hidden bg-mist" aria-label={product.name}>
        <ProductImage product={product} />
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div>
          <h3 className="text-lg leading-tight">
            <Link to={`/products/${product.slug}`} className="hover:underline">
              {product.name}
            </Link>
          </h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {availabilityBadge(product)}
            {product.isSeasonal && canOrder(product) && <Badge tone="info">Seasonal</Badge>}
          </div>
        </div>
        <div className="mt-auto">
          <AddToCart product={product} compact />
        </div>
      </div>
    </article>
  )
}
