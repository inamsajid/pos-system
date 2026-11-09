export type CustomerStatus = 'active' | 'inactive' | 'archived'
export type CustomerType = 'individual' | 'business'

export interface CustomerRow {
  id: string
  business_id: string
  customer_code: string
  name: string
  type: CustomerType
  company_name: string | null
  phone: string | null
  email: string | null
  tax_number: string | null
  address: string | null
  city: string | null
  opening_balance_minor: number
  credit_limit_minor: number
  is_walk_in: number
  status: CustomerStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CustomerDTO {
  id: string
  businessId: string
  customerCode: string
  name: string
  type: CustomerType
  companyName?: string
  phone?: string
  email?: string
  taxNumber?: string
  address?: string
  city?: string
  openingBalanceMinor: number
  creditLimitMinor: number
  isWalkIn: boolean
  status: CustomerStatus
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface CreateCustomerInput {
  name: string
  customerCode?: string
  type?: CustomerType
  companyName?: string
  phone?: string
  email?: string
  taxNumber?: string
  address?: string
  city?: string
  openingBalanceMinor?: number
  creditLimitMinor?: number
  notes?: string
  status?: CustomerStatus
}

export interface UpdateCustomerInput {
  name?: string
  type?: CustomerType
  companyName?: string
  phone?: string
  email?: string
  taxNumber?: string
  address?: string
  city?: string
  creditLimitMinor?: number
  notes?: string
  status?: CustomerStatus
}

export interface CustomerFilterParams {
  page: number
  limit: number
  search?: string
  status?: CustomerStatus | 'all'
  type?: CustomerType
  includeWalkIn?: boolean
}

