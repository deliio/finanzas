// "ETF Espejo": estima el valor de fondos indexados europeos (sin cotización
// en tiempo real) a partir de un ETF estadounidense que replica el mismo índice.
//
// Cómo funciona:
//   1. Al dar de alta un fondo (o al recalibrar), guardamos una REFERENCIA:
//      valor real del fondo en € + precio del ETF en $ + tipo EUR/USD en ese momento.
//   2. Valor estimado = valorRef × (precioETF / precioRef) × (eurusdRef / eurusd)
//      El segundo factor corrige el tipo de cambio (el ETF cotiza en $, tu fondo en €).
//   3. Cuando veas el valor real en tu banco/broker, "Actualizar valor real"
//      recalibra la referencia y elimina el error acumulado (tracking error, comisiones…).

import { getState, setMarketData } from './store.js';

const FINNHUB_QUOTE = 'https://finnhub.io/api/v1/quote';
const FX_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD'; // BCE, gratis, sin clave
const QUOTE_TTL = 60 * 1000;          // no repetir consulta del mismo ticker en < 1 min
const FX_TTL = 6 * 60 * 60 * 1000;    // el BCE publica una vez al día

export const MIRROR_PRESETS = [
  { ticker: 'VOO', label: 'S&P 500' },
  { ticker: 'QQQ', label: 'NASDAQ-100' },
  { ticker: 'EEM', label: 'Mercados emergentes' },
];

export const hasApiKey = () => Boolean(getState().settings.finnhubKey);

/** Cotización de un ticker en Finnhub. Lanza Error con mensaje legible. */
export async function fetchQuote(ticker, key = getState().settings.finnhubKey) {
  if (!key) throw new Error('Falta la clave de Finnhub (Ajustes).');
  let res;
  try {
    res = await fetch(`${FINNHUB_QUOTE}?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(key)}`);
  } catch {
    throw new Error('Sin conexión con Finnhub.');
  }
  if (res.status === 401 || res.status === 403) throw new Error('Clave de Finnhub no válida.');
  if (res.status === 429) throw new Error('Límite de Finnhub alcanzado, espera un minuto.');
  if (!res.ok) throw new Error(`Finnhub respondió ${res.status}.`);

  const q = await res.json(); // { c: actual, pc: cierre anterior, dp: % día, t: timestamp }
  if (!q || !q.c) throw new Error(`No hay cotización para ${ticker}.`);
  return { price: q.c, prevClose: q.pc, changePct: q.dp, time: q.t * 1000, fetchedAt: Date.now() };
}

/** Dólares por 1 €. */
export async function fetchEurUsd() {
  const res = await fetch(FX_URL);
  if (!res.ok) throw new Error('No se pudo obtener el tipo EUR/USD.');
  const data = await res.json();
  return { rate: data.rates.USD, date: data.date, fetchedAt: Date.now() };
}

/**
 * Tipo de cambio para gastos en otra divisa (multidivisa).
 * Devuelve cuántos € vale 1 unidad de `from` en la fecha indicada (o la última publicada).
 */
const rateCache = new Map();
export async function fetchRateToEur(from, date) {
  if (from === 'EUR') return { rate: 1, date };
  const today = new Date().toISOString().slice(0, 10);
  const when = !date || date >= today ? 'latest' : date;
  const key = `${from}:${when}`;
  if (rateCache.has(key)) return rateCache.get(key);
  let res;
  try {
    res = await fetch(`https://api.frankfurter.dev/v1/${when}?base=${from}&symbols=EUR`);
  } catch {
    throw new Error('Sin conexión para consultar el tipo de cambio.');
  }
  if (!res.ok) throw new Error('No se pudo obtener el tipo de cambio.');
  const data = await res.json();
  const out = { rate: data.rates.EUR, date: data.date };
  rateCache.set(key, out);
  return out;
}

/**
 * Refresca las cotizaciones de todos los tickers usados (respetando la caché).
 * Devuelve la lista de errores (vacía si todo fue bien).
 */
export async function refreshMarket({ force = false } = {}) {
  const { holdings, quotes = {}, fx } = getState();
  const errors = [];
  const now = Date.now();
  const tickers = [...new Set(holdings.map((h) => h.ticker))]
    .filter((t) => force || !quotes[t] || now - quotes[t].fetchedAt > QUOTE_TTL);

  const newQuotes = {};
  await Promise.all(tickers.map(async (t) => {
    try { newQuotes[t] = await fetchQuote(t); } catch (err) { errors.push(err.message); }
  }));

  let newFx = null;
  if (holdings.length && (force || !fx || now - fx.fetchedAt > FX_TTL)) {
    try { newFx = await fetchEurUsd(); } catch (err) { errors.push(err.message); }
  }

  if (Object.keys(newQuotes).length || newFx) setMarketData(newQuotes, newFx);
  return [...new Set(errors)];
}

/** Valor estimado de una posición con la última cotización conocida. */
export function estimateHolding(h, quote, fx) {
  if (!quote || !h.refPrice) {
    return { value: h.refValue, gain: h.refValue - h.invested, gainPct: pct(h.refValue, h.invested), dayChange: 0, stale: true };
  }
  const fxFactor = h.refFx && fx?.rate ? h.refFx / fx.rate : 1;
  const value = h.refValue * (quote.price / h.refPrice) * fxFactor;
  const dayChange = quote.prevClose ? value * (1 - quote.prevClose / quote.price) : 0;
  return { value, gain: value - h.invested, gainPct: pct(value, h.invested), dayChange, stale: false };
}

/** Totales de la cartera espejo. */
export function portfolioSummary() {
  const { holdings, quotes = {}, fx } = getState();
  return holdings.reduce((acc, h) => {
    const e = estimateHolding(h, quotes[h.ticker], fx);
    acc.value += e.value; acc.invested += h.invested; acc.dayChange += e.dayChange;
    return acc;
  }, { value: 0, invested: 0, dayChange: 0 });
}

const pct = (value, base) => (base ? (value / base - 1) * 100 : 0);
