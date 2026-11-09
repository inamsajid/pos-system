export const BUSINESS_TIMEZONE = 'Asia/Karachi'
export const BUSINESS_TIME_ZONE = BUSINESS_TIMEZONE

const businessFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Validates whether a YYYY-MM-DD string represents a genuine calendar date.
 */
function isValidDateParts(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 9999) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  const check = new Date(Date.UTC(year, month - 1, day))
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  )
}

/**
 * Converts a Date, ISO timestamp, or date-only string to a canonical YYYY-MM-DD
 * business date in the Asia/Karachi timezone.
 *
 * Rules:
 * 1. Date-only strings ('YYYY-MM-DD') represent business dates and are preserved directly.
 * 2. Timestamps (UTC or offset) are converted to the calendar date in Asia/Karachi.
 * 3. Invalid or empty dates return null.
 */
export function toBusinessDateKey(value: string | Date | null | undefined): string | null {
  if (!value) return null

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    // Date-only format: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [y, m, d] = trimmed.split('-').map(Number)
      return isValidDateParts(y, m, d) ? trimmed : null
    }

    const date = new Date(trimmed)
    if (!Number.isFinite(date.getTime())) return null
    return formatToKarachiKey(date)
  }

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null
    return formatToKarachiKey(value)
  }

  return null
}

function formatToKarachiKey(date: Date): string {
  const parts = businessFormatter.formatToParts(date)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/**
 * Tests whether a transaction date/timestamp falls within the inclusive [startDate, endDate]
 * business date range in Asia/Karachi.
 */
export function isWithinBusinessDateRange(
  value: string | Date | null | undefined,
  startDate?: string | null,
  endDate?: string | null
): boolean {
  const key = toBusinessDateKey(value)
  if (!key) return false

  if (startDate) {
    const startKey = toBusinessDateKey(startDate)
    if (startKey && key < startKey) return false
  }

  if (endDate) {
    const endKey = toBusinessDateKey(endDate)
    if (endKey && key > endKey) return false
  }

  return true
}

/**
 * Returns a normalized business date range.
 */
export function getBusinessDateRange(
  startDate?: string | null,
  endDate?: string | null
): { startDate: string; endDate: string } {
  const today = toBusinessDateKey(new Date()) ?? '2026-11-08'
  const start = toBusinessDateKey(startDate) ?? today
  const end = toBusinessDateKey(endDate) ?? today
  return { startDate: start, endDate: end }
}

/**
 * Helper to add or subtract calendar days to a YYYY-MM-DD business date.
 */
export function shiftBusinessDate(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Helper to shift calendar months for comparison ranges.
 */
export function shiftBusinessMonths(key: string, months: number): string {
  const [year, month, day] = key.split('-').map(Number)
  const targetMonthIndex = month - 1 + months
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12
  const maxDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  const resultMonth = String(normalizedMonth + 1).padStart(2, '0')
  const resultDay = String(Math.min(day, maxDay)).padStart(2, '0')
  return `${targetYear}-${resultMonth}-${resultDay}`
}

/**
 * Return YYYY-MM month key in Asia/Karachi.
 */
export function getBusinessMonthKey(value: string | Date | null | undefined): string | null {
  const key = toBusinessDateKey(value)
  return key ? key.slice(0, 7) : null
}

/**
 * Resolves standard date range presets in Asia/Karachi.
 */
export function getBusinessDatePreset(
  preset: string,
  now = new Date()
): { from: string; to: string } {
  const today = toBusinessDateKey(now) ?? '2026-11-08'
  const [yearStr, monthStr] = today.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)

  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const yesterday = shiftBusinessDate(today, -1)
      return { from: yesterday, to: yesterday }
    }
    case '7':
    case '7d':
      return { from: shiftBusinessDate(today, -6), to: today }
    case '30':
    case '30d':
      return { from: shiftBusinessDate(today, -29), to: today }
    case 'month':
    case 'this-month':
      return { from: `${yearStr}-${monthStr}-01`, to: today }
    case 'last-month': {
      const start = new Date(Date.UTC(year, month - 2, 1))
      const end = new Date(Date.UTC(year, month - 1, 0))
      const from = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`
      const to = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`
      return { from, to }
    }
    case 'this-year':
      return { from: `${yearStr}-01-01`, to: today }
    case 'last-year':
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
    case 'all':
    default:
      return { from: '', to: '' }
  }
}

/**
 * Formats a date for display in the Pakistan business locale (en-PK, Asia/Karachi).
 */
export function formatBusinessDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  const resolvedDate = typeof date === 'string' ? new Date(date) : date
  if (!Number.isFinite(resolvedDate.getTime())) return '—'
  return new Intl.DateTimeFormat('en-PK', {
    ...options,
    timeZone: BUSINESS_TIMEZONE,
  }).format(resolvedDate)
}

// Backward-compatible alias for existing imports
export const businessDateKey = (date: Date | string) => toBusinessDateKey(date) ?? ''
export const isInBusinessDateRange = isWithinBusinessDateRange
export const businessMonthStart = (key: string) => `${key.slice(0, 7)}-01`

