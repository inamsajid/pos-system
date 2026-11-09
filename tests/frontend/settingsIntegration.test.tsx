/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsPage } from '../../src/features/settings/pages/SettingsPage'
import { settingsService } from '../../src/features/settings/services/settingsService'

// Mock Auth Context
vi.mock('../../src/features/auth/context/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'usr_mock_owner', name: 'Test Owner', email: 'owner@test.com' },
    activeBusiness: {
      id: 'biz_test_settings',
      name: 'Northstar Retail Test',
      role: 'owner',
      currency: 'PKR',
    },
    activeBranch: { id: 'br_1', name: 'Main Branch' },
    isAuthenticated: true,
  }),
}))

describe('Business Settings Page Frontend Integration', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  it('renders SettingsPage with 5 navigation tabs and business profile data', async () => {
    vi.spyOn(settingsService, 'getSettings').mockResolvedValueOnce({
      businessId: 'biz_test_settings',
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
      receiptFooter: 'Thank you for shopping.',
      defaultTaxRate: 16.0,
      allowNegativeStock: true,
      maxVoidHours: 24,
      settingsJson: {},
      updatedAt: '2026-11-09T00:00:00Z',
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    )

    // Wait for content to load
    await waitFor(() => {
      expect(screen.getByText('Business Profile')).toBeDefined()
    })

    // Verify all 5 tab buttons exist
    expect(screen.getByText('Business Profile')).toBeDefined()
    expect(screen.getByText('Regional & Currency')).toBeDefined()
    expect(screen.getByText('Tax Configuration')).toBeDefined()
    expect(screen.getByText('Receipt & Invoices')).toBeDefined()
    expect(screen.getByText('System Preferences')).toBeDefined()

    // Verify populated input field
    const nameInput = screen.getByDisplayValue('Northstar Retail Store') as HTMLInputElement
    expect(nameInput).toBeDefined()
  })

  it('switches between tabs and updates tax configuration', async () => {
    vi.spyOn(settingsService, 'getSettings').mockResolvedValue({
      businessId: 'biz_test_settings',
      name: 'Northstar Retail Store',
      currency: 'PKR',
      country: 'Pakistan',
      timezone: 'Asia/Karachi',
      defaultTaxRate: 16.0,
      allowNegativeStock: true,
      maxVoidHours: 24,
      updatedAt: '2026-11-09T00:00:00Z',
    })

    const updateSpy = vi.spyOn(settingsService, 'updateSettings').mockResolvedValueOnce({
      businessId: 'biz_test_settings',
      name: 'Northstar Retail Store',
      currency: 'PKR',
      country: 'Pakistan',
      timezone: 'Asia/Karachi',
      defaultTaxRate: 18.0,
      allowNegativeStock: true,
      maxVoidHours: 24,
      updatedAt: '2026-11-09T00:00:00Z',
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Tax Configuration')).toBeDefined()
    })

    // Click Tax Configuration tab
    fireEvent.click(screen.getByText('Tax Configuration'))

    // Verify Tax settings view
    expect(screen.getByText('Default Tax Rate (%)')).toBeDefined()
    const taxInput = screen.getByDisplayValue('16') as HTMLInputElement

    fireEvent.change(taxInput, { target: { value: '18' } })

    // Click Save Changes
    const saveBtn = screen.getAllByText('Save Changes')[0]
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalled()
      expect(screen.getByText('Business settings updated and saved successfully.')).toBeDefined()
    })
  })
})
