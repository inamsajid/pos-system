import React from 'react'
import { formatCurrency } from '../../../lib/currency'

export interface LedgerBalanceDisplayProps {
  balance: number
  type: 'customer' | 'supplier'
  label?: string
}

export const LedgerBalanceDisplay: React.FC<LedgerBalanceDisplayProps> = ({
  balance,
  type,
  label,
}) => {
  const isZero = Math.abs(balance) < 0.01

  // For customer: balance > 0 means Customer Owes (Receivable), balance < 0 means Customer is in Advance
  // For supplier: balance > 0 means Business Owes (Payable), balance < 0 means Business is in Advance
  let statusBadge = ''
  let badgeColor = ''
  let displayTitle = label

  if (type === 'customer') {
    if (!displayTitle) displayTitle = 'Customer Balance'
    if (isZero) {
      statusBadge = 'Settled'
      badgeColor = 'bg-slate-100 text-slate-700 border-slate-200'
    } else if (balance > 0) {
      statusBadge = 'Receivable (Due)'
      badgeColor = 'bg-amber-50 text-amber-700 border-amber-200'
    } else {
      statusBadge = 'Advance Credit'
      badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200'
    }
  } else {
    if (!displayTitle) displayTitle = 'Supplier Balance'
    if (isZero) {
      statusBadge = 'Settled'
      badgeColor = 'bg-slate-100 text-slate-700 border-slate-200'
    } else if (balance > 0) {
      statusBadge = 'Payable (Liability)'
      badgeColor = 'bg-rose-50 text-rose-700 border-rose-200'
    } else {
      statusBadge = 'Supplier Advance'
      badgeColor = 'bg-blue-50 text-blue-700 border-blue-200'
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <span className="text-xs text-slate-500">{displayTitle}: </span>
        <span className="text-base font-bold text-slate-900">{formatCurrency(Math.abs(balance))}</span>
      </div>
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badgeColor}`}
      >
        {statusBadge}
      </span>
    </div>
  )
}

