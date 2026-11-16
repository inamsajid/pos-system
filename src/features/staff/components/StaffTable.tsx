import React from 'react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { StaffStatusBadge } from './StaffStatusBadge'
import type { StaffMember, StaffRole } from '../types/staff.types'
import { formatBusinessDate } from '../../../lib/businessDate'
import { Shield, Building2, UserX, UserCheck, Edit3 } from 'lucide-react'

export interface StaffTableProps {
  staff: StaffMember[]
  onEdit: (member: StaffMember) => void
  onSuspend: (member: StaffMember) => void
  onReactivate: (member: StaffMember) => void
  onViewDetails?: (member: StaffMember) => void
  currentUserId?: string
  currentUserRole?: StaffRole
  emptyMessage?: string
}

export const StaffTable: React.FC<StaffTableProps> = ({
  staff,
  onEdit,
  onSuspend,
  onReactivate,
  onViewDetails,
  currentUserId,
  currentUserRole = 'cashier',
  emptyMessage = 'No staff members match the selected filters.',
}) => {
  const getRoleBadge = (role: StaffRole) => {
    switch (role) {
      case 'owner':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
            <Shield className="h-3 w-3" />
            Owner
          </span>
        )
      case 'admin':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
            Admin
          </span>
        )
      case 'manager':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            Manager
          </span>
        )
      case 'cashier':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            Cashier
          </span>
        )
      case 'inventory_manager':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-700">
            Inventory Mgr
          </span>
        )
      case 'accountant':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
            Accountant
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
            {role}
          </span>
        )
    }
  }

  const canManage = (target: StaffMember) => {
    if (target.userId === currentUserId) return false // Cannot suspend/edit self
    if (currentUserRole !== 'owner' && target.role === 'owner') return false
    return true
  }

  return (
    <Card className="overflow-hidden">
      {/* Desktop Table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[850px] text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="p-3">Staff Member</th>
              <th className="p-3">Business Role</th>
              <th className="p-3">Assigned Branches</th>
              <th className="p-3 text-center">Status</th>
              <th className="p-3">Joined Date</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {staff.map((member) => {
              const isSelf = member.userId === currentUserId
              const manageable = canManage(member)

              return (
                <tr key={member.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 font-bold text-xs">
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onViewDetails?.(member)}
                            className="font-semibold text-slate-900 hover:text-blue-600 hover:underline text-left"
                          >
                            {member.name}
                          </button>
                          {isSelf && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.2 text-[10px] font-semibold text-blue-700">
                              You
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500">{member.email}</p>
                      </div>
                    </div>
                  </td>

                  <td className="p-3 whitespace-nowrap">{getRoleBadge(member.role)}</td>

                  <td className="p-3">
                    {member.role === 'owner' || member.role === 'admin' ? (
                      <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 font-medium">
                        <Building2 className="h-3 w-3" />
                        All branches
                      </span>
                    ) : member.assignedBranches.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {member.assignedBranches.map((b) => (
                          <span
                            key={b.id}
                            className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700 border border-blue-100"
                          >
                            {b.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">No branch assigned</span>
                    )}
                  </td>

                  <td className="p-3 text-center">
                    <StaffStatusBadge isActive={member.isActive} />
                  </td>

                  <td className="p-3 text-slate-600 whitespace-nowrap">
                    {formatBusinessDate(new Date(member.createdAt))}
                  </td>

                  <td className="p-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="secondary"
                        onClick={() => onEdit(member)}
                        disabled={!manageable}
                        className="h-7 px-2 text-xs flex items-center gap-1"
                        title="Edit staff role and branches"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Edit
                      </Button>

                      {member.isActive ? (
                        <Button
                          variant="secondary"
                          onClick={() => onSuspend(member)}
                          disabled={!manageable}
                          className="h-7 px-2 text-xs text-rose-600 hover:bg-rose-50 border-rose-200 flex items-center gap-1 disabled:text-slate-400"
                          title="Suspend access"
                        >
                          <UserX className="h-3.5 w-3.5" />
                          Suspend
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => onReactivate(member)}
                          disabled={!manageable}
                          className="h-7 px-2 text-xs text-emerald-600 hover:bg-emerald-50 border-emerald-200 flex items-center gap-1 disabled:text-slate-400"
                          title="Reactivate access"
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                          Reactivate
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List */}
      <div className="divide-y divide-slate-100 md:hidden">
        {staff.map((member) => {
          const isSelf = member.userId === currentUserId
          const manageable = canManage(member)

          return (
            <article key={member.id} className="p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onViewDetails?.(member)}
                      className="font-semibold text-slate-900 hover:underline text-left"
                    >
                      {member.name}
                    </button>
                    {isSelf && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.2 text-[10px] font-semibold text-blue-700">
                        You
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{member.email}</p>
                </div>
                <StaffStatusBadge isActive={member.isActive} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {getRoleBadge(member.role)}
                <span className="text-xs text-slate-400">·</span>
                <span className="text-xs text-slate-500">
                  Joined {formatBusinessDate(new Date(member.createdAt))}
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-50">
                <Button
                  variant="secondary"
                  onClick={() => onEdit(member)}
                  disabled={!manageable}
                  className="h-7 px-2 text-xs"
                >
                  Edit
                </Button>
                {member.isActive ? (
                  <Button
                    variant="secondary"
                    onClick={() => onSuspend(member)}
                    disabled={!manageable}
                    className="h-7 px-2 text-xs text-rose-600"
                  >
                    Suspend
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => onReactivate(member)}
                    disabled={!manageable}
                    className="h-7 px-2 text-xs text-emerald-600"
                  >
                    Reactivate
                  </Button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {staff.length === 0 && (
        <p className="p-8 text-center text-sm text-slate-500">{emptyMessage}</p>
      )}
    </Card>
  )
}

