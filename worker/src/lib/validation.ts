import { HttpError } from './errors'

/**
 * Safely parses JSON request bodies, throwing a clean HttpError 400 on malformed input.
 */
export async function parseJsonBody<T = unknown>(request: Request): Promise<T> {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw HttpError.badRequest('Expected Content-Type: application/json')
  }

  try {
    return (await request.json()) as T
  } catch {
    throw HttpError.badRequest('Malformed JSON body provided.')
  }
}

