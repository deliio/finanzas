// Service worker: app shell offline + stale-while-revalidate.
// Sube CACHE_VERSION cada vez que publiques cambios para forzar la actualización.
const CACHE_VERSION = 'finanzas-v6';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/store.js',
  './js/ui.js',
  './js/icons.js',
  './js/market.js',
  './js/csv.js',
  './js/views/dashboard.js',
  './js/views/movimientos.js',
  './js/views/nuevo-gasto.js',
  './js/views/patrimonio.js',
  './js/views/ajustes.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Peticiones a otros orígenes (APIs de cotizaciones) van siempre a red.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegación: ignoramos la query (?importe=...&comercio=...) para que
  // el enlace del Atajo funcione también sin conexión.
  const isNavigation = req.mode === 'navigate';
  const cacheKey = isNavigation ? './index.html' : req;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(cacheKey, { ignoreSearch: isNavigation });
      const network = fetch(req)
        .then((res) => {
          if (res.ok && !isNavigation) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
