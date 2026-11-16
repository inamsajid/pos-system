import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { SupplierForm } from '../components/SupplierForm'
import { supplierService } from '../services/supplierService'
import type { Supplier, SupplierDraft } from '../types/supplier.types'

export function EditSupplierPage() {
  const { supplierId: id = '' } = useParams()
  const nav = useNavigate()
  const [supplier, setSupplier] = useState<Supplier>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await supplierService.getSupplierById(id)
      setSupplier(data)
    } catch (err: unknown) {
      setSupplier(undefined)
      setLoadError(err instanceof Error ? err.message : 'Unable to load supplier details.')
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
        Loading supplier…
      </p>
    )
  }

  if (loadError) {
    return (
      <>
        <PageHeader
          title="Unable to load supplier"
          description="Failed to retrieve supplier details from the server."
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
              <Link to="/suppliers">
                <Button>Back to suppliers</Button>
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

  if (!supplier) {
    return (
      <PageHeader
        title="Supplier not found"
        description="This supplier is not in the catalog."
        action={
          <Link to="/suppliers">
            <Button>Back to suppliers</Button>
          </Link>
        }
      />
    )
  }

  const save = async (d: SupplierDraft) => {
    setSaving(true)
    setSaveError(null)
    try {
      await supplierService.updateSupplier(supplier.id, d)
      nav(`/suppliers/${supplier.id}`, { state: { notice: 'Supplier details updated.' } })
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Unable to update supplier.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Edit supplier" description={`Update ${supplier.name}.`} />
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
        <SupplierForm
          key={supplier.id}
          supplier={supplier}
          onSave={save}
          onCancel={() => nav(`/suppliers/${supplier.id}`)}
          saving={saving}
        />
      </div>
    </>
  )
}
