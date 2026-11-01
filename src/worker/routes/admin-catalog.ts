import { Hono } from 'hono'
import { bulkProductUpdate, categoryInput, priceUpdate, productInput } from '../../shared/schemas'
import { istDate } from '../../shared/time'
import { auditStatement } from '../lib/audit'
import { requirePermission } from '../lib/auth'
import { randomCode } from '../lib/crypto'
import { insert, isUniqueViolation, update } from '../lib/db'
import { ApiError, likeTerm, newId, nowIso, parseBody, slugify, type AppEnv } from '../lib/http'

export const adminCatalogRoutes = new Hono<AppEnv>()

async function uniqueSlug(db: D1Database, table: 'products' | 'product_categories', wanted: string, ignoreId?: string): Promise<string> {
  const slug = slugify(wanted) || randomCode(6).toLowerCase()
  const taken = await db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).bind(slug).first<{ id: string }>()
  return taken && taken.id !== ignoreId ? `${slug}-${randomCode(4).toLowerCase()}` : slug
}

// Categories

adminCatalogRoutes.get('/categories', requirePermission('catalog.write'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
     FROM product_categories c ORDER BY c.sort_order, c.name`,
  ).all()
  return c.json({ categories: results })
})

adminCatalogRoutes.post('/categories', requirePermission('catalog.write'), async (c) => {
  const body = await parseBody(c, categoryInput)
  const db = c.env.DB
  const now = nowIso()
  const id = newId()
  await db.batch([
    insert(db, 'product_categories', {
      id,
      name: body.name,
      slug: await uniqueSlug(db, 'product_categories', body.slug || body.name),
      description: body.description,
      image_key: body.imageKey ?? null,
      sort_order: body.sortOrder,
      is_active: body.isActive ? 1 : 0,
      created_at: now,
      updated_at: now,
    }),
    auditStatement(db, c.get('user'), 'CREATE_CATEGORY', 'category', id, { name: body.name }),
  ])
  return c.json({ id }, 201)
})

adminCatalogRoutes.put('/categories/:id', requirePermission('catalog.write'), async (c) => {
  const body = await parseBody(c, categoryInput)
  const db = c.env.DB
  const id = c.req.param('id')
  const [result] = await db.batch([
    update(db, 'product_categories', {
      name: body.name,
      slug: await uniqueSlug(db, 'product_categories', body.slug || body.name, id),
      description: body.description,
      image_key: body.imageKey ?? null,
      sort_order: body.sortOrder,
      is_active: body.isActive ? 1 : 0,
      updated_at: nowIso(),
    }, 'id = ?', id),
    auditStatement(db, c.get('user'), 'UPDATE_CATEGORY', 'category', id, { name: body.name }),
  ])
  if (!result!.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Category not found.')
  return c.json({ ok: true })
})

adminCatalogRoutes.delete('/categories/:id', requirePermission('catalog.write'), async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const used = await db.prepare('SELECT 1 FROM products WHERE category_id = ? LIMIT 1').bind(id).first()
  if (used) throw new ApiError(409, 'CATEGORY_IN_USE', 'Move or archive the products in this category first, or hide the category instead.')
  await db.batch([
    db.prepare('DELETE FROM product_categories WHERE id = ?').bind(id),
    auditStatement(db, c.get('user'), 'DELETE_CATEGORY', 'category', id),
  ])
  return c.json({ ok: true })
})

// Products

adminCatalogRoutes.get('/products', requirePermission('orders.read', 'catalog.write'), async (c) => {
  const db = c.env.DB
  const { q, categoryId, archived } = c.req.query()
  const where = [archived === '1' ? 'p.is_active = 0' : 'p.is_active = 1']
  const params: string[] = []
  if (q?.trim()) {
    where.push("p.name LIKE ? ESCAPE '\\'")
    params.push(likeTerm(q.trim()))
  }
  if (categoryId) {
    where.push('p.category_id = ?')
    params.push(categoryId)
  }
  const [products, variants, images] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT p.*, c.name AS category_name FROM products p JOIN product_categories c ON c.id = p.category_id
         WHERE ${where.join(' AND ')} ORDER BY p.display_priority DESC, p.name LIMIT 500`,
      )
      .bind(...params),
    db.prepare('SELECT id, product_id, label, unit_kind, unit_size, retail_price_paise, min_qty, qty_step, is_active, sort_order FROM product_variants ORDER BY sort_order'),
    db.prepare('SELECT product_id, object_key, alt FROM product_images ORDER BY sort_order'),
  ])
  const variantRows = variants!.results as Array<{ product_id: string }>
  const imageRows = images!.results as Array<{ product_id: string }>
  return c.json({
    products: (products!.results as Array<{ id: string }>).map((product) => ({
      ...product,
      variants: variantRows.filter((v) => v.product_id === product.id),
      images: imageRows.filter((i) => i.product_id === product.id),
    })),
  })
})

