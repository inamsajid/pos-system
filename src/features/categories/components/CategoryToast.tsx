import { useEffect } from 'react'
import { AlertCircle, Check, X } from 'lucide-react'

interface CategoryToastProps {
  message?: string
  tone?: 'success' | 'error'
  onClose: () => void
}

export function CategoryToast({ message, tone = 'success', onClose }: CategoryToastProps) {
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(onClose, 4000)
    return () => window.clearTimeout(timer)
  }, [message, onClose])

  if (!message) return null

  const isError = tone === 'error'

  return (
    <div
      role="status"
      className={`fixed right-4 top-20 z-50 flex max-w-sm items-center gap-3 rounded-xl border bg-white px-4 py-3 text-sm shadow-lg ${
        isError ? 'border-rose-200 text-rose-800' : 'border-emerald-200 text-slate-700'
      }`}
    >
      <span
        className={`rounded-full p-1.5 ${
          isError ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'
        }`}
      >
        {isError ? <AlertCircle size={15} /> : <Check size={15} />}
      </span>
      <span className="flex-1 text-xs leading-5 font-medium">{message}</span>
      <button
        onClick={onClose}
        aria-label="Dismiss notification"
        className="rounded p-1 text-slate-400 hover:bg-slate-100"
      >
        <X size={15} />
      </button>
    </div>
  )
}

