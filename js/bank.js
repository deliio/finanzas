// Conexión con el banco (ABANCA vía Enable Banking) a través de tu propio Worker.
// - El Worker guarda la clave privada; la app solo conoce su URL y un token (Ajustes → Banco).
// - Sincroniza el saldo y los movimientos confirmados desde el día en que conectaste.
// - No duplica: cada movimiento del banco tiene una clave y, si ya lo tenías apuntado
//   (Apple Pay, buzón, a mano, recurrente), se fusiona con ese.
// - Traspasos con MyInvestor: por IBAN se aplican solos; si solo lo dice el texto, van a Revisar.
// - Todo lo nuevo entra pendiente de revisar.

import { getState, setSetting, addRawTransaction, addAccount, updateAccount, suggestCategory, persist, todayISO, round2 } from './store.js';

const AUTO_EVERY = 6 * 3600 * 1000;   // como mucho cada 6 h al abrir la app (límite de consultas del banco)
const MATCH_DAYS = 3;                 // margen entre el pago con Apple Pay y la fecha del banco
const RECONNECT_WARN = 7 * 86400000;  // avisar 7 días antes de que caduque el permiso
const TRANSFER_WORDS = /MYINVESTOR|ANDBANK/i;

export const bankConfig = () => getState().settings.bank || {};
const saveBank = (patch) => setSetting('bank', { ...bankConfig(), ...patch });

/** Hay servidor configurado (URL + token). */
export const bankReady = () => Boolean(bankConfig().url && bankConfig().token);
/** Hay una conexión con el banco hecha alguna vez. */
export const bankConnected = () => bankReady() && Boolean(bankConfig().since);

/** Hay que volver a autorizar (caducado, revocado o a punto de caducar). */
export function needsReconnect() {
  const c = bankConfig();
  if (!bankConnected()) return false;
  if (['EXPIRED', 'REVOKED', 'CLOSED', 'CANCELLED', 'INVALID'].includes(c.status)) return true;
  return Boolean(c.validUntil) && Date.parse(c.validUntil) - Date.now() < RECONNECT_WARN;
}
export const bankExpired = () => {
  const c = bankConfig();
  return ['EXPIRED', 'REVOKED', 'CLOSED', 'CANCELLED', 'INVALID'].includes(c.status) || (c.validUntil && Date.parse(c.validUntil) < Date.now());
};

/** "hace 5 min", "hace 3 h", "hace 2 días". */
export function syncAgo() {
  const at = Date.parse(bankConfig().lastSync || '');
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

async function api(path, { method = 'GET', body, online = false, config = bankConfig() } = {}) {
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
    saveBank({ status: 'EXPIRED' });
    throw new Error('La conexión con Abanca ha caducado. Pulsa "Reconectar Abanca".');
  }
  if (data.error === 'rate_limit') throw new Error('Abanca no deja consultar más por ahora. Prueba dentro de unas horas.');
  if (!res.ok || data.ok === false) throw new Error(data.message || `El servidor respondió ${res.status}.`);
  return data;
}

/** Prueba el servidor con unos datos (antes de guardarlos). */
export async function testBankServer(config) {
  return api('/status', { config });
}

/** Lleva al banco para autorizar (o reautorizar). Vuelve a #/ajustes?banco=ok|error. */
export async function startConnect() {
  const { url } = await api('/connect', { method: 'POST' });
  location.href = url;
}

/** Actualiza estado, caducidad y cuentas. */
export async function refreshStatus() {
  const s = await api('/status');
  const patch = { status: s.status, validUntil: s.validUntil || null, accounts: s.accounts || [] };
  if (!bankConfig().iban && s.accounts?.length) patch.iban = s.accounts[0].iban;
  saveBank(patch);
  return s;
}

export async function disconnectBank() {
  await api('/disconnect', { method: 'POST' }).catch(() => {});
  const { url, token, myInvestorId, myInvestorIban, rules } = bankConfig();
  setSetting('bank', { url, token, myInvestorId, myInvestorIban, rules });
  const acc = getState().accounts.find((a) => a.bank);
  if (acc) updateAccount(acc.id, { bank: undefined });
}

/**
 * Vuelta del banco tras autorizar (#/ajustes?banco=ok o ?banco=error&msg=…).
 * Devuelve un texto para mostrar, o null si no venía de ahí.
 */
