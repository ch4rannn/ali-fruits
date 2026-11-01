// 100,000 is the highest PBKDF2 iteration count the Workers runtime allows.
const ITERATIONS = 100_000
const encoder = new TextEncoder()

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return Array.from(view, (b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(await derive(password, salt, ITERATIONS))}`
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // With no such user, still do the work so response time does not reveal which emails exist.
  const [, iterations, salt, hash] = (stored ?? `pbkdf2$${ITERATIONS}$${'00'.repeat(16)}$${'00'.repeat(32)}`).split('$')
  const derived = await derive(password, fromHex(salt!), Number(iterations))
  return constantTimeEqual(derived, fromHex(hash!)) && stored !== null
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

/** Compares secrets by hash, so neither length nor content leaks through timing. */
export async function secretsMatch(a: string, b: string): Promise<boolean> {
  return constantTimeEqual(fromHex(await sha256Hex(a)), fromHex(await sha256Hex(b)))
}

export function randomToken(byteLength = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(byteLength)))
}

const ORDER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => ORDER_ALPHABET[b % ORDER_ALPHABET.length]).join('')
}

export function randomOtp(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0]!
  return String(value % 10000).padStart(4, '0')
}
