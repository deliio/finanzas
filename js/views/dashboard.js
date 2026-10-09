// Dashboard: resumen del mes, presupuestos circulares y últimos movimientos.

import { getState, transactionsInMonth, transactionsSorted, categoryById, categoriesOf } from '../store.js';
import { money, monthName, ring, txRow, esc, icon } from '../ui.js';
import { pastePayment } from './nuevo-gasto.js';

export function render(root, { navigate }) {
  const now = new Date();
  const monthTx = transactionsInMonth(now.getFullYear(), now.getMonth());
  const income = sum(monthTx.filter((t) => t.type === 'income'));
  const expense = sum(monthTx.filter((t) => t.type === 'expense'));
  const balance = income - expense;

  const spentByCat = {};
  monthTx.filter((t) => t.type === 'expense')
    .forEach((t) => (spentByCat[t.category] = (spentByCat[t.category] || 0) + t.amount));

  const budgets = categoriesOf('expense').filter((c) => c.budget > 0);
  const latest = transactionsSorted().slice(0, 5);

  root.innerHTML = `
    <header class="page-header">
      <div>
        <div class="eyebrow">${monthName(now)}</div>
        <h1>Resumen</h1>
      </div>
      <button type="button" class="pill-btn" id="paste-pay">${icon('card')} Pegar pago</button>
    </header>

    <section class="card hero">
      <div class="label">Balance del mes</div>
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

    <div class="section-title">Últimos movimientos <a href="#/movimientos">Ver todos</a></div>
    ${latest.length
      ? `<div class="list">${latest.map((t) => txRow(t, categoryById(t.category))).join('')}</div>`
      : `<div class="card empty"><strong>Aún no hay movimientos</strong>Pulsa el botón + para añadir tu primer gasto.</div>`}
  `;

  root.querySelector('#paste-pay').addEventListener('click', () => pastePayment(navigate));
}

const sum = (list) => list.reduce((acc, t) => acc + t.amount, 0);
