// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../src/features/auth/context/AuthContext'
import { ExpenseCategorySelect } from '../src/features/expenses/components/ExpenseCategorySelect'
import { ExpenseFilters } from '../src/features/expenses/components/ExpenseFilters'
import { ExpenseSummary } from '../src/features/expenses/components/ExpenseSummary'
import { ExpenseTable } from '../src/features/expenses/components/ExpenseTable'
import { ExpenseForm } from '../src/features/expenses/components/ExpenseForm'
import { ExpensesPage } from '../src/features/expenses/pages/ExpensesPage'
import type { Expense, ExpenseCategory, ExpenseSummary as ExpenseSummaryData } from '../src/features/expenses/types/expense.types'

const mockCategories: ExpenseCategory[] = [
  { id: 'cat-1', name: 'Utilities', status: 'active' },
  { id: 'cat-2', name: 'Supplies', status: 'active' },
  { id: 'cat-3', name: 'Rent', status: 'archived' },
]

const mockExpenses: Expense[] = [
  {
    id: 'exp-1',
    businessId: 'biz-1',
    branchId: 'br-1',
    branchName: 'Main Store',
    expenseNumber: 'EXP-20261109-0001',
    categoryId: 'cat-1',
    categoryName: 'Utilities',
    amountMinor: 500000,
    amount: 5000,
    paymentMethod: 'bank_transfer',
    title: 'Electricity Bill',
    notes: 'October meter reading',
    businessDateKey: '2026-11-09',
    createdBy: 'usr-1',
    createdByName: 'Manager',
    createdAt: '2026-11-09T10:00:00Z',
    status: 'posted',
  },
  {
    id: 'exp-2',
    businessId: 'biz-1',
    branchId: 'br-1',
    branchName: 'Main Store',
    expenseNumber: 'EXP-20261108-0002',
    categoryId: 'cat-2',
    categoryName: 'Supplies',
    amountMinor: 150000,
    amount: 1500,
    paymentMethod: 'cash',
    title: 'Thermal Paper Rolls',
    notes: 'Register printer rolls',
    businessDateKey: '2026-11-08',
    createdBy: 'usr-1',
    createdByName: 'Cashier',
    createdAt: '2026-11-08T14:30:00Z',
    status: 'voided',
    voidReason: 'Duplicate entry',
  },
]

const mockSummary: ExpenseSummaryData = {
  totalCount: 2,
  totalAmountMinor: 650000,
  postedCount: 1,
  postedAmountMinor: 500000,
  voidedCount: 1,
  voidedAmountMinor: 150000,
  todayAmountMinor: 500000,
  thisMonthAmountMinor: 500000,
  byCategory: [{ categoryId: 'cat-1', categoryName: 'Utilities', amountMinor: 500000, count: 1 }],
  byPaymentMethod: [{ method: 'bank_transfer', amountMinor: 500000, count: 1 }],
}

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

describe('Step 14.2 — Expenses Management Frontend Components', () => {
  beforeEach(() => {
    cleanup()
  })

  it('renders ExpenseCategorySelect with options and handles selection', () => {
    const onChange = vi.fn()
    render(
      <ExpenseCategorySelect
        categories={mockCategories}
        value="cat-1"
        onChange={onChange}
        includeAllOption
      />
    )

    expect(screen.getByText('All Categories')).toBeDefined()
    expect(screen.getByText('Utilities')).toBeDefined()
    expect(screen.getByText('Supplies')).toBeDefined()

    const select = screen.getByLabelText('Expense Category')
    fireEvent.change(select, { target: { value: 'cat-2' } })
    expect(onChange).toHaveBeenCalledWith('cat-2')
  })

  it('renders ExpenseFilters and triggers filter changes and clear', () => {
    const onChange = vi.fn()
    const onClear = vi.fn()

    render(
      <ExpenseFilters
        filters={{ page: 1, limit: 25 }}
        categories={mockCategories}
        onChange={onChange}
        onClear={onClear}
      />
    )

    const searchInput = screen.getByLabelText('Search expenses')
    fireEvent.change(searchInput, { target: { value: 'Electric' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'Electric' }))

    const clearBtn = screen.getByText('Clear filters')
    fireEvent.click(clearBtn)
    expect(onClear).toHaveBeenCalled()
  })

  it('renders ExpenseSummary metric cards correctly', () => {
    render(<ExpenseSummary summary={mockSummary} />)

    expect(screen.getByText('Net Posted Expenses')).toBeDefined()
    expect(screen.getByText("Today's Expenses")).toBeDefined()
    expect(screen.getByText('This Month')).toBeDefined()
    expect(screen.getByText('Voided Expenses')).toBeDefined()
  })

  it('renders ExpenseTable with posted and voided items and handles actions', () => {
    const onView = vi.fn()
    const onVoid = vi.fn()

    render(
      <ExpenseTable
        expenses={mockExpenses}
        onView={onView}
        onVoid={onVoid}
        canVoid={true}
      />
    )

    expect(screen.getAllByText('Electricity Bill').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Thermal Paper Rolls').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Void reason: Duplicate entry')).toBeDefined()

    // View action
    const viewButtons = screen.getAllByTitle('View details')
    fireEvent.click(viewButtons[0])
    expect(onView).toHaveBeenCalledWith(mockExpenses[0])

    // Void action (only present for posted items)
    const voidButtons = screen.getAllByTitle('Void expense')
    expect(voidButtons.length).toBe(1)
    fireEvent.click(voidButtons[0])
    expect(onVoid).toHaveBeenCalledWith(mockExpenses[0])
  })

  it('validates ExpenseForm and submits valid draft payload', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const branches = [{ id: 'br-1', name: 'Main Store' }]

    render(
      <ExpenseForm
        categories={mockCategories}
        branches={branches}
        initialBranchId="br-1"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )

    const form = screen.getByRole('button', { name: 'Record Expense' }).closest('form')!

    // Submit without amount triggers validation
    fireEvent.submit(form)
    expect(screen.getByText('Amount must be greater than zero.')).toBeDefined()

    // Fill amount
    const amountInput = screen.getByPlaceholderText('0.00')
    fireEvent.change(amountInput, { target: { value: '250.50' } })

    // Fill title
    const titleInput = screen.getByPlaceholderText(/Electricity bill/i)
    fireEvent.change(titleInput, { target: { value: 'Cleaning Supplies' } })

    // Submit again
    fireEvent.submit(form)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          branchId: 'br-1',
          categoryId: 'cat-1',
          amount: 250.5,
          amountMinor: 25050,
          title: 'Cleaning Supplies',
          paymentMethod: 'cash',
        })
      )
    })
  })

  it('renders ExpensesPage cleanly with header and action buttons', () => {
    renderWithProviders(<ExpensesPage />)

    expect(screen.getAllByText('Expenses Management').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Record Expense')).toBeDefined()
    expect(screen.getByText('Categories')).toBeDefined()
    expect(screen.getByText('Export CSV')).toBeDefined()
  })
})
