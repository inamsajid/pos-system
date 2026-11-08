import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'
import { cn } from '../../lib/utils'
type Props = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }>
export function Button({ children, variant = 'secondary', className, ...props }: Props) { return <button className={cn('inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50', variant === 'primary' && 'bg-blue-600 text-white shadow-sm', variant === 'secondary' && 'border border-slate-200 bg-white text-slate-700', variant === 'ghost' && 'text-slate-600 hover:bg-slate-100', className)} {...props}>{children}</button> }
