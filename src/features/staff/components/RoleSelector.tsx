import React from 'react'
import type { StaffRole } from '../types/staff.types'

export interface RoleSelectorProps {
  value: StaffRole
  onChange: (role: StaffRole) => void
  actorRole?: StaffRole
  disabled?: boolean
  className?: string
  id?: string
  name?: string
}

interface RoleOption {
  value: StaffRole
  label: string
  description: string
  requiresOwner: boolean
}

const ROLES: RoleOption[] = [
  {
    value: 'owner',
    label: 'Owner',
    description: 'Full business authority, settings, staff, finances, backups.',
    requiresOwner: true,
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Team management, catalog, branch operations, reports.',
    requiresOwner: true,
  },
  {
    value: 'manager',
    label: 'Branch Manager',
    description: 'Daily branch operations, sales, purchases, expenses, stock counts.',
    requiresOwner: false,
  },
  {
    value: 'cashier',
    label: 'Cashier',
    description: 'POS register checkout, cash collection, customer receipts.',
    requiresOwner: false,
  },
  {
    value: 'inventory_manager',
    label: 'Inventory Manager',
    description: 'Stock management, receipts, supplier purchases, adjustments.',
    requiresOwner: false,
  },
  {
    value: 'accountant',
    label: 'Accountant',
    description: 'Receivables, payables, customer & supplier ledgers, expenses, reports.',
    requiresOwner: false,
  },
]

export const RoleSelector: React.FC<RoleSelectorProps> = ({
  value,
  onChange,
  actorRole = 'owner',
  disabled = false,
  className = '',
  id,
  name,
}) => {
  const isOwner = actorRole === 'owner'

  return (
    <select
      id={id}
      name={name}
      aria-label="Staff Role"
      value={value}
      onChange={(e) => onChange(e.target.value as StaffRole)}
      disabled={disabled}
      className={`rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400 ${className}`}
    >
      {ROLES.map((role) => {
        // Non-owners cannot select owner or admin
        const cannotSelect = role.requiresOwner && !isOwner
        return (
          <option key={role.value} value={role.value} disabled={cannotSelect}>
            {role.label} {cannotSelect ? '(Owner only)' : ''} — {role.description}
          </option>
        )
      })}
    </select>
  )
}

