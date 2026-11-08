import { useEffect } from 'react'
import { Check, X } from 'lucide-react'

export function ProductToast({message,onClose}:{message?:string;onClose:()=>void}){
  useEffect(()=>{if(!message)return;const timer=window.setTimeout(onClose,4000);return()=>window.clearTimeout(timer)},[message,onClose])
  if(!message)return null
  return <div role="status" className="fixed right-4 top-20 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-lg"><span className="rounded-full bg-emerald-50 p-1.5 text-emerald-700"><Check size={15}/></span><span className="flex-1">{message}</span><button onClick={onClose} aria-label="Dismiss notification" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={15}/></button></div>
}
