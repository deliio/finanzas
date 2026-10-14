// Revisar movimientos: bandeja de los que entraron solos (Atajos, URL, recurrentes)
// con la revisión activada. Se revisan de uno en uno: categoría, importe y concepto
// editables, y "Confirmar" o "Eliminar". Al terminar: "¡Todo al día!" y vuelta a Inicio.

import { getState, pendingReview, updateTransaction, deleteTransaction, categoriesOf, payerById, todayISO, round2 } from '../store.js';
import { esc, icon, money, parseAmount, amountToInput, toast, currencySymbol } from '../ui.js';

const SOURCE = { atajo: 'Apple Pay · Atajo', url: 'Atajo (enlace)', recurrente: 'Pago recurrente' };

export function render(root, { navigate }) {
  document.body.classList.add('is-modal');
  let total = pendingReview().length; // para el "1 de N"
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

  const draw = () => {
    const t = pendingReview()[0];
    if (!t) return finish();
    total = Math.max(total, done + pendingReview().length);
    const cats = categoriesOf(t.type);
    let category = cats.some((c) => c.id === t.category) ? t.category : '';

    root.innerHTML = `
      <div class="topbar">
        <a class="left" href="#/inicio">Cerrar</a>
        <h2>Revisar</h2>
        <span class="muted review-step">${done + 1} de ${total}</span>
      </div>
      <div class="progress review-progress"><span style="width:${(done / total) * 100}%;background:var(--text)"></span></div>

      <div class="review-meta">
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

    const $ = (s) => root.querySelector(s);
    const amountEl = $('#rv-amount');
    const refresh = () => {
      const ok = parseAmount(amountEl.value) > 0 && category;
      $('#rv-ok').disabled = !ok;
    };

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
      draw();
    });

    $('#rv-del').addEventListener('click', () => {
      if (!confirm(`¿Eliminar "${t.description || 'este movimiento'}" de ${money(t.amount)}?`)) return;
      deleteTransaction(t.id);
      done++;
      toast('Eliminado');
      draw();
    });

    refresh();
  };

  draw();

  return () => {
    clearTimeout(timer);
    document.body.classList.remove('is-modal');
  };
}
