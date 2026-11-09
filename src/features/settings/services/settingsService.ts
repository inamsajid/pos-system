import { apiClient } from '../../../lib/api-client'

export interface BusinessSettings {
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

export type UpdateBusinessSettingsInput = Partial<
  Omit<BusinessSettings, 'businessId' | 'updatedAt'>
>

const fallbackSettings: BusinessSettings = {
  businessId: 'demo-biz',
  name: 'Northstar Retail Store',
  legalName: 'Northstar Retail Pvt. Ltd.',
  taxNumber: 'NTN-8947291',
  currency: 'PKR',
  phone: '+92 300 1234567',
  email: 'info@northstarpos.example',
  address: 'Commercial Area, Block D',
  city: 'Lahore',
  country: 'Pakistan',
  timezone: 'Asia/Karachi',
  receiptHeader: 'Welcome to Northstar POS!',
  receiptFooter: 'Thank you for shopping with us. Goods once sold cannot be returned without original receipt.',
  defaultTaxRate: 16.0,
  allowNegativeStock: true,
  maxVoidHours: 24,
  settingsJson: {},
  updatedAt: new Date().toISOString(),
}

let mockSettings: BusinessSettings = { ...fallbackSettings }

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

export const settingsService = {
  async getSettings(): Promise<BusinessSettings> {
    if (isExplicitDemo()) {
      return { ...mockSettings }
    }
    try {
      return await apiClient.get<BusinessSettings>('/api/v1/settings')
    } catch (err) {
      if (isExplicitDemo()) {
        return { ...mockSettings }
      }
      throw err
    }
  },

  async updateSettings(input: UpdateBusinessSettingsInput): Promise<BusinessSettings> {
    if (isExplicitDemo()) {
      mockSettings = {
        ...mockSettings,
        ...input,
        updatedAt: new Date().toISOString(),
      }
      return { ...mockSettings }
    }

    return apiClient.patch<BusinessSettings>('/api/v1/settings', input)
  },
}

