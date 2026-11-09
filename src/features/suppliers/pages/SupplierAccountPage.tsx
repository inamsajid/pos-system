import { useState, useMemo, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, Building2 } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { supplierService } from '../services/supplierService'
import type { Supplier } from '../types/supplier.types'
import { useSupplierLedger } from '../../ledger/hooks/useSupplierLedger'
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

export function SupplierAccountPage() {
  const params = useParams()
  const supplierId = params.supplierId || params.id || ''

  const [supplier, setSupplier] = useState<Supplier>()
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  useEffect(() => {
    if (supplierId) {
      void supplierService.getSupplierById(supplierId).then(setSupplier)
    }
  }, [supplierId])

  const { entries, summary, isLoading } = useSupplierLedger(supplierId)

  // Filter entries
  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      const matchesType = !type || entry.type === type
      const matchesDate = isWithinBusinessDateRange(entry.date, fromDate, toDate)
      const matchesQuery =
        !query ||
        [entry.reference, entry.description].some((val) =>
          val.toLowerCase().includes(query.toLowerCase())
        )
      return matchesType && matchesDate && matchesQuery
    })
  }, [entries, type, fromDate, toDate, query])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginatedEntries = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  // Map to LedgerRowData
  const tableRows: LedgerRowData[] = useMemo(() => {
    return paginatedEntries.map((entry) => {
      return {
        id: entry.id,
        date: entry.date,
        type: entry.type,
        reference: entry.reference,
        description: entry.description,
        debit: entry.debit,
        credit: entry.credit,
        balance: entry.balance,
        purchaseId: entry.purchaseId,
        paymentId: entry.paymentId,
      }
    })
  }, [paginatedEntries])

  // Summary cards
  const summaryItems: LedgerSummaryItem[] = useMemo(() => {
    const opening = summary?.openingPayable ?? 0
    const totalPurchases = summary?.totalPurchases ?? 0
    const totalPaid = summary?.totalPaid ?? 0
    const outstanding = summary?.outstandingPayable ?? 0
    const advances = summary?.advanceBalance ?? 0

    return [
      { label: 'Opening payable', value: opening },
      { label: 'Purchases (Credit)', value: totalPurchases },
      { label: 'Payments (Debit)', value: totalPaid, variant: 'success' },
      {
        label: 'Outstanding payable',
        value: outstanding,
        variant: outstanding > 0 ? 'danger' : 'default',
      },
      { label: 'Unallocated advance', value: advances, variant: advances > 0 ? 'success' : 'default' },
    ]
  }, [summary])

  const exportCsv = () => {
    const data = [
      ['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
      ...filtered.map((entry) => [
        entry.date,
        entry.type,
        entry.reference,
        entry.description,
        String(entry.debit),
        String(entry.credit),
        String(entry.balance),
      ]),
    ]
    const csv = data
      .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `supplier-ledger-${supplierId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleClearFilters = () => {
    setQuery('')
    setType('')
    setFromDate('')
    setToDate('')
    setPage(1)
  }

  if (!supplier && !isLoading) {
    return (
      <PageHeader
        title="Supplier not found"
        description="The requested supplier does not exist."
        action={
          <Link to="/suppliers">
            <Button variant="secondary">Back to suppliers</Button>
          </Link>
        }
      />
    )
  }

  return (
    <>
      <PageHeader
        title={`${supplier?.name || 'Supplier'} — Account & Ledger`}
        description="Read-only account ledger calculated from opening balance, confirmed purchase bills and recorded payments."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={exportCsv} className="flex items-center gap-1.5">
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Link to="/ledger">
              <Button variant="secondary">All Ledgers</Button>
            </Link>
            {supplier && (
              <Link to={`/suppliers/${supplierId}`}>
                <Button variant="secondary" className="flex items-center gap-1.5">
                  <Building2 className="h-4 w-4" />
                  Supplier Profile
                </Button>
              </Link>
            )}
            {supplier && (
              <Link to={`/supplier-payments/new?supplierId=${supplierId}`}>
                <Button variant="primary">Record Payment</Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <LedgerBalanceDisplay
          balance={summary?.currentAccountBalance ?? summary?.outstandingPayable ?? 0}
          type="supplier"
          label="Net Accounts Payable"
        />
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>Supplier Code: <strong>{supplier?.supplierCode || '—'}</strong></span>
          {supplier?.phone && <span>Phone: <strong>{supplier.phone}</strong></span>}
        </div>
      </div>

      <LedgerSummaryCards items={summaryItems} columns={5} />

      <LedgerFilters
        searchQuery={query}
        onSearchChange={(val) => {
          setQuery(val)
          setPage(1)
        }}
        selectedType={type}
        onTypeChange={(val) => {
          setType(val)
          setPage(1)
        }}
        typeOptions={[
          { value: '', label: 'All transaction types' },
          { value: 'opening', label: 'Opening balance' },
          { value: 'purchase', label: 'Purchase bills' },
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
        source="supplier"
        emptyMessage="No supplier ledger entries match these filters."
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
