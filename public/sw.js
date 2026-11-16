/**
 * Service Worker for Northstar POS.
 * Conforms to Step 13.1 & 13.3 offline architecture:
 * - Caches static app shell (HTML, JS, CSS, fonts, manifest) for offline boot.
 * - Dynamically precaches hashed Vite asset bundles via /asset-manifest.json.
 * - STRICTLY NETWORK-ONLY for all /api/v1/* calls (Dexie.js handles client-side caching).
 * - STRICTLY NETWORK-ONLY for private documents and R2 file uploads.
 * - Guarantees non-undefined fallback responses on cache/network miss.
 */

const CACHE_NAME = 'northstar-pos-shell-v1'
const STATIC_APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        // 1. Pre-cache static root assets
        await cache.addAll(STATIC_APP_SHELL)

        // 2. Pre-cache hashed bundles from Vite build manifest
        try {
          const manifestRes = await fetch('/asset-manifest.json')
          if (manifestRes.ok) {
            const assets = await manifestRes.json()
            if (Array.isArray(assets) && assets.length > 0) {
              await cache.addAll(assets)
            }
          }
        } catch {
          // Dev or offline install without manifest
        }
      })
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[SW] App shell pre-cache issue:', err)
        return self.skipWaiting()
      })
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key)
            }
          })
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only intercept GET requests
  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)

  // 1. STRICTLY NETWORK-ONLY: API endpoints and secure files
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/api/v1/') ||
    url.pathname.includes('/files/') ||
    url.pathname.includes('/auth/')
  ) {
    return
  }

  // 2. SPA Navigation requests: network-first with cached index.html fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = (await caches.match('/index.html')) || (await caches.match('/'))
        if (cached) return cached
        return new Response(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline - Northstar POS</title></head><body style="font-family:sans-serif;padding:2rem;text-align:center;"><h2>Offline</h2><p>Please connect to the network to initialize the application.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      })
    )
    return
  }

  // 3. Static assets (JS bundles, CSS, fonts, icons): cache-first for hashed assets, stale-while-revalidate for others
  event.respondWith(
    caches.match(request).then(async (cachedResponse) => {
      // Hashed assets in /assets/ never change across builds; serve cached immediately if present
      if (cachedResponse && url.pathname.includes('/assets/')) {
        return cachedResponse
      }

      try {
        const networkResponse = await fetch(request)
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (networkResponse.type === 'basic' || networkResponse.type === 'cors')
        ) {
          const responseToCache = networkResponse.clone()
          const cache = await caches.open(CACHE_NAME)
          await cache.put(request, responseToCache)
        }
        return networkResponse
      } catch (err) {
        if (cachedResponse) {
          return cachedResponse
        }
        // Fallback response guarantees event.respondWith is never passed undefined
        if (request.destination === 'image') {
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100%" height="100%" fill="#f1f5f9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-size="12">Offline</text></svg>',
            { status: 200, headers: { 'Content-Type': 'image/svg+xml' } }
          )
        }
        return new Response('Asset not available offline', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' },
        })
      }
    })
  )
})

