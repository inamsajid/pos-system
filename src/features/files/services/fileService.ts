import { apiClient } from '../../../lib/api-client'

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
  async uploadFile(file: File, entityType = 'product', entityId?: string): Promise<FileUploadResult> {
    if (!isExplicitDemo()) {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('entityType', entityType)
      if (entityId) formData.append('entityId', entityId)

      const result = await apiClient.post<{
        id: string
        key: string
        filename: string
        contentType: string
        sizeBytes: number
      }>('/files', formData)

      return {
        ...result,
        url: `/api/v1/files/${result.id}/content`,
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

  async deleteFile(fileId: string): Promise<void> {
    if (!isExplicitDemo()) {
      await apiClient.delete(`/files/${fileId}`)
    }
  },
}

