import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { StorefrontLayout } from './components/storefront'
import { Spinner } from './components/ui'
import Home from './pages/customer/Home'
import Shop from './pages/customer/Shop'

// Each group of pages loads when first opened, so the home page stays small on slow phone connections.
const CartPage = lazy(() => import('./pages/customer/Cart'))
const Checkout = lazy(() => import('./pages/customer/Checkout'))
const OrderPage = lazy(() => import('./pages/customer/Order'))
const ProductPage = lazy(() => import('./pages/customer/ProductPage'))
const info = () => import('./pages/customer/Info')
const Areas = lazy(() => info().then((m) => ({ default: m.Areas })))
const BusinessDetails = lazy(() => info().then((m) => ({ default: m.BusinessDetails })))
const Contact = lazy(() => info().then((m) => ({ default: m.Contact })))
const NotFound = lazy(() => info().then((m) => ({ default: m.NotFound })))
const Policy = lazy(() => info().then((m) => ({ default: m.Policy })))
const TrackLookup = lazy(() => info().then((m) => ({ default: m.TrackLookup })))

// Staff and rider screens are separate bundles, so customers never download them.
const AdminApp = lazy(() => import('./pages/admin/AdminApp'))
const RiderApp = lazy(() => import('./pages/rider/RiderApp'))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<StorefrontLayout />}>
          <Route index element={<Home />} />
          <Route path="shop" element={<Shop />} />
          <Route path="category/:slug" element={<Shop />} />
          <Route path="products/:slug" element={<ProductPage />} />
          <Route path="cart" element={<CartPage />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="order/:token" element={<OrderPage />} />
          <Route path="track" element={<TrackLookup />} />
          <Route path="areas" element={<Areas />} />
          <Route path="areas/:slug" element={<Areas />} />
          <Route path="contact" element={<Contact />} />
          <Route path="business-details" element={<BusinessDetails />} />
          <Route path="about" element={<Policy slug="about" title="About us" />} />
          <Route path="policies/privacy" element={<Policy slug="privacy" title="Privacy policy" />} />
          <Route path="policies/terms" element={<Policy slug="terms" title="Terms and conditions" />} />
          <Route path="policies/delivery" element={<Policy slug="delivery" title="Delivery policy" />} />
          <Route path="policies/cancellation" element={<Policy slug="cancellation" title="Cancellation policy" />} />
          <Route path="policies/refund" element={<Policy slug="refund" title="Refund and replacement policy" />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route
          path="admin/*"
          element={
            <Suspense fallback={<Spinner />}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route
          path="rider/*"
          element={
            <Suspense fallback={<Spinner />}>
              <RiderApp />
            </Suspense>
          }
        />
      </Routes>
    </>
  )
}
