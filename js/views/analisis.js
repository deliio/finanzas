// Análisis: peso de las categorías (donuts) y gasto acumulado por categoría,
// sin depender de presupuestos. El mapa de gastos está en Informes.

import { getState, categoryById, categoriesOf, availableMonths, transactionsSorted, todayISO, prevMonthKey, bucketOf } from '../store.js';
import { money, esc, icon, privacyButton, monthSelect, getSelectedMonth, setSelectedMonth, monthShort, openSheet, txRow } from '../ui.js';
import { barChart, spendingDonuts } from '../charts.js';
import { openTxSheet } from './movimientos.js';

const PERIODS = [
  { id: 'mes', label: 'Mes' },
  { id: '3m',  label: '3 meses' },
  { id: 'ano', label: 'Año' },
  { id: 'todo', label: 'Todo' },
];
let period = 'mes';

export function render(root) {
  const draw = () => {
    const months = availableMonths();
    let key = getSelectedMonth();
    if (!months.includes(key)) key = months[0];

    const expenses = inPeriod(period, key).filter((t) => t.type === 'expense');
    const total = expenses.reduce((s, t) => s + t.amount, 0);

    // Por categoría (todas, aunque no tengan presupuesto).
    // Lo que te paga otra persona va a su propio grupo (como una categoría más).
    const byCat = groupSum(expenses, (t) => [bucketOf(t)]);
    const catRows = categoriesOf('expense')
      .map((c) => ({ c, ...(byCat[c.id] || { sum: 0, count: 0 }) }))
      .sort((a, b) => b.sum - a.sum);
    // Categorías que ya no existen (o pagadores) con gastos en el periodo.
    Object.keys(byCat).filter((id) => !catRows.some((r) => r.c.id === id))
      .forEach((id) => catRows.push({ c: categoryById(id), ...byCat[id] }));

    root.innerHTML = `
      <div class="topbar">
        <a class="left" href="#/informes">‹ Informes</a>
        <h2>Análisis</h2>
        <span style="justify-self:end">${privacyButton()}</span>
      </div>

      <div class="segmented four" role="group" aria-label="Periodo">
        ${PERIODS.map((p) => `<button type="button" data-period="${p.id}" aria-pressed="${p.id === period}">${p.label}</button>`).join('')}
      </div>
      ${period === 'mes' ? `<div style="margin:-6px 0 14px">${monthSelect(months, key, 'an-month')}</div>` : ''}

      ${spendingDonuts(expenses)}

      <div class="section-title">Categorías</div>
      <div class="list">
        ${catRows.map((r) => `
          <button class="row" data-catid="${esc(r.c.id)}">
            <span class="icon">${icon(r.c.icon)}</span>
            <span class="main">
              <div class="title">${esc(r.c.name)}</div>
              <div class="subtitle">${r.count} movimiento${r.count === 1 ? '' : 's'} · ${pct(r.sum, total)}</div>
              <div class="mini-bar"><span style="width:${total ? (r.sum / total) * 100 : 0}%;background:${r.c.color || 'var(--text-2)'}"></span></div>
            </span>
            <span class="trail num">${money(r.sum)}</span>
          </button>`).join('')}
      </div>
    `;

    root.querySelector('#an-month')?.addEventListener('change', (e) => { setSelectedMonth(e.target.value); draw(); });
  };

  root.addEventListener('click', (e) => {
    const p = e.target.closest('[data-period]');
    if (p) { period = p.dataset.period; draw(); return; }
    const c = e.target.closest('[data-catid]');
    if (c) openTracker({ kind: 'cat', id: c.dataset.catid }, draw);
  });

  draw();
}

/* ---------- Periodos y agregados -------------------------------------- */

function inPeriod(p, key) {
  const today = todayISO();
  const all = getState().transactions;
  if (p === 'mes') return all.filter((t) => t.date.startsWith(key));
  if (p === '3m') {
    const from = prevMonthKey(prevMonthKey(today.slice(0, 7)));
    return all.filter((t) => t.date.slice(0, 7) >= from);
  }
  if (p === 'ano') return all.filter((t) => t.date.startsWith(today.slice(0, 4)));
  return all;
}

