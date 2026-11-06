// Offline support: every file is fetched fresh when online (so updates always arrive) and the last copy is used when offline.
const CACHE = 'pm-shell-v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'data.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) {
        const copy = r.clone();
        const key = url.pathname.endsWith('data.json') ? 'data.json' : e.request;
        caches.open(CACHE).then(c => c.put(key, copy));
      }
      return r;
    }).catch(() => caches.match(url.pathname.endsWith('data.json') ? 'data.json' : e.request, { ignoreSearch: true }))
  );
});
