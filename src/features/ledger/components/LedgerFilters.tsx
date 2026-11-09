import React from 'react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { Search, RotateCcw } from 'lucide-react'

export interface LedgerTypeOption {
  value: string
  label: string
}

export interface LedgerFiltersProps {
  searchQuery: string
  onSearchChange: (val: string) => void
  selectedType: string
  onTypeChange: (val: string) => void
  typeOptions?: LedgerTypeOption[]
  fromDate: string
  onFromDateChange: (val: string) => void
  toDate: string
  onToDateChange: (val: string) => void
  onClear: () => void
  className?: string
}

const DEFAULT_TYPE_OPTIONS: LedgerTypeOption[] = [
  { value: '', label: 'All transaction types' },
  { value: 'opening', label: 'Opening balance' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'purchase', label: 'Purchase bills' },
  { value: 'payment', label: 'Payments' },
]

export const LedgerFilters: React.FC<LedgerFiltersProps> = ({
  searchQuery,
  onSearchChange,
  selectedType,
  onTypeChange,
  typeOptions = DEFAULT_TYPE_OPTIONS,
  fromDate,
  onFromDateChange,
  toDate,
  onToDateChange,
  onClear,
  className = '',
}) => {
  return (
    <Card className={`mb-4 grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5 ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          aria-label="Search ledger"
          placeholder="Search reference or description"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <select
        aria-label="Transaction type"
        value={selectedType}
        onChange={(e) => onTypeChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {typeOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <input
        aria-label="From date"
        type="date"
        value={fromDate}
        onChange={(e) => onFromDateChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      <input
        aria-label="To date"
        type="date"
        value={toDate}
        onChange={(e) => onToDateChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

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

