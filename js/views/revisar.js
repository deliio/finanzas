// Revisar movimientos: bandeja de los que entraron solos (buzón, Atajos, recurrentes).
// Primero se ven en LISTA con la hora a la que llegaron; al tocar uno se edita
// (categoría, importe, concepto, fecha) y se Confirma o Elimina, y se vuelve a la lista.
// Cuando no queda ninguno: "¡Todo al día!" y vuelta a Inicio.

import { pendingReview, updateTransaction, deleteTransaction, categoriesOf, categoryById, payerById, todayISO, round2 } from '../store.js';
import { esc, icon, money, signedMoney, parseAmount, amountToInput, toast, currencySymbol } from '../ui.js';

const SOURCE = { atajo: 'Apple Pay', url: 'Atajo', recurrente: 'Recurrente', buzon: 'Buzón' };

const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });

/** Cuándo llegó: "Hoy · 14:32", "Ayer · 21:10" o "lun 13 oct · 09:15". */
function arrived(t) {
  const d = new Date(t.receivedAt || t.createdAt);
  if (Number.isNaN(d.getTime())) return '';
  const today = todayISO();
  const day = todayISO(d);
  const yesterday = todayISO(new Date(Date.now() - 86400000));
  const label = day === today ? 'Hoy' : day === yesterday ? 'Ayer' : dayFmt.format(d).replace('.', '');
  return `${label} · ${timeFmt.format(d)}`;
}

const hasCategory = (t) => categoriesOf(t.type).some((c) => c.id === t.category);
const byArrival = (a, b) => (b.receivedAt || b.createdAt).localeCompare(a.receivedAt || a.createdAt);

