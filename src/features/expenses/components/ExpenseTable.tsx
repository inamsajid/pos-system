import React from 'react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/businessDate'
import type { Expense } from '../types/expense.types'
import { Eye, Ban } from 'lucide-react'

export interface ExpenseTableProps {
  expenses: Expense[]
  onView: (expense: Expense) => void
  onVoid: (expense: Expense) => void
  canVoid?: boolean
  emptyMessage?: string
}

export const ExpenseTable: React.FC<ExpenseTableProps> = ({
  expenses,
  onView,
  onVoid,
  canVoid = true,
  emptyMessage = 'No expenses found matching the current criteria.',
}) => {
  const getMethodBadge = (method: string) => {
    switch (method) {
      case 'cash':
        return <span className="inline-flex items-center rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Cash</span>
      case 'bank_transfer':
        return <span className="inline-flex items-center rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">Bank</span>
      case 'card':
        return <span className="inline-flex items-center rounded bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">Card</span>
      default:
        return <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{method}</span>
    }
  }

  return (
    <Card className="overflow-hidden">
      {/* Desktop Table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[850px] text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="p-3">Date</th>
              <th className="p-3">Expense #</th>
              <th className="p-3">Title & Notes</th>
              <th className="p-3">Category</th>
              <th className="p-3">Method</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3 text-center">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {expenses.map((expense) => {
              const isVoided = expense.status === 'voided'
              return (
                <tr
                  key={expense.id}
                  className={`hover:bg-slate-50/50 ${isVoided ? 'bg-slate-50/70 text-slate-400' : ''}`}
                >
                  <td className="whitespace-nowrap p-3">
                    {formatBusinessDate(new Date(expense.createdAt))}
                  </td>
                  <td className="whitespace-nowrap p-3 font-mono font-medium text-slate-700">
                    {expense.expenseNumber}
                  </td>
                  <td className="max-w-xs p-3">
                    <p className={`font-medium ${isVoided ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                      {expense.title}
                    </p>
                    {expense.notes && (
                      <p className="truncate text-[11px] text-slate-500">{expense.notes}</p>
                    )}
                    {isVoided && expense.voidReason && (
                      <p className="mt-0.5 text-[10px] text-rose-500 italic">
                        Void reason: {expense.voidReason}
                      </p>
                    )}
                  </td>
                  <td className="p-3">
                    <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 font-medium">
                      {expense.categoryName || 'General'}
                    </span>
                  </td>
                  <td className="p-3">{getMethodBadge(expense.paymentMethod)}</td>
                  <td className="whitespace-nowrap p-3 text-right font-mono font-bold">
                    <span className={isVoided ? 'line-through text-slate-400' : 'text-slate-900'}>
                      {formatCurrency(expense.amountMinor / 100)}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    {isVoided ? (
                      <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600 border border-rose-200">
                        Voided
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                        Posted
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="secondary"
                        onClick={() => onView(expense)}
                        className="h-7 w-7 p-0"
                        title="View details"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {!isVoided && canVoid && (
                        <Button
                          variant="secondary"
                          onClick={() => onVoid(expense)}
                          className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          title="Void expense"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List */}
      <div className="divide-y divide-slate-100 md:hidden">
        {expenses.map((expense) => {
          const isVoided = expense.status === 'voided'
          return (
            <article key={expense.id} className={`p-4 ${isVoided ? 'bg-slate-50/70' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-500">{expense.expenseNumber}</span>
                {isVoided ? (
                  <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 border border-rose-200">
                    Voided
                  </span>
                ) : (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                    Posted
                  </span>
                )}
              </div>

              <div className="mt-2 flex items-baseline justify-between gap-3">
                <p className={`font-semibold ${isVoided ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                  {expense.title}
                </p>
                <span className={`font-mono font-bold ${isVoided ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                  {formatCurrency(expense.amountMinor / 100)}
                </span>
              </div>

              {expense.notes && (
                <p className="mt-1 text-xs text-slate-500">{expense.notes}</p>
              )}

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-50 pt-2 text-xs">
                <div className="flex items-center gap-2">
                  <span>{expense.categoryName || 'General'}</span>
                  <span>·</span>
                  {getMethodBadge(expense.paymentMethod)}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => onView(expense)}
                    className="h-7 px-2 text-xs"
                  >
                    View
                  </Button>
                  {!isVoided && canVoid && (
                    <Button
                      variant="secondary"
                      onClick={() => onVoid(expense)}
                      className="h-7 px-2 text-xs text-rose-600"
                    >
                      Void
                    </Button>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {expenses.length === 0 && (
        <p className="p-8 text-center text-sm text-slate-500">{emptyMessage}</p>
      )}
    </Card>
  )
}
