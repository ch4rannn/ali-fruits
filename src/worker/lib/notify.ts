import { formatINR } from '../../shared/money'
import { NOTIFICATION_TEMPLATES, type NotificationEvent, type TemplateData } from '../../shared/notifications'
import { insert } from './db'
import { newId, nowIso } from './http'

type OrderLike = {
  id: string
  order_number: string
  customer_name: string
  total_paise?: number
  tracking_token: string
}

export type NotifyContext = { db: D1Database; brand: string; baseUrl: string }

export function trackingUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/order/${token}`
}

export function renderMessage(ctx: Pick<NotifyContext, 'brand' | 'baseUrl'>, event: NotificationEvent, order: OrderLike, extra: Partial<TemplateData> = {}): string {
  return NOTIFICATION_TEMPLATES[event].render({
    brand: ctx.brand,
    orderNumber: order.order_number,
    customerName: order.customer_name,
    total: order.total_paise === undefined ? undefined : formatINR(order.total_paise),
    trackingUrl: trackingUrl(ctx.baseUrl, order.tracking_token),
    ...extra,
  })
}

/**
 * Records a notification. No external message is ever sent from here: staff see customer messages
 * in the order page and open a prefilled WhatsApp chat themselves. An official WhatsApp or email
 * provider can later be added as another channel once real credentials exist.
 */
export function notifyStatement(ctx: NotifyContext, event: NotificationEvent, order: OrderLike, extra: Partial<TemplateData> & { riderId?: string } = {}): D1PreparedStatement {
  const template = NOTIFICATION_TEMPLATES[event]
  return insert(ctx.db, 'notification_logs', {
    id: newId(),
    event,
    audience: template.audience,
    channel: template.audience === 'CUSTOMER' ? 'MANUAL_LINK' : 'DASHBOARD',
    status: 'STORED',
    order_id: order.id,
    rider_id: extra.riderId ?? null,
    body: renderMessage(ctx, event, order, extra),
    created_at: nowIso(),
  })
}

/** Shown in Business settings so nobody assumes automated messages are going out. */
export function integrationStatus() {
  return {
    whatsappCloudApi: { status: 'NOT_CONFIGURED', note: 'Messages are prepared for staff to send through click-to-chat. Nothing is sent automatically.' },
    email: { status: 'NOT_CONFIGURED', note: 'No email provider is connected, so no emails are sent.' },
    paymentGateway: { status: 'NOT_CONFIGURED', note: 'Payments are manual UPI or cash on delivery, verified by staff.' },
    thirdPartyDelivery: { status: 'MANUAL', note: 'Bookings are made in the provider’s own app and recorded here by hand.' },
  }
}