adminCatalogRoutes.get('/products/:id', requirePermission('catalog.write'), async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const [product, variants, images] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT * FROM products WHERE id = ?').bind(id),
    db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order').bind(id),
    db.prepare('SELECT object_key, alt FROM product_images WHERE product_id = ? ORDER BY sort_order').bind(id),
  ])
  if (!product!.results[0]) throw new ApiError(404, 'NOT_FOUND', 'Product not found.')
  return c.json({ product: product!.results[0], variants: variants!.results, images: images!.results })
})

adminCatalogRoutes.post('/products', requirePermission('catalog.write'), async (c) => {
  const body = await parseBody(c, productInput)
  const db = c.env.DB
  const user = c.get('user')
  const now = nowIso()
  const id = newId()
  const statements = [
    insert(db, 'products', {
      id,
      category_id: body.categoryId,
      name: body.name,
      slug: await uniqueSlug(db, 'products', body.slug || body.name),
      description: body.description,
      availability: body.availability,
      is_featured: body.isFeatured ? 1 : 0,
      is_seasonal: body.isSeasonal ? 1 : 0,
      is_combo: body.isCombo ? 1 : 0,
      display_priority: body.displayPriority,
      is_active: body.isActive ? 1 : 0,
      created_at: now,
      updated_at: now,
    }),
  ]
  body.variants.forEach((variant, index) => {
    const variantId = newId()
    statements.push(
      insert(db, 'product_variants', {
        id: variantId,
        product_id: id,
        label: variant.label,
        unit_kind: variant.unitKind,
        unit_size: variant.unitSize,
        retail_price_paise: variant.retailPricePaise,
        wholesale_price_paise: variant.wholesalePricePaise ?? null,
        min_qty: variant.minQty,
        qty_step: variant.qtyStep,
        is_active: variant.isActive ? 1 : 0,
        sort_order: index,
        created_at: now,
        updated_at: now,
      }),
      priceHistory(db, variantId, variant.retailPricePaise, variant.wholesalePricePaise ?? null, istDate(), 'Initial price', user.id),
    )
  })
  body.images.forEach((image, index) => {
    statements.push(insert(db, 'product_images', { id: newId(), product_id: id, object_key: image.key, alt: image.alt || body.name, sort_order: index }))
  })
  statements.push(auditStatement(db, user, 'CREATE_PRODUCT', 'product', id, { name: body.name }))
  await db.batch(statements)
  return c.json({ id }, 201)
})

function priceHistory(db: D1Database, variantId: string, retail: number, wholesale: number | null, effectiveDate: string, note: string, userId: string) {
  return insert(db, 'product_price_history', {
    id: newId(),
    variant_id: variantId,
    retail_price_paise: retail,
    wholesale_price_paise: wholesale,
    effective_date: effectiveDate,
    note,
    updated_by: userId,
    created_at: nowIso(),
  })
}

