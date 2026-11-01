import { Home, MapPin, MessageCircle, Package, ShoppingBasket, Store, WifiOff } from 'lucide-react'
import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { BRAND_DEFAULTS } from '../../shared/brand'
import { mediaUrl } from '../lib/api'
import { setChosenZone, useCart, useChosenZone } from '../lib/cart'
import { useConfig, useZones, whatsappHref } from '../lib/data'
import { formatINR } from '../lib/format'
import { useAppManifest, useOnline } from '../lib/pwa'
import { InstallButton } from './install'
import { PageLoading } from './loading'
import { Button, Dialog, Notice, Select, cx } from './ui'

export function useChosenZoneDetails() {
  const { zoneId } = useChosenZone()
  const zones = useZones().data?.zones ?? []
  return { zone: zones.find((item) => item.id === zoneId) ?? null, zones }
}

export function ZonePicker({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const { zone, zones } = useChosenZoneDetails()
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cx('inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line bg-paper px-2.5 text-sm font-medium hover:border-forest', className)}>
        <MapPin className="size-4 text-forest" aria-hidden />
        <span className="max-w-32 truncate">{zone ? zone.name : 'Check delivery area'}</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Where should we deliver?">
        {zones.length === 0 ? (
          <Notice tone="info">We are still setting up our delivery areas. Message us on WhatsApp and we will tell you if we can reach you.</Notice>
        ) : (
          <>
            <Select label="Delivery area" value={zone?.id ?? ''} onChange={(event) => setChosenZone(event.target.value || null)}>
              <option value="">Choose your area</option>
              {zones.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
            {zone && (
              <p className="mt-3 text-sm text-ink-soft">
                {zone.estimatedTime && <>Usually {zone.estimatedTime}. </>}
                {zone.quoteOnly ? 'We confirm the delivery charge for this area when we check your order.' : `Delivery from ${formatINR(zone.freeAbovePaise === 0 ? 0 : zone.deliveryChargePaise)}.`}
                {zone.minOrderPaise > 0 && <> Minimum order {formatINR(zone.minOrderPaise)}.</>}
              </p>
            )}
            <Button full className="mt-4" onClick={() => setOpen(false)}>
              Done
            </Button>
          </>
        )}
      </Dialog>
    </>
  )
}

function Brand() {
  const config = useConfig().data
  const name = config?.brandName || BRAND_DEFAULTS.brand_name
  return (
    <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold text-forest">
      {config?.logoKey ? <img src={mediaUrl(config.logoKey)!} alt="" className="size-8 rounded-sm object-contain" /> : <span className="grid size-8 place-items-center rounded-md bg-forest text-lg text-citrus" aria-hidden>{name.charAt(0)}</span>}
      <span>{name}</span>
    </Link>
  )
}

function Header() {
  const cart = useCart()
  const count = cart.lines.length
  const links = [
    { to: '/shop', label: 'Shop' },
    { to: '/areas', label: 'Delivery areas' },
    { to: '/track', label: 'Track order' },
    { to: '/contact', label: 'Contact' },
  ]
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Brand />
        <nav className="ml-6 hidden items-center gap-5 md:flex" aria-label="Main">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => cx('text-sm font-medium hover:text-forest', isActive ? 'text-forest underline decoration-citrus decoration-2 underline-offset-8' : 'text-ink')}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ZonePicker />
          <Link to="/cart" className="relative hidden h-11 items-center gap-2 rounded-md bg-forest px-4 font-semibold text-paper hover:bg-forest-deep md:inline-flex">
            <ShoppingBasket className="size-5" aria-hidden />
            Cart
            {count > 0 && <span className="grid size-5 place-items-center rounded-full bg-citrus text-xs font-bold text-ink">{count}</span>}
          </Link>
        </div>
      </div>
    </header>
  )
}

