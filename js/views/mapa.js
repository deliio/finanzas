// Mapa de calor: dónde gastas más (ponderado por importe), con filtro de periodo y
// categoría y la lista de los lugares con más gasto. Leaflet se carga solo al abrir
// esta vista (necesita conexión; el resto de la app sigue funcionando sin ella).

import { getState, categoriesOf, categoryById, todayISO, prevMonthKey } from '../store.js';
import { money, esc, icon, privacyButton } from '../ui.js';
import { openTxSheet } from './movimientos.js';

const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
const LEAFLET_JS = `${CDN}leaflet/1.9.4/leaflet.min.js`;
const LEAFLET_CSS = `${CDN}leaflet/1.9.4/leaflet.min.css`;
const HEAT_JS = `${CDN}leaflet.heat/0.2.0/leaflet-heat.js`;
// OpenStreetMap (gratis, sin clave). Se oscurece con un filtro CSS para ir con el tema.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const PERIODS = [
  { id: 'mes', label: 'Mes' },
  { id: '3m', label: '3 meses' },
  { id: 'ano', label: 'Año' },
  { id: 'todo', label: 'Todo' },
];
let period = '3m';
let category = '';

/* ---------- Carga perezosa de Leaflet ------------------------------------ */

let leafletPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, async: true });
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar el mapa'));
    document.head.append(s);
  });
}
function loadLeaflet() {
  if (window.L?.heatLayer) return Promise.resolve();
  if (!leafletPromise) {
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: LEAFLET_CSS }));
    leafletPromise = loadScript(LEAFLET_JS).then(() => loadScript(HEAT_JS)).catch((err) => {
      leafletPromise = null; // permite reintentar si vuelve la conexión
      throw err;
    });
  }
  return leafletPromise;
}

/* ---------- Datos ---------------------------------------------------------- */

function locatedExpenses() {
  const today = todayISO();
  const from = {
    mes: today.slice(0, 7),
    '3m': prevMonthKey(prevMonthKey(today.slice(0, 7))),
    ano: today.slice(0, 4),
    todo: '',
  }[period];
  return getState().transactions.filter((t) => t.type === 'expense' && t.location
    && (period === 'ano' ? t.date.startsWith(from) : t.date.slice(0, 7) >= from)
    && (!category || t.category === category));
}

/** Distancia aproximada en metros entre dos puntos (suficiente a escala de ciudad). */
function meters(a, b) {
  const kx = 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot((a.lat - b.lat) * 110540, (a.lon - b.lon) * kx);
}

/** Agrupa gastos a menos de ~120 m en "lugares" y los ordena por gasto total. */
function places(list) {
  const groups = [];
  for (const t of list) {
    let g = groups.find((x) => meters({ lat: x.lat / x.count, lon: x.lon / x.count }, t.location) < 120);
    if (!g) groups.push(g = { lat: 0, lon: 0, total: 0, count: 0, names: {}, txs: [] });
    g.lat += t.location.lat; g.lon += t.location.lon; g.total += t.amount; g.count++;
    const name = t.description || categoryById(t.category).name;
    g.names[name] = (g.names[name] || 0) + 1;
    g.txs.push(t);
  }
  return groups.map((g) => ({
    lat: g.lat / g.count, lon: g.lon / g.count, total: g.total, count: g.count, txs: g.txs,
    // El nombre más repetido en ese punto (p. ej. "Mercadona")
    name: Object.entries(g.names).sort((a, b) => b[1] - a[1])[0][0],
  })).sort((a, b) => b.total - a.total);
}

/* ---------- Vista ---------------------------------------------------------- */