export function render(root, { navigate }) {
  document.body.classList.add('is-modal');
  let done = 0;
  let timer = null;

  const finish = () => {
    root.innerHTML = `
      <div class="review-done">
        <div class="review-done-icon">${icon('check')}</div>
        <h2>¡Todo al día!</h2>
        <p class="muted">${done ? `Has revisado ${done} movimiento${done === 1 ? '' : 's'}.` : 'No tienes movimientos pendientes.'}</p>
        <a class="btn btn-primary" href="#/inicio">Volver al inicio</a>
      </div>`;
    timer = setTimeout(() => navigate('inicio'), 1800);
  };

  /* ---------- Lista ---------- */
  const showList = () => {
    const list = [...pendingReview()].sort(byArrival);
    if (!list.length) return finish();
    const ready = list.filter(hasCategory);

    root.innerHTML = `
      <div class="topbar">
        <a class="left" href="#/inicio">Cerrar</a>
        <h2>Por revisar</h2>
        <span class="muted review-step">${list.length}</span>
      </div>
      <p class="hint" style="margin:-6px 4px 14px">Toca un movimiento para revisarlo. La hora es cuando llegó el pago.</p>

      <div class="list review-list">${list.map((t) => {
        const cat = hasCategory(t) ? categoryById(t.category) : null;
        return `<button class="row" data-review="${esc(t.id)}">
          <span class="icon">${icon(cat?.icon || 'box')}</span>
          <span class="main">
            <div class="title">${esc(t.description || (t.type === 'income' ? 'Ingreso' : 'Gasto'))}</div>
            <div class="subtitle">${esc(arrived(t))} · ${esc(SOURCE[t.source] || 'Auto')}${t.location ? ` · ${icon('pin')}` : ''}</div>
            <div class="subtitle">${cat ? esc(cat.name) : '<span class="review-missing small">Sin categoría</span>'}${t.paidBy ? ` · lo paga ${esc(payerById(t.paidBy).name)}` : ''}</div>
          </span>
          <span class="trail num ${t.type === 'income' ? 'pos' : 'neg'}">${signedMoney(t.amount, t.type)}</span>
        </button>`;
      }).join('')}</div>

      ${ready.length ? `<div class="save-bar">
        <button type="button" class="btn btn-primary" id="rv-all">${icon('check')} Confirmar ${ready.length === list.length ? (ready.length === 1 ? '' : 'todos') : ready.length === 1 ? 'el que tiene categoría' : `los ${ready.length} con categoría`}</button>
      </div>` : ''}
    `;

    root.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', () => showEditor(b.dataset.review)));
    root.querySelector('#rv-all')?.addEventListener('click', () => {
      ready.forEach((t) => updateTransaction(t.id, { revisado: true }));
      done += ready.length;
      toast(`${ready.length} confirmado${ready.length === 1 ? '' : 's'}`);
      showList();
    });
  };

  /* ---------- Edición de uno ---------- */
  const showEditor = (id) => {
    const t = pendingReview().find((x) => x.id === id);
    if (!t) return showList();
    const cats = categoriesOf(t.type);
    let category = hasCategory(t) ? t.category : '';

    root.innerHTML = `
      <div class="topbar">
        <button type="button" class="left" id="rv-back">‹ Lista</button>
        <h2>Revisar</h2>
        <span></span>
      </div>

      <div class="review-meta">
        <span class="chip">${esc(arrived(t))}</span>
        <span class="chip">${esc(SOURCE[t.source] || 'Automático')}</span>
        <span class="chip">${t.type === 'income' ? 'Ingreso' : 'Gasto'}</span>
        ${t.paidBy ? `<span class="chip">Lo paga ${esc(payerById(t.paidBy).name)}</span>` : ''}
        ${t.location ? `<span class="chip">${icon('pin')} Con ubicación</span>` : ''}
      </div>

      <div class="amount-input">
        <input id="rv-amount" class="num" inputmode="decimal" autocomplete="off" aria-label="Importe" value="${esc(amountToInput(t.amount))}">
        <span class="currency">€</span>
      </div>
      ${t.currency ? `<div class="amount-hint">Original: ${esc(amountToInput(t.originalAmount))} ${currencySymbol(t.currency)}</div>` : '<div class="amount-hint"></div>'}

      <div class="field-group">
        <div class="field"><label for="rv-desc">Concepto</label>
          <input id="rv-desc" type="text" autocomplete="off" placeholder="Comercio o descripción" value="${esc(t.description)}"></div>
        <div class="field"><label for="rv-date">Fecha</label>
          <input id="rv-date" type="date" value="${esc(t.date)}"></div>
      </div>

      <div class="section-title" style="margin-top:0">Categoría ${category ? '' : '<span class="review-missing">Sin categoría</span>'}</div>
      <div class="cat-grid">${cats.map((c) => `
        <button type="button" class="cat" data-cat="${esc(c.id)}" aria-pressed="${c.id === category}">
          <span class="cat-ico">${icon(c.icon)}</span><span>${esc(c.name)}</span>
        </button>`).join('')}</div>

      <div class="save-bar review-actions">
        <button type="button" class="btn btn-danger" id="rv-del">${icon('trash')} Eliminar</button>
        <button type="button" class="btn btn-primary" id="rv-ok">${icon('check')} Confirmar</button>
      </div>
    `;
    window.scrollTo(0, 0);

    const $ = (s) => root.querySelector(s);
    const amountEl = $('#rv-amount');
    const refresh = () => { $('#rv-ok').disabled = !(parseAmount(amountEl.value) > 0 && category); };

    $('#rv-back').addEventListener('click', showList);

    root.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      category = b.dataset.cat;
      root.querySelectorAll('[data-cat]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      root.querySelector('.review-missing')?.remove();
      refresh();
    }));

    amountEl.addEventListener('input', () => {
      let v = amountEl.value.replace(/[^\d.,]/g, '').replace('.', ',');
      const [int, ...rest] = v.split(',');
      if (rest.length) v = `${int},${rest.join('').slice(0, 2)}`;
      amountEl.value = v;
      refresh();
    });

    $('#rv-ok').addEventListener('click', () => {
      const amount = parseAmount(amountEl.value);
      if (!(amount > 0)) return toast('Importe no válido');
      if (!category) return toast('Elige una categoría');
      updateTransaction(t.id, {
        amount: round2(amount), description: $('#rv-desc').value.trim(),
        date: $('#rv-date').value || t.date || todayISO(), category, revisado: true,
      });
      done++;
      toast('Confirmado');
      showList();
    });

    $('#rv-del').addEventListener('click', () => {
      if (!confirm(`¿Eliminar "${t.description || 'este movimiento'}" de ${money(t.amount)}?`)) return;
      deleteTransaction(t.id);
      done++;
      toast('Eliminado');
      showList();
    });

    refresh();
  };

  showList();

  return () => {
    clearTimeout(timer);
    document.body.classList.remove('is-modal');
  };
}
