const CACHE_NAME = 'my-eng-v4';
// Relative paths — this is a GitHub Pages *project* site served under /my-eng/,
// so absolute '/index.html' would resolve to the domain root and 404.
const ASSETS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', e => {
  // allSettled so a single failed asset can't reject the whole install
  e.waitUntil(caches.open(CACHE_NAME).then(c => Promise.allSettled(ASSETS.map(a => c.add(a)))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase') || e.request.url.includes('anthropic')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
