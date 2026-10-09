// Punto de entrada: router por hash, TabBar, modo privacidad, recurrentes y service worker.

import * as dashboard from './views/dashboard.js';
import * as movimientos from './views/movimientos.js';
import * as nuevo from './views/nuevo-gasto.js';
import * as patrimonio from './views/patrimonio.js';
import * as ajustes from './views/ajustes.js';
import * as analisis from './views/analisis.js';
import { readPrefillFromURL } from './views/nuevo-gasto.js';
import { getState, setSetting, runRecurring } from './store.js';
import { snapshotNetWorth } from './networth.js';
import { toast, icon } from './ui.js';

const routes = { inicio: dashboard, movimientos, nuevo, patrimonio, ajustes, analisis };
// Vistas sin pestaña propia: resaltan la pestaña de la que cuelgan.
const TAB_OF = { analisis: 'inicio' };
const viewEl = document.getElementById('view');
let cleanup = null;

// --- Modo privacidad (#1) ---------------------------------------------
document.body.classList.toggle('privacy', Boolean(getState().settings.privacy));
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-privacy-toggle]');
  if (!btn) return;
  const on = !document.body.classList.contains('privacy');
  document.body.classList.toggle('privacy', on);
  setSetting('privacy', on);
  document.querySelectorAll('[data-privacy-toggle]').forEach((b) => (b.innerHTML = icon(on ? 'eyeOff' : 'eye')));
});

// --- Hooks de Atajos (#4 gastos, #5 ingresos) --------------------------
// Leemos los parámetros UNA vez al arrancar, y limpiamos la URL para que un
// recargo (o volver a abrir la app) no vuelva a rellenar el formulario.
let pendingPrefill = readPrefillFromURL();
if (pendingPrefill) {
  history.replaceState(null, '', location.pathname + '#/nuevo');
}

// --- Gastos recurrentes (#8) -------------------------------------------
function applyRecurring() {
  const added = runRecurring();
  if (added) toast(added === 1 ? '1 pago recurrente añadido' : `${added} pagos recurrentes añadidos`);
  return added;
}

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes[name] ? name : 'inicio';
}

export function navigate(name, prefill = null) {
  if (prefill) pendingPrefill = prefill;
  if (currentRoute() === name) render();
  else location.hash = `#/${name}`;
}

function render() {
  const name = currentRoute();
  cleanup?.();
  cleanup = null;

  const prefill = name === 'nuevo' ? pendingPrefill : null;
  pendingPrefill = null;

  // Cada vista recibe un contenedor nuevo para no arrastrar listeners.
  const root = document.createElement('div');
  viewEl.replaceChildren(root);
  window.scrollTo(0, 0);
  cleanup = routes[name].render(root, { prefill, navigate }) ?? null;

  const tab = TAB_OF[name] ?? name;
  document.querySelectorAll('.tabbar [data-route]').forEach((a) =>
    a.classList.toggle('active', a.dataset.route === tab));
}

applyRecurring();
snapshotNetWorth();
window.addEventListener('hashchange', render);
render();

// Al volver a la app (iOS la mantiene en memoria), generamos lo que toque y refrescamos.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  snapshotNetWorth();
  if (applyRecurring() && currentRoute() !== 'nuevo') render();
});

// --- PWA ---------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) =>
      console.warn('Service worker no registrado:', err));
  });
}

// Pide al navegador que no borre el almacenamiento local bajo presión.
navigator.storage?.persist?.().catch(() => {});
