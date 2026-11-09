import { useState, useMemo, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, User } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { customerService } from '../services/customerService'
import type { Customer } from '../types/customer.types'
import { useCustomerLedger } from '../../ledger/hooks/useCustomerLedger'
import {
  LedgerSummaryCards,
  LedgerFilters,
  LedgerTable,
  LedgerPagination,
  LedgerBalanceDisplay,
  type LedgerSummaryItem,
  type LedgerRowData,
} from '../../ledger/components'
import { isWithinBusinessDateRange } from '../../../lib/businessDate'

export function CustomerAccountPage() {
  const params = useParams()
  const customerId = params.customerId || params.id || ''

  const [customer, setCustomer] = useState<Customer>()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  useEffect(() => {
    if (customerId) {
      void customerService.getCustomerById(customerId).then(setCustomer)
    }
  }, [customerId])

  const { entries, summary, isLoading } = useCustomerLedger(customerId)

  // Filter entries
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      const matchesKind = !kind || e.type === kind
      const matchesDate = isWithinBusinessDateRange(e.date, fromDate, toDate)
      const matchesQuery =
        !query ||
        `${e.reference} ${e.description}`.toLowerCase().includes(query.toLowerCase())
      return matchesKind && matchesDate && matchesQuery
    })
  }, [entries, kind, fromDate, toDate, query])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginatedEntries = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  // Map to LedgerRowData
  const tableRows: LedgerRowData[] = useMemo(() => {
    return paginatedEntries.map((e) => {
      const invoiceId = e.invoiceNumber
        ? e.id.startsWith('invoice-')
          ? e.id.replace('invoice-', '')
          : e.id
        : undefined

      return {
        id: e.id,
        date: e.date,
        type: e.type,
        reference: e.reference,
        description: e.description,
        debit: e.debit,
        credit: e.credit,
        balance: e.balance,
        invoiceId,
        paymentId: e.paymentId,
      }
    })
  }, [paginatedEntries])

  // Summary cards items
  const summaryItems: LedgerSummaryItem[] = useMemo(() => {
    const opening = summary?.openingBalance ?? 0
    const totalDebit = (summary?.totalPurchases ?? 0) + opening
    const totalCredit = summary?.totalPaid ?? 0
    const outstanding = summary?.outstandingBalance ?? 0
    const advances = summary?.advanceBalance ?? 0
    const currentBalance = summary?.currentAccountBalance ?? 0

    return [
      { label: 'Opening balance', value: opening },
      { label: 'Total invoices (Debit)', value: totalDebit },
      { label: 'Total paid (Credit)', value: totalCredit, variant: 'success' },
      {
        label: 'Outstanding receivables',
        value: outstanding,
        variant: outstanding > 0 ? 'warning' : 'default',
      },
      { label: 'Unallocated advances', value: advances },
      {
        label: 'Current account balance',
        value: currentBalance,
        variant: currentBalance > 0 ? 'danger' : currentBalance < 0 ? 'success' : 'default',
      },
    ]
  }, [summary])

  const exportCsv = () => {
    const rows = [
      ['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
      ...filtered.map((e) => [
        e.date,
        e.type,
        e.reference,
        e.description,
        String(e.debit),
        String(e.credit),
        String(e.balance),
      ]),
    ]
    const csv = rows
      .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${customer?.customerCode ?? 'customer'}-ledger.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleClearFilters = () => {
    setQuery('')
    setKind('')
    setFromDate('')
    setToDate('')
    setPage(1)
  }

  if (!customer && !isLoading) {
    return (
      <PageHeader
        title="Customer not found"
        description="The requested customer does not exist."
        action={
          <Link to="/customers">
            <Button variant="secondary">Back to customers</Button>
          </Link>
        }
      />
    )
  }

  return (
    <>
      <PageHeader
        title={`${customer?.name || 'Customer'} — Account Ledger`}
        description={`Audit-grade financial statement and transaction history for ${customer?.customerCode || 'account'}.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={exportCsv} className="flex items-center gap-1.5">
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Link to="/ledger">
              <Button variant="secondary">All Ledgers</Button>
            </Link>
            {customer && (
              <Link to={`/customers/${customer.id}`}>
                <Button variant="secondary" className="flex items-center gap-1.5">
                  <User className="h-4 w-4" />
                  Customer Profile
                </Button>
              </Link>
            )}
            {customer && (
              <Link to={`/payments/new?customerId=${customer.id}`}>
                <Button variant="primary">Receive Payment</Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <LedgerBalanceDisplay
          balance={summary?.currentAccountBalance ?? 0}
          type="customer"
          label="Net Account Balance"
        />
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>Customer Code: <strong>{customer?.customerCode || '—'}</strong></span>
          {customer?.phone && <span>Phone: <strong>{customer.phone}</strong></span>}
        </div>
      </div>

      <LedgerSummaryCards items={summaryItems} columns={6} />

      <LedgerFilters
        searchQuery={query}
        onSearchChange={(val) => {
          setQuery(val)
          setPage(1)
        }}
        selectedType={kind}
        onTypeChange={(val) => {
          setKind(val)
          setPage(1)
        }}
        typeOptions={[
          { value: '', label: 'All transaction types' },
          { value: 'opening', label: 'Opening balance' },
          { value: 'invoice', label: 'Invoices' },
          { value: 'payment', label: 'Payments' },
        ]}
        fromDate={fromDate}
        onFromDateChange={(val) => {
          setFromDate(val)
          setPage(1)
        }}
        toDate={toDate}
        onToDateChange={(val) => {
          setToDate(val)
          setPage(1)
        }}
        onClear={handleClearFilters}
      />

      <LedgerTable
        entries={tableRows}
        source="customer"
        emptyMessage="No customer ledger transactions found matching criteria."
      />

      {filtered.length > 0 && (
        <div className="mt-2 bg-white rounded-lg border border-slate-200 overflow-hidden">
          <LedgerPagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(newSize) => {
              setPageSize(newSize)
              setPage(1)
            }}
          />
        </div>
      )}
    </>
  )
}