adminCatalogRoutes.put('/products/:id', requirePermission('catalog.write'), async (c) => {
  const body = await parseBody(c, productInput)
  const db = c.env.DB
  const user = c.get('user')
  const id = c.req.param('id')
  const now = nowIso()
  const current = await db.prepare('SELECT id FROM products WHERE id = ?').bind(id).first()
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Product not found.')
  const { results: oldVariants } = await db
    .prepare('SELECT id, retail_price_paise, wholesale_price_paise FROM product_variants WHERE product_id = ?')
    .bind(id)
    .all<{ id: string; retail_price_paise: number; wholesale_price_paise: number | null }>()
  const oldById = new Map(oldVariants.map((v) => [v.id, v]))

  const statements = [
    update(db, 'products', {
      category_id: body.categoryId,
      name: body.name,
      slug: await uniqueSlug(db, 'products', body.slug || body.name, id),
      description: body.description,
      availability: body.availability,
      is_featured: body.isFeatured ? 1 : 0,
      is_seasonal: body.isSeasonal ? 1 : 0,
      is_combo: body.isCombo ? 1 : 0,
      display_priority: body.displayPriority,
      is_active: body.isActive ? 1 : 0,
      updated_at: now,
    }, 'id = ?', id),
  ]
  const kept = new Set<string>()
  body.variants.forEach((variant, index) => {
    const old = variant.id ? oldById.get(variant.id) : undefined
    if (variant.id && !old) throw new ApiError(422, 'UNKNOWN_VARIANT', 'One of the selling units does not belong to this product.')
    const wholesale = variant.wholesalePricePaise === undefined ? (old?.wholesale_price_paise ?? null) : variant.wholesalePricePaise
    const variantId = old?.id ?? newId()
    kept.add(variantId)
    const fields = {
      label: variant.label,
      unit_kind: variant.unitKind,
      unit_size: variant.unitSize,
      retail_price_paise: variant.retailPricePaise,
      wholesale_price_paise: wholesale,
      min_qty: variant.minQty,
      qty_step: variant.qtyStep,
      is_active: variant.isActive ? 1 : 0,
      sort_order: index,
      updated_at: now,
    }
    statements.push(old ? update(db, 'product_variants', fields, 'id = ?', variantId) : insert(db, 'product_variants', { id: variantId, product_id: id, created_at: now, ...fields }))
    if (!old || old.retail_price_paise !== variant.retailPricePaise || old.wholesale_price_paise !== wholesale) {
      statements.push(priceHistory(db, variantId, variant.retailPricePaise, wholesale, istDate(), 'Edited on product page', user.id))
    }
  })
  // Past orders reference old units, so a removed unit is hidden rather than deleted.
  for (const old of oldVariants) {
    if (!kept.has(old.id)) statements.push(update(db, 'product_variants', { is_active: 0, updated_at: now }, 'id = ?', old.id))
  }
  statements.push(db.prepare('DELETE FROM product_images WHERE product_id = ?').bind(id))
  body.images.forEach((image, index) => {
    statements.push(insert(db, 'product_images', { id: newId(), product_id: id, object_key: image.key, alt: image.alt || body.name, sort_order: index }))
  })
  statements.push(auditStatement(db, user, 'UPDATE_PRODUCT', 'product', id, { name: body.name }))
  try {
    await db.batch(statements)
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'SLUG_TAKEN', 'Another product already uses that web address.')
    throw error
  }
  return c.json({ ok: true })
})

adminCatalogRoutes.post('/products/:id/archive', requirePermission('catalog.write'), async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  await db.batch([
    update(db, 'products', { is_active: 0, updated_at: nowIso() }, 'id = ?', id),
    auditStatement(db, c.get('user'), 'ARCHIVE_PRODUCT', 'product', id),
  ])
  return c.json({ ok: true })
})

