import { Hono } from 'hono'
import { AVAILABILITY_NOTICE, BRAND_DEFAULTS } from '../shared/brand'
import { paiseToRupees } from '../shared/money'
import { siteUrl, type AppContext, type AppEnv } from './lib/http'
import { goLiveState, loadSettings, PAGE_KEYS, type Settings } from './lib/settings'
import { loadActiveZones, loadCatalog } from './routes/public'

export const seoRoutes = new Hono<AppEnv>()

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** Stops a value from closing the surrounding script tag. */
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c')

type Page = {
  status?: number
  title: string
  description: string
  path: string
  noindex?: boolean
  image?: string
  structuredData?: unknown[]
  fallback?: string
}

const POLICY_PATHS: Record<string, { key: string; title: string; description: string }> = {
  '/about': { key: PAGE_KEYS.about!, title: 'About us', description: 'Who we are and how our local fruit delivery works.' },
  '/policies/privacy': { key: PAGE_KEYS.privacy!, title: 'Privacy policy', description: 'How we collect, use and protect your details.' },
  '/policies/terms': { key: PAGE_KEYS.terms!, title: 'Terms and conditions', description: 'The terms that apply when you order from us.' },
  '/policies/delivery': { key: PAGE_KEYS.delivery!, title: 'Delivery policy', description: 'Delivery areas, slots and charges.' },
  '/policies/cancellation': { key: PAGE_KEYS.cancellation!, title: 'Cancellation policy', description: 'When and how an order can be cancelled.' },
  '/policies/refund': { key: PAGE_KEYS.refund!, title: 'Refund and replacement policy', description: 'How refunds and replacements are handled.' },
}

const PRIVATE_PREFIXES = ['/cart', '/checkout', '/order', '/track', '/admin', '/rider']

function notFound(path: string, brand: string): Page {
  return { status: 404, title: `Page not found | ${brand}`, description: 'This page could not be found.', path, noindex: true, fallback: '<h1>Page not found</h1><p><a href="/shop">Shop fruits</a></p>' }
}

