// Helpers de presentación compartidos por las vistas.

import { icon } from './icons.js';
export { icon };

const moneyFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const moneyFmt0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export const money = (n, { decimals = true } = {}) => (decimals ? moneyFmt : moneyFmt0).format(n || 0);

export function signedMoney(n, type) {
  const s = money(Math.abs(n));
  return type === 'income' ? `+${s}` : `−${s}`;
}

export function esc(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Convierte importes escritos de cualquier forma a número:
 * "15.50", "15,50", "15,50 €", "€1.234,56", "1,234.56" → 15.5 / 1234.56
 * El último separador (coma o punto) se toma como decimal si va seguido de 1-2 dígitos.
 */
export function parseAmount(input) {
  if (input == null) return NaN;
  let s = String(input).trim().replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (lastSep !== -1 && s.length - lastSep - 1 <= 2) {
    const int = s.slice(0, lastSep).replace(/[.,]/g, '');
    s = `${int}.${s.slice(lastSep + 1)}`;
  } else {
    s = s.replace(/[.,]/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Formatea un número para un input de importe en formato español (coma decimal). */
export const amountToInput = (n) => (Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '');

const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
export const monthName = (d) => {
  const s = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function dayLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return dayFmt.format(d);
}
export const shortDate = (iso) => shortFmt.format(new Date(iso + 'T00:00:00'));

const usdFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (n) => `${usdFmt.format(n || 0)} $`;

const pctFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' });
export const signedPct = (n) => `${pctFmt.format(n || 0)} %`;
export const signedEur = (n) => (n >= 0 ? '+' : '−') + money(Math.abs(n));
export const tone = (n) => (n > 0.004 ? 'pos' : n < -0.004 ? 'neg' : 'muted');

/**
 * Hoja inferior modal (bottom sheet). Devuelve { el, close }.
 * Se cierra al tocar el fondo o cualquier elemento con [data-close].
 */
export function openSheet(html) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grabber"></div>${html}</div>`;
  document.body.append(backdrop);
  backdrop.getBoundingClientRect(); // fuerza reflow para que arranque la transición
  backdrop.classList.add('open');
  const close = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 250);
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });
  return { el: backdrop.querySelector('.sheet'), close };
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/** Anillo de progreso SVG para presupuestos (blanco; rojo si se supera). */
export function ring(pct) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(pct, 1));
  const stroke = pct > 1 ? 'var(--red)' : 'var(--text)';
  return `<svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
    <circle class="ring-track" cx="32" cy="32" r="${r}"/>
    <circle class="ring-bar" cx="32" cy="32" r="${r}" stroke="${stroke}"
      stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/>
  </svg>`;
}

/** Nº de personas de un gasto compartido (los antiguos guardaban `true` = 2). */
export const splitCount = (tx) => (tx.split === true ? 2 : Number(tx.split) || 1);

const CURRENCY_SYMBOL = { EUR: '€', GBP: '£', USD: '$' };
export const currencySymbol = (c) => CURRENCY_SYMBOL[c] ?? c;

export function txRow(tx, cat) {
  const extras = [];
  if (tx.papi) extras.push('<span class="papi-tag">Papi</span>');
  if (tx.split) extras.push(`÷${splitCount(tx)}`);
  if (tx.currency) extras.push(`<span class="num">${amountToInput(tx.originalAmount)} ${currencySymbol(tx.currency)}</span>`);
  if (tx.recurringId) extras.push('fijo');
  return `<button class="row" data-tx="${esc(tx.id)}">
    <span class="icon">${icon(cat.icon)}</span>
    <span class="main">
      <div class="title">${esc(tx.description || cat.name)}</div>
      <div class="subtitle">${esc(cat.name)} · ${shortDate(tx.date)}${extras.length ? ' · ' + extras.join(' · ') : ''}</div>
      ${tx.tags?.length ? `<div class="chips">${tx.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : ''}
    </span>
    <span class="trail num ${tx.type === 'income' ? 'pos' : 'neg'}">${signedMoney(tx.amount, tx.type)}</span>
  </button>`;
}

/* ---------- Modo privacidad ------------------------------------------- */

/** Botón del ojo para la cabecera. El clic lo gestiona app.js (delegado global). */
export const privacyButton = () =>
  `<button type="button" class="icon-btn" data-privacy-toggle aria-label="Ocultar cifras">
    ${icon(document.body.classList.contains('privacy') ? 'eyeOff' : 'eye')}
  </button>`;

/* ---------- Mes seleccionado (Time Travel) ----------------------------- */
// Compartido entre Dashboard y Análisis; dura lo que la sesión de la app.

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export function getSelectedMonth() {
  try { return sessionStorage.getItem('finanzas:mes') || thisMonth(); } catch { return thisMonth(); }
}
export function setSelectedMonth(key) {
  try { sessionStorage.setItem('finanzas:mes', key); } catch { /* sin almacenamiento */ }
}
export const isCurrentMonth = (key) => key === thisMonth();

/** Selector de mes con aspecto de título. */
export function monthSelect(months, selected, id = 'month-select') {
  return `<label class="month-select">
    <select id="${id}" aria-label="Mes">
      ${months.map((m) => `<option value="${m}" ${m === selected ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}
    </select>
    <svg class="ico" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
  </label>`;
}

/** Etiqueta de un mes 'YYYY-MM' → "Octubre 2026". */
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return monthName(new Date(y, m - 1, 1)).replace(' de ', ' ');
}

/** Etiqueta corta de un mes 'YYYY-MM' → "oct". */
export const monthShort = (key) =>
  new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(new Date(key + '-01T00:00:00')).replace('.', '');
