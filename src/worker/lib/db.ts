type Row = Record<string, string | number | null>

/** Column names always come from code, never user input. Values are always bound parameters. */
export function insert(db: D1Database, table: string, row: Row): D1PreparedStatement {
  const columns = Object.keys(row)
  return db
    .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .bind(...Object.values(row))
}

/** Inserts only while the order is still in the expected status, so a stale request writes nothing. */
export function insertIfOrderStatus(db: D1Database, table: string, row: Row, orderId: string, status: string): D1PreparedStatement {
  const columns = Object.keys(row)
  return db
    .prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) SELECT ${columns.map(() => '?').join(', ')} WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = ?)`,
    )
    .bind(...Object.values(row), orderId, status)
}

export function update(db: D1Database, table: string, set: Row, where: string, ...params: Array<string | number | null>): D1PreparedStatement {
  const columns = Object.keys(set)
  return db
    .prepare(`UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE ${where}`)
    .bind(...Object.values(set), ...params)
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}
