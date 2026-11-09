import React from 'react'
import { Card } from '../../../components/ui/Card'
import { formatCurrency } from '../../../lib/currency'

export interface LedgerSummaryItem {
  label: string
  value: number
  description?: string
  variant?: 'default' | 'success' | 'warning' | 'danger'
}

export interface LedgerSummaryCardsProps {
  items: LedgerSummaryItem[]
  columns?: number
}

export const LedgerSummaryCards: React.FC<LedgerSummaryCardsProps> = ({ items, columns = 6 }) => {
  const gridClass =
    columns === 6
      ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6'
      : columns === 5
      ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5'
      : 'grid grid-cols-2 gap-3 sm:grid-cols-4'

  return (
    <div className={`mb-5 ${gridClass}`}>
      {items.map((item, index) => {
        let valueColor = 'text-slate-900'
        if (item.variant === 'danger') valueColor = 'text-rose-600'
        if (item.variant === 'warning') valueColor = 'text-amber-600'
        if (item.variant === 'success') valueColor = 'text-emerald-600'

        return (
          <Card key={`${item.label}-${index}`} className="p-4 transition-shadow hover:shadow-sm">
            <p className="text-xs font-medium text-slate-500">{item.label}</p>
            <p className={`mt-2 text-lg font-bold tracking-tight ${valueColor}`}>
              {formatCurrency(item.value)}
            </p>
            {item.description && (
              <p className="mt-1 text-[11px] text-slate-400">{item.description}</p>
            )}
          </Card>
        )
      })}
    </div>
  )
}

