// Conexión con tus bancos (Abanca y MyInvestor vía Enable Banking) a través de tu propio Worker.
// - El Worker guarda la clave privada; la app solo conoce su URL y un token (Ajustes → Banco).
// - Cada banco se conecta aparte y se enlaza con una cuenta de la app, cuyo saldo pasa a ser el del banco.
// - Sincroniza saldo y movimientos confirmados desde el día en que conectaste ese banco.
// - No duplica: cada movimiento del banco tiene una clave y, si ya lo tenías apuntado
//   (Apple Pay, buzón, a mano, recurrente), se fusiona con ese.
// - Traspasos entre tus cuentas: si la otra parte es el IBAN de una de tus cuentas, es un traspaso
//   (ni ingreso ni gasto). Si los dos bancos están conectados, los dos lados se juntan en uno.
//   Si solo lo dice el texto ("MyInvestor", "Andbank"), te lo pregunta en Revisar.
// - Todo lo nuevo entra pendiente de revisar.

import { getState, setSetting, addRawTransaction, addAccount, updateAccount, suggestCategory, persist, todayISO, round2 } from './store.js';

const AUTO_EVERY = 6 * 3600 * 1000;   // como mucho cada 6 h al abrir la app (límite de consultas del banco)
const MATCH_DAYS = 3;                 // margen de fechas al juntar movimientos
const RECONNECT_WARN = 7 * 86400000;  // avisar 7 días antes de que caduque el permiso
const TRANSFER_WORDS = /MYINVESTOR|ANDBANK/i;
const DEAD = ['EXPIRED', 'REVOKED', 'CLOSED', 'CANCELLED', 'INVALID'];

/** Bancos que se pueden conectar (el id coincide con BANKS del Worker). */
export const BANKS = [
  { id: 'abanca', name: 'Abanca', match: /abanca/i },
  { id: 'myinvestor', name: 'MyInvestor', match: /my ?investor|andbank/i },
];
export const bankName = (id) => BANKS.find((b) => b.id === id)?.name || id;

/* ---------- Configuración ---------------------------------------------------- */

/** Ajustes generales del banco (servidor, reglas, MyInvestor manual) + cada banco en .banks. */
export function bankConfig() {
  const c = getState().settings.bank || {};
  // Antes solo había Abanca y sus datos estaban sueltos: se pasan a banks.abanca.
  if (c.since && !c.banks) {
    const { since, accountId, iban, status, validUntil, lastSync, lastAutoTry, seen, accounts, ...rest } = c;
    const migrated = { ...rest, banks: { abanca: { since, accountId, iban, status, validUntil, lastSync, lastAutoTry, seen, accounts } } };
    setSetting('bank', migrated);
    return migrated;
  }
  return c;
}
const saveBank = (patch) => setSetting('bank', { ...bankConfig(), ...patch });
export const bankState = (id) => bankConfig().banks?.[id] || {};
const saveBankState = (id, patch) => {
  const c = bankConfig();
  setSetting('bank', { ...c, banks: { ...(c.banks || {}), [id]: { ...(c.banks?.[id] || {}), ...patch } } });
};

/** Hay servidor configurado (URL + token). */
export const bankReady = () => Boolean(bankConfig().url && bankConfig().token);
/** Ese banco (o alguno, sin id) está conectado. */
export const bankConnected = (id) => bankReady() && (id ? Boolean(bankState(id).since) : BANKS.some((b) => bankState(b.id).since));
export const connectedBanks = () => BANKS.filter((b) => bankConnected(b.id)).map((b) => b.id);

export const bankExpired = (id) => {
  const s = bankState(id);
  return DEAD.includes(s.status) || Boolean(s.validUntil && Date.parse(s.validUntil) < Date.now());
};
/** Hay que volver a autorizar (caducado, revocado o a punto de caducar). */
export function needsReconnect(id) {
  if (!bankConnected(id)) return false;
  const s = bankState(id);
  return bankExpired(id) || (Boolean(s.validUntil) && Date.parse(s.validUntil) - Date.now() < RECONNECT_WARN);
}
export const reconnectList = () => connectedBanks().filter(needsReconnect);

