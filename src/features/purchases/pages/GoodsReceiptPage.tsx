import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { formatBusinessDate } from '../../../lib/date'
import { getProductStock } from '../../inventory/services/inventoryService'
import { fetchPurchaseById, getPurchaseById, createGoodsReceipt } from '../services/purchaseService'
import type { Purchase } from '../types/purchase.types'

export function GoodsReceiptPage() {
  const { purchaseId = '' } = useParams(); const navigate = useNavigate()
  const [purchase, setPurchase] = useState<Purchase | null>(() => getPurchaseById(purchaseId) ?? null)
  const [loading, setLoading] = useState(!purchase)
  const [quantities, setQuantities] = useState<Record<string, string>>({}); const [notes, setNotes] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const [requestId] = useState(() => globalThis.crypto?.randomUUID?.() ?? `receipt-${Date.now()}`)

  useEffect(() => {
    let active = true
    if (!purchase && purchaseId) {
      setLoading(true)
      void fetchPurchaseById(purchaseId).then(res => {
        if (active) {
          setPurchase(res ?? null)
          setLoading(false)
        }
      })
    }
    return () => { active = false }
  }, [purchaseId])

  if (loading) return <div className="p-8 text-center text-sm text-slate-500" role="status">Loading purchase details…</div>
  if (!purchase) return <PageHeader title="Purchase not found" description="This purchase is not available." action={<Link to="/purchases"><Button>Back to purchases</Button></Link>} />
  if (!['ordered', 'partially_received', 'confirmed'].includes(purchase.status)) return <PageHeader title="Goods receipt unavailable" description="Draft, received and cancelled purchases cannot receive additional stock." action={<Link to={`/purchases/${purchase.id}`}><Button>Back to purchase</Button></Link>} />
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    const selected = purchase.items.filter(item => (Number(quantities[item.id]) || 0) > 0)
    if (!selected.length) { setError('Enter a received quantity for at least one product.'); return }
    const summary = selected.map(item => `${item.productSnapshot.name}: +${quantities[item.id]} ${item.productSnapshot.unit}`).join('\n')
    if (!window.confirm(`Receive goods for ${purchase.purchaseNumber}?\n${summary}\n\nThis will update tracked inventory and create an immutable goods receipt.`)) return
    setSaving(true)
    try { const receipt = await createGoodsReceipt(purchase.id, Object.fromEntries(Object.entries(quantities).map(([key, value]) => [key, Number(value) || 0])), notes, requestId); navigate(`/purchases/${purchase.id}`, { state: { notice: `Goods receipt ${receipt.receiptNumber} recorded.` } }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to record goods receipt.') } finally { setSaving(false) }
  }
  return <><PageHeader title="Receive stock" description={`Purchase ${purchase.purchaseNumber} · ${purchase.supplierSnapshot.name}`} action={<Link to={`/purchases/${purchase.id}`}><Button>Back to purchase</Button></Link>} />
    <Card className="mb-4 p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>Purchase date {formatBusinessDate(new Date(purchase.purchaseDate))}</span><span>Supplier invoice {purchase.supplierInvoiceNumber ?? '—'}</span><span className="capitalize">Status {purchase.status.replaceAll('_', ' ')}</span></div></Card>
    <form onSubmit={submit}><Card className="overflow-hidden"><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Product', 'SKU', 'Ordered', 'Previously received', 'Remaining', 'Current stock', 'Receiving now'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{purchase.items.map(item => { const remaining = Math.max(0, item.orderedQuantity - item.receivedQuantity); return <tr className="border-t" key={item.id}><td className="p-3 font-medium">{item.productSnapshot.name}<span className="ml-1 text-slate-400">{item.productSnapshot.unit}</span></td><td>{item.productSnapshot.sku}</td><td>{item.orderedQuantity}</td><td>{item.receivedQuantity}</td><td>{remaining}</td><td>{getProductStock(item.productId)}</td><td><input aria-label={`Receive quantity for ${item.productSnapshot.name}`} type="number" min="0" max={remaining} step="any" value={quantities[item.id] ?? ''} onChange={e => setQuantities(current => ({ ...current, [item.id]: e.target.value }))} className="w-32 rounded border p-2" /></td></tr> })}</tbody></table></div><div className="divide-y md:hidden">{purchase.items.map(item => { const remaining = Math.max(0, item.orderedQuantity - item.receivedQuantity); return <article className="p-4" key={item.id}><div className="flex justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{item.productSnapshot.name}</p><p className="text-xs text-slate-500">{item.productSnapshot.sku} · {item.productSnapshot.unit}</p></div><span className="text-xs">Stock {getProductStock(item.productId)}</span></div><p className="mt-2 text-xs text-slate-500">Ordered {item.orderedQuantity} · Received {item.receivedQuantity} · Remaining {remaining}</p><label className="mt-3 block text-xs">Received now<input aria-label={`Receive quantity for ${item.productSnapshot.name}`} type="number" min="0" max={remaining} step="any" value={quantities[item.id] ?? ''} onChange={e => setQuantities(current => ({ ...current, [item.id]: e.target.value }))} className="mt-1 w-full rounded border p-2" /></label></article> })}</div></Card>
      <Card className="mt-4 p-4"><label className="block text-sm">Receiving notes<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full rounded border p-2" /></label></Card>{error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<div className="mt-4 flex justify-end gap-2"><Link to={`/purchases/${purchase.id}`}><Button>Cancel</Button></Link><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Receiving…' : 'Confirm goods receipt'}</Button></div>
    </form>
  </>
}
