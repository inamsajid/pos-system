import { useState } from 'react'
import { Copy, Check, Shield } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import type { BranchInfo } from '../../auth/types'
import { staffService } from '../services/staffService'
import type { StaffInvitation, StaffRole } from '../types/staff.types'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  branches: BranchInfo[]
  actorRole: StaffRole
}

const ROLE_DESCRIPTIONS: Record<StaffRole, { title: string; desc: string }> = {
  owner: { title: 'Owner', desc: 'Full business control, billing, settings, and staff lifecycle.' },
  admin: { title: 'Admin', desc: 'Manage operations, staff, products, purchases, and view reports.' },
  manager: { title: 'Manager', desc: 'Operations oversight, stock adjustments, purchase approvals, sales.' },
  cashier: { title: 'Cashier', desc: 'Point-of-sale checkout, customer payments, cash register.' },
  accountant: { title: 'Accountant', desc: 'Financial ledgers, payments disbursement, reports, expenses.' },
  inventory_manager: { title: 'Inventory Manager', desc: 'Stock movements, goods receipts, purchase orders.' },
}

export function InviteStaffModal({ open, onClose, onSuccess, branches, actorRole }: Props) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('cashier')
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invitationResult, setInvitationResult] = useState<StaffInvitation | null>(null)
  const [copied, setCopied] = useState(false)

  const toggleBranch = (id: string) => {
    setSelectedBranches(prev =>
      prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!email.trim()) {
      setError('Email address is required.')
      return
    }

    try {
      setIsSubmitting(true)
      const res = await staffService.inviteStaff({
        email: email.trim(),
        role,
        branchIds: selectedBranches.length > 0 ? selectedBranches : undefined,
      })
      setInvitationResult(res)
      onSuccess()
    } catch (err: any) {
      setError(err?.message || 'Failed to generate invitation.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopyLink = () => {
    if (!invitationResult?.invitationLink) return
    const fullUrl = `${window.location.origin}${invitationResult.invitationLink}`
    void navigator.clipboard.writeText(fullUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const handleDone = () => {
    setInvitationResult(null)
    setEmail('')
    setRole('cashier')
    setSelectedBranches([])
    onClose()
  }

  return (
    <Modal open={open} onClose={invitationResult ? handleDone : onClose} title="Invite New Staff Member">
      {invitationResult ? (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
            <div className="inline-grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-600">
              <Check size={20} />
            </div>
            <h3 className="text-sm font-bold text-emerald-900">Staff Invitation Generated!</h3>
            <p className="text-xs text-emerald-700">
              An invitation for <strong>{invitationResult.email}</strong> as{' '}
              <span className="uppercase font-semibold">{invitationResult.role}</span> is ready.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">Invitation Link (Valid for 7 days):</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={`${window.location.origin}${invitationResult.invitationLink}`}
                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs font-mono text-slate-700 select-all"
                aria-label="Invitation Link"
              />
              <Button type="button" variant="primary" onClick={handleCopyLink} className="text-xs px-3">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              Share this link with your staff member to let them accept the role and join your workspace.
            </p>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-100">
            <Button type="button" variant="secondary" onClick={handleDone}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Staff Email Address <span className="text-rose-500">*</span>
            </label>
            <input
              type="email"
              placeholder="e.g., employee@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:ring-2 focus:ring-blue-500"
              aria-label="Staff email"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Role & Permissions <span className="text-rose-500">*</span>
            </label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as StaffRole)}
              className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:ring-2 focus:ring-blue-500 capitalize"
              aria-label="Staff role"
            >
              {actorRole === 'owner' && <option value="owner">Owner (Full Business Control)</option>}
              {actorRole === 'owner' && <option value="admin">Admin (Operational Administration)</option>}
              <option value="manager">Manager (Branch Operations)</option>
              <option value="cashier">Cashier (Point of Sale)</option>
              <option value="accountant">Accountant (Ledgers & Expenses)</option>
              <option value="inventory_manager">Inventory Manager (Stock & Goods)</option>
            </select>
            <div className="mt-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs flex gap-2 items-start">
              <Shield size={14} className="text-blue-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-800">{ROLE_DESCRIPTIONS[role].title}: </span>
                <span className="text-slate-600">{ROLE_DESCRIPTIONS[role].desc}</span>
              </div>
            </div>
          </div>

          {branches.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Branch Access Assignment
              </label>
              <p className="text-[11px] text-slate-500 mb-2">
                Leave unselected to grant access to all business branches.
              </p>
              <div className="space-y-1.5 max-h-36 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {branches.map(b => (
                  <label key={b.id} className="flex items-center gap-2 text-xs text-slate-700 hover:bg-slate-50 p-1 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedBranches.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>{b.name} ({b.branch_code})</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? 'Generating…' : 'Generate Invitation'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

