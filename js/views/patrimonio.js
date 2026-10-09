// Patrimonio neto = liquidez + activos (incl. fondos vía ETF espejo) − deudas.
// Incluye evolución histórica (#10), huchas (#13) y cobros pendientes (#14).

import { getState, addAccount, updateAccount, deleteAccount, accountValue, accountBreakdown, addHolding, updateHolding, deleteHolding, setMarketData, round2, todayISO,
  addGoal, updateGoal, deleteGoal, addPending, deletePending, addTransaction, categoriesOf } from '../store.js';
import { MIRROR_PRESETS, hasApiKey, fetchQuote, fetchEurUsd, refreshMarket, estimateHolding } from '../market.js';
import { computeNetWorth, snapshotNetWorth } from '../networth.js';
import { money, esc, parseAmount, toast, icon, usd, signedPct, signedEur, tone, openSheet, privacyButton, shortDate } from '../ui.js';
import { lineChart, progress } from '../charts.js';

const KINDS = {
  liquidez: { label: 'Liquidez', icon: 'wallet',   color: 'var(--text)' },
  activo:   { label: 'Activos',  icon: 'trending', color: 'var(--text-2)' },
  deuda:    { label: 'Deudas',   icon: 'bank',     color: 'var(--red)' },
};

const RANGES = [
  { id: '1m', label: '1M', days: 31 },
  { id: '3m', label: '3M', days: 92 },
  { id: '1a', label: '1A', days: 366 },
  { id: 'todo', label: 'Todo', days: Infinity },
];
let range = '3m';

const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

