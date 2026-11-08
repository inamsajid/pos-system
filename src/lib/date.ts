export const BUSINESS_TIME_ZONE = 'Asia/Karachi'
const businessDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/** Return a calendar date in the business timezone. Date-only strings are kept as dates, not parsed as UTC instants. */
export function businessDateKey(date: Date | string): string {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const value = typeof date === 'string' ? new Date(date) : date
  if (!Number.isFinite(value.getTime())) return ''
  const parts = businessDateFormatter.formatToParts(value)
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function isInBusinessDateRange(date: Date | string, from?: string, to?: string): boolean {
  const key = businessDateKey(date)
  return Boolean(key && (!from || key >= from) && (!to || key <= to))
}

export function shiftBusinessDate(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function businessMonthStart(key: string): string { return `${key.slice(0, 7)}-01` }

export function formatBusinessDate(date: Date, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat('en-PK', { ...options, timeZone: BUSINESS_TIME_ZONE }).format(date)
}
