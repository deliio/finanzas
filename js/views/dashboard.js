// Dashboard: resumen del mes elegido (Time Travel), presupuestos, gasto por
// categoría y últimos movimientos.

import { transactionsInMonthKey, transactionsSorted, categoryById, categoriesOf, availableMonths, bucketOf,
  payerById, payerBucketId, openDebts, debtRemaining, getState, pendingReview } from '../store.js';
import { money, ring, txRow, esc, icon, privacyButton, monthSelect, getSelectedMonth, setSelectedMonth, isCurrentMonth, monthLabel } from '../ui.js';
import { spendingDonuts } from '../charts.js';
import { pastePayment } from './nuevo-gasto.js';
import { openTxSheet } from './movimientos.js';
import { openTracker } from './analisis.js';
import { openBudgetSheet } from './ajustes.js';

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
      .forEach((t) => (spentByCat[bucketOf(t)] = (spentByCat[bucketOf(t)] || 0) + t.amount));
    // Lo que te han pagado otras personas este mes, agrupado por persona.
    const byPayer = {};
    monthTx.filter((t) => t.type === 'expense' && t.paidBy).forEach((t) => (byPayer[t.paidBy] ??= []).push(t));
    const payerRows = Object.entries(byPayer).map(([id, list]) => ({ id, name: payerById(id).name, list, total: sum(list) }));
    const debts = openDebts();
    const owed = debts.reduce((s, d) => s + debtRemaining(d), 0);
    const owers = new Set(debts.map((d) => d.person));

    const budgets = categoriesOf('expense').filter((c) => c.budget > 0);
    const latest = transactionsSorted(monthTx).slice(0, 5);


    root.innerHTML = `
      <header class="page-header">
        <div>
          ${monthSelect(months, key)}
          <h1>Resumen</h1>
        </div>
        <div class="header-actions">
          ${privacyButton()}
          <a class="icon-btn" href="#/ajustes" aria-label="Ajustes">${icon('gear')}</a>
          <button type="button" class="pill-btn" id="paste-pay" aria-label="Pegar pago de Apple Pay">${icon('card')} Pegar</button>
        </div>
      </header>

      ${(() => {
        const n = getState().settings.reviewEnabled || getState().settings.mailbox?.url ? pendingReview().length : 0;
        return n ? `<a class="review-banner" href="#/revisar">
          <span class="review-count num-plain">${n}</span>
          <span class="main">Tienes ${n} movimiento${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'} de revisar</span>
          ${icon('chevron')}
        </a>` : '';
      })()}

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
            ${payerRows.map((p) => `<div class="papi-sub">${icon('user')} ${esc(p.name)} <span class="num">${money(p.total)}</span></div>`).join('')}
          </div>
        </div>
      </section>

      <div class="section-title">Presupuestos <a href="#/ajustes">Editar</a></div>
      ${budgets.length ? `<div class="rings">${budgets.map((c) => {
        const spent = spentByCat[c.id] || 0;
        const pct = spent / c.budget;
        return `<button type="button" class="ring-card" data-budget="${esc(c.id)}">
          <div class="ring-wrap">${ring(pct)}<span class="ring-icon">${icon(c.icon)}</span></div>
          <div class="name">${esc(c.name)}</div>
          <div class="sub num ${pct > 1 ? 'neg' : ''}">${money(spent, { decimals: false })} / ${money(c.budget, { decimals: false })}</div>
        </button>`;
      }).join('')}</div>` : `<a class="card empty" href="#/ajustes" style="display:block">Sin presupuestos · Toca para definirlos en Ajustes</a>`}

      ${owed > 0 ? `<div class="section-title">Me deben <a href="#/patrimonio">Ver</a></div>
      <div class="list"><a class="row" href="#/patrimonio">
        <span class="icon">${icon('inbox')}</span>
        <span class="main"><div class="title">${[...owers].slice(0, 3).map(esc).join(', ')}${owers.size > 3 ? '…' : ''}</div>
          <div class="subtitle">${debts.length} deuda${debts.length === 1 ? '' : 's'} pendiente${debts.length === 1 ? '' : 's'}</div></span>
        <span class="trail num pos">${money(owed)}</span>
      </a></div>` : ''}

      ${payerRows.length ? `<div class="section-title">Te han pagado</div>
      <div class="list">${payerRows.map((p) => `<button class="row" data-payer-bucket="${esc(payerBucketId(p.id))}">
        <span class="icon">${icon('user')}</span>
        <span class="main"><div class="title">${esc(p.name)}</div>
          <div class="subtitle">${p.list.length} gasto${p.list.length === 1 ? '' : 's'} · no restan de tus cuentas</div></span>
        <span class="trail num">${money(p.total)}</span>
      </button>`).join('')}</div>` : ''}

      <div class="section-title">Gasto por categoría <a href="#/analisis">Análisis</a></div>
      ${spendingDonuts(monthTx.filter((t) => t.type === 'expense'), { href: '#/analisis' })}

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
    const payerBtn = e.target.closest('[data-payer-bucket]');
    if (payerBtn) return openTracker({ kind: 'cat', id: payerBtn.dataset.payerBucket }, draw);
    const ringCard = e.target.closest('[data-budget]');
    if (ringCard) return openBudgetSheet(ringCard.dataset.budget, draw);
    const row = e.target.closest('[data-tx]');
    if (row) openTxSheet(row.dataset.tx, draw);
  });

  draw();
}

const sum = (list) => list.reduce((acc, t) => acc + t.amount, 0);
