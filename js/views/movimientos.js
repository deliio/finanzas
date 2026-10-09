// Lista completa de movimientos agrupada por día. Tocar uno permite borrarlo.

import { transactionsSorted, categoryById, deleteTransaction } from '../store.js';
import { txRow, dayLabel, toast } from '../ui.js';

export function render(root) {
  const draw = () => {
    const txs = transactionsSorted();
    const byDay = new Map();
    txs.forEach((t) => byDay.has(t.date) ? byDay.get(t.date).push(t) : byDay.set(t.date, [t]));

    root.innerHTML = `
      <header class="page-header"><h1>Movimientos</h1></header>
      ${txs.length ? [...byDay].map(([day, list]) => `
        <div class="list-day">${dayLabel(day)}</div>
        <div class="list">${list.map((t) => txRow(t, categoryById(t.category))).join('')}</div>
      `).join('') : `<div class="card empty"><strong>Sin movimientos</strong>Los gastos que añadas aparecerán aquí.</div>`}
    `;
  };

  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-tx]');
    if (row && confirm('¿Eliminar este movimiento?')) {
      deleteTransaction(row.dataset.tx);
      toast('Movimiento eliminado');
      draw();
    }
  });

  draw();
}
