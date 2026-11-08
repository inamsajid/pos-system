import { useEffect, useState } from 'react'
import { loadReportDataset } from '../services/reportService'
import type { ReportDataset } from '../types/report.types'

export function useReportDataset(refreshKey = 0) {
  const [dataset, setDataset] = useState<ReportDataset>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { let active = true; void loadReportDataset().then(value => { if (active) { setDataset(value); setError('') } }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load report data.') }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [refreshKey])
  return { dataset, error, loading }
}
