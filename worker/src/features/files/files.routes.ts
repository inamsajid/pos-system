import type { RequestContext } from '../../router'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds } from '../../auth/tenantContext'
import { jsonResponse } from '../../lib/response'
import { HttpError } from '../../lib/errors'
import { FilesService } from './files.service'
import type { FileCategory, FileRelatedType, FileStatus } from './files.types'

const filesService = new FilesService()

/**
 * POST /api/v1/files
 * Multipart file upload with R2 storage and D1 metadata tracking.
 */
export async function handleUploadFile(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('files_upload')(ctx)

  const businessId = ctx.tenant!.business.id
  const userId = ctx.auth!.user.id
  const role = ctx.tenant!.membership.role

  const contentType = ctx.req.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    throw HttpError.badRequest('Expected multipart/form-data payload for file upload')
  }

  const formData = await ctx.req.formData()
  const fileField = formData.get('file')

  if (!fileField || !(fileField instanceof Blob)) {
    throw HttpError.badRequest("Missing required 'file' binary field in form data")
  }

  const rawCategory = (formData.get('category') as string) || ''
  const rawEntityType = (formData.get('entityType') as string) || ''
  const rawRelatedType = (formData.get('relatedType') as string) || rawEntityType || undefined
  const rawRelatedId = (formData.get('relatedId') as string) || (formData.get('entityId') as string) || undefined

  let category = rawCategory
  if (!category && rawEntityType) {
    if (rawEntityType === 'product') category = 'product_image'
    else if (rawEntityType === 'expense') category = 'receipt_attachment'
    else if (rawEntityType === 'invoice') category = 'invoice_pdf'
    else if (rawEntityType === 'purchase') category = 'purchase_document'
    else if (rawEntityType === 'supplier') category = 'supplier_document'
    else category = 'receipt_attachment'
  }

  const relatedType = rawRelatedType
  const relatedId = rawRelatedId
  const requestedBranchId = (formData.get('branchId') as string) || ctx.req.headers.get('X-Branch-Id') || undefined

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    requestedBranchId
  )

  const rawFilename = (fileField as { name?: string }).name || 'unnamed-file'
  const rawMimeType = fileField.type || 'application/octet-stream'

  const arrayBuffer = await fileField.arrayBuffer()
  const fileBuffer = new Uint8Array(arrayBuffer)

  const createdFile = await filesService.uploadFile(
    ctx.env,
    businessId,
    userId,
    role,
    authorizedBranchIds,
    {
      originalFilename: rawFilename,
      contentType: rawMimeType,
      sizeBytes: fileBuffer.byteLength,
      category: category as FileCategory,
      relatedType: relatedType as FileRelatedType,
      relatedId,
      branchId: requestedBranchId,
    },
    fileBuffer
  )

  return jsonResponse(createdFile, 201, ctx.requestId)
}

/**
 * GET /api/v1/files/:id
 * Retrieve file metadata.
 */
export async function handleGetFileMetadata(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('files_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const fileId = ctx.params.id

  if (!fileId) {
    throw HttpError.badRequest('File ID is required')
  }

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const file = await filesService.getFileMetadata(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    fileId
  )
  return jsonResponse(file, 200, ctx.requestId)
}

/**
 * GET /api/v1/files/:id/content
 * Stream or download file binary payload from Cloudflare R2.
 */
export async function handleGetFileContent(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('files_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const fileId = ctx.params.id

  if (!fileId) {
    throw HttpError.badRequest('File ID is required')
  }

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const { file, r2Object } = await filesService.getFileContent(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    fileId
  )

  const isImage = file.contentType.startsWith('image/')
  const dispositionType = isImage ? 'inline' : 'attachment'

  const headers = new Headers()
  headers.set('Content-Type', file.contentType)
  headers.set('Content-Length', file.sizeBytes.toString())
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate')
  headers.set(
    'Content-Disposition',
    `${dispositionType}; filename="${file.sanitizedFilename}"`
  )
  if (ctx.requestId) {
    headers.set('X-Request-Id', ctx.requestId)
  }
  if (r2Object.httpEtag) {
    headers.set('ETag', r2Object.httpEtag)
  }

  return new Response(r2Object.body, {
    status: 200,
    headers,
  })
}

/**
 * DELETE /api/v1/files/:id
 * Safely delete file from R2 and mark deleted in D1 (idempotent).
 */
export async function handleDeleteFile(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('files_delete')(ctx)

  const businessId = ctx.tenant!.business.id
  const userId = ctx.auth!.user.id
  const role = ctx.tenant!.membership.role
  const fileId = ctx.params.id

  if (!fileId) {
    throw HttpError.badRequest('File ID is required')
  }

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const result = await filesService.deleteFile(
    ctx.env,
    businessId,
    userId,
    role,
    authorizedBranchIds,
    fileId
  )
  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/files
 * List files for authorized business/branch context.
 */
export async function handleListFiles(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('files_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const category = ctx.url.searchParams.get('category') as FileCategory | null
  const relatedType = ctx.url.searchParams.get('relatedType') as FileRelatedType | null
  const relatedId = ctx.url.searchParams.get('relatedId') || undefined
  const branchId = ctx.url.searchParams.get('branchId') || undefined
  const status = ctx.url.searchParams.get('status') as FileStatus | null
  const limit = ctx.url.searchParams.get('limit') ? Number(ctx.url.searchParams.get('limit')) : 50
  const offset = ctx.url.searchParams.get('offset') ? Number(ctx.url.searchParams.get('offset')) : 0

  const result = await filesService.listFiles(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    {
      category: category || undefined,
      relatedType: relatedType || undefined,
      relatedId,
      branchId,
      status: status || undefined,
      limit,
      offset,
    }
  )

  return jsonResponse(result.files, 200, ctx.requestId, {
    total: result.total,
    limit,
    offset,
  })
}
