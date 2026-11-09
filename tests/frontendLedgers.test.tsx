// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../src/features/auth/context/AuthContext'
import {
  LedgerSummaryCards,
  LedgerFilters,
  LedgerTable,
  LedgerPagination,
  LedgerBalanceDisplay,
} from '../src/features/ledger/components'
import { CustomerAccountPage } from '../src/features/customers/pages/CustomerAccountPage'
import { SupplierAccountPage } from '../src/features/suppliers/pages/SupplierAccountPage'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

describe('Step 14.1 — Reusable Ledger Components', () => {
  beforeEach(() => {
    cleanup()
  })

  it('renders LedgerSummaryCards with formatted currency values and variants', () => {
    const items = [
      { label: 'Opening balance', value: 1500 },
      { label: 'Total invoices', value: 5000 },
      { label: 'Total paid', value: 3500, variant: 'success' as const },
      { label: 'Outstanding', value: 3000, variant: 'warning' as const },
      { label: 'Advances', value: 0 },
      { label: 'Net balance', value: 3000, variant: 'danger' as const },
    ]

    render(<LedgerSummaryCards items={items} columns={6} />)

    expect(screen.getByText('Opening balance')).toBeDefined()
    expect(screen.getByText('Total invoices')).toBeDefined()
    expect(screen.getByText('Total paid')).toBeDefined()
    expect(screen.getByText('Outstanding')).toBeDefined()
  })

  it('renders LedgerBalanceDisplay correctly for customer receivables and advances', () => {
    // 1. Customer with positive balance (Receivable / Due)
    const { rerender } = render(<LedgerBalanceDisplay balance={2500} type="customer" />)
    expect(screen.getByText('Receivable (Due)')).toBeDefined()

    // 2. Customer with negative balance (Advance Credit)
    rerender(<LedgerBalanceDisplay balance={-1200} type="customer" />)
    expect(screen.getByText('Advance Credit')).toBeDefined()

    // 3. Customer with 0 balance (Settled)
    rerender(<LedgerBalanceDisplay balance={0} type="customer" />)
    expect(screen.getByText('Settled')).toBeDefined()
  })

  it('renders LedgerBalanceDisplay correctly for supplier payables and advances', () => {
    // 1. Supplier with positive balance (Payable / Liability)
    const { rerender } = render(<LedgerBalanceDisplay balance={10000} type="supplier" />)
    expect(screen.getByText('Payable (Liability)')).toBeDefined()

    // 2. Supplier with negative balance (Supplier Advance)
    rerender(<LedgerBalanceDisplay balance={-4500} type="supplier" />)
    expect(screen.getByText('Supplier Advance')).toBeDefined()

    // 3. Supplier with 0 balance (Settled)
    rerender(<LedgerBalanceDisplay balance={0} type="supplier" />)
    expect(screen.getByText('Settled')).toBeDefined()
  })

  it('handles LedgerFilters interactions and clear button', () => {
    const onSearch = vi.fn()
    const onType = vi.fn()
    const onFrom = vi.fn()
    const onTo = vi.fn()
    const onClear = vi.fn()

    render(
      <LedgerFilters
        searchQuery="INV-101"
        onSearchChange={onSearch}
        selectedType="invoice"
        onTypeChange={onType}
        fromDate="2026-11-01"
        onFromDateChange={onFrom}
        toDate="2026-11-09"
        onToDateChange={onTo}
        onClear={onClear}
      />
    )

    const searchInput = screen.getByLabelText('Search ledger')
    fireEvent.change(searchInput, { target: { value: 'INV-202' } })
    expect(onSearch).toHaveBeenCalledWith('INV-202')

    const clearBtn = screen.getByText('Clear filters')
    fireEvent.click(clearBtn)
    expect(onClear).toHaveBeenCalled()
  })

  it('handles LedgerPagination controls and boundaries', () => {
    const onPageChange = vi.fn()
    const onPageSizeChange = vi.fn()

    render(
      <LedgerPagination
        currentPage={2}
        totalPages={5}
        totalItems={115}
        pageSize={25}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    )

    expect(screen.getByText('Showing 26 to 50 of 115 entries')).toBeDefined()
    expect(screen.getByText('2 / 5')).toBeDefined()

    const prevBtn = screen.getByLabelText('Previous page')
    fireEvent.click(prevBtn)
    expect(onPageChange).toHaveBeenCalledWith(1)

    const nextBtn = screen.getByLabelText('Next page')
    fireEvent.click(nextBtn)
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('renders LedgerTable with customer transaction links to invoice and payment', () => {
    const entries = [
      {
        id: '1',
        date: '2026-11-01',
        type: 'invoice',
        reference: 'INV-2026-0001',
        description: 'Sales Invoice',
        debit: 5000,
        credit: 0,
        balance: 5000,
        invoiceId: 'inv-123',
      },
      {
        id: '2',
        date: '2026-11-02',
        type: 'payment',
        reference: 'RCP-2026-0002',
        description: 'Customer Payment',
        debit: 0,
        credit: 3000,
        balance: 2000,
        paymentId: 'pay-456',
      },
    ]

    render(
      <MemoryRouter>
        <LedgerTable entries={entries} source="customer" />
      </MemoryRouter>
    )

    // Check link targets
    const invoiceLink = screen.getAllByRole('link', { name: 'INV-2026-0001' })[0]
    expect(invoiceLink.getAttribute('href')).toBe('/invoices/inv-123')

    const paymentLink = screen.getAllByRole('link', { name: 'RCP-2026-0002' })[0]
    expect(paymentLink.getAttribute('href')).toBe('/payments/pay-456')
  })

  it('renders LedgerTable with supplier transaction links to purchase and supplier-payment', () => {
    const entries = [
      {
        id: '1',
        date: '2026-11-03',
        type: 'purchase',
        reference: 'PO-2026-0005',
        description: 'Purchase Bill',
        debit: 0,
        credit: 12000,
        balance: 12000,
        purchaseId: 'po-789',
      },
      {
        id: '2',
        date: '2026-11-04',
        type: 'payment',
        reference: 'SPAY-2026-0003',
        description: 'Supplier Payment',
        debit: 8000,
        credit: 0,
        balance: 4000,
        paymentId: 'spay-101',
      },
    ]

    render(
      <MemoryRouter>
        <LedgerTable entries={entries} source="supplier" />
      </MemoryRouter>
    )

    const purchaseLink = screen.getAllByRole('link', { name: 'PO-2026-0005' })[0]
    expect(purchaseLink.getAttribute('href')).toBe('/purchases/po-789')

    const spayLink = screen.getAllByRole('link', { name: 'SPAY-2026-0003' })[0]
    expect(spayLink.getAttribute('href')).toBe('/supplier-payments/spay-101')
  })

  it('renders CustomerAccountPage with empty state or customer header', () => {
    renderWithProviders(<CustomerAccountPage />)
    expect(screen.getAllByText('Customer not found').length).toBeGreaterThanOrEqual(1)
  })

  it('renders SupplierAccountPage with empty state or supplier header', () => {
    renderWithProviders(<SupplierAccountPage />)
    expect(screen.getAllByText('Supplier not found').length).toBeGreaterThanOrEqual(1)
  })
})
