import { Hono } from 'hono'
import { z } from 'zod'
import { auditStatement } from '../lib/audit'
import { requirePermission } from '../lib/auth'
import { ApiError, type AppEnv } from '../lib/http'

const MAX_BYTES = 5 * 1024 * 1024
const FOLDERS = ['products', 'categories', 'branding', 'promotions'] as const
const uploadFolder = z.enum(FOLDERS)

/** Trusts the file's actual first bytes, not the name or type the browser claims. SVG is refused because it can carry scripts. */
function detectImage(bytes: Uint8Array): { type: string; ext: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: 'image/png', ext: 'png' }
  const text = String.fromCharCode(...bytes.subarray(0, 12))
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' }
  return null
}

export const adminUploadRoutes = new Hono<AppEnv>()

adminUploadRoutes.post('/', requirePermission('catalog.write', 'settings.write'), async (c) => {
  const length = Number(c.req.header('Content-Length') ?? 0)
  if (length > MAX_BYTES + 4096) throw new ApiError(413, 'FILE_TOO_LARGE', 'Images must be 5 MB or smaller.')
  const form = await c.req.formData()
  const folder = uploadFolder.safeParse(form.get('folder'))
  if (!folder.success) throw new ApiError(422, 'INVALID_FOLDER', 'Choose a valid upload type.')
  const file = form.get('file')
  if (!(file instanceof File)) throw new ApiError(422, 'FILE_REQUIRED', 'Choose an image to upload.')
  if (file.size > MAX_BYTES) throw new ApiError(413, 'FILE_TOO_LARGE', 'Images must be 5 MB or smaller.')
  const buffer = await file.arrayBuffer()
  const image = detectImage(new Uint8Array(buffer))
  if (!image) throw new ApiError(415, 'UNSUPPORTED_FILE', 'Upload a JPEG, PNG or WebP image.')
  const key = `${folder.data}/${crypto.randomUUID()}.${image.ext}`
  try {
    await c.env.BUCKET.put(key, buffer, { httpMetadata: { contentType: image.type, cacheControl: 'public, max-age=31536000, immutable' } })
  } catch (error) {
    console.error(JSON.stringify({ event: 'r2_upload_failed', message: error instanceof Error ? error.message : String(error) }))
    throw new ApiError(503, 'UPLOAD_FAILED', 'The image could not be saved. Please try again.')
  }
  await auditStatement(c.env.DB, c.get('user'), 'UPLOAD_IMAGE', 'media', key).run()
  return c.json({ key, url: `/media/${key}` }, 201)
})

export const mediaRoutes = new Hono<AppEnv>()

/** Serves only the public folders. Keys are random, so files can be cached permanently. */
mediaRoutes.get('/*', async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/media\//, ''))
  if (!/^(products|categories|branding|promotions)\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) return c.notFound()
  const object = await c.env.BUCKET.get(key)
  if (!object) return c.notFound()
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(object.body, { headers })
})
