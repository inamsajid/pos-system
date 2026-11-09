import { apiClient } from '../../../lib/api-client'
import { getSaleById, getSales, getSaleByInvoiceNumber } from '../../pos/services/checkoutService'
import type { CheckoutSale, CheckoutMethod, SaleItemSnapshot, SalePayment } from '../../pos/types/checkout.types'
import type { ProductUnit } from '../../products/types/product.types'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

interface WorkerSaleDTO {
  id: string
  businessId: string
  branchId: string
  saleNumber: string
  receiptNumber: string
  invoiceNumber: string
  customerId: string
  customerSnapshot?: {
    name?: string
    customerCode?: string
    phone?: string | null
    address?: string | null
    city?: string | null
    isWalkIn?: boolean
  }
  terminalId?: string
  cashierName?: string
  subtotalMinor: number
  discountType: 'fixed' | 'percent'
  discountValue: number
  discountMinor: number
  totalAmountMinor: number
  amountPaidMinor: number
  remainingBalanceMinor: number
  changeReturnedMinor: number
  status: string
  createdAt: string
  items?: Array<{
    productId: string
    productName: string
    sku: string
    unit: string
    unitPriceMinor: number
    quantity: number
    lineTotalMinor: number
  }>
  payments?: Array<{
    method: string
    amountMinor: number
    reference?: string | null
  }>
}

function mapWorkerSaleToCheckoutSale(dto: WorkerSaleDTO): CheckoutSale {
  const items: SaleItemSnapshot[] = (dto.items || []).map((item) => ({
    productId: item.productId,
    productName: item.productName,
    sku: item.sku,
    unit: (item.unit as ProductUnit) || 'piece',
    unitPrice: item.unitPriceMinor / 100,
    quantity: item.quantity,
    lineTotal: item.lineTotalMinor / 100,
  }))

  const payments: SalePayment[] = (dto.payments || []).map((p) => ({
    method: (p.method === 'bank_transfer' ? 'bank-transfer' : p.method) as CheckoutMethod,
    amount: p.amountMinor / 100,
    reference: p.reference ?? undefined,
  }))

  return {
    id: dto.id,
    saleNumber: dto.saleNumber,
    receiptNumber: dto.receiptNumber,
    invoiceNumber: dto.invoiceNumber,
    customerId: dto.customerId,
    customerName: dto.customerSnapshot?.name || 'Walk-in Customer',
    customerCode: dto.customerSnapshot?.customerCode,
    customerPhone: dto.customerSnapshot?.phone ?? undefined,
    customerAddress: [dto.customerSnapshot?.address, dto.customerSnapshot?.city].filter(Boolean).join(', ') || undefined,
    cashierName: dto.cashierName || 'Cashier',
    businessSnapshot: {
      name: 'Northstar Market',
      address: 'Business address · Lahore',
      phone: 'Business phone',
      email: 'Business email',
    },
    items,
    subtotal: dto.subtotalMinor / 100,
    discountType: dto.discountType,
    discountValue: dto.discountValue,
    discountAmount: dto.discountMinor / 100,
    totalAmount: dto.totalAmountMinor / 100,
    payments,
    amountPaid: dto.amountPaidMinor / 100,
    remainingBalance: dto.remainingBalanceMinor / 100,
    changeReturned: dto.changeReturnedMinor / 100,
    createdAt: dto.createdAt,
    status: 'completed',
  }
}

export const salesService = {
  async getSales(): Promise<CheckoutSale[]> {
    if (!isExplicitDemo()) {
      const response = await apiClient.get<{ items: WorkerSaleDTO[] } | WorkerSaleDTO[]>('/sales?limit=100')
      const items = Array.isArray(response) ? response : response.items || []
      return items.map(mapWorkerSaleToCheckoutSale)
    }
    return getSales()
  },

  async getSaleById(id: string): Promise<CheckoutSale | undefined> {
    if (!isExplicitDemo()) {
      try {
        const dto = await apiClient.get<WorkerSaleDTO>(`/sales/${id}`)
        return mapWorkerSaleToCheckoutSale(dto)
      } catch {
        return undefined
      }
    }
    return getSaleById(id)
  },

  async getSaleByInvoiceNumber(number: string): Promise<CheckoutSale | undefined> {
    if (!isExplicitDemo()) {
      const all = await this.getSales()
      return all.find((s) => s.invoiceNumber === number)
    }
    return getSaleByInvoiceNumber(number)
  },

  async voidSale(id: string): Promise<CheckoutSale> {
    if (!isExplicitDemo()) {
      const dto = await apiClient.post<WorkerSaleDTO>(`/sales/${id}/void`)
      return mapWorkerSaleToCheckoutSale(dto)
    }
    throw new Error('Void sale not supported in demo mode.')
  },
}

export type SaleRecord = CheckoutSale
