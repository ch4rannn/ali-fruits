import { z } from 'zod'
import { MAX_MONEY_PAISE } from './money'
import { AVAILABILITY, TICKET_TYPES } from './constants'
import { ORDER_STATUSES } from './order-state'
import { ROLES } from './permissions'

export const paise = z.number().int().min(0).max(MAX_MONEY_PAISE)
export const positiveQty = z.number().int().min(1).max(999)
const shortText = (max = 200) => z.string().trim().max(max)
const requiredText = (max = 200) => z.string().trim().min(1, 'Required').max(max)
const optionalText = (max = 500) => z.string().trim().max(max).optional().default('')
export const id = z.string().min(1).max(64)
export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

export { AVAILABILITY, AVAILABILITY_LABELS, TICKET_TYPES, TICKET_TYPE_LABELS, type Availability } from './constants'
export const PAYMENT_METHODS = ['UPI', 'COD'] as const
export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'PARTIALLY_PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED'] as const
export const EXPENSE_CATEGORIES = ['PACKAGING', 'RIDER', 'THIRD_PARTY_DELIVERY', 'OTHER_VARIABLE', 'FIXED'] as const

export const indianPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'))

export const pinCode = z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code')

export const cartLine = z.object({
  variantId: id,
  qty: positiveQty,
  expectedUnitPaise: paise.optional(),
})

export const quoteRequest = z.object({
  items: z.array(cartLine).min(1).max(50),
  zoneId: id.optional(),
})

export const checkoutRequest = z.object({
  idempotencyKey: z.string().uuid(),
  items: z.array(cartLine).min(1, 'Your cart is empty').max(50),
  name: requiredText(100),
  phone: indianPhone,
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]).optional().default(''),
  pinCode,
  zoneId: id,
  slotId: id,
  addressLine: requiredText(400),
  landmark: optionalText(200),
  instructions: optionalText(400),
  paymentPreference: z.enum(PAYMENT_METHODS),
  termsAccepted: z.literal(true, { error: 'Please accept the terms to continue' }),
  acceptedTotalPaise: paise.optional(),
})
export type CheckoutRequest = z.input<typeof checkoutRequest>

export const customerResponse = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ACCEPT_ORDER'), revision: z.number().int().min(1), paymentMethod: z.enum(PAYMENT_METHODS) }),
  z.object({ action: z.literal('REJECT_ORDER'), revision: z.number().int().min(1), note: optionalText(400) }),
  z.object({ action: z.literal('REQUEST_CHANGE'), revision: z.number().int().min(1), note: requiredText(400) }),
])

export const paymentReference = z.object({
  txnRef: requiredText(64),
  amountPaise: paise.min(1),
})

export const ticketRequest = z.object({
  type: z.enum(TICKET_TYPES),
  name: requiredText(100),
  phone: indianPhone,
  orderNumber: shortText(40).optional().default(''),
  message: requiredText(1000),
})

export const orderLookup = z.object({ orderNumber: requiredText(40), phone: indianPhone })

// Staff

export const loginRequest = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) })
export const newPassword = z.string().min(10, 'Use at least 10 characters').max(200)
export const changePasswordRequest = z.object({ currentPassword: z.string().min(1).max(200), newPassword })
export const bootstrapRequest = z.object({
  token: z.string().min(1).max(500),
  name: requiredText(100),
  email: z.string().trim().email(),
  password: newPassword,
})

export const staffCreate = z.object({
  name: requiredText(100),
  email: z.string().trim().email(),
  phone: optionalText(20),
  role: z.enum(ROLES),
  temporaryPassword: newPassword,
})
export const staffUpdate = z.object({
  name: requiredText(100).optional(),
  phone: shortText(20).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  temporaryPassword: newPassword.optional(),
})

export const categoryInput = z.object({
  name: requiredText(80),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens').max(80).optional(),
  description: optionalText(400),
  imageKey: shortText(200).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
})

export const variantInput = z.object({
  id: id.optional(),
  label: requiredText(40),
  unitKind: z.enum(['WEIGHT', 'COUNT']),
  unitSize: z.number().int().min(1).max(100000),
  retailPricePaise: paise.min(1),
  wholesalePricePaise: paise.nullable().optional(),
  minQty: positiveQty.default(1),
  qtyStep: positiveQty.default(1),
  isActive: z.boolean().default(true),
})

export const productInput = z.object({
  name: requiredText(120),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens').max(120).optional(),
  description: optionalText(1500),
  categoryId: id,
  availability: z.enum(AVAILABILITY).default('AVAILABLE'),
  isFeatured: z.boolean().default(false),
  isSeasonal: z.boolean().default(false),
  isCombo: z.boolean().default(false),
  displayPriority: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  variants: z.array(variantInput).min(1, 'Add at least one selling unit').max(12),
  images: z.array(z.object({ key: requiredText(200), alt: optionalText(200) })).max(8).default([]),
})

export const bulkProductUpdate = z.object({
  productIds: z.array(id).min(1).max(200),
  availability: z.enum(AVAILABILITY).optional(),
  isFeatured: z.boolean().optional(),
  isActive: z.boolean().optional(),
  categoryId: id.optional(),
})

export const priceUpdate = z.object({
  effectiveDate: isoDay.optional(),
  note: optionalText(200),
  prices: z
    .array(z.object({ variantId: id, retailPricePaise: paise.min(1), wholesalePricePaise: paise.nullable().optional() }))
    .min(1)
    .max(200),
})