export function render(root) {
  let refreshing = false;

  const draw = () => {
    snapshotNetWorth();
    const { accounts, holdings, quotes = {}, fx, goals, pending, history } = getState();
    const total = (k) => accounts.filter((a) => a.kind === k).reduce((s, a) => s + accountValue(a), 0);
    const n = computeNetWorth();
    const funds = n.funds;
    const gross = n.liquidez + n.activos + n.deudas || 1;
    const lastFetch = Math.max(0, ...Object.values(quotes).map((q) => q.fetchedAt));

    // Evolución: filtramos el histórico por rango.
    const days = RANGES.find((r) => r.id === range).days;
    const from = days === Infinity ? '' : todayISO(new Date(Date.now() - days * 86400000));
    const points = history.filter((h) => h.date >= from).map((h) => ({ x: h.date, y: h.net }));
    const change = points.length > 1 ? points.at(-1).y - points[0].y : 0;

    root.innerHTML = `
      <header class="page-header"><h1>Patrimonio</h1><div class="header-actions">${privacyButton()}</div></header>

      <section class="card hero">
        <div class="label">Patrimonio neto</div>
        <div class="amount num">${money(n.net)}</div>
        ${points.length > 1 ? `<div class="hero-change num ${tone(change)}">${signedEur(change)} en ${RANGES.find((r) => r.id === range).label}</div>` : ''}
        <div class="bar">
          <span style="width:${(n.liquidez / gross) * 100}%;background:${KINDS.liquidez.color}"></span>
          <span style="width:${(n.activos / gross) * 100}%;background:${KINDS.activo.color}"></span>
          <span style="width:${(n.deudas / gross) * 100}%;background:var(--red)"></span>
        </div>
        <div class="legend">
          <span><i class="dot" style="background:${KINDS.liquidez.color}"></i>Liquidez <span class="num">${money(n.liquidez, { decimals: false })}</span></span>
          <span><i class="dot" style="background:${KINDS.activo.color}"></i>Activos <span class="num">${money(n.activos, { decimals: false })}</span></span>
          <span><i class="dot" style="background:var(--red)"></i>Deudas <span class="num">${money(n.deudas, { decimals: false })}</span></span>
        </div>
        ${n.enHuchas || n.pendiente ? `<div class="hero-extra">
          ${n.enHuchas ? `<div><span class="muted">Disponible (sin huchas)</span><span class="num">${money(n.disponible)}</span></div>` : ''}
          ${n.pendiente ? `<div><span class="muted">Proyección con cobros pendientes</span><span class="num">${money(n.proyeccion)}</span></div>` : ''}
        </div>` : ''}
      </section>

      <div class="section-title">Evolución
        <div class="range-tabs">${RANGES.map((r) => `<button type="button" data-range="${r.id}" aria-pressed="${r.id === range}">${r.label}</button>`).join('')}</div>
      </div>
      <section class="card">${lineChart(points, { color: 'auto' })}</section>

      <div class="section-title">
        Inversiones
        ${holdings.length && hasApiKey() ? `<button class="link-btn" data-action="refresh" ${refreshing ? 'disabled' : ''}>
          ${refreshing ? 'Actualizando…' : lastFetch ? `Actualizado ${timeFmt.format(lastFetch)}` : 'Actualizar'}</button>` : ''}
      </div>
      ${renderFunds(holdings, quotes, fx, funds)}

      <div class="section-title">Huchas <button class="link-btn" data-action="add-goal">+ Nueva</button></div>
      ${goals.length ? `<div class="list">${goals.map((g) => {
        const p = g.target ? g.saved / g.target : 0;
        return `<button class="row goal-row" data-goal="${esc(g.id)}">
          <span class="icon">${icon('piggy')}</span>
          <span class="main">
            <div class="title">${esc(g.name)}</div>
            <div class="subtitle num">${money(g.saved, { decimals: false })} de ${money(g.target, { decimals: false })} · ${Math.round(p * 100)} %</div>
            ${progress(p, { color: p >= 1 ? 'var(--green)' : 'var(--text)' })}
          </span>
        </button>`;
      }).join('')}</div>`
        : `<div class="card empty" style="padding:18px">Crea una hucha para reservar liquidez para un objetivo (viaje, coche, colchón…).</div>`}

      <div class="section-title">Pendiente de cobro <button class="link-btn" data-action="add-pending">+ Añadir</button></div>
      ${pending.length ? `<div class="list">${pending.map((p) => `
        <button class="row" data-pending="${esc(p.id)}">
          <span class="icon">${icon('clock')}</span>
          <span class="main"><div class="title">${esc(p.name)}</div>
            <div class="subtitle">${p.expectedDate ? `Previsto ${shortDate(p.expectedDate)}` : 'Sin fecha'}</div></span>
          <span class="trail num pos">+${money(p.amount)}</span>
        </button>`).join('')}</div>`
        : `<div class="card empty" style="padding:18px">Becas, devoluciones de Hacienda… Se suman a la proyección, no a tu liquidez.</div>`}

      ${Object.entries(KINDS).map(([kind, k]) => {
        const list = accounts.filter((a) => a.kind === kind);
        return `
          <div class="section-title">${k.label}<span class="num muted" style="font-size:15px">${money(total(kind))}</span></div>
          ${list.length ? `<div class="list">${list.map((a) => {
            const { value, interest, flows } = accountBreakdown(a);
            const parts = [];
            if (kind === 'liquidez' && a.interestRate) parts.push(`${pctPlain(a.interestRate)} · <span class="pos num">+${money(interest)}</span>`);
            if (flows) parts.push(`<span class="num ${tone(flows)}">${signedEur(flows)}</span> movs.`);
            return `
            <button class="row" data-acc="${esc(a.id)}">
              <span class="icon">${icon(k.icon)}</span>
              <span class="main"><div class="title">${esc(a.name)}</div>
                <div class="subtitle">${parts.length ? parts.join(' · ') : `Actualizado ${esc(a.updatedAt)}`}</div></span>
              <span class="trail num ${kind === 'deuda' ? 'neg' : ''}">${kind === 'deuda' ? '−' : ''}${money(value)}</span>
            </button>`;
          }).join('')}</div>`
            : `<div class="card empty" style="padding:18px">Sin ${k.label.toLowerCase()}</div>`}`;
      }).join('')}

      <details class="add-form">
        <summary>+ Añadir cuenta, activo o deuda</summary>
        <form id="acc-form">
          <div class="field-group">
            <div class="field"><label for="acc-kind">Tipo</label>
              <select id="acc-kind">${Object.entries(KINDS).map(([v, k]) => `<option value="${v}">${k.label}</option>`).join('')}</select></div>
            <div class="field"><label for="acc-name">Nombre</label>
              <input id="acc-name" required placeholder="Cuenta nómina, hipoteca…"></div>
            <div class="field"><label for="acc-bal">Saldo</label>
              <input id="acc-bal" inputmode="decimal" required placeholder="0,00 €"></div>
            <div class="field"><label for="acc-rate">Interés</label>
              <input id="acc-rate" inputmode="decimal" placeholder="% anual (opcional)"></div>
          </div>
          <button class="btn btn-primary" type="submit">Añadir</button>
        </form>
      </details>
    `;
  };

  async function refresh(force = false) {
    if (refreshing || !hasApiKey() || !getState().holdings.length) return;
    refreshing = true;
    draw();
    const errors = await refreshMarket({ force });
    refreshing = false;
    if (errors.length) toast(errors[0]);
    if (root.isConnected) draw();
  }

  root.addEventListener('click', (e) => {
    const rangeBtn = e.target.closest('[data-range]');
    if (rangeBtn) { range = rangeBtn.dataset.range; draw(); return; }

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'refresh') return refresh(true);
    if (action === 'add-fund') return openAddFund(draw);
    if (action === 'add-goal') return openGoalForm(null, draw);
    if (action === 'add-pending') return openPendingForm(draw);

    const fund = e.target.closest('[data-fund]');
    if (fund) return openFund(fund.dataset.fund, draw);

    const goal = e.target.closest('[data-goal]');
    if (goal) return openGoal(goal.dataset.goal, draw);

    const pend = e.target.closest('[data-pending]');
    if (pend) return openPending(pend.dataset.pending, draw);

    const row = e.target.closest('[data-acc]');
    if (row) openAccount(row.dataset.acc, draw);
  });

  root.addEventListener('submit', (e) => {
    if (e.target.id !== 'acc-form') return;
    e.preventDefault();
    const balance = parseAmount(root.querySelector('#acc-bal').value);
    if (!Number.isFinite(balance)) return toast('Saldo no válido');
    addAccount({
      kind: root.querySelector('#acc-kind').value,
      name: root.querySelector('#acc-name').value,
      balance: Math.abs(balance),
      interestRate: parseRate(root.querySelector('#acc-rate').value),
    });
    toast('Añadido');
    draw();
  });

  draw();
  refresh();
}

