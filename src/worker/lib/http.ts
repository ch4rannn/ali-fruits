import type { Context } from 'hono'
import type { z } from 'zod'
import type { Role } from '../../shared/permissions'

export type SessionUser = {
  id: string
  name: string
  email: string
  role: Role
  must_change_password: number
  rider_id: string | null
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } }
export type AppContext = Context<AppEnv>

export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 429 | 503,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export const nowIso = () => new Date().toISOString()
export const newId = () => crypto.randomUUID()

export async function parseBody<T extends z.ZodType>(c: AppContext, schema: T): Promise<z.output<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'The request body must be valid JSON.')
  }
  return schema.parse(raw)
}

export function parseQuery<T extends z.ZodType>(c: AppContext, schema: T): z.output<T> {
  return schema.parse(c.req.query())
}

export function pageParams(c: AppContext, defaultSize = 25) {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize')) || defaultSize))
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize }
}

/** Escapes a user search term for use with LIKE ... ESCAPE '\'. */
export function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}

export function clientIp(c: AppContext): string {
  return c.req.header('CF-Connecting-IP') ?? 'unknown'
}

export function siteUrl(c: AppContext): string {
  return c.env.PUBLIC_SITE_URL || new URL(c.req.url).origin
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

export function csvResponse(filename: string, rows: Array<Record<string, unknown>>, columns?: string[]): Response {
  const headers = columns ?? (rows[0] ? Object.keys(rows[0]) : [])
  const lines = [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(','))]
  return new Response(`﻿${lines.join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  // Spreadsheets run cells starting with these characters as formulas.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
