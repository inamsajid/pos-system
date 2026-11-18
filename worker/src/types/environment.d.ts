export interface Env {
  DB: D1Database
  FILES: R2Bucket
  ENVIRONMENT?: string
  TIMEZONE?: string
  SERVICE_NAME?: string
  API_VERSION?: string
  AUTH_SECRET?: string
  ALLOWED_ORIGINS?: string
  PBKDF2_ITERATIONS?: string
  BOOTSTRAP_TOKEN?: string
}
