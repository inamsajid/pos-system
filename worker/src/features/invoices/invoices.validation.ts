import type { InvoiceFilterParams } from './invoices.types'

export function parseInvoiceQueryParams(url: URL): InvoiceFilterParams {
  const branchId = url.searchParams.get('branchId') || undefined
  const customerId = url.searchParams.get('customerId') || undefined

  const rawPaymentStatus = url.searchParams.get('paymentStatus')
  const paymentStatus =
    rawPaymentStatus && ['paid', 'partial', 'unpaid'].includes(rawPaymentStatus)
      ? (rawPaymentStatus as 'paid' | 'partial' | 'unpaid')
      : undefined

  const rawStatus = url.searchParams.get('status')
  const status =
    rawStatus && ['active', 'voided'].includes(rawStatus)
      ? (rawStatus as 'active' | 'voided')
      : undefined

  const startDate = url.searchParams.get('startDate') || undefined
  const endDate = url.searchParams.get('endDate') || undefined
  const search = url.searchParams.get('search') || undefined

  const pageStr = url.searchParams.get('page')
  const page = pageStr && !isNaN(Number(pageStr)) && Number(pageStr) > 0 ? Number(pageStr) : 1

  const limitStr = url.searchParams.get('limit')
  const parsedLimit =
    limitStr && !isNaN(Number(limitStr)) && Number(limitStr) > 0 ? Number(limitStr) : 20
  const limit = Math.min(Math.max(parsedLimit, 1), 100)

  return {
    branchId,
    customerId,
    paymentStatus,
    status,
    startDate,
    endDate,
    search,
    page,
    limit,
  }
}

