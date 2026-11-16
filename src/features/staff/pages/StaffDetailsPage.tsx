import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, UserX, UserCheck, Edit3 } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { useAuth } from '../../auth/context/useAuth'
import type { BranchInfo } from '../../auth/types'
import { apiClient } from '../../../lib/api-client'
import { staffService } from '../services/staffService'
import type { StaffMember, StaffRole } from '../types/staff.types'
import { StaffStatusBadge } from '../components/StaffStatusBadge'
import { PermissionSummary } from '../components/PermissionSummary'
import { EditStaffModal } from '../components/EditStaffModal'
import { formatBusinessDate } from '../../../lib/businessDate'

export function StaffDetailsPage() {
  const { id = '' } = useParams()
  const { user: currentUser, activeBusiness } = useAuth()

  const [member, setMember] = useState<StaffMember | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const currentRole = (activeBusiness?.role as StaffRole) || 'cashier'
  const isSelf = member?.userId === currentUser?.id
  const canManage = member && !isSelf && (currentRole === 'owner' || member.role !== 'owner')

  const loadMember = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await staffService.getStaffMember(id)
      setMember(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to load staff member.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (id) {
      void loadMember()
    }
    void apiClient
      .get<BranchInfo[]>('/branches')
      .then((res) => {
        if (Array.isArray(res)) setBranches(res)
      })
      .catch((err) => {
        setActionError((prev) =>
          prev || (err instanceof Error ? err.message : 'Unable to load branch list.')
        )
      })
  }, [id])

  const handleToggleSuspend = async () => {
    if (!member) return
    setActionError(null)
    const confirmed = window.confirm(
      member.isActive
        ? `Are you sure you want to suspend access for ${member.name}? They will immediately lose access to this business.`
        : `Reactivate staff access for ${member.name}?`
    )
    if (!confirmed) return

    try {
      if (member.isActive) {
        await staffService.suspendStaff(member.id)
      } else {
        await staffService.reactivateStaff(member.id)
      }
      await loadMember()
    } catch (err: any) {
      setActionError(err?.message || 'Operation failed.')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Staff Member Details" description="Loading member profile…" />
        <Card className="p-8 text-center text-sm text-slate-500">Loading staff details…</Card>
      </div>
    )
  }

  if (error || !member) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Staff Member Not Found"
          description={error || 'The requested staff member does not exist in this business.'}
          action={
            <Link to="/staff">
              <Button variant="secondary" className="flex items-center gap-1.5">
                <ArrowLeft className="h-4 w-4" />
                Back to Staff
              </Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={member.name}
        description={`Staff profile and tenancy permissions for ${member.email}.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/staff">
              <Button variant="secondary" className="flex items-center gap-1.5">
                <ArrowLeft className="h-4 w-4" />
                Staff List
              </Button>
            </Link>

            {canManage && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setEditOpen(true)}
                  className="flex items-center gap-1.5"
                >
                  <Edit3 className="h-4 w-4" />
                  Edit Role & Branches
                </Button>

                {member.isActive ? (
                  <Button
                    variant="secondary"
                    onClick={handleToggleSuspend}
                    className="flex items-center gap-1.5 text-rose-600 hover:bg-rose-50 border-rose-200"
                  >
                    <UserX className="h-4 w-4" />
                    Suspend Access
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={handleToggleSuspend}
                    className="flex items-center gap-1.5 text-emerald-600 hover:bg-emerald-50 border-emerald-200"
                  >
                    <UserCheck className="h-4 w-4" />
                    Reactivate Access
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />

      {actionError && (
        <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700 border border-rose-200">
          {actionError}
        </div>
      )}

      {/* Profile Overview Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* User Card */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-lg font-bold">
              {member.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-bold text-slate-900">{member.name}</h3>
              <p className="text-xs text-slate-500">{member.email}</p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Membership Status:</span>
              <StaffStatusBadge isActive={member.isActive} />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500">Role:</span>
              <span className="font-semibold capitalize text-slate-900">
                {member.role.replace('_', ' ')}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500">Phone:</span>
              <span className="font-mono text-slate-800">{member.phone || '—'}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500">Joined Date:</span>
              <span className="text-slate-800">
                {formatBusinessDate(new Date(member.createdAt))}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500">Global Account:</span>
              <span className="capitalize text-slate-700">{member.status}</span>
            </div>
          </div>
        </Card>

        {/* Assigned Branches */}
        <Card className="p-5 space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-600" />
              Branch Authorizations
            </h3>
            {member.role === 'owner' || member.role === 'admin' ? (
              <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                All Branches
              </span>
            ) : (
              <span className="text-xs text-slate-500">
                {member.assignedBranches.length} branches assigned
              </span>
            )}
          </div>

          {member.role === 'owner' || member.role === 'admin' ? (
            <p className="text-xs text-slate-600 leading-relaxed">
              As an authorized <strong className="capitalize">{member.role}</strong>, this staff member holds full operational privileges across all active and future branches within {activeBusiness?.name || 'this business'}.
            </p>
          ) : member.assignedBranches.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {member.assignedBranches.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 text-xs"
                >
                  <Building2 className="h-4 w-4 text-slate-400" />
                  <div>
                    <p className="font-semibold text-slate-900">{b.name}</p>
                    <p className="text-[11px] text-slate-500">{b.branchCode}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">
              No branch assignments recorded. Click "Edit Role & Branches" to authorize branch access.
            </p>
          )}
        </Card>
      </div>

      {/* Permission Summary Matrix */}
      <Card className="p-5">
        <PermissionSummary role={member.role} />
      </Card>

      {/* Edit Modal */}
      {editOpen && (
        <EditStaffModal
          member={member}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSuccess={() => void loadMember()}
          branches={branches}
          actorRole={currentRole}
        />
      )}
    </div>
  )
}

