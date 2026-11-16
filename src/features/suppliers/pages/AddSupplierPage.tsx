import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { PageHeader } from '../../../components/common/PageHeader'
import { SupplierForm } from '../components/SupplierForm'
import { supplierService } from '../services/supplierService'
import type { SupplierDraft } from '../types/supplier.types'

export function AddSupplierPage() {
  const nav = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (d: SupplierDraft, another: boolean) => {
    setSaving(true)
    setError(null)
    try {
      await supplierService.createSupplier(d)
      if (!another) nav('/suppliers', { state: { notice: `${d.name} added.` } })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to create supplier.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Add supplier" description="Add a supplier to your catalog." />
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
        <SupplierForm onSave={save} onCancel={() => nav('/suppliers')} saving={saving} />
      </div>
    </>
  )
}
