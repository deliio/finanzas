// Service worker: red primero (siempre la última versión) con copia offline de respaldo.
// Sube CACHE_VERSION cada vez que publiques cambios para forzar la actualización.
const CACHE_VERSION = 'finanzas-v11';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css?v=11',
  './js/app.js',
  './js/store.js',
  './js/ui.js',
  './js/icons.js',
  './js/market.js',
  './js/networth.js',
  './js/charts.js',
  './js/csv.js',
  './js/views/dashboard.js',
  './js/views/movimientos.js',
  './js/views/nuevo-gasto.js',
  './js/views/patrimonio.js',
  './js/views/ajustes.js',
  './js/views/analisis.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' salta la caché HTTP del navegador (GitHub Pages cachea 10 min):
  // así la copia offline nunca mezcla archivos de versiones distintas.
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
  );
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

  // Peticiones a otros orígenes (APIs de cotizaciones y divisas) van siempre a red.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegación: ignoramos la query (?importe=...&comercio=...) para que
  // el enlace del Atajo funcione también sin conexión.
  const isNavigation = req.mode === 'navigate';
  const cacheKey = isNavigation ? './index.html' : req;

  // Red primero: con conexión siempre se usa la versión publicada;
  // sin conexión (o si la red falla) se sirve la copia guardada.
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) cache.put(cacheKey, res.clone());
        return res;
      } catch {
        const cached = await cache.match(cacheKey, { ignoreSearch: isNavigation });
        return cached || Response.error();
      }
    })
  );
});