function BottomTabs() {
  const count = useCart().lines.length
  const tabs = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: '/shop', label: 'Shop', icon: Store },
    { to: '/cart', label: 'Cart', icon: ShoppingBasket, badge: count },
    { to: '/track', label: 'Orders', icon: Package },
  ]
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper md:hidden" aria-label="App">
      <ul className="grid grid-cols-4">
        {tabs.map(({ to, label, icon: Icon, badge, end }) => (
          <li key={to}>
            <NavLink to={to} end={end} className={({ isActive }) => cx('relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium', isActive ? 'text-forest' : 'text-ink-soft')}>
              <Icon className="size-5" aria-hidden />
              {label}
              {badge ? <span className="absolute right-[22%] top-1.5 grid min-w-4 place-items-center rounded-full bg-citrus px-1 text-[10px] font-bold text-ink">{badge}</span> : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Footer() {
  const config = useConfig().data
  const { zones } = useChosenZoneDetails()
  const name = config?.brandName || BRAND_DEFAULTS.brand_name
  const policies = [
    ['About us', '/about'],
    ['Delivery policy', '/policies/delivery'],
    ['Cancellation policy', '/policies/cancellation'],
    ['Refund and replacement', '/policies/refund'],
    ['Privacy policy', '/policies/privacy'],
    ['Terms and conditions', '/policies/terms'],
    ['Seller details', '/business-details'],
  ] as const
  return (
    <footer className="mt-16 border-t border-line bg-cream pb-24 md:pb-0">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-3">
        <div>
          <p className="font-display text-xl font-bold text-forest">{name}</p>
          <p className="mt-1 text-sm text-ink-soft">{config?.tagline}</p>
          <ul className="mt-4 space-y-1 text-sm">
            {config?.phone && <li>Phone: <a className="underline" href={`tel:${config.phone}`}>{config.phone}</a></li>}
            {config?.email && <li>Email: <a className="underline" href={`mailto:${config.email}`}>{config.email}</a></li>}
            {config?.hours && <li>Hours: {config.hours}</li>}
            {config?.address && <li>{config.address}</li>}
          </ul>
          <InstallButton className="mt-4" />
        </div>
        <nav aria-label="Policies">
          <p className="font-semibold">Information</p>
          <ul className="mt-2 space-y-1 text-sm">
            {policies.map(([label, to]) => (
              <li key={to}><Link className="hover:underline" to={to}>{label}</Link></li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="font-semibold">Where we deliver</p>
          <p className="mt-2 text-sm text-ink-soft">{zones.length ? zones.map((zone) => zone.name).join(', ') : 'Delivery areas are being set up.'}</p>
          {(config?.fssaiNumber || config?.gstin || config?.legalSellerName) && (
            <ul className="mt-4 space-y-1 text-xs text-ink-soft">
              {config?.legalSellerName && <li>Sold by {config.legalSellerName}</li>}
              {config?.fssaiNumber && <li>FSSAI licence no. {config.fssaiNumber}{config.fssaiCategory ? ` (${config.fssaiCategory})` : ''}</li>}
              {config?.gstin && <li>GSTIN {config.gstin}</li>}
            </ul>
          )}
        </div>
      </div>
    </footer>
  )
}

function StatusBars() {
  const online = useOnline()
  const config = useConfig().data
  const { pathname } = useLocation()
  return (
    <>
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-ink px-4 py-2 text-sm text-paper" role="status">
          <WifiOff className="size-4" aria-hidden /> You are offline. Some things may not load.
        </div>
      )}
      {config && !config.liveOrders && pathname !== '/' && (
        <div className="bg-citrus-soft px-4 py-2 text-center text-sm">
          Online ordering is not open yet. You can browse and send a non-binding enquiry, and we will reply to you directly.
        </div>
      )}
    </>
  )
}

export function WhatsAppButton({ message, className, children }: { message: string; className?: string; children?: React.ReactNode }) {
  const config = useConfig().data
  if (!config?.whatsapp) {
    // No number saved yet: never show a dead button, so point at the contact form instead.
    return config?.phone ? <a href={`tel:${config.phone}`} className={className}>Call us</a> : <Link to="/contact" className={className}>Contact us</Link>
  }
  return (
    <a href={whatsappHref(config.whatsapp, message)} target="_blank" rel="noopener noreferrer" className={className}>
      {children ?? (
        <>
          <MessageCircle className="size-4" aria-hidden /> Order on WhatsApp
        </>
      )}
    </a>
  )
}

export function StorefrontLayout() {
  useAppManifest('shop')
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-citrus focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Header />
      <StatusBars />
      <main id="main" className="flex-1 pb-20 md:pb-0">
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      <BottomTabs />
    </div>
  )
}
