/**
 * Cloudflare Pages Function — API Reverse Proxy
 *
 * Catches all requests to /api/* and forwards them to the upstream
 * Cloudflare Worker API.
 *
 * Supports two upstream connection mechanisms:
 * 1. Primary: context.env.API_WORKER (Cloudflare Service Binding)
 *    - Zero public network overhead, ultra-low-latency edge IPC.
 * 2. Fallback: context.env.WORKER_API_HOST (Public HTTPS fetch)
 *    - Optional fallback if Service Binding is not configured.
 *
 * Preserves:
 * - HTTP methods (GET, POST, PUT, PATCH, DELETE, OPTIONS, etc.)
 * - Pathnames and query strings
 * - Request bodies for POST, PUT, PATCH
 * - Request headers including Origin, Cookie, Authorization, Content-Type
 * - Client IP headers (CF-Connecting-IP)
 * - Upstream response status, statusText, and body
 * - Upstream Set-Cookie headers
 */

interface Env {
  API_WORKER?: Fetcher;
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
  const apiWorker = context.env.API_WORKER;
  const rawHost = context.env.WORKER_API_HOST?.trim() || '';
  const workerHost = rawHost.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

  // 1. Fail closed if neither upstream binding is configured
  if (!apiWorker && !workerHost) {
    return Response.json(
      {
        success: false,
        error: {
          code: 'PROXY_MISCONFIGURED',
          message:
            'The API proxy is not configured. Neither API_WORKER service binding nor WORKER_API_HOST environment variable is available.',
        },
      },
      { status: 502 },
    );
  }

  // 2. Build forwarded headers, preserving original Origin, Cookie, and Auth
  const forwardHeaders = new Headers(context.request.headers);

  // Preserve or populate client IP header
  const clientIp =
    context.request.headers.get('cf-connecting-ip') ||
    context.request.headers.get('x-forwarded-for');
  if (clientIp && !forwardHeaders.has('CF-Connecting-IP')) {
    forwardHeaders.set('CF-Connecting-IP', clientIp);
  }

  // If using HTTP fetch fallback, set the upstream Host header
  if (!apiWorker && workerHost) {
    forwardHeaders.set('Host', workerHost);
  }

  // Only attach body for methods that permit request payloads
  const hasBody =
    context.request.method !== 'GET' &&
    context.request.method !== 'HEAD' &&
    context.request.body !== null;

  try {
    let upstreamResponse: Response;

    // 3. Forward to upstream Worker (Primary: Service Binding; Fallback: HTTP fetch)
    if (apiWorker) {
      upstreamResponse = await apiWorker.fetch(context.request.url, {
        method: context.request.method,
        headers: forwardHeaders,
        body: hasBody ? context.request.body : undefined,
        redirect: 'manual',
      });
    } else {
      const incomingUrl = new URL(context.request.url);
      const upstreamUrl = new URL(
        incomingUrl.pathname + incomingUrl.search,
        `https://${workerHost}`,
      );

      upstreamResponse = await fetch(upstreamUrl.toString(), {
        method: context.request.method,
        headers: forwardHeaders,
        body: hasBody ? context.request.body : undefined,
        redirect: 'manual',
      });
    }

    // 4. Build response, copying safe headers from upstream
    const responseHeaders = new Headers();

    for (const [key, value] of upstreamResponse.headers.entries()) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower)) continue;
      responseHeaders.append(key, value);
    }

    // Preserve multiple Set-Cookie headers accurately if getSetCookie is supported
    const rawHeaders = upstreamResponse.headers as unknown as {
      getSetCookie?: () => string[];
    };
    if (typeof rawHeaders.getSetCookie === 'function') {
      const cookies = rawHeaders.getSetCookie();
      if (cookies && cookies.length > 0) {
        responseHeaders.delete('set-cookie');
        for (const cookie of cookies) {
          responseHeaders.append('set-cookie', cookie);
        }
      }
    }

    // Remove any CORS headers the upstream set — the browser sees
    // this response as same-origin so CORS headers are unnecessary.
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
