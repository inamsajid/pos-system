import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { formatCurrency } from '../../../lib/currency'
import { customerService } from '../../customers/services/customerService'
import { getCustomerLedgerSummary } from '../../customers/services/customerLedgerService'
import type { Customer } from '../../customers/types/customer.types'
import { createCustomerPayment, getOutstandingInvoices } from '../services/paymentService'
import type { PaymentMethod, PaymentMethodAllocation } from '../types/payment.types'

const methods: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'digital_wallet', label: 'Digital wallet' }, { value: 'other', label: 'Other' },
]
type MethodRow = { method: PaymentMethod; amount: string; reference: string }
function currentKarachiDateTime() {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export function ReceivePaymentPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerId, setCustomerId] = useState(() => searchParams.get('customerId') ?? '')
  const [amount, setAmount] = useState('')
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [methodRows, setMethodRows] = useState<MethodRow[]>([{ method: 'cash', amount: '', reference: '' }])
  const [receivedAt, setReceivedAt] = useState(currentKarachiDateTime)
  const [notes, setNotes] = useState('')
  const [keepAsAdvance, setKeepAsAdvance] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { void customerService.getCustomers().then(list => setCustomers(list.filter(c => !c.isWalkIn))) }, [])
  const invoices = useMemo(() => customerId ? getOutstandingInvoices(customerId) : [], [customerId])
  const filteredCustomers = useMemo(() => customers.filter(c => !customerSearch || [c.name, c.customerCode, c.phone].some(value => value?.toLowerCase().includes(customerSearch.toLowerCase()))), [customers, customerSearch])
  const selectedCustomer = customers.find(c => c.id === customerId)
  const summary = customerId ? getCustomerLedgerSummary(customerId) : undefined
  const total = Number(amount) || 0
  const methodTotal = useMemo(() => methodRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0), [methodRows])
  const allocated = useMemo(() => Object.values(allocations).reduce((sum, value) => sum + (Number(value) || 0), 0), [allocations])
  const advance = Math.max(0, total - allocated)
  const updateMethod = (index: number, updates: Partial<MethodRow>) => setMethodRows(rows => rows.map((row, i) => i === index ? { ...row, ...updates } : row))

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (Math.abs(methodTotal - total) > 0.01) { setError('Payment method amounts must equal the total received.'); return }
    if (allocated > total + 0.001) { setError('Invoice allocations cannot exceed the payment amount.'); return }
    if (advance > 0.009 && !keepAsAdvance) { setError('Confirm that the unallocated amount should remain as customer advance.'); return }
    const allocationDraft = invoices.filter(i => (Number(allocations[i.saleId]) || 0) > 0).map(i => ({ saleId: i.saleId, invoiceNumber: i.invoiceNumber, amount: Number(allocations[i.saleId]) }))
    const confirmation = `Customer: ${selectedCustomer?.name}\nReceived: ${formatCurrency(total)}\nAllocated: ${formatCurrency(allocated)}\n${advance > 0 ? `Held as advance: ${formatCurrency(advance)}\n` : ''}Continue and create this immutable payment receipt?`
    if (!window.confirm(confirmation)) return
    setSaving(true)
    try {
      const methodBreakdown: PaymentMethodAllocation[] = methodRows.map((row, i) => ({ id: `method-${i + 1}`, method: row.method, amount: Number(row.amount), reference: row.reference.trim() || undefined }))
      const payment = await createCustomerPayment({ customerId, amount: total, receivedAt: new Date(`${receivedAt}:00+05:00`).toISOString(), methodBreakdown, allocations: allocationDraft, keepAsAdvance, notes })
      navigate(`/payments/${payment.id}`, { state: { notice: 'Payment recorded successfully.' } })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to record payment.') } finally { setSaving(false) }
  }

  return <><PageHeader title="Receive customer payment" description="Record an invoice payment or keep unallocated funds as a customer advance." action={<Link to="/payments"><Button>Back to payments</Button></Link>} />
    <form onSubmit={submit} className="grid min-w-0 gap-5 xl:grid-cols-[1.5fr_1fr]">
      <div className="min-w-0 space-y-5">
        <Card className="space-y-4 p-5"><h2 className="font-semibold">Payment details</h2>
          <label className="block text-sm">Search customer<input className="mt-1 w-full rounded-lg border border-slate-200 p-2.5" placeholder="Name, customer code or phone" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} /></label><label className="block text-sm">Customer<select required className="mt-1 w-full rounded-lg border border-slate-200 p-2.5" value={customerId} onChange={e => { setCustomerId(e.target.value); setAllocations({}) }}><option value="">Select a customer</option>{filteredCustomers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.customerCode}{c.phone ? ` · ${c.phone}` : ''}</option>)}</select></label>
          {selectedCustomer && <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-4"><div><p className="text-slate-500">Customer / phone</p><strong>{selectedCustomer.name}</strong><p>{selectedCustomer.phone}</p></div><div><p className="text-slate-500">Code / type</p><strong>{selectedCustomer.customerCode} · {selectedCustomer.type}</strong></div><div><p className="text-slate-500">Outstanding invoices</p><strong>{formatCurrency(summary?.outstandingBalance ?? 0)}</strong></div><div><p className="text-slate-500">Available advance</p><strong>{formatCurrency(summary?.advanceBalance ?? 0)}</strong></div></div>}
          <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">Payment amount<input required min="0.01" step="0.01" type="number" className="mt-1 w-full rounded-lg border border-slate-200 p-2.5" value={amount} onChange={e => setAmount(e.target.value)} /></label><label className="block text-sm">Payment date<input required type="datetime-local" className="mt-1 w-full rounded-lg border border-slate-200 p-2.5" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} /></label></div>
          <div><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-medium">Payment methods</h3><Button type="button" onClick={() => setMethodRows(rows => [...rows, { method: 'cash', amount: '', reference: '' }])}>Add method</Button></div><div className="space-y-2">{methodRows.map((row, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_9rem_1fr_auto]"><select aria-label={`Payment method ${index + 1}`} className="rounded-lg border border-slate-200 p-2 text-sm" value={row.method} onChange={e => updateMethod(index, { method: e.target.value as PaymentMethod })}>{methods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select><input aria-label={`Amount by method ${index + 1}`} required type="number" min="0.01" step="0.01" placeholder="Amount" className="rounded-lg border border-slate-200 p-2 text-sm" value={row.amount} onChange={e => updateMethod(index, { amount: e.target.value })} /><input aria-label={`Transaction reference ${index + 1}`} className="rounded-lg border border-slate-200 p-2 text-sm" value={row.reference} onChange={e => updateMethod(index, { reference: e.target.value })} placeholder="Reference (optional)" /><Button type="button" disabled={methodRows.length === 1} onClick={() => setMethodRows(rows => rows.filter((_, i) => i !== index))}>Remove</Button></div>)}</div><p className={`mt-2 text-xs ${Math.abs(methodTotal - total) > 0.01 ? 'text-rose-600' : 'text-emerald-700'}`}>Method total: {formatCurrency(methodTotal)} / {formatCurrency(total)}</p></div>
          <label className="block text-sm">Notes<textarea rows={3} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5" value={notes} onChange={e => setNotes(e.target.value)} /></label>
        </Card>
        <Card className="min-w-0 overflow-hidden p-5"><h2 className="font-semibold">Allocate to outstanding invoices</h2><p className="mt-1 text-xs text-slate-500">Each invoice is listed once. Enter an allocation up to its remaining balance.</p>{!customerId ? <p className="py-6 text-sm text-slate-500">Select a customer to view outstanding invoices.</p> : invoices.length === 0 ? <p className="py-6 text-sm text-slate-500">No outstanding invoices. The payment can be received as an advance.</p> : <div className="mt-4 space-y-3">{invoices.map(i => <div key={i.saleId} className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[1fr_auto_9rem] sm:items-center"><div><Link to={`/invoices/${i.saleId}`} className="text-sm font-semibold text-blue-600">{i.invoiceNumber}</Link><p className="text-xs text-slate-500">{new Date(i.date).toLocaleDateString()} · Invoice total {formatCurrency(i.totalAmount)} · Paid {formatCurrency(i.amountPaid)}</p></div><p className="text-sm">Remaining <strong>{formatCurrency(i.outstanding)}</strong></p><input aria-label={`Allocate to ${i.invoiceNumber}`} type="number" min="0" max={i.outstanding} step="0.01" placeholder="Allocation" className="min-w-0 rounded-lg border border-slate-200 p-2 text-sm" value={allocations[i.saleId] ?? ''} onChange={e => setAllocations(current => ({ ...current, [i.saleId]: e.target.value }))} /></div>)}</div>}</Card>
      </div>
      <div className="space-y-5"><Card className="space-y-3 p-5"><h2 className="font-semibold">Payment summary</h2><div className="flex justify-between text-sm"><span>Total received</span><strong>{formatCurrency(total)}</strong></div><div className="flex justify-between text-sm"><span>Total allocated</span><strong>{formatCurrency(allocated)}</strong></div><div className="flex justify-between border-t pt-3 text-sm"><span>Remaining unallocated</span><strong>{formatCurrency(advance)}</strong></div><div className="flex justify-between text-xs text-slate-600"><span>Outstanding before payment</span><span>{formatCurrency(summary?.outstandingBalance ?? 0)}</span></div><div className="flex justify-between text-xs text-slate-600"><span>Expected invoice outstanding after</span><span>{formatCurrency(Math.max(0, (summary?.outstandingBalance ?? 0) - allocated))}</span></div>{advance > 0.009 && <label className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><input type="checkbox" checked={keepAsAdvance} onChange={e => setKeepAsAdvance(e.target.checked)} /> Keep the unallocated {formatCurrency(advance)} as a customer advance.</label>}</Card>{error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<div className="flex justify-end gap-2"><Link to="/payments"><Button>Cancel</Button></Link><Button type="submit" variant="primary" disabled={saving || !customerId || total <= 0 || Math.abs(methodTotal - total) > 0.01 || allocated > total + 0.001 || (advance > 0.009 && !keepAsAdvance)}>{saving ? 'Saving…' : 'Record payment'}</Button></div></div>
    </form></>
}