/* ---------- Cuentas: detalle y edición --------------------------------- */

const pctPlain = (n) => `${String(n).replace('.', ',')} %`;
const parseRate = (v) => {
  const n = parseAmount(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function openAccount(id, onDone) {
  const a = getState().accounts.find((x) => x.id === id);
  if (!a) return;
  const k = KINDS[a.kind];
  const { value, interest, flows } = accountBreakdown(a);
  const isLiq = a.kind === 'liquidez';
  const estimated = isLiq && (a.interestRate || flows);

  const { el, close } = openSheet(`
    <h3 class="sheet-title">${esc(a.name)}</h3>
    <p class="muted" style="text-align:center;margin:-8px 0 16px;font-size:13px">${k.label}</p>
    <div class="list kv">
      <div class="row"><span class="main">${estimated ? 'Saldo estimado hoy' : 'Saldo'}</span>
        <span class="trail num">${money(value)}</span></div>
      ${estimated ? `
      <div class="row"><span class="main">Último saldo real</span><span class="trail num">${money(a.balance)} · ${esc(a.updatedAt)}</span></div>
      ${a.interestRate ? `<div class="row"><span class="main">Intereses</span><span class="trail num pos">+${money(interest)}</span></div>` : ''}
      <div class="row"><span class="main">Gastos e ingresos</span><span class="trail num ${tone(flows)}">${signedEur(flows)}</span></div>` : ''}
    </div>

    <form id="a-form">
      <div class="field-group" style="margin-top:16px">
        <div class="field"><label for="a-bal">Saldo real</label>
          <input id="a-bal" inputmode="decimal" placeholder="${esc(money(value))}"></div>
        ${isLiq ? `<div class="field"><label for="a-rate">Interés anual</label>
          <input id="a-rate" inputmode="decimal" placeholder="Ej. 2,25" value="${a.interestRate ? esc(String(a.interestRate).replace('.', ',')) : ''}"></div>` : ''}
      </div>
      ${isLiq ? '<p class="hint" style="margin-top:-8px">Al poner el saldo real (el que ves en tu banco), los intereses y movimientos se cuentan de nuevo desde ahora.</p>' : ''}
      <button class="btn btn-primary" type="submit">Guardar</button>
    </form>
    <button class="btn btn-danger" type="button" id="a-del" style="margin-top:18px">Eliminar</button>
    <button class="btn" type="button" data-close>Cerrar</button>
  `);

  const $ = (s) => el.querySelector(s);
  $('#a-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const patch = {};
    const rawBal = $('#a-bal').value.trim();
    if (rawBal) {
      const bal = parseAmount(rawBal);
      if (!Number.isFinite(bal)) return toast('Saldo no válido');
      Object.assign(patch, { balance: round2(Math.abs(bal)), updatedAt: todayISO(), syncedAt: new Date().toISOString() });
    }
    if (isLiq) {
      const rate = parseRate($('#a-rate').value);
      // Si cambia el interés sin saldo nuevo, fijamos antes lo ya devengado.
      if (!rawBal && rate !== (a.interestRate || 0)) {
        Object.assign(patch, { balance: round2(accountValue(a)), updatedAt: todayISO(), syncedAt: new Date().toISOString() });
      }
      patch.interestRate = rate;
    }
    updateAccount(a.id, patch);
    close(); toast('Guardado'); onDone();
  });
  $('#a-del').addEventListener('click', () => {
    if (!confirm(`¿Eliminar ${a.name}?`)) return;
    deleteAccount(a.id);
    close(); onDone();
  });
}

/* ---------- Bloque de fondos ------------------------------------------ */

function renderFunds(holdings, quotes, fx, funds) {
  if (!hasApiKey()) {
    return `<div class="card">
      <span class="tag">ETF Espejo</span>
      <p class="muted" style="margin:10px 0 14px;font-size:15px">
        Sigue tus fondos indexados en tiempo real con un ETF equivalente
        (S&amp;P 500 → VOO, NASDAQ → QQQ, Emergentes → EEM). Necesitas una clave gratuita de Finnhub.
      </p>
      <a class="btn" href="#/ajustes">Configurar en Ajustes</a>
    </div>`;
  }
  if (!holdings.length) {
    return `<div class="card empty">
      <strong>Sin fondos</strong>Añade tu fondo indexado y elige su ETF espejo.
      <button class="btn btn-primary" style="margin-top:16px" data-action="add-fund">Añadir fondo</button>
    </div>`;
  }

  const gain = funds.value - funds.invested;
  const gainPct = funds.invested ? (funds.value / funds.invested - 1) * 100 : 0;
  return `
    <section class="card">
      <div class="label muted" style="font-size:14px;font-weight:500">Valor estimado</div>
      <div class="num" style="font-size:32px;font-weight:700;margin:2px 0 14px">${money(funds.value)}</div>
      <div class="split">
        <div class="pill-stat">
          <div class="label">Rentabilidad</div>
          <div class="value num ${tone(gain)}">${signedEur(gain)}</div>
          <div class="num ${tone(gain)}" style="font-size:13px">${signedPct(gainPct)}</div>
        </div>
        <div class="pill-stat">
          <div class="label">Hoy</div>
          <div class="value num ${tone(funds.dayChange)}">${signedEur(funds.dayChange)}</div>
          <div class="muted" style="font-size:13px">${fx ? `EUR/USD ${fx.rate.toFixed(4)}` : '&nbsp;'}</div>
        </div>
      </div>
    </section>
    <div class="list" style="margin-top:12px">
      ${holdings.map((h) => {
        const q = quotes[h.ticker];
        const e = estimateHolding(h, q, fx);
        return `<button class="row" data-fund="${esc(h.id)}">
          <span class="icon">${icon('trending')}</span>
          <span class="main">
            <div class="title">${esc(h.name)}</div>
            <div class="subtitle num">${esc(h.ticker)} · ${q ? `${usd(q.price)} · <span class="${tone(q.changePct)}">${signedPct(q.changePct)}</span>` : 'sin cotización'}</div>
          </span>
          <span class="trail-stack num">
            <div class="trail">${money(e.value)}</div>
            <div class="trail-sub ${tone(e.gain)}">${signedEur(e.gain)}</div>
          </span>
        </button>`;
      }).join('')}
    </div>
    <button class="btn" style="margin-top:12px" data-action="add-fund">Añadir fondo</button>
  `;
}

/* ---------- Hojas: alta y detalle de fondo ---------------------------- */

/** Cotización + tipo de cambio actuales (usa caché si son recientes). */
async function liveReference(ticker) {
  const { quotes = {}, fx } = getState();
  const cached = quotes[ticker];
  const quote = cached && Date.now() - cached.fetchedAt < 60_000 ? cached : await fetchQuote(ticker);
  let fxNow = fx;
  if (!fxNow || Date.now() - fxNow.fetchedAt > 6 * 3600_000) {
    try { fxNow = await fetchEurUsd(); } catch { /* sin corrección de divisa */ }
  }
  setMarketData({ [ticker]: quote }, fxNow);
  return { quote, fx: fxNow };
}

function openAddFund(onDone) {
  const { el, close } = openSheet(`
    <h3 class="sheet-title">Añadir fondo</h3>
    <form id="fund-form">
      <div class="field-group">
        <div class="field"><label for="f-name">Nombre</label>
          <input id="f-name" required placeholder="Vanguard US 500 Index"></div>
        <div class="field"><label for="f-isin">ISIN</label>
          <input id="f-isin" placeholder="Opcional" autocapitalize="characters"></div>
        <div class="field"><label for="f-ticker">ETF espejo</label>
          <select id="f-ticker">
            ${MIRROR_PRESETS.map((p) => `<option value="${p.ticker}">${p.ticker} · ${p.label}</option>`).join('')}
            <option value="">Otro ticker…</option>
          </select></div>
        <div class="field" id="f-custom-wrap" hidden><label for="f-custom">Ticker</label>
          <input id="f-custom" placeholder="VT, VWO, IWDA…" autocapitalize="characters"></div>
      </div>
      <div class="field-group">
        <div class="field"><label for="f-invested">Aportado</label>
          <input id="f-invested" inputmode="decimal" required placeholder="0,00 €"></div>
        <div class="field"><label for="f-value">Valor hoy</label>
          <input id="f-value" inputmode="decimal" placeholder="= aportado"></div>
      </div>
      <p class="hint" style="margin-top:-8px">"Valor hoy" es lo que marca tu banco ahora mismo. Desde ese punto la app sigue al ETF.</p>
      <button class="btn btn-primary" type="submit">Guardar</button>
      <button class="btn" type="button" data-close>Cancelar</button>
    </form>
  `);

  const $ = (s) => el.querySelector(s);
  $('#f-ticker').addEventListener('change', () => { $('#f-custom-wrap').hidden = $('#f-ticker').value !== ''; });

  $('#fund-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ticker = ($('#f-ticker').value || $('#f-custom').value).trim().toUpperCase();
    const invested = parseAmount($('#f-invested').value);
    const valueRaw = parseAmount($('#f-value').value);
    if (!ticker) return toast('Indica el ticker');
    if (!(invested > 0)) return toast('Importe aportado no válido');

    const btn = e.submitter ?? $('button[type=submit]');
    btn.disabled = true; btn.textContent = `Consultando ${ticker}…`;
    try {
      const { quote, fx } = await liveReference(ticker);
      addHolding({
        name: $('#f-name').value.trim(),
        isin: $('#f-isin').value.trim().toUpperCase(),
        ticker,
        invested: round2(invested),
        refValue: round2(valueRaw > 0 ? valueRaw : invested),
        refPrice: quote.price,
        refFx: fx?.rate ?? null,
      });
      close();
      toast('Fondo añadido');
      onDone();
    } catch (err) {
      toast(err.message);
      btn.disabled = false; btn.textContent = 'Guardar';
    }
  });
}

