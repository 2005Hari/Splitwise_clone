// Minimal service worker: just enough to receive and display Web Push
// notifications (see hooks/usePushNotifications.js and
// server/src/services/webPush.js). No caching/offline support — that's a
// separate concern this app doesn't need.

self.addEventListener('push', (event) => {
  let data = { title: 'Splitwise Clone', body: '' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Splitwise Clone', {
      body: data.body || '',
      tag: data.tag,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});
