// Vista "Nuevo gasto / ingreso" + hooks para Atajos de iOS.
//
// Gastos (#4):    /?importe=15.50&comercio=Mercadona
// Ingresos (#5):  /?ingreso=1200&origen=Nómina   (también ?tipo=ingreso&importe=...)
// Extras opcionales: categoria, fecha (AAAA-MM-DD), etiquetas (#viajes,#comida), divisa (GBP|USD)
// Portapapeles (PWA instalada): FINANZAS|<Importe>|<Comercio>  ·  INGRESO|<Importe>|<Origen>

import { addTransaction, categoriesOf, todayISO, getState, setSetting, allTags, normalizeTags, round2 } from '../store.js';
import { fetchRateToEur } from '../market.js';
import { esc, parseAmount, amountToInput, toast, icon, money, currencySymbol } from '../ui.js';

const CURRENCIES = ['EUR', 'GBP', 'USD'];

const PARAM_ALIASES = {
  amount:      ['importe', 'amount', 'cantidad'],
  income:      ['ingreso', 'income'],
  description: ['comercio', 'merchant', 'descripcion', 'concepto', 'origen', 'from'],
  category:    ['categoria', 'category'],
  date:        ['fecha', 'date'],
  type:        ['tipo', 'type'],
  tags:        ['etiquetas', 'tags'],
  currency:    ['divisa', 'currency', 'moneda'],
};

/**
 * Lee los parámetros de prefill de la URL actual mediante URLSearchParams.
 * Devuelve null si no hay ninguno. No modifica la URL (eso lo hace app.js).
 */
export function readPrefillFromURL(loc = window.location) {
  const sources = [new URLSearchParams(loc.search)];
  const hashQuery = loc.hash.split('?')[1];
  if (hashQuery) sources.push(new URLSearchParams(hashQuery));

  const pick = (keys) => {
    for (const params of sources) {
      for (const k of keys) {
        const v = params.get(k);
        if (v != null && v.trim() !== '') return v.trim();
      }
    }
    return null;
  };

  const rawIncome = pick(PARAM_ALIASES.income);
  const rawAmount = rawIncome ?? pick(PARAM_ALIASES.amount);
  const description = pick(PARAM_ALIASES.description);
  if (rawAmount == null && description == null) return null;

  const amount = parseAmount(rawAmount);
  const rawType = (pick(PARAM_ALIASES.type) || '').toLowerCase();
  const date = pick(PARAM_ALIASES.date);
  const currency = (pick(PARAM_ALIASES.currency) || detectCurrency(rawAmount) || 'EUR').toUpperCase();

  return {
    amount: Number.isFinite(amount) ? Math.abs(amount) : null,
    description: description ?? '',
    category: pick(PARAM_ALIASES.category),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : null,
    type: rawIncome != null || ['ingreso', 'income'].includes(rawType) ? 'income' : 'expense',
    tags: normalizeTags(pick(PARAM_ALIASES.tags) || ''),
    currency: CURRENCIES.includes(currency) ? currency : 'EUR',
  };
}

/** "12,50 £" / "$9.99" → 'GBP' / 'USD' (Apple Pay incluye el símbolo en el importe). */
function detectCurrency(raw = '') {
  if (/£|GBP/i.test(raw)) return 'GBP';
  if (/\$|USD/i.test(raw)) return 'USD';
  return null;
}

/**
 * Hook alternativo para la PWA instalada: el Atajo copia al portapapeles
 *   FINANZAS|<Importe>|<Comercio>   (gasto)
 *   INGRESO|<Importe>|<Origen>      (ingreso; también FINANZAS-INGRESO|...)
 * o una URL completa con ?importe=... / ?ingreso=...
 */
export function parseClipboardPayment(text = '') {
  const t = text.trim();
  const m = t.match(/^(FINANZAS(?:-INGRESO)?|INGRESO)\s*\|([^|]*)\|([\s\S]*)$/i);
  if (m) {
    const amount = parseAmount(m[2]);
    if (!Number.isFinite(amount)) return null;
    return {
      amount: Math.abs(amount), description: m[3].trim(), category: null, date: null, tags: [],
      type: /INGRESO/i.test(m[1]) ? 'income' : 'expense',
      currency: detectCurrency(m[2]) || 'EUR',
      source: 'clipboard',
    };
  }
  if (/[?&#](importe|amount|ingreso)=/i.test(t)) {
    try {
      const prefill = readPrefillFromURL(new URL(t, location.href));
      return prefill && { ...prefill, source: 'clipboard' };
    } catch { /* no es una URL */ }
  }
  return null;
}

/** Lee el portapapeles (requiere un toque del usuario) y abre el formulario relleno. */
export async function pastePayment(navigate) {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return toast('No se pudo leer el portapapeles');
  }
  const prefill = parseClipboardPayment(text);
  if (!prefill) return toast('No hay ningún pago copiado');
  navigate('nuevo', prefill);
}

