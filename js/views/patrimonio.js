// Patrimonio neto = liquidez + activos (incl. fondos vía ETF espejo) − deudas.

import { getState, addAccount, updateAccount, deleteAccount, accountValue, accountBreakdown, addHolding, updateHolding, deleteHolding, setMarketData, round2, todayISO } from '../store.js';
import { MIRROR_PRESETS, hasApiKey, fetchQuote, fetchEurUsd, refreshMarket, estimateHolding, portfolioSummary } from '../market.js';
import { money, esc, parseAmount, toast, icon, usd, signedPct, signedEur, tone, openSheet } from '../ui.js';

const KINDS = {
  liquidez: { label: 'Liquidez', icon: 'wallet',   color: 'var(--text)' },
  activo:   { label: 'Activos',  icon: 'trending', color: 'var(--text-2)' },
  deuda:    { label: 'Deudas',   icon: 'bank',     color: 'var(--red)' },
};

const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

export function render(root) {
  let refreshing = false;

  const draw = () => {
    const { accounts, holdings, quotes = {}, fx } = getState();
    const total = (k) => accounts.filter((a) => a.kind === k).reduce((s, a) => s + accountValue(a), 0);
    const funds = portfolioSummary();
    const liq = total('liquidez'), act = total('activo') + funds.value, debt = total('deuda');
    const net = liq + act - debt;
    const gross = liq + act + debt || 1;
    const lastFetch = Math.max(0, ...Object.values(quotes).map((q) => q.fetchedAt));

    root.innerHTML = `
      <header class="page-header"><h1>Patrimonio</h1></header>

      <section class="card hero">
        <div class="label">Patrimonio neto</div>
        <div class="amount num">${money(net)}</div>
        <div class="bar">
          <span style="width:${(liq / gross) * 100}%;background:${KINDS.liquidez.color}"></span>
          <span style="width:${(act / gross) * 100}%;background:${KINDS.activo.color}"></span>
          <span style="width:${(debt / gross) * 100}%;background:var(--red)"></span>
        </div>
        <div class="legend">
          <span><i class="dot" style="background:${KINDS.liquidez.color}"></i>Liquidez ${money(liq, { decimals: false })}</span>
          <span><i class="dot" style="background:${KINDS.activo.color}"></i>Activos ${money(act, { decimals: false })}</span>
          <span><i class="dot" style="background:var(--red)"></i>Deudas ${money(debt, { decimals: false })}</span>
        </div>
      </section>

      <div class="section-title">
        Inversiones
        ${holdings.length && hasApiKey() ? `<button class="link-btn" data-action="refresh" ${refreshing ? 'disabled' : ''}>
          ${refreshing ? 'Actualizando…' : lastFetch ? `Actualizado ${timeFmt.format(lastFetch)}` : 'Actualizar'}</button>` : ''}
      </div>
      ${renderFunds(holdings, quotes, fx, funds)}

      ${Object.entries(KINDS).map(([kind, k]) => {
        const list = accounts.filter((a) => a.kind === kind);
        return `
          <div class="section-title">${k.label}<span class="num muted" style="font-size:15px">${money(total(kind))}</span></div>
          ${list.length ? `<div class="list">${list.map((a) => {
            const { value, interest, flows } = accountBreakdown(a);
            const parts = [];
            if (kind === 'liquidez' && a.interestRate) parts.push(`${pctPlain(a.interestRate)} · <span class="pos">+${money(interest)}</span>`);
            if (flows) parts.push(`<span class="${tone(flows)}">${signedEur(flows)}</span> movs.`);
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
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'refresh') return refresh(true);
    if (action === 'add-fund') return openAddFund(draw);

    const fund = e.target.closest('[data-fund]');
    if (fund) return openFund(fund.dataset.fund, draw);

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

