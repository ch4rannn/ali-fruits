import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3, Bell, ClipboardList, CreditCard, FileClock, LayoutDashboard, LifeBuoy, LogOut, MapPinned, Menu, ReceiptIndianRupee, Settings as SettingsIcon, ShoppingBag, ShoppingBasket, Tags, Truck, UserCog, Users, Wallet, X, Bike, type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { ROLE_LABELS, type Role } from '../../../shared/permissions'
import { ChangePassword, SignIn, useLogout } from '../../components/auth'
import { InstallButton } from '../../components/install'
import { Button, Dialog, EmptyState, LinkButton, Spinner, cx } from '../../components/ui'
import { api } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { useAppManifest } from '../../lib/pwa'
import { Categories, Pricing, ProductEditor, Products } from './Catalog'
import { Analytics, Expenses, Payments } from './Money'
import { CustomerDetail, Customers, Deliveries, Procurement, Riders } from './Operations'
import OrderDetail from './OrderDetail'
import Orders from './Orders'
import Overview from './Overview'
import { useAdminQuery, useCan, useMe } from './shared'
import { Audit, Settings, Staff, Support, Zones } from './System'

type NavItem = { to: string; label: string; icon: LucideIcon; perm: string[]; end?: boolean }
const NAV: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, perm: ['dashboard.read'], end: true },
  { to: '/admin/orders', label: 'Orders', icon: ClipboardList, perm: ['orders.read'] },
  { to: '/admin/products', label: 'Products', icon: ShoppingBasket, perm: ['catalog.write'] },
  { to: '/admin/categories', label: 'Categories', icon: Tags, perm: ['catalog.write'] },
  { to: '/admin/pricing', label: 'Pricing', icon: ReceiptIndianRupee, perm: ['pricing.write'] },
  { to: '/admin/procurement', label: 'Procurement', icon: ShoppingBag, perm: ['procurement.write'] },
  { to: '/admin/customers', label: 'Customers', icon: Users, perm: ['customers.read'] },
  { to: '/admin/riders', label: 'Riders', icon: Bike, perm: ['riders.manage', 'costs.read'] },
  { to: '/admin/deliveries', label: 'Deliveries', icon: Truck, perm: ['deliveries.manage'] },
  { to: '/admin/payments', label: 'Payments', icon: CreditCard, perm: ['payments.read'] },
  { to: '/admin/expenses', label: 'Expenses', icon: Wallet, perm: ['expenses.write'] },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3, perm: ['reports.read'] },
  { to: '/admin/support', label: 'Support', icon: LifeBuoy, perm: ['support.manage'] },
  { to: '/admin/staff', label: 'Staff', icon: UserCog, perm: ['staff.manage'] },
  { to: '/admin/zones', label: 'Delivery zones', icon: MapPinned, perm: ['zones.manage'] },
  { to: '/admin/settings', label: 'Business settings', icon: SettingsIcon, perm: ['settings.read'] },
  { to: '/admin/audit', label: 'Audit logs', icon: FileClock, perm: ['audit.read'] },
]

function Notifications() {
  const [open, setOpen] = useState(false)
  const client = useQueryClient()
  const list = useAdminQuery<{ notifications: Array<{ id: string; body: string; order_id: string | null; read_at: string | null; created_at: string }>; unread: number }>('/system/notifications', { refetchInterval: 30_000 })
  const readAll = useMutation({ mutationFn: () => api('/admin/system/notifications/read-all', { method: 'POST' }), onSuccess: () => void client.invalidateQueries({ queryKey: ['admin', '/system/notifications'] }) })
  const unread = list.data?.unread ?? 0
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="relative grid size-10 place-items-center rounded-md hover:bg-mist" aria-label={`Notifications${unread ? `, ${unread} new` : ''}`}>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-berry px-1 text-[10px] font-bold text-paper">{unread}</span>}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Notifications">
        {list.data?.notifications.length ? (
          <ul className="max-h-96 space-y-2 overflow-y-auto">{list.data.notifications.map((n) => (
            <li key={n.id} className={cx('rounded-md border p-2 text-sm', n.read_at ? 'border-line' : 'border-citrus bg-citrus-soft')}>
              {n.order_id ? <Link className="font-medium underline" to={`/admin/orders/${n.order_id}`} onClick={() => setOpen(false)}>{n.body}</Link> : n.body}
              <p className="text-xs text-ink-soft">{formatDateTime(n.created_at)}</p>
            </li>))}</ul>
        ) : <p className="text-sm text-ink-soft">Nothing yet.</p>}
        <div className="mt-4 flex justify-between"><Button variant="ghost" onClick={() => setOpen(false)}>Close</Button><Button variant="secondary" disabled={unread === 0} onClick={() => readAll.mutate()}>Mark all read</Button></div>
      </Dialog>
    </>
  )
}

