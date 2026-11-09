import { useState } from 'react'
import { ImagePlus, Trash2, Upload, Loader2 } from 'lucide-react'
import { ProductImage } from './ProductImage'
import { fileService } from '../../files/services/fileService'

export function ProductImageUpload({ value, onChange }: { value?: string; onChange: (url?: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPEG, WEBP).')
      return
    }
    setError(null)
    setUploading(true)
    try {
      const result = await fileService.uploadFile(file, 'product')
      onChange(result.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <span className="block text-xs font-semibold text-slate-700">
        Product image <span className="font-normal text-slate-400">(optional)</span>
      </span>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <ProductImage name="Product preview" imageUrl={value} className="h-20 w-20 rounded-2xl border border-slate-200" />
        <div>
          <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
            {uploading ? <Loader2 size={14} className="animate-spin text-blue-600" /> : <Upload size={14} />}
            {uploading ? 'Uploading…' : value ? 'Change image' : 'Choose image'}
            <input type="file" accept="image/*" disabled={uploading} className="sr-only" onChange={(event) => void handleFile(event.target.files?.[0])} />
          </label>
          <p className="mt-2 text-[11px] text-slate-400">
            Private secure storage via Cloudflare R2.
          </p>
          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
          {value && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-700"
            >
              <Trash2 size={13} />
              Remove image
            </button>
          )}
        </div>
      </div>
      <div className="sr-only">
        <ImagePlus size={1} />
      </div>
    </div>
  )
}
