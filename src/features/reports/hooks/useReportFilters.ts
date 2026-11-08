import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getPresetRange } from '../utils/reportDateUtils'
import type { ComparisonMode, ReportFilters, ReportPreset } from '../types/report.types'

const presets: ReportPreset[] = ['today', 'yesterday', '7d', '30d', 'this-week', 'last-week', 'this-month', 'last-month', 'this-year', 'last-year', 'custom']
export function useReportFilters() {
  const [params, setParams] = useSearchParams()
  const filters = useMemo<ReportFilters>(() => {
    const candidate = params.get('range') as ReportPreset | null
    const preset = candidate && presets.includes(candidate) ? candidate : 'this-month'
    const base = getPresetRange(preset)
    return { preset, from: params.get('from') ?? base.from, to: params.get('to') ?? base.to, comparison: (params.get('compare') as ComparisonMode) ?? 'previous-period', productId: params.get('product') ?? '', categoryId: params.get('category') ?? '', customerId: params.get('customer') ?? '', supplierId: params.get('supplier') ?? '', paymentMethod: params.get('method') ?? '', paymentStatus: params.get('paymentStatus') ?? '', transactionStatus: params.get('status') ?? '' }
  }, [params])
  const apply = (next: ReportFilters) => { const query = new URLSearchParams(); query.set('range', next.preset); query.set('from', next.from); query.set('to', next.to); query.set('compare', next.comparison); for (const [key, value] of [['product', next.productId], ['category', next.categoryId], ['customer', next.customerId], ['supplier', next.supplierId], ['method', next.paymentMethod], ['paymentStatus', next.paymentStatus], ['status', next.transactionStatus]]) if (value) query.set(key, value); setParams(query) }
  const clear = () => { const range = getPresetRange('this-month'); apply({ ...filters, ...range, preset: 'this-month', comparison: 'previous-period', productId: '', categoryId: '', customerId: '', supplierId: '', paymentMethod: '', paymentStatus: '', transactionStatus: '' }) }
  const refresh = () => setParams(new URLSearchParams(params))
  return { filters, apply, clear, refresh }
}
