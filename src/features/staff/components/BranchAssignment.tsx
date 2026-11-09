import React from 'react'
import type { StaffRole } from '../types/staff.types'
import { Building2, Globe } from 'lucide-react'

export interface BranchOption {
  id: string
  name: string
  branchCode?: string
}

export interface BranchAssignmentProps {
  branches: BranchOption[]
  selectedBranchIds: string[]
  onChange: (branchIds: string[]) => void
  role: StaffRole
  disabled?: boolean
  className?: string
}

export const BranchAssignment: React.FC<BranchAssignmentProps> = ({
  branches,
  selectedBranchIds,
  onChange,
  role,
  disabled = false,
  className = '',
}) => {
  const isGlobalRole = role === 'owner' || role === 'admin'

  const toggleBranch = (branchId: string) => {
    if (disabled || isGlobalRole) return
    if (selectedBranchIds.includes(branchId)) {
      onChange(selectedBranchIds.filter((id) => id !== branchId))
    } else {
      onChange([...selectedBranchIds, branchId])
    }
  }

  if (isGlobalRole) {
    return (
      <div className={`rounded-lg border border-blue-200 bg-blue-50/50 p-3.5 text-xs text-blue-900 ${className}`}>
        <div className="flex items-center gap-2 font-semibold">
          <Globe className="h-4 w-4 text-blue-600" />
          <span>All Branches (Global Access)</span>
        </div>
        <p className="mt-1 text-slate-600">
          Members with the <strong className="capitalize">{role}</strong> role automatically hold authorized access to all branches across this business.
        </p>
      </div>
    )
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <label className="block text-xs font-semibold text-slate-700">
        Assigned Branches <span className="text-slate-400 font-normal">(Select at least one)</span>
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {branches.map((b) => {
          const isSelected = selectedBranchIds.includes(b.id)
          return (
            <label
              key={b.id}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-xs transition-colors ${
                isSelected
                  ? 'border-blue-500 bg-blue-50/40 text-blue-900 font-medium'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleBranch(b.id)}
                disabled={disabled}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <Building2 className="h-4 w-4 text-slate-400" />
              <span>
                {b.name} {b.branchCode ? `(${b.branchCode})` : ''}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

