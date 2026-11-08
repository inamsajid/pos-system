import type { ComponentType } from 'react'
import {
  BookOpen,
  Boxes,
  Headphones,
  Laptop,
  Package,
  Shirt,
  ShoppingBag,
  Sparkles,
  Tags,
  Utensils,
  type LucideProps,
} from 'lucide-react'
import type { CategoryColor, CategoryIconName } from '../types/category.types'

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export const categoryIcons: Record<CategoryIconName, ComponentType<LucideProps>> = {
  Tags,
  Laptop,
  Headphones,
  ShoppingBag,
  Shirt,
  Utensils,
  BookOpen,
  Boxes,
  Sparkles,
  Package,
}

export const categoryColors: Record<
  CategoryColor,
  {
    bg: string
    text: string
    border: string
    badgeBg: string
    badgeText: string
    previewHex: string
  }
> = {
  blue: {
    bg: 'bg-blue-50',
    text: 'text-blue-600',
    border: 'border-blue-200',
    badgeBg: 'bg-blue-50',
    badgeText: 'text-blue-700',
    previewHex: '#2563eb',
  },
  indigo: {
    bg: 'bg-indigo-50',
    text: 'text-indigo-600',
    border: 'border-indigo-200',
    badgeBg: 'bg-indigo-50',
    badgeText: 'text-indigo-700',
    previewHex: '#4f46e5',
  },
  emerald: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
    border: 'border-emerald-200',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-700',
    previewHex: '#059669',
  },
  amber: {
    bg: 'bg-amber-50',
    text: 'text-amber-600',
    border: 'border-amber-200',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700',
    previewHex: '#d97706',
  },
  rose: {
    bg: 'bg-rose-50',
    text: 'text-rose-600',
    border: 'border-rose-200',
    badgeBg: 'bg-rose-50',
    badgeText: 'text-rose-700',
    previewHex: '#e11d48',
  },
  purple: {
    bg: 'bg-purple-50',
    text: 'text-purple-600',
    border: 'border-purple-200',
    badgeBg: 'bg-purple-50',
    badgeText: 'text-purple-700',
    previewHex: '#9333ea',
  },
  cyan: {
    bg: 'bg-cyan-50',
    text: 'text-cyan-600',
    border: 'border-cyan-200',
    badgeBg: 'bg-cyan-50',
    badgeText: 'text-cyan-700',
    previewHex: '#0891b2',
  },
}

