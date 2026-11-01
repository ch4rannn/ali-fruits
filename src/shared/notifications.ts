export const NOTIFICATION_EVENTS = [
  'NEW_ORDER',
  'ORDER_RECEIVED',
  'APPROVAL_REQUIRED',
  'ORDER_CONFIRMED',
  'CHANGE_REQUESTED',
  'ORDER_REJECTED',
  'PAYMENT_RECEIVED',
  'PAYMENT_VERIFIED',
  'PROCUREMENT_COMPLETED',
  'READY_FOR_PICKUP',
  'RIDER_ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'ORDER_CANCELLED',
  'REFUND_RECORDED',
] as const
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]

export type TemplateData = {
  brand: string
  orderNumber: string
  customerName?: string
  total?: string
  trackingUrl?: string
  reason?: string
}

type Template = { audience: 'ADMIN' | 'CUSTOMER' | 'RIDER'; render: (d: TemplateData) => string }

const link = (d: TemplateData) => (d.trackingUrl ? `\nView your order: ${d.trackingUrl}` : '')

export const NOTIFICATION_TEMPLATES: Record<NotificationEvent, Template> = {
  NEW_ORDER: { audience: 'ADMIN', render: (d) => `New order request ${d.orderNumber} from ${d.customerName ?? 'a customer'}.` },
  ORDER_RECEIVED: { audience: 'CUSTOMER', render: (d) => `Hello ${d.customerName ?? ''}, ${d.brand} has received order request ${d.orderNumber}. We are checking fruit availability and final prices.${link(d)}` },
  APPROVAL_REQUIRED: { audience: 'CUSTOMER', render: (d) => `Hello ${d.customerName ?? ''}, your ${d.brand} order ${d.orderNumber} has been checked. The final total is ${d.total}. Please review and approve it.${link(d)}` },
  ORDER_CONFIRMED: { audience: 'CUSTOMER', render: (d) => `Your ${d.brand} order ${d.orderNumber} is confirmed. Total: ${d.total}.${link(d)}` },
  CHANGE_REQUESTED: { audience: 'ADMIN', render: (d) => `Customer requested a change on order ${d.orderNumber}: ${d.reason ?? ''}` },
  ORDER_REJECTED: { audience: 'ADMIN', render: (d) => `Order ${d.orderNumber} was rejected. ${d.reason ?? ''}` },
  PAYMENT_RECEIVED: { audience: 'ADMIN', render: (d) => `Customer reported a payment on order ${d.orderNumber}. Check it against the bank or UPI receipt.` },
  PAYMENT_VERIFIED: { audience: 'CUSTOMER', render: (d) => `We have verified your payment for ${d.brand} order ${d.orderNumber}. Thank you.${link(d)}` },
  PROCUREMENT_COMPLETED: { audience: 'ADMIN', render: (d) => `Fruit for order ${d.orderNumber} has been bought and can be packed.` },
  READY_FOR_PICKUP: { audience: 'ADMIN', render: (d) => `Order ${d.orderNumber} is packed and ready for pickup.` },
  RIDER_ASSIGNED: { audience: 'RIDER', render: (d) => `Order ${d.orderNumber} has been assigned to you.` },
  OUT_FOR_DELIVERY: { audience: 'CUSTOMER', render: (d) => `Your ${d.brand} order ${d.orderNumber} is out for delivery.${link(d)}` },
  DELIVERED: { audience: 'CUSTOMER', render: (d) => `Your ${d.brand} order ${d.orderNumber} has been delivered. Thank you for ordering.` },
  DELIVERY_FAILED: { audience: 'ADMIN', render: (d) => `Delivery failed for order ${d.orderNumber}. ${d.reason ?? ''}` },
  ORDER_CANCELLED: { audience: 'CUSTOMER', render: (d) => `Your ${d.brand} order ${d.orderNumber} has been cancelled. ${d.reason ?? ''}` },
  REFUND_RECORDED: { audience: 'CUSTOMER', render: (d) => `A refund of ${d.total} has been recorded for your ${d.brand} order ${d.orderNumber}.` },
}

/** Click-to-chat link that a staff member opens and sends by hand. It does not send anything itself. */
export function whatsappLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '')
  const international = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${international}?text=${encodeURIComponent(message)}`
}