export async function handleBankReturn() {
  const [route, query] = location.hash.replace(/^#\/?/, '').split('?');
  if (!query || !/(^|&)banco=/.test(query)) return null;
  const params = new URLSearchParams(query);
  history.replaceState(null, '', `${location.pathname}#/${route || 'ajustes'}`);
  if (params.get('banco') !== 'ok') throw new Error(params.get('msg') || 'No se pudo conectar con Abanca.');
  // Primera conexión: se importa desde ahora. Al reconectar se sigue desde la última sincronización.
  if (!bankConfig().since) saveBank({ since: new Date().toISOString() });
  ensureBankAccount();
  saveBank({ status: 'AUTHORIZED' });
  await refreshStatus();
  const n = await syncBank({ online: true });
  return n ? `Abanca conectada · ${n} movimiento${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'}` : 'Abanca conectada';
}

/** La cuenta de la app que es la del banco: la elegida, una que se llame "Abanca" o una nueva. */
function ensureBankAccount() {
  const { accounts } = getState();
  if (accounts.some((a) => a.id === bankConfig().accountId)) return;
  let acc = accounts.find((a) => a.kind === 'liquidez' && /abanca/i.test(a.name));
  if (!acc) {
    addAccount({ kind: 'liquidez', name: 'Abanca', balance: 0 });
    acc = getState().accounts.at(-1);
  }
  saveBank({ accountId: acc.id });
}

/* ---------- Sincronización ------------------------------------------------- */

let busy = false;

/** Sincroniza si toca (al abrir la app). Silencioso si falla. */
export async function autoSyncBank() {
  const c = bankConfig();
  if (!bankConnected() || bankExpired() || busy || navigator.onLine === false) return 0;
  const last = Date.parse(c.lastSync || '') || 0;
  const tried = Date.parse(c.lastAutoTry || '') || 0;
  if (Date.now() - last < AUTO_EVERY || Date.now() - tried < 3600 * 1000) return 0;
  saveBank({ lastAutoTry: new Date().toISOString() });
  try { return await syncBank(); } catch { return 0; }
}

/**
 * Trae saldo y movimientos. online: lo pide el usuario (no gasta el límite diario del banco).
 * Devuelve cuántos movimientos nuevos (o fusionados) hay.
 */
export async function syncBank({ online = false } = {}) {
  if (!bankConnected() || busy) return 0;
  busy = true;
  try {
    const c = bankConfig();
    const sinceDay = c.since.slice(0, 10);
    const lastDay = c.lastSync ? todayISO(new Date(Date.parse(c.lastSync) - 5 * 86400000)) : sinceDay;
    const dateFrom = lastDay > sinceDay ? lastDay : sinceDay;
    const data = await api('/sync', { method: 'POST', body: { dateFrom, iban: c.iban || undefined }, online });
    const acc = data.accounts.find((a) => !c.iban || a.iban === c.iban) || data.accounts[0];
    if (!acc) return 0;

    const account = getState().accounts.find((a) => a.id === c.accountId);
    if (account && acc.balance && Number.isFinite(acc.balance.amount)) {
      updateAccount(account.id, {
        balance: round2(acc.balance.amount),
        syncedAt: new Date().toISOString(),
        updatedAt: todayISO(),
        bank: { since: c.since, iban: acc.iban },
      });
    }
    const n = importTransactions(acc.transactions || []);
    saveBank({ lastSync: new Date().toISOString(), status: 'AUTHORIZED' });
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

function importTransactions(list) {
  const c = bankConfig();
  const state = getState();
  const seen = new Set(c.seen || []);
  const known = new Set(state.transactions.filter((t) => t.bank?.key).map((t) => t.bank.key));
  const now = new Date().toISOString();
  let added = 0;

  for (const b of [...list].sort((x, y) => x.date.localeCompare(y.date))) {
    if (seen.has(b.key) || known.has(b.key)) { seen.add(b.key); continue; }
    seen.add(b.key);
    const bank = { key: b.key, counterparty: b.counterparty || '', iban: b.counterIban || '', text: b.description || '' };
    const text = `${b.counterparty} ${b.description}`;

    // 1) Traspaso con MyInvestor identificado por IBAN: se aplica solo.
    if (c.myInvestorId && c.myInvestorIban && normIban(b.counterIban) === normIban(c.myInvestorIban)) {
      addRawTransaction({
        type: 'transfer', dir: b.dir, amount: b.amount,
        description: `Traspaso ${b.dir === 'in' ? 'desde' : 'a'} ${state.accounts.find((x) => x.id === c.myInvestorId)?.name || 'MyInvestor'}`,
        category: '', date: b.date, account: c.accountId || '', counterAccount: c.myInvestorId,
        bank, source: 'banco', revisado: true, receivedAt: now,
      });
      added++;
      continue;
    }

    const type = b.dir === 'in' ? 'income' : 'expense';

    // 2) Ya estaba apuntado (Apple Pay, buzón, a mano, recurrente): se fusiona y conserva tus datos.
    const match = findMatch(b, type, c.accountId);
    if (match) {
      match.bank = bank;
      if (c.accountId) match.account = c.accountId;
      added++;
      continue;
    }

    // 3) Nuevo: pendiente de revisar, con la categoría que digan tus reglas.
    const desc = label(b);
    addRawTransaction({
      type, amount: b.amount, description: desc,
      category: ruleCategory(text, type) || suggestCategory(desc, type) || '',
      date: b.date, account: c.accountId || '', bank, source: 'banco', revisado: false, receivedAt: now,
      ...(c.myInvestorId && TRANSFER_WORDS.test(text) ? { transferHint: true } : {}),
    });
    added++;
  }

  persist();
  saveBank({ seen: [...seen].slice(-3000) });
  return added;
}

/** Convierte un movimiento (sugerido) en traspaso con MyInvestor. */
export function makeTransfer(t) {
  const c = bankConfig();
  if (!c.myInvestorId) throw new Error('Elige primero tu cuenta de MyInvestor en Ajustes → Banco.');
  Object.assign(t, {
    type: 'transfer', dir: t.type === 'income' ? 'in' : 'out', counterAccount: c.myInvestorId,
    category: '', revisado: true,
  });
  delete t.transferHint;
  persist();
}
