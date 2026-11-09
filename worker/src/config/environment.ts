import type { Env } from '../types/environment'

export interface AppConfig {
  environment: string
  timezone: string
  serviceName: string
  apiVersion: string
  allowedOrigins: string[]
  pbkdf2Iterations: number
}

export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]

export const DEFAULT_PBKDF2_ITERATIONS = 100_000

export function getAllowedOrigins(env?: Env): string[] {
  const custom = env?.ALLOWED_ORIGINS
  if (custom) {
    const list = custom
      .split(',')
      .map((o) => o.trim().toLowerCase().replace(/\/+$/, ''))
      .filter(Boolean)
    return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...list]))
  }
  return DEFAULT_ALLOWED_ORIGINS
}

export function isOriginAllowed(origin: string | null | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return false
  const canonical = origin.trim().toLowerCase().replace(/\/+$/, '')
  return allowedOrigins.includes(canonical)
}

export function getConfig(env: Env): AppConfig {
  return {
    environment: env.ENVIRONMENT || 'local',
    timezone: env.TIMEZONE || 'Asia/Karachi',
    serviceName: env.SERVICE_NAME || 'pos-system-api',
    apiVersion: env.API_VERSION || 'v1',
    allowedOrigins: getAllowedOrigins(env),
    pbkdf2Iterations: env.PBKDF2_ITERATIONS ? parseInt(env.PBKDF2_ITERATIONS, 10) : DEFAULT_PBKDF2_ITERATIONS,
  }
}
