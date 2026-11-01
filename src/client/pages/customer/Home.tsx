import { ArrowRight, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AVAILABILITY_NOTICE, BRAND_DEFAULTS } from '../../../shared/brand'
import { ProductCard } from '../../components/product'
import { WhatsAppButton } from '../../components/storefront'
import { Card, LinkButton, buttonClass, cx } from '../../components/ui'
import { mediaUrl } from '../../lib/api'
import { canOrder, useCatalog, useConfig, usePageTitle, useZones, type Product } from '../../lib/data'
import { formatINR, todayIst } from '../../lib/format'

function RateBoard({ products, loading }: { products: Product[]; loading: boolean }) {
  const rows = products.filter(canOrder).slice(0, 8)
  const date = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(`${todayIst()}T12:00:00+05:30`))
  return (
    <aside aria-label="Today's rates" className="rounded-lg border-2 border-forest bg-cream p-5 shadow-[6px_6px_0_0_var(--color-forest)]">
      <div className="flex items-baseline justify-between gap-3 border-b-2 border-forest pb-2">
        <h2 className="text-2xl">Today&rsquo;s rates</h2>
        <p className="text-sm text-ink-soft">{date}</p>
      </div>
      {loading ? (
        // Holds the board's full height, so the page does not jump when today's prices arrive.
        <ul className="mt-3 space-y-2" aria-label="Loading today's rates">
          {Array.from({ length: 8 }, (_, index) => <li key={index} className="h-[2rem] rounded-sm bg-mist/70" />)}
        </ul>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-ink-soft">Today&rsquo;s fruit list is being updated. Check back soon, or message us to ask what is fresh.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((product) => {
            const variant = [...product.variants].sort((a, b) => a.pricePaise - b.pricePaise)[0]!
            return (
              <li key={product.id}>
                <Link to={`/products/${product.slug}`} className="flex items-baseline gap-2 py-0.5 hover:text-forest">
                  <span className="font-semibold">{product.name}</span>
                  <span className="leader" aria-hidden />
                  <span className="font-display text-lg font-bold text-forest">{formatINR(variant.pricePaise)}</span>
                  <span className="w-14 text-right text-xs text-ink-soft">{variant.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-4 border-t border-line pt-3 text-xs text-ink-soft">{AVAILABILITY_NOTICE}</p>
    </aside>
  )
}

function Section({ title, link, children, tone }: { title: string; link?: { to: string; label: string }; children: React.ReactNode; tone?: 'cream' }) {
  return (
    <section className={cx('py-12', tone === 'cream' && 'bg-cream')}>
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="text-3xl">{title}</h2>
          {link && (
            <Link to={link.to} className="inline-flex items-center gap-1 text-sm font-semibold text-forest hover:underline">
              {link.label} <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
        {children}
      </div>
    </section>
  )
}

const STEPS = [
  ['Pick your fruit', 'Choose what you want and how much. Prices on the site are our current retail rates.'],
  ['We check at the market', 'We confirm availability and the day’s price at the Sabzi Mandi before accepting your order.'],
  ['You approve the final order', 'If anything changes, such as a price or a substitute, we send you the new total to accept or decline.'],
  ['We buy, weigh and pack', 'Only after you approve do we buy your fruit, weigh it honestly and pack it.'],
  ['Delivered to your door', 'Pay by UPI or cash on delivery.'],
]

const FAQS = [
  ['Is my order confirmed as soon as I place it?', 'No. We first check availability and the day’s price. You then get a final total to accept. We buy your fruit only after you accept.'],
  ['Why can the price change after I order?', 'Fruit prices at the mandi move daily. We always show you the updated total before anything is bought, and you can decline.'],
  ['What if a fruit is not available?', 'We tell you, and suggest a substitute where we can. You choose whether to accept it.'],
  ['How do I pay?', 'Pay by UPI after you approve the final order, or choose cash on delivery.'],
  ['Which areas do you deliver to?', 'See the delivery areas below. We only list areas we actually serve, and add new ones as we are able to reach them.'],
]

export default function Home() {
  const config = useConfig().data
  const catalog = useCatalog().data
  const zones = useZones().data?.zones ?? []
  const brand = config?.brandName || BRAND_DEFAULTS.brand_name
  usePageTitle(`${brand}: fresh fruit delivery in Kharar`)

  const products = catalog?.products ?? []
  const popular = products.filter((p) => p.isFeatured && canOrder(p)).slice(0, 8)
  const seasonal = products.filter((p) => p.isSeasonal && canOrder(p)).slice(0, 4)
  const combos = products.filter((p) => p.isCombo && canOrder(p)).slice(0, 4)
  const categories = (catalog?.categories ?? []).filter((c) => products.some((p) => p.categoryId === c.id))

  return (
    <>
      <section className="border-b border-line bg-paper">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 md:grid-cols-[1.1fr_0.9fr] md:py-16">
          <div>
            <h1 className="text-[2.6rem] leading-[1.02] text-forest sm:text-6xl">{BRAND_DEFAULTS.hero_heading}</h1>
            <p className="mt-5 max-w-lg text-lg text-ink-soft">{BRAND_DEFAULTS.hero_text}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <LinkButton to="/shop" size="lg">SHOP FRUITS</LinkButton>
              <WhatsAppButton message={`Hello ${brand}, I would like to order fruit.`} className={buttonClass({ variant: 'secondary', size: 'lg' })}>
                ORDER ON WHATSAPP
              </WhatsAppButton>
            </div>
            {config && !config.liveOrders && (
              <p className="mt-4 max-w-lg text-sm text-ink-soft">Online ordering is not open yet. You can browse and send a non-binding enquiry, and we will reply to you directly.</p>
            )}
          </div>
          <RateBoard products={products} loading={!catalog} />
        </div>
      </section>

      {config?.promoBannerKey && (
        <div className="mx-auto mt-6 max-w-6xl px-4">
          <img src={mediaUrl(config.promoBannerKey)!} alt={config.promoBannerAlt} loading="lazy" className="w-full rounded-lg border border-line object-cover" />
        </div>
      )}

      {categories.length > 0 && (
        <Section title="Shop by category" link={{ to: '/shop', label: 'All fruit' }}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {categories.map((category) => (
              <li key={category.id}>
                <Link to={`/category/${category.slug}`} className="flex h-full items-center gap-3 rounded-lg border border-line bg-paper p-3 hover:border-forest">
                  {category.imageKey ? (
                    <img src={mediaUrl(category.imageKey)!} alt="" loading="lazy" className="size-12 rounded-md object-cover" />
                  ) : (
                    <span className="grid size-12 shrink-0 place-items-center rounded-md bg-leaf-soft font-display text-xl font-bold text-forest" aria-hidden>
                      {category.name.charAt(0)}
                    </span>
                  )}
                  <span className="font-semibold leading-tight">{category.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {popular.length > 0 && (
        <Section title="Popular fruits" tone="cream" link={{ to: '/shop?featured=1', label: 'See all' }}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{popular.map((product) => <ProductCard key={product.id} product={product} />)}</div>
        </Section>
      )}

      {seasonal.length > 0 && (
        <Section title="In season now" link={{ to: '/shop?seasonal=1', label: 'All seasonal fruit' }}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{seasonal.map((product) => <ProductCard key={product.id} product={product} />)}</div>
        </Section>
      )}

      {combos.length > 0 && (
        <Section title="Fruit combinations" tone="cream">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{combos.map((product) => <ProductCard key={product.id} product={product} />)}</div>
        </Section>
      )}

      <Section title="How ordering works">
        <ol className="grid gap-4 md:grid-cols-5">
          {STEPS.map(([title, text], index) => (
            <li key={title} className="rounded-lg border border-line bg-paper p-4">
              <span className="grid size-8 place-items-center rounded-full bg-forest font-display font-bold text-citrus">{index + 1}</span>
              <h3 className="mt-3 text-lg">{title}</h3>
              <p className="mt-1 text-sm text-ink-soft">{text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Why order from us" tone="cream">
        <ul className="grid gap-4 md:grid-cols-3">
          {[
            ['Selected fresh, after you order', 'We buy your fruit only once your order is confirmed, so nothing sits waiting for a customer.'],
            ['Fair, transparent prices', 'You see the retail rate before ordering, and the final total before anything is bought.'],
            ['Honest weights', 'Every order is weighed before packing.'],
            ['Local and reachable', 'We work from the Sabzi Mandi in Kharar, and a real person answers your messages.'],
            ['Made for students', 'Combinations and quantities that suit PGs, hostels and shared rooms.'],
            ['Home delivery', 'Choose a delivery slot at checkout in the areas we serve.'],
          ].map(([title, text]) => (
            <li key={title} className="flex gap-3">
              <Check className="mt-1 size-5 shrink-0 text-leaf" aria-hidden />
              <div>
                <h3 className="text-lg">{title}</h3>
                <p className="text-sm text-ink-soft">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Delivery locations" link={{ to: '/areas', label: 'Delivery details' }}>
        {zones.length === 0 ? (
          <Card className="p-5 text-sm text-ink-soft">We are setting up our first delivery areas. Message us to ask whether we can reach you.</Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {zones.map((zone) => (
              <li key={zone.id} className="rounded-lg border border-line bg-paper p-4">
                <p className="font-display text-lg font-bold">{zone.name}</p>
                <p className="text-sm text-ink-soft">{zone.estimatedTime || 'Slots chosen at checkout'}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {config && config.testimonials.length > 0 && (
        <Section title="What customers say" tone="cream">
          <ul className="grid gap-4 md:grid-cols-3">
            {config.testimonials.map((item, index) => (
              <li key={index} className="rounded-lg border border-line bg-paper p-5">
                <blockquote className="text-ink">&ldquo;{item.text}&rdquo;</blockquote>
                <p className="mt-3 text-sm font-semibold text-forest">{item.name}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Questions">
        <div className="max-w-3xl divide-y divide-line rounded-lg border border-line bg-paper">
          {FAQS.map(([question, answer]) => (
            <details key={question} className="group p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                {question}
                <span className="text-forest transition-transform group-open:rotate-45" aria-hidden>+</span>
              </summary>
              <p className="mt-2 text-ink-soft">{answer}</p>
            </details>
          ))}
        </div>
      </Section>
    </>
  )
}
