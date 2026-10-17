// Secciones reordenables (Inicio y Patrimonio): cada página envuelve sus secciones con
// block(id, html) y, tras pintarse, applyOrder() las coloca en el orden que eligió el usuario.
// El orden se guarda en settings.layout[pagina] = [ids].

import { getState, setSetting } from './store.js';
import { esc, openSheet } from './ui.js';

/** Envuelve una sección. Si no hay contenido, no pinta nada (pero su sitio se recuerda). */
export const block = (id, html) => (html && html.trim() ? `<div class="block" data-block="${id}">${html}</div>` : '');

const savedOrder = (page) => getState().settings.layout?.[page] || [];

/** Orden completo: el guardado y, detrás, las secciones nuevas en su orden original. */
function fullOrder(page, defs) {
  const ids = defs.map((d) => d.id);
  const saved = savedOrder(page).filter((id) => ids.includes(id));
  return [...saved, ...ids.filter((id) => !saved.includes(id))];
}

/** Recoloca las secciones pintadas según el orden guardado. */
export function applyOrder(root, page, defs) {
  const blocks = [...root.querySelectorAll('[data-block]')];
  if (!blocks.length || !savedOrder(page).length) return;
  const parent = blocks[0].parentNode;
  // Punto de inserción: justo después de lo que va antes de la primera sección (cabecera, avisos…).
  const anchor = blocks[0].previousSibling;
  const order = fullOrder(page, defs);
  const sorted = blocks.sort((a, b) => order.indexOf(a.dataset.block) - order.indexOf(b.dataset.block));
  let ref = anchor;
  for (const b of sorted) {
    parent.insertBefore(b, ref ? ref.nextSibling : parent.firstChild);
    ref = b;
  }
}

/** Botón al final de la página. */
export const orderButton = () => '<button type="button" class="order-link" data-order>⇅ Ordenar secciones</button>';

/** Hoja con flechas para subir/bajar secciones. onChange redibuja la página detrás. */
export function openOrderSheet(page, defs, onChange) {
  const label = (id) => defs.find((d) => d.id === id)?.label || id;
  const { el } = openSheet(`
    <h3 class="sheet-title">Ordenar secciones</h3>
    <p class="hint" style="margin:-6px 4px 14px">Sube o baja cada sección. Las que están vacías no se ven, pero guardan su sitio.</p>
    <div class="list order-list"></div>
    <button class="btn" type="button" id="order-reset" style="margin-top:14px">Orden original</button>
    <button class="btn btn-primary" type="button" data-close>Hecho</button>`);

  const draw = () => {
    const order = fullOrder(page, defs);
    el.querySelector('.order-list').innerHTML = order.map((id, i) => `
      <div class="row">
        <span class="main"><div class="title">${esc(label(id))}</div></span>
        <span class="order-btns">
          <button type="button" class="icon-btn" data-move="${i}" data-dir="-1" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-btn" data-move="${i}" data-dir="1" aria-label="Bajar" ${i === order.length - 1 ? 'disabled' : ''}>↓</button>
        </span>
      </div>`).join('');
  };

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-move]');
    if (btn) {
      const order = fullOrder(page, defs);
      const i = Number(btn.dataset.move);
      const j = i + Number(btn.dataset.dir);
      [order[i], order[j]] = [order[j], order[i]];
      setSetting('layout', { ...(getState().settings.layout || {}), [page]: order });
    } else if (e.target.closest('#order-reset')) {
      const { [page]: _, ...rest } = getState().settings.layout || {};
      setSetting('layout', rest);
    } else return;
    draw();
    onChange();
  });
  draw();
}
