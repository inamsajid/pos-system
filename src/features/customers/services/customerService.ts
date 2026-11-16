import {
  customerMockData,
  financialMockData,
  invoiceMockData,
  paymentMockData,
  accountMockData,
} from '../data/customerMockData'
import type {
  Customer,
  CustomerDraft,
  CustomerFinancialSummary,
  CustomerInvoice,
  CustomerPayment,
  AccountTransaction,
} from '../types/customer.types'
import { apiClient, ApiError } from '../../../lib/api-client'
import { fetchCustomerLedgerSummary, fetchCustomerLedger } from './customerLedgerService'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

interface WorkerInvoiceItem {
  id: string
  saleId?: string
  customerId: string
  invoiceNumber: string
  businessDateKey?: string
  createdAt: string
  totalAmountMinor: number
  paidAmountMinor: number
  paymentStatus: 'paid' | 'partial' | 'unpaid'
}

interface WorkerPaymentItem {
  id: string
  customerId: string
  receiptNumber: string
  receivedAt?: string
  createdAt: string
  amountMinor: number
  unallocatedAmountMinor?: number
  paymentMethods?: Array<{ method: string }>
  allocations?: Array<{ invoiceNumber: string }>
}

let mockCustomers = [...customerMockData]

export const customerService = {
  async getCustomers(): Promise<Customer[]> {
    if (isExplicitDemo()) {
      return mockCustomers.map(c => ({ ...c }))
    }
    const data = await apiClient.get<Customer[]>('/customers', { params: { limit: 100 } })
    return data || []
  },

  async getCustomerById(id: string): Promise<Customer | undefined> {
    if (isExplicitDemo()) {
      const c = mockCustomers.find(x => x.id === id)
      return c ? { ...c } : undefined
    }
    if (id === 'walk-in') {
      const rows = await apiClient.get<Customer[]>('/customers', {
        params: { search: 'Walk-in', limit: 20 },
      })
      return rows?.find(c => c.isWalkIn || c.id === 'walk-in')
    }
    try {
      return await apiClient.get<Customer>(`/customers/${id}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return undefined
      }
      throw err
    }
  },

  async createCustomer(draft: CustomerDraft): Promise<Customer> {
    if (isExplicitDemo()) {
      validateMock(draft)
      const now = new Date().toISOString()
      const n = Math.max(1000, ...mockCustomers.map(c => Number(c.customerCode.match(/\d+$/)?.[0] ?? 0))) + 1
      const c: Customer = {
        ...draft,
        id: globalThis.crypto?.randomUUID?.() ?? `cus-${Date.now()}`,
        customerCode: `CUS-${n}`,
        createdAt: now,
        updatedAt: now,
      }
      mockCustomers = [c, ...mockCustomers]
      return { ...c }
    }

    return apiClient.post<Customer>('/customers', draft)
  },

  async updateCustomer(id: string, draft: CustomerDraft): Promise<Customer> {
    if (isExplicitDemo()) {
      const old = mockCustomers.find(c => c.id === id)
      if (!old) throw Error('Customer not found.')
      if (old.isWalkIn) throw Error('Walk-in Customer details are protected.')
      validateMock(draft, id)
      const c = { ...old, ...draft, updatedAt: new Date().toISOString() }
      mockCustomers = mockCustomers.map(x => (x.id === id ? c : x))
      return { ...c }
    }

    return apiClient.patch<Customer>(`/customers/${id}`, draft)
  },

  async updateCustomerStatus(id: string, status: 'active' | 'inactive'): Promise<Customer> {
    if (isExplicitDemo()) {
      const old = mockCustomers.find(c => c.id === id)
      if (!old) throw Error('Customer not found.')
      if (old.isWalkIn && status !== 'active') throw Error('Walk-in Customer must remain active.')
      const c = { ...old, status, updatedAt: new Date().toISOString() }
      mockCustomers = mockCustomers.map(x => (x.id === id ? c : x))
      return { ...c }
    }

    return apiClient.patch<Customer>(`/customers/${id}/status`, { status })
  },

  async archiveCustomer(id: string): Promise<Customer> {
    if (isExplicitDemo()) {
      const old = mockCustomers.find(c => c.id === id)
      if (!old) throw Error('Customer not found.')
      if (old.isWalkIn) throw Error('Walk-in Customer cannot be archived.')
      const c = { ...old, status: 'archived' as const, updatedAt: new Date().toISOString() }
      mockCustomers = mockCustomers.map(x => (x.id === id ? c : x))
      return { ...c }
    }

    return apiClient.delete<Customer>(`/customers/${id}`)
  },

  async getCustomerFinancialSummary(id: string): Promise<CustomerFinancialSummary> {
    if (!isExplicitDemo()) {
      return fetchCustomerLedgerSummary(id)
    }
    return (
      financialMockData.find(f => f.customerId === id) ?? {
        customerId: id,
        totalPurchases: 0,
        totalPaid: 0,
        outstandingBalance: 0,
        advanceBalance: 0,
        openingBalance: 0,
      }
    )
  },

  async getCustomerPurchaseHistory(id: string): Promise<CustomerInvoice[]> {
    if (!isExplicitDemo()) {
      if (id === 'walk-in') return []
      const res = await apiClient.get<WorkerInvoiceItem[] | { items: WorkerInvoiceItem[] }>('/invoices', {
        params: { customerId: id, limit: 100 },
      })
      const items = Array.isArray(res) ? res : res?.items || []
      return items.map(inv => ({
        id: inv.id,
        saleId: inv.saleId,
        customerId: inv.customerId,
        invoiceNumber: inv.invoiceNumber,
        date: inv.createdAt || inv.businessDateKey || '',
        totalAmount: inv.totalAmountMinor / 100,
        paidAmount: inv.paidAmountMinor / 100,
        paymentStatus: inv.paymentStatus,
      }))
    }
    return invoiceMockData.filter(x => x.customerId === id).map(x => ({ ...x }))
  },

  async getCustomerPaymentHistory(id: string): Promise<CustomerPayment[]> {
    if (!isExplicitDemo()) {
      if (id === 'walk-in') return []
      const res = await apiClient.get<WorkerPaymentItem[] | { items: WorkerPaymentItem[] }>(
        '/customer-payments',
        { params: { customerId: id, limit: 100 } }
      )
      const items = Array.isArray(res) ? res : res?.items || []
      return items.map(p => ({
        id: p.id,
        customerId: p.customerId,
        reference: p.receiptNumber,
        date: p.receivedAt || p.createdAt,
        method:
          (p.paymentMethods || []).map(m => m.method.replace('_', ' ')).join(', ') || 'cash',
        amount: p.amountMinor / 100,
        unallocatedAmount:
          typeof p.unallocatedAmountMinor === 'number' ? p.unallocatedAmountMinor / 100 : undefined,
        invoiceNumber:
          (p.allocations || []).map(a => a.invoiceNumber).filter(Boolean).join(', ') || 'Advance',
        status: 'completed',
      }))
    }
    return paymentMockData.filter(x => x.customerId === id).map(x => ({ ...x }))
  },

  async getCustomerAccountTransactions(id: string): Promise<AccountTransaction[]> {
    if (!isExplicitDemo()) {
      return fetchCustomerLedger(id)
    }
    return accountMockData.filter(x => x.customerId === id).map(x => ({ ...x }))
  },
}

function validateMock(d: CustomerDraft, excluded?: string) {
  const name = d.name.trim().toLowerCase()
  if (mockCustomers.some(c => c.id !== excluded && c.name.trim().toLowerCase() === name)) {
    throw Error('A customer with this name already exists.')
  }
  if (d.phone?.trim() && mockCustomers.some(c => c.id !== excluded && c.phone?.replace(/\D/g, '') === d.phone?.replace(/\D/g, ''))) {
    throw Error('This phone number is already in use.')
  }
  if (d.email?.trim() && mockCustomers.some(c => c.id !== excluded && c.email?.trim().toLowerCase() === d.email?.trim().toLowerCase())) {
    throw Error('This email address is already in use.')
  }
  if (d.taxNumber?.trim() && mockCustomers.some(c => c.id !== excluded && c.taxNumber?.trim().toLowerCase() === d.taxNumber?.trim().toLowerCase())) {
    throw Error('This tax number is already in use.')
  }
}