function openFund(id, onDone) {
  const h = getState().holdings.find((x) => x.id === id);
  if (!h) return;
  const { quotes = {}, fx } = getState();
  const q = quotes[h.ticker];
  const e = estimateHolding(h, q, fx);
  const refDate = new Date(h.refDate).toLocaleDateString('es-ES');

  const { el, close } = openSheet(`
    <h3 class="sheet-title">${esc(h.name)}</h3>
    <p class="muted" style="text-align:center;margin:-8px 0 16px;font-size:13px">${esc(h.isin || '')}${h.isin ? ' · ' : ''}Espejo: ${esc(h.ticker)}</p>
    <div class="list kv">
      <div class="row"><span class="main">Valor estimado</span><span class="trail num">${money(e.value)}</span></div>
      <div class="row"><span class="main">Aportado</span><span class="trail num">${money(h.invested)}</span></div>
      <div class="row"><span class="main">Rentabilidad</span><span class="trail num ${tone(e.gain)}">${signedEur(e.gain)} (${signedPct(e.gainPct)})</span></div>
      <div class="row"><span class="main">${esc(h.ticker)} ahora / ref.</span><span class="trail num">${q ? usd(q.price) : '—'} / ${usd(h.refPrice)}</span></div>
      <div class="row"><span class="main">Referencia</span><span class="trail num">${money(h.refValue)} · ${refDate}</span></div>
    </div>

    <form id="recal-form" class="inline-form">
      <input id="r-value" inputmode="decimal" placeholder="Valor real hoy (€)" required>
      <button class="btn" type="submit">Recalibrar</button>
    </form>
    <form id="contrib-form" class="inline-form">
      <input id="c-amount" inputmode="decimal" placeholder="Nueva aportación (€)" required>
      <button class="btn" type="submit">Aportar</button>
    </form>

    <button class="btn btn-danger" type="button" id="del-fund" style="margin-top:18px">Eliminar fondo</button>
    <button class="btn" type="button" data-close>Cerrar</button>
  `);

  const $ = (s) => el.querySelector(s);

  // Recalibrar: el valor real del banco pasa a ser la nueva referencia.
  $('#recal-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const real = parseAmount($('#r-value').value);
    if (!(real > 0)) return toast('Valor no válido');
    try {
      const { quote, fx: fxNow } = await liveReference(h.ticker);
      updateHolding(h.id, { refValue: round2(real), refPrice: quote.price, refFx: fxNow?.rate ?? null, refDate: new Date().toISOString() });
      close(); toast('Recalibrado'); onDone();
    } catch (err) { toast(err.message); }
  });

  // Aportación: suma al aportado y al valor de referencia (al precio actual).
  $('#contrib-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const amount = parseAmount($('#c-amount').value);
    if (!(amount > 0)) return toast('Importe no válido');
    try {
      const { quote, fx: fxNow } = await liveReference(h.ticker);
      const current = estimateHolding(h, quote, fxNow).value;
      updateHolding(h.id, {
        invested: round2(h.invested + amount),
        refValue: round2(current + amount),
        refPrice: quote.price,
        refFx: fxNow?.rate ?? null,
        refDate: new Date().toISOString(),
      });
      close(); toast('Aportación añadida'); onDone();
    } catch (err) { toast(err.message); }
  });

  $('#del-fund').addEventListener('click', () => {
    if (!confirm(`¿Eliminar ${h.name}?`)) return;
    deleteHolding(h.id);
    close(); onDone();
  });
}

