// Estado de la app persistido en localStorage.
// Toda la app lee/escribe a través de este módulo, así cambiar a IndexedDB
// más adelante solo afecta a load()/persist().

import { ICONS } from './icons.js';

const STORAGE_KEY = 'finanzas:v1';

// "icon" es una clave de ICONS (js/icons.js).
export const DEFAULT_CATEGORIES = [
  { id: 'supermercado',  kind: 'expense', name: 'Supermercado',  icon: 'cart',      budget: 400 },
  { id: 'restaurantes',  kind: 'expense', name: 'Restaurantes',  icon: 'utensils',  budget: 150 },
  { id: 'transporte',    kind: 'expense', name: 'Transporte',    icon: 'car',       budget: 120 },
  { id: 'hogar',         kind: 'expense', name: 'Hogar',         icon: 'home',      budget: 0 },
  { id: 'ocio',          kind: 'expense', name: 'Ocio',          icon: 'film',      budget: 100 },
  { id: 'salud',         kind: 'expense', name: 'Salud',         icon: 'heart',     budget: 0 },
  { id: 'compras',       kind: 'expense', name: 'Compras',       icon: 'bag',       budget: 0 },
  { id: 'suscripciones', kind: 'expense', name: 'Suscripciones', icon: 'repeat',    budget: 50 },
  { id: 'otros',         kind: 'expense', name: 'Otros',         icon: 'box',       budget: 0 },
  { id: 'nomina',        kind: 'income',  name: 'Nómina',        icon: 'briefcase', budget: 0 },
  { id: 'otros-ingresos',kind: 'income',  name: 'Otros',         icon: 'plus',      budget: 0 },
];

// Grupos del widget "Estilo de vida": categorías (id o nombre) y #etiquetas.
export const DEFAULT_LIFESTYLE = {
  base: 'supermercado, hogar, salud, transporte, suscripciones, #supermercado-dieta, #deporte',
  ocio: 'ocio, restaurantes, compras, #viajes',
};

// Migra categorías guardadas con emojis (v0.1) a las claves de iconos SVG.
function normalizeCategories(categories) {
  return categories.map(({ color, ...c }) => {
    if (ICONS[c.icon]) return c;
    const def = DEFAULT_CATEGORIES.find((d) => d.id === c.id);
    return { ...c, icon: def?.icon ?? 'box' };
  });
}

function defaultState() {
  return {
    version: 2,
    // { id, type: 'expense'|'income', amount (€), description, category, date: 'YYYY-MM-DD',
    //   note, account, tags: [], split, currency, originalAmount, fxRate, recurringId, createdAt }
    transactions: [],
    categories: structuredClone(DEFAULT_CATEGORIES),
    accounts: [],     // { id, kind: 'liquidez'|'activo'|'deuda', name, balance, interestRate, updatedAt, syncedAt }
    holdings: [],     // ETF espejo: { id, name, isin, ticker, invested, refValue, refPrice, refFx, refDate }
    recurring: [],    // { id, name, type, amount, category, account, tags, day, active, lastMonth: 'YYYY-MM' }
    goals: [],        // huchas: { id, name, target, saved, createdAt }
    pending: [],      // cobros pendientes: { id, name, amount, expectedDate }
    history: [],      // patrimonio diario: { date, liquidez, activos, inversiones, deudas, net }
    settings: { currency: 'EUR', finnhubKey: '', privacy: false, lifestyle: { ...DEFAULT_LIFESTYLE } },
    quotes: {},       // caché de cotizaciones por ticker (no se exporta)
    fx: null,         // { rate: USD por 1 €, date, fetchedAt }
  };
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return migrate(JSON.parse(raw));
  } catch (err) {
    console.error('No se pudo leer el almacenamiento local', err);
    return defaultState();
  }
}

// Completa campos que no existían en versiones anteriores.
function migrate(raw) {
  const def = defaultState();
  const s = { ...def, ...raw };
  s.settings = { ...def.settings, ...raw.settings };
  s.categories = normalizeCategories(s.categories);
  s.transactions = s.transactions.map((t) => ({ tags: [], account: '', ...t }));
  s.version = def.version;
  return s;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  listeners.forEach((fn) => fn(state));
}

export const uid = () =>
  (crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2));

export const getState = () => state;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export function replaceState(next) {
  // La clave API no viaja en el CSV: conservamos la del dispositivo.
  const finnhubKey = state.settings.finnhubKey;
  state = migrate(next);
  state.settings.finnhubKey = next.settings?.finnhubKey || finnhubKey;
  persist();
}

export function resetState() {
  state = defaultState();
  persist();
}

