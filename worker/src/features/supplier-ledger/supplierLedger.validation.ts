import type { SupplierLedgerFilterParams, SupplierLedgerType } from './supplierLedger.types'

const ALLOWED_TYPES: readonly SupplierLedgerType[] = [
  'opening',
  'bill',
  'payment',
  'debit_note',
  'adjustment',
]

export function parseSupplierLedgerQueryParams(url: URL): SupplierLedgerFilterParams {
  const branchId = url.searchParams.get('branchId') || undefined
  const startDate = url.searchParams.get('startDate') || undefined
  const endDate = url.searchParams.get('endDate') || undefined

  const rawType = url.searchParams.get('type')
  const type =
    rawType && (ALLOWED_TYPES as readonly string[]).includes(rawType)
      ? (rawType as SupplierLedgerType)
      : undefined

  const pageStr = url.searchParams.get('page')
  const page = pageStr && !isNaN(Number(pageStr)) && Number(pageStr) > 0 ? Number(pageStr) : 1

  const limitStr = url.searchParams.get('limit')
  const parsedLimit =
    limitStr && !isNaN(Number(limitStr)) && Number(limitStr) > 0 ? Number(limitStr) : 50
  const limit = Math.min(Math.max(parsedLimit, 1), 200)

  return {
    branchId,
    startDate,
    endDate,
    type,
    page,
    limit,
  }
}

