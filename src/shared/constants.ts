// Labels used by the storefront. Kept apart from schemas.ts so customers do not download the validation library just to read them.

export const AVAILABILITY = ['AVAILABLE', 'UNAVAILABLE', 'SEASONAL', 'TEMPORARILY_UNAVAILABLE'] as const
export type Availability = (typeof AVAILABILITY)[number]
export const AVAILABILITY_LABELS: Record<Availability, string> = {
  AVAILABLE: 'Available',
  UNAVAILABLE: 'Unavailable',
  SEASONAL: 'Out of season',
  TEMPORARILY_UNAVAILABLE: 'Temporarily unavailable',
}

export const TICKET_TYPES = ['ORDER_ENQUIRY', 'CANCELLATION', 'COMPLAINT', 'DAMAGED_PRODUCT', 'MISSING_ITEM', 'REFUND_REQUEST', 'OTHER'] as const
export const TICKET_TYPE_LABELS: Record<(typeof TICKET_TYPES)[number], string> = {
  ORDER_ENQUIRY: 'Order enquiry',
  CANCELLATION: 'Cancellation enquiry',
  COMPLAINT: 'Complaint',
  DAMAGED_PRODUCT: 'Damaged product',
  MISSING_ITEM: 'Missing item',
  REFUND_REQUEST: 'Refund request',
  OTHER: 'Something else',
}
