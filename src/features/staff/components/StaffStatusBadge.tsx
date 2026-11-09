import React from 'react'

export interface StaffStatusBadgeProps {
  isActive: boolean
  className?: string
}

export const StaffStatusBadge: React.FC<StaffStatusBadgeProps> = ({ isActive, className = '' }) => {
  if (isActive) {
    return (
      <span
        className={`inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ${className}`}
      >
        Active
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ${className}`}
    >
      Suspended
    </span>
  )
}

