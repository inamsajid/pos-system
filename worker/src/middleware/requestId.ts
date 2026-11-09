/**
 * Resolves or generates a standard request correlation ID.
 */
export function resolveRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id')
  if (incoming && incoming.trim().length > 0) {
    return incoming.trim()
  }
  return crypto.randomUUID()
}

