import React from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../../../components/ui/Card'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/businessDate'

export interface LedgerRowData {
  id: string
  date: string
  type: string
  reference: string
  description: string
  debit: number
  credit: number
  balance: number
  invoiceId?: string
  saleId?: string
  paymentId?: string
  purchaseId?: string
}

export interface LedgerTableProps {
  entries: LedgerRowData[]
  source: 'customer' | 'supplier'
  emptyMessage?: string
}

export const LedgerTable: React.FC<LedgerTableProps> = ({
  entries,
  source,
  emptyMessage = 'No ledger transactions match these filters.',
}) => {
  const renderReferenceLink = (entry: LedgerRowData) => {
    if (source === 'customer') {
      if (entry.invoiceId) {
        return (
          <Link
            to={`/invoices/${entry.invoiceId}`}
            className="font-medium text-blue-600 hover:underline"
          >
            {entry.reference}
          </Link>
        )
      }
      if (entry.saleId) {
        return (
          <Link
            to={`/sales/${entry.saleId}`}
            className="font-medium text-blue-600 hover:underline"
          >
            {entry.reference}
          </Link>
        )
      }
      if (entry.paymentId) {
        return (
          <Link
            to={`/payments/${entry.paymentId}`}
            className="font-medium text-blue-600 hover:underline"
          >
            {entry.reference}
          </Link>
        )
      }
    } else {
      // Supplier source
      if (entry.purchaseId) {
        return (
          <Link
            to={`/purchases/${entry.purchaseId}`}
            className="font-medium text-blue-600 hover:underline"
          >
            {entry.reference}
          </Link>
        )
      }
      if (entry.paymentId) {
        return (
          <Link
            to={`/supplier-payments/${entry.paymentId}`}
            className="font-medium text-blue-600 hover:underline"
          >
            {entry.reference}
          </Link>
        )
      }
    }

    return <span className="font-medium text-slate-800">{entry.reference}</span>
  }

  const getTypeBadgeClass = (type: string) => {
    switch (type.toLowerCase()) {
      case 'invoice':
      case 'purchase':
        return 'bg-blue-50 text-blue-700'
      case 'payment':
        return 'bg-emerald-50 text-emerald-700'
      case 'opening':
        return 'bg-slate-100 text-slate-700'
      default:
        return 'bg-slate-50 text-slate-600'
    }
  }

  return (
    <Card className="overflow-hidden">
      {/* Desktop view */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="p-3">Date</th>
              <th className="p-3">Type</th>
              <th className="p-3">Reference</th>
              <th className="p-3">Description</th>
              <th className="p-3 text-right">Debit</th>
              <th className="p-3 text-right">Credit</th>
              <th className="p-3 text-right">Running Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <tr key={entry.id} className="hover:bg-slate-50/50">
                <td className="whitespace-nowrap p-3 text-slate-600">
                  {formatBusinessDate(new Date(entry.date))}
                </td>
                <td className="p-3">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium capitalize ${getTypeBadgeClass(
                      entry.type
                    )}`}
                  >
                    {entry.type}
                  </span>
                </td>
                <td className="p-3 whitespace-nowrap">{renderReferenceLink(entry)}</td>
                <td className="max-w-xs truncate p-3 text-slate-600">{entry.description}</td>
                <td className="whitespace-nowrap p-3 text-right text-slate-700 font-mono">
                  {entry.debit > 0 ? formatCurrency(entry.debit) : '—'}
                </td>
                <td className="whitespace-nowrap p-3 text-right text-slate-700 font-mono">
                  {entry.credit > 0 ? formatCurrency(entry.credit) : '—'}
                </td>
                <td className="whitespace-nowrap p-3 text-right font-bold text-slate-900 font-mono">
                  {formatCurrency(entry.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile view */}
      <div className="divide-y divide-slate-100 md:hidden">
        {entries.map((entry) => (
          <article key={entry.id} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${getTypeBadgeClass(
                  entry.type
                )}`}
              >
                {entry.type}
              </span>
              <span className="text-xs text-slate-500">
                {formatBusinessDate(new Date(entry.date))}
              </span>
            </div>

            <div className="mt-2 flex items-baseline justify-between gap-3">
              <div>{renderReferenceLink(entry)}</div>
              <span className="font-bold text-slate-900 font-mono">
                {formatCurrency(entry.balance)}
              </span>
            </div>

            {entry.description && (
              <p className="mt-1 text-xs text-slate-500 line-clamp-2">{entry.description}</p>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-slate-50 pt-2 text-xs text-slate-600 font-mono">
              <span>Debit: {entry.debit > 0 ? formatCurrency(entry.debit) : '—'}</span>
              <span>Credit: {entry.credit > 0 ? formatCurrency(entry.credit) : '—'}</span>
            </div>
          </article>
        ))}
      </div>

      {entries.length === 0 && (
        <p className="p-8 text-center text-sm text-slate-500">{emptyMessage}</p>
      )}
    </Card>
  )
}

