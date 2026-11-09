import { HttpError } from '../../lib/errors'
import {
  BUSINESS_TIMEZONE,
  getCurrentBusinessDateKey,
  isValidBusinessDateKey,
} from '../../lib/businessDate'

export { BUSINESS_TIMEZONE }

/**
 * Validates and normalizes report date range inputs.
 */
export function validateReportDateRange(
  rawFromDate?: string | null,
  rawToDate?: string | null,
  maxDays = 366
): { fromDate: string; toDate: string } {
  const today = getCurrentBusinessDateKey()

  let fromDate = rawFromDate?.trim()
  let toDate = rawToDate?.trim()

  if (!fromDate && !toDate) {
    // Default to current month-to-date
    const [year, month] = today.split('-')
    fromDate = `${year}-${month}-01`
    toDate = today
  } else if (!fromDate && toDate) {
    fromDate = toDate
  } else if (fromDate && !toDate) {
    toDate = today
  }

  const finalFrom = fromDate || today
  const finalTo = toDate || today

  if (!isValidBusinessDateKey(finalFrom)) {
    throw HttpError.badRequest(
      `Invalid fromDate format: '${finalFrom}'. Must be a valid YYYY-MM-DD calendar date.`
    )
  }

  if (!isValidBusinessDateKey(finalTo)) {
    throw HttpError.badRequest(
      `Invalid toDate format: '${finalTo}'. Must be a valid YYYY-MM-DD calendar date.`
    )
  }

  if (finalFrom > finalTo) {
    throw HttpError.badRequest(
      `Reversed date range: fromDate '${finalFrom}' cannot be after toDate '${finalTo}'.`
    )
  }

  const fromTime = new Date(`${finalFrom}T00:00:00Z`).getTime()
  const toTime = new Date(`${finalTo}T00:00:00Z`).getTime()
  const diffDays = Math.ceil((toTime - fromTime) / (1000 * 60 * 60 * 24))

  if (diffDays > maxDays) {
    throw HttpError.badRequest(
      `Requested date range exceeds maximum allowed window of ${maxDays} days.`
    )
  }

  return { fromDate: finalFrom, toDate: finalTo }
}

/**
 * Escapes cell value to prevent CSV Formula Injection (CWE-1236).
 * Prepends a single quote if the first character is =, +, -, @, Tab, or CR.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '""'
  }

  let text = String(value)

  // CSV Formula Injection mitigation
  const formulaTriggers = ['=', '+', '-', '@', '\t', '\r']
  if (text.length > 0 && formulaTriggers.includes(text[0])) {
    text = `'${text}`
  }

  // Quote wrapping and double-quote escaping
  if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
    text = `"${text.replace(/"/g, '""')}"`
  } else {
    text = `"${text}"`
  }

  return text
}

/**
 * Builds CSV string from tabular headers and rows.
 */
export function buildCsvDocument(
  headers: string[],
  rows: (string | number | null | undefined)[][]
): string {
  const headerLine = headers.map(escapeCsvCell).join(',')
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(','))
  return [headerLine, ...dataLines].join('\r\n')
}
