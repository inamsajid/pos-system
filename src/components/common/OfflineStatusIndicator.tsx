import { WifiOff, RefreshCw, AlertTriangle } from 'lucide-react'
import { useOfflineStatus } from './useOfflineStatus'

/**
 * Compact pill indicator suitable for placement in the top navigation header.
 */
export function OfflineStatusPill() {
  const { isOnline, isSyncing, syncState, triggerManualSync } = useOfflineStatus()

  if (isSyncing) {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
        <RefreshCw size={12} className="animate-spin text-sky-600" />
        <span>Syncing...</span>
      </div>
    )
  }

  if (!isOnline) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800"
        title="Operating offline. Using local IndexedDB catalog cache."
      >
        <WifiOff size={12} className="text-amber-600" />
        <span>Offline</span>
      </div>
    )
  }

  return (
    <button
      onClick={triggerManualSync}
      className="group flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors"
      title={
        syncState?.lastSuccessAt
          ? `Last synced: ${new Date(syncState.lastSuccessAt).toLocaleTimeString()}`
          : 'Catalog synced'
      }
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      <span>Online</span>
      <RefreshCw
        size={10}
        className="text-slate-400 group-hover:rotate-180 transition-transform duration-300"
      />
    </button>
  )
}

/**
 * Prominent informational banner displayed when offline or when using cached data.
 */
export function OfflineStatusBanner() {
  const { isOnline, isSyncing, syncState, triggerManualSync } = useOfflineStatus()

  if (isOnline) {
    return null
  }

  const lastSyncedTime = syncState?.lastSuccessAt
    ? new Date(syncState.lastSuccessAt).toLocaleString()
    : 'Unknown'

  return (
    <div
      role="alert"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-3 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-amber-600 shrink-0" />
        <div>
          <span className="font-semibold">Offline Mode Active.</span> Showing cached catalog data (last synced: {lastSyncedTime}). Only pre-authorized Walk-in Cash POS checkouts run locally (provisional until server sync). Catalog edits, customer credit, and reports wait for reconnection.
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={triggerManualSync}
          disabled={isSyncing}
          className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition-colors"
        >
          {isSyncing ? 'Reconnecting...' : 'Try Reconnecting'}
        </button>
      </div>
    </div>
  )
}
