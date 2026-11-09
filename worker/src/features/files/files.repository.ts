import type { FileListFilters, FileMetadataDTO, FileStatus } from './files.types'

export interface FileDbRecord {
  id: string
  business_id: string
  branch_id: string | null
  object_key: string
  original_filename: string
  sanitized_filename: string
  content_type: string
  size_bytes: number
  category: string
  related_type: string | null
  related_id: string | null
  uploaded_by: string | null
  status: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export class FilesRepository {
  /**
   * Inserts initial file record with status 'pending'.
   */
  async insertFileRecord(
    d1: D1Database,
    data: {
      id: string
      businessId: string
      branchId: string | null
      objectKey: string
      originalFilename: string
      sanitizedFilename: string
      contentType: string
      sizeBytes: number
      category: string
      relatedType: string | null
      relatedId: string | null
      uploadedBy: string | null
      status: FileStatus
    }
  ): Promise<void> {
    await d1
      .prepare(
        `INSERT INTO files (
          id, business_id, branch_id, object_key, original_filename,
          sanitized_filename, content_type, size_bytes, category,
          related_type, related_id, uploaded_by, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .bind(
        data.id,
        data.businessId,
        data.branchId,
        data.objectKey,
        data.originalFilename,
        data.sanitizedFilename,
        data.contentType,
        data.sizeBytes,
        data.category,
        data.relatedType,
        data.relatedId,
        data.uploadedBy,
        data.status
      )
      .run()
  }

  /**
   * Updates file status (e.g. to 'available', 'deleted', or 'failed').
   */
  async updateFileStatus(
    d1: D1Database,
    id: string,
    status: FileStatus,
    deletedAt: string | null = null
  ): Promise<void> {
    await d1
      .prepare(
        `UPDATE files
         SET status = ?,
             deleted_at = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(status, deletedAt, id)
      .run()
  }

  /**
   * Finds file by ID within business context.
   */
  async getFileById(
    d1: D1Database,
    businessId: string,
    fileId: string
  ): Promise<FileMetadataDTO | null> {
    const row = await d1
      .prepare(
        `SELECT * FROM files
         WHERE business_id = ? AND id = ?`
      )
      .bind(businessId, fileId)
      .first<FileDbRecord>()

    if (!row) return null
    return this.mapToDTO(row)
  }

  /**
   * Lists files matching business context and optional filters.
   */
  async listFiles(
    d1: D1Database,
    businessId: string,
    filters: FileListFilters
  ): Promise<{ files: FileMetadataDTO[]; total: number }> {
    const conditions: string[] = ['business_id = ?']
    const params: unknown[] = [businessId]

    if (filters.status) {
      conditions.push('status = ?')
      params.push(filters.status)
    } else {
      // Default to non-deleted files
      conditions.push("status != 'deleted'")
    }

    if (filters.category) {
      conditions.push('category = ?')
      params.push(filters.category)
    }

    if (filters.relatedType) {
      conditions.push('related_type = ?')
      params.push(filters.relatedType)
    }

    if (filters.relatedId) {
      conditions.push('related_id = ?')
      params.push(filters.relatedId)
    }

    if (filters.branchId) {
      conditions.push('branch_id = ?')
      params.push(filters.branchId)
    }

    const whereClause = conditions.join(' AND ')

    const countRow = await d1
      .prepare(`SELECT COUNT(*) as count FROM files WHERE ${whereClause}`)
      .bind(...params)
      .first<{ count: number }>()

    const total = countRow?.count ?? 0

    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100)
    const offset = Math.max(filters.offset ?? 0, 0)

    const rows = await d1
      .prepare(
        `SELECT * FROM files
         WHERE ${whereClause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...params, limit, offset)
      .all<FileDbRecord>()

    const files = (rows.results || []).map((r) => this.mapToDTO(r))

    return { files, total }
  }

  /**
   * Verifies that the related entity belongs to the same business.
   */
  async validateRelatedEntity(
    d1: D1Database,
    businessId: string,
    relatedType: string,
    relatedId: string
  ): Promise<boolean> {
    let query = ''
    switch (relatedType) {
      case 'product':
        query = 'SELECT id FROM products WHERE business_id = ? AND id = ?'
        break
      case 'business':
        query = 'SELECT id FROM businesses WHERE id = ?'
        return (await d1.prepare(query).bind(businessId).first()) !== null
      case 'branch':
        query = 'SELECT id FROM branches WHERE business_id = ? AND id = ?'
        break
      case 'sale':
        query = 'SELECT id FROM sales WHERE business_id = ? AND id = ?'
        break
      case 'invoice':
        query = 'SELECT id FROM invoices WHERE business_id = ? AND id = ?'
        break
      case 'purchase':
        query = 'SELECT id FROM purchases WHERE business_id = ? AND id = ?'
        break
      case 'goods_receipt':
        query = 'SELECT id FROM goods_receipts WHERE business_id = ? AND id = ?'
        break
      case 'supplier':
        query = 'SELECT id FROM suppliers WHERE business_id = ? AND id = ?'
        break
      case 'customer':
        query = 'SELECT id FROM customers WHERE business_id = ? AND id = ?'
        break
      case 'report':
        return true // report exports don't link to a relational row
      default:
        return false
    }

    const row = await d1.prepare(query).bind(businessId, relatedId).first()
    return row !== null
  }

  private mapToDTO(record: FileDbRecord): FileMetadataDTO {
    return {
      id: record.id,
      businessId: record.business_id,
      branchId: record.branch_id,
      objectKey: record.object_key,
      originalFilename: record.original_filename,
      sanitizedFilename: record.sanitized_filename,
      contentType: record.content_type,
      sizeBytes: record.size_bytes,
      category: record.category as FileMetadataDTO['category'],
      relatedType: (record.related_type as FileMetadataDTO['relatedType']) || null,
      relatedId: record.related_id,
      uploadedBy: record.uploaded_by,
      status: record.status as FileMetadataDTO['status'],
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      deletedAt: record.deleted_at,
      downloadUrl: `/api/v1/files/${record.id}/content`,
    }
  }
}

