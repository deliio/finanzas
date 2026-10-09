// CSV: copia de seguridad (ida y vuelta) y exportación "Data Science" para Power BI.
//
// 1) Copia de seguridad — un único CSV:
//    Columnas: registro,id,fecha,tipo,importe,descripcion,categoria,datos
//    registro = transaccion | categoria | cuenta | posicion | recurrente | hucha | pendiente | historico | ajustes
//    Las transacciones usan las columnas directamente (legibles en Excel/Numbers) y guardan
//    el resto de campos en "datos" (JSON). El resto de entidades guardan el objeto completo en "datos".
//
// 2) Power BI — varios CSV "tidy" (modelo en estrella): hechos de transacciones + dimensiones.

import { accountValue, categoryById } from './store.js';

const BOM = '﻿'; // para que Excel/Power BI detecten UTF-8 (acentos, €)
const COLUMNS = ['registro', 'id', 'fecha', 'tipo', 'importe', 'descripcion', 'categoria', 'datos'];

/* ====================================================================== */
/* 1) Copia de seguridad                                                   */
/* ====================================================================== */

export function stateToCSV(state) {
  const rows = [COLUMNS];
  for (const t of state.transactions) {
    const { id, date, type, amount, description, category, ...extra } = t;
    rows.push(['transaccion', id, date, type, amount.toFixed(2), description, category, JSON.stringify(extra)]);
  }
  const push = (registro, list, cols) => list.forEach((x) => rows.push([registro, x.id ?? '', ...cols(x), JSON.stringify(x)]));
  push('categoria',  state.categories, (c) => ['', c.kind, c.budget ?? '', c.name, '']);
  push('cuenta',     state.accounts,   (a) => [a.updatedAt, a.kind, a.balance, a.name, '']);
  push('posicion',   state.holdings,   (h) => ['', h.ticker ?? '', h.invested ?? '', h.name ?? '', '']);
  push('recurrente', state.recurring,  (r) => [`día ${r.day}`, r.type, r.amount, r.name, r.category]);
  push('hucha',      state.goals,      (g) => [g.createdAt ?? '', '', g.saved, g.name, '']);
  push('pendiente',  state.pending,    (p) => [p.expectedDate ?? '', 'income', p.amount, p.name, '']);
  push('historico',  state.history,    (h) => [h.date, '', h.net, '', '']);

  // La clave API no se exporta: el CSV puede acabar en iCloud, correo…
  const { finnhubKey, ...settings } = state.settings;
  rows.push(['ajustes', '', '', '', '', '', '', JSON.stringify(settings)]);

  return BOM + toCSV(rows);
}

export function csvToState(text) {
  const [header, ...rows] = parseCSV(text.replace(/^﻿/, ''));
  if (!header || header[0] !== 'registro') throw new Error('El archivo no es una copia de seguridad válida.');
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const get = (r, col) => r[idx[col]] ?? '';
  const json = (r) => { try { return JSON.parse(get(r, 'datos') || '{}'); } catch { return {}; } };

  const next = { transactions: [], categories: [], accounts: [], holdings: [], recurring: [], goals: [], pending: [], history: [], settings: {} };
  const target = { categoria: 'categories', cuenta: 'accounts', posicion: 'holdings', recurrente: 'recurring', hucha: 'goals', pendiente: 'pending', historico: 'history' };

  for (const r of rows) {
    if (r.length < 2) continue;
    const kind = get(r, 'registro');
    if (kind === 'transaccion') {
      const extra = json(r);
      next.transactions.push({
        ...extra,
        id: get(r, 'id'),
        type: get(r, 'tipo') === 'income' ? 'income' : 'expense',
        amount: Number(get(r, 'importe')) || 0,
        description: get(r, 'descripcion'),
        category: get(r, 'categoria'),
        date: get(r, 'fecha'),
        note: extra.note ?? '',
        createdAt: extra.createdAt ?? new Date().toISOString(),
        account: extra.account ?? '',
        tags: extra.tags ?? [],
      });
    } else if (target[kind]) {
      next[target[kind]].push(json(r));
    } else if (kind === 'ajustes') {
      next.settings = json(r);
    }
  }
  if (!next.categories.length) delete next.categories; // conserva las por defecto
  return next;
}

