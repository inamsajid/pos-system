import React from 'react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Search, RotateCcw } from 'lucide-react'
import type { StaffFilters as StaffFilterParams, StaffRole } from '../types/staff.types'

export interface StaffFiltersProps {
  filters: StaffFilterParams
  onChange: (filters: StaffFilterParams) => void
  onClear: () => void
  className?: string
}

export const StaffFilters: React.FC<StaffFiltersProps> = ({
  filters,
  onChange,
  onClear,
  className = '',
}) => {
  return (
    <Card className={`mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 ${className}`}>
      {/* Search */}
      <div className="relative sm:col-span-2">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          aria-label="Search staff"
          placeholder="Search by name, email, or phone..."
          value={filters.search || ''}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Role */}
      <select
        aria-label="Filter by role"
        value={filters.role || ''}
        onChange={(e) =>
          onChange({
            ...filters,
            role: (e.target.value as StaffRole) || undefined,
          })
        }
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">All Roles</option>
        <option value="owner">Owner</option>
        <option value="admin">Admin</option>
        <option value="manager">Manager</option>
        <option value="cashier">Cashier</option>
        <option value="inventory_manager">Inventory Manager</option>
        <option value="accountant">Accountant</option>
      </select>

      {/* Status & Clear */}
      <div className="flex items-center gap-2">
        <select
          aria-label="Filter by status"
          value={filters.isActive === undefined ? '' : filters.isActive ? 'active' : 'suspended'}
          onChange={(e) => {
            const val = e.target.value
            onChange({
              ...filters,
              isActive: val === '' ? undefined : val === 'active',
            })
          }}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Statuses</option>
          <option value="active">Active Only</option>
          <option value="suspended">Suspended Only</option>
        </select>

        <Button
          variant="secondary"
          onClick={onClear}
          className="flex shrink-0 items-center justify-center gap-1.5"
          title="Reset filters"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>
      </div>
    </Card>
  )
}

