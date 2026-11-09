import { AlertCircle, Clock, RefreshCw, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { useOutboxStatus } from './useOutboxStatus'

export function OutboxStatusIndicator() {
  const { stats, isRefreshing, triggerDispatch } = useOutboxStatus()
  const totalActive =
    stats.pendingCount +
    stats.processingCount +
    stats.retryableCount +
    stats.conflictCount +
    stats.blockedAuthCount

  if (totalActive === 0 && stats.rejectedCount === 0) {
    return null
  }

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm"
      role="status"
      aria-label="Synchronization Outbox Status"
    >
      <div className="flex items-center gap-1.5 font-medium">
        <Clock size={13} className="text-slate-400" />
        <span>Outbox:</span>
      </div>

      {stats.pendingCount > 0 && (
        <span
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700"
          title={`${stats.pendingCount} pending`}
        >
          {stats.pendingCount} pending
        </span>
      )}

      {stats.processingCount > 0 && (
        <span
          className="flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700"
          title={`${stats.processingCount} in progress`}
        >
          <RefreshCw size={9} className="animate-spin text-sky-600" />
          {stats.processingCount} sending
        </span>
      )}

      {stats.retryableCount > 0 && (
        <span
          className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
          title={`${stats.retryableCount} waiting to retry`}
        >
          {stats.retryableCount} retry
        </span>
      )}

      {stats.conflictCount > 0 && (
        <span
          className="flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
          title={`${stats.conflictCount} conflicts detected`}
        >
          <AlertCircle size={10} className="text-rose-600" />
          {stats.conflictCount} conflict
        </span>
      )}

      {stats.blockedAuthCount > 0 && (
        <span
          className="flex items-center gap-1 rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700"
          title={`${stats.blockedAuthCount} paused due to authentication`}
        >
          <ShieldAlert size={10} className="text-purple-600" />
          Auth required
        </span>
      )}

      {stats.rejectedCount > 0 && (
        <span
          className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
          title={`${stats.rejectedCount} rejected`}
        >
          {stats.rejectedCount} rejected
        </span>
      )}

      {stats.acknowledgedCount > 0 && totalActive === 0 && (
        <span className="flex items-center gap-1 text-emerald-600">
          <CheckCircle2 size={12} />
          Synced
        </span>
      )}

      <button
        onClick={() => triggerDispatch()}
        disabled={isRefreshing}
        className="ml-1 text-[11px] font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
        title="Sync now"
      >
        <RefreshCw size={11} className={isRefreshing ? 'animate-spin' : ''} />
      </button>
    </div>
  )
}