function groupSum(list, keysOf) {
  const out = {};
  for (const t of list) {
    for (const k of keysOf(t)) {
      out[k] ??= { sum: 0, count: 0 };
      out[k].sum += t.amount;
      out[k].count++;
    }
  }
  return out;
}

const pct = (v, total) => (total ? `${Math.round((v / total) * 100)} %` : '0 %');

/** Últimos n meses (incluido el actual) como claves 'YYYY-MM', del más antiguo al más reciente. */
function lastMonths(n) {
  const out = [todayISO().slice(0, 7)];
  while (out.length < n) out.unshift(prevMonthKey(out[0]));
  return out;
}

/* ---------- Gasto acumulado de una categoría (o de lo que te paga alguien) -- */

export function openTracker({ id }, onDone) {
  const list = transactionsSorted(getState().transactions.filter((t) => t.type === 'expense' && bucketOf(t) === id));
  const today = todayISO();
  const sumWhere = (fn) => list.filter(fn).reduce((s, t) => s + t.amount, 0);

  const thisMonth = sumWhere((t) => t.date.startsWith(today.slice(0, 7)));
  const thisYear = sumWhere((t) => t.date.startsWith(today.slice(0, 4)));
  const allTime = sumWhere(() => true);
  const firstMonth = list.at(-1)?.date.slice(0, 7);
  const monthsSpan = firstMonth ? monthsBetween(firstMonth, today.slice(0, 7)) : 1;
  const months6 = lastMonths(6);

  const { el, close } = openSheet(`
    <h3 class="sheet-title">${esc(categoryById(id).name)}</h3>
    <div class="stat-grid">
      <div class="pill-stat"><div class="label">Este mes</div><div class="value num">${money(thisMonth)}</div></div>
      <div class="pill-stat"><div class="label">Este año</div><div class="value num">${money(thisYear)}</div></div>
      <div class="pill-stat"><div class="label">Total histórico</div><div class="value num">${money(allTime)}</div></div>
      <div class="pill-stat"><div class="label">Media mensual</div><div class="value num">${money(allTime / monthsSpan)}</div></div>
    </div>
    <div class="card" style="margin-top:12px">
      ${barChart(months6.map((m, i) => ({ label: monthShort(m), value: sumWhere((t) => t.date.startsWith(m)), highlight: i === 5 })))}
    </div>
    ${categoryById(id).payerId ? payerBreakdown(list, today.slice(0, 7)) : ''}
    <div class="section-title">Últimos movimientos</div>
    ${list.length ? `<div class="list">${list.slice(0, 15).map((t) => txRow(t, categoryById(t.category))).join('')}</div>`
      : '<div class="card empty">Sin gastos todavía</div>'}
    <button class="btn" type="button" data-close style="margin-top:16px">Cerrar</button>
  `);
  el.addEventListener('click', (e) => {
    const row = e.target.closest('[data-tx]');
    if (row) { close(); openTxSheet(row.dataset.tx, onDone); }
  });
}

/** Qué te ha pagado esa persona este mes, por categoría real. */
function payerBreakdown(list, monthKey) {
  const month = list.filter((t) => t.date.startsWith(monthKey));
  const byCat = groupSum(month, (t) => [t.category]);
  const rows = Object.entries(byCat).sort((a, b) => b[1].sum - a[1].sum);
  if (!rows.length) return '';
  return `<div class="section-title">Este mes, por categoría</div>
    <div class="list">${rows.map(([cid, v]) => {
      const c = categoryById(cid);
      return `<div class="row"><span class="icon">${icon(c.icon)}</span>
        <span class="main"><div class="title">${esc(c.name)}</div><div class="subtitle">${v.count} gasto${v.count === 1 ? '' : 's'}</div></span>
        <span class="trail num">${money(v.sum)}</span></div>`;
    }).join('')}</div>`;
}

function monthsBetween(a, b) {
  const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
  return Math.max(1, (yb - ya) * 12 + (mb - ma) + 1);
}
