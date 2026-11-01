import { Search } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AVAILABILITY_NOTICE } from '../../../shared/brand'
import { ProductCard } from '../../components/product'
import { PageLoading } from '../../components/loading'
import { EmptyState, Input, QueryError, Select, cx } from '../../components/ui'
import { canOrder, lowestPrice, useCatalog, useConfig, usePageTitle } from '../../lib/data'

export default function Shop() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const catalog = useCatalog()
  const brand = useConfig().data?.brandName ?? ''
  const category = catalog.data?.categories.find((item) => item.slug === slug)
  usePageTitle(slug && !category ? '' : category ? `Buy ${category.name.toLowerCase()} online | ${brand}` : `Shop fresh fruits online | ${brand}`)

  const query = params.get('q') ?? ''
  const sort = params.get('sort') ?? 'popular'
  const onlyAvailable = params.get('available') === '1'
  const onlySeasonal = params.get('seasonal') === '1'
  const onlyFeatured = params.get('featured') === '1'

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  if (catalog.isPending) return <PageLoading />
  if (catalog.isError) return <div className="mx-auto max-w-6xl p-4"><QueryError error={catalog.error} retry={() => void catalog.refetch()} /></div>

  const { categories, products } = catalog.data
  const filtered = products
    .filter((product) => !category || product.categoryId === category.id)
    .filter((product) => !query || product.name.toLowerCase().includes(query.toLowerCase()))
    .filter((product) => !onlyAvailable || canOrder(product))
    .filter((product) => !onlySeasonal || product.isSeasonal)
    .filter((product) => !onlyFeatured || product.isFeatured)
    .sort((a, b) => {
      if (sort === 'price-asc') return lowestPrice(a) - lowestPrice(b)
      if (sort === 'price-desc') return lowestPrice(b) - lowestPrice(a)
      if (sort === 'name') return a.name.localeCompare(b.name)
      return Number(canOrder(b)) - Number(canOrder(a)) || b.displayPriority - a.displayPriority || a.name.localeCompare(b.name)
    })

  if (slug && !category) return <div className="mx-auto max-w-6xl p-4"><EmptyState title="We could not find that category" action={<Link className="font-semibold text-forest underline" to="/shop">See all fruit</Link>} /></div>

  const chip = (active: boolean) => cx('inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium', active ? 'border-forest bg-forest text-paper' : 'border-line bg-paper hover:border-forest')

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-4xl">{category ? category.name : 'Shop fruit'}</h1>
      <p className="mt-1 text-sm text-ink-soft">{AVAILABILITY_NOTICE}</p>

      <nav aria-label="Categories" className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-2">
        <Link to="/shop" className={chip(!category)}>All</Link>
        {categories.filter((item) => products.some((product) => product.categoryId === item.id)).map((item) => (
          <Link key={item.id} to={`/category/${item.slug}`} className={cx(chip(item.id === category?.id), 'whitespace-nowrap')}>{item.name}</Link>
        ))}
      </nav>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="relative">
          <Search className="pointer-events-none absolute bottom-3 left-3 size-5 text-ink-soft" aria-hidden />
          <Input label="Search fruit" type="search" placeholder="Search by name" value={query} onChange={(event) => update('q', event.target.value || null)} className="[&_input]:pl-10" />
        </div>
        <Select label="Sort by" value={sort} onChange={(event) => update('sort', event.target.value === 'popular' ? null : event.target.value)}>
          <option value="popular">Popular</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="name">Name</option>
        </Select>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {([['available', 'Available now', onlyAvailable], ['seasonal', 'Seasonal', onlySeasonal], ['featured', 'Featured', onlyFeatured]] as const).map(([key, label, active]) => (
          <button key={key} type="button" aria-pressed={active} className={chip(active)} onClick={() => update(key, active ? null : '1')}>
            {label}
          </button>
        ))}
      </div>

      <p className="mt-5 text-sm text-ink-soft" aria-live="polite">{filtered.length} {filtered.length === 1 ? 'fruit' : 'fruits'}</p>
      {filtered.length === 0 ? (
        <div className="mt-3"><EmptyState title={products.length === 0 ? 'Our fruit list is being added' : 'No fruit matches that'}>{products.length === 0 ? 'Check back soon, or message us to ask what is fresh today.' : 'Try a different search or clear a filter.'}</EmptyState></div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      )}
    </div>
  )
}
