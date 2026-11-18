/**
 * Cloudflare Pages Function — API Reverse Proxy
 *
 * Catches all requests to /api/* and forwards them to the upstream
 * Cloudflare Worker API. This keeps the browser on the same origin
 * (pages.dev) so SameSite=Lax session cookies work without
 * cross-site restrictions.
 *
 * Runtime environment variable required:
 *   WORKER_API_HOST — the hostname of the deployed Worker
 *   e.g. "pos-system-worker-staging.<subdomain>.workers.dev"
 *
 * If WORKER_API_HOST is not set or the upstream is unreachable,
 * the function returns an honest 502/503 — it never fabricates
 * API responses.
 */

interface Env {
  WORKER_API_HOST?: string;
}

// Headers that must not be copied from the upstream response
// because Cloudflare / the runtime manages them.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
]);

export const onRequest: PagesFunction<Env> = async (context) => {
  const rawHost = context.env.WORKER_API_HOST?.trim() || '';

  if (!rawHost) {
    return Response.json(
      {
        success: false,
        error: {
          code: 'PROXY_MISCONFIGURED',
          message:
            'The API proxy is not configured. WORKER_API_HOST environment variable is missing.',
        },
      },
      { status: 502 },
    );
  }

  // Normalize host: accept either hostname or full URL, stripping protocol and trailing slashes
  const workerHost = rawHost.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

  // Build the upstream URL preserving path + query string
  const incomingUrl = new URL(context.request.url);
  const upstreamUrl = new URL(incomingUrl.pathname + incomingUrl.search, `https://${workerHost}`);

  // Build forwarded headers, preserving the original Origin for CORS
  const forwardHeaders = new Headers(context.request.headers);

  // Let the Worker know about the real client IP if not already set
  const clientIp =
    context.request.headers.get('cf-connecting-ip') ||
    context.request.headers.get('x-forwarded-for');
  if (clientIp && !forwardHeaders.has('CF-Connecting-IP')) {
    forwardHeaders.set('CF-Connecting-IP', clientIp);
  }

  // Replace the Host header with the upstream host
  forwardHeaders.set('Host', workerHost);

  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: context.request.method,
      headers: forwardHeaders,
      body: context.request.body,
      redirect: 'manual',
    });

    // Build a clean response, copying safe headers from upstream
    const responseHeaders = new Headers();

    for (const [key, value] of upstreamResponse.headers.entries()) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower)) continue;
      responseHeaders.append(key, value);
    }

    // Remove any CORS headers the upstream set — the browser sees
    // this response as same-origin so CORS headers are unnecessary
    // and could cause confusion.  However, keep Set-Cookie intact.
    responseHeaders.delete('Access-Control-Allow-Origin');
    responseHeaders.delete('Access-Control-Allow-Credentials');
    responseHeaders.delete('Access-Control-Allow-Methods');
    responseHeaders.delete('Access-Control-Allow-Headers');
    responseHeaders.delete('Access-Control-Max-Age');

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown upstream error';

    return Response.json(
      {
        success: false,
        error: {
          code: 'UPSTREAM_UNREACHABLE',
          message: `API backend is unreachable: ${message}`,
        },
      },
      { status: 502 },
    );
  }
};

