export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'DELIVERY_MANAGER', 'FINANCE', 'RIDER'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Admin',
  OPERATIONS: 'Operations',
  DELIVERY_MANAGER: 'Delivery manager',
  FINANCE: 'Finance',
  RIDER: 'Rider',
}

export type Permission =
  | 'dashboard.read'
  | 'orders.read'
  | 'orders.write'
  | 'catalog.write'
  | 'costs.read'
  | 'pricing.write'
  | 'procurement.write'
  | 'customers.read'
  | 'customers.write'
  | 'customers.export'
  | 'riders.manage'
  | 'deliveries.manage'
  | 'payments.read'
  | 'payments.write'
  | 'expenses.write'
  | 'reports.read'
  | 'staff.manage'
  | 'zones.manage'
  | 'settings.read'
  | 'settings.write'
  | 'golive.manage'
  | 'audit.read'
  | 'support.manage'

const ALL_ADMIN: Permission[] = [
  'dashboard.read', 'orders.read', 'orders.write', 'catalog.write', 'costs.read', 'pricing.write',
  'procurement.write', 'customers.read', 'customers.write', 'customers.export', 'riders.manage',
  'deliveries.manage', 'payments.read', 'payments.write', 'expenses.write', 'reports.read', 'zones.manage',
  'settings.read', 'settings.write', 'audit.read', 'support.manage',
]

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [...ALL_ADMIN, 'staff.manage', 'golive.manage'],
  ADMIN: ALL_ADMIN,
  OPERATIONS: ['dashboard.read', 'orders.read', 'orders.write', 'catalog.write', 'costs.read', 'pricing.write', 'procurement.write', 'customers.read', 'support.manage'],
  DELIVERY_MANAGER: ['dashboard.read', 'orders.read', 'riders.manage', 'deliveries.manage', 'zones.manage', 'support.manage'],
  FINANCE: ['dashboard.read', 'orders.read', 'costs.read', 'customers.read', 'customers.export', 'payments.read', 'payments.write', 'expenses.write', 'reports.read'],
  RIDER: [],
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}