/** "hace 5 min", "hace 3 h", "hace 2 días". Sin id: la sincronización más antigua. */
export function syncAgo(id) {
  const times = (id ? [id] : connectedBanks()).map((b) => Date.parse(bankState(b).lastSync || '') || 0);
  const at = times.length ? Math.min(...times) : 0;
  if (!at) return 'sin sincronizar';
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

/* ---------- Llamadas al Worker ------------------------------------------- */

async function api(path, { method = 'GET', body, online = false, config = bankConfig(), bank } = {}) {
  let res;
  try {
    res = await fetch(String(config.url).replace(/\/+$/, '') + path, {
      method,
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', ...(online ? { 'X-Psu-Online': '1' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor del banco.');
  }
  const data = await res.json().catch(() => ({}));
  if (data.error === 'token') throw new Error('El token del servidor no es correcto.');
  if (data.error === 'expired') {
    if (bank) saveBankState(bank, { status: 'EXPIRED' });
    throw new Error(`La conexión con ${bankName(bank || 'abanca')} ha caducado. Pulsa "Reconectar".`);
  }
  if (data.error === 'rate_limit') throw new Error(`${bankName(bank || 'abanca')} no deja consultar más por ahora. Prueba dentro de unas horas.`);
  if (!res.ok || data.ok === false) throw new Error(data.message || `El servidor respondió ${res.status}.`);
  return data;
}

/** Prueba el servidor con unos datos (antes de guardarlos). */
export const testBankServer = (config) => api('/status?bank=abanca', { config });

/** Lleva al banco para autorizar (o reautorizar). Vuelve a #/ajustes?banco=ok&b=id. */
export async function startConnect(id = 'abanca') {
  const { url } = await api('/connect', { method: 'POST', body: { bank: id }, bank: id });
  location.href = url;
}

/** Actualiza estado, caducidad y cuentas de un banco. */
export async function refreshStatus(id = 'abanca') {
  const s = await api(`/status?bank=${id}`, { bank: id });
  const patch = { status: s.status, validUntil: s.validUntil || null, accounts: s.accounts || [] };
  if (!bankState(id).iban && s.accounts?.length) patch.iban = s.accounts[0].iban;
  saveBankState(id, patch);
  return s;
}

export async function disconnectBank(id) {
  await api('/disconnect', { method: 'POST', body: { bank: id }, bank: id }).catch(() => {});
  const accountId = bankState(id).accountId;
  const c = bankConfig();
  const { [id]: _, ...others } = c.banks || {};
  setSetting('bank', { ...c, banks: others });
  if (accountId) updateAccount(accountId, { bank: undefined });
}

/**
 * Vuelta del banco tras autorizar (#/ajustes?banco=ok&b=id o ?banco=error&msg=…).
 * Devuelve un texto para mostrar, o null si no venía de ahí.
 */
export async function handleBankReturn() {
  const [route, query] = location.hash.replace(/^#\/?/, '').split('?');
  if (!query || !/(^|&)banco=/.test(query)) return null;
  const params = new URLSearchParams(query);
  const id = BANKS.some((b) => b.id === params.get('b')) ? params.get('b') : 'abanca';
  history.replaceState(null, '', `${location.pathname}#/${route || 'ajustes'}`);
  if (params.get('banco') !== 'ok') throw new Error(params.get('msg') || `No se pudo conectar con ${bankName(id)}.`);
  // Primera conexión: se importa desde ahora. Al reconectar se sigue desde la última sincronización.
  if (!bankState(id).since) saveBankState(id, { since: new Date().toISOString() });
  saveBankState(id, { status: 'AUTHORIZED' });
  ensureBankAccount(id);
  await refreshStatus(id);
  const n = await syncBank({ online: true, bank: id });
  return n ? `${bankName(id)} conectada · ${n} movimiento${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'}` : `${bankName(id)} conectada`;
}

/** La cuenta de la app que es la de ese banco: la elegida, una que se llame igual o una nueva. */
function ensureBankAccount(id) {
  const { accounts } = getState();
  const taken = new Set(BANKS.filter((b) => b.id !== id).map((b) => bankState(b.id).accountId));
  if (accounts.some((a) => a.id === bankState(id).accountId)) return;
  const match = BANKS.find((b) => b.id === id).match;
  let acc = accounts.find((a) => a.kind === 'liquidez' && match.test(a.name) && !taken.has(a.id))
    || accounts.find((a) => a.kind !== 'deuda' && match.test(a.name) && !taken.has(a.id));
  if (acc && acc.kind !== 'liquidez') updateAccount(acc.id, { kind: 'liquidez' }); // el dinero del banco es liquidez
  if (!acc) {
    addAccount({ kind: 'liquidez', name: bankName(id), balance: 0 });
    acc = getState().accounts.at(-1);
  }
  saveBankState(id, { accountId: acc.id });
}

/* ---------- Sincronización ------------------------------------------------- */

let busy = false;

/** Sincroniza los bancos a los que les toca (al abrir la app). Silencioso si falla. */
export async function autoSyncBank() {
  if (busy || navigator.onLine === false) return 0;
  let total = 0;
  for (const id of connectedBanks()) {
    const s = bankState(id);
    if (bankExpired(id)) continue;
    const last = Date.parse(s.lastSync || '') || 0;
    const tried = Date.parse(s.lastAutoTry || '') || 0;
    if (Date.now() - last < AUTO_EVERY || Date.now() - tried < 3600 * 1000) continue;
    saveBankState(id, { lastAutoTry: new Date().toISOString() });
    try { total += await syncBank({ bank: id }); } catch { /* se reintenta más tarde */ }
  }
  return total;
}

/**
 * Trae saldo y movimientos de un banco (o de todos, sin bank).
 * online: lo pide el usuario (no gasta el límite diario del banco). Devuelve cuántos hay nuevos.
 */
export async function syncBank({ online = false, bank } = {}) {
  if (!bank) {
    let total = 0;
    const errors = [];
    for (const id of connectedBanks()) {
      try { total += await syncBank({ online, bank: id }); } catch (err) { errors.push(err.message); }
    }
    if (errors.length && !total) throw new Error(errors.join('\n'));
    return total;
  }
  if (!bankConnected(bank) || busy) return 0;
  busy = true;
  try {
    ensureBankAccount(bank);
    const s = bankState(bank);
    const sinceDay = s.since.slice(0, 10);
    const lastDay = s.lastSync ? todayISO(new Date(Date.parse(s.lastSync) - 5 * 86400000)) : sinceDay;
    const dateFrom = lastDay > sinceDay ? lastDay : sinceDay;
    const data = await api('/sync', { method: 'POST', body: { bank, dateFrom, iban: s.iban || undefined }, online, bank });
    const acc = data.accounts.find((a) => !s.iban || a.iban === s.iban) || data.accounts[0];
    if (!acc) return 0;
    if (!s.iban && acc.iban) saveBankState(bank, { iban: acc.iban });

    const account = getState().accounts.find((a) => a.id === bankState(bank).accountId);
    if (account && acc.balance && Number.isFinite(acc.balance.amount)) {
      updateAccount(account.id, {
        balance: round2(acc.balance.amount),
        syncedAt: new Date().toISOString(),
        updatedAt: todayISO(),
        bank: { id: bank, since: s.since, iban: acc.iban },
      });
    }
    const n = importTransactions(bank, acc.transactions || []);
    saveBankState(bank, { lastSync: new Date().toISOString(), status: 'AUTHORIZED' });
    return n;
  } finally {
    busy = false;
  }
}

const norm = (s) => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const normIban = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase();
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/** Texto corto para el concepto: la contraparte o, si no hay, lo que pone el banco. */
function label(b) {
  const text = (b.counterparty || b.description || '').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** IBAN → cuenta de la app, de todas tus cuentas conocidas (bancos conectados + MyInvestor manual). */
function ownIbans() {
  const c = bankConfig();
  const map = new Map();
  for (const id of connectedBanks()) {
    const s = bankState(id);
    for (const a of s.accounts || []) if (a.iban && s.accountId) map.set(normIban(a.iban), s.accountId);
    if (s.iban && s.accountId) map.set(normIban(s.iban), s.accountId);
  }
  if (c.myInvestorIban && c.myInvestorId && !map.has(normIban(c.myInvestorIban))) map.set(normIban(c.myInvestorIban), c.myInvestorId);
  return map;
}

/** La cuenta de MyInvestor en la app (conectada o elegida a mano). */
export const myInvestorAccount = () => bankState('myinvestor').accountId || bankConfig().myInvestorId || '';

/** Categoría por tus reglas ("el concepto contiene X → categoría"). */
export function ruleCategory(text, type) {
  const hay = norm(text);
  const valid = new Set(getState().categories.filter((c) => c.kind === type).map((c) => c.id));
  const rule = (bankConfig().rules || []).find((r) => r.match && valid.has(r.category) && hay.includes(norm(r.match)));
  return rule?.category || '';
}

/** Al revisar un movimiento del banco, aprende su categoría para los siguientes. */
export function learnRule(t, category) {
  if (t.source !== 'banco' || !category || t.type === 'transfer') return;
  const text = `${t.bank?.counterparty || ''} ${t.bank?.text || ''}`;
  if (ruleCategory(text, t.type) === category) return;
  const match = (t.bank?.counterparty || t.description || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!match) return;
  const rules = (bankConfig().rules || []).filter((r) => norm(r.match) !== norm(match));
  saveBank({ rules: [...rules, { match, category }] });
}

/** Un movimiento apuntado en la app que es el mismo que este del banco. */
function findMatch(b, type, accountId) {
  let best = null;
  for (const t of getState().transactions) {
    if (t.bank || t.paidBy || t.type !== type) continue;
    if (t.account && t.account !== accountId) continue;
    if (Math.abs(t.amount - b.amount) > 0.01) continue;
    const d = days(t.date, b.date);
    if (d > MATCH_DAYS) continue;
    if (!best || d < best.d) best = { t, d };
  }
  return best?.t || null;
}

/** El mismo traspaso visto desde la otra cuenta (ya importado del otro banco o marcado a mano). */
function findTransferPair(b, accountId, counterId) {
  let best = null;
  for (const t of getState().transactions) {
    if (t.type !== 'transfer' || t.bankPair) continue;
    const mirror = t.account === counterId && t.counterAccount === accountId;
    if (!mirror || Math.abs(t.amount - b.amount) > 0.01) continue;
    // Si sale de una, entra en la otra.
    if ((t.dir === 'out') !== (b.dir === 'in')) continue;
    const d = days(t.date, b.date);
    if (d > MATCH_DAYS) continue;
    if (!best || d < best.d) best = { t, d };
  }
  return best?.t || null;
}

function importTransactions(bankId, list) {
  const c = bankConfig();
  const s = bankState(bankId);
  const state = getState();
  const accountId = s.accountId || '';
  const ibans = ownIbans();
  const seen = new Set(s.seen || []);
  const known = new Set(state.transactions.flatMap((t) => [t.bank?.key, t.bankPair].filter(Boolean)));
  const now = new Date().toISOString();
  const name = (id) => state.accounts.find((x) => x.id === id)?.name || 'tu otra cuenta';
  let added = 0;

  for (const b of [...list].sort((x, y) => x.date.localeCompare(y.date))) {
    const key = `${bankId}:${b.key}`;
    if (seen.has(key) || known.has(key) || (bankId === 'abanca' && (known.has(b.key) || seen.has(b.key)))) { seen.add(key); continue; }
    seen.add(key);
    const bank = { key, counterparty: b.counterparty || '', iban: b.counterIban || '', text: b.description || '' };
    const text = `${b.counterparty} ${b.description}`;

    // 1) Traspaso entre tus cuentas (la otra parte es un IBAN tuyo).
    const counterId = ibans.get(normIban(b.counterIban));
    if (counterId && counterId !== accountId) {
      const pair = findTransferPair(b, accountId, counterId);
      if (pair) { pair.bankPair = key; added++; continue; }  // el otro banco ya lo trajo
      addRawTransaction({
        type: 'transfer', dir: b.dir, amount: b.amount,
        description: `Traspaso ${b.dir === 'in' ? 'desde' : 'a'} ${name(counterId)}`,
        category: '', date: b.date, account: accountId, counterAccount: counterId,
        bank, source: 'banco', revisado: true, receivedAt: now,
      });
      added++;
      continue;
    }

    const type = b.dir === 'in' ? 'income' : 'expense';

    // 2) Ya estaba apuntado (Apple Pay, buzón, a mano, recurrente): se fusiona y conserva tus datos.
    const match = findMatch(b, type, accountId);
    if (match) {
      match.bank = bank;
      if (accountId) match.account = accountId;
      added++;
      continue;
    }

    // 3) Nuevo: pendiente de revisar, con la categoría que digan tus reglas.
    const desc = label(b);
    const mi = myInvestorAccount();
    addRawTransaction({
      type, amount: b.amount, description: desc,
      category: ruleCategory(text, type) || suggestCategory(desc, type) || '',
      date: b.date, account: accountId, bank, source: 'banco', revisado: false, receivedAt: now,
      ...(mi && mi !== accountId && TRANSFER_WORDS.test(text) ? { transferHint: true } : {}),
    });
    added++;
  }

  persist();
  saveBankState(bankId, { seen: [...seen].slice(-3000) });
  return added;
}

/** Convierte un movimiento (sugerido) en traspaso con MyInvestor. */
export function makeTransfer(t) {
  const mi = myInvestorAccount();
  if (!mi) throw new Error('Elige primero tu cuenta de MyInvestor en Ajustes → Banco.');
  Object.assign(t, {
    type: 'transfer', dir: t.type === 'income' ? 'in' : 'out', counterAccount: mi,
    category: '', revisado: true,
  });
  delete t.transferHint;
  persist();
}
