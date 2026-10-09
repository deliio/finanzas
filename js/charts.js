// Gráficas SVG ligeras (sin dependencias, funcionan sin conexión).
// Devuelven strings HTML/SVG para insertar con innerHTML.

import { money, esc } from './ui.js';
import { getState, categoryById } from './store.js';

// Paleta: blanco + acentos iOS. El orden se mantiene estable entre gráficas.
export const PALETTE = ['#ffffff', '#32d74b', '#0a84ff', '#ff9f0a', '#bf5af2', '#ff375f', '#64d2ff', '#ffd60a', '#8e8e93', '#5e5ce6'];
const OTHERS_COLOR = '#636366';

/** Color fijo por categoría: la misma categoría tiene el mismo color en todas las gráficas. */
export function categoryColor(id) {
  const ids = getState().categories.filter((c) => c.kind === 'expense').map((c) => c.id);
  const i = ids.indexOf(id);
  return PALETTE[(i < 0 ? ids.length : i) % PALETTE.length];
}

/** Agrupa gastos por categoría real → segmentos ordenados (top n + "Otras"). */
function segmentsOf(expenses, top = 4) {
  const sums = {};
  expenses.forEach((t) => (sums[t.category] = (sums[t.category] || 0) + t.amount));
  const ranked = Object.entries(sums).sort((a, b) => b[1] - a[1]);
  const segs = ranked.slice(0, top).map(([id, value]) => ({ label: categoryById(id).name, value, color: categoryColor(id) }));
  const rest = ranked.slice(top).reduce((s, [, v]) => s + v, 0);
  if (rest) segs.push({ label: 'Otras', value: rest, color: OTHERS_COLOR });
  return segs;
}

const legend = (segs) => `<div class="donut-legend">${segs.map((s) => `
  <div class="legend-row"><i class="dot" style="background:${s.color}"></i>
    <span class="legend-name">${esc(s.label)}</span><span class="num">${money(s.value, { decimals: false })}</span></div>`).join('')}
</div>`;

/**
 * Gasto por categoría: tus gastos y, si los hay, al lado lo que ha pagado papi.
 * expenses: lista de movimientos de tipo gasto del periodo.
 */
export function spendingDonuts(expenses, { href = '' } = {}) {
  const tag = href ? 'a' : 'section';
  const attrs = href ? ` href="${href}"` : '';
  if (!expenses.length) return '<div class="card empty">Sin gastos en este periodo</div>';

  const own = expenses.filter((t) => !t.papi);
  const papi = expenses.filter((t) => t.papi);

  // Sin gastos de papi: un único gráfico con la leyenda al lado.
  if (!papi.length) {
    const segs = segmentsOf(own, 5);
    return `<${tag} class="card donut-card"${attrs}>
      ${donut(segs, { size: 132, thickness: 16, centerLabel: 'Gastado' })}
      ${legend(segs)}
    </${tag}>`;
  }

  const col = (title, list, center) => {
    const segs = segmentsOf(list, 3);
    return `<div class="donut-col">
      <div class="donut-col-title">${title}</div>
      ${segs.length ? donut(segs, { size: 118, thickness: 14, centerLabel: center }) : `<div class="donut-none muted">Nada este mes</div>`}
      ${legend(segs)}
    </div>`;
  };
  return `<${tag} class="card donut-pair"${attrs}>
    ${col('Tus gastos', own, 'Tú')}
    ${col('Pagado por papi', papi, 'Papi')}
  </${tag}>`;
}

/**
 * Donut con total en el centro.
 * segments: [{ label, value, color }]
 */
export function donut(segments, { size = 168, thickness = 22, centerLabel = 'Total' } = {}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = segments.length > 1 ? 2 : 0; // separación entre porciones (px de arco)
  let offset = 0;
  const arcs = total > 0 ? segments.filter((s) => s.value > 0).map((s) => {
    const len = (s.value / total) * c;
    const arc = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}"
      stroke-width="${thickness}" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${c.toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    offset += len;
    return arc;
  }).join('') : '';

  return `<div class="donut" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--card-2)" stroke-width="${thickness}"/>
      ${arcs}
    </svg>
    <div class="donut-center"><div class="muted">${esc(centerLabel)}</div><div class="num">${money(total, { decimals: false })}</div></div>
  </div>`;
}

/**
 * Línea con área degradada (evolución temporal).
 * points: [{ x: 'YYYY-MM-DD', y: number }] ordenados por fecha.
 */
export function lineChart(points, { height = 140, color = 'var(--text)' } = {}) {
  if (points.length < 2) {
    return `<div class="chart-empty muted">La gráfica aparecerá cuando haya al menos 2 días de histórico.</div>`;
  }
  const w = 320, h = height, padY = 12;
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || Math.abs(max) || 1;
  const t0 = Date.parse(points[0].x), t1 = Date.parse(points.at(-1).x);
  const px = (p) => ((Date.parse(p.x) - t0) / (t1 - t0 || 1)) * w;
  const py = (p) => padY + (1 - (p.y - min) / span) * (h - padY * 2);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${px(p).toFixed(1)},${py(p).toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const up = ys.at(-1) >= ys[0];
  const stroke = color === 'auto' ? (up ? 'var(--green)' : 'var(--red)') : color;
  const id = `g${Math.random().toString(36).slice(2, 8)}`;

  return `<div class="line-chart">
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${stroke}" stop-opacity=".28"/><stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/>
      <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    </svg>
    <div class="line-chart-axis muted"><span>${shortDay(points[0].x)}</span>
      <span class="num">máx ${money(max, { decimals: false })}</span><span>${shortDay(points.at(-1).x)}</span></div>
  </div>`;
}

/**
 * Barras verticales (p. ej. gasto de los últimos meses).
 * bars: [{ label, value, highlight? }]
 */
export function barChart(bars, { height = 110 } = {}) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return `<div class="bar-chart" style="height:${height}px">
    ${bars.map((b) => `<div class="bar-col">
      <div class="bar-val num">${b.value ? money(b.value, { decimals: false }) : ''}</div>
      <div class="bar-fill ${b.highlight ? 'hl' : ''}" style="height:${Math.max(2, (b.value / max) * (height - 40))}px"></div>
      <div class="bar-label">${esc(b.label)}</div>
    </div>`).join('')}
  </div>`;
}

/** Barra de progreso horizontal (huchas, presupuestos). */
export function progress(pct, { color = 'var(--text)' } = {}) {
  const p = Math.max(0, Math.min(1, pct || 0));
  return `<div class="progress"><span style="width:${(p * 100).toFixed(1)}%;background:${color}"></span></div>`;
}

const dayFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const shortDay = (iso) => dayFmt.format(new Date(iso + 'T00:00:00'));