/* ---------- Transacciones --------------------------------------------- */

export function addTransaction(tx, { silent = false } = {}) {
  const record = {
    id: uid(),
    type: tx.type === 'income' ? 'income' : 'expense',
    amount: round2(tx.amount),
    description: (tx.description ?? '').trim(),
    category: tx.category,
    date: tx.date ?? todayISO(),
    note: tx.note ?? '',
    account: tx.account || '', // id de la cuenta de liquidez de la que sale/entra
    tags: normalizeTags(tx.tags),
    createdAt: new Date().toISOString(),
  };
  // Campos opcionales: solo se guardan si aplican.
  if (tx.split) record.split = true;
  if (tx.currency && tx.currency !== 'EUR') {
    Object.assign(record, { currency: tx.currency, originalAmount: round2(tx.originalAmount), fxRate: tx.fxRate });
  }
  if (tx.recurringId) record.recurringId = tx.recurringId;

  state.transactions.push(record);
  if (!silent) persist();
  return record;
}

export function deleteTransaction(id) {
  state.transactions = state.transactions.filter((t) => t.id !== id);
  persist();
}

export function transactionsSorted(list = state.transactions) {
  return [...list].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  );
}

export function transactionsInMonth(year, month /* 0-11 */) {
  return transactionsInMonthKey(monthKey(year, month));
}

export const transactionsInMonthKey = (key /* 'YYYY-MM' */) =>
  state.transactions.filter((t) => t.date.startsWith(key));

/** Meses con datos (más el actual), del más reciente al más antiguo: ['2026-10', ...]. */
export function availableMonths() {
  const set = new Set(state.transactions.map((t) => t.date.slice(0, 7)));
  set.add(todayISO().slice(0, 7));
  return [...set].sort().reverse();
}

/* ---------- Etiquetas ------------------------------------------------- */

