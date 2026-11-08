import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/date'
import { customerService } from '../services/customerService'
import { getCustomerLedger, getCustomerLedgerSummary } from '../services/customerLedgerService'
import type { Customer } from '../types/customer.types'

export function CustomerAccountPage() {
  const { id = '' } = useParams()
  const [customer, setCustomer] = useState<Customer>()
  const [kind, setKind] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => { void customerService.getCustomerById(id).then(setCustomer) }, [id])
  const entries = useMemo(() => id ? getCustomerLedger(id) : [], [id])
  const summary = useMemo(() => id ? getCustomerLedgerSummary(id) : undefined, [id])
  const filtered = useMemo(() => entries.filter(e => (!kind || e.type === kind) && (!from || e.date.slice(0, 10) >= from) && (!to || e.date.slice(0, 10) <= to) && (!query || `${e.reference} ${e.description}`.toLowerCase().includes(query.toLowerCase()))), [entries, kind, from, to, query])
  const exportCsv = () => {
    const rows = [['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'], ...filtered.map(e => [e.date, e.type, e.reference, e.description, String(e.debit), String(e.credit), String(e.balance)])]
    const csv = rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = `${customer?.customerCode ?? 'customer'}-ledger.csv`; a.click(); URL.revokeObjectURL(url)
  }
  if (!customer) return <PageHeader title="Customer not found" description="This customer is not available." />
  return <><PageHeader title="Customer ledger" description={`Account transactions for ${customer.name}.`} action={<div className="flex gap-2"><Button onClick={exportCsv}>Export ledger</Button><Link to={`/customers/${customer.id}`}><Button>Back to profile</Button></Link></div>} />
    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-6">{[['Opening balance', summary?.openingBalance ?? 0], ['Total debit', (summary?.totalPurchases ?? 0) + (summary?.openingBalance ?? 0)], ['Total credit', summary?.totalPaid ?? 0], ['Outstanding receivables', summary?.outstandingBalance ?? 0], ['Unallocated advances', summary?.advanceBalance ?? 0], ['Current account balance', summary?.currentAccountBalance ?? 0]].map(([label, value]) => <Card key={String(label)} className="p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 font-bold">{formatCurrency(Number(value))}</p></Card>)}</div>
    <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5"><input aria-label="Search ledger" placeholder="Search reference or description" value={query} onChange={e => setQuery(e.target.value)} className="rounded-lg border border-slate-200 p-2 text-sm" /><select aria-label="Transaction type" value={kind} onChange={e => setKind(e.target.value)} className="rounded-lg border border-slate-200 p-2 text-sm"><option value="">All transaction types</option><option value="opening">Opening balance</option><option value="invoice">Invoices</option><option value="payment">Payments</option></select><input aria-label="From date" type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-lg border border-slate-200 p-2 text-sm" /><input aria-label="To date" type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-lg border border-slate-200 p-2 text-sm" /><Button onClick={() => { setQuery(''); setKind(''); setFrom(''); setTo('') }}>Clear filters</Button></Card>
    <Card className="overflow-hidden"><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Running balance'].map(x => <th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{filtered.map(e => <tr key={e.id} className="border-t border-slate-100"><td className="p-3">{formatBusinessDate(new Date(e.date))}</td><td className="capitalize">{e.type}</td><td className="font-medium">{e.invoiceNumber ? <Link className="text-blue-600" to={`/invoices/${e.id.replace('invoice-', '')}`}>{e.reference}</Link> : e.paymentId ? <Link className="text-blue-600" to={`/payments/${e.paymentId}`}>{e.reference}</Link> : e.reference}</td><td>{e.description}</td><td>{e.debit ? formatCurrency(e.debit) : '—'}</td><td>{e.credit ? formatCurrency(e.credit) : '—'}</td><td className="font-semibold">{formatCurrency(e.balance)}</td></tr>)}</tbody></table></div><div className="divide-y md:hidden">{filtered.map(e => <article key={e.id} className="p-4"><div className="flex justify-between gap-3"><span className="text-xs capitalize text-slate-500">{e.type} · {formatBusinessDate(new Date(e.date))}</span><strong>{formatCurrency(e.balance)}</strong></div><p className="mt-1 font-medium">{e.invoiceNumber ? <Link className="text-blue-600" to={`/invoices/${e.id.replace('invoice-', '')}`}>{e.reference}</Link> : e.paymentId ? <Link className="text-blue-600" to={`/payments/${e.paymentId}`}>{e.reference}</Link> : e.reference}</p><p className="mt-1 text-xs text-slate-500">{e.description}</p><div className="mt-2 flex gap-4 text-xs"><span>Debit {formatCurrency(e.debit)}</span><span>Credit {formatCurrency(e.credit)}</span></div></article>)}</div>{!filtered.length && <p className="p-8 text-center text-sm text-slate-500">No ledger transactions match these filters.</p>}</Card>
  </>
}
