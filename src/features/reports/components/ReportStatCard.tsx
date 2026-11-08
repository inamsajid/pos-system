import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { formatCurrency } from '../../../lib/currency'
import { compareValue } from '../services/reportService'
import type { ReportMetric } from '../types/report.types'

export function ReportStatCard({ metric, icon: Icon }: { metric: ReportMetric; icon: LucideIcon }) {
  const current = metric.value
  const delta = current !== null && metric.previous !== null ? compareValue(current, metric.previous) : undefined
  const display = metric.valueText ?? (current === null ? 'Unavailable' : metric.format === 'currency' ? formatCurrency(current) : metric.format === 'percent' ? `${current.toFixed(1)}%` : current.toLocaleString('en-PK', { maximumFractionDigits: 2 }))
  return <Card className="min-w-0 p-4"><div className="flex items-start justify-between gap-2"><p className="text-xs font-medium text-slate-500">{metric.label}</p><Icon size={17} className="shrink-0 text-blue-600" /></div><p className="mt-2 break-words text-xl font-bold text-slate-900">{display}</p>{metric.note && <p className="mt-1 text-[11px] text-slate-500">{metric.note}</p>}{delta && <div className={`mt-2 flex items-center gap-1 text-xs ${delta.difference > 0 ? 'text-emerald-700' : delta.difference < 0 ? 'text-rose-700' : 'text-slate-500'}`}>{delta.difference > 0 ? <ArrowUpRight size={14} /> : delta.difference < 0 ? <ArrowDownRight size={14} /> : <Minus size={14} />}<span>{delta.percent === null ? (delta.difference ? 'New activity (previous period was zero)' : 'No change') : `${Math.abs(delta.percent).toFixed(1)}% vs comparison`} · {delta.difference >= 0 ? '+' : ''}{metric.format === 'currency' ? formatCurrency(delta.difference) : delta.difference.toLocaleString('en-PK')}</span></div>}</Card>
}
