import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, Users, Truck, ArrowUpRight, ArrowDownLeft, Scale, Download } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { formatCurrency } from '../../../lib/currency'
import { customerService } from '../../customers/services/customerService'
import { fetchCustomerLedgerSummary } from '../../customers/services/customerLedgerService'
import type { Customer, CustomerFinancialSummary } from '../../customers/types/customer.types'
import { supplierService } from '../../suppliers/services/supplierService'
import { fetchSupplierLedgerSummary } from '../../suppliers/services/supplierLedgerService'
import type { Supplier, SupplierFinancialSummary } from '../../suppliers/types/supplier.types'

interface CustomerWithLedger {
  customer: Customer
  summary: CustomerFinancialSummary
}

interface SupplierWithLedger {
  supplier: Supplier
  summary: SupplierFinancialSummary & { currentAccountBalance?: number }
}

export function LedgerPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<'customers' | 'suppliers'>(
    tabFromUrl === 'suppliers' ? 'suppliers' : 'customers'
  )

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'suppliers' || tab === 'customers') {
      setActiveTab(tab)
    }
  }, [searchParams])

  const handleTabChange = (tab: 'customers' | 'suppliers') => {
    setActiveTab(tab)
    setSearchParams({ tab })
  }
  const [loading, setLoading] = useState(true)
  const [customerRows, setCustomerRows] = useState<CustomerWithLedger[]>([])
  const [supplierRows, setSupplierRows] = useState<SupplierWithLedger[]>([])

  const [customerQuery, setCustomerQuery] = useState('')
  const [customerBalanceFilter, setCustomerBalanceFilter] = useState<'all' | 'receivable' | 'advance' | 'settled'>('all')

  const [supplierQuery, setSupplierQuery] = useState('')
  const [supplierBalanceFilter, setSupplierBalanceFilter] = useState<'all' | 'payable' | 'advance' | 'settled'>('all')

  useEffect(() => {
    let mounted = true
    async function loadData() {
      try {
        setLoading(true)
        const [customers, suppliers] = await Promise.all([
          customerService.getCustomers(),
          supplierService.getSuppliers(),
        ])

        const activeCustomers = customers.filter(c => c.status !== 'archived')
        const activeSuppliers = suppliers.filter(s => s.status !== 'archived')

        const [cSummaries, sSummaries] = await Promise.all([
          Promise.all(activeCustomers.map(c => fetchCustomerLedgerSummary(c.id).catch(() => ({
            customerId: c.id,
            totalPurchases: 0,
            totalPaid: 0,
            outstandingBalance: 0,
            advanceBalance: 0,
            openingBalance: 0,
            currentAccountBalance: 0,
          })))),
          Promise.all(activeSuppliers.map(s => fetchSupplierLedgerSummary(s.id).catch(() => ({
            supplierId: s.id,
            totalPurchases: 0,
            totalPaid: 0,
            outstandingPayable: 0,
            advanceBalance: 0,
            openingPayable: 0,
            currentAccountBalance: 0,
          })))),
        ])

        if (!mounted) return

        setCustomerRows(
          activeCustomers.map((customer, idx) => ({
            customer,
            summary: cSummaries[idx],
          }))
        )

        setSupplierRows(
          activeSuppliers.map((supplier, idx) => ({
            supplier,
            summary: sSummaries[idx],
          }))
        )
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void loadData()
    return () => {
      mounted = false
    }
  }, [])

  // KPI Calculations
  const totalReceivables = useMemo(() => {
    return customerRows.reduce((sum, item) => sum + (item.summary.outstandingBalance || 0), 0)
  }, [customerRows])

  const totalPayables = useMemo(() => {
    return supplierRows.reduce((sum, item) => sum + (item.summary.outstandingPayable || 0), 0)
  }, [supplierRows])

  const totalCustomerAdvances = useMemo(() => {
    return customerRows.reduce((sum, item) => sum + (item.summary.advanceBalance || 0), 0)
  }, [customerRows])

  const totalSupplierAdvances = useMemo(() => {
    return supplierRows.reduce((sum, item) => sum + (item.summary.advanceBalance || 0), 0)
  }, [supplierRows])

  const netLedgerPosition = totalReceivables - totalPayables

  // Customer Filtered Rows
  const filteredCustomers = useMemo(() => {
    return customerRows.filter(({ customer, summary }) => {
      const matchText =
        !customerQuery ||
        `${customer.name} ${customer.customerCode} ${customer.phone || ''} ${customer.email || ''}`
          .toLowerCase()
          .includes(customerQuery.toLowerCase())

      if (!matchText) return false

      if (customerBalanceFilter === 'receivable') {
        return (summary.outstandingBalance || 0) > 0
      }
      if (customerBalanceFilter === 'advance') {
        return (summary.advanceBalance || 0) > 0
      }
      if (customerBalanceFilter === 'settled') {
        return (summary.outstandingBalance || 0) === 0 && (summary.advanceBalance || 0) === 0
      }
      return true
    })
  }, [customerRows, customerQuery, customerBalanceFilter])

  // Supplier Filtered Rows
  const filteredSuppliers = useMemo(() => {
    return supplierRows.filter(({ supplier, summary }) => {
      const matchText =
        !supplierQuery ||
        `${supplier.name} ${supplier.supplierCode} ${supplier.contactPerson || ''} ${supplier.phone || ''}`
          .toLowerCase()
          .includes(supplierQuery.toLowerCase())

      if (!matchText) return false

      if (supplierBalanceFilter === 'payable') {
        return (summary.outstandingPayable || 0) > 0
      }
      if (supplierBalanceFilter === 'advance') {
        return (summary.advanceBalance || 0) > 0
      }
      if (supplierBalanceFilter === 'settled') {
        return (summary.outstandingPayable || 0) === 0 && (summary.advanceBalance || 0) === 0
      }
      return true
    })
  }, [supplierRows, supplierQuery, supplierBalanceFilter])

  // Export functions
  const handleExportCustomers = () => {
    const headers = ['Code', 'Customer Name', 'Phone', 'Type', 'Total Purchases', 'Total Paid', 'Outstanding Due', 'Advances', 'Current Account Balance']
    const data = filteredCustomers.map(({ customer, summary }) => [
      customer.customerCode,
      customer.name,
      customer.phone || '',
      customer.type,
      String(summary.totalPurchases || 0),
      String(summary.totalPaid || 0),
      String(summary.outstandingBalance || 0),
      String(summary.advanceBalance || 0),
      String(summary.currentAccountBalance ?? (summary.outstandingBalance || 0)),
    ])
    const csv = [headers, ...data].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `customer-ledgers-summary-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportSuppliers = () => {
    const headers = ['Code', 'Supplier Name', 'Contact', 'Phone', 'Total Billed', 'Total Paid', 'Outstanding Payable', 'Advances', 'Current Account Balance']
    const data = filteredSuppliers.map(({ supplier, summary }) => [
      supplier.supplierCode,
      supplier.name,
      supplier.contactPerson || '',
      supplier.phone || '',
      String(summary.totalPurchases || 0),
      String(summary.totalPaid || 0),
      String(summary.outstandingPayable || 0),
      String(summary.advanceBalance || 0),
      String(summary.currentAccountBalance ?? (summary.outstandingPayable || 0)),
    ])
    const csv = [headers, ...data].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `supplier-ledgers-summary-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial Ledgers & Statements"
        description="Comprehensive accounts receivable (customer ledgers) and accounts payable (supplier ledgers)."
        action={
          <div className="flex gap-2">
            <Button
              onClick={activeTab === 'customers' ? handleExportCustomers : handleExportSuppliers}
              variant="secondary"
              className="flex items-center gap-1.5"
            >
              <Download size={15} />
              Export {activeTab === 'customers' ? 'Customer Ledgers' : 'Supplier Ledgers'}
            </Button>
          </div>
        }
      />

      {/* Top Level Financial KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Customer Receivables</p>
            <span className="p-1.5 rounded-full bg-emerald-50 text-emerald-600">
              <ArrowDownLeft size={16} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(totalReceivables)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Unallocated advances: <span className="font-medium text-slate-700">{formatCurrency(totalCustomerAdvances)}</span>
          </p>
        </Card>

        <Card className="p-4 border-l-4 border-l-rose-500">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Supplier Payables</p>
            <span className="p-1.5 rounded-full bg-rose-50 text-rose-600">
              <ArrowUpRight size={16} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(totalPayables)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Advances with suppliers: <span className="font-medium text-slate-700">{formatCurrency(totalSupplierAdvances)}</span>
          </p>
        </Card>

        <Card className="p-4 border-l-4 border-l-indigo-500">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Net Working Balance</p>
            <span className="p-1.5 rounded-full bg-indigo-50 text-indigo-600">
              <Scale size={16} />
            </span>
          </div>
          <p className={`mt-2 text-2xl font-bold ${netLedgerPosition >= 0 ? 'text-indigo-900' : 'text-rose-700'}`}>
            {formatCurrency(netLedgerPosition)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {netLedgerPosition >= 0 ? 'Net asset due to business' : 'Net payable liability'}
          </p>
        </Card>

        <Card className="p-4 border-l-4 border-l-blue-500">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Ledger Accounts</p>
            <span className="p-1.5 rounded-full bg-blue-50 text-blue-600">
              <BookOpen size={16} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {customerRows.length + supplierRows.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {customerRows.length} customers · {supplierRows.length} suppliers
          </p>
        </Card>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-6" aria-label="Ledger Tabs">
          <button
            type="button"
            onClick={() => handleTabChange('customers')}
            className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'customers'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Users size={16} />
            Customer Receivables ({customerRows.length})
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('suppliers')}
            className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'suppliers'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Truck size={16} />
            Supplier Payables ({supplierRows.length})
          </button>
        </nav>
      </div>

      {/* Tab 1: Customer Receivables */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          <Card className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="text"
              placeholder="Search customer by name, code or phone..."
              value={customerQuery}
              onChange={e => setCustomerQuery(e.target.value)}
              className="rounded-lg border border-slate-200 p-2 text-sm sm:col-span-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Search customers"
            />
            <select
              value={customerBalanceFilter}
              onChange={e => setCustomerBalanceFilter(e.target.value as any)}
              className="rounded-lg border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Filter customer balance status"
            >
              <option value="all">All Customer Accounts</option>
              <option value="receivable">Outstanding Receivables Only</option>
              <option value="advance">Advance Balances Only</option>
              <option value="settled">Settled / Zero Balance</option>
            </select>
            <Button
              variant="secondary"
              onClick={() => {
                setCustomerQuery('')
                setCustomerBalanceFilter('all')
              }}
            >
              Reset Filters
            </Button>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <span className="text-xs font-semibold text-slate-600">
                Showing {filteredCustomers.length} of {customerRows.length} customers
              </span>
            </div>

            {loading ? (
              <div className="p-8 text-center text-sm text-slate-500">Loading customer account ledgers…</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">No customer ledger accounts found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 uppercase text-[10px] tracking-wider text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="p-3">Customer</th>
                      <th className="p-3">Contact</th>
                      <th className="p-3 text-right">Total Purchases</th>
                      <th className="p-3 text-right">Total Paid</th>
                      <th className="p-3 text-right">Outstanding Due</th>
                      <th className="p-3 text-right">Advances</th>
                      <th className="p-3 text-right">Current Balance</th>
                      <th className="p-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCustomers.map(({ customer, summary }) => {
                      const outstandingVal = summary.outstandingBalance || 0
                      const advanceVal = summary.advanceBalance || 0
                      const currentBal = summary.currentAccountBalance ?? outstandingVal

                      return (
                        <tr key={customer.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-3">
                            <div className="font-semibold text-slate-900">{customer.name}</div>
                            <div className="text-[11px] text-slate-500">{customer.customerCode}</div>
                          </td>
                          <td className="p-3">
                            <div className="text-slate-700">{customer.phone || '—'}</div>
                            <div className="text-[11px] text-slate-400">{customer.city || customer.type}</div>
                          </td>
                          <td className="p-3 text-right text-slate-700 font-medium">
                            {formatCurrency(summary.totalPurchases || 0)}
                          </td>
                          <td className="p-3 text-right text-slate-700 font-medium">
                            {formatCurrency(summary.totalPaid || 0)}
                          </td>
                          <td className="p-3 text-right">
                            <span className={outstandingVal > 0 ? 'font-bold text-rose-600' : 'text-slate-500'}>
                              {formatCurrency(outstandingVal)}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <span className={advanceVal > 0 ? 'font-semibold text-emerald-600' : 'text-slate-400'}>
                              {formatCurrency(advanceVal)}
                            </span>
                          </td>
                          <td className="p-3 text-right font-bold text-slate-900">
                            {formatCurrency(currentBal)}
                          </td>
                          <td className="p-3 text-center">
                            <Link to={`/customers/${customer.id}/ledger`}>
                              <Button variant="secondary" className="text-xs px-2.5 py-1">
                                View Ledger
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Tab 2: Supplier Payables */}
      {activeTab === 'suppliers' && (
        <div className="space-y-4">
          <Card className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="text"
              placeholder="Search supplier by name, company, code..."
              value={supplierQuery}
              onChange={e => setSupplierQuery(e.target.value)}
              className="rounded-lg border border-slate-200 p-2 text-sm sm:col-span-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Search suppliers"
            />
            <select
              value={supplierBalanceFilter}
              onChange={e => setSupplierBalanceFilter(e.target.value as any)}
              className="rounded-lg border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Filter supplier balance status"
            >
              <option value="all">All Supplier Accounts</option>
              <option value="payable">Outstanding Payables Only</option>
              <option value="advance">Advance Credits Only</option>
              <option value="settled">Settled / Zero Balance</option>
            </select>
            <Button
              variant="secondary"
              onClick={() => {
                setSupplierQuery('')
                setSupplierBalanceFilter('all')
              }}
            >
              Reset Filters
            </Button>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <span className="text-xs font-semibold text-slate-600">
                Showing {filteredSuppliers.length} of {supplierRows.length} suppliers
              </span>
            </div>

            {loading ? (
              <div className="p-8 text-center text-sm text-slate-500">Loading supplier account ledgers…</div>
            ) : filteredSuppliers.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">No supplier ledger accounts found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 uppercase text-[10px] tracking-wider text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="p-3">Supplier</th>
                      <th className="p-3">Contact</th>
                      <th className="p-3 text-right">Total Purchases</th>
                      <th className="p-3 text-right">Total Paid</th>
                      <th className="p-3 text-right">Outstanding Payable</th>
                      <th className="p-3 text-right">Advances</th>
                      <th className="p-3 text-right">Current Balance</th>
                      <th className="p-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSuppliers.map(({ supplier, summary }) => {
                      const outstandingVal = summary.outstandingPayable || 0
                      const advanceVal = summary.advanceBalance || 0
                      const currentBal = summary.currentAccountBalance ?? outstandingVal

                      return (
                        <tr key={supplier.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-3">
                            <div className="font-semibold text-slate-900">{supplier.name}</div>
                            <div className="text-[11px] text-slate-500">
                              {supplier.supplierCode} {supplier.companyName ? `· ${supplier.companyName}` : ''}
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="text-slate-700">{supplier.contactPerson || supplier.phone || '—'}</div>
                            <div className="text-[11px] text-slate-400">{supplier.city || supplier.country}</div>
                          </td>
                          <td className="p-3 text-right text-slate-700 font-medium">
                            {formatCurrency(summary.totalPurchases || 0)}
                          </td>
                          <td className="p-3 text-right text-slate-700 font-medium">
                            {formatCurrency(summary.totalPaid || 0)}
                          </td>
                          <td className="p-3 text-right">
                            <span className={outstandingVal > 0 ? 'font-bold text-rose-600' : 'text-slate-500'}>
                              {formatCurrency(outstandingVal)}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <span className={advanceVal > 0 ? 'font-semibold text-emerald-600' : 'text-slate-400'}>
                              {formatCurrency(advanceVal)}
                            </span>
                          </td>
                          <td className="p-3 text-right font-bold text-slate-900">
                            {formatCurrency(currentBal)}
                          </td>
                          <td className="p-3 text-center">
                            <Link to={`/suppliers/${supplier.id}/ledger`}>
                              <Button variant="secondary" className="text-xs px-2.5 py-1">
                                View Ledger
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
