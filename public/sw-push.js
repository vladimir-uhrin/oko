// public/sw-push.js — service worker pre Web Push (2026-10-11): upozornenia na sledované lode
// aj so zatvorenou stránkou. Keď je OKO otvorené a viditeľné, upozornenie neukáže — toast robí
// stránka sama. Klik otvorí (alebo zaostrí) OKO s loďou (/?ship=<MMSI>).
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'OKO', body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.some((w) => w.visibilityState === 'visible')) return;
    await self.registration.showNotification(data.title || 'OKO', {
      body: data.body || '',
      tag: data.tag || 'oko',
      renotify: true,
      data: { url: data.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if ('focus' in w) {
        await w.focus();
        if ('navigate' in w) { try { await w.navigate(url); } catch { /* */ } }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
