/**
 * Fallback brand values. Admins change the live values under Business settings, so this
 * file only matters before settings are saved.
 */
export const BRAND_DEFAULTS = {
  brand_name: 'Ali Fruits',
  brand_tagline: 'Fresh fruit from your local Kharar store',
  hero_heading: 'Fresh Fruits. Fair Prices. Delivered to Your Door.',
  hero_text: 'Discover fresh fruits from your local Kharar fruit store. Order online, confirm availability and enjoy convenient doorstep delivery.',
} as const

export const AVAILABILITY_NOTICE = 'Fruit availability and final prices are verified before your order is accepted.'

export const ORDER_RECEIVED_MESSAGE = 'Your order request has been received. Our team is checking fruit availability and final prices. You will receive confirmation shortly.'
