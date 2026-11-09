import {
  supplierMockData,
  supplierFinancialMockData,
  supplierProductMockData,
  supplierPurchaseMockData,
  supplierPaymentMockData,
  supplierTransactionMockData,
} from '../data/supplierMockData'
import { productService } from '../../products/services/productService'
import { categoryService } from '../../categories/services/categoryService'
import type {
  Supplier,
  SupplierDraft,
  SupplierFinancialSummary,
  SupplierPurchase,
  SupplierPayment,
  SupplierTransaction,
  SupplierProductAssociation,
} from '../types/supplier.types'
import { apiClient } from '../../../lib/api-client'
import { fetchSupplierLedger, fetchSupplierLedgerSummary } from './supplierLedgerService'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

let mockSuppliers = [...supplierMockData]

export const supplierService = {
  async getSuppliers(): Promise<Supplier[]> {
    if (isExplicitDemo()) {
      return mockSuppliers.map(s => ({ ...s }))
    }
    try {
      const data = await apiClient.get<Supplier[]>('/api/v1/suppliers', { params: { limit: 100 } })
      return data || []
    } catch (err) {
      if (isExplicitDemo()) {
        return mockSuppliers.map(s => ({ ...s }))
      }
      throw err
    }
  },

  async getSupplierById(id: string): Promise<Supplier | undefined> {
    if (isExplicitDemo()) {
      const s = mockSuppliers.find(x => x.id === id)
      return s ? { ...s } : undefined
    }
    return apiClient.get<Supplier>(`/api/v1/suppliers/${id}`)
  },

  async createSupplier(d: SupplierDraft): Promise<Supplier> {
    if (isExplicitDemo()) {
      validateMock(d)
      const now = new Date().toISOString()
      const next = Math.max(1000, ...mockSuppliers.map(s => Number(s.supplierCode.match(/\d+$/)?.[0] ?? 0))) + 1
      const s: Supplier = {
        ...d,
        id: globalThis.crypto?.randomUUID?.() ?? `sup-${Date.now()}`,
        supplierCode: `SUP-${next}`,
        name: d.name.trim(),
        createdAt: now,
        updatedAt: now,
      }
      mockSuppliers = [s, ...mockSuppliers]
      return { ...s }
    }

    return apiClient.post<Supplier>('/api/v1/suppliers', d)
  },

  async updateSupplier(id: string, d: SupplierDraft): Promise<Supplier> {
    if (isExplicitDemo()) {
      const old = mockSuppliers.find(s => s.id === id)
      if (!old) throw Error('Supplier not found.')
      validateMock(d, id)
      const s = { ...old, ...d, name: d.name.trim(), updatedAt: new Date().toISOString() }
      mockSuppliers = mockSuppliers.map(x => (x.id === id ? s : x))
      return { ...s }
    }

    return apiClient.patch<Supplier>(`/api/v1/suppliers/${id}`, d)
  },

  async updateSupplierStatus(id: string, status: 'active' | 'inactive'): Promise<Supplier> {
    if (isExplicitDemo()) {
      const old = mockSuppliers.find(s => s.id === id)
      if (!old) throw Error('Supplier not found.')
      const s = { ...old, status, updatedAt: new Date().toISOString() }
      mockSuppliers = mockSuppliers.map(x => (x.id === id ? s : x))
      return { ...s }
    }

    return apiClient.patch<Supplier>(`/api/v1/suppliers/${id}/status`, { status })
  },

  async archiveSupplier(id: string): Promise<Supplier> {
    if (isExplicitDemo()) {
      const old = mockSuppliers.find(s => s.id === id)
      if (!old) throw Error('Supplier not found.')
      const s = { ...old, status: 'archived' as const, updatedAt: new Date().toISOString() }
      mockSuppliers = mockSuppliers.map(x => (x.id === id ? s : x))
      return { ...s }
    }

    return apiClient.delete<Supplier>(`/api/v1/suppliers/${id}`)
  },

  async getSupplierFinancialSummary(id: string): Promise<SupplierFinancialSummary> {
    if (!isExplicitDemo()) {
      try {
        return await fetchSupplierLedgerSummary(id)
      } catch {
        // Fall back only if network fails
      }
    }
    return (
      supplierFinancialMockData.find(x => x.supplierId === id) ?? {
        supplierId: id,
        totalPurchases: 0,
        totalPaid: 0,
        outstandingPayable: 0,
        advanceBalance: 0,
        openingPayable: 0,
      }
    )
  },

  async getSupplierPurchaseHistory(id: string): Promise<SupplierPurchase[]> {
    return supplierPurchaseMockData.filter(x => x.supplierId === id).map(x => ({ ...x }))
  },

  async getSupplierPaymentHistory(id: string): Promise<SupplierPayment[]> {
    return supplierPaymentMockData.filter(x => x.supplierId === id).map(x => ({ ...x }))
  },

  async getSupplierAccountTransactions(id: string): Promise<SupplierTransaction[]> {
    if (!isExplicitDemo()) {
      try {
        return await fetchSupplierLedger(id)
      } catch {
        // Fall back only if network fails
      }
    }
    return supplierTransactionMockData.filter(x => x.supplierId === id).map(x => ({ ...x }))
  },

  async getSupplierProducts(
    id: string
  ): Promise<Array<{ association: SupplierProductAssociation; product: Awaited<ReturnType<typeof productService.getProducts>>[number]; category: string }>> {
    const [products, categories] = await Promise.all([
      productService.getProducts(),
      categoryService.getCategories(),
    ])

    let rawAssociations: SupplierProductAssociation[] = []
    if (!isExplicitDemo()) {
      try {
        const fetched = await apiClient.get<Array<{
          id: string
          supplierId: string
          productId: string
          supplierSku?: string
          purchasePrice?: number
          isPreferred: boolean
          createdAt: string
        }>>(`/api/v1/suppliers/${id}/products`)
        rawAssociations = fetched.map(a => ({
          id: a.id,
          supplierId: a.supplierId,
          productId: a.productId,
          supplierSku: a.supplierSku,
          purchasePrice: a.purchasePrice,
          isPreferred: a.isPreferred,
          createdAt: a.createdAt,
        }))
      } catch {
        rawAssociations = supplierProductMockData.filter(a => a.supplierId === id)
      }
    } else {
      rawAssociations = supplierProductMockData.filter(a => a.supplierId === id)
    }

    return rawAssociations.flatMap(association => {
      const product = products.find(p => p.id === association.productId)
      return product
        ? [
            {
              association,
              product,
              category: categories.find(c => c.id === product.categoryId)?.name ?? 'Uncategorized',
            },
          ]
        : []
    })
  },
}

function validateMock(d: SupplierDraft, excluded?: string) {
  if (!d.name.trim()) throw Error('Supplier name is required.')
  if (mockSuppliers.some(s => s.id !== excluded && s.name.trim().toLowerCase() === d.name.trim().toLowerCase())) {
    throw Error('A supplier with this name already exists.')
  }
  if (d.phone?.trim() && mockSuppliers.some(s => s.id !== excluded && s.phone?.replace(/\D/g, '') === d.phone?.replace(/\D/g, ''))) {
    throw Error('This phone number is already in use.')
  }
  if (d.email?.trim() && mockSuppliers.some(s => s.id !== excluded && s.email?.trim().toLowerCase() === d.email?.trim().toLowerCase())) {
    throw Error('This email is already in use.')
  }
  if (d.taxNumber?.trim() && mockSuppliers.some(s => s.id !== excluded && s.taxNumber?.trim().toLowerCase() === d.taxNumber?.trim().toLowerCase())) {
    throw Error('This tax number is already in use.')
  }
}
