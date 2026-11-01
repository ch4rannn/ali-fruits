import { insert } from './db'
import { newId, nowIso, type SessionUser } from './http'

export function auditStatement(
  db: D1Database,
  actor: Pick<SessionUser, 'id' | 'name'> | null,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
): D1PreparedStatement {
  return insert(db, 'audit_logs', {
    id: newId(),
    actor_user_id: actor?.id ?? null,
    actor_label: actor?.name ?? 'System',
    action,
    entity_type: entityType,
    entity_id: entityId,
    details_json: JSON.stringify(details),
    created_at: nowIso(),
  })
}
