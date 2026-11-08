import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { isValidElement } from 'react'
import { Card } from '../../../components/ui/Card'
import { Download } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { exportCsv } from '../utils/reportExportUtils'

export function ReportDataTable({ title, headers, rows, empty = 'No records match this report period.' }: { title: string; headers: string[]; rows: Array<{ key: string; cells: ReactNode[] }>; empty?: string }) {
  const [query,setQuery]=useState('');const [sort,setSort]=useState<{column:number;direction:'asc'|'desc'}>({column:0,direction:'asc'});const [page,setPage]=useState(1);const [size,setSize]=useState(10)
  const filtered=useMemo(()=>rows.filter(row=>!query||row.cells.map(cellText).join(' ').toLowerCase().includes(query.toLowerCase())).sort((a,b)=>{const left=cellText(a.cells[sort.column]??'');const right=cellText(b.cells[sort.column]??'');const result=left.localeCompare(right,undefined,{numeric:true,sensitivity:'base'});return sort.direction==='asc'?result:-result}),[rows,query,sort])
  const pages=Math.max(1,Math.ceil(filtered.length/size));const shown=filtered.slice((page-1)*size,page*size)
  return <Card className="report-data-table min-w-0 overflow-hidden p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{title}</h2><div className="flex gap-2"><input aria-label={`Search ${title}`} className="min-w-0 rounded border border-slate-200 px-2 py-1.5 text-xs" placeholder="Search rows…" value={query} onChange={event=>{setQuery(event.target.value);setPage(1)}}/><span className="self-center text-xs text-slate-500">{filtered.length} rows</span><Button onClick={()=>exportCsv(`${title.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.csv`,headers,filtered.map(row=>row.cells.map(cellText)))}><Download size={13}/>CSV</Button></div></div>{shown.length ? <><div className="overflow-x-auto"><table className="w-full min-w-max text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{headers.map((header,index) => <th className="whitespace-nowrap p-3" key={header}><button onClick={()=>setSort(current=>({column:index,direction:current.column===index&&current.direction==='asc'?'desc':'asc'}))}>{header}{sort.column===index?(sort.direction==='asc'?' ↑':' ↓'):''}</button></th>)}</tr></thead><tbody>{shown.map(row => <tr className="border-t border-slate-100" key={row.key}>{row.cells.map((cell,index)=><td className="whitespace-nowrap p-3" key={`${row.key}-${headers[index]??index}`}>{cell}</td>)}</tr>)}</tbody></table></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span>Page {page} of {pages}</span><div className="flex items-center gap-2"><select aria-label={`${title} page size`} value={size} onChange={event=>{setSize(Number(event.target.value));setPage(1)}} className="rounded border p-1.5"><option value={10}>10 / page</option><option value={25}>25 / page</option><option value={50}>50 / page</option></select><button disabled={page<=1} onClick={()=>setPage(value=>value-1)} className="rounded border px-2 py-1 disabled:opacity-40">Previous</button><button disabled={page>=pages} onClick={()=>setPage(value=>value+1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button></div></div></> : <p className="py-8 text-center text-sm text-slate-500">{empty}</p>}</Card>
}

function cellText(value: ReactNode): string {
  if (value === null || value === undefined || typeof value === 'boolean') return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(cellText).join(' ')
  if (isValidElement<{ children?: ReactNode }>(value)) return cellText(value.props.children)
  return ''
}
