// Informes: calendario mensual de gasto (mapa de calor en escala de blancos),
// resumen del mes y accesos a Análisis y al Mapa.

import { getState, availableMonths, transactionsSorted, categoryById, todayISO } from '../store.js';
import { money, esc, icon, privacyButton, monthSelect, getSelectedMonth, setSelectedMonth, openSheet, txRow } from '../ui.js';
import { openTxSheet } from './movimientos.js';

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const longDay = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric' });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Importe corto para que quepa en la celda: 45 · 312 · 1,2k */
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')}k` : String(Math.round(n)));

/** Opacidad del blanco según el gasto del día (raíz: los días pequeños también se ven). */
const level = (spent, max) => (spent > 0 && max > 0 ? 0.14 + 0.86 * Math.sqrt(spent / max) : 0);

export function render(root) {
  const draw = () => {
    const months = availableMonths();
    let key = getSelectedMonth();
    if (!months.includes(key)) key = months[0];

    const [y, m] = key.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // lunes = 0
    const today = todayISO();

    const expenses = getState().transactions.filter((t) => t.type === 'expense' && t.date.startsWith(key));
    const byDay = {};
    expenses.forEach((t) => (byDay[t.date] = (byDay[t.date] || 0) + t.amount));
    const max = Math.max(0, ...Object.values(byDay));
    const total = expenses.reduce((s, t) => s + t.amount, 0);

    // Días transcurridos del mes (para la media y los días sin gastar).
    const elapsed = key < today.slice(0, 7) ? daysInMonth : key === today.slice(0, 7) ? Number(today.slice(8, 10)) : 0;
    const dateOf = (d) => `${key}-${String(d).padStart(2, '0')}`;
    const zeroDays = Array.from({ length: elapsed }, (_, i) => dateOf(i + 1)).filter((d) => !byDay[d]).length;
    const top = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];

    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push('<div class="cal-cell blank"></div>');
    for (let d = 1; d <= daysInMonth; d++) {
      const date = dateOf(d);
      const spent = byDay[date] || 0;
      const a = level(spent, max);
      const classes = ['cal-cell', a > 0.55 ? 'dark-text' : '', date === today ? 'today' : '', date > today ? 'future' : ''].join(' ');
      cells.push(`<button type="button" class="${classes}" data-day="${date}" style="background:rgba(255,255,255,${a.toFixed(3)})"
        aria-label="${esc(longDay.format(new Date(date + 'T00:00:00')))}: ${spent ? money(spent) : 'sin gastos'}">
        <span class="cal-num">${d}</span>
        ${spent ? `<span class="cal-amt num">${compact(spent)}</span>` : ''}
      </button>`);
    }

    root.innerHTML = `
      <header class="page-header">
        <div>${monthSelect(months, key)}<h1>Informes</h1></div>
        <div class="header-actions">${privacyButton()}</div>
      </header>

      <section class="card cal-card">
        <div class="cal-grid cal-head">${WEEKDAYS.map((w) => `<div>${w}</div>`).join('')}</div>
        <div class="cal-grid">${cells.join('')}</div>
        <div class="cal-legend"><span>Menos</span>${[0.14, 0.35, 0.55, 0.78, 1].map((o) => `<i style="background:rgba(255,255,255,${o})"></i>`).join('')}<span>Más</span></div>
      </section>

      <div class="stat-grid" style="margin-top:12px">
        <div class="pill-stat"><div class="label">Gastado</div><div class="value num">${money(total)}</div></div>
        <div class="pill-stat"><div class="label">Media diaria</div><div class="value num">${money(elapsed ? total / elapsed : 0)}</div></div>
        <div class="pill-stat"><div class="label">Día más caro</div>
          <div class="value num">${top ? money(top[1], { decimals: false }) : '—'}</div>
          ${top ? `<div class="muted" style="font-size:12px">${esc(shortDay.format(new Date(top[0] + 'T00:00:00')))}</div>` : ''}</div>
        <div class="pill-stat"><div class="label">Días sin gastar</div><div class="value num">${zeroDays}${elapsed ? ` <span class="muted" style="font-size:13px">de ${elapsed}</span>` : ''}</div></div>
      </div>

      <div class="section-title">Más informes</div>
      <div class="list">
        <a class="row" href="#/analisis">
          <span class="icon">${icon('pie')}</span>
          <span class="main"><div class="title">Análisis</div><div class="subtitle">Categorías, etiquetas y estilo de vida</div></span>
          <span class="trail muted">${icon('chevron')}</span>
        </a>
        <a class="row" href="#/mapa">
          <span class="icon">${icon('map')}</span>
          <span class="main"><div class="title">Mapa de gastos</div><div class="subtitle">Dónde gastas más</div></span>
          <span class="trail muted">${icon('chevron')}</span>
        </a>
      </div>
    `;

    root.querySelector('#month-select').addEventListener('change', (e) => { setSelectedMonth(e.target.value); draw(); });
  };

  root.addEventListener('click', (e) => {
    const day = e.target.closest('[data-day]');
    if (day) openDay(day.dataset.day, draw);
  });

  draw();
}

/* ---------- Detalle de un día ------------------------------------------- */

function openDay(date, onDone) {
  const list = transactionsSorted(getState().transactions.filter((t) => t.date === date));
  const spent = list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const { el, close } = openSheet(`
    <h3 class="sheet-title">${esc(cap(longDay.format(new Date(date + 'T00:00:00'))))}</h3>
    <p class="muted num" style="text-align:center;margin:-8px 0 16px">${spent ? `Gastado ${money(spent)}` : 'Sin gastos este día 🎉'}</p>
    ${list.length ? `<div class="list">${list.map((t) => txRow(t, categoryById(t.category))).join('')}</div>` : ''}
    <button class="btn" type="button" data-close style="margin-top:16px">Cerrar</button>
  `);
  el.addEventListener('click', (e) => {
    const row = e.target.closest('[data-tx]');
    if (row) { close(); openTxSheet(row.dataset.tx, onDone); }
  });
}
