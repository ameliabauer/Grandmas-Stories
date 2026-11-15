const CACHE = 'grandmas-stories-redesign-v9';
const SHELL = [
  '/', '/index.html', '/app.css', '/textured-buttons.css', '/ui-polish.css', '/app.js', '/storage.js', '/cloud.js', '/manifest.webmanifest',
  '/walnut-512.webp', '/linen-512.webp', '/leather-512.webp', '/corduroy-512.webp'
];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('grandmas-stories-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && url.pathname.startsWith('/api/')) return;
  const appShell = event.request.mode === 'navigate' || (sameOrigin && ['/', '/index.html', '/app.js', '/app.css', '/textured-buttons.css', '/ui-polish.css', '/manifest.webmanifest', '/storage.js', '/cloud.js'].includes(url.pathname));
  if (appShell) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).then(response => {
      if (response.ok && sameOrigin) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match('/'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && sameOrigin) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  })));
});