export function render(root) {
  let map = null, heat = null, markers = null;

  root.innerHTML = `
    <div class="topbar">
      <a class="left" href="#/analisis">‹ Análisis</a>
      <h2>Mapa de gastos</h2>
      <span style="justify-self:end">${privacyButton()}</span>
    </div>
    <div class="segmented four" role="group" aria-label="Periodo">
      ${PERIODS.map((p) => `<button type="button" data-period="${p.id}">${p.label}</button>`).join('')}
    </div>
    <div class="field-group" style="margin-bottom:12px">
      <div class="field"><label for="map-cat">Categoría</label>
        <select id="map-cat"><option value="">Todas</option>
          ${categoriesOf('expense').map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
        </select></div>
    </div>
    <div id="map-wrap"></div>
    <div id="map-places"></div>
  `;
  root.querySelector('#map-cat').value = category;

  async function draw() {
    root.querySelectorAll('[data-period]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === period)));
    const list = locatedExpenses();
    const wrap = root.querySelector('#map-wrap');
    const placesEl = root.querySelector('#map-places');

    if (!list.length) {
      if (map) { map.remove(); map = null; }
      wrap.innerHTML = `<div class="card empty"><strong>Aún no hay gastos con ubicación</strong>
        Activa <b>Ubicación</b> al apuntar un gasto, o añade la ubicación al Atajo de Apple Pay, y aquí verás dónde gastas más.</div>`;
      placesEl.innerHTML = '';
      return;
    }

    if (!map) wrap.innerHTML = '<div id="map" class="map-box"><div class="map-loading muted">Cargando mapa…</div></div>';
    try {
      await loadLeaflet();
    } catch {
      wrap.innerHTML = '<div class="card empty"><strong>No se pudo cargar el mapa</strong>Necesita conexión a internet. Inténtalo de nuevo cuando tengas cobertura.</div>';
      return;
    }
    if (!root.isConnected) return;
    const L = window.L;

    if (!map) {
      map = L.map(root.querySelector('#map'), { zoomControl: false, attributionControl: true });
      L.tileLayer(TILES, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    }
    heat?.remove();
    markers?.remove();

    // Intensidad según importe (raíz para que un gasto enorme no tape todo lo demás).
    const max = Math.sqrt(Math.max(...list.map((t) => t.amount)));
    heat = L.heatLayer(list.map((t) => [t.location.lat, t.location.lon, Math.sqrt(t.amount) / max]), {
      // maxZoom bajo: intensidad completa ya a escala de ciudad (por defecto se atenúa al alejar).
      radius: 30, blur: 20, maxZoom: 11, max: 1, minOpacity: 0.4,
      gradient: { 0.2: '#0a84ff', 0.45: '#32d74b', 0.7: '#ffd60a', 1: '#ff453a' },
    }).addTo(map);

    // Puntos pulsables encima del calor: abren el detalle del gasto.
    markers = L.layerGroup(list.map((t) => L.circleMarker([t.location.lat, t.location.lon], {
      radius: 5, color: '#fff', weight: 1.5, fillColor: '#000', fillOpacity: 0.6, opacity: 0.8,
    }).on('click', () => openTxSheet(t.id, draw)))).addTo(map);

    map.fitBounds(L.latLngBounds(list.map((t) => [t.location.lat, t.location.lon])).pad(0.25), { maxZoom: 15 });
    setTimeout(() => map?.invalidateSize(), 50);

    const top = places(list).slice(0, 8);
    const total = list.reduce((s, t) => s + t.amount, 0);
    placesEl.innerHTML = `
      <div class="section-title">Dónde más gastas</div>
      <div class="list">${top.map((p, i) => `
        <button class="row" data-place="${i}">
          <span class="icon">${icon('pin')}</span>
          <span class="main"><div class="title">${esc(p.name)}</div>
            <div class="subtitle">${p.count} gasto${p.count === 1 ? '' : 's'} · ${Math.round((p.total / total) * 100)} %</div></span>
          <span class="trail num">${money(p.total)}</span>
        </button>`).join('')}</div>
      <p class="hint" style="margin:8px 4px 0">${list.length} gastos con ubicación · <span class="num">${money(total)}</span>. Toca un lugar para verlo en el mapa.</p>`;
    placesEl.onclick = (e) => {
      const row = e.target.closest('[data-place]');
      if (!row) return;
      const p = top[Number(row.dataset.place)];
      map.flyTo([p.lat, p.lon], 17, { duration: 0.8 });
      root.querySelector('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  }

  root.addEventListener('click', (e) => {
    const p = e.target.closest('[data-period]');
    if (p) { period = p.dataset.period; draw(); }
  });
  root.querySelector('#map-cat').addEventListener('change', (e) => { category = e.target.value; draw(); });

  draw();
  return () => { map?.remove(); map = null; };
}
