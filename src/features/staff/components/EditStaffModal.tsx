import { useEffect, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import type { BranchInfo } from '../../auth/types'
import { staffService } from '../services/staffService'
import type { StaffMember, StaffRole } from '../types/staff.types'

interface Props {
  member: StaffMember | null
  open: boolean
  onClose: () => void
  onSuccess: () => void
  branches: BranchInfo[]
  actorRole: StaffRole
}

export function EditStaffModal({ member, open, onClose, onSuccess, branches, actorRole }: Props) {
  const [role, setRole] = useState<StaffRole>('cashier')
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (member) {
      setRole(member.role)
      setSelectedBranches(member.assignedBranches.map(b => b.id))
      setError(null)
    }
  }, [member])

  if (!member) return null

  const toggleBranch = (id: string) => {
    setSelectedBranches(prev =>
      prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setIsSubmitting(true)
      setError(null)

      if (role !== member.role) {
        await staffService.updateRole(member.id, role)
      }

      await staffService.updateBranches(member.id, selectedBranches)

      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to update staff member.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Edit Staff: ${member.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
            {error}
          </div>
        )}

        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500">Name:</span>
            <span className="font-semibold text-slate-800">{member.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Email:</span>
            <span className="text-slate-700">{member.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Current Role:</span>
            <span className="font-semibold uppercase text-slate-700">{member.role}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Role</label>
          <select
            value={role}
            onChange={e => setRole(e.target.value as StaffRole)}
            className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:ring-2 focus:ring-blue-500 capitalize"
            disabled={actorRole !== 'owner' && member.role === 'owner'}
            aria-label="Staff role"
          >
            {actorRole === 'owner' && <option value="owner">Owner (Full Business Control)</option>}
            {actorRole === 'owner' && <option value="admin">Admin (Operational Administration)</option>}
            <option value="manager">Manager (Branch Operations)</option>
            <option value="cashier">Cashier (Point of Sale)</option>
            <option value="accountant">Accountant (Ledgers & Expenses)</option>
            <option value="inventory_manager">Inventory Manager (Stock & Goods)</option>
          </select>
        </div>

        {branches.length > 0 && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Branch Access Assignment
            </label>
            <p className="text-[11px] text-slate-500 mb-2">
              Select branches this staff member is authorized to access:
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
            {isSubmitting ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

