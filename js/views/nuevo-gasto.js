// Vista "Nuevo gasto" + hook de Apple Pay vía parámetros de URL.
//
// Entrada admitida (query normal o dentro del hash):
//   /?importe=15.50&comercio=Mercadona
//   /#/nuevo?importe=15,50%20€&comercio=Mercadona&categoria=supermercado
// Alias aceptados: amount, merchant, descripcion, category, fecha/date, tipo/type.

import { addTransaction, categoriesOf, todayISO } from '../store.js';
import { esc, parseAmount, amountToInput, toast, icon } from '../ui.js';

const PARAM_ALIASES = {
  amount:      ['importe', 'amount', 'cantidad'],
  description: ['comercio', 'merchant', 'descripcion', 'concepto'],
  category:    ['categoria', 'category'],
  date:        ['fecha', 'date'],
  type:        ['tipo', 'type'],
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

  const rawAmount = pick(PARAM_ALIASES.amount);
  const description = pick(PARAM_ALIASES.description);
  if (rawAmount == null && description == null) return null;

  const amount = parseAmount(rawAmount);
  const rawType = (pick(PARAM_ALIASES.type) || '').toLowerCase();
  const date = pick(PARAM_ALIASES.date);

  return {
    amount: Number.isFinite(amount) ? Math.abs(amount) : null,
    description: description ?? '',
    category: pick(PARAM_ALIASES.category),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : null,
    type: ['ingreso', 'income'].includes(rawType) ? 'income' : 'expense',
  };
}

/**
 * Hook alternativo para la PWA instalada: el Atajo de iOS copia el pago al
 * portapapeles con el formato  FINANZAS|<Importe>|<Comercio>
 * (también acepta una URL completa con ?importe=...&comercio=...).
 */
export function parseClipboardPayment(text = '') {
  const t = text.trim();
  const m = t.match(/^FINANZAS\s*\|([^|]*)\|([\s\S]*)$/i);
  if (m) {
    const amount = parseAmount(m[1]);
    if (!Number.isFinite(amount)) return null;
    return { amount: Math.abs(amount), description: m[2].trim(), category: null, date: null, type: 'expense', source: 'clipboard' };
  }
  if (/[?&#](importe|amount)=/i.test(t)) {
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
    amount: prefill?.amount ?? null,
    description: prefill?.description ?? '',
    category: null,
    date: prefill?.date ?? todayISO(),
  };
  // Solo aceptamos la categoría del prefill si existe para ese tipo.
  if (prefill?.category && categoriesOf(form.type).some((c) => c.id === prefill.category)) {
    form.category = prefill.category;
  }

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
      <span class="currency">€</span>
    </div>
    ${prefill
      ? `<div class="prefill-badge">${icon('card')} Rellenado desde Apple Pay</div>`
      : `<button type="button" class="prefill-badge paste-btn" id="nt-paste">${icon('card')} Pegar pago de Apple Pay</button>`}

    <div class="field-group">
      <div class="field">
        <label for="nt-desc">Concepto</label>
        <input id="nt-desc" type="text" placeholder="Comercio o descripción"
               autocomplete="off" enterkeyhint="done" value="${esc(form.description)}">
      </div>
      <div class="field">
        <label for="nt-date">Fecha</label>
        <input id="nt-date" type="date" value="${esc(form.date)}">
      </div>
    </div>

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
    $('#nt-cats').innerHTML = categoriesOf(form.type).map((c) => `
      <button type="button" class="cat" data-cat="${esc(c.id)}" aria-pressed="${c.id === form.category}">
        <span class="cat-ico">${icon(c.icon)}</span><span>${esc(c.name)}</span>
      </button>`).join('');
  }

  function validate() {
    const amount = parseAmount(amountEl.value);
    form.amount = Number.isFinite(amount) && amount > 0 ? amount : null;
    saveBtn.disabled = !(form.amount && form.category);
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
    }
  });

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
      amount: form.amount,
      description: $('#nt-desc').value,
      category: form.category,
      date: $('#nt-date').value || todayISO(),
    });
    // Vaciamos el portapapeles para no registrar el mismo pago dos veces.
    if (prefill?.source === 'clipboard') navigator.clipboard?.writeText('').catch(() => {});
    if (navigator.vibrate) navigator.vibrate(10);
    toast(form.type === 'income' ? 'Ingreso guardado' : 'Gasto guardado');
    navigate('inicio');
  });

  $('#nt-paste')?.addEventListener('click', () => pastePayment(navigate));

  renderType();
  validate();

  return () => document.body.classList.remove('is-modal');
}