/* ====================================================================== */
/* 2) Exportación Data Science (Power BI)                                  */
/* ====================================================================== */
// Convenciones: separador coma, decimal con punto, fechas ISO (AAAA-MM-DD), UTF-8 con BOM.
// En Power BI: Obtener datos → Texto/CSV → "Origen de archivo: 65001 UTF-8" y
// "Configuración regional: Inglés (Estados Unidos)" para que el punto decimal se lea bien.

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const num = (n) => (n == null || n === '' ? '' : Number(n).toFixed(2));

export function powerBIFiles(state, { estimateHolding } = {}) {
  const accountName = Object.fromEntries(state.accounts.map((a) => [a.id, a.name]));

  // Hechos: una fila por movimiento.
  const tx = [[
    'transaccion_id', 'fecha', 'anio', 'mes', 'anio_mes', 'trimestre', 'dia_semana',
    'tipo', 'importe_eur', 'importe_con_signo', 'categoria_id', 'categoria', 'concepto',
    'cuenta_id', 'cuenta', 'etiquetas', 'num_etiquetas', 'dividido_entre', 'pagado_por_papi', 'divisa_original',
    'importe_original', 'tipo_cambio', 'recurrente', 'creado_en',
  ]];
  for (const t of [...state.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    const d = new Date(t.date + 'T00:00:00');
    tx.push([
      t.id, t.date, d.getFullYear(), d.getMonth() + 1, t.date.slice(0, 7), `T${Math.floor(d.getMonth() / 3) + 1}`, WEEKDAYS[d.getDay()],
      t.type === 'income' ? 'ingreso' : 'gasto', num(t.amount), num(t.type === 'income' ? t.amount : -t.amount),
      t.category, categoryById(t.category).name, t.description,
      t.account || '', accountName[t.account] ?? '', (t.tags || []).join('|'), (t.tags || []).length,
      t.split === true ? 2 : (t.split || 1), t.papi ? 1 : 0, t.currency || 'EUR', num(t.originalAmount ?? t.amount), t.fxRate ?? 1,
      t.recurringId ? 1 : 0, t.createdAt,
    ]);
  }

  // Puente muchos-a-muchos movimiento ↔ etiqueta (para segmentar por etiqueta en Power BI).
  const tags = [['transaccion_id', 'etiqueta']];
  state.transactions.forEach((t) => (t.tags || []).forEach((tag) => tags.push([t.id, tag])));

  const cats = [['categoria_id', 'categoria', 'tipo', 'presupuesto_mensual']];
  state.categories.forEach((c) => cats.push([c.id, c.name, c.kind === 'income' ? 'ingreso' : 'gasto', num(c.budget || 0)]));

  const accs = [['cuenta_id', 'cuenta', 'tipo', 'saldo_real', 'fecha_saldo_real', 'interes_anual_pct', 'saldo_estimado_hoy']];
  state.accounts.forEach((a) => accs.push([a.id, a.name, a.kind, num(a.balance), a.updatedAt, a.interestRate || 0, num(accountValue(a))]));

  const hist = [['fecha', 'liquidez', 'activos', 'inversiones', 'deudas', 'patrimonio_neto']];
  state.history.forEach((h) => hist.push([h.date, num(h.liquidez), num(h.activos), num(h.inversiones), num(h.deudas), num(h.net)]));

  const inv = [['inversion_id', 'nombre', 'isin', 'etf_espejo', 'aportado', 'valor_estimado', 'rentabilidad', 'fecha_referencia']];
  state.holdings.forEach((h) => {
    const e = estimateHolding ? estimateHolding(h, state.quotes?.[h.ticker], state.fx) : { value: h.refValue, gain: h.refValue - h.invested };
    inv.push([h.id, h.name, h.isin || '', h.ticker, num(h.invested), num(e.value), num(e.gain), (h.refDate || '').slice(0, 10)]);
  });

  const goals = [['hucha_id', 'nombre', 'objetivo', 'ahorrado', 'progreso_pct']];
  state.goals.forEach((g) => goals.push([g.id, g.name, num(g.target), num(g.saved), g.target ? ((g.saved / g.target) * 100).toFixed(1) : 0]));

  const files = [
    ['transacciones.csv', tx],
    ['etiquetas_transacciones.csv', tags],
    ['categorias.csv', cats],
    ['cuentas.csv', accs],
    ['patrimonio_historico.csv', hist],
    ['inversiones.csv', inv],
    ['huchas.csv', goals],
  ];
  return files.map(([name, rows]) => ({ name, content: BOM + toCSV(rows) }));
}

/* ---------- Utilidades CSV -------------------------------------------- */

const toCSV = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n');

function cell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Parser RFC 4180 (comillas, comas y saltos de línea dentro de campos).
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
