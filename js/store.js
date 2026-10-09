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
    version: 1,
    transactions: [], // { id, type: 'expense'|'income', amount, description, category, date: 'YYYY-MM-DD', note, createdAt }
    categories: structuredClone(DEFAULT_CATEGORIES),
    accounts: [],     // { id, kind: 'liquidez'|'activo'|'deuda', name, balance, updatedAt }
    holdings: [],     // ETF espejo: { id, name, isin, ticker, invested, refValue, refPrice, refFx, refDate }
    settings: { currency: 'EUR', finnhubKey: '' },
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
    const loaded = { ...defaultState(), ...JSON.parse(raw) };
    loaded.categories = normalizeCategories(loaded.categories);
    return loaded;
  } catch (err) {
    console.error('No se pudo leer el almacenamiento local', err);
    return defaultState();
  }
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
  state = { ...defaultState(), ...next };
  state.settings = { ...defaultState().settings, ...next.settings, finnhubKey: next.settings?.finnhubKey || finnhubKey };
  state.categories = normalizeCategories(state.categories);
  persist();
}

export function resetState() {
  state = defaultState();
  persist();
}

/* ---------- Transacciones --------------------------------------------- */

export function addTransaction(tx) {
  const record = {
    id: uid(),
    type: tx.type === 'income' ? 'income' : 'expense',
    amount: round2(tx.amount),
    description: (tx.description ?? '').trim(),
    category: tx.category,
    date: tx.date ?? todayISO(),
    note: tx.note ?? '',
    createdAt: new Date().toISOString(),
  };
  state.transactions.push(record);
  persist();
  return record;
}

export function deleteTransaction(id) {
  state.transactions = state.transactions.filter((t) => t.id !== id);
  persist();
}

export function transactionsSorted() {
  return [...state.transactions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  );
}

export function transactionsInMonth(year, month /* 0-11 */) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  return state.transactions.filter((t) => t.date.startsWith(prefix));
}

/* ---------- Categorías ------------------------------------------------ */

export const categoriesOf = (kind) => state.categories.filter((c) => c.kind === kind);
export const categoryById = (id) =>
  state.categories.find((c) => c.id === id) ?? { id, name: 'Sin categoría', icon: 'box' };

/* ---------- Cuentas / patrimonio ------------------------------------- */

export function addAccount({ kind, name, balance }) {
  state.accounts.push({ id: uid(), kind, name: name.trim(), balance: round2(balance), updatedAt: todayISO() });
  persist();
}

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
