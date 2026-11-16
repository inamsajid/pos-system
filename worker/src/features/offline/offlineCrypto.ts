/**
 * Cryptographic HMAC signing and verification for Offline Authorization Packages.
 * Uses Web Crypto API natively supported in Cloudflare Workers and Node.js test environment.
 */

function normalizeCanonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCanonical(item))
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const val = (value as Record<string, unknown>)[key]
      if (val !== undefined) {
        sorted[key] = normalizeCanonical(val)
      }
    }
    return sorted
  }
  return value
}

function canonicalStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(normalizeCanonical(obj))
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

export interface OfflineAuthEnvelope {
  authorizationId: string
  businessId: string
  branchId: string
  userId: string
  deviceId: string
  expiresAt: string
  productIds: string[]
}

export interface OfflinePricingSnapshot {
  authorizationId: string
  businessId: string
  branchId: string
  maxTransactions: number
  maxTotalAmountMinor: number
  allowDiscounts: boolean
  taxRateBps: number
  taxInclusive: boolean
  productPrices: Record<string, number>
}

export async function signAuthorizationPayload(
  secret: string,
  payload: OfflineAuthEnvelope
): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const canonicalJson = canonicalStringify(payload as unknown as Record<string, unknown>)
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(canonicalJson))
  return bufferToHex(signatureBuffer)
}

export async function verifyAuthorizationPayload(
  secret: string,
  payload: OfflineAuthEnvelope,
  signatureHex: string
): Promise<boolean> {
  try {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const canonicalJson = canonicalStringify(payload as unknown as Record<string, unknown>)
    const expectedBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(canonicalJson))
    const expectedHex = bufferToHex(expectedBuffer)

    const a = hexToBuffer(expectedHex)
    const b = hexToBuffer(signatureHex)
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function signPricingSnapshot(
  secret: string,
  snapshot: OfflinePricingSnapshot
): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const canonicalJson = canonicalStringify(snapshot as unknown as Record<string, unknown>)
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(canonicalJson))
  return bufferToHex(signatureBuffer)
}

export async function verifyPricingSnapshot(
  secret: string,
  snapshot: OfflinePricingSnapshot,
  signatureHex: string
): Promise<boolean> {
  try {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const canonicalJson = canonicalStringify(snapshot as unknown as Record<string, unknown>)
    const expectedBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(canonicalJson))
    const expectedHex = bufferToHex(expectedBuffer)

    const a = hexToBuffer(expectedHex)
    const b = hexToBuffer(signatureHex)
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

