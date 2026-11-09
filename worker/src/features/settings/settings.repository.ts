import type { BusinessSettingsDTO, UpdateBusinessSettingsInput } from './settings.types'

interface BusinessRow {
  id: string
  name: string
  legal_name: string | null
  tax_number: string | null
  currency: string
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  country: string
  timezone: string
  updated_at: string
}

interface SettingsRow {
  business_id: string
  receipt_header: string | null
  receipt_footer: string | null
  default_tax_rate: number
  allow_negative_stock: number
  max_void_hours: number
  settings_json: string | null
  updated_at: string
}

export class SettingsRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async getSettings(businessId: string): Promise<BusinessSettingsDTO | null> {
    const business = await this.db
      .prepare('SELECT id, name, legal_name, tax_number, currency, phone, email, address, city, country, timezone, updated_at FROM businesses WHERE id = ? LIMIT 1')
      .bind(businessId)
      .first<BusinessRow>()

    if (!business) return null

    let settings = await this.db
      .prepare('SELECT * FROM business_settings WHERE business_id = ? LIMIT 1')
      .bind(businessId)
      .first<SettingsRow>()

    if (!settings) {
      // Auto-initialize default settings row if missing
      await this.db
        .prepare(
          `INSERT OR IGNORE INTO business_settings (business_id, receipt_header, receipt_footer, default_tax_rate, allow_negative_stock, max_void_hours, updated_at)
           VALUES (?, 'Thank you for your business!', 'Please visit again.', 0.0, 1, 24, datetime('now'))`
        )
        .bind(businessId)
        .run()

      settings = await this.db
        .prepare('SELECT * FROM business_settings WHERE business_id = ? LIMIT 1')
        .bind(businessId)
        .first<SettingsRow>()
    }

    let parsedJson: Record<string, unknown> | undefined
    if (settings?.settings_json) {
      try {
        parsedJson = JSON.parse(settings.settings_json)
      } catch {
        parsedJson = undefined
      }
    }

    return {
      businessId: business.id,
      name: business.name,
      legalName: business.legal_name ?? undefined,
      taxNumber: business.tax_number ?? undefined,
      currency: business.currency,
      phone: business.phone ?? undefined,
      email: business.email ?? undefined,
      address: business.address ?? undefined,
      city: business.city ?? undefined,
      country: business.country,
      timezone: business.timezone,
      receiptHeader: settings?.receipt_header ?? undefined,
      receiptFooter: settings?.receipt_footer ?? undefined,
      defaultTaxRate: settings?.default_tax_rate ?? 0.0,
      allowNegativeStock: Boolean(settings?.allow_negative_stock ?? 1),
      maxVoidHours: settings?.max_void_hours ?? 24,
      settingsJson: parsedJson,
      updatedAt: settings?.updated_at ?? business.updated_at,
    }
  }

  async updateSettings(businessId: string, input: UpdateBusinessSettingsInput): Promise<BusinessSettingsDTO> {
    const now = new Date().toISOString()

    // 1. Update businesses table fields
    const bizUpdates: string[] = ['updated_at = ?']
    const bizBindings: (string | null)[] = [now]

    if (input.name !== undefined) {
      bizUpdates.push('name = ?')
      bizBindings.push(input.name.trim())
    }
    if (input.legalName !== undefined) {
      bizUpdates.push('legal_name = ?')
      bizBindings.push(input.legalName ? input.legalName.trim() : null)
    }
    if (input.taxNumber !== undefined) {
      bizUpdates.push('tax_number = ?')
      bizBindings.push(input.taxNumber ? input.taxNumber.trim() : null)
    }
    if (input.currency !== undefined) {
      bizUpdates.push('currency = ?')
      bizBindings.push(input.currency.trim())
    }
    if (input.phone !== undefined) {
      bizUpdates.push('phone = ?')
      bizBindings.push(input.phone ? input.phone.trim() : null)
    }
    if (input.email !== undefined) {
      bizUpdates.push('email = ?')
      bizBindings.push(input.email ? input.email.trim().toLowerCase() : null)
    }
    if (input.address !== undefined) {
      bizUpdates.push('address = ?')
      bizBindings.push(input.address ? input.address.trim() : null)
    }
    if (input.city !== undefined) {
      bizUpdates.push('city = ?')
      bizBindings.push(input.city ? input.city.trim() : null)
    }
    if (input.country !== undefined) {
      bizUpdates.push('country = ?')
      bizBindings.push(input.country.trim())
    }
    if (input.timezone !== undefined) {
      bizUpdates.push('timezone = ?')
      bizBindings.push(input.timezone.trim())
    }

    bizBindings.push(businessId)

    // 2. Update business_settings table fields
    const setUpdates: string[] = ['updated_at = ?']
    const setBindings: (string | number | null)[] = [now]

    if (input.receiptHeader !== undefined) {
      setUpdates.push('receipt_header = ?')
      setBindings.push(input.receiptHeader ? input.receiptHeader.trim() : null)
    }
    if (input.receiptFooter !== undefined) {
      setUpdates.push('receipt_footer = ?')
      setBindings.push(input.receiptFooter ? input.receiptFooter.trim() : null)
    }
    if (input.defaultTaxRate !== undefined) {
      setUpdates.push('default_tax_rate = ?')
      setBindings.push(input.defaultTaxRate)
    }
    if (input.allowNegativeStock !== undefined) {
      setUpdates.push('allow_negative_stock = ?')
      setBindings.push(input.allowNegativeStock ? 1 : 0)
    }
    if (input.maxVoidHours !== undefined) {
      setUpdates.push('max_void_hours = ?')
      setBindings.push(input.maxVoidHours)
    }
    if (input.settingsJson !== undefined) {
      setUpdates.push('settings_json = ?')
      setBindings.push(JSON.stringify(input.settingsJson))
    }

    setBindings.push(businessId)

    // Execute atomic batch
    const statements: D1PreparedStatement[] = []

    if (bizUpdates.length > 1) {
      statements.push(
        this.db.prepare(`UPDATE businesses SET ${bizUpdates.join(', ')} WHERE id = ?`).bind(...bizBindings)
      )
    }

    // Ensure row exists in business_settings
    statements.push(
      this.db
        .prepare(
          `INSERT OR IGNORE INTO business_settings (business_id, receipt_header, receipt_footer, default_tax_rate, allow_negative_stock, max_void_hours, updated_at)
           VALUES (?, 'Thank you!', 'Please visit again.', 0.0, 1, 24, ?)`
        )
        .bind(businessId, now)
    )

    if (setUpdates.length > 1) {
      statements.push(
        this.db.prepare(`UPDATE business_settings SET ${setUpdates.join(', ')} WHERE business_id = ?`).bind(...setBindings)
      )
    }

    await this.db.batch(statements)

    return (await this.getSettings(businessId))!
  }
}