function Layout() {
  const me = useMe().data!
  const can = useCan()
  const logout = useLogout()
  const [menu, setMenu] = useState(false)
  const location = useLocation()
  const items = NAV.filter((item) => can(...item.perm))
  const nav = (
    <nav aria-label="Admin" className="flex flex-col gap-0.5 p-3">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} onClick={() => setMenu(false)} className={({ isActive }) => cx('flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium', isActive ? 'bg-forest text-paper' : 'text-ink hover:bg-mist')}>
          <Icon className="size-4" aria-hidden /> {label}
        </NavLink>
      ))}
    </nav>
  )
  const allowed = (path: string) => {
    const match = [...NAV].reverse().find((item) => path === item.to || path.startsWith(`${item.to}/`))
    return !match || can(...match.perm) || (match.to === '/admin' && true)
  }
  return (
    <div className="min-h-dvh bg-cream lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh overflow-y-auto border-r border-line bg-paper lg:block">
        <div className="p-4"><Link to="/admin" className="font-display text-xl font-bold text-forest">Shop admin</Link></div>
        {nav}
      </aside>
      <div className="min-w-0">
        <header className="safe-top sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-paper px-3">
          <button type="button" className="grid size-10 place-items-center rounded-md hover:bg-mist lg:hidden" aria-label="Open menu" onClick={() => setMenu(true)}><Menu className="size-5" /></button>
          <Link to="/admin" className="font-display font-bold text-forest lg:hidden">Shop admin</Link>
          <div className="ml-auto flex items-center gap-1">
            <InstallButton />
            <Notifications />
            <span className="hidden text-right text-xs leading-tight sm:block"><span className="block font-semibold">{me.name}</span><span className="text-ink-soft">{ROLE_LABELS[me.role as Role]}</span></span>
            <button type="button" className="grid size-10 place-items-center rounded-md hover:bg-mist" aria-label="Sign out" onClick={() => logout.mutate()}><LogOut className="size-5" /></button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 pb-20 lg:p-6">
          {allowed(location.pathname) ? (
            <Routes>
              <Route index element={can('dashboard.read') ? <Overview /> : <EmptyState title="Welcome" />} />
              <Route path="orders" element={<Orders />} />
              <Route path="orders/:id" element={<OrderDetail />} />
              <Route path="products" element={<Products />} />
              <Route path="products/:id" element={<ProductEditor />} />
              <Route path="categories" element={<Categories />} />
              <Route path="pricing" element={<Pricing />} />
              <Route path="procurement" element={<Procurement />} />
              <Route path="customers" element={<Customers />} />
              <Route path="customers/:id" element={<CustomerDetail />} />
              <Route path="riders" element={<Riders />} />
              <Route path="deliveries" element={<Deliveries />} />
              <Route path="payments" element={<Payments />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="support" element={<Support />} />
              <Route path="staff" element={<Staff />} />
              <Route path="zones" element={<Zones />} />
              <Route path="settings" element={<Settings />} />
              <Route path="audit" element={<Audit />} />
              <Route path="*" element={<EmptyState title="That page does not exist" action={<LinkButton to="/admin" size="sm">Back to overview</LinkButton>} />} />
            </Routes>
          ) : (
            <EmptyState title="You do not have access to this page" action={<LinkButton to="/admin" size="sm">Back to overview</LinkButton>}>Your role ({ROLE_LABELS[me.role as Role]}) cannot open it. Ask a super admin if you need access.</EmptyState>
          )}
        </main>
      </div>
      {menu && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-ink/50" aria-label="Close menu" onClick={() => setMenu(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-paper"><div className="flex items-center justify-between p-4"><span className="font-display text-xl font-bold text-forest">Shop admin</span><button type="button" aria-label="Close menu" onClick={() => setMenu(false)}><X className="size-5" /></button></div>{nav}</div>
        </div>
      )}
    </div>
  )
}

export default function AdminApp() {
  useAppManifest('admin')
  const me = useMe()
  const logout = useLogout()
  if (me.isPending) return <Spinner />
  if (me.isError) return <SignIn title="Staff sign-in" allowSetup />
  if (me.data.mustChangePassword) return <ChangePassword />
  if (me.data.role === 'RIDER') {
    return (
      <div className="grid min-h-dvh place-items-center p-6"><EmptyState title="This is a rider account" action={<div className="flex gap-2"><LinkButton to="/rider" size="sm">Open the rider app</LinkButton><Button size="sm" variant="secondary" onClick={() => logout.mutate()}>Sign out</Button></div>}>Riders use their own app.</EmptyState></div>
    )
  }
  return <Layout />
}
