/**
 * Service Worker for Northstar POS.
 * Conforms to Step 13.1 & 13.3 offline architecture:
 * - Caches static app shell (HTML, JS, CSS, fonts, manifest) for offline boot.
 * - STRICTLY NETWORK-ONLY for all /api/v1/* calls (Dexie.js handles client-side caching).
 * - STRICTLY NETWORK-ONLY for private documents and R2 file uploads.
 */

const CACHE_NAME = 'northstar-pos-shell-v1'
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => {
        // Continue even if initial pre-cache fails partially in dev
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
      fetch(request).catch(() =>
        caches.match('/index.html').then((cached) => cached || caches.match('/'))
      )
    )
    return
  }

  // 3. Static assets (JS bundles, CSS, fonts, icons): stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            const responseToCache = networkResponse.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache)
            })
          }
          return networkResponse
        })
        .catch(() => cachedResponse)

      return cachedResponse || fetchPromise
    })
  )
})