async function resolvePage(c: AppContext, path: string, settings: Settings): Promise<Page> {
  const brand = settings.brand_name || BRAND_DEFAULTS.brand_name
  const base = siteUrl(c)
  const db = c.env.DB

  if (PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return { title: brand, description: settings.brand_tagline ?? '', path, noindex: true }
  }

  if (path === '/') {
    const { sellerVerified } = goLiveState(c.env, settings)
    const catalog = await loadCatalog(db)
    const structuredData: unknown[] = [{ '@context': 'https://schema.org', '@type': 'WebSite', name: brand, url: `${base}/` }]
    // Only published when the seller's real details have been entered and confirmed.
    if (sellerVerified && settings.business_address && settings.legal_seller_name) {
      structuredData.push({
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: brand,
        legalName: settings.legal_seller_name,
        url: `${base}/`,
        address: settings.business_address,
        ...(settings.business_phone ? { telephone: settings.business_phone } : {}),
      })
    }
    const links = catalog.categories
      .filter((category) => catalog.products.some((product) => product.categoryId === category.id))
      .map((category) => `<li><a href="/category/${escapeHtml(category.slug)}">${escapeHtml(category.name)}</a></li>`)
      .join('')
    return {
      title: `${brand}: fresh fruit delivery in Kharar`,
      description: BRAND_DEFAULTS.hero_text,
      path,
      structuredData,
      fallback: `<h1>${escapeHtml(BRAND_DEFAULTS.hero_heading)}</h1><p>${escapeHtml(BRAND_DEFAULTS.hero_text)}</p><p><a href="/shop">Shop fruits</a></p><ul>${links}</ul>`,
    }
  }

  if (path === '/shop') {
    const catalog = await loadCatalog(db)
    const links = catalog.products.map((product) => `<li><a href="/products/${escapeHtml(product.slug)}">${escapeHtml(product.name)}</a></li>`).join('')
    return {
      title: `Shop fresh fruits online | ${brand}`,
      description: `Browse today's fruit and retail prices from ${brand}. ${AVAILABILITY_NOTICE}`,
      path,
      fallback: `<h1>Shop fruits</h1><p>${escapeHtml(AVAILABILITY_NOTICE)}</p><ul>${links}</ul>`,
    }
  }

  const category = path.match(/^\/category\/([a-z0-9-]+)$/)
  if (category) {
    const catalog = await loadCatalog(db)
    const match = catalog.categories.find((item) => item.slug === category[1])
    if (!match) return notFound(path, brand)
    const products = catalog.products.filter((product) => product.categoryId === match.id)
    return {
      title: `Buy ${match.name.toLowerCase()} online | ${brand}`,
      description: match.description || `Order ${match.name.toLowerCase()} online from ${brand}, with home delivery in areas we serve.`,
      path,
      noindex: products.length === 0, // An empty category page has nothing useful to rank.
      fallback: `<h1>${escapeHtml(match.name)}</h1><ul>${products.map((product) => `<li><a href="/products/${escapeHtml(product.slug)}">${escapeHtml(product.name)}</a></li>`).join('')}</ul>`,
    }
  }

  const productMatch = path.match(/^\/products\/([a-z0-9-]+)$/)
  if (productMatch) {
    const catalog = await loadCatalog(db)
    const product = catalog.products.find((item) => item.slug === productMatch[1])
    if (!product) return notFound(path, brand)
    const prices = product.variants.map((variant) => variant.pricePaise)
    const image = product.images[0] ? `${base}/media/${product.images[0].key}` : undefined
    const priced = product.variants.map((variant) => `${variant.label}: ₹${paiseToRupees(variant.pricePaise)}`).join(', ')
    return {
      title: `${product.name} | ${brand}`,
      description: (product.description || `Order ${product.name} from ${brand}. ${priced}. ${AVAILABILITY_NOTICE}`).slice(0, 155),
      path,
      image,
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.name,
          ...(product.description ? { description: product.description } : {}),
          ...(image ? { image } : {}),
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'INR',
            lowPrice: paiseToRupees(Math.min(...prices)),
            highPrice: paiseToRupees(Math.max(...prices)),
            offerCount: prices.length,
            availability: product.availability === 'AVAILABLE' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            url: `${base}${path}`,
          },
        },
      ],
      fallback: `<h1>${escapeHtml(product.name)}</h1><p>${escapeHtml(product.description)}</p><p>${escapeHtml(priced)}</p><p>${escapeHtml(AVAILABILITY_NOTICE)}</p>`,
    }
  }

  if (path === '/areas') {
    const zones = await loadActiveZones(db)
    return {
      title: `Delivery areas | ${brand}`,
      description: `Check the areas ${brand} currently delivers fresh fruit to.`,
      path,
      fallback: `<h1>Delivery areas</h1><ul>${zones.map((zone) => `<li>${escapeHtml(zone.name)}</li>`).join('')}</ul>`,
    }
  }

  const area = path.match(/^\/areas\/([a-z0-9-]+)$/)
  if (area) {
    const zones = await loadActiveZones(db)
    const zone = zones.find((item) => item.slug === area[1] && item.hasLandingPage)
    // Location pages exist only for active zones that the founders chose to publish.
    if (!zone) return notFound(path, brand)
    return {
      title: `Fresh fruit delivery in ${zone.name} | ${brand}`,
      description: (zone.landingDescription || `${brand} delivers fresh fruit to ${zone.name}. See delivery slots and charges, then order online.`).slice(0, 155),
      path,
      fallback: `<h1>Fresh fruit delivery in ${escapeHtml(zone.name)}</h1><p>${escapeHtml(zone.landingDescription)}</p><p><a href="/shop">Shop fruits</a></p>`,
    }
  }

  if (path === '/contact' || path === '/business-details') {
    const isContact = path === '/contact'
    return {
      title: `${isContact ? 'Contact and support' : 'Seller and business details'} | ${brand}`,
      description: isContact ? `Contact ${brand} about an order, a delivery problem or a refund request.` : `The legal seller and business details behind ${brand}.`,
      path,
      fallback: `<h1>${isContact ? 'Contact and support' : 'Seller and business details'}</h1>`,
    }
  }

  const policy = POLICY_PATHS[path]
  if (policy) {
    const content = settings[policy.key]?.trim() ?? ''
    const blocks = content
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => (block.startsWith('# ') ? `<h2>${escapeHtml(block.slice(2))}</h2>` : `<p>${escapeHtml(block)}</p>`))
    return {
      title: `${policy.title} | ${brand}`,
      description: policy.description,
      path,
      noindex: !content, // A policy that has not been written yet should not appear in search results.
      fallback: `<h1>${escapeHtml(policy.title)}</h1>${blocks.join('')}`,
    }
  }

  return notFound(path, brand)
}

