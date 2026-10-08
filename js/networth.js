// Cálculo centralizado del patrimonio (lo usan Patrimonio, el histórico y las gráficas).

import { getState, accountValue, recordSnapshot } from './store.js';
import { portfolioSummary } from './market.js';

export function computeNetWorth() {
  const { accounts, goals, pending } = getState();
  const sum = (kind) => accounts.filter((a) => a.kind === kind).reduce((s, a) => s + accountValue(a), 0);
  const funds = portfolioSummary();

  const liquidez = sum('liquidez');
  const inversiones = funds.value;
  const activos = sum('activo') + inversiones;
  const deudas = sum('deuda');
  const net = liquidez + activos - deudas;

  const enHuchas = goals.reduce((s, g) => s + g.saved, 0);
  const pendiente = pending.reduce((s, p) => s + p.amount, 0);

  return {
    liquidez, activos, inversiones, deudas, net, funds,
    enHuchas,
    disponible: liquidez - enHuchas, // liquidez no reservada en huchas
    pendiente,
    proyeccion: net + pendiente,     // patrimonio si se cobra todo lo pendiente
  };
}

/** Guarda la foto de hoy en el histórico (una por día; solo si hay algo que guardar). */
export function snapshotNetWorth() {
  const { accounts, holdings } = getState();
  if (!accounts.length && !holdings.length) return;
  const n = computeNetWorth();
  recordSnapshot({ liquidez: n.liquidez, activos: n.activos, inversiones: n.inversiones, deudas: n.deudas, net: n.net });
}
