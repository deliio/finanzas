// Idioma y moneda principal.
// - Moneda: todos los importes guardados están en la moneda principal (BASE); los gastos en
//   otras divisas se convierten a ella. Cambiarla no convierte lo que ya tienes.
// - Idioma: la app está escrita en español; en inglés se traduce lo que se pinta en pantalla
//   (textos, placeholders, avisos) con el diccionario de i18n-en.js.
// Se leen al arrancar: cambiar idioma o moneda recarga la app.

import { EN, EN_PATTERNS } from './i18n-en.js';

const settings = (() => {
  try { return JSON.parse(localStorage.getItem('finanzas:v1'))?.settings || {}; } catch { return {}; }
})();

export const LANGUAGES = [['es', 'Español'], ['en', 'English']];
export const CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF', 'CAD', 'AUD', 'MXN', 'BRL', 'JPY'];

export const LANG = settings.language === 'en' ? 'en' : 'es';
export const LOCALE = LANG === 'en' ? 'en-GB' : 'es-ES';
export const BASE = CURRENCIES.includes(settings.currency) ? settings.currency : 'EUR';

/** Nombre de una divisa en el idioma de la app ("libra esterlina"). */
export const currencyName = (c) => {
  try { return new Intl.DisplayNames([LOCALE], { type: 'currency' }).of(c); } catch { return c; }
};

/* ---------- Traducción ---------------------------------------------------- */

const missing = new Set();
if (LANG === 'en') window.__i18nMissing = missing; // para encontrar textos sin traducir

// Textos que ya están en inglés (al volver a pintarse no hay que buscarlos).
const DONE = new Set(Object.values(EN));

function lookup(core) {
  if (Object.prototype.hasOwnProperty.call(EN, core)) return EN[core];
  if (DONE.has(core)) return core;
  for (const [re, to] of EN_PATTERNS) {
    if (re.test(core)) return core.replace(re, to);
  }
  // "Hoy · 14:32 · Buzón": cada trozo por separado.
  if (core.includes(' · ')) {
    const parts = core.split(' · ');
    const done = parts.map((p) => lookup(p.trim()) ?? p);
    if (done.some((d, i) => d !== parts[i])) return done.join(' · ');
  }
  // Trozos con "·" pegado: "· Importe", "÷2 ·".
  const dot = core.match(/^(· )?([\s\S]*?)( ·)?$/);
  if ((dot[1] || dot[3]) && dot[2]) {
    const inner = lookup(dot[2]);
    if (inner != null) return (dot[1] || '') + inner + (dot[3] || '');
  }
  // Con puntuación al final: "Fecha:" → "Date:".
  const p = core.match(/^([\s\S]*?)([.:,;!?…)]+)$/);
  if (p && p[1] && Object.prototype.hasOwnProperty.call(EN, p[1])) return EN[p[1]] + p[2];
  missing.add(core);
  return null;
}

/** Traduce un texto conservando los espacios de alrededor. */
export function tr(text) {
  if (LANG !== 'en' || text == null) return text;
  const s = String(text);
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m[2] || !/[A-Za-zÁÉÍÓÚáéíóúñÑ¿¡]/.test(m[2])) return s;
  const out = lookup(m[2].replace(/\s+/g, ' '));
  return out == null ? s : m[1] + out + m[3];
}

const SKIP = 'script, style, code, textarea, .mono, .mk-code, [data-no-i18n]';
const ATTRS = ['placeholder', 'aria-label', 'title'];

function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    if (!root.parentElement?.closest(SKIP)) {
      const t = tr(root.nodeValue);
      if (t !== root.nodeValue) root.nodeValue = t;
    }
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || root.closest(SKIP)) return;
  const els = [root, ...root.querySelectorAll('*')];
  for (const el of els) {
    if (el.closest(SKIP)) continue;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); }
    }
    if (el.tagName === 'OPTGROUP' && el.label) el.label = tr(el.label);
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = tr(n.nodeValue);
        if (t !== n.nodeValue) n.nodeValue = t;
      }
    }
  }
}

/** Activa la traducción de todo lo que se pinte (solo en inglés). */
export function startI18n() {
  document.documentElement.lang = LANG;
  if (LANG !== 'en') return;
  translateTree(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') continue;
      r.addedNodes.forEach(translateTree);
    }
  }).observe(document.body, { childList: true, subtree: true });
  // Avisos del navegador.
  const { alert, confirm, prompt } = window;
  window.alert = (msg) => alert.call(window, tr(msg));
  window.confirm = (msg) => confirm.call(window, tr(msg));
  window.prompt = (msg, def) => prompt.call(window, tr(msg), def);
}