/** "#Viajes  mecánica,#viajes" → ['viajes', 'mecánica'] */
export function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(/[\s,]+/);
  return [...new Set(list.map((t) => t.replace(/^#+/, '').trim().toLowerCase()).filter(Boolean))];
}

/** Etiquetas usadas, ordenadas por frecuencia: [{ tag, count }]. */
export function allTags() {
  const counts = {};
  state.transactions.forEach((t) => (t.tags || []).forEach((tag) => (counts[tag] = (counts[tag] || 0) + 1)));
  return Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

/* ---------- Categorías ------------------------------------------------ */

export const categoriesOf = (kind) => state.categories.filter((c) => c.kind === kind);
export const categoryById = (id) =>
  state.categories.find((c) => c.id === id) ?? { id, name: 'Sin categoría', icon: 'box' };

/* ---------- Cuentas / patrimonio ------------------------------------- */

// interestRate: % anual (p. ej. 2.25). Solo se aplica a cuentas de liquidez.
// syncedAt: momento exacto del último saldo real; los movimientos posteriores se suman/restan.
export function addAccount({ kind, name, balance, interestRate = 0 }) {
  state.accounts.push({ id: uid(), kind, name: name.trim(), balance: round2(balance), interestRate,
    updatedAt: todayISO(), syncedAt: new Date().toISOString() });
  persist();
}

export function updateAccount(id, patch) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;
  Object.assign(a, patch);
  persist();
}

/**
 * Desglose del saldo estimado de una cuenta:
 *   interest: intereses devengados desde el último saldo real (capitalización diaria
 *             con el % anual; se aproxima muy bien al abono mensual).
 *   flows:    ingresos − gastos asignados a la cuenta y apuntados después de ese saldo.
 */
export function accountBreakdown(a, today = todayISO()) {
  let interest = 0, flows = 0;
  if (a.kind === 'liquidez') {
    if (a.interestRate) {
      const days = Math.max(0, (Date.parse(today) - Date.parse(a.updatedAt)) / 86400000);
      interest = a.balance * (Math.pow(1 + a.interestRate / 100, days / 365) - 1);
    }
    const since = a.syncedAt || a.updatedAt;
    for (const t of state.transactions) {
      if (t.account === a.id && t.createdAt > since) flows += t.type === 'income' ? t.amount : -t.amount;
    }
  }
  return { interest, flows, value: a.balance + interest + flows };
}

export const accountValue = (a) => accountBreakdown(a).value;

export function deleteAccount(id) {
  state.accounts = state.accounts.filter((a) => a.id !== id);
  persist();
}

/* ---------- ETF espejo ---------------------------------------------- */

export function addHolding(h) {
  const record = { id: uid(), ...h, refDate: new Date().toISOString() };
  state.holdings.push(record);
  persist();
  return record;
}

export function updateHolding(id, patch) {
  const h = state.holdings.find((x) => x.id === id);
  if (!h) return;
  Object.assign(h, patch);
  persist();
}

export function deleteHolding(id) {
  state.holdings = state.holdings.filter((h) => h.id !== id);
  persist();
}

export function setMarketData(quotes, fx) {
  state.quotes = { ...state.quotes, ...quotes };
  if (fx) state.fx = fx;
  persist();
}

/* ---------- Gastos recurrentes --------------------------------------- */

export function addRecurring(r) {
  const now = todayISO().slice(0, 7);
  state.recurring.push({
    id: uid(), active: true, tags: [], account: '', ...r,
    amount: round2(r.amount), day: Math.min(31, Math.max(1, Math.round(r.day))),
    // Si ya está pagado este mes, empezamos a generar el mes que viene.
    lastMonth: r.alreadyThisMonth ? now : prevMonthKey(now),
  });
  delete state.recurring.at(-1).alreadyThisMonth;
  persist();
}

export function updateRecurring(id, patch) {
  const r = state.recurring.find((x) => x.id === id);
  if (!r) return;
  Object.assign(r, patch);
  persist();
}

export function deleteRecurring(id) {
  state.recurring = state.recurring.filter((r) => r.id !== id);
  persist();
}

/**
 * Genera los movimientos recurrentes pendientes hasta hoy (incluye meses atrasados
 * si la app no se abrió). El día 31 se ajusta al último día de meses más cortos.
 * Devuelve cuántos movimientos ha añadido.
 */
export function runRecurring(today = todayISO()) {
  const current = today.slice(0, 7);
  const todayDay = Number(today.slice(8, 10));
  let added = 0;

  for (const r of state.recurring) {
    if (!r.active) continue;
    let key = nextMonthKey(r.lastMonth || prevMonthKey(current));
    while (key <= current) {
      const [y, m] = key.split('-').map(Number);
      const day = Math.min(r.day, new Date(y, m, 0).getDate());
      if (key === current && day > todayDay) break;
      addTransaction({
        type: r.type, amount: r.amount, description: r.name, category: r.category,
        account: r.account, tags: r.tags, date: `${key}-${String(day).padStart(2, '0')}`, recurringId: r.id,
      }, { silent: true });
      r.lastMonth = key;
      added++;
      key = nextMonthKey(key);
    }
  }
  if (added) persist();
  return added;
}

/* ---------- Huchas (metas de ahorro) --------------------------------- */

export function addGoal({ name, target }) {
  state.goals.push({ id: uid(), name: name.trim(), target: round2(target), saved: 0, createdAt: todayISO() });
  persist();
}

export function updateGoal(id, patch) {
  const g = state.goals.find((x) => x.id === id);
  if (!g) return;
  Object.assign(g, patch);
  persist();
}

export function deleteGoal(id) {
  state.goals = state.goals.filter((g) => g.id !== id);
  persist();
}

/* ---------- Cobros pendientes ---------------------------------------- */

export function addPending({ name, amount, expectedDate }) {
  state.pending.push({ id: uid(), name: name.trim(), amount: round2(amount), expectedDate: expectedDate || '' });
  persist();
}

export function deletePending(id) {
  state.pending = state.pending.filter((p) => p.id !== id);
  persist();
}

/* ---------- Histórico de patrimonio ---------------------------------- */

/** Guarda (o sobrescribe) la foto del patrimonio de hoy. */
export function recordSnapshot(snap, date = todayISO()) {
  const entry = { date, ...Object.fromEntries(Object.entries(snap).map(([k, v]) => [k, round2(v)])) };
  const i = state.history.findIndex((h) => h.date === date);
  const prev = i >= 0 ? state.history[i] : null;
  if (prev && JSON.stringify(prev) === JSON.stringify(entry)) return; // sin cambios
  if (i >= 0) state.history[i] = entry; else state.history.push(entry);
  state.history.sort((a, b) => a.date.localeCompare(b.date));
  persist();
}

/* ---------- Ajustes -------------------------------------------------- */

export function setSetting(key, value) {
  state.settings = { ...state.settings, [key]: value };
  persist();
}

/* ---------- Utilidades ----------------------------------------------- */

export const round2 = (n) => Math.round(Number(n) * 100) / 100;

export function todayISO(d = new Date()) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export const monthKey = (year, month /* 0-11 */) => `${year}-${String(month + 1).padStart(2, '0')}`;

export function nextMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : monthKey(y, m);
}

export function prevMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : monthKey(y, m - 2);
}
