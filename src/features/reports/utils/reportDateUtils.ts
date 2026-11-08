import type { ComparisonMode, DateRange, ReportPreset } from '../types/report.types'

const zone = 'Asia/Karachi'
export function businessDateKey(date: Date | string) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const value = typeof date === 'string' ? new Date(date) : date
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
function utcDay(key: string) { return new Date(`${key}T12:00:00.000Z`) }
function keyOf(date: Date) { return date.toISOString().slice(0, 10) }
function addDays(key: string, amount: number) { const day = utcDay(key); day.setUTCDate(day.getUTCDate() + amount); return keyOf(day) }
function shiftMonths(key: string, amount: number) { const [year, month, day] = key.split('-').map(Number); const targetMonth = month - 1 + amount; const targetYear = year + Math.floor(targetMonth / 12); const normalizedMonth = (targetMonth % 12 + 12) % 12; const maxDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate(); return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}` }
function startOfWeek(key: string) { const day = utcDay(key).getUTCDay(); return addDays(key, -(day + 6) % 7) }

export function getPresetRange(preset: ReportPreset, now = new Date()): DateRange {
  const today = businessDateKey(now); const current = utcDay(today); const year = current.getUTCFullYear(); const month = current.getUTCMonth()
  switch (preset) {
    case 'today': return { from: today, to: today }
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1) }
    case '7d': return { from: addDays(today, -6), to: today }
    case '30d': return { from: addDays(today, -29), to: today }
    case 'this-week': return { from: startOfWeek(today), to: today }
    case 'last-week': { const end = addDays(startOfWeek(today), -1); return { from: addDays(end, -6), to: end } }
    case 'this-month': return { from: `${year}-${String(month + 1).padStart(2, '0')}-01`, to: today }
    case 'last-month': { const start = new Date(Date.UTC(year, month - 1, 1)); const end = new Date(Date.UTC(year, month, 0)); return { from: keyOf(start), to: keyOf(end) } }
    case 'this-year': return { from: `${year}-01-01`, to: today }
    case 'last-year': return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
    case 'custom': return { from: today, to: today }
  }
}

export function getComparisonRange(current: DateRange, mode: ComparisonMode): DateRange | undefined {
  if (mode === 'none') return undefined
  if (mode === 'previous-month') return { from: shiftMonths(current.from, -1), to: shiftMonths(current.to, -1) }
  if (mode === 'previous-year') return { from: shiftMonths(current.from, -12), to: shiftMonths(current.to, -12) }
  const days = Math.round((utcDay(current.to).getTime() - utcDay(current.from).getTime()) / 86400000) + 1
  return { from: addDays(current.from, -days), to: addDays(current.from, -1) }
}

export function dateInRange(value: string, range: DateRange) { const key = businessDateKey(value); return key >= range.from && key <= range.to }
export function isValidDateRange(range: DateRange) { return Boolean(range.from && range.to && range.from <= range.to) }
export function describeDateRange(range: DateRange) { return `${range.from} – ${range.to}` }
