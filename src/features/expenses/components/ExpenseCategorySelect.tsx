import React from 'react'
import type { ExpenseCategory } from '../types/expense.types'

export interface ExpenseCategorySelectProps {
  categories: ExpenseCategory[]
  value: string
  onChange: (value: string) => void
  includeAllOption?: boolean
  allOptionLabel?: string
  required?: boolean
  disabled?: boolean
  className?: string
  id?: string
  name?: string
  'aria-label'?: string
}

export const ExpenseCategorySelect: React.FC<ExpenseCategorySelectProps> = ({
  categories,
  value,
  onChange,
  includeAllOption = false,
  allOptionLabel = 'All Categories',
  required = false,
  disabled = false,
  className = '',
  id,
  name,
  'aria-label': ariaLabel = 'Expense Category',
}) => {
  return (
    <select
      id={id}
      name={name}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      disabled={disabled}
      className={`rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400 ${className}`}
    >
      {includeAllOption && <option value="">{allOptionLabel}</option>}
      {categories.map((cat) => (
        <option key={cat.id} value={cat.id}>
          {cat.name}
        </option>
      ))}
    </select>
  )
}

