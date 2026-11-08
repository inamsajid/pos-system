import type { HTMLAttributes, PropsWithChildren, ThHTMLAttributes, TdHTMLAttributes } from 'react'
export function Table({children,...props}:PropsWithChildren<HTMLAttributes<HTMLTableElement>>){return <div className="table-scroll"><table className="w-full text-left" {...props}>{children}</table></div>}
export function TableHeader({children,...props}:PropsWithChildren<HTMLAttributes<HTMLTableSectionElement>>){return <thead className="border-y border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-400" {...props}>{children}</thead>}
export function TableHead({children,...props}:PropsWithChildren<ThHTMLAttributes<HTMLTableCellElement>>){return <th className="px-6 py-3" {...props}>{children}</th>}
export function TableCell({children,...props}:PropsWithChildren<TdHTMLAttributes<HTMLTableCellElement>>){return <td className="px-6 py-4" {...props}>{children}</td>}
