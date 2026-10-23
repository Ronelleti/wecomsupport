// Service worker: shows push notifications and opens the app when one is tapped.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'סידור עבודה', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      dir: 'rtl',
      lang: 'he',
      tag: data.tag || undefined,
      data: { link: data.link || '' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || ''
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      if (windows.length) {
        windows[0].postMessage({ type: 'go', tab: link })
        return windows[0].focus()
      }
      return self.clients.openWindow(link ? `/?tab=${encodeURIComponent(link)}` : '/')
    }),
  )
})