/** Serves the app shell with this page's metadata and readable text already in the HTML. */
export async function renderPage(c: AppContext): Promise<Response> {
  const url = new URL(c.req.url)
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/'
  const settings = await loadSettings(c.env.DB)
  const page = await resolvePage(c, path, settings)
  const shell = await c.env.ASSETS.fetch(new Request(new URL('/', url)))
  const base = siteUrl(c)
  const indexable = !page.noindex && c.env.ENVIRONMENT !== 'staging'
  const canonical = `${base}${page.path}`
  const head = [
    `<meta name="description" content="${escapeHtml(page.description)}">`,
    `<meta name="robots" content="${indexable ? 'index,follow' : 'noindex,nofollow'}">`,
    page.noindex ? '' : `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(page.title)}">`,
    `<meta property="og:description" content="${escapeHtml(page.description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    `<meta property="og:site_name" content="${escapeHtml(settings.brand_name ?? '')}">`,
    page.image ? `<meta property="og:image" content="${escapeHtml(page.image)}">` : '',
    ...(page.structuredData ?? []).map((data) => `<script type="application/ld+json">${jsonLd(data)}</script>`),
  ].join('')

  const rewritten = new HTMLRewriter()
    .on('title', { element: (element) => void element.setInnerContent(page.title) })
    .on('head', { element: (element) => void element.append(head, { html: true }) })
    .on('div#root', { element: (element) => void (page.fallback ? element.setInnerContent(`<main class="ssr-fallback">${page.fallback}</main>`, { html: true }) : undefined) })
    .transform(shell)

  const headers = new Headers(rewritten.headers)
  headers.set('Content-Type', 'text/html; charset=utf-8')
  headers.set('Cache-Control', 'no-cache')
  headers.delete('ETag')
  if (c.env.ENVIRONMENT === 'staging') headers.set('X-Robots-Tag', 'noindex, nofollow')
  return new Response(rewritten.body, { status: page.status ?? 200, headers })
}

const APP_ICONS = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

/** App definitions are served from settings, so renaming the brand in /admin also renames the installed app. */
function appManifest(settings: Settings, kind: 'shop' | 'admin' | 'rider') {
  const brand = settings.brand_name || BRAND_DEFAULTS.brand_name
  const common = { lang: 'en-IN', display: 'standalone', background_color: '#fffdf7', theme_color: '#1e4d2b', icons: APP_ICONS }
  if (kind === 'admin') {
    return {
      ...common,
      name: `${brand} Admin`,
      short_name: 'Admin',
      description: 'Run orders, prices, buying and deliveries.',
      id: '/admin',
      start_url: '/admin',
      scope: '/admin',
      shortcuts: [
        { name: 'Orders', url: '/admin/orders' },
        { name: 'Daily prices', url: '/admin/pricing' },
      ],
    }
  }
  if (kind === 'rider') {
    return { ...common, name: `${brand} Rider`, short_name: 'Rider', description: 'Your assigned deliveries.', id: '/rider', start_url: '/rider', scope: '/rider', orientation: 'portrait', theme_color: '#153a20' }
  }
  return {
    ...common,
    name: brand,
    short_name: brand.slice(0, 12),
    description: settings.brand_tagline ?? '',
    id: '/',
    start_url: '/?source=app',
    scope: '/',
    orientation: 'portrait',
    categories: ['food', 'shopping'],
    shortcuts: [
      { name: 'Shop fruit', url: '/shop' },
      { name: 'My cart', url: '/cart' },
      { name: 'Track order', url: '/track' },
    ],
  }
}

for (const [path, kind] of [['/manifest.webmanifest', 'shop'], ['/admin.webmanifest', 'admin'], ['/rider.webmanifest', 'rider']] as const) {
  seoRoutes.get(path, async (c) => c.body(JSON.stringify(appManifest(await loadSettings(c.env.DB), kind)), 200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' }))
}

seoRoutes.get('/llms.txt', async (c) => {
  const db = c.env.DB
  const base = siteUrl(c)
  const [settings, zones] = await Promise.all([loadSettings(db), loadActiveZones(db)])
  const brand = settings.brand_name || BRAND_DEFAULTS.brand_name
  const areas = zones.length ? zones.map((zone) => zone.name).join(', ') : 'Delivery areas are being set up.'
  const body = `# ${brand}

> ${settings.brand_tagline ?? ''}

Orders are checked for availability and price, and fruit is bought only after the customer approves the final total.

Delivery areas: ${areas}

## Pages

- [Shop fruit](${base}/shop)
- [Delivery areas](${base}/areas)
- [Contact and support](${base}/contact)
- [Seller and business details](${base}/business-details)
- [Delivery policy](${base}/policies/delivery)
- [Refund and replacement policy](${base}/policies/refund)
`
  return c.text(body, 200, { 'Cache-Control': 'public, max-age=3600' })
})

seoRoutes.get('/robots.txt', (c) => {
  const body =
    c.env.ENVIRONMENT === 'staging'
      ? 'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /rider\nDisallow: /api/\nDisallow: /cart\nDisallow: /checkout\nDisallow: /order/\nDisallow: /track\n\nSitemap: ${siteUrl(c)}/sitemap.xml\n`
  return c.text(body, 200, { 'Cache-Control': 'public, max-age=3600' })
})

seoRoutes.get('/sitemap.xml', async (c) => {
  const db = c.env.DB
  const base = siteUrl(c)
  const [catalog, zones, settings] = await Promise.all([loadCatalog(db), loadActiveZones(db), loadSettings(db)])
  const paths = [
    '/',
    '/shop',
    '/areas',
    '/contact',
    '/business-details',
    ...catalog.categories.filter((category) => catalog.products.some((product) => product.categoryId === category.id)).map((category) => `/category/${category.slug}`),
    ...catalog.products.map((product) => `/products/${product.slug}`),
    ...zones.filter((zone) => zone.hasLandingPage).map((zone) => `/areas/${zone.slug}`),
    ...Object.entries(POLICY_PATHS).filter(([, policy]) => settings[policy.key]?.trim()).map(([path]) => path),
  ]
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((path) => `  <url><loc>${escapeHtml(`${base}${path}`)}</loc></url>`).join('\n')}\n</urlset>\n`
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
})
