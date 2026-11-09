import { HttpError } from '../../lib/errors'
import type { FileCategory, FileRelatedType, UploadFileInput } from './files.types'

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/csv',
] as const

export const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'text/csv': ['.csv'],
}

export const ALLOWED_CATEGORIES: FileCategory[] = [
  'product_image',
  'business_logo',
  'invoice_pdf',
  'receipt_attachment',
  'purchase_document',
  'supplier_document',
  'report_export',
]

export const ALLOWED_RELATED_TYPES: FileRelatedType[] = [
  'product',
  'business',
  'branch',
  'sale',
  'invoice',
  'purchase',
  'goods_receipt',
  'supplier',
  'customer',
  'report',
]

/**
 * Sanitizes original filename: strips path traversal, directory separators,
 * null bytes, and non-printable characters.
 */
export function sanitizeFilename(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    return 'unnamed-file'
  }

  // Remove path traversal and directory separators
  let cleaned = raw.replace(/^.*[\\/]/, '')
  cleaned = cleaned.replace(/\.\.+/g, '.')
  // oxlint-disable-next-line no-control-regex
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/[\0\x00-\x1f\x7f]/g, '')
  cleaned = cleaned.replace(/[^a-zA-Z0-9._-]/g, '_')

  // Avoid leading dots which make files hidden
  cleaned = cleaned.replace(/^\.+/, '')

  if (!cleaned || cleaned.length === 0) {
    cleaned = 'file'
  }

  if (cleaned.length > 100) {
    const extIndex = cleaned.lastIndexOf('.')
    if (extIndex > 0) {
      const ext = cleaned.slice(extIndex)
      const base = cleaned.slice(0, 100 - ext.length)
      cleaned = `${base}${ext}`
    } else {
      cleaned = cleaned.slice(0, 100)
    }
  }

  return cleaned
}

/**
 * Validates file signature / magic bytes against declared MIME type.
 */
export function validateMagicBytes(buffer: Uint8Array, mimeType: string): void {
  if (buffer.length < 4) {
    throw HttpError.badRequest('File payload is corrupted or too small')
  }

  // Reject executable binaries outright (e.g. Windows PE 'MZ', ELF)
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    throw HttpError.badRequest('Executable files (.exe/.dll) are strictly forbidden')
  }
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    throw HttpError.badRequest('Executable files (ELF) are strictly forbidden')
  }

  switch (mimeType) {
    case 'image/jpeg': {
      // JPEG starts with 0xFF, 0xD8, 0xFF
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        throw HttpError.badRequest('File content does not match JPEG image signature')
      }
      break
    }
    case 'image/png': {
      // PNG starts with 89 50 4E 47 0D 0A 1A 0A
      const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      if (buffer.length < 8 || !pngSig.every((byte, i) => buffer[i] === byte)) {
        throw HttpError.badRequest('File content does not match PNG image signature')
      }
      break
    }
    case 'image/webp': {
      // WebP starts with 'RIFF' (0..3) and 'WEBP' (8..11)
      if (buffer.length < 12) {
        throw HttpError.badRequest('File content does not match WebP image signature')
      }
      const riff = String.fromCharCode(...buffer.slice(0, 4))
      const webp = String.fromCharCode(...buffer.slice(8, 12))
      if (riff !== 'RIFF' || webp !== 'WEBP') {
        throw HttpError.badRequest('File content does not match WebP image signature')
      }
      break
    }
    case 'application/pdf': {
      // PDF starts with '%PDF-' (0x25, 0x50, 0x44, 0x46)
      const pdfSig = String.fromCharCode(...buffer.slice(0, 4))
      if (pdfSig !== '%PDF') {
        throw HttpError.badRequest('File content does not match PDF document signature')
      }
      break
    }
    case 'text/csv': {
      // CSV must be valid text, reject null bytes or binary control characters
      const sampleLength = Math.min(buffer.length, 2048)
      for (let i = 0; i < sampleLength; i++) {
        const b = buffer[i]
        // Disallow null bytes and non-printable control chars (except Tab=9, LF=10, CR=13)
        if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13)) {
          throw HttpError.badRequest('File content contains binary bytes invalid for CSV text')
        }
      }

      // Check for HTML / Script / SVG injection in CSV
      const textSample = new TextDecoder('utf-8').decode(buffer.slice(0, sampleLength)).toLowerCase()
      if (
        textSample.includes('<!doctype') ||
        textSample.includes('<html') ||
        textSample.includes('<script') ||
        textSample.includes('<svg')
      ) {
        throw HttpError.badRequest('HTML/script tags are forbidden in CSV uploads')
      }
      break
    }
    default:
      throw HttpError.badRequest(`Unsupported MIME type: ${mimeType}`)
  }
}

/**
 * Validates upload metadata and file headers.
 */
export function validateUploadMetadata(input: UploadFileInput, fileBuffer: Uint8Array): {
  sanitizedFilename: string
  validatedContentType: string
} {
  if (!input.category || !ALLOWED_CATEGORIES.includes(input.category)) {
    throw HttpError.badRequest(
      `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(', ')}`
    )
  }

  if (input.relatedType && !ALLOWED_RELATED_TYPES.includes(input.relatedType)) {
    throw HttpError.badRequest(
      `Invalid relatedType. Must be one of: ${ALLOWED_RELATED_TYPES.join(', ')}`
    )
  }

  if (!input.contentType || !ALLOWED_MIME_TYPES.includes(input.contentType as (typeof ALLOWED_MIME_TYPES)[number])) {
    throw HttpError.badRequest(
      `Unsupported content type: ${input.contentType}. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
    )
  }

  const validatedContentType = input.contentType

  // Check file size against category limits
  const isImageCategory = input.category === 'product_image' || input.category === 'business_logo'
  const maxBytes = isImageCategory ? MAX_IMAGE_SIZE_BYTES : MAX_DOCUMENT_SIZE_BYTES

  if (input.sizeBytes <= 0 || fileBuffer.byteLength <= 0) {
    throw HttpError.badRequest('File cannot be empty (0 bytes)')
  }

  if (input.sizeBytes > maxBytes || fileBuffer.byteLength > maxBytes) {
    throw HttpError.badRequest(
      `File size exceeds limit (${Math.round(maxBytes / (1024 * 1024))} MB allowed for ${input.category})`
    )
  }

  // Validate filename and extension
  const sanitizedFilename = sanitizeFilename(input.originalFilename)
  const ext = sanitizedFilename.slice(sanitizedFilename.lastIndexOf('.')).toLowerCase()
  const validExtensions = MIME_TO_EXTENSIONS[validatedContentType] || []

  if (!validExtensions.includes(ext)) {
    throw HttpError.badRequest(
      `File extension '${ext}' does not match content type '${validatedContentType}'`
    )
  }

  // Verify magic bytes
  validateMagicBytes(fileBuffer, validatedContentType)

  return {
    sanitizedFilename,
    validatedContentType,
  }
}
