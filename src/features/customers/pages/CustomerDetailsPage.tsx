import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Mail, Phone, Pencil } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/feedback/EmptyState'
import { Modal } from '../../../components/ui/Modal'
import { formatCurrency } from '../../../lib/currency'
import { formatBusinessDate } from '../../../lib/date'
import { customerService } from '../services/customerService'
import { getCustomerLedgerSummary } from '../services/customerLedgerService'
import type { Customer } from '../types/customer.types'
import { getSales } from '../../pos/services/checkoutService'
import { getCustomerPayments } from '../../payments/services/paymentService'
import { paidAmount, getPaymentStatus, outstanding } from '../../sales/utils/salesUtils'

export function CustomerDetailsPage() {
  const { id = '' } = useParams()
  const [customer, setCustomer] = useState<Customer>()
  const [archive, setArchive] = useState(false)
  const navigate = useNavigate()
  useEffect(() => {
    void customerService.getCustomerById(id).then(setCustomer)
  }, [id])
  const summary = useMemo(() => getCustomerLedgerSummary(id), [id])
  const invoices = useMemo(() => getSales().filter(s => s.customerId === id && s.status === 'completed').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [id])
  const payments = useMemo(() => getCustomerPayments(id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)), [id])
  if (!customer) return <PageHeader title="Customer not found" description="This customer is not available." />
  const edit = () => navigate(`/customers/${customer.id}/edit`)
  return <><PageHeader title={customer.name} description={`${customer.customerCode} · ${customer.type === 'business' ? 'Business' : 'Individual'} · ${customer.status}`} action={<div className="flex flex-wrap gap-2"><Link to={`/customers/${customer.id}/ledger`}><Button>View ledger</Button></Link>{!customer.isWalkIn && <Link to={`/payments/new?customerId=${customer.id}`}><Button>Receive payment</Button></Link>}<Button variant="primary" onClick={edit}><Pencil size={14} />Edit customer</Button>{!customer.isWalkIn && <Button onClick={() => setArchive(true)}>Archive</Button>}</div>} />
    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{[['Total purchases', summary?.totalPurchases ?? 0], ['Total paid', summary?.totalPaid ?? 0], ['Outstanding', summary?.outstandingBalance ?? 0], ['Advance balance', summary?.advanceBalance ?? 0]].map(([n, v]) => <Card key={String(n)} className="p-4"><p className="text-xs text-slate-500">{n}</p><p className="mt-2 text-lg font-bold">{formatCurrency(Number(v))}</p></Card>)}</div>
    <div className="grid gap-5 xl:grid-cols-2"><Card className="p-5"><h2 className="font-bold">Customer information</h2><dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">{[['Code', customer.customerCode], ['Type', customer.type], ['Company', customer.companyName], ['Phone', customer.phone], ['Email', customer.email], ['Tax number', customer.taxNumber], ['Address', customer.address], ['City', customer.city], ['Created', formatBusinessDate(new Date(customer.createdAt))], ['Updated', formatBusinessDate(new Date(customer.updatedAt))]].map(([k, v]) => <div key={String(k)} className="border-b border-slate-100 py-2"><dt className="text-xs text-slate-500">{k}</dt><dd className="mt-1 break-words">{v || '—'}</dd></div>)}</dl>{customer.notes && <p className="mt-4 text-sm text-slate-600">{customer.notes}</p>}<div className="mt-4 flex gap-3">{customer.phone && <a href={`tel:${customer.phone}`} aria-label="Call customer" className="text-blue-600"><Phone size={15} /></a>}{customer.email && <a href={`mailto:${customer.email}`} aria-label="Email customer" className="text-blue-600"><Mail size={15} /></a>}</div></Card>
      <Card className="overflow-hidden p-5"><h2 className="font-bold">Purchase history</h2>{invoices.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead><tr>{['Invoice', 'Date', 'Total', 'Paid', 'Due', 'Status'].map(x => <th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{invoices.map(i => <tr key={i.id} className="border-t"><td className="p-2"><Link to={`/invoices/${i.id}`} className="text-blue-600">{i.invoiceNumber}</Link></td><td>{formatBusinessDate(new Date(i.createdAt))}</td><td>{formatCurrency(i.totalAmount)}</td><td>{formatCurrency(paidAmount(i))}</td><td>{formatCurrency(outstanding(i))}</td><td>{getPaymentStatus(i)}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-slate-500">No purchase history.</p>}</Card></div>
    <Card className="mt-5 overflow-hidden p-5"><h2 className="font-bold">Payment history</h2>{payments.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[540px] text-left text-xs"><thead><tr>{['Receipt', 'Date', 'Method', 'Amount', 'Invoices', 'Advance'].map(x => <th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{payments.map(p => <tr key={p.id} className="border-t"><td className="p-2"><Link to={`/payments/${p.id}`} className="text-blue-600">{p.receiptNumber}</Link></td><td>{formatBusinessDate(new Date(p.receivedAt))}</td><td>{p.methodBreakdown.map(m => m.method.replace('_', ' ')).join(', ')}</td><td>{formatCurrency(p.amount)}</td><td>{p.allocations.map(a => a.invoiceNumber).join(', ') || '—'}</td><td>{formatCurrency(p.unallocatedAmount)}</td></tr>)}</tbody></table></div> : <EmptyState title="No payments yet" description="Payments recorded for this customer will appear here." />}</Card>
    <Card className="mt-5 p-5"><h2 className="font-bold">Recent activity</h2><p className="mt-3 text-sm text-slate-600">Customer created · {formatBusinessDate(new Date(customer.createdAt))}</p>{summary?.lastPurchaseDate && <p className="mt-2 text-sm text-slate-600">Purchase completed · {formatBusinessDate(new Date(summary.lastPurchaseDate))}</p>}</Card>
    <Modal open={archive} onClose={() => setArchive(false)} title="Archive customer?"><p className="text-sm text-slate-600">Historical records remain available.{(summary?.outstandingBalance ?? 0) > 0 && <span className="mt-2 block rounded bg-amber-50 p-3 text-amber-800">Outstanding balance: {formatCurrency(summary?.outstandingBalance ?? 0)}.</span>}</p><div className="mt-5 flex justify-end gap-2"><Button onClick={() => setArchive(false)}>Cancel</Button><Button variant="primary" onClick={() => void customerService.archiveCustomer(customer.id).then(() => navigate('/customers', { state: { notice: `${customer.name} archived.` } }))}>Archive</Button></div></Modal>
  </>
}
