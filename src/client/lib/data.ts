import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from './api'

export type Variant = { id: string; label: string; unitKind: string; unitSize: number; pricePaise: number; minQty: number; qtyStep: number }
export type Product = {
  id: string
  categoryId: string
  categorySlug?: string
  name: string
  slug: string
  description: string
  availability: 'AVAILABLE' | 'UNAVAILABLE' | 'SEASONAL' | 'TEMPORARILY_UNAVAILABLE'
  isFeatured: boolean
  isSeasonal: boolean
  isCombo: boolean
  displayPriority: number
  variants: Variant[]
  images: Array<{ key: string; alt: string }>
}
export type Category = { id: string; name: string; slug: string; description: string; imageKey: string | null }
export type Zone = {
  id: string
  name: string
  slug: string
  pinCodes: string[]
  minOrderPaise: number
  deliveryChargePaise: number
  smallOrderBelowPaise: number
  smallOrderChargePaise: number
  freeAbovePaise: number | null
  quoteOnly: boolean
  estimatedTime: string
  hasLandingPage: boolean
  landingDescription: string
  slots: Array<{ id: string; label: string }>
}
export type PublicConfig = {
  brandName: string
  tagline: string
  logoKey: string | null
  phone: string
  whatsapp: string
  email: string
  hours: string
  address: string
  legalSellerName: string
  gstin: string
  fssaiNumber: string
  fssaiCategory: string
  fssaiValidUntil: string
  promoBannerKey: string | null
  promoBannerAlt: string
  testimonials: Array<{ name: string; text: string }>
  liveOrders: boolean
}

const minute = 60_000

export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfig>('/public/config'), staleTime: minute })
export const useCatalog = () => useQuery({ queryKey: ['catalog'], queryFn: () => api<{ categories: Category[]; products: Product[] }>('/public/catalog'), staleTime: minute })
export const useZones = () => useQuery({ queryKey: ['zones'], queryFn: () => api<{ zones: Zone[] }>('/public/zones'), staleTime: minute })

export function usePageTitle(title: string) {
  useEffect(() => {
    // Skip until the brand has loaded, so the server's complete title is never replaced by a partial one.
    if (title && !title.endsWith('| ')) document.title = title
  }, [title])
}

export const lowestPrice = (product: Product) => Math.min(...product.variants.map((variant) => variant.pricePaise))
export const canOrder = (product: Product) => product.availability === 'AVAILABLE'

export function whatsappHref(number: string, message: string): string {
  const digits = number.replace(/\D/g, '')
  const international = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${international}?text=${encodeURIComponent(message)}`
}
