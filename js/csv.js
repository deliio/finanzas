// Copia de seguridad en un único CSV.
//
// Columnas: registro,id,fecha,tipo,importe,descripcion,categoria,datos
//  - registro = transaccion | categoria | cuenta | posicion | ajustes
//  - Las transacciones usan las columnas directamente (legibles en Excel/Numbers).
//  - El resto de entidades guardan el objeto completo en "datos" (JSON),
//    las demás columnas son solo informativas.

const COLUMNS = ['registro', 'id', 'fecha', 'tipo', 'importe', 'descripcion', 'categoria', 'datos'];

export function stateToCSV(state) {
  const rows = [COLUMNS];
  for (const t of state.transactions) {
    rows.push(['transaccion', t.id, t.date, t.type, t.amount.toFixed(2), t.description, t.category,
      JSON.stringify({ note: t.note, createdAt: t.createdAt })]);
  }
  for (const c of state.categories) {
    rows.push(['categoria', c.id, '', c.kind, c.budget ?? '', c.name, '', JSON.stringify(c)]);
  }
  for (const a of state.accounts) {
    rows.push(['cuenta', a.id, a.updatedAt, a.kind, a.balance, a.name, '', JSON.stringify(a)]);
  }
  for (const h of state.holdings) {
    rows.push(['posicion', h.id, '', h.ticker ?? '', h.invested ?? '', h.name ?? '', '', JSON.stringify(h)]);
  }
  // La clave API no se exporta: el CSV puede acabar en iCloud, correo…
  const { finnhubKey, ...settings } = state.settings;
  rows.push(['ajustes', '', '', '', '', '', '', JSON.stringify(settings)]);

  // BOM para que Excel detecte UTF-8 (acentos, €).
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function csvToState(text) {
  const [header, ...rows] = parseCSV(text.replace(/^﻿/, ''));
  if (!header || header[0] !== 'registro') throw new Error('El archivo no es una copia de seguridad válida.');
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const get = (r, col) => r[idx[col]] ?? '';
  const json = (r) => { try { return JSON.parse(get(r, 'datos') || '{}'); } catch { return {}; } };

  const next = { version: 1, transactions: [], categories: [], accounts: [], holdings: [], settings: {} };
  for (const r of rows) {
    if (r.length < 2) continue;
    switch (get(r, 'registro')) {
      case 'transaccion': {
        const extra = json(r);
        next.transactions.push({
          id: get(r, 'id'),
          type: get(r, 'tipo') === 'income' ? 'income' : 'expense',
          amount: Number(get(r, 'importe')) || 0,
          description: get(r, 'descripcion'),
          category: get(r, 'categoria'),
          date: get(r, 'fecha'),
          note: extra.note ?? '',
          createdAt: extra.createdAt ?? new Date().toISOString(),
        });
        break;
      }
      case 'categoria': next.categories.push(json(r)); break;
      case 'cuenta':    next.accounts.push(json(r)); break;
      case 'posicion':  next.holdings.push(json(r)); break;
      case 'ajustes':   next.settings = json(r); break;
    }
  }
  if (!next.categories.length) delete next.categories; // conserva las por defecto
  return next;
}

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
