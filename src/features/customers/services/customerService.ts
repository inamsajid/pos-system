import { customerMockData, financialMockData, invoiceMockData, paymentMockData, accountMockData } from '../data/customerMockData'
import type { Customer, CustomerDraft, CustomerFinancialSummary, CustomerInvoice, CustomerPayment, AccountTransaction } from '../types/customer.types'
import { apiClient } from '../../../lib/api-client'
import { fetchCustomerLedgerSummary, fetchCustomerLedger } from './customerLedgerService'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

let mockCustomers = [...customerMockData]

export const customerService = {
  async getCustomers(): Promise<Customer[]> {
    if (isExplicitDemo()) {
      return mockCustomers.map(c => ({ ...c }))
    }
    try {
      const data = await apiClient.get<Customer[]>('/api/v1/customers', { params: { limit: 100 } })
      return data || []
    } catch (err) {
      if (isExplicitDemo()) {
        return mockCustomers.map(c => ({ ...c }))
      }
      throw err
    }
  },

  async getCustomerById(id: string): Promise<Customer | undefined> {
    if (id === 'walk-in') {
      return mockCustomers.find(x => x.id === 'walk-in')
    }
    if (isExplicitDemo()) {
      const c = mockCustomers.find(x => x.id === id)
      return c ? { ...c } : undefined
    }
    return apiClient.get<Customer>(`/api/v1/customers/${id}`)
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

    return apiClient.post<Customer>('/api/v1/customers', draft)
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

    return apiClient.patch<Customer>(`/api/v1/customers/${id}`, draft)
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

    return apiClient.patch<Customer>(`/api/v1/customers/${id}/status`, { status })
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

    return apiClient.delete<Customer>(`/api/v1/customers/${id}`)
  },

  async getCustomerFinancialSummary(id: string): Promise<CustomerFinancialSummary> {
    if (!isExplicitDemo()) {
      try {
        return await fetchCustomerLedgerSummary(id)
      } catch {
        // Fall back only if network fails and mock summary exists
      }
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
    return invoiceMockData.filter(x => x.customerId === id).map(x => ({ ...x }))
  },

  async getCustomerPaymentHistory(id: string): Promise<CustomerPayment[]> {
    return paymentMockData.filter(x => x.customerId === id).map(x => ({ ...x }))
  },

  async getCustomerAccountTransactions(id: string): Promise<AccountTransaction[]> {
    if (!isExplicitDemo()) {
      try {
        return await fetchCustomerLedger(id)
      } catch {
        // Fall back only if network fails
      }
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