export function render(root, { prefill, navigate }) {
  document.body.classList.add('is-modal');

  const form = {
    type: prefill?.type ?? 'expense',
    amount: prefill?.amount ?? null,     // en la divisa elegida, antes de dividir
    currency: prefill?.currency ?? 'EUR',
    rate: 1,                             // € por 1 unidad de la divisa
    rateState: 'ok',                     // ok | loading | error
    split: false,
    category: null,
  };
  // Cuenta: la última usada (si sigue existiendo) o la primera de liquidez.
  const accounts = getState().accounts.filter((a) => a.kind === 'liquidez');
  const last = getState().settings.lastAccount;
  const defaultAccount = accounts.some((a) => a.id === last) ? last : (accounts[0]?.id ?? '');

  // Solo aceptamos la categoría del prefill si existe para ese tipo.
  if (prefill?.category && categoriesOf(form.type).some((c) => c.id === prefill.category)) {
    form.category = prefill.category;
  }

  const suggestedTags = allTags().slice(0, 8).map((t) => t.tag);

  root.innerHTML = `
    <div class="topbar">
      <a class="left" href="#/inicio">Cancelar</a>
      <h2 id="nt-title"></h2>
      <span></span>
    </div>

    <div class="segmented" role="group" aria-label="Tipo de movimiento">
      <button type="button" data-type="expense">Gasto</button>
      <button type="button" data-type="income">Ingreso</button>
    </div>

    <div class="amount-input">
      <input id="nt-amount" class="num" inputmode="decimal" autocomplete="off"
             placeholder="0,00" aria-label="Importe" value="${esc(amountToInput(form.amount))}">
      <button type="button" class="currency" id="nt-currency" aria-label="Cambiar divisa">${currencySymbol(form.currency)}</button>
    </div>
    <div class="amount-hint" id="nt-hint"></div>
    ${prefill
      ? `<div class="prefill-badge">${icon('card')} Rellenado desde Atajos</div>`
      : `<button type="button" class="prefill-badge paste-btn" id="nt-paste">${icon('card')} Pegar pago de Apple Pay</button>`}

    <div class="field-group">
      <div class="field">
        <label for="nt-desc">Concepto</label>
        <input id="nt-desc" type="text" placeholder="Comercio o descripción"
               autocomplete="off" enterkeyhint="done" value="${esc(prefill?.description ?? '')}">
      </div>
      <div class="field">
        <label for="nt-date">Fecha</label>
        <input id="nt-date" type="date" value="${esc(prefill?.date ?? todayISO())}">
      </div>
      ${accounts.length ? `<div class="field">
        <label for="nt-account">Cuenta</label>
        <select id="nt-account">
          ${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === defaultAccount ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          <option value="" ${defaultAccount ? '' : 'selected'}>Ninguna</option>
        </select>
      </div>` : ''}
      <div class="field" id="nt-split-row">
        <label for="nt-split">Compartido</label>
        <span class="field-note" id="nt-split-note">Dividir entre 2</span>
        <input id="nt-split" type="checkbox" class="switch" role="switch">
      </div>
      <div class="field">
        <label for="nt-tags">Etiquetas</label>
        <input id="nt-tags" type="text" placeholder="#viajes #mecanica" autocomplete="off"
               autocapitalize="off" spellcheck="false" value="${esc((prefill?.tags || []).map((t) => '#' + t).join(' '))}">
      </div>
    </div>
    ${suggestedTags.length ? `<div class="chips tag-suggestions">${suggestedTags.map((t) =>
      `<button type="button" class="chip" data-addtag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}

    <div class="section-title" style="margin-top:0">Categoría</div>
    <div class="cat-grid" id="nt-cats"></div>

    <div class="save-bar">
      <button id="nt-save" class="btn btn-primary" type="button" disabled>Guardar</button>
    </div>
  `;

  const $ = (sel) => root.querySelector(sel);
  const amountEl = $('#nt-amount');
  const saveBtn = $('#nt-save');

  function renderType() {
    $('#nt-title').textContent = form.type === 'income' ? 'Nuevo ingreso' : 'Nuevo gasto';
    root.querySelectorAll('[data-type]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.type === form.type)));
    // El gasto compartido solo tiene sentido en gastos.
    $('#nt-split-row').hidden = form.type === 'income';
    if (form.type === 'income') { form.split = false; $('#nt-split').checked = false; }
    $('#nt-cats').innerHTML = categoriesOf(form.type).map((c) => `
      <button type="button" class="cat" data-cat="${esc(c.id)}" aria-pressed="${c.id === form.category}">
        <span class="cat-ico">${icon(c.icon)}</span><span>${esc(c.name)}</span>
      </button>`).join('');
  }

  /** Importe final en € (divisa convertida y, si aplica, dividido entre 2). */
  const finalEur = () => (form.amount ? round2(form.amount * form.rate / (form.split ? 2 : 1)) : 0);

  function renderHint() {
    const parts = [];
    if (form.currency !== 'EUR') {
      if (form.rateState === 'loading') parts.push('Consultando tipo de cambio…');
      else if (form.rateState === 'error') parts.push('<span class="neg">Sin tipo de cambio (¿sin conexión?)</span>');
      else parts.push(`1 ${currencySymbol(form.currency)} = ${form.rate.toFixed(4).replace('.', ',')} €`);
    }
    if (form.amount && (form.split || form.currency !== 'EUR') && form.rateState === 'ok') {
      parts.push(`Se guardará <strong class="num">${money(finalEur())}</strong>${form.split ? ' (tu mitad)' : ''}`);
    }
    $('#nt-hint').innerHTML = parts.join(' · ');
    $('#nt-split-note').textContent = form.split && form.amount ? `Tu parte: ${money(finalEur())}` : 'Dividir entre 2';
  }

  function validate() {
    const amount = parseAmount(amountEl.value);
    form.amount = Number.isFinite(amount) && amount > 0 ? amount : null;
    saveBtn.disabled = !(form.amount && form.category && form.rateState === 'ok');
    renderHint();
  }

  async function updateRate() {
    if (form.currency === 'EUR') { form.rate = 1; form.rateState = 'ok'; validate(); return; }
    form.rateState = 'loading';
    validate();
    const wanted = form.currency;
    try {
      const { rate } = await fetchRateToEur(wanted, $('#nt-date').value);
      if (form.currency !== wanted) return; // el usuario cambió mientras tanto
      form.rate = rate;
      form.rateState = 'ok';
    } catch {
      form.rateState = 'error';
    }
    validate();
  }

  root.addEventListener('click', (e) => {
    const typeBtn = e.target.closest('[data-type]');
    if (typeBtn && typeBtn.dataset.type !== form.type) {
      form.type = typeBtn.dataset.type;
      form.category = null;
      renderType();
      validate();
      return;
    }
    const catBtn = e.target.closest('[data-cat]');
    if (catBtn) {
      form.category = catBtn.dataset.cat;
      root.querySelectorAll('[data-cat]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === catBtn)));
      validate();
      return;
    }
    const tagBtn = e.target.closest('[data-addtag]');
    if (tagBtn) {
      const tags = normalizeTags($('#nt-tags').value);
      if (!tags.includes(tagBtn.dataset.addtag)) tags.push(tagBtn.dataset.addtag);
      $('#nt-tags').value = tags.map((t) => '#' + t).join(' ');
    }
  });

  // Divisa: € → £ → $ → €
  $('#nt-currency').addEventListener('click', () => {
    form.currency = CURRENCIES[(CURRENCIES.indexOf(form.currency) + 1) % CURRENCIES.length];
    $('#nt-currency').textContent = currencySymbol(form.currency);
    updateRate();
  });
  $('#nt-date').addEventListener('change', () => form.currency !== 'EUR' && updateRate());

  $('#nt-split').addEventListener('change', (e) => { form.split = e.target.checked; validate(); });

  // Solo permitimos dígitos y un separador decimal con máx. 2 decimales.
  amountEl.addEventListener('input', () => {
    let v = amountEl.value.replace(/[^\d.,]/g, '').replace('.', ',');
    const [int, ...rest] = v.split(',');
    if (rest.length) v = `${int},${rest.join('').slice(0, 2)}`;
    amountEl.value = v;
    validate();
  });

  saveBtn.addEventListener('click', () => {
    validate();
    if (saveBtn.disabled) return;
    addTransaction({
      type: form.type,
      amount: finalEur(),
      description: $('#nt-desc').value,
      category: form.category,
      date: $('#nt-date').value || todayISO(),
      account: $('#nt-account')?.value ?? '',
      tags: $('#nt-tags').value,
      split: form.split,
      currency: form.currency,
      originalAmount: form.amount,
      fxRate: form.rate,
    });
    if ($('#nt-account')) setSetting('lastAccount', $('#nt-account').value);
    // Vaciamos el portapapeles para no registrar el mismo pago dos veces.
    if (prefill?.source === 'clipboard') navigator.clipboard?.writeText('').catch(() => {});
    if (navigator.vibrate) navigator.vibrate(10);
    toast(form.type === 'income' ? 'Ingreso guardado' : 'Gasto guardado');
    navigate('inicio');
  });

  $('#nt-paste')?.addEventListener('click', () => pastePayment(navigate));

  renderType();
  validate();
  if (form.currency !== 'EUR') updateRate();

  return () => document.body.classList.remove('is-modal');
}