/* ---------- Huchas (#13) ----------------------------------------------- */

function openGoalForm(goal, onDone) {
  const { el, close } = openSheet(`
    <h3 class="sheet-title">${goal ? 'Editar hucha' : 'Nueva hucha'}</h3>
    <form id="g-form">
      <div class="field-group">
        <div class="field"><label for="g-name">Nombre</label>
          <input id="g-name" required placeholder="Viaje a Japón" value="${esc(goal?.name ?? '')}"></div>
        <div class="field"><label for="g-target">Objetivo</label>
          <input id="g-target" inputmode="decimal" required placeholder="0,00 €" value="${goal ? esc(String(goal.target).replace('.', ',')) : ''}"></div>
      </div>
      <button class="btn btn-primary" type="submit">Guardar</button>
      <button class="btn" type="button" data-close>Cancelar</button>
    </form>
  `);
  el.querySelector('#g-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const target = parseAmount(el.querySelector('#g-target').value);
    if (!(target > 0)) return toast('Objetivo no válido');
    const name = el.querySelector('#g-name').value.trim();
    if (goal) updateGoal(goal.id, { name, target: round2(target) });
    else addGoal({ name, target });
    close(); toast('Hucha guardada'); onDone();
  });
}

function openGoal(id, onDone) {
  const g = getState().goals.find((x) => x.id === id);
  if (!g) return;
  const n = computeNetWorth();
  const p = g.target ? g.saved / g.target : 0;
  const { el, close } = openSheet(`
    <h3 class="sheet-title">${esc(g.name)}</h3>
    <div class="goal-hero">
      <div class="num" style="font-size:30px;font-weight:700">${money(g.saved)}</div>
      <div class="muted num">de ${money(g.target)} · faltan ${money(Math.max(0, g.target - g.saved))}</div>
      ${progress(p, { color: p >= 1 ? 'var(--green)' : 'var(--text)' })}
    </div>
    <p class="hint" style="margin:6px 0 4px">El dinero sigue en tus cuentas, pero se aparta de tu liquidez disponible
      (<span class="num">${money(n.disponible)}</span> ahora).</p>
    <form id="move-form" class="inline-form">
      <input id="m-amount" inputmode="decimal" placeholder="Importe (€)" required>
      <button class="btn" type="submit" data-dir="1">Apartar</button>
      <button class="btn" type="submit" data-dir="-1">Sacar</button>
    </form>
    <button class="btn" type="button" id="g-edit" style="margin-top:18px">Editar nombre u objetivo</button>
    <button class="btn btn-danger" type="button" id="g-del">Eliminar hucha</button>
    <button class="btn" type="button" data-close>Cerrar</button>
  `);
  el.querySelector('#move-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseAmount(el.querySelector('#m-amount').value);
    if (!(amount > 0)) return toast('Importe no válido');
    const dir = Number(e.submitter?.dataset.dir ?? 1);
    if (dir > 0 && amount > n.disponible + 0.005) return toast('No tienes tanta liquidez disponible');
    const saved = round2(Math.max(0, g.saved + dir * amount));
    updateGoal(g.id, { saved });
    close();
    toast(dir > 0 ? (saved >= g.target ? '¡Objetivo conseguido! 🎉' : 'Apartado en la hucha') : 'Sacado de la hucha');
    onDone();
  });
  el.querySelector('#g-edit').addEventListener('click', () => { close(); setTimeout(() => openGoalForm(g, onDone), 260); });
  el.querySelector('#g-del').addEventListener('click', () => {
    if (!confirm(`¿Eliminar la hucha ${g.name}? El dinero vuelve a tu liquidez disponible.`)) return;
    deleteGoal(g.id); close(); onDone();
  });
}

