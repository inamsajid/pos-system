export interface BusinessSettingsDTO {
  businessId: string
  name: string
  legalName?: string
  taxNumber?: string
  currency: string
  phone?: string
  email?: string
  address?: string
  city?: string
  country: string
  timezone: string
  receiptHeader?: string
  receiptFooter?: string
  defaultTaxRate: number
  allowNegativeStock: boolean
  maxVoidHours: number
  settingsJson?: Record<string, unknown>
  updatedAt: string
}

export interface UpdateBusinessSettingsInput {
  name?: string
  legalName?: string
  taxNumber?: string
  currency?: string
  phone?: string
  email?: string
  address?: string
  city?: string
  country?: string
  timezone?: string
  receiptHeader?: string
  receiptFooter?: string
  defaultTaxRate?: number
  allowNegativeStock?: boolean
  maxVoidHours?: number
  settingsJson?: Record<string, unknown>
}

