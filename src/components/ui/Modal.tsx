import { useEffect, useRef, type PropsWithChildren } from 'react'
import { X } from 'lucide-react'
export function Modal({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:PropsWithChildren['children']}){
  const dialogRef=useRef<HTMLElement>(null)
  const closeRef=useRef(onClose)
  useEffect(()=>{closeRef.current=onClose},[onClose])
  useEffect(()=>{
    if(!open)return
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null
    const previousOverflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    dialogRef.current?.querySelector<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')?.focus()
    const handleKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();closeRef.current();return}
      if(event.key!=='Tab'||!dialogRef.current)return
      const focusable=Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      if(!focusable.length)return
      const first=focusable[0];const last=focusable[focusable.length-1]
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
    document.addEventListener('keydown',handleKeyDown)
    return()=>{document.removeEventListener('keydown',handleKeyDown);document.body.style.overflow=previousOverflow;previousFocus?.focus()}
  },[open])
  if(!open)return null
  return <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="presentation"><button type="button" className="absolute inset-0 bg-slate-950/40" onClick={onClose} aria-label="Close dialog"/><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><h2 id="modal-title" className="font-semibold text-slate-900">{title}</h2><button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18}/></button></div>{children}</section></div>
}