adminCatalogRoutes.post('/products/bulk', requirePermission('catalog.write'), async (c) => {
  const body = await parseBody(c, bulkProductUpdate)
  const db = c.env.DB
  const set: Record<string, string | number> = { updated_at: nowIso() }
  if (body.availability) set.availability = body.availability
  if (body.isFeatured !== undefined) set.is_featured = body.isFeatured ? 1 : 0
  if (body.isActive !== undefined) set.is_active = body.isActive ? 1 : 0
  if (body.categoryId) set.category_id = body.categoryId
  if (Object.keys(set).length === 1) throw new ApiError(422, 'NOTHING_TO_CHANGE', 'Choose what to change.')
  await db.batch([
    update(db, 'products', set, 'id IN (SELECT value FROM json_each(?))', JSON.stringify(body.productIds)),
    auditStatement(db, c.get('user'), 'BULK_UPDATE_PRODUCTS', 'product', '', { count: body.productIds.length, set }),
  ])
  return c.json({ ok: true })
})

// Daily pricing. Wholesale prices are only served from these staff routes.

adminCatalogRoutes.get('/pricing', requirePermission('pricing.write'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT v.id AS variant_id, v.label, v.retail_price_paise, v.wholesale_price_paise, v.updated_at,
            p.id AS product_id, p.name AS product_name, p.availability, c.name AS category_name,
            (SELECT u.name FROM product_price_history h LEFT JOIN users u ON u.id = h.updated_by WHERE h.variant_id = v.id ORDER BY h.created_at DESC LIMIT 1) AS updated_by,
            (SELECT h.effective_date FROM product_price_history h WHERE h.variant_id = v.id ORDER BY h.created_at DESC LIMIT 1) AS effective_date
     FROM product_variants v JOIN products p ON p.id = v.product_id JOIN product_categories c ON c.id = p.category_id
     WHERE v.is_active = 1 AND p.is_active = 1 ORDER BY c.sort_order, p.name, v.sort_order`,
  ).all()
  return c.json({ prices: results })
})

adminCatalogRoutes.post('/pricing', requirePermission('pricing.write'), async (c) => {
  const body = await parseBody(c, priceUpdate)
  const db = c.env.DB
  const user = c.get('user')
  const now = nowIso()
  const effectiveDate = body.effectiveDate ?? istDate()
  const statements: D1PreparedStatement[] = []
  const { results: existing } = await db
    .prepare('SELECT id, wholesale_price_paise FROM product_variants WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(body.prices.map((price) => price.variantId)))
    .all<{ id: string; wholesale_price_paise: number | null }>()
  const byId = new Map(existing.map((row) => [row.id, row]))
  for (const price of body.prices) {
    const row = byId.get(price.variantId)
    if (!row) throw new ApiError(422, 'UNKNOWN_VARIANT', 'One of the prices is for a unit that no longer exists.')
    const wholesale = price.wholesalePricePaise === undefined ? row.wholesale_price_paise : price.wholesalePricePaise
    statements.push(
      update(db, 'product_variants', { retail_price_paise: price.retailPricePaise, wholesale_price_paise: wholesale, updated_at: now }, 'id = ?', price.variantId),
      priceHistory(db, price.variantId, price.retailPricePaise, wholesale, effectiveDate, body.note, user.id),
    )
  }
  statements.push(auditStatement(db, user, 'UPDATE_PRICES', 'pricing', '', { count: body.prices.length, effectiveDate }))
  await db.batch(statements)
  return c.json({ ok: true })
})

adminCatalogRoutes.get('/pricing/:variantId/history', requirePermission('pricing.write'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT h.*, u.name AS updated_by_name FROM product_price_history h LEFT JOIN users u ON u.id = h.updated_by
     WHERE h.variant_id = ? ORDER BY h.created_at DESC LIMIT 60`,
  )
    .bind(c.req.param('variantId'))
    .all()
  return c.json({ history: results })
})
