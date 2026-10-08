// Dashboard: resumen del mes elegido (Time Travel), presupuestos, gasto por
// categoría y últimos movimientos.

import { transactionsInMonthKey, transactionsSorted, categoryById, categoriesOf, availableMonths } from '../store.js';
import { money, ring, txRow, esc, icon, privacyButton, monthSelect, getSelectedMonth, setSelectedMonth, isCurrentMonth, monthLabel } from '../ui.js';
import { donut, PALETTE } from '../charts.js';
import { pastePayment } from './nuevo-gasto.js';
import { openTxSheet } from './movimientos.js';

export function render(root, { navigate }) {
  const draw = () => {
    const months = availableMonths();
    let key = getSelectedMonth();
    if (!months.includes(key)) key = months[0];

    const monthTx = transactionsInMonthKey(key);
    const income = sum(monthTx.filter((t) => t.type === 'income'));
    const expense = sum(monthTx.filter((t) => t.type === 'expense'));
    const balance = income - expense;

    const spentByCat = {};
    monthTx.filter((t) => t.type === 'expense')
      .forEach((t) => (spentByCat[t.category] = (spentByCat[t.category] || 0) + t.amount));

    const budgets = categoriesOf('expense').filter((c) => c.budget > 0);
    const latest = transactionsSorted(monthTx).slice(0, 5);

    // Top categorías del mes para el donut (resto agrupado en "Otras").
    const ranked = Object.entries(spentByCat).sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, 5).map(([id, value], i) => ({ label: categoryById(id).name, value, color: PALETTE[i] }));
    const rest = ranked.slice(5).reduce((s, [, v]) => s + v, 0);
    if (rest) top.push({ label: 'Otras', value: rest, color: PALETTE[8] });

    root.innerHTML = `
      <header class="page-header">
        <div>
          ${monthSelect(months, key)}
          <h1>Resumen</h1>
        </div>
        <div class="header-actions">
          ${privacyButton()}
          <button type="button" class="pill-btn" id="paste-pay">${icon('card')} Pegar pago</button>
        </div>
      </header>

      <section class="card hero">
        <div class="label">Balance ${isCurrentMonth(key) ? 'del mes' : `de ${esc(monthLabel(key).toLowerCase())}`}</div>
        <div class="amount num">${money(balance)}</div>
        <div class="split">
          <div class="pill-stat">
            <div class="label"><span class="dot" style="background:var(--green)"></span>Ingresos</div>
            <div class="value num pos">+${money(income)}</div>
          </div>
          <div class="pill-stat">
            <div class="label"><span class="dot" style="background:var(--red)"></span>Gastos</div>
            <div class="value num neg">−${money(expense)}</div>
          </div>
        </div>
      </section>

      <div class="section-title">Presupuestos</div>
      ${budgets.length ? `<div class="rings">${budgets.map((c) => {
        const spent = spentByCat[c.id] || 0;
        const pct = spent / c.budget;
        return `<div class="ring-card">
          <div class="ring-wrap">${ring(pct)}<span class="ring-icon">${icon(c.icon)}</span></div>
          <div class="name">${esc(c.name)}</div>
          <div class="sub num ${pct > 1 ? 'neg' : ''}">${money(spent, { decimals: false })} / ${money(c.budget, { decimals: false })}</div>
        </div>`;
      }).join('')}</div>` : `<div class="card empty">Sin presupuestos definidos</div>`}

      <div class="section-title">Gasto por categoría <a href="#/analisis">Análisis</a></div>
      ${top.length ? `<a class="card donut-card" href="#/analisis">
        ${donut(top, { size: 132, thickness: 16, centerLabel: 'Gastado' })}
        <div class="donut-legend">${top.map((s) => `
          <div class="legend-row"><i class="dot" style="background:${s.color}"></i>
            <span class="legend-name">${esc(s.label)}</span><span class="num">${money(s.value, { decimals: false })}</span></div>`).join('')}
        </div>
      </a>` : `<div class="card empty">Sin gastos este mes</div>`}

      <div class="section-title">Movimientos del mes <a href="#/movimientos">Ver todos</a></div>
      ${latest.length
        ? `<div class="list">${latest.map((t) => txRow(t, categoryById(t.category))).join('')}</div>`
        : `<div class="card empty"><strong>Sin movimientos</strong>${isCurrentMonth(key) ? 'Pulsa el botón + para añadir tu primer gasto.' : 'No hay nada apuntado en este mes.'}</div>`}
    `;

    root.querySelector('#paste-pay').addEventListener('click', () => pastePayment(navigate));
    root.querySelector('#month-select').addEventListener('change', (e) => {
      setSelectedMonth(e.target.value);
      draw();
    });
  };

  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-tx]');
    if (row) openTxSheet(row.dataset.tx, draw);
  });

  draw();
}

const sum = (list) => list.reduce((acc, t) => acc + t.amount, 0);
