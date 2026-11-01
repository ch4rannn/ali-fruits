import { istDate } from '../../shared/time'

export type Settings = Record<string, string>

export const GATE_KEYS = ['SELLER_DETAILS_VERIFIED', 'FSSAI_COVERAGE_VERIFIED', 'ONLINE_SALES_ENABLED'] as const
export type GateKey = (typeof GATE_KEYS)[number]

/** Every key admins may edit through the normal settings form. Go-live gates are deliberately not included. */
export const EDITABLE_SETTING_KEYS = new Set([
  'brand_name', 'brand_tagline', 'logo_key', 'legal_seller_name', 'business_address', 'business_phone',
  'whatsapp_number', 'support_email', 'fssai_number', 'fssai_category', 'fssai_valid_until', 'gstin',
  'operating_hours', 'testimonials', 'page_about', 'page_privacy', 'page_terms', 'page_delivery',
  'page_cancellation', 'page_refund', 'upi_id', 'upi_qr_key', 'upi_display_name', 'upi_instructions',
  'delivery_otp_enabled', 'promo_banner_key', 'promo_banner_alt',
])

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare('SELECT key, value FROM business_settings').all<{ key: string; value: string }>()
  return Object.fromEntries(results.map((row) => [row.key, row.value]))
}

export function goLiveState(env: Env, settings: Settings) {
  const gate = (key: GateKey) => ({ deployment: env[key] === 'true', admin: settings[key] === 'true' })
  const gates = {
    SELLER_DETAILS_VERIFIED: gate('SELLER_DETAILS_VERIFIED'),
    FSSAI_COVERAGE_VERIFIED: gate('FSSAI_COVERAGE_VERIFIED'),
    ONLINE_SALES_ENABLED: gate('ONLINE_SALES_ENABLED'),
  }
  const on = (g: { deployment: boolean; admin: boolean }) => g.deployment && g.admin
  const licenceExpired = Boolean(settings.fssai_valid_until && settings.fssai_valid_until < istDate())
  return {
    gates,
    licenceExpired,
    sellerVerified: on(gates.SELLER_DETAILS_VERIFIED),
    fssaiVerified: on(gates.FSSAI_COVERAGE_VERIFIED) && !licenceExpired,
    live: on(gates.SELLER_DETAILS_VERIFIED) && on(gates.FSSAI_COVERAGE_VERIFIED) && on(gates.ONLINE_SALES_ENABLED) && !licenceExpired,
  }
}

/** What the public site may see. Legal and licence details only appear once they have been marked verified. */
export function publicConfig(env: Env, settings: Settings) {
  const state = goLiveState(env, settings)
  return {
    brandName: settings.brand_name ?? '',
    tagline: settings.brand_tagline ?? '',
    logoKey: settings.logo_key || null,
    phone: settings.business_phone ?? '',
    whatsapp: settings.whatsapp_number ?? '',
    email: settings.support_email ?? '',
    hours: settings.operating_hours ?? '',
    address: state.sellerVerified ? (settings.business_address ?? '') : '',
    legalSellerName: state.sellerVerified ? (settings.legal_seller_name ?? '') : '',
    gstin: state.sellerVerified ? (settings.gstin ?? '') : '',
    fssaiNumber: state.fssaiVerified ? (settings.fssai_number ?? '') : '',
    fssaiCategory: state.fssaiVerified ? (settings.fssai_category ?? '') : '',
    fssaiValidUntil: state.fssaiVerified ? (settings.fssai_valid_until ?? '') : '',
    promoBannerKey: settings.promo_banner_key || null,
    promoBannerAlt: settings.promo_banner_alt ?? '',
    testimonials: parseTestimonials(settings.testimonials ?? ''),
    liveOrders: state.live,
  }
}

/** One real review per line, written as "Name | Review text". */
export function parseTestimonials(raw: string): Array<{ name: string; text: string }> {
  return raw
    .split('\n')
    .map((line) => line.split('|').map((part) => part.trim()))
    .filter((parts) => parts.length >= 2 && parts[0] && parts[1])
    .map((parts) => ({ name: parts[0]!, text: parts.slice(1).join(' | ') }))
}

export const PAGE_KEYS: Record<string, string> = {
  about: 'page_about',
  privacy: 'page_privacy',
  terms: 'page_terms',
  delivery: 'page_delivery',
  cancellation: 'page_cancellation',
  refund: 'page_refund',
}
