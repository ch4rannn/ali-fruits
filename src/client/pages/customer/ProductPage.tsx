import { Link, useParams } from 'react-router-dom'
import { AVAILABILITY_NOTICE } from '../../../shared/brand'
import { AddToCart, ProductCard, ProductImage, availabilityBadge } from '../../components/product'
import { PageLoading } from '../../components/loading'
import { EmptyState, Notice, QueryError } from '../../components/ui'
import { mediaUrl } from '../../lib/api'
import { useCatalog, useConfig, usePageTitle } from '../../lib/data'

export default function ProductPage() {
  const { slug } = useParams()
  const catalog = useCatalog()
  const brand = useConfig().data?.brandName ?? ''
  const product = catalog.data?.products.find((item) => item.slug === slug)
  usePageTitle(product ? `${product.name} | ${brand}` : '')

  if (catalog.isPending) return <PageLoading />
  if (catalog.isError) return <div className="mx-auto max-w-5xl p-4"><QueryError error={catalog.error} retry={() => void catalog.refetch()} /></div>
  if (!product) return <div className="mx-auto max-w-5xl p-4"><EmptyState title="We could not find that fruit" action={<Link className="font-semibold text-forest underline" to="/shop">See all fruit</Link>} /></div>

  const category = catalog.data.categories.find((item) => item.id === product.categoryId)
  const related = catalog.data.products.filter((item) => item.categoryId === product.categoryId && item.id !== product.id).slice(0, 4)

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-soft">
        <Link className="hover:underline" to="/shop">Shop</Link>
        {category && <> / <Link className="hover:underline" to={`/category/${category.slug}`}>{category.name}</Link></>}
      </nav>
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <div className="aspect-[4/3] overflow-hidden rounded-lg border border-line bg-mist"><ProductImage product={product} /></div>
          {product.images.length > 1 && (
            <ul className="mt-2 grid grid-cols-4 gap-2">
              {product.images.slice(1, 5).map((image) => (
                <li key={image.key} className="aspect-square overflow-hidden rounded-md border border-line"><img src={mediaUrl(image.key)!} alt={image.alt || product.name} loading="lazy" className="size-full object-cover" /></li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h1 className="text-4xl">{product.name}</h1>
          <div className="mt-2 flex gap-2">{availabilityBadge(product)}</div>
          {product.description && <p className="mt-4 text-ink-soft">{product.description}</p>}
          <div className="mt-6 max-w-xs"><AddToCart product={product} /></div>
          <Notice className="mt-6">{AVAILABILITY_NOTICE}</Notice>
        </div>
      </div>
      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-2xl">More from {category?.name ?? 'this category'}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{related.map((item) => <ProductCard key={item.id} product={item} />)}</div>
        </section>
      )}
    </div>
  )
}
