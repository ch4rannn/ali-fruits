export const ORDER_STATUSES = [
  'PENDING_REVIEW',
  'AWAITING_CUSTOMER_APPROVAL',
  'CONFIRMED',
  'PROCUREMENT_IN_PROGRESS',
  'PROCUREMENT_COMPLETED',
  'PACKING',
  'READY_FOR_PICKUP',
  'ASSIGNED_TO_RIDER',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
  'FAILED_DELIVERY',
  'REFUND_PENDING',
  'REFUNDED',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export type ActorKind = 'customer' | 'staff' | 'rider'

type Rule = { to: OrderStatus; by: ActorKind[] }

const staff: ActorKind[] = ['staff']
const staffOrRider: ActorKind[] = ['staff', 'rider']
const staffOrCustomer: ActorKind[] = ['staff', 'customer']

/**
 * The only legal order movements. Procurement can only be reached through CONFIRMED,
 * and CONFIRMED can only be reached from AWAITING_CUSTOMER_APPROVAL. That is what
 * enforces the zero-inventory rule: nothing is bought before the customer has approved.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, Rule[]> = {
  PENDING_REVIEW: [
    { to: 'AWAITING_CUSTOMER_APPROVAL', by: staff },
    { to: 'REJECTED', by: staff },
    { to: 'CANCELLED', by: staffOrCustomer },
  ],
  AWAITING_CUSTOMER_APPROVAL: [
    { to: 'CONFIRMED', by: staffOrCustomer },
    { to: 'REJECTED', by: staffOrCustomer },
    { to: 'PENDING_REVIEW', by: staffOrCustomer },
    { to: 'CANCELLED', by: staffOrCustomer },
  ],
  CONFIRMED: [
    { to: 'PROCUREMENT_IN_PROGRESS', by: staff },
    { to: 'CANCELLED', by: staffOrCustomer },
  ],
  PROCUREMENT_IN_PROGRESS: [
    { to: 'PROCUREMENT_COMPLETED', by: staff },
    { to: 'CANCELLED', by: staff },
  ],
  PROCUREMENT_COMPLETED: [
    { to: 'PACKING', by: staff },
    { to: 'CANCELLED', by: staff },
  ],
  PACKING: [
    { to: 'READY_FOR_PICKUP', by: staff },
    { to: 'CANCELLED', by: staff },
  ],
  READY_FOR_PICKUP: [
    { to: 'ASSIGNED_TO_RIDER', by: staff },
    { to: 'CANCELLED', by: staff },
  ],
  ASSIGNED_TO_RIDER: [
    { to: 'PICKED_UP', by: staffOrRider },
    { to: 'READY_FOR_PICKUP', by: staffOrRider },
    { to: 'CANCELLED', by: staff },
  ],
  PICKED_UP: [
    { to: 'OUT_FOR_DELIVERY', by: staffOrRider },
    { to: 'FAILED_DELIVERY', by: staffOrRider },
  ],
  OUT_FOR_DELIVERY: [
    { to: 'DELIVERED', by: staffOrRider },
    { to: 'FAILED_DELIVERY', by: staffOrRider },
  ],
  DELIVERED: [{ to: 'REFUND_PENDING', by: staff }],
  REJECTED: [],
  CANCELLED: [{ to: 'REFUND_PENDING', by: staff }],
  FAILED_DELIVERY: [
    { to: 'READY_FOR_PICKUP', by: staff },
    { to: 'CANCELLED', by: staff },
    { to: 'REFUND_PENDING', by: staff },
  ],
  REFUND_PENDING: [{ to: 'REFUNDED', by: staff }],
  REFUNDED: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus, actor: ActorKind): boolean {
  return ORDER_TRANSITIONS[from].some((rule) => rule.to === to && rule.by.includes(actor))
}

export function nextStatuses(from: OrderStatus, actor: ActorKind): OrderStatus[] {
  return ORDER_TRANSITIONS[from].filter((rule) => rule.by.includes(actor)).map((rule) => rule.to)
}

/** Statuses that end active work. Used to date an order's revenue and costs in reports. */
export const SETTLED_STATUSES: OrderStatus[] = ['DELIVERED', 'REJECTED', 'CANCELLED', 'FAILED_DELIVERY']

/** Procurement records may only exist from these statuses onward. */
export const PROCUREMENT_RECORDING_STATUSES: OrderStatus[] = ['PROCUREMENT_IN_PROGRESS', 'PROCUREMENT_COMPLETED']

export const CUSTOMER_CANCELLABLE: OrderStatus[] = ['PENDING_REVIEW', 'AWAITING_CUSTOMER_APPROVAL', 'CONFIRMED']

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_REVIEW: 'Pending review',
  AWAITING_CUSTOMER_APPROVAL: 'Awaiting customer approval',
  CONFIRMED: 'Confirmed',
  PROCUREMENT_IN_PROGRESS: 'Buying fruit',
  PROCUREMENT_COMPLETED: 'Fruit bought',
  PACKING: 'Packing',
  READY_FOR_PICKUP: 'Ready for pickup',
  ASSIGNED_TO_RIDER: 'Assigned for delivery',
  PICKED_UP: 'Picked up',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  FAILED_DELIVERY: 'Delivery failed',
  REFUND_PENDING: 'Refund pending',
  REFUNDED: 'Refunded',
}

/** What the customer reads. Several internal stages collapse into one customer-facing step. */
export const CUSTOMER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_REVIEW: 'Checking availability and prices',
  AWAITING_CUSTOMER_APPROVAL: 'Waiting for your approval',
  CONFIRMED: 'Order confirmed',
  PROCUREMENT_IN_PROGRESS: 'Selecting your fruit',
  PROCUREMENT_COMPLETED: 'Selecting your fruit',
  PACKING: 'Weighing and packing',
  READY_FOR_PICKUP: 'Packed, waiting for pickup',
  ASSIGNED_TO_RIDER: 'Packed, waiting for pickup',
  PICKED_UP: 'On its way',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  REJECTED: 'Order not accepted',
  CANCELLED: 'Cancelled',
  FAILED_DELIVERY: 'Delivery attempt failed',
  REFUND_PENDING: 'Refund in progress',
  REFUNDED: 'Refunded',
}
