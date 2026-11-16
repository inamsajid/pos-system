import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { CustomerForm } from '../components/CustomerForm'
import { customerService } from '../services/customerService'
import type { Customer, CustomerDraft } from '../types/customer.types'

export function EditCustomerPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState<Customer>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await customerService.getCustomerById(id)
      setCustomer(data)
    } catch (err: unknown) {
      setCustomer(undefined)
      setLoadError(err instanceof Error ? err.message : 'Unable to load customer details.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <p role="status" className="p-8 text-sm text-slate-500">
        Loading customer…
      </p>
    )
  }

  if (loadError) {
    return (
      <>
        <PageHeader
          title="Unable to load customer"
          description="Failed to retrieve customer details from the server."
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
              <Link to="/customers">
                <Button>Back to customers</Button>
              </Link>
            </div>
          }
        />
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {loadError}
        </div>
      </>
    )
  }

  if (!customer) {
    return (
      <PageHeader
        title="Customer not found"
        description="This customer is not in the current catalog."
        action={
          <Link to="/customers">
            <Button>Back to customers</Button>
          </Link>
        }
      />
    )
  }

  const save = async (draft: CustomerDraft) => {
    setSaving(true)
    setSaveError(null)
    try {
      await customerService.updateCustomer(customer.id, draft)
      navigate(`/customers/${customer.id}`, { state: { notice: 'Customer details updated.' } })
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Unable to update customer.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Edit customer" description={`Update details for ${customer.name}.`} />
      <div className="mx-auto max-w-4xl space-y-4">
        {saveError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{saveError}</span>
          </div>
        )}
        <CustomerForm
          key={customer.id}
          customer={customer}
          onSubmit={save}
          onCancel={() => navigate(`/customers/${customer.id}`)}
          saving={saving}
        />
      </div>
    </>
  )
}
