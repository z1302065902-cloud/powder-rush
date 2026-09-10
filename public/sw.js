// Powder Rush service worker — offline-first PWA cache.
//
// Design notes:
//  - Only same-origin GET requests are handled.
//  - Vite emits hashed bundles (assets/index-<hash>.js), so their names are not
//    known here. Instead of hardcoding them, install() fetches ./index.html,
//    scrapes every ./assets/... URL out of it and precaches those too. Without
//    this the very first page load happens *before* the worker controls the
//    page, so the bundle was never cached — offline play then silently depended
//    on the browser HTTP cache and broke as soon as that was evicted.
//  - Every precache entry is added individually so one missing file cannot abort
//    the whole install.

const CACHE = 'powder-rush-v3';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

/** Pull hashed build assets out of the app shell HTML. */
async function precacheShell(cache) {
  let html;
  try {
    const res = await fetch('./index.html', { cache: 'reload' });
    if (!res.ok) return;
    html = await res.text();
  } catch (err) {
    console.warn('[sw] shell fetch failed', err);
    return;
  }

  const urls = new Set();
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    if (/^(\.\/|\/)?assets\//.test(raw)) urls.add(raw);
  }

  await Promise.all(
    [...urls].map((u) =>
      cache.add(u).catch((err) => console.warn('[sw] asset precache skipped', u, err))
    )
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[sw] precache skipped', url, err);
          })
        )
      );
      await precacheShell(cache);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to the app shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(async () => (await caches.match('./index.html')) || (await caches.match('./')) || Response.error())
    );
    return;
  }

  // Assets: cache-first, populate on miss (only cache genuine 200 responses —
  // never cache the SPA HTML fallback for a missing file).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
