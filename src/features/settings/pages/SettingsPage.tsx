import React, { useState, useEffect } from 'react'
import {
  Building2,
  Globe,
  Receipt,
  Percent,
  Sliders,
  Save,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { useAuth } from '../../auth/context/useAuth'
import { useSettings } from '../hooks/useSettings'
import type { UpdateBusinessSettingsInput } from '../services/settingsService'

type SettingsTab = 'profile' | 'regional' | 'tax' | 'receipt' | 'preferences'

export function SettingsPage() {
  const { activeBusiness } = useAuth()
  const { settings, isLoading, isError, error, updateSettings, isUpdating } = useSettings()

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const [formData, setFormData] = useState<UpdateBusinessSettingsInput>({})
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Populate formData whenever settings load or change
  useEffect(() => {
    if (settings) {
      setFormData({
        name: settings.name,
        legalName: settings.legalName || '',
        taxNumber: settings.taxNumber || '',
        currency: settings.currency || 'PKR',
        phone: settings.phone || '',
        email: settings.email || '',
        address: settings.address || '',
        city: settings.city || '',
        country: settings.country || 'Pakistan',
        timezone: settings.timezone || 'Asia/Karachi',
        receiptHeader: settings.receiptHeader || '',
        receiptFooter: settings.receiptFooter || '',
        defaultTaxRate: settings.defaultTaxRate,
        allowNegativeStock: settings.allowNegativeStock,
        maxVoidHours: settings.maxVoidHours,
      })
    }
  }, [settings])

  const userRole = activeBusiness?.role || 'owner'
  const canEdit = userRole === 'owner' || userRole === 'admin'

  const handleChange = (field: keyof UpdateBusinessSettingsInput, value: unknown) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
    setSuccessMessage(null)
    setErrorMessage(null)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit) return

    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      await updateSettings(formData)
      setSuccessMessage('Business settings updated and saved successfully.')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save business settings.'
      setErrorMessage(msg)
    }
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <PageHeader title="Business Settings" description="Configure your business workspace." />
        <div className="flex h-64 items-center justify-center">
          <p className="text-sm text-slate-500">Loading business configuration…</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-8">
        <PageHeader title="Business Settings" description="Configure your business workspace." />
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-rose-800">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600" />
            <h3 className="font-semibold">Unable to load business settings</h3>
          </div>
          <p className="mt-2 text-sm text-rose-700">
            {error instanceof Error ? error.message : 'An error occurred while fetching settings from the server.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business Settings"
        description="Configure your business profile, localization, tax policies, receipts, and system rules."
        action={
          canEdit ? (
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={isUpdating}
              className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {isUpdating ? 'Saving…' : 'Save Changes'}
            </Button>
          ) : (
            <Badge tone="neutral">
              <ShieldAlert className="mr-1 inline h-3.5 w-3.5" /> Read-Only Mode
            </Badge>
          )
        }
      />

      {successMessage && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-xs font-semibold text-rose-700 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs navigation */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'profile'
              ? 'bg-blue-50 text-blue-700 font-semibold shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building2 className="h-4 w-4" />
          Business Profile
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('regional')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'regional'
              ? 'bg-blue-50 text-blue-700 font-semibold shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Globe className="h-4 w-4" />
          Regional & Currency
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('tax')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'tax'
              ? 'bg-blue-50 text-blue-700 font-semibold shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Percent className="h-4 w-4" />
          Tax Configuration
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('receipt')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'receipt'
              ? 'bg-blue-50 text-blue-700 font-semibold shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Receipt className="h-4 w-4" />
          Receipt & Invoices
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('preferences')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'preferences'
              ? 'bg-blue-50 text-blue-700 font-semibold shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Sliders className="h-4 w-4" />
          System Preferences
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Tab 1: Business Profile */}
        {activeTab === 'profile' && (
          <Card className="space-y-6 p-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Legal & Public Profile</h2>
              <p className="text-xs text-slate-500">
                Primary business identification and official contact information printed on tax documents.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Business Display Name *</label>
                <input
                  type="text"
                  required
                  disabled={!canEdit}
                  value={formData.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                  placeholder="e.g. Northstar Supermarket"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Legal Business Name</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={formData.legalName || ''}
                  onChange={(e) => handleChange('legalName', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                  placeholder="e.g. Northstar Retail Enterprises Pvt Ltd"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Tax / NTN / STRN Number</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={formData.taxNumber || ''}
                  onChange={(e) => handleChange('taxNumber', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                  placeholder="e.g. NTN-9842104-7"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Contact Phone</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={formData.phone || ''}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                  placeholder="e.g. +92 300 1234567"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Official Email</label>
                <input
                  type="email"
                  disabled={!canEdit}
                  value={formData.email || ''}
                  onChange={(e) => handleChange('email', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                  placeholder="e.g. accounts@northstar.example"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">City</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={formData.city || ''}
                  onChange={(e) => handleChange('city', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                  placeholder="e.g. Lahore"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">Physical Address</label>
                <textarea
                  rows={2}
                  disabled={!canEdit}
                  value={formData.address || ''}
                  onChange={(e) => handleChange('address', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                  placeholder="e.g. Plot 42-B, Commercial Area, Main Boulevard"
                />
              </div>
            </div>
          </Card>
        )}

        {/* Tab 2: Regional & Currency */}
        {activeTab === 'regional' && (
          <Card className="space-y-6 p-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Regional Localization</h2>
              <p className="text-xs text-slate-500">
                Configure primary base currency, system timezone and fiscal country.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Operating Currency</label>
                <select
                  disabled={!canEdit}
                  value={formData.currency || 'PKR'}
                  onChange={(e) => handleChange('currency', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                >
                  <option value="PKR">PKR — Pakistani Rupee (Rs)</option>
                  <option value="USD">USD — US Dollar ($)</option>
                  <option value="EUR">EUR — Euro (€)</option>
                  <option value="GBP">GBP — British Pound (£)</option>
                  <option value="AED">AED — UAE Dirham</option>
                  <option value="SAR">SAR — Saudi Riyal</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  Transaction minor-units (cents/paise) will be calculated according to this base currency.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Timezone</label>
                <select
                  disabled={!canEdit}
                  value={formData.timezone || 'Asia/Karachi'}
                  onChange={(e) => handleChange('timezone', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                >
                  <option value="Asia/Karachi">Asia/Karachi (UTC+05:00)</option>
                  <option value="UTC">UTC (Universal Coordinated Time)</option>
                  <option value="Asia/Dubai">Asia/Dubai (UTC+04:00)</option>
                  <option value="Asia/Riyadh">Asia/Riyadh (UTC+03:00)</option>
                  <option value="Europe/London">Europe/London (GMT/BST)</option>
                  <option value="America/New_York">America/New_York (EST/EDT)</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  Used to generate business day cutoffs and reports.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Country</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={formData.country || 'Pakistan'}
                  onChange={(e) => handleChange('country', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                />
              </div>
            </div>
          </Card>
        )}

        {/* Tab 3: Tax Configuration */}
        {activeTab === 'tax' && (
          <Card className="space-y-6 p-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Tax Policies & Rates</h2>
              <p className="text-xs text-slate-500">
                Define the default tax percentage applied to product sales and invoices across branches.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Default Tax Rate (%)</label>
                <div className="relative mt-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    disabled={!canEdit}
                    value={formData.defaultTaxRate ?? 0}
                    onChange={(e) => handleChange('defaultTaxRate', parseFloat(e.target.value) || 0)}
                    className="w-full rounded-md border border-slate-300 p-2 pr-8 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                    %
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Applied as default VAT / GST on products unless an item-specific tax override is configured.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Tab 4: Receipt & Invoices */}
        {activeTab === 'receipt' && (
          <Card className="space-y-6 p-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Receipt Header & Footer Content</h2>
              <p className="text-xs text-slate-500">
                Custom slogans, return policies, or greetings printed on customer thermal receipts and invoices.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Receipt Header Text</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={formData.receiptHeader || ''}
                  onChange={(e) => handleChange('receiptHeader', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                  placeholder="e.g. Welcome to Northstar POS — Quality Guaranteed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Receipt Footer Text</label>
                <textarea
                  rows={3}
                  disabled={!canEdit}
                  value={formData.receiptFooter || ''}
                  onChange={(e) => handleChange('receiptFooter', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                  placeholder="e.g. Thank you for your purchase. Goods once sold can be exchanged within 7 days with valid receipt."
                />
              </div>
            </div>
          </Card>
        )}

        {/* Tab 5: System Preferences */}
        {activeTab === 'preferences' && (
          <Card className="space-y-6 p-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Inventory & Transaction Controls</h2>
              <p className="text-xs text-slate-500">
                Configure operational constraints, negative inventory rules, and sale void windows.
              </p>
            </div>

            <div className="space-y-6">
              <div className="flex items-start justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-slate-900">Allow Negative Inventory</h4>
                  <p className="text-xs text-slate-500">
                    When enabled, cashiers can complete checkout even if on-hand branch stock is zero. When disabled, sales
                    that exceed available stock are strictly rejected by the server.
                  </p>
                </div>
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={Boolean(formData.allowNegativeStock)}
                  onChange={(e) => handleChange('allowNegativeStock', e.target.checked)}
                  className="mt-1 h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Maximum Void Window (Hours)</label>
                <input
                  type="number"
                  min="1"
                  max="720"
                  disabled={!canEdit}
                  value={formData.maxVoidHours ?? 24}
                  onChange={(e) => handleChange('maxVoidHours', parseInt(e.target.value, 10) || 24)}
                  className="mt-1 max-w-xs rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Completed sales older than this limit cannot be voided by cashiers or managers.
                </p>
              </div>
            </div>
          </Card>
        )}

        {canEdit && (
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={isUpdating}
              onClick={() => {
                if (settings) {
                  setFormData({
                    name: settings.name,
                    legalName: settings.legalName || '',
                    taxNumber: settings.taxNumber || '',
                    currency: settings.currency || 'PKR',
                    phone: settings.phone || '',
                    email: settings.email || '',
                    address: settings.address || '',
                    city: settings.city || '',
                    country: settings.country || 'Pakistan',
                    timezone: settings.timezone || 'Asia/Karachi',
                    receiptHeader: settings.receiptHeader || '',
                    receiptFooter: settings.receiptFooter || '',
                    defaultTaxRate: settings.defaultTaxRate,
                    allowNegativeStock: settings.allowNegativeStock,
                    maxVoidHours: settings.maxVoidHours,
                  })
                  setSuccessMessage('Changes discarded and reset to saved settings.')
                }
              }}
            >
              Discard Changes
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isUpdating}
              className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {isUpdating ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        )}
      </form>
    </div>
  )
}
