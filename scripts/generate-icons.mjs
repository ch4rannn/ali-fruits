// Draws the app icons (a citrus fruit with a leaf on forest green) and writes them as PNG files.
// Run with: npm run icons. To use your own logo instead, replace the PNGs in public/icons with your artwork
// at the same sizes (192, 512, 512 maskable, 180).
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const GREEN = [30, 77, 43]
const CITRUS = [242, 194, 48]
const LEAF = [95, 163, 59]
const CREAM = [255, 253, 247]

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buffer) => {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}
const png = (size, pixels) => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// Shapes are described on a 0..1 canvas and anti-aliased by sampling each pixel 4x4 times.
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
const inRoundRect = (x, y, r) => {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0)
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0)
  return dx * dx + dy * dy <= r * r
}
// The overlap of two circles makes a pointed leaf shape.
const inLeaf = (x, y) => inCircle(x, y, 0.5, 0.37, 0.2) && inCircle(x, y, 0.75, 0.15, 0.31)
const inStem = (x, y) => x > 0.485 && x < 0.52 && y > 0.3 && y < 0.43

function color(x, y, scale) {
  const sx = (x - 0.5) / scale + 0.5
  const sy = (y - 0.5) / scale + 0.5
  if (inStem(sx, sy)) return CREAM
  if (inLeaf(sx, sy)) return LEAF
  if (inCircle(sx, sy, 0.5, 0.58, 0.27)) return CITRUS
  return null
}

function render(size, { rounded, scale }) {
  const pixels = Buffer.alloc(size * size * 4)
  const samples = 4
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size
          const y = (py + (sy + 0.5) / samples) / size
          if (rounded && !inRoundRect(x, y, 0.22)) continue
          const [cr, cg, cb] = color(x, y, scale) ?? GREEN
          r += cr
          g += cg
          b += cb
          a += 1
        }
      }
      const i = (py * size + px) * 4
      pixels[i] = a ? Math.round(r / a) : 0
      pixels[i + 1] = a ? Math.round(g / a) : 0
      pixels[i + 2] = a ? Math.round(b / a) : 0
      pixels[i + 3] = Math.round((a / (samples * samples)) * 255)
    }
  }
  return png(size, pixels)
}

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/icons/icon-192.png', render(192, { rounded: true, scale: 1 }))
writeFileSync('public/icons/icon-512.png', render(512, { rounded: true, scale: 1 }))
// Maskable icons are cropped to a circle or squircle by the phone, so the artwork sits in the middle 80%.
writeFileSync('public/icons/maskable-512.png', render(512, { rounded: false, scale: 0.78 }))
writeFileSync('public/icons/apple-touch-icon.png', render(180, { rounded: false, scale: 0.9 }))
console.log('Icons written to public/icons')
