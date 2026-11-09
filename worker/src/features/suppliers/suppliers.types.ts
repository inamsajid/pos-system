export interface SupplierRow {
  id: string
  business_id: string
  supplier_code: string
  name: string
  type: 'individual' | 'business'
  company_name: string | null
  contact_person: string | null
  phone: string | null
  alternate_phone: string | null
  email: string | null
  tax_number: string | null
  address: string | null
  city: string | null
  country: string
  opening_payable_minor: number
  status: 'active' | 'inactive' | 'archived'
  notes: string | null
  created_at: string
  updated_at: string
}

export interface SupplierDTO {
  id: string
  businessId: string
  supplierCode: string
  name: string
  type: 'individual' | 'business'
  companyName: string | null
  contactPerson: string | null
  phone: string | null
  alternatePhone: string | null
  email: string | null
  taxNumber: string | null
  address: string | null
  city: string | null
  country: string
  openingPayableMinor: number
  status: 'active' | 'inactive' | 'archived'
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateSupplierInput {
  name: string
  supplierCode?: string
  type?: 'individual' | 'business'
  companyName?: string
  contactPerson?: string
  phone?: string
  alternatePhone?: string
  email?: string
  taxNumber?: string
  address?: string
  city?: string
  country?: string
  openingPayableMinor?: number
  notes?: string
  status?: 'active' | 'inactive' | 'archived'
}

export interface UpdateSupplierInput {
  name?: string
  type?: 'individual' | 'business'
  companyName?: string
  contactPerson?: string
  phone?: string
  alternatePhone?: string
  email?: string
  taxNumber?: string
  address?: string
  city?: string
  country?: string
  notes?: string
  status?: 'active' | 'inactive' | 'archived'
}

export interface SupplierProductRow {
  id: string
  business_id: string
  supplier_id: string
  product_id: string
  supplier_sku: string | null
  purchase_price_minor: number
  is_preferred: number
  created_at: string
}

export interface SupplierProductDTO {
  id: string
  businessId: string
  supplierId: string
  productId: string
  supplierSku?: string
  purchasePriceMinor: number
  purchasePrice?: number
  isPreferred: boolean
  createdAt: string
}

export interface AddSupplierProductInput {
  productId: string
  supplierSku?: string
  purchasePriceMinor?: number
  purchasePrice?: number
  isPreferred?: boolean
}

export interface SupplierFilterParams {
  search?: string
  status?: 'active' | 'inactive' | 'archived' | 'all'
  page: number
  limit: number
}

export interface SupplierListResult {
  items: SupplierDTO[]
  meta: {
    page: number
    limit: number
    totalCount: number
    totalPages: number
    hasNextPage: boolean
  }
}
