/**
 * Service Worker registration utility for Northstar POS.
 */

export function registerServiceWorker(): void {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // Avoid registering during Vitest or headless runs
      if (navigator.userAgent.includes('jsdom') || navigator.userAgent.includes('Vitest')) {
        return
      }

      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          // Check for worker updates
          registration.onupdatefound = () => {
            const installingWorker = registration.installing
            if (installingWorker == null) return
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  console.info('[SW] New version available; will activate on next reload.')
                } else {
                  console.info('[SW] App shell cached for offline access.')
                }
              }
            }
          }
        })
        .catch((error) => {
          console.warn('[SW] Registration failed:', error)
        })
    })
  }
}

export function unregisterServiceWorker(): void {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister()
      })
      .catch((error) => {
        console.warn('[SW] Unregistration failed:', error)
      })
  }
}

