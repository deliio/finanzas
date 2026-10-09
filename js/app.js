// Punto de entrada: router por hash, TabBar y registro del service worker.

import * as dashboard from './views/dashboard.js';
import * as movimientos from './views/movimientos.js';
import * as nuevo from './views/nuevo-gasto.js';
import * as patrimonio from './views/patrimonio.js';
import * as ajustes from './views/ajustes.js';
import { readPrefillFromURL } from './views/nuevo-gasto.js';

const routes = { inicio: dashboard, movimientos, nuevo, patrimonio, ajustes };
const viewEl = document.getElementById('view');
let cleanup = null;

// --- Hook de Apple Pay -------------------------------------------------
// Leemos los parámetros UNA vez al arrancar, y limpiamos la URL para que un
// recargo (o volver a abrir la app) no vuelva a rellenar el formulario.
let pendingPrefill = readPrefillFromURL();
if (pendingPrefill) {
  history.replaceState(null, '', location.pathname + '#/nuevo');
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

  document.querySelectorAll('.tabbar [data-route]').forEach((a) =>
    a.classList.toggle('active', a.dataset.route === name));
}

window.addEventListener('hashchange', render);
render();

// --- PWA ---------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) =>
      console.warn('Service worker no registrado:', err));
  });
}

// Pide al navegador que no borre el almacenamiento local bajo presión.
navigator.storage?.persist?.().catch(() => {});