export const revisionInput = z.object({
  reason: requiredText(400),
  internalNote: optionalText(1000),
  deliveryFeePaise: paise,
  discountPaise: paise.default(0),
  otherChargesPaise: paise.default(0),
  items: z
    .array(
      z.object({
        itemId: id.optional(),
        variantId: id.optional(),
        qty: z.number().int().min(0).max(999),
        unitPricePaise: paise,
        substituteForItemId: id.optional(),
      }),
    )
    .min(1)
    .max(60),
})

export const transitionInput = z.object({
  to: z.enum(ORDER_STATUSES),
  reason: optionalText(400),
})

export const recordApprovalInput = z.object({
  revision: z.number().int().min(1),
  paymentMethod: z.enum(PAYMENT_METHODS),
  note: requiredText(400),
})

export const notesInput = z.object({ internalNotes: z.string().trim().max(2000) })

export const procurementInput = z.object({
  orderItemId: id,
  supplierId: id,
  purchasedQuantity: z.number().int().min(1).max(10_000_000),
  unit: z.enum(['g', 'piece', 'dozen', 'box']),
  purchasePricePaise: paise.nullable().optional(),
  totalCostPaise: paise,
  purchasedAt: z.string().datetime().optional(),
  responsibleEmployee: optionalText(100),
  invoiceReference: optionalText(100),
  notes: optionalText(400),
})

export const supplierInput = z.object({
  name: requiredText(120),
  phone: optionalText(20),
  notes: optionalText(400),
  isActive: z.boolean().default(true),
})

export const paymentInput = z.object({
  orderId: id,
  amountPaise: paise.min(1),
  method: z.enum(['UPI', 'COD', 'OTHER']),
  txnRef: optionalText(64),
  notes: optionalText(400),
})
export const paymentVerify = z.object({ decision: z.enum(['VERIFIED', 'FAILED']), notes: optionalText(400) })
export const refundInput = z.object({
  amountPaise: paise.min(1),
  method: z.enum(['UPI', 'COD', 'OTHER']),
  txnRef: optionalText(64),
  notes: optionalText(400),
})

export const expenseInput = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amountPaise: paise.min(1),
  expenseDate: isoDay,
  description: optionalText(300),
  orderId: id.nullable().optional(),
  riderId: id.nullable().optional(),
})

export const riderCreate = z.object({
  name: requiredText(100),
  email: z.string().trim().email(),
  phone: indianPhone,
  vehicleType: optionalText(40),
  compensationType: z.enum(['PER_DELIVERY', 'PER_SHIFT', 'FIXED_DAILY', 'CUSTOM']),
  compensationAmountPaise: paise.default(0),
  notes: optionalText(400),
  temporaryPassword: newPassword,
})
export const riderUpdate = z.object({
  phone: indianPhone.optional(),
  vehicleType: shortText(40).optional(),
  compensationType: z.enum(['PER_DELIVERY', 'PER_SHIFT', 'FIXED_DAILY', 'CUSTOM']).optional(),
  compensationAmountPaise: paise.optional(),
  notes: shortText(400).optional(),
  isActive: z.boolean().optional(),
})

export const assignRider = z.object({ orderId: id, riderId: id, costPaise: paise.optional() })
export const thirdPartyBooking = z.object({
  orderId: id,
  provider: requiredText(60),
  bookingReference: optionalText(100),
  bookingDate: isoDay.optional(),
  actualFeePaise: paise,
  trackingUrl: z.union([z.literal(''), z.string().url().startsWith('https://')]).optional().default(''),
  notes: optionalText(400),
})
export const batchCreate = z.object({
  name: requiredText(100),
  locality: optionalText(100),
  slotLabel: optionalText(60),
  riderId: id,
  totalCostPaise: paise,
  orderIds: z.array(id).min(1).max(40),
})
export const manualDeliveryUpdate = z.object({
  status: z.enum(['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED']),
  note: optionalText(300),
  actualCostPaise: paise.optional(),
  codCollectedPaise: paise.optional(),
})

export const riderDelivered = z.object({
  otp: z.string().trim().regex(/^\d{4}$/).optional(),
  codCollectedPaise: paise.optional(),
  note: optionalText(300),
})
export const riderFailed = z.object({ reason: requiredText(300) })

export const zoneInput = z.object({
  name: requiredText(100),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(100).optional(),
  pinCodes: z.string().trim().regex(/^[1-9]\d{5}(\s*,\s*[1-9]\d{5})*$/, 'Enter 6-digit PIN codes separated by commas'),
  minOrderPaise: paise.default(0),
  deliveryChargePaise: paise.default(0),
  smallOrderBelowPaise: paise.default(0),
  smallOrderChargePaise: paise.default(0),
  freeAbovePaise: paise.nullable().default(null),
  quoteOnly: z.boolean().default(false),
  estimatedTime: optionalText(60),
  ownRiderEnabled: z.boolean().default(true),
  thirdPartyEnabled: z.boolean().default(false),
  publishLandingPage: z.boolean().default(false),
  landingDescription: optionalText(1000),
  isActive: z.boolean().default(false),
  slots: z.array(z.object({ id: id.optional(), label: requiredText(60), isActive: z.boolean().default(true) })).max(12).default([]),
})

export const settingsUpdate = z.object({ values: z.record(z.string().max(60), z.string().max(30000)) })
export const goLiveUpdate = z.object({
  key: z.enum(['SELLER_DETAILS_VERIFIED', 'FSSAI_COVERAGE_VERIFIED', 'ONLINE_SALES_ENABLED']),
  value: z.boolean(),
  attestation: z.string().trim().max(500).optional(),
})

export const ticketUpdate = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  resolution: optionalText(1000),
})

export const customerUpdate = z.object({
  isBlocked: z.boolean().optional(),
  internalNotes: shortText(2000).optional(),
})

export const rangeQuery = z.object({ from: isoDay, to: isoDay })
