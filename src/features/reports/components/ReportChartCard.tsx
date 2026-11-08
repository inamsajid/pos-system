import type { ReactNode } from 'react'
import { Card } from '../../../components/ui/Card'

export function ReportChartCard({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return <Card className={`min-w-0 overflow-hidden p-4 sm:p-5 ${className}`}><div className="mb-3"><h2 className="font-semibold text-slate-900">{title}</h2>{subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}</div>{children}</Card>
}
