import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/feedback/EmptyState'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate, getBusinessDatePreset, isWithinBusinessDateRange } from '../../../lib/businessDate'
import { getPayments, getPaymentStatistics, paymentSourceLabel, fetchCustomerPayments } from '../services/paymentService'
import type { CustomerPayment } from '../types/payment.types'

type DateRange = 'all' | 'today' | 'yesterday' | '7' | '30' | 'month' | 'last-month' | 'custom'
function matchesDateRange(value: string, range: DateRange, from: string, to: string) {
  if (range === 'all') return true
  if (range === 'custom') return isWithinBusinessDateRange(value, from, to)
  const preset = getBusinessDatePreset(range)
  return isWithinBusinessDateRange(value, preset.from, preset.to)
}

export function PaymentsPage() {
  const [payments, setPayments] = useState<CustomerPayment[]>(() => getPayments())
  const stats = getPaymentStatistics()

  useEffect(() => {
    void fetchCustomerPayments().then(setPayments)
  }, [])
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState('')
  const [source, setSource] = useState('')
  const [customer, setCustomer] = useState('')
  const [range, setRange] = useState<DateRange>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [sort, setSort] = useState<'newest' | 'oldest' | 'amount'>('newest')
  const filtered = useMemo(() => payments.filter(payment =>
    (!query || [payment.receiptNumber, payment.customerSnapshot.name, payment.customerSnapshot.customerCode, payment.customerSnapshot.phone, ...payment.allocations.map(a => a.invoiceNumber), ...payment.methodBreakdown.map(m => m.reference)].some(value => value?.toLowerCase().includes(query.toLowerCase()))) &&
    (!method || payment.methodBreakdown.some(item => item.method === method)) && (!source || payment.source === source) && (!customer || payment.customerId === customer) &&
    matchesDateRange(payment.receivedAt, range, from, to) && (!min || payment.amount >= Number(min)) && (!max || payment.amount <= Number(max)))
    .sort((a, b) => sort === 'amount' ? b.amount - a.amount : sort === 'oldest' ? a.receivedAt.localeCompare(b.receivedAt) : b.receivedAt.localeCompare(a.receivedAt)),
  [payments, query, method, source, customer, range, from, to, min, max, sort])
  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const rows = filtered.slice((page - 1) * size, page * size)
  const customers = [...new Map(payments.filter(p => p.customerId).map(p => [p.customerId!, { id: p.customerId!, name: p.customerSnapshot.name }])).values()]
  const allocated = (payment: CustomerPayment) => payment.allocations.reduce((sum, item) => sum + item.amount, 0)
  const clearFilters = () => { setQuery(''); setMethod(''); setSource(''); setCustomer(''); setRange('all'); setFrom(''); setTo(''); setMin(''); setMax(''); setPage(1) }
  const exportCsv = () => {
    const rowsToExport = [['Receipt', 'Date', 'Customer', 'Method', 'Reference', 'Amount', 'Allocated', 'Advance', 'Source'], ...filtered.map(p => [p.receiptNumber, p.receivedAt, p.customerSnapshot.name, p.methodBreakdown.map(m => `${m.method}:${m.amount}`).join('; '), p.methodBreakdown.map(m => m.reference).filter(Boolean).join('; '), String(p.amount), String(allocated(p)), String(p.unallocatedAmount), paymentSourceLabel(p.source)])]
    const csv = rowsToExport.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'customer-payments.csv'; anchor.click(); URL.revokeObjectURL(url)
  }
  const actions = (payment: CustomerPayment) => <div className="flex flex-wrap gap-2 text-xs"><Link className="text-blue-600" to={`/payments/${payment.id}`}>View / print</Link>{payment.customerId && payment.customerId !== 'walk-in' && <Link className="text-blue-600" to={`/customers/${payment.customerId}/ledger`}>Ledger</Link>}{payment.customerId && <Link className="text-blue-600" to={`/customers/${payment.customerId}`}>Customer</Link>}{payment.allocations[0] && <Link className="text-blue-600" to={`/invoices/${payment.allocations[0].saleId}`}>Invoice</Link>}</div>

  return <><PageHeader title="Payments" description="Manage customer payments, receipts and outstanding collections." action={<div className="flex gap-2"><Button onClick={exportCsv}>Export payments</Button><Link to="/payments/new"><Button variant="primary">Receive payment</Button></Link></div>} />
    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{[['Payments received', formatCurrency(stats.totalReceived)], ['Payment transactions', stats.transactions], ['Outstanding receivables', formatCurrency(stats.outstanding)], ['Unallocated advances', formatCurrency(stats.advances)]].map(([label, value]) => <Card key={String(label)} className="p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-bold">{value}</p></Card>)}</div>
    <Card className="mb-4 grid min-w-0 grid-cols-1 gap-2 p-4 sm:grid-cols-2 xl:grid-cols-4"><input aria-label="Search payments" className="min-w-0 rounded border p-2 text-sm" placeholder="Receipt, customer, invoice, reference" value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} /><select aria-label="Payment method" className="rounded border p-2 text-sm" value={method} onChange={e => { setMethod(e.target.value); setPage(1) }}><option value="">All methods</option>{[['cash', 'Cash'], ['card', 'Card'], ['bank_transfer', 'Bank transfer'], ['digital_wallet', 'Digital wallet'], ['other', 'Other']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Payment source" className="rounded border p-2 text-sm" value={source} onChange={e => { setSource(e.target.value); setPage(1) }}><option value="">All sources</option><option value="pos_checkout">POS Checkout</option><option value="manual">Manual Customer Payment</option></select><select aria-label="Customer" className="rounded border p-2 text-sm" value={customer} onChange={e => { setCustomer(e.target.value); setPage(1) }}><option value="">All customers</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select aria-label="Date range" className="rounded border p-2 text-sm" value={range} onChange={e => { setRange(e.target.value as DateRange); setPage(1) }}><option value="all">All dates</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="month">This month</option><option value="last-month">Last month</option><option value="custom">Custom range</option></select>{range === 'custom' && <><input aria-label="From date" type="date" className="min-w-0 rounded border p-2 text-sm" value={from} onChange={e => setFrom(e.target.value)} /><input aria-label="To date" type="date" className="min-w-0 rounded border p-2 text-sm" value={to} onChange={e => setTo(e.target.value)} /></>}<input aria-label="Minimum amount" type="number" min="0" className="min-w-0 rounded border p-2 text-sm" value={min} onChange={e => setMin(e.target.value)} placeholder="Minimum amount" /><input aria-label="Maximum amount" type="number" min="0" className="min-w-0 rounded border p-2 text-sm" value={max} onChange={e => setMax(e.target.value)} placeholder="Maximum amount" /><select aria-label="Sort payments" className="rounded border p-2 text-sm" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="amount">Highest amount</option></select><Button onClick={clearFilters}>Clear filters</Button></Card>
    {!rows.length ? <EmptyState title="No payments found" description="POS payments and customer receipts will appear here." /> : <>
      <Card className="hidden overflow-hidden md:block"><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase"><tr>{['Receipt', 'Date', 'Customer', 'Method', 'Reference', 'Received', 'Allocated', 'Advance', 'Source', 'Actions'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{rows.map(p => <tr key={p.id} className="border-t"><td className="p-3"><Link className="font-semibold text-blue-600" to={`/payments/${p.id}`}>{p.receiptNumber}</Link></td><td>{formatBusinessDate(new Date(p.receivedAt), { dateStyle: 'short', timeStyle: 'short' })}</td><td>{p.customerId ? <Link className="text-blue-600" to={`/customers/${p.customerId}`}>{p.customerSnapshot.name}</Link> : p.customerSnapshot.name}</td><td>{p.methodBreakdown.map(m => m.method.replace('_', ' ')).join(', ')}</td><td>{p.methodBreakdown.map(m => m.reference).filter(Boolean).join(', ') || '—'}</td><td>{formatCurrency(p.amount)}</td><td>{formatCurrency(allocated(p))}</td><td>{formatCurrency(p.unallocatedAmount)}</td><td>{paymentSourceLabel(p.source)}</td><td>{actions(p)}</td></tr>)}</tbody></table></div></Card>
      <Card className="divide-y md:hidden">{rows.map(p => <article className="min-w-0 p-4" key={p.id}><div className="flex justify-between gap-3"><Link className="break-all font-semibold text-blue-600" to={`/payments/${p.id}`}>{p.receiptNumber}</Link><strong className="shrink-0">{formatCurrency(p.amount)}</strong></div><p className="mt-1 text-xs text-slate-500">{p.customerSnapshot.name} · {formatBusinessDate(new Date(p.receivedAt))}</p><p className="mt-2 text-xs">{p.methodBreakdown.map(m => m.method.replace('_', ' ')).join(', ')} · {paymentSourceLabel(p.source)}</p><p className="mt-1 text-xs text-slate-500">Allocated {formatCurrency(allocated(p))} · Advance {formatCurrency(p.unallocatedAmount)}</p><div className="mt-2">{actions(p)}</div></article>)}</Card>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs"><span>{filtered.length} payments</span><div className="flex flex-wrap items-center gap-2"><select aria-label="Page size" className="rounded border p-2" value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1) }}><option value={10}>10 / page</option><option value={25}>25 / page</option><option value={50}>50 / page</option></select><Button disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</Button><span>{page}/{pages}</span><Button disabled={page >= pages} onClick={() => setPage(current => current + 1)}>Next</Button></div></div>
    </>}
  </>
}
