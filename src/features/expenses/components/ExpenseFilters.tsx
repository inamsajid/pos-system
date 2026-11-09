import React from 'react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Search, RotateCcw } from 'lucide-react'
import { ExpenseCategorySelect } from './ExpenseCategorySelect'
import type { ExpenseCategory, ExpenseFilterParams, ExpensePaymentMethod, ExpenseStatus } from '../types/expense.types'

export interface ExpenseFiltersProps {
  filters: ExpenseFilterParams
  categories: ExpenseCategory[]
  onChange: (filters: ExpenseFilterParams) => void
  onClear: () => void
  className?: string
}

export const ExpenseFilters: React.FC<ExpenseFiltersProps> = ({
  filters,
  categories,
  onChange,
  onClear,
  className = '',
}) => {
  return (
    <Card className={`mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 ${className}`}>
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          aria-label="Search expenses"
          placeholder="Search number, title, notes"
          value={filters.search || ''}
          onChange={(e) => onChange({ ...filters, search: e.target.value, page: 1 })}
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Category */}
      <ExpenseCategorySelect
        categories={categories}
        value={filters.categoryId || ''}
        onChange={(val) => onChange({ ...filters, categoryId: val || undefined, page: 1 })}
        includeAllOption
        allOptionLabel="All Categories"
        aria-label="Filter by category"
        className="w-full"
      />

      {/* Payment Method */}
      <select
        aria-label="Filter by payment method"
        value={filters.paymentMethod || ''}
        onChange={(e) =>
          onChange({
            ...filters,
            paymentMethod: (e.target.value as ExpensePaymentMethod) || undefined,
            page: 1,
          })
        }
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">All Payment Methods</option>
        <option value="cash">Cash (Drawer)</option>
        <option value="bank_transfer">Bank Transfer</option>
        <option value="card">Card</option>
        <option value="other">Other</option>
      </select>

      {/* Status */}
      <select
        aria-label="Filter by status"
        value={filters.status || ''}
        onChange={(e) =>
          onChange({
            ...filters,
            status: (e.target.value as ExpenseStatus) || undefined,
            page: 1,
          })
        }
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">All Statuses</option>
        <option value="posted">Posted (Active)</option>
        <option value="voided">Voided</option>
      </select>

      {/* Start Date */}
      <input
        aria-label="Start date"
        type="date"
        value={filters.startDate || ''}
        onChange={(e) => onChange({ ...filters, startDate: e.target.value || undefined, page: 1 })}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      {/* Clear Filters */}
      <Button
        variant="secondary"
        onClick={onClear}
        className="flex items-center justify-center gap-1.5"
      >
        <RotateCcw className="h-4 w-4" />
        Clear filters
      </Button>
    </Card>
  )
}

