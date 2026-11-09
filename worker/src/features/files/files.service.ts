import type { Env } from '../../types/environment'
import { HttpError } from '../../lib/errors'
import { hasPermission, type MemberRole } from '../../auth/tenantContext'
import { FilesRepository } from './files.repository'
import type {
  FileCategory,
  FileListFilters,
  FileMetadataDTO,
  UploadFileInput,
} from './files.types'
import { validateUploadMetadata } from './files.validation'

export class FilesService {
  private readonly repository: FilesRepository

  constructor(repository = new FilesRepository()) {
    this.repository = repository
  }

  /**
   * Validates authorization for uploading files into specific categories.
   */
  private assertUploadPermission(role: MemberRole, category: FileCategory): void {
    switch (category) {
      case 'business_logo':
        if (role !== 'owner' && role !== 'admin') {
          throw HttpError.forbidden('Only owner or admin can upload store branding assets')
        }
        break
      case 'product_image':
        if (!hasPermission(role, 'catalog_write')) {
          throw HttpError.forbidden('Permission catalog_write required to upload product images')
        }
        break
      case 'invoice_pdf':
      case 'receipt_attachment':
        if (!hasPermission(role, 'pos_sale') && !hasPermission(role, 'collect_payments')) {
          throw HttpError.forbidden('Permission pos_sale or collect_payments required')
        }
        break
      case 'purchase_document':
        if (!hasPermission(role, 'purchase_order') && !hasPermission(role, 'receive_goods')) {
          throw HttpError.forbidden('Permission purchase_order or receive_goods required')
        }
        break
      case 'supplier_document':
        if (!hasPermission(role, 'purchase_order') && !hasPermission(role, 'disburse_payments')) {
          throw HttpError.forbidden('Permission purchase_order or disburse_payments required')
        }
        break
      case 'report_export':
        if (!hasPermission(role, 'reports_view') && !hasPermission(role, 'export_backup')) {
          throw HttpError.forbidden('Permission reports_view or export_backup required')
        }
        break
    }
  }

  /**
   * Validates authorization for downloading or streaming files from specific categories.
   */
  private assertReadPermission(
    role: MemberRole,
    authorizedBranchIds: string[],
    file: FileMetadataDTO
  ): void {
    const category = file.category
    switch (category) {
      case 'report_export':
        if (!hasPermission(role, 'reports_view') && !hasPermission(role, 'export_backup')) {
          throw HttpError.forbidden('Permission reports_view required to access report exports')
        }
        break
      case 'supplier_document':
      case 'purchase_document':
        if (
          !hasPermission(role, 'purchase_order') &&
          !hasPermission(role, 'receive_goods') &&
          !hasPermission(role, 'disburse_payments') &&
          !hasPermission(role, 'reports_view')
        ) {
          throw HttpError.forbidden('Insufficient permissions to view procurement documents')
        }
        break
      default:
        // Product images, logos, receipts are accessible to authenticated staff
        break
    }

    // Branch scoping
    if (file.branchId && !authorizedBranchIds.includes(file.branchId)) {
      throw HttpError.forbidden('Access denied: file belongs to an unauthorized branch')
    }
  }

