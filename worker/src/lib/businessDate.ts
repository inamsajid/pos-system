export const BUSINESS_TIMEZONE = 'Asia/Karachi'

const karachiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Returns canonical YYYY-MM-DD date key in Asia/Karachi timezone.
 */
export function getCurrentBusinessDateKey(date: Date = new Date()): string {
  return karachiDateFormatter.format(date)
}

/**
 * Validates whether a string is a valid YYYY-MM-DD date.
 */
export function isValidBusinessDateKey(dateKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false
  const [year, month, day] = dateKey.split('-').map(Number)
  if (year < 2000 || year > 2100) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  const check = new Date(Date.UTC(year, month - 1, day))
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  )
}

