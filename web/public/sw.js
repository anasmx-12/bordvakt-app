// Bordvakt service worker: tar emot mobil-larm även när appen är stängd.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : 'Bordvakt' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Bordvakt', {
      body: data.body || '',
      tag: data.tag,
      renotify: true,
      requireInteraction: Boolean(data.urgent),
      vibrate: data.urgent ? [400, 150, 400, 150, 400] : [200, 100, 200],
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/matsal' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/matsal';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
