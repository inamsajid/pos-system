import type { HTMLAttributes, PropsWithChildren } from 'react'
import { cn } from '../../lib/utils'
export function Card({ children, className, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) { return <section className={cn('surface', className)} {...props}>{children}</section> }
