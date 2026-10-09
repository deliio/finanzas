// Lista completa de movimientos agrupada por día, con buscador universal.
// Busca por concepto, categoría, #etiqueta o importe ("23,40", "23.4", ">100").

import { getState, transactionsSorted, categoryById, deleteTransaction } from '../store.js';
import { txRow, dayLabel, toast, esc, money, signedMoney, icon, privacyButton, openSheet, amountToInput, currencySymbol, parseAmount, shortDate, splitCount } from '../ui.js';

let lastQuery = '';   // se conserva al cambiar de pestaña
let lastType = 'all';

export function render(root) {
  root.innerHTML = `
    <header class="page-header"><h1>Movimientos</h1><div class="header-actions">${privacyButton()}</div></header>
    <div class="search">
      ${icon('search')}
      <input id="q" type="search" placeholder="Buscar: Alcampo, Bizum, #viajes, 23,40, >100…"
             autocomplete="off" autocapitalize="off" enterkeyhint="search" value="${esc(lastQuery)}">
    </div>
    <div class="segmented small" role="group" aria-label="Filtrar por tipo">
      <button type="button" data-filter="all">Todos</button>
      <button type="button" data-filter="expense">Gastos</button>
      <button type="button" data-filter="income">Ingresos</button>
    </div>
    <div id="results"></div>
  `;

  const results = root.querySelector('#results');
  const input = root.querySelector('#q');

  const draw = () => {
    root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === lastType)));
    const txs = transactionsSorted().filter((t) => (lastType === 'all' || t.type === lastType) && matches(t, lastQuery));
    const byDay = new Map();
    txs.forEach((t) => byDay.has(t.date) ? byDay.get(t.date).push(t) : byDay.set(t.date, [t]));
    const net = txs.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);

    results.innerHTML = `
      ${lastQuery || lastType !== 'all' ? `<div class="result-summary">${txs.length} resultado${txs.length === 1 ? '' : 's'}
        · <span class="num ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${money(Math.abs(net))}</span></div>` : ''}
      ${txs.length ? [...byDay].map(([day, list]) => `
        <div class="list-day">${dayLabel(day)}</div>
        <div class="list">${list.map((t) => txRow(t, categoryById(t.category))).join('')}</div>
      `).join('') : `<div class="card empty"><strong>${lastQuery ? 'Sin resultados' : 'Sin movimientos'}</strong>
        ${lastQuery ? 'Prueba con otro texto, #etiqueta o importe.' : 'Los gastos que añadas aparecerán aquí.'}</div>`}
    `;
  };

  input.addEventListener('input', () => { lastQuery = input.value; draw(); });

  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) { lastType = f.dataset.filter; draw(); return; }
    const chip = e.target.closest('.chip');
    if (chip) { input.value = lastQuery = chip.textContent; draw(); return; }
    const row = e.target.closest('[data-tx]');
    if (row) openTxSheet(row.dataset.tx, draw);
  });

  draw();
}

/* ---------- Búsqueda -------------------------------------------------- */

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function matches(t, query) {
  const q = query.trim();
  if (!q) return true;
  // Varias palabras = todas deben coincidir (Mercadona #dieta).
  return q.split(/\s+/).every((term) => matchTerm(t, term));
}

function matchTerm(t, term) {
  // Comparaciones de importe: >100, <20, >=50
  const cmp = term.match(/^([<>]=?)(.+)$/);
  if (cmp) {
    const n = parseAmount(cmp[2]);
    if (!Number.isFinite(n)) return false;
    return { '>': t.amount > n, '>=': t.amount >= n, '<': t.amount < n, '<=': t.amount <= n }[cmp[1]];
  }
  // Etiqueta exacta (por prefijo): #via → #viajes
  if (term.startsWith('#')) {
    const tag = norm(term.slice(1));
    return (t.tags || []).some((x) => norm(x).startsWith(tag));
  }
  // Importe: "23,40" o "23.4" → igualdad; "23" → empieza por 23
  if (/^\d+([.,]\d{1,2})?$/.test(term)) {
    const n = parseAmount(term);
    if (/[.,]/.test(term)) return Math.abs(t.amount - n) < 0.005 || Math.abs((t.originalAmount ?? -1) - n) < 0.005;
    if (String(Math.floor(t.amount)).startsWith(term)) return true;
  }
  // (La cuenta no entra en la búsqueda: "BBVA nómina" haría coincidir todo con "nómina".)
  const haystack = norm([t.description, categoryById(t.category).name, t.note, t.papi ? 'papi' : '', ...(t.tags || [])].join(' '));
  return haystack.includes(norm(term));
}

/* ---------- Detalle de un movimiento (compartido con el Dashboard) ---- */

export function openTxSheet(id, onDone) {
  const t = getState().transactions.find((x) => x.id === id);
  if (!t) return;
  const cat = categoryById(t.category);
  const account = getState().accounts.find((a) => a.id === t.account);
  const recurring = t.recurringId && getState().recurring.find((r) => r.id === t.recurringId);

  const rows = [
    ['Importe', `<span class="num ${t.type === 'income' ? 'pos' : 'neg'}">${signedMoney(t.amount, t.type)}</span>`],
    ['Fecha', shortDate(t.date)],
    ['Categoría', esc(cat.name)],
    account && ['Cuenta', esc(account.name)],
    t.currency && ['Importe original', `<span class="num">${amountToInput(t.originalAmount)} ${currencySymbol(t.currency)}</span> · 1 ${currencySymbol(t.currency)} = ${String(t.fxRate).replace('.', ',')} €`],
    t.papi && ['Pagado por', 'Papi · no resta de tus cuentas'],
    t.split && ['Compartido', `Entre ${splitCount(t)} · guardada tu parte`],
    recurring && ['Recurrente', `${esc(recurring.name)} · día ${recurring.day}`],
    t.tags?.length && ['Etiquetas', t.tags.map((x) => `#${esc(x)}`).join(' ')],
  ].filter(Boolean);

  const { el, close } = openSheet(`
    <h3 class="sheet-title">${esc(t.description || cat.name)}</h3>
    <div class="list kv">${rows.map(([k, v]) => `<div class="row"><span class="main">${k}</span><span class="trail">${v}</span></div>`).join('')}</div>
    <button class="btn btn-danger" type="button" id="tx-del" style="margin-top:18px">Eliminar movimiento</button>
    <button class="btn" type="button" data-close>Cerrar</button>
  `);
  el.querySelector('#tx-del').addEventListener('click', () => {
    if (!confirm('¿Eliminar este movimiento?')) return;
    deleteTransaction(t.id);
    close();
    toast('Movimiento eliminado');
    onDone?.();
  });
}
