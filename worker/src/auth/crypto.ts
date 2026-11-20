/**
 * Cryptographic utilities for password hashing and secure token generation.
 * Built using the standard Web Crypto API (supported natively in Cloudflare Workers and modern runtimes).
 */

export const DEFAULT_PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH_BITS = 256
const SALT_BYTES = 16

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

/**
 * Constant-time byte array comparison to protect against timing attacks.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

/**
 * Constant-time comparison of two strings via SHA-256 digests.
 * Hashing to fixed 32-byte digests guarantees zero length leakage and timing side-channels.
 */
export async function timingSafeTokenEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  return timingSafeEqual(new Uint8Array(hashA), new Uint8Array(hashB))
}

/**
 * Normalizes a secret or token by trimming whitespace, newlines (\r, \n),
 * and stripping matching surrounding double or single quotes if present.
 */
export function normalizeSecretToken(token: string | null | undefined): string | null {
  if (!token || typeof token !== 'string') {
    return null
  }
  let trimmed = token.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    trimmed = trimmed.slice(1, -1).trim()
  }
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Derives a PBKDF2 key using HMAC-SHA-256.
 */
async function derivePbkdf2Key(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    KEY_LENGTH_BITS
  )
}

/**
 * Hashes a plaintext password using salted PBKDF2 (SHA-256).
 * Format: `pbkdf2:<iterations>:<saltHex>:<hashHex>`
 */
export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS
): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  const saltHex = bufferToHex(salt.buffer)

  const derivedBits = await derivePbkdf2Key(password, salt, iterations)
  const hashHex = bufferToHex(derivedBits)

  return `pbkdf2:${iterations}:${saltHex}:${hashHex}`
}

/**
 * Verifies a plaintext password against a stored PBKDF2 hash using constant-time comparison.
 * Extracts the iteration count directly from the hash string, preserving full backward compatibility.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !storedHash.startsWith('pbkdf2:')) {
    return false
  }

  const parts = storedHash.split(':')
  if (parts.length !== 4) {
    return false
  }

  const iterations = parseInt(parts[1], 10)
  const saltHex = parts[2]
  const expectedHashHex = parts[3]

  if (isNaN(iterations) || iterations <= 0 || !saltHex || !expectedHashHex) {
    return false
  }

  const salt = hexToBuffer(saltHex)
  const expectedHashBytes = hexToBuffer(expectedHashHex)

  const derivedBits = await derivePbkdf2Key(password, salt, iterations)
  const derivedBytes = new Uint8Array(derivedBits)

  return timingSafeEqual(derivedBytes, expectedHashBytes)
}

/**
 * Checks if a stored password hash was generated with fewer iterations than the target work factor.
 */
export function needsRehash(storedHash: string, targetIterations: number = DEFAULT_PBKDF2_ITERATIONS): boolean {
  if (!storedHash || !storedHash.startsWith('pbkdf2:')) {
    return true
  }
  const parts = storedHash.split(':')
  if (parts.length !== 4) return true
  const iterations = parseInt(parts[1], 10)
  if (isNaN(iterations) || iterations < targetIterations) {
    return true
  }
  return false
}

/**
 * Generates a secure random session token.
 */
export function generateSessionToken(): string {
  const randomBytes = new Uint8Array(32)
  crypto.getRandomValues(randomBytes)
  return bufferToHex(randomBytes.buffer)
}

/**
 * Generates a standard UUID v4 string.
 */
export function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Computes a SHA-256 hash of a string in hexadecimal format.
 */
export async function sha256Hex(value: string): Promise<string> {
  const enc = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(value))
  return bufferToHex(hashBuffer)
}
