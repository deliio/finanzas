// Análisis: peso de las categorías (donut), tracker acumulativo por categoría
// sin depender de presupuestos (#7), análisis por etiquetas (#9) y widget
// "Estilo de vida" (#15).

import { getState, categoryById, categoriesOf, availableMonths, transactionsSorted, setSetting, DEFAULT_LIFESTYLE, todayISO, prevMonthKey, bucketOf, PAPI } from '../store.js';
import { money, esc, icon, privacyButton, monthSelect, getSelectedMonth, setSelectedMonth, monthShort, openSheet, txRow, toast } from '../ui.js';
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
    // Lo pagado por papi va a su propio grupo (como una categoría más).
    const byCat = groupSum(expenses, (t) => [bucketOf(t)]);
    const catRows = categoriesOf('expense')
      .map((c) => ({ c, ...(byCat[c.id] || { sum: 0, count: 0 }) }))
      .sort((a, b) => b.sum - a.sum);
    // Categorías que ya no existen pero tienen gastos.
    Object.keys(byCat).filter((id) => !catRows.some((r) => r.c.id === id))
      .forEach((id) => catRows.push({ c: categoryById(id), ...byCat[id] }));

    const byTag = groupSum(expenses, (t) => t.tags || []);
    const tagRows = Object.entries(byTag).map(([tag, v]) => ({ tag, ...v })).sort((a, b) => b.sum - a.sum);

    root.innerHTML = `
      <div class="topbar">
        <a class="left" href="#/inicio">‹ Resumen</a>
        <h2>Análisis</h2>
        <span style="justify-self:end">${privacyButton()}</span>
      </div>

      <div class="segmented four" role="group" aria-label="Periodo">
        ${PERIODS.map((p) => `<button type="button" data-period="${p.id}" aria-pressed="${p.id === period}">${p.label}</button>`).join('')}
      </div>
      ${period === 'mes' ? `<div style="margin:-6px 0 14px">${monthSelect(months, key, 'an-month')}</div>` : ''}

      ${spendingDonuts(expenses)}

      ${lifestyleCard(expenses)}

      <div class="section-title">Categorías</div>
      <div class="list">
        ${catRows.map((r) => `
          <button class="row" data-catid="${esc(r.c.id)}">
            <span class="icon">${icon(r.c.icon)}</span>
            <span class="main">
              <div class="title">${esc(r.c.name)}</div>
              <div class="subtitle">${r.count} movimiento${r.count === 1 ? '' : 's'} · ${pct(r.sum, total)}</div>
              <div class="mini-bar"><span style="width:${total ? (r.sum / total) * 100 : 0}%"></span></div>
            </span>
            <span class="trail num">${money(r.sum)}</span>
          </button>`).join('')}
      </div>

      <div class="section-title">Etiquetas</div>
      ${tagRows.length ? `<div class="list">${tagRows.map((r) => `
        <button class="row" data-tagid="${esc(r.tag)}">
          <span class="icon">${icon('tag')}</span>
          <span class="main"><div class="title">#${esc(r.tag)}</div>
            <div class="subtitle">${r.count} movimiento${r.count === 1 ? '' : 's'} · ${pct(r.sum, total)} del gasto</div></span>
          <span class="trail num">${money(r.sum)}</span>
        </button>`).join('')}</div>`
        : `<div class="card empty">Añade #etiquetas a tus gastos (p. ej. #viajes) para analizarlos aquí.</div>`}
    `;

    root.querySelector('#an-month')?.addEventListener('change', (e) => { setSelectedMonth(e.target.value); draw(); });
  };

  root.addEventListener('click', (e) => {
    const p = e.target.closest('[data-period]');
    if (p) { period = p.dataset.period; draw(); return; }
    const c = e.target.closest('[data-catid]');
    if (c) return openTracker({ kind: 'cat', id: c.dataset.catid }, draw);
    const t = e.target.closest('[data-tagid]');
    if (t) return openTracker({ kind: 'tag', id: t.dataset.tagid }, draw);
    if (e.target.closest('[data-action="lifestyle-config"]')) openLifestyleConfig(draw);
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

/* ---------- Tracker acumulativo (categoría o etiqueta) ----------------- */

export function openTracker({ kind, id }, onDone) {
  const isCat = kind === 'cat';
  const test = isCat ? (t) => bucketOf(t) === id : (t) => (t.tags || []).includes(id);
  const list = transactionsSorted(getState().transactions.filter((t) => t.type === 'expense' && test(t)));
  const today = todayISO();
  const sumWhere = (fn) => list.filter(fn).reduce((s, t) => s + t.amount, 0);

  const thisMonth = sumWhere((t) => t.date.startsWith(today.slice(0, 7)));
  const thisYear = sumWhere((t) => t.date.startsWith(today.slice(0, 4)));
  const allTime = sumWhere(() => true);
  const firstMonth = list.at(-1)?.date.slice(0, 7);
  const monthsSpan = firstMonth ? monthsBetween(firstMonth, today.slice(0, 7)) : 1;
  const months6 = lastMonths(6);
  const title = isCat ? categoryById(id).name : `#${id}`;

  const { el, close } = openSheet(`
    <h3 class="sheet-title">${esc(title)}</h3>
    <div class="stat-grid">
      <div class="pill-stat"><div class="label">Este mes</div><div class="value num">${money(thisMonth)}</div></div>
      <div class="pill-stat"><div class="label">Este año</div><div class="value num">${money(thisYear)}</div></div>
      <div class="pill-stat"><div class="label">Total histórico</div><div class="value num">${money(allTime)}</div></div>
      <div class="pill-stat"><div class="label">Media mensual</div><div class="value num">${money(allTime / monthsSpan)}</div></div>
    </div>
    <div class="card" style="margin-top:12px">
      ${barChart(months6.map((m, i) => ({ label: monthShort(m), value: sumWhere((t) => t.date.startsWith(m)), highlight: i === 5 })))}
    </div>
    ${id === PAPI.id ? papiBreakdown(list, today.slice(0, 7)) : ''}
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

/** Qué te ha pagado papi este mes, por categoría real. */
function papiBreakdown(list, monthKey) {
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

/* ---------- Estilo de vida (#15) --------------------------------------- */

function parseGroup(str) {
  const tags = new Set(), cats = new Set();
  String(str || '').split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    .forEach((tok) => (tok.startsWith('#') ? tags.add(tok.slice(1)) : cats.add(tok)));
  return { tags, cats };
}

/** Clasifica un gasto: primero mandan las etiquetas, después la categoría. */
function classifier() {
  const cfg = { ...DEFAULT_LIFESTYLE, ...getState().settings.lifestyle };
  const base = parseGroup(cfg.base), ocio = parseGroup(cfg.ocio);
  const catMatch = (g, t) => {
    const c = categoryById(t.category);
    return g.cats.has(c.id.toLowerCase()) || g.cats.has(c.name.toLowerCase());
  };
  return (t) => {
    const tags = t.tags || [];
    if (tags.some((x) => base.tags.has(x))) return 'base';
    if (tags.some((x) => ocio.tags.has(x))) return 'ocio';
    if (catMatch(base, t)) return 'base';
    if (catMatch(ocio, t)) return 'ocio';
    return 'otros';
  };
}

function lifestyleCard(expenses) {
  const classify = classifier();
  const sums = { base: 0, ocio: 0, otros: 0 };
  expenses.forEach((t) => (sums[classify(t)] += t.amount));
  const total = sums.base + sums.ocio + sums.otros;

  // Media de los 3 últimos meses cerrados para tener referencia.
  const prev3 = lastMonths(4).slice(0, 3);
  const prevList = getState().transactions.filter((t) => t.type === 'expense' && prev3.includes(t.date.slice(0, 7)));
  const avg = { base: 0, ocio: 0 };
  prevList.forEach((t) => { const k = classify(t); if (k in avg) avg[k] += t.amount / 3; });

  const seg = (k, color) => `<span style="width:${total ? (sums[k] / total) * 100 : 0}%;background:${color}"></span>`;
  return `
    <div class="section-title">Estilo de vida <button class="link-btn" data-action="lifestyle-config">Configurar</button></div>
    <section class="card">
      <div class="split">
        <div class="pill-stat">
          <div class="label">${icon('dumbbell')} Coste base</div>
          <div class="value num">${money(sums.base)}</div>
          <div class="muted num" style="font-size:12px">media 3m ${money(avg.base, { decimals: false })}</div>
        </div>
        <div class="pill-stat">
          <div class="label">${icon('film')} Ocio</div>
          <div class="value num">${money(sums.ocio)}</div>
          <div class="muted num" style="font-size:12px">media 3m ${money(avg.ocio, { decimals: false })}</div>
        </div>
      </div>
      <div class="bar">${seg('base', 'var(--text)')}${seg('ocio', 'var(--orange)')}${seg('otros', 'var(--card-3)')}</div>
      <div class="legend">
        <span><i class="dot" style="background:var(--text)"></i>Base ${pct(sums.base, total)}</span>
        <span><i class="dot" style="background:var(--orange)"></i>Ocio ${pct(sums.ocio, total)}</span>
        <span><i class="dot" style="background:var(--card-3)"></i>Otros <span class="num">${money(sums.otros, { decimals: false })}</span></span>
      </div>
    </section>`;
}

function openLifestyleConfig(onDone) {
  const cfg = { ...DEFAULT_LIFESTYLE, ...getState().settings.lifestyle };
  const { el, close } = openSheet(`
    <h3 class="sheet-title">Grupos de estilo de vida</h3>
    <p class="muted" style="font-size:14px;margin:0 0 14px">Escribe categorías y #etiquetas separadas por comas.
      Las etiquetas mandan sobre la categoría: un gasto de Supermercado con #fiesta cuenta como ocio si #fiesta está en Ocio.</p>
    <label class="area-label">Coste base (necesario)</label>
    <textarea id="ls-base" class="area" rows="3">${esc(cfg.base)}</textarea>
    <label class="area-label">Ocio</label>
    <textarea id="ls-ocio" class="area" rows="3">${esc(cfg.ocio)}</textarea>
    <button class="btn btn-primary" type="button" id="ls-save" style="margin-top:14px">Guardar</button>
    <button class="btn" type="button" id="ls-reset">Restaurar valores por defecto</button>
  `);
  el.querySelector('#ls-save').addEventListener('click', () => {
    setSetting('lifestyle', { base: el.querySelector('#ls-base').value, ocio: el.querySelector('#ls-ocio').value });
    close(); toast('Grupos guardados'); onDone();
  });
  el.querySelector('#ls-reset').addEventListener('click', () => {
    el.querySelector('#ls-base').value = DEFAULT_LIFESTYLE.base;
    el.querySelector('#ls-ocio').value = DEFAULT_LIFESTYLE.ocio;
  });
}
