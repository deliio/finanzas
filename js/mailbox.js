// Buzón automático en Google (opcional): el Atajo de iOS envía cada pago a una hoja de
// Google (Apps Script) sin abrir la app, y la app los recoge al abrirse y los deja
// pendientes de revisar. Un mismo buzón sirve para varias personas (campo "usuario").
//
// API del buzón (Apps Script desplegado como aplicación web):
//   GET ?action=pull&token=…&user=…      → { ok, items: [{ id, at, user, type, amount, merchant, lat, lon, card }] }
//   GET ?action=ack&token=…&ids=a,b,c    → borra esos pagos del buzón
//   POST { token, user, type, amount, merchant, lat, lon, card }  (lo usa el Atajo; card = tarjeta de Wallet)

import { getState, setSetting, addTransaction, suggestCategory, validLocation, round2, todayISO, accountForWalletCard } from './store.js';
import { parseAmount } from './ui.js';
import { fetchRateToEur } from './market.js';
import { BASE } from './i18n.js';

export const mailboxConfig = () => getState().settings.mailbox || {};
export const mailboxReady = () => Boolean(mailboxConfig().url && mailboxConfig().token);

/** Código secreto aleatorio para un buzón nuevo. */
export const newToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);

async function call(params, config = mailboxConfig()) {
  const url = new URL(config.url);
  Object.entries({ token: config.token, ...params }).forEach(([k, v]) => url.searchParams.set(k, v));
  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch {
    throw new Error('No se pudo conectar con el buzón.');
  }
  if (!res.ok) throw new Error(`El buzón respondió ${res.status}.`);
  let data;
  try { data = await res.json(); } catch { throw new Error('La dirección no parece un buzón (¿URL correcta y desplegada como "Cualquier usuario"?).'); }
  if (!data.ok) throw new Error(data.error === 'token' ? 'El código secreto no coincide con el del script.' : 'Error en el buzón.');
  return data;
}

/** "Papi", " papi " y "PAPÍ" son el mismo usuario (mayúsculas, tildes y espacios no importan). */
export const sameUser = (a, b) => {
  const n = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  return n(a) === n(b);
};

/**
 * Pide todos los pagos y se queda con los de este usuario comparando de forma tolerante
 * (el filtro del script es exacto). Sin nombre solo recoge los pagos enviados sin nombre.
 */
async function pullMine(config) {
  const { items = [] } = await call({ action: 'pull', user: '' }, config);
  // El script guarda los textos con ' delante para que Google no los convierta; por si acaso se lo quitamos.
  const clean = (it) => Object.fromEntries(Object.entries(it).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/^'/, '') : v]));
  return items.map(clean).filter((it) => sameUser(it.user, config.user));
}

/** Comprueba la conexión sin importar nada. Devuelve cuántos pagos esperan. */
export async function testMailbox(config) {
  return (await pullMine(config)).length;
}

export const coord = (s) => Number(String(s ?? '').trim().replace(',', '.').replace(/[^\d.-]/g, ''));
const currencyOf = (raw = '') => (/£|GBP/i.test(raw) ? 'GBP' : /\$|USD/i.test(raw) ? 'USD' : /€|EUR/i.test(raw) ? 'EUR' : BASE);

let busy = false;

/**
 * Recoge los pagos del buzón, los guarda como pendientes de revisar y los borra del buzón.
 * Nunca duplica: recuerda los últimos ids importados por si el borrado falla.
 * Devuelve cuántos movimientos ha añadido.
 */
export async function pullMailbox() {
  if (!mailboxReady() || busy || navigator.onLine === false) return 0;
  busy = true;
  try {
    const items = await pullMine(mailboxConfig());
    if (!items.length) return 0;
    // Guardamos lo último que llegó tal cual, para poder ver en Ajustes si traía ubicación.
    const log = items.map((i) => ({ at: i.at, type: i.type, amount: i.amount, merchant: i.merchant, lat: i.lat, lon: i.lon, card: i.card }));
    setSetting('mailboxLog', [...log, ...(getState().settings.mailboxLog || [])].slice(0, 8));

    const seen = new Set(getState().settings.mailboxSeen || []);
    const liquid = getState().accounts.filter((a) => a.kind === 'liquidez' || a.kind === 'tarjeta').map((a) => a.id);
    const last = getState().settings.lastAccount;
    let added = 0;

    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      const original = parseAmount(it.amount);
      if (!(original > 0)) continue;
      const type = /^(income|ingreso)$/i.test(String(it.type || '').trim()) ? 'income' : 'expense';
      const currency = currencyOf(String(it.amount));
      const date = it.at ? todayISO(new Date(it.at)) : todayISO();
      let rate = 1;
      if (currency !== BASE) {
        try { ({ rate } = await fetchRateToEur(currency, date)); } catch { /* sin cambio: se revisará el importe */ }
      }
      const merchant = String(it.merchant || '').trim();
      const card = String(it.card || '').trim();
      // Cuenta: la de la tarjeta con la que se pagó (si se reconoce) o la última usada.
      const account = accountForWalletCard(card) || (liquid.includes(last) ? last : '');
      addTransaction({
        type, amount: round2(Math.abs(original) * rate), description: merchant,
        category: suggestCategory(merchant, type), date,
        account, walletCard: card,
        currency, originalAmount: Math.abs(original), fxRate: rate,
        location: validLocation({ lat: coord(it.lat), lon: coord(it.lon) }),
        needsReview: true, forceReview: true, source: 'buzon', receivedAt: it.at,
      }, { silent: true });
      added++;
    }
    // Guarda todo de una vez y recuerda los ids (los 300 últimos bastan).
    setSetting('mailboxSeen', [...seen].slice(-300));
    await call({ action: 'ack', ids: items.map((i) => i.id).join(',') }).catch(() => {});
    return added;
  } finally {
    busy = false;
  }
}

