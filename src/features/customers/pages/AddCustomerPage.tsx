import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { CustomerForm } from '../components/CustomerForm'
import { customerService } from '../services/customerService'
import type { CustomerDraft } from '../types/customer.types'

export function AddCustomerPage() {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (draft: CustomerDraft, another: boolean) => {
    setSaving(true)
    setError(null)
    try {
      await customerService.createCustomer(draft)
      if (!another) navigate('/customers', { state: { notice: `${draft.name} was added.` } })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save customer.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Add customer" description="Create a customer profile for your business." />
      <div className="mx-auto max-w-4xl space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
        <CustomerForm onSubmit={save} onCancel={() => navigate('/customers')} saving={saving} />
      </div>
    </>
  )
}
