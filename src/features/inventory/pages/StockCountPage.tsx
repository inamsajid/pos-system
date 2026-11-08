import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/feedback/EmptyState'
import { useProducts } from '../../products/hooks/useProducts'
import { getStockCount, getStockCounts, saveStockCountDraft, confirmStockCount, getProductStock } from '../services/inventoryService'
import type { StockCountDraft } from '../types/inventory.types'

function newId() { return globalThis.crypto?.randomUUID?.() ?? `count-${Date.now()}` }
export function StockCountPage() {
  const { countId } = useParams()
  const { products } = useProducts()
  const counts = getStockCounts()
  const saved = countId ? getStockCount(countId) : undefined
  const [active, setActive] = useState<StockCountDraft | undefined>(saved)
  const [preview, setPreview] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const draftList = useMemo(() => counts.filter(count => count.status === 'draft'), [counts])
  const start = () => {
    const tracked = products.filter(product => product.trackInventory && product.status === 'active')
    if (!tracked.length) { setError('There are no active tracked products to count.'); return }
    const now = new Date().toISOString()
    const draft: StockCountDraft = { id: newId(), name: `COUNT-${now.slice(0, 10).replaceAll('-', '')}-${newId().slice(-4).toUpperCase()}`, createdAt: now, status: 'draft', rows: tracked.map(product => ({ productId: product.id, productName: product.name, sku: product.sku, unit: product.unit, systemQuantity: getProductStock(product.id), physicalQuantity: null })) }
    setActive(draft); setPreview(false); setNotice(''); setError('')
  }
  const update = (productId: string, value: string) => setActive(current => current ? { ...current, rows: current.rows.map(row => row.productId === productId ? { ...row, physicalQuantity: value === '' ? null : Number(value) } : row) } : current)
  const variance = (row: StockCountDraft['rows'][number]) => row.physicalQuantity === null ? null : row.physicalQuantity - row.systemQuantity
  const save = () => {
    if (!active || active.status !== 'draft') return
    try { const savedDraft = saveStockCountDraft(active); setActive(savedDraft); setNotice('Stock count draft saved. No inventory has changed.'); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save stock count.') }
  }
  const review = () => {
    if (!active || active.rows.some(row => row.physicalQuantity === null || !Number.isFinite(row.physicalQuantity) || row.physicalQuantity < 0)) { setError('Enter a valid physical count for every listed product.'); return }
    setPreview(true); setError(''); setNotice('Review the differences below before confirming the count.')
  }
  const confirm = () => {
    if (!active) return
    const differences = active.rows.filter(row => variance(row) !== 0)
    const detail = differences.length ? differences.slice(0, 5).map(row => `${row.productName}: ${row.systemQuantity} → ${row.physicalQuantity}`).join('\n') : 'No stock differences were found.'
    if (!window.confirm(`Confirm stock count ${active.name}?\n${detail}\n\nInventory balances will be updated and movement records created.`)) return
    try {
      const savedDraft = active.status === 'draft' ? saveStockCountDraft(active) : active
      const confirmed = confirmStockCount(savedDraft.id, Object.fromEntries(savedDraft.rows.map(row => [row.productId, row.physicalQuantity ?? NaN])))
      setActive(confirmed); setPreview(false); setNotice('Stock count confirmed. Differences have been recorded in the inventory ledger.'); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to confirm stock count.') }
  }
  return <><PageHeader title="Stock count" description="Compare physical quantities with system stock and record verified variances." action={<div className="flex gap-2"><Link to="/inventory"><Button>Back to inventory</Button></Link><Button variant="primary" onClick={start}>Start new count</Button></div>} />
    {!active ? <><Card className="mb-5 p-5"><p className="text-sm text-slate-600">Start a count to capture current system quantities. Saving a draft does not change inventory; only confirming a reviewed count creates stock movements.</p></Card>{draftList.length ? <Card className="divide-y">{draftList.map(count => <div className="flex flex-wrap items-center justify-between gap-3 p-4" key={count.id}><div><p className="font-semibold">{count.name}</p><p className="text-xs text-slate-500">Started {new Date(count.createdAt).toLocaleDateString()} · {count.rows.length} products</p></div><Button onClick={() => { setActive(count); setPreview(false) }}>Continue draft</Button></div>)}</Card> : <EmptyState title="No saved stock counts" description="Start a physical stock count when you are ready." />}</> : <><Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="font-semibold">{active.name}</h2><p className="text-xs text-slate-500">{active.rows.length} tracked products · Started {new Date(active.createdAt).toLocaleString()}</p></div>{active.status === 'confirmed' && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Confirmed</span>}</Card>
      <Card className="overflow-hidden"><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Product', 'SKU', 'Unit', 'System stock', 'Physical count', 'Variance'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{active.rows.map(row => { const delta = variance(row); return <tr key={row.productId} className="border-t"><td className="p-3 font-medium">{row.productName}</td><td>{row.sku}</td><td>{row.unit}</td><td>{row.systemQuantity}</td><td><input aria-label={`Physical count for ${row.productName}`} disabled={active.status === 'confirmed'} type="number" min="0" step="any" className="w-32 rounded border p-2" value={row.physicalQuantity ?? ''} onChange={e => update(row.productId, e.target.value)} /></td><td className={delta !== null && delta !== 0 ? delta > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700' : ''}>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}`}</td></tr> })}</tbody></table></div><div className="divide-y md:hidden">{active.rows.map(row => { const delta = variance(row); return <article key={row.productId} className="p-4"><div className="flex justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{row.productName}</p><p className="text-xs text-slate-500">{row.sku} · {row.unit}</p></div><span className="text-sm">System: <strong>{row.systemQuantity}</strong></span></div><div className="mt-3 flex items-center justify-between gap-3"><label className="flex items-center gap-2 text-xs">Physical count<input disabled={active.status === 'confirmed'} type="number" min="0" step="any" aria-label={`Physical count for ${row.productName}`} className="w-28 rounded border p-2" value={row.physicalQuantity ?? ''} onChange={e => update(row.productId, e.target.value)} /></label><span className="text-xs">Variance <strong className={delta !== null && delta < 0 ? 'text-rose-700' : 'text-emerald-700'}>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}`}</strong></span></div></article> })}</div></Card>
      {preview && <Card className="mt-4 p-5"><h2 className="font-semibold">Review differences</h2><p className="mt-1 text-xs text-slate-500">Only products with a non-zero variance will create stock count movements.</p><div className="mt-3 space-y-2">{active.rows.filter(row => variance(row) !== 0).map(row => <p key={row.productId} className="flex justify-between gap-3 text-sm"><span>{row.productName} · {row.systemQuantity} → {row.physicalQuantity}</span><strong className={variance(row)! > 0 ? 'text-emerald-700' : 'text-rose-700'}>{variance(row)! > 0 ? '+' : ''}{variance(row)}</strong></p>)}{active.rows.every(row => variance(row) === 0) && <p className="text-sm text-slate-500">All counts match the system stock.</p>}</div></Card>}
      {(notice || error) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 text-sm ${error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{error || notice}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">{active.status === 'draft' ? <><Button onClick={save}>Save draft</Button><Button onClick={review}>Review differences</Button>{preview && <Button variant="primary" onClick={confirm}>Confirm stock count</Button>}</> : <span className="text-sm text-slate-500">Confirmed {active.confirmedAt ? new Date(active.confirmedAt).toLocaleString() : ''}</span>}</div>
    </>}
  </>
}