/* ---------- Cobros pendientes (#14) ------------------------------------ */

function openPendingForm(onDone) {
  const { el, close } = openSheet(`
    <h3 class="sheet-title">Pendiente de cobro</h3>
    <form id="p-form">
      <div class="field-group">
        <div class="field"><label for="p-name">Concepto</label>
          <input id="p-name" required placeholder="Beca, devolución IRPF…"></div>
        <div class="field"><label for="p-amount">Importe</label>
          <input id="p-amount" inputmode="decimal" required placeholder="0,00 €"></div>
        <div class="field"><label for="p-date">Fecha prevista</label>
          <input id="p-date" type="date"></div>
      </div>
      <button class="btn btn-primary" type="submit">Guardar</button>
      <button class="btn" type="button" data-close>Cancelar</button>
    </form>
  `);
  el.querySelector('#p-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseAmount(el.querySelector('#p-amount').value);
    if (!(amount > 0)) return toast('Importe no válido');
    addPending({ name: el.querySelector('#p-name').value, amount, expectedDate: el.querySelector('#p-date').value });
    close(); toast('Añadido a la previsión'); onDone();
  });
}

function openPending(id, onDone) {
  const p = getState().pending.find((x) => x.id === id);
  if (!p) return;
  const accounts = getState().accounts.filter((a) => a.kind === 'liquidez');
  const incomeCats = categoriesOf('income');
  const { el, close } = openSheet(`
    <h3 class="sheet-title">${esc(p.name)}</h3>
    <p class="muted num" style="text-align:center;margin:-8px 0 16px">+${money(p.amount)}${p.expectedDate ? ` · previsto ${shortDate(p.expectedDate)}` : ''}</p>
    <p class="hint" style="margin:0 0 10px">Cuando lo cobres, se registrará como ingreso en la cuenta que elijas.</p>
    <div class="field-group">
      ${accounts.length ? `<div class="field"><label for="pc-acc">Cuenta</label>
        <select id="pc-acc">${accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}<option value="">Ninguna</option></select></div>` : ''}
      <div class="field"><label for="pc-cat">Categoría</label>
        <select id="pc-cat">${incomeCats.map((c) => `<option value="${esc(c.id)}" ${c.id === 'otros-ingresos' ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    </div>
    <button class="btn btn-primary" type="button" id="pc-done">Marcar como cobrado</button>
    <button class="btn btn-danger" type="button" id="pc-del">Eliminar</button>
    <button class="btn" type="button" data-close>Cerrar</button>
  `);
  el.querySelector('#pc-done').addEventListener('click', () => {
    addTransaction({
      type: 'income', amount: p.amount, description: p.name,
      category: el.querySelector('#pc-cat').value, account: el.querySelector('#pc-acc')?.value ?? '',
    });
    deletePending(p.id);
    close(); toast('Ingreso registrado'); onDone();
  });
  el.querySelector('#pc-del').addEventListener('click', () => {
    if (!confirm(`¿Eliminar ${p.name} de la previsión?`)) return;
    deletePending(p.id); close(); onDone();
  });
}
