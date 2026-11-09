import React from 'react'
import { Card } from '../../../components/ui/Card'
import { formatCurrency } from '../../../lib/currency'
import type { ExpenseSummary as ExpenseSummaryData } from '../types/expense.types'
import { TrendingDown, Calendar, CreditCard, Ban } from 'lucide-react'

export interface ExpenseSummaryProps {
  summary: ExpenseSummaryData | undefined
  isLoading?: boolean
}

export const ExpenseSummary: React.FC<ExpenseSummaryProps> = ({ summary, isLoading }) => {
  if (isLoading || !summary) {
    return (
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="animate-pulse p-4">
            <div className="h-4 w-20 rounded bg-slate-200" />
            <div className="mt-2 h-7 w-28 rounded bg-slate-200" />
          </Card>
        ))}
      </div>
    )
  }

  const cards = [
    {
      title: 'Net Posted Expenses',
      value: formatCurrency(summary.postedAmountMinor / 100),
      count: `${summary.postedCount} transactions`,
      icon: TrendingDown,
      color: 'text-slate-900',
      badgeColor: 'bg-blue-50 text-blue-700',
    },
    {
      title: "Today's Expenses",
      value: formatCurrency(summary.todayAmountMinor / 100),
      count: 'Recorded today',
      icon: Calendar,
      color: 'text-slate-900',
      badgeColor: 'bg-emerald-50 text-emerald-700',
    },
    {
      title: 'This Month',
      value: formatCurrency(summary.thisMonthAmountMinor / 100),
      count: 'Current calendar month',
      icon: CreditCard,
      color: 'text-slate-900',
      badgeColor: 'bg-purple-50 text-purple-700',
    },
    {
      title: 'Voided Expenses',
      value: formatCurrency(summary.voidedAmountMinor / 100),
      count: `${summary.voidedCount} cancelled`,
      icon: Ban,
      color: 'text-rose-600',
      badgeColor: 'bg-rose-50 text-rose-700',
    },
  ]

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Card key={card.title} className="p-4 transition-shadow hover:shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">{card.title}</span>
              <div className={`rounded-lg p-2 ${card.badgeColor}`}>
                <Icon className="h-4 w-4" />
              </div>
            </div>
            <p className={`mt-2 text-xl font-bold tracking-tight ${card.color}`}>
              {card.value}
            </p>
            <p className="mt-1 text-xs text-slate-400">{card.count}</p>
          </Card>
        )
      })}
    </div>
  )
}

