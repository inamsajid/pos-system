import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Users, UserCheck, UserX, Mail, Copy, Check, AlertCircle } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { formatBusinessDate } from '../../../lib/date'
import { useAuth } from '../../auth/context/useAuth'
import type { BranchInfo } from '../../auth/types'
import { apiClient, ApiError } from '../../../lib/api-client'
import { staffService } from '../services/staffService'
import type { StaffMember, StaffInvitation, StaffFilters as StaffFilterParams, StaffRole } from '../types/staff.types'
import { InviteStaffModal } from '../components/InviteStaffModal'
import { EditStaffModal } from '../components/EditStaffModal'
import { StaffFilters } from '../components/StaffFilters'
import { StaffTable } from '../components/StaffTable'

const ROLE_COLORS: Record<StaffRole, string> = {
  owner: 'bg-purple-100 text-purple-800 border-purple-200',
  admin: 'bg-blue-100 text-blue-800 border-blue-200',
  manager: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  cashier: 'bg-amber-100 text-amber-800 border-amber-200',
  accountant: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  inventory_manager: 'bg-teal-100 text-teal-800 border-teal-200',
}

export function StaffPage() {
  const navigate = useNavigate()
  const { user, activeBusiness } = useAuth()
  const actorRole: StaffRole = (activeBusiness?.role as StaffRole) || 'cashier'

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [invitations, setInvitations] = useState<StaffInvitation[]>([])
  const [branches, setBranches] = useState<BranchInfo[]>([])

  // Filters
  const [filters, setFilters] = useState<StaffFilterParams>({})

  // Modals
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editMember, setEditMember] = useState<StaffMember | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [staffRes, invRes, branchRes] = await Promise.allSettled([
        staffService.getStaff(filters),
        staffService.getInvitations(),
        apiClient.get<BranchInfo[]>('/branches'),
      ])

      if (staffRes.status === 'rejected') {
        setStaff([])
        setLoadError(
          staffRes.reason instanceof Error
            ? staffRes.reason.message
            : 'Unable to load staff members from server.'
        )
      } else {
        setStaff(staffRes.value)
      }

      if (invRes.status === 'fulfilled') {
        setInvitations(invRes.value)
      } else {
        setInvitations([])
        if (!(invRes.reason instanceof ApiError && invRes.reason.status === 403)) {
          setLoadError((prev) =>
            prev ||
            (invRes.reason instanceof Error
              ? invRes.reason.message
              : 'Unable to load staff invitations.')
          )
        }
      }

      if (branchRes.status === 'fulfilled') {
        if (Array.isArray(branchRes.value)) setBranches(branchRes.value)
      } else if (!(branchRes.reason instanceof ApiError && branchRes.reason.status === 403)) {
        setLoadError((prev) =>
          prev ||
          (branchRes.reason instanceof Error
            ? branchRes.reason.message
            : 'Unable to load business branches.')
        )
      }
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // KPIs
  const totalStaffCount = staff.length
  const activeStaffCount = useMemo(() => staff.filter(m => m.isActive).length, [staff])
  const suspendedStaffCount = useMemo(() => staff.filter(m => !m.isActive).length, [staff])
  const pendingInvitesCount = invitations.length

  const handleToggleActive = async (member: StaffMember) => {
    setActionError(null)
    if (member.userId === user?.id) {
      setActionError('You cannot suspend your own account.')
      return
    }

    try {
      if (member.isActive) {
        if (!confirm(`Are you sure you want to suspend access for ${member.name}?`)) return
        await staffService.suspendStaff(member.id)
      } else {
        await staffService.reactivateStaff(member.id)
      }
      await loadData()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to update member status.')
    }
  }

  const handleRevokeInvite = async (invitationId: string) => {
    setActionError(null)
    if (!confirm('Revoke this invitation?')) return
    try {
      await staffService.revokeInvitation(invitationId)
      await loadData()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to revoke invitation.')
    }
  }

  const handleCopyInviteLink = (inv: StaffInvitation) => {
    const link = inv.invitationLink || `/register?invitation=${inv.invitationToken}&email=${encodeURIComponent(inv.email)}`
    void navigator.clipboard.writeText(`${window.location.origin}${link}`)
    setCopiedId(inv.id)
    setTimeout(() => setCopiedId(null), 2500)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff & Team Management"
        description="Manage workspace team members, role assignments, branch access and onboarding invitations."
        action={
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => setInviteOpen(true)}
              className="flex items-center gap-1.5"
            >
              <Plus size={15} />
              Invite Staff Member
            </Button>
          </div>
        }
      />

      {(loadError || actionError) && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{actionError || loadError}</span>
          </div>
          <div className="flex items-center gap-2">
            {actionError && (
              <Button variant="secondary" onClick={() => setActionError(null)}>
                Dismiss
              </Button>
            )}
            {loadError && (
              <Button variant="secondary" onClick={() => void loadData()}>
                Retry
              </Button>
            )}
          </div>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 border-l-4 border-l-blue-500">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Staff</p>
            <span className="p-1.5 rounded-full bg-blue-50 text-blue-600">
              <Users size={16} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalStaffCount}</p>
          <p className="mt-1 text-xs text-slate-500">Registered workspace members</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Staff</p>
            <span className="p-1.5 rounded-full bg-emerald-50 text-emerald-600">
              <UserCheck size={16} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{activeStaffCount}</p>
          <p className="mt-1 text-xs text-slate-500">Authorized active credentials</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Suspended</p>
            <span className="p-1.5 rounded-full bg-amber-50 text-amber-600">
              <UserX size={16} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{suspendedStaffCount}</p>
          <p className="mt-1 text-xs text-slate-500">Temporarily inactive accounts</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-purple-500">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending Invites</p>
            <span className="p-1.5 rounded-full bg-purple-50 text-purple-600">
              <Mail size={16} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{pendingInvitesCount}</p>
          <p className="mt-1 text-xs text-slate-500">Awaiting employee registration</p>
        </Card>
      </div>

      {/* Filter Toolbar */}
      <StaffFilters
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters({})}
      />

      {/* Team Members List */}
      <div className="space-y-2">
        <div className="flex justify-between items-center px-1">
          <span className="text-xs font-semibold text-slate-700">Team Members ({staff.length})</span>
        </div>
        {loading ? (
          <Card className="p-8 text-center text-sm text-slate-500">Loading staff members…</Card>
        ) : (
          <StaffTable
            staff={staff}
            onEdit={member => setEditMember(member)}
            onSuspend={handleToggleActive}
            onReactivate={handleToggleActive}
            onViewDetails={member => navigate(`/staff/${member.id}`)}
            currentUserId={user?.id}
            currentUserRole={actorRole}
          />
        )}
      </div>

      {/* Pending Invitations Section */}
      {invitations.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center bg-purple-50/50">
            <span className="text-xs font-semibold text-purple-900">
              Pending Onboarding Invitations ({invitations.length})
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 uppercase text-[10px] tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-3">Invited Email</th>
                  <th className="p-3">Assigned Role</th>
                  <th className="p-3">Invited By</th>
                  <th className="p-3">Expires At</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invitations.map(inv => {
                  const isCopied = copiedId === inv.id
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 font-semibold text-slate-900">{inv.email}</td>
                      <td className="p-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider ${
                            ROLE_COLORS[inv.role] || 'bg-slate-100 text-slate-800'
                          }`}
                        >
                          {inv.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">
                        {inv.invitedByName || inv.invitedBy} ({formatBusinessDate(new Date(inv.createdAt))})
                      </td>
                      <td className="p-3 text-slate-500">
                        {formatBusinessDate(new Date(inv.expiresAt))}
                      </td>
                      <td className="p-3 text-right space-x-1">
                        <Button
                          variant="secondary"
                          onClick={() => handleCopyInviteLink(inv)}
                          className="text-xs px-2 py-1"
                        >
                          {isCopied ? <Check size={12} /> : <Copy size={12} />}
                          {isCopied ? 'Copied' : 'Copy Link'}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => handleRevokeInvite(inv.id)}
                          className="text-xs px-2 py-1 text-rose-600 hover:bg-rose-50 border-rose-200"
                        >
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modals */}
      <InviteStaffModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSuccess={() => void loadData()}
        branches={branches}
        actorRole={actorRole}
      />

      <EditStaffModal
        member={editMember}
        open={Boolean(editMember)}
        onClose={() => setEditMember(null)}
        onSuccess={() => void loadData()}
        branches={branches}
        actorRole={actorRole}
      />
    </div>
  )
}

