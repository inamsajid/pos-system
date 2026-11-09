import type { ComparisonMode, DateRange, ReportPreset } from '../types/report.types'
import {
  toBusinessDateKey,
  shiftBusinessDate,
  shiftBusinessMonths,
  isWithinBusinessDateRange,
  getBusinessDatePreset,
} from '../../../lib/businessDate'

export function businessDateKey(date: Date | string): string {
  return toBusinessDateKey(date) ?? ''
}

function startOfWeek(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return shiftBusinessDate(key, -((dayOfWeek + 6) % 7))
}

export function getPresetRange(preset: ReportPreset, now = new Date()): DateRange {
  if (preset === 'this-week') {
    const today = businessDateKey(now)
    return { from: startOfWeek(today), to: today }
  }
  if (preset === 'last-week') {
    const today = businessDateKey(now)
    const end = shiftBusinessDate(startOfWeek(today), -1)
    return { from: shiftBusinessDate(end, -6), to: end }
  }
  if (preset === 'custom') {
    const today = businessDateKey(now)
    return { from: today, to: today }
  }
  const result = getBusinessDatePreset(preset, now)
  return { from: result.from, to: result.to }
}

export function getComparisonRange(current: DateRange, mode: ComparisonMode): DateRange | undefined {
  if (mode === 'none') return undefined
  if (mode === 'previous-month') {
    return { from: shiftBusinessMonths(current.from, -1), to: shiftBusinessMonths(current.to, -1) }
  }
  if (mode === 'previous-year') {
    return { from: shiftBusinessMonths(current.from, -12), to: shiftBusinessMonths(current.to, -12) }
  }
  const [y1, m1, d1] = current.from.split('-').map(Number)
  const [y2, m2, d2] = current.to.split('-').map(Number)
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1
  return { from: shiftBusinessDate(current.from, -days), to: shiftBusinessDate(current.from, -1) }
}

export function dateInRange(value: string | Date | null | undefined, range: DateRange): boolean {
  return isWithinBusinessDateRange(value, range.from, range.to)
}

export function isValidDateRange(range: DateRange): boolean {
  return Boolean(range.from && range.to && range.from <= range.to)
}

export function describeDateRange(range: DateRange): string {
  return `${range.from} – ${range.to}`
}