  /**
   * Uploads file payload to Cloudflare R2 and persists D1 metadata.
   */
  async uploadFile(
    env: Env,
    businessId: string,
    userId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    input: UploadFileInput,
    fileBuffer: Uint8Array
  ): Promise<FileMetadataDTO> {
    this.assertUploadPermission(role, input.category)

    const branchId = input.branchId || null
    if (branchId && !authorizedBranchIds.includes(branchId)) {
      throw HttpError.forbidden('Cannot upload file for unauthorized branch')
    }

    // Validate metadata, magic bytes, and extension
    const { sanitizedFilename, validatedContentType } = validateUploadMetadata(
      input,
      fileBuffer
    )

    // Validate related entity if specified
    if (input.relatedType && input.relatedId) {
      const exists = await this.repository.validateRelatedEntity(
        env.DB,
        businessId,
        input.relatedType,
        input.relatedId
      )
      if (!exists) {
        throw HttpError.badRequest(
          `Related entity ${input.relatedType} with ID '${input.relatedId}' does not exist in business`
        )
      }
    }

    const fileId = `file_${crypto.randomUUID().replace(/-/g, '')}`
    const objectKey = branchId
      ? `businesses/${businessId}/branches/${branchId}/${input.category}/${fileId}-${sanitizedFilename}`
      : `businesses/${businessId}/${input.category}/${fileId}-${sanitizedFilename}`

    // Stage 1: Insert pending record in D1
    await this.repository.insertFileRecord(env.DB, {
      id: fileId,
      businessId,
      branchId,
      objectKey,
      originalFilename: input.originalFilename,
      sanitizedFilename,
      contentType: validatedContentType,
      sizeBytes: fileBuffer.byteLength,
      category: input.category,
      relatedType: input.relatedType || null,
      relatedId: input.relatedId || null,
      uploadedBy: userId,
      status: 'pending',
    })

    // Stage 2: Upload to Cloudflare R2
    try {
      if (!env.FILES) {
        throw new Error('R2 FILES binding is not available in environment')
      }

      await env.FILES.put(objectKey, fileBuffer, {
        httpMetadata: {
          contentType: validatedContentType,
        },
        customMetadata: {
          businessId,
          fileId,
          category: input.category,
        },
      })

      // Stage 3: Mark available in D1
      await this.repository.updateFileStatus(env.DB, fileId, 'available')
    } catch (error) {
      // Mark as failed in D1 for cleanup reconciliation
      await this.repository.updateFileStatus(env.DB, fileId, 'failed')
      throw error
    }

    const created = await this.repository.getFileById(env.DB, businessId, fileId)
    if (!created) {
      throw HttpError.notFound('Failed to retrieve newly created file metadata')
    }
    return created
  }

  /**
   * Retrieves file metadata for authorized user.
   */
  async getFileMetadata(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    fileId: string
  ): Promise<FileMetadataDTO> {
    const file = await this.repository.getFileById(env.DB, businessId, fileId)
    if (!file || file.status === 'deleted') {
      throw HttpError.notFound(`File with ID '${fileId}' not found`)
    }

    this.assertReadPermission(role, authorizedBranchIds, file)
    return file
  }

  /**
   * Streams file content from R2 for authorized user.
   */
  async getFileContent(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    fileId: string
  ): Promise<{
    file: FileMetadataDTO
    r2Object: R2ObjectBody
  }> {
    const file = await this.getFileMetadata(
      env,
      businessId,
      role,
      authorizedBranchIds,
      fileId
    )
    if (file.status !== 'available') {
      throw HttpError.badRequest(`File is not available (status: ${file.status})`)
    }

    if (!env.FILES) {
      throw new Error('R2 FILES binding is not available in environment')
    }

    const r2Object = await env.FILES.get(file.objectKey)
    if (!r2Object) {
      throw HttpError.notFound('File payload not found in storage bucket')
    }

    return { file, r2Object }
  }

  /**
   * Safely deletes file from R2 and marks metadata deleted in D1 (idempotent).
   */
  async deleteFile(
    env: Env,
    businessId: string,
    userId: string,
    role: MemberRole,
    fileId: string
  ): Promise<{ success: boolean; message: string }> {
    const file = await this.repository.getFileById(env.DB, businessId, fileId)
    if (!file || file.status === 'deleted') {
      // Idempotent: already deleted
      return { success: true, message: 'File is already deleted or not found' }
    }

    // Authorization: owner/admin or uploader
    const isOwnerOrAdmin = role === 'owner' || role === 'admin'
    const isUploader = file.uploadedBy === userId

    if (!isOwnerOrAdmin && !isUploader) {
      throw HttpError.forbidden('Permission denied: cannot delete files uploaded by other users')
    }

    // Stage 1: Delete from R2
    if (env.FILES) {
      await env.FILES.delete(file.objectKey)
    }

    // Stage 2: Mark D1 metadata as deleted
    await this.repository.updateFileStatus(
      env.DB,
      fileId,
      'deleted',
      new Date().toISOString()
    )

    return { success: true, message: 'File successfully deleted' }
  }

  /**
   * Lists files for authorized tenant.
   */
  async listFiles(
    env: Env,
    businessId: string,
    authorizedBranchIds: string[],
    filters: FileListFilters
  ): Promise<{ files: FileMetadataDTO[]; total: number }> {
    const effectiveFilters: FileListFilters = { ...filters }
    if (effectiveFilters.branchId && !authorizedBranchIds.includes(effectiveFilters.branchId)) {
      throw HttpError.forbidden('Cannot list files for unauthorized branch')
    }

    return this.repository.listFiles(env.DB, businessId, effectiveFilters)
  }
}
