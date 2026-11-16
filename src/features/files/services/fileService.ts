import { apiClient, resolveApiUrl } from '../../../lib/api-client'

export interface FileUploadResult {
  id: string
  key: string
  filename: string
  contentType: string
  sizeBytes: number
  url: string
}

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

export const fileService = {
  getFileContentUrl(fileId: string): string {
    return resolveApiUrl(`/files/${fileId}/content`)
  },

  async uploadFile(file: File, entityType = 'product', entityId?: string, category?: string): Promise<FileUploadResult> {
    if (!isExplicitDemo()) {
      const derivedCategory = category || (
        entityType === 'product' ? 'product_image' :
        entityType === 'expense' ? 'receipt_attachment' :
        entityType === 'invoice' ? 'invoice_pdf' :
        entityType === 'purchase' ? 'purchase_document' :
        'receipt_attachment'
      )

      const formData = new FormData()
      formData.append('file', file)
      formData.append('category', derivedCategory)
      formData.append('relatedType', entityType)
      formData.append('entityType', entityType)
      if (entityId) {
        formData.append('relatedId', entityId)
        formData.append('entityId', entityId)
      }

      const result = await apiClient.post<{
        id: string
        key?: string
        objectKey?: string
        originalFilename?: string
        filename?: string
        contentType: string
        sizeBytes: number
      }>('/files', formData)

      return {
        id: result.id,
        key: result.key || result.objectKey || result.id,
        filename: result.filename || result.originalFilename || file.name,
        contentType: result.contentType,
        sizeBytes: result.sizeBytes,
        url: resolveApiUrl(`/files/${result.id}/content`),
      }
    }

    return {
      id: `file-${Date.now()}`,
      key: file.name,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      url: URL.createObjectURL(file),
    }
  },

  async getAuthenticatedBlobUrl(fileId: string): Promise<string> {
    if (isExplicitDemo()) {
      return this.getFileContentUrl(fileId)
    }
    const response = await fetch(resolveApiUrl(`/files/${fileId}/content`), {
      credentials: 'include',
    })
    if (!response.ok) {
      throw new Error(`Failed to load file preview (${response.status})`)
    }
    const blob = await response.blob()
    return URL.createObjectURL(blob)
  },

  async deleteFile(fileId: string): Promise<void> {
    if (!isExplicitDemo()) {
      await apiClient.delete(`/files/${fileId}`)
    }
  },
}

