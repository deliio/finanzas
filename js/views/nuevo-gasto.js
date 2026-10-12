// Vista "Nuevo gasto / ingreso" + hooks para Atajos de iOS.
//
// Gastos (#4):    /?importe=15.50&comercio=Mercadona
// Ingresos (#5):  /?ingreso=1200&origen=Nómina   (también ?tipo=ingreso&importe=...)
// Extras opcionales: categoria, fecha (AAAA-MM-DD), etiquetas (#viajes,#comida), divisa (GBP|USD)
// Portapapeles (PWA instalada): FINANZAS|<Importe>|<Comercio>[|<Latitud>|<Longitud>]  ·  INGRESO|<Importe>|<Origen>
// Ubicación por URL: &lat=40.4168&lon=-3.7038

import { addTransaction, categoriesOf, todayISO, getState, setSetting, allTags, normalizeTags, round2, validLocation,
  payers, payerById, addDebt, knownDebtors, persist } from '../store.js';
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
  lat:         ['lat', 'latitud', 'latitude'],
  lon:         ['lon', 'lng', 'longitud', 'longitude'],
};

/** "40,4168" o "40.4168" → 40.4168 (la coma es decimal: las coordenadas no llevan miles). */
const coord = (s) => Number(String(s ?? '').trim().replace(',', '.').replace(/[^\d.-]/g, ''));

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
    location: validLocation({ lat: coord(pick(PARAM_ALIASES.lat)), lon: coord(pick(PARAM_ALIASES.lon)) }),
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
    // Campos opcionales al final: |<latitud>|<longitud> (acción "Get Current Location" del Atajo).
    const [merchant, lat, lon] = m[3].split('|');
    return {
      amount: Math.abs(amount), description: merchant.trim(), category: null, date: null, tags: [],
      type: /INGRESO/i.test(m[1]) ? 'income' : 'expense',
      currency: detectCurrency(m[2]) || 'EUR',
      location: validLocation({ lat: coord(lat), lon: coord(lon) }),
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
    split: 1,                            // nº de personas entre las que se divide (1 = no compartido)
    paidBy: '',                          // '' = lo pagas tú; si no, id de quien lo paga (no sale de tus cuentas)
    location: prefill?.location ?? null, // { lat, lon } para el mapa de calor
    locState: prefill?.location ? 'ok' : 'off', // off | loading | ok | denied | error
    locFromShortcut: Boolean(prefill?.location),
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
  const payerList = payers();
  const debtors = knownDebtors();

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
      ${accounts.length ? `<div class="field" id="nt-account-row">
        <label for="nt-account">Cuenta</label>
        <select id="nt-account">
          ${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === defaultAccount ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          <option value="" ${defaultAccount ? '' : 'selected'}>Ninguna</option>
        </select>
      </div>` : ''}
      <div class="field" id="nt-split-row">
        <label>Dividir entre</label>
        <span class="field-note" id="nt-split-note"></span>
        <div class="stepper" role="group" aria-label="Personas">
          <button type="button" data-step="-1" aria-label="Una persona menos"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button>
          <span id="nt-split-n" class="stepper-val">1</span>
          <button type="button" data-step="1" aria-label="Una persona más"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg></button>
        </div>
      </div>
      <div class="field" id="nt-debtors-row" hidden>
        <label for="nt-debtors">Te deben</label>
        <input id="nt-debtors" type="text" list="nt-debtors-list" placeholder="Nombres: Juan, Ana" autocomplete="off">
        <datalist id="nt-debtors-list">${debtors.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      </div>
      ${payerList.length ? `<div class="field" id="nt-payer-row">
        <label>Lo paga</label>
        <div class="pill-choice" role="group" aria-label="Quién lo paga">
          <button type="button" data-payer="" aria-pressed="true">Yo</button>
          ${payerList.map((p) => `<button type="button" data-payer="${esc(p.id)}" aria-pressed="false">${esc(p.name)}</button>`).join('')}
        </div>
      </div>` : ''}
      <div class="field" id="nt-loc-row">
        <label for="nt-loc">Ubicación</label>
        <span class="field-note" id="nt-loc-note"></span>
        <input id="nt-loc" type="checkbox" class="switch" role="switch">
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
    if ($('#nt-payer-row')) $('#nt-payer-row').hidden = form.type === 'income';
    if (form.type === 'income') { form.split = 1; form.paidBy = ''; }
    $('#nt-loc-row').hidden = form.type === 'income';
    renderPayer();
    renderLoc();
    $('#nt-cats').innerHTML = categoriesOf(form.type).map((c) => `
      <button type="button" class="cat" data-cat="${esc(c.id)}" aria-pressed="${c.id === form.category}">
        <span class="cat-ico">${icon(c.icon)}</span><span>${esc(c.name)}</span>
      </button>`).join('');
  }

  /** Si lo paga otra persona no se elige cuenta: el dinero no sale de ninguna. */
  function renderPayer() {
    const row = $('#nt-account-row');
    if (row) row.hidden = Boolean(form.paidBy);
    root.querySelectorAll('[data-payer]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.payer === form.paidBy)));
    renderHint();
  }

  /** Ubicación del gasto: viene del Atajo o se pide al GPS si el interruptor está activo. */
  function renderLoc() {
    const notes = { off: '', loading: 'Obteniendo…', ok: form.locFromShortcut ? 'Del pago' : 'Guardada', denied: 'Sin permiso', error: 'No disponible' };
    $('#nt-loc').checked = ['ok', 'loading'].includes(form.locState);
    $('#nt-loc-note').textContent = notes[form.locState];
  }

  function requestLocation() {
    if (!navigator.geolocation) { form.locState = 'error'; return renderLoc(); }
    form.locState = 'loading';
    renderLoc();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.location = validLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        form.locState = form.location ? 'ok' : 'error';
        renderLoc();
      },
      (err) => { form.location = null; form.locState = err.code === 1 ? 'denied' : 'error'; renderLoc(); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  /** Nombres escritos en "Te deben" (como mucho, personas − 1). */
  const debtorNames = () => [...new Set(($('#nt-debtors')?.value || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean))]
    .slice(0, Math.max(0, form.split - 1));

  /** Importe final en € (divisa convertida y, si aplica, dividido entre las personas). */
  const finalEur = () => (form.amount ? round2(form.amount * form.rate / form.split) : 0);

  function renderHint() {
    const parts = [];
    if (form.currency !== 'EUR') {
      if (form.rateState === 'loading') parts.push('Consultando tipo de cambio…');
      else if (form.rateState === 'error') parts.push('<span class="neg">Sin tipo de cambio (¿sin conexión?)</span>');
      else parts.push(`1 ${currencySymbol(form.currency)} = ${form.rate.toFixed(4).replace('.', ',')} €`);
    }
    if (form.amount && (form.split > 1 || form.currency !== 'EUR') && form.rateState === 'ok') {
      parts.push(`Se guardará <strong class="num">${money(finalEur())}</strong>${form.split > 1 ? ' (tu parte)' : ''}`);
    }
    const showDebtors = form.type === 'expense' && form.split > 1 && !form.paidBy;
    if ($('#nt-debtors-row')) {
      $('#nt-debtors-row').hidden = !showDebtors;
      if (showDebtors && form.amount && form.rateState === 'ok') {
        const n = debtorNames().length;
        $('#nt-debtors').placeholder = `Nombres · ${money(finalEur())} c/u`;
        if (n) parts.push(`${n === 1 ? 'Te debe' : 'Te deben'} <strong class="num">${money(finalEur() * n)}</strong>`);
      }
    }
    $('#nt-hint').innerHTML = parts.join(' · ');
    $('#nt-split-n').textContent = form.split;
    $('[data-step="-1"]').disabled = form.split <= 1;
    $('[data-step="1"]').disabled = form.split >= 20;
    $('#nt-split-note').textContent = form.split > 1
      ? (form.amount ? money(finalEur()) : `${form.split} personas`)
      : 'Solo yo';
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

  root.querySelectorAll('[data-payer]').forEach((b) => b.addEventListener('click', () => {
    form.paidBy = b.dataset.payer;
    renderPayer();
  }));
  $('#nt-debtors')?.addEventListener('input', renderHint);

  $('#nt-loc').addEventListener('change', (e) => {
    setSetting('saveLocation', e.target.checked); // se recuerda para los siguientes gastos
    if (e.target.checked) { form.locFromShortcut = false; requestLocation(); }
    else { form.location = null; form.locState = 'off'; form.locFromShortcut = false; renderLoc(); }
  });

  // Gasto compartido: entre 1 (solo yo) y 20 personas.
  root.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    form.split = Math.min(20, Math.max(1, form.split + Number(b.dataset.step)));
    validate();
  }));

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
    const account = form.paidBy ? '' : ($('#nt-account')?.value ?? '');
    const names = form.type === 'expense' && !form.paidBy ? debtorNames() : [];
    const tx = addTransaction({
      type: form.type,
      amount: finalEur(),
      description: $('#nt-desc').value,
      category: form.category,
      date: $('#nt-date').value || todayISO(),
      account,
      tags: $('#nt-tags').value,
      split: form.split,
      paidBy: form.paidBy,
      location: form.type === 'expense' && form.locState === 'ok' ? form.location : null,
      currency: form.currency,
      originalAmount: form.amount,
      fxRate: form.rate,
    }, { silent: names.length > 0 });
    // Gasto dividido: cada persona nombrada te debe su parte (el dinero salió de tu cuenta).
    names.forEach((person, i) => addDebt({ person, concept: tx.description || 'Gasto compartido', amount: finalEur(), account, txId: tx.id },
      { silent: i < names.length - 1 }));
    if ($('#nt-account') && !form.paidBy) setSetting('lastAccount', $('#nt-account').value);
    // Vaciamos el portapapeles para no registrar el mismo pago dos veces.
    if (prefill?.source === 'clipboard') navigator.clipboard?.writeText('').catch(() => {});
    if (navigator.vibrate) navigator.vibrate(10);
    toast(form.type === 'income' ? 'Ingreso guardado'
      : form.paidBy ? `Gasto guardado · lo paga ${payerById(form.paidBy).name}`
      : names.length ? `Gasto guardado · ${names.join(', ')} te ${names.length > 1 ? 'deben' : 'debe'} su parte`
      : 'Gasto guardado');
    navigate('inicio');
  });

  $('#nt-paste')?.addEventListener('click', () => pastePayment(navigate));

  renderType();
  validate();
  if (form.currency !== 'EUR') updateRate();
  // Si el usuario lo dejó activado, pedimos la ubicación al abrir (salvo que venga del Atajo).
  if (!form.location && form.type === 'expense' && getState().settings.saveLocation) requestLocation();

  return () => document.body.classList.remove('is-modal');
}
