export type FileCategory =
  | 'product_image'
  | 'business_logo'
  | 'invoice_pdf'
  | 'receipt_attachment'
  | 'purchase_document'
  | 'supplier_document'
  | 'report_export'

export type FileRelatedType =
  | 'product'
  | 'business'
  | 'branch'
  | 'sale'
  | 'invoice'
  | 'purchase'
  | 'goods_receipt'
  | 'supplier'
  | 'customer'
  | 'report'

export type FileStatus = 'pending' | 'available' | 'deleted' | 'failed'

export interface FileMetadataDTO {
  id: string
  businessId: string
  branchId: string | null
  objectKey: string
  originalFilename: string
  sanitizedFilename: string
  contentType: string
  sizeBytes: number
  category: FileCategory
  relatedType: FileRelatedType | null
  relatedId: string | null
  uploadedBy: string | null
  status: FileStatus
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  downloadUrl: string
}

export interface UploadFileInput {
  originalFilename: string
  contentType: string
  sizeBytes: number
  category: FileCategory
  relatedType?: FileRelatedType | null
  relatedId?: string | null
  branchId?: string | null
}

export interface FileListFilters {
  category?: FileCategory
  relatedType?: FileRelatedType
  relatedId?: string
  branchId?: string
  status?: FileStatus
  limit?: number
  offset?: number
}

