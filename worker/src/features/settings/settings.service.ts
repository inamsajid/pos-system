import { HttpError } from '../../lib/errors'
import { SettingsRepository } from './settings.repository'
import type { BusinessSettingsDTO, UpdateBusinessSettingsInput } from './settings.types'

export class SettingsService {
  private readonly repo: SettingsRepository

  constructor(db: D1Database) {
    this.repo = new SettingsRepository(db)
  }

  async getSettings(businessId: string): Promise<BusinessSettingsDTO> {
    const settings = await this.repo.getSettings(businessId)
    if (!settings) {
      throw HttpError.notFound('Business not found.')
    }
    return settings
  }

  async updateSettings(businessId: string, input: UpdateBusinessSettingsInput): Promise<BusinessSettingsDTO> {
    if (input.name !== undefined && !input.name.trim()) {
      throw HttpError.badRequest('Business name cannot be empty.', { field: 'name' })
    }

    if (input.defaultTaxRate !== undefined) {
      if (typeof input.defaultTaxRate !== 'number' || input.defaultTaxRate < 0 || input.defaultTaxRate > 100) {
        throw HttpError.badRequest('Tax rate must be a percentage between 0 and 100.', { field: 'defaultTaxRate' })
      }
    }

    if (input.maxVoidHours !== undefined) {
      if (!Number.isInteger(input.maxVoidHours) || input.maxVoidHours < 1 || input.maxVoidHours > 720) {
        throw HttpError.badRequest('Max void hours must be an integer between 1 and 720.', { field: 'maxVoidHours' })
      }
    }

    return this.repo.updateSettings(businessId, input)
  }
}

