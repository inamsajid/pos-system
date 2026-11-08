import type { ReactNode } from 'react'
import { PackageOpen, type LucideIcon } from 'lucide-react'

export function EmptyState({
  title,
  description,
  icon: Icon = PackageOpen,
  action,
}: {
  title: string
  description: string
  icon?: LucideIcon
  action?: ReactNode
}) {
  return (
    <div className="surface flex min-h-72 flex-col items-center justify-center p-8 text-center">
      <span className="mb-4 rounded-2xl bg-blue-50 p-4 text-blue-600">
        <Icon size={24} />
      </span>
      <h2 className="font-semibold text-slate-800">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