/** Cómo llegó la ubicación de un pago del buzón: { ok, text }. */
export function locationStatus(l) {
  const raw = [l.lat, l.lon].map((v) => String(v ?? '').trim());
  if (!raw[0] && !raw[1]) return { ok: false, text: 'Sin ubicación' };
  const loc = validLocation({ lat: coord(raw[0]), lon: coord(raw[1]) });
  return loc ? { ok: true, text: `📍 ${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}` } : { ok: false, text: `⚠️ ${raw.join(' / ')}` };
}

/** Script para pegar en Google Apps Script (con el código secreto ya puesto). */
export function mailboxScript(token) {
  return `// Buzón de Finanzas · pega esto en Extensiones → Apps Script de una hoja de Google
const TOKEN = '${token}';
const HOJA = 'Buzon';

function hoja_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(HOJA);
  if (!sh) {
    sh = ss.insertSheet(HOJA);
    sh.getRange('A:I').setNumberFormat('@'); // todo como texto (importes "23,40 €" tal cual)
    sh.appendRow(['id', 'fecha', 'usuario', 'tipo', 'importe', 'comercio', 'lat', 'lon', 'tarjeta']);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Con ' delante Google lo guarda como texto tal cual (si no, en una hoja en español
// "42.2406" se convierte en 422406 y se pierde la ubicación).
function texto_(v) { return "'" + String(v == null ? '' : v); }

function guardar_(d) {
  if (String(d.token) !== TOKEN) return json_({ ok: false, error: 'token' });
  const id = Utilities.getUuid();
  hoja_().appendRow([id, new Date().toISOString(), texto_(d.user), texto_(d.type || 'expense'),
    texto_(d.amount), texto_(d.merchant), texto_(d.lat), texto_(d.lon), texto_(d.card)]);
  return json_({ ok: true, id: id });
}

// El Atajo envía los pagos aquí (POST con cuerpo JSON).
function doPost(e) {
  let d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) { d = e.parameter || {}; }
  return guardar_(d);
}

// La app recoge (pull) y borra (ack) los pagos.
function doGet(e) {
  const p = e.parameter || {};
  if (p.action === 'add') return guardar_(p);
  if (String(p.token) !== TOKEN) return json_({ ok: false, error: 'token' });
  const sh = hoja_();
  const filas = sh.getDataRange().getValues();
  if (p.action === 'ack') {
    const ids = String(p.ids || '').split(',');
    for (let i = filas.length; i >= 2; i--) if (ids.indexOf(String(filas[i - 1][0])) >= 0) sh.deleteRow(i);
    return json_({ ok: true });
  }
  const items = filas.slice(1)
    .filter(function (r) { return r[0] && (!p.user || String(r[2]) === String(p.user)); })
    .map(function (r) { return { id: r[0], at: r[1], user: String(r[2]), type: String(r[3]), amount: String(r[4]), merchant: String(r[5]), lat: String(r[6]), lon: String(r[7]), card: String(r[8] || '') }; });
  return json_({ ok: true, items: items });
}
`;
}
