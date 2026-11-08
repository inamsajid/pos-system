import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import type {
  CategoryColor,
  CategoryDraft,
  CategoryIconName,
  CategoryWithStats,
} from '../types/category.types'
import { categoryColors, categoryIcons, generateSlug } from '../utils/categoryUtils'

const categorySchema = z.object({
  name: z.string().trim().min(2, 'Category name must be at least 2 characters.'),
  slug: z
    .string()
    .trim()
    .min(2, 'Slug must be at least 2 characters.')
    .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens.'),
  description: z.string().optional(),
  color: z.enum(['blue', 'indigo', 'emerald', 'amber', 'rose', 'purple', 'cyan']),
  icon: z.enum([
    'Tags',
    'Laptop',
    'Headphones',
    'ShoppingBag',
    'Shirt',
    'Utensils',
    'BookOpen',
    'Boxes',
    'Sparkles',
    'Package',
  ]),
  status: z.enum(['active', 'archived']),
})

interface CategoryFormModalProps {
  open: boolean
  category?: CategoryWithStats
  categories: CategoryWithStats[]
  onClose: () => void
  onSubmit: (draft: CategoryDraft) => Promise<void>
}

const colorOptions: CategoryColor[] = ['blue', 'indigo', 'emerald', 'amber', 'rose', 'purple', 'cyan']

const iconOptions: CategoryIconName[] = [
  'Tags',
  'Laptop',
  'Headphones',
  'ShoppingBag',
  'Shirt',
  'Utensils',
  'BookOpen',
  'Boxes',
  'Sparkles',
  'Package',
]

export function CategoryFormModal({
  open,
  category,
  categories,
  onClose,
  onSubmit,
}: CategoryFormModalProps) {
  const isEditing = Boolean(category)

  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CategoryDraft>({
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      color: 'blue',
      icon: 'Tags',
      status: 'active',
    },
  })

  const selectedColor = useWatch({ control, name: 'color' })
  const selectedIcon = useWatch({ control, name: 'icon' })

  useEffect(() => {
    if (open) {
      if (category) {
        reset({
          name: category.name,
          slug: category.slug,
          description: category.description ?? '',
          color: category.color,
          icon: category.icon,
          status: category.status,
        })
      } else {
        reset({
          name: '',
          slug: '',
          description: '',
          color: 'blue',
          icon: 'Tags',
          status: 'active',
        })
      }
    }
  }, [open, category, reset])

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setValue('name', val, { shouldValidate: true })
    if (!isEditing) {
      setValue('slug', generateSlug(val), { shouldValidate: true })
    }
  }

  const handleFormSubmit = async (values: CategoryDraft) => {
    // Validate with Zod
    const parsed = categorySchema.safeParse(values)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof CategoryDraft
        setError(field, { message: issue.message })
      }
      return
    }

    // Check duplicate name
    const normName = parsed.data.name.trim().toLowerCase()
    const duplicateName = categories.some(
      (c) => c.id !== category?.id && c.name.trim().toLowerCase() === normName
    )
    if (duplicateName) {
      setError('name', { message: 'A category with this name already exists.' })
      return
    }

    // Check duplicate slug
    const normSlug = parsed.data.slug.trim().toLowerCase()
    const duplicateSlug = categories.some(
      (c) => c.id !== category?.id && c.slug.trim().toLowerCase() === normSlug
    )
    if (duplicateSlug) {
      setError('slug', { message: 'This slug is already used by another category.' })
      return
    }

    try {
      await onSubmit({
        ...parsed.data,
        name: parsed.data.name.trim(),
        slug: parsed.data.slug.trim(),
        description: parsed.data.description?.trim() || undefined,
      })
      onClose()
    } catch (err) {
      setError('name', {
        message: err instanceof Error ? err.message : 'Failed to save category.',
      })
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEditing ? 'Edit Category' : 'Create New Category'}>
      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        <div>
          <Input
            label="Category Name *"
            placeholder="e.g. Frozen Foods, Electronics"
            autoComplete="off"
            {...register('name')}
            onChange={handleNameChange}
          />
          {errors.name && <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>}
        </div>

        <div>
          <Input
            label="Slug / URL Key *"
            placeholder="e.g. frozen-foods"
            autoComplete="off"
            {...register('slug')}
          />
          <p className="mt-1 text-[11px] text-slate-400">Used for URL identification and product grouping.</p>
          {errors.slug && <p className="mt-1 text-xs text-rose-600">{errors.slug.message}</p>}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Description
            <textarea
              rows={2}
              placeholder="Brief description of the items in this category"
              {...register('description')}
              className="mt-1.5 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>

        {/* Color Palette Selection */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">Category Color Accent</label>
          <div className="flex flex-wrap gap-2">
            {colorOptions.map((color) => {
              const info = categoryColors[color]
              const isSelected = selectedColor === color
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => setValue('color', color, { shouldDirty: true })}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition ${
                    isSelected ? 'border-slate-800 scale-110 shadow-sm' : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: info.previewHex }}
                  title={color}
                >
                  {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                </button>
              )
            })}
          </div>
        </div>

        {/* Icon Selection */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">Category Icon</label>
          <div className="grid grid-cols-5 gap-2">
            {iconOptions.map((iconName) => {
              const IconComp = categoryIcons[iconName]
              const isSelected = selectedIcon === iconName
              return (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => setValue('icon', iconName, { shouldDirty: true })}
                  className={`flex flex-col items-center justify-center rounded-xl border p-2.5 transition text-xs ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50 text-blue-600 font-semibold'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <IconComp size={18} />
                  <span className="mt-1 text-[10px] truncate max-w-full">{iconName}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Status */}
        <div>
          <label className="block text-xs font-semibold text-slate-700">Status</label>
          <select
            {...register('status')}
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500"
          >
            <option value="active">Active (Visible in catalog & POS)</option>
            <option value="archived">Archived (Hidden from catalog & POS)</option>
          </select>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : isEditing ? 'Update Category' : 'Create Category'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

