// Ajustes: pagos recurrentes (#8), copia de seguridad, exportación Power BI (#16),
// clave de Finnhub y borrado de datos.

import { getState, replaceState, resetState, todayISO, setSetting, addRecurring, updateRecurring, deleteRecurring,
  runRecurring, categoriesOf, categoryById, normalizeTags, round2 } from '../store.js';
import { fetchQuote, estimateHolding } from '../market.js';
import { stateToCSV, csvToState, powerBIFiles } from '../csv.js';
import { toast, esc, usd, money, icon, openSheet, parseAmount, amountToInput } from '../ui.js';

export function render(root) {
  const { transactions, accounts, settings, recurring } = getState();

  root.innerHTML = `
    <header class="page-header"><h1>Ajustes</h1></header>

    <div class="section-title" style="margin-top:8px">Pagos recurrentes <button class="link-btn" data-action="add-rec">+ Añadir</button></div>
    ${recurring.length ? `<div class="list">${recurring.map((r) => {
      const cat = categoryById(r.category);
      return `<button class="row ${r.active ? '' : 'is-paused'}" data-rec="${esc(r.id)}">
        <span class="icon">${icon(cat.icon)}</span>
        <span class="main"><div class="title">${esc(r.name)}</div>
          <div class="subtitle">Día ${r.day} de cada mes · ${esc(cat.name)}${r.active ? '' : ' · <strong>en pausa</strong>'}</div></span>
        <span class="trail num ${r.type === 'income' ? 'pos' : 'neg'}">${r.type === 'income' ? '+' : '−'}${money(r.amount)}</span>
      </button>`;
    }).join('')}</div>
    <p class="hint" style="margin:8px 4px 0">Se apuntan solos el día de cobro al abrir la app (y los atrasados si no la abriste).</p>`
      : `<div class="card empty" style="padding:18px">Suscripciones, gimnasio, alquiler, nómina… defínelos una vez y se apuntan solos cada mes.</div>`}

    <div class="section-title">Copia de seguridad</div>
    <div class="card">
      <p class="muted" style="margin:0 0 16px;font-size:15px">
        Tus datos solo viven en este dispositivo
        (${transactions.length} movimientos, ${accounts.length} partidas de patrimonio).
        Exporta una copia de vez en cuando.
      </p>
      <button id="export" class="btn btn-primary" type="button">Exportar datos a CSV</button>
      <button id="import" class="btn" type="button">Importar CSV</button>
      <input id="import-file" type="file" accept=".csv,text/csv" hidden>
    </div>

    <div class="section-title">Data Science</div>
    <div class="card">
      <p class="muted" style="margin:0 0 16px;font-size:15px">
        Exporta tablas limpias para <strong style="color:var(--text)">Power BI</strong>: transacciones (con año, mes,
        trimestre, día de la semana…), etiquetas, categorías, cuentas, histórico de patrimonio, inversiones y huchas.
      </p>
      <button id="export-bi" class="btn" type="button">${icon('download')} Exportar para Power BI</button>
    </div>

    <div class="section-title">Cotizaciones · Finnhub</div>
    <div class="card">
      <p class="muted" style="margin:0 0 14px;font-size:15px">
        Pega tu <strong style="color:var(--text)">API key</strong> completa (usa el botón de copiar del panel de Finnhub).
        Se guarda únicamente en este dispositivo y no se incluye en el CSV.
      </p>
      <div class="field-group" style="margin-bottom:12px">
        <div class="field"><label for="fh-key">API key</label>
          <input id="fh-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"
                 placeholder="Sin configurar" value="${esc(settings.finnhubKey || '')}"></div>
      </div>
      <button id="fh-save" class="btn btn-primary" type="button">Guardar y probar</button>
    </div>

    <div class="section-title">Zona peligrosa</div>
    <button id="reset" class="btn btn-danger" type="button">Borrar todos los datos</button>

    <p class="muted" style="text-align:center;font-size:13px;margin-top:28px">Finanzas · v0.2</p>
  `;

  // onclick (no addEventListener): render() se vuelve a llamar sobre el mismo root.
  root.onclick = (e) => {
    if (e.target.closest('[data-action="add-rec"]')) return openRecurringForm(null, () => render(root));
    const rec = e.target.closest('[data-rec]');
    if (rec) openRecurringForm(rec.dataset.rec, () => render(root));
  };

  root.querySelector('#fh-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const key = root.querySelector('#fh-key').value.trim();
    if (!key) { setSetting('finnhubKey', ''); return toast('Clave eliminada'); }
    btn.disabled = true; btn.textContent = 'Probando…';
    try {
      const q = await fetchQuote('VOO', key);
      setSetting('finnhubKey', key);
      toast(`Conectado · VOO ${usd(q.price)}`);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar y probar';
    }
  });

  root.querySelector('#export').addEventListener('click', () =>
    shareFiles([{ name: `finanzas-backup-${todayISO()}.csv`, content: stateToCSV(getState()) }], 'Copia exportada'));
  root.querySelector('#export-bi').addEventListener('click', () =>
    shareFiles(powerBIFiles(getState(), { estimateHolding }).map((f) => ({ ...f, name: `${todayISO()}_${f.name}` })), 'Tablas exportadas'));

  const fileInput = root.querySelector('#import-file');
  root.querySelector('#import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const next = csvToState(await file.text());
      const msg = `Se importarán ${next.transactions.length} movimientos y ${next.accounts.length} partidas.\n` +
                  'Esto REEMPLAZA los datos actuales. ¿Continuar?';
      if (!confirm(msg)) return;
      replaceState(next);
      toast('Datos importados');
      render(root);
    } catch (err) {
      alert(err.message || 'No se pudo leer el archivo.');
    }
  });

  root.querySelector('#reset').addEventListener('click', () => {
    if (!confirm('Se borrarán todos los movimientos y el patrimonio de este dispositivo. ¿Seguro?')) return;
    resetState();
    toast('Datos borrados');
    render(root);
  });
}

/* ---------- Pagos recurrentes (#8) ------------------------------------- */

function openRecurringForm(id, onDone) {
  const r = id ? getState().recurring.find((x) => x.id === id) : null;
  let type = r?.type ?? 'expense';
  const accounts = getState().accounts.filter((a) => a.kind === 'liquidez');

  const { el, close } = openSheet(`
    <h3 class="sheet-title">${r ? 'Pago recurrente' : 'Nuevo pago recurrente'}</h3>
    <div class="segmented" role="group">
      <button type="button" data-rtype="expense">Gasto</button>
      <button type="button" data-rtype="income">Ingreso</button>
    </div>
    <form id="r-form">
      <div class="field-group">
        <div class="field"><label for="r-name">Concepto</label>
          <input id="r-name" required placeholder="Gimnasio, Netflix…" value="${esc(r?.name ?? '')}"></div>
        <div class="field"><label for="r-amount">Importe</label>
          <input id="r-amount" inputmode="decimal" required placeholder="0,00 €" value="${r ? esc(amountToInput(r.amount)) : ''}"></div>
        <div class="field"><label for="r-day">Día de cobro</label>
          <input id="r-day" type="number" inputmode="numeric" min="1" max="31" required placeholder="1-31" value="${r?.day ?? ''}"></div>
        <div class="field"><label for="r-cat">Categoría</label><select id="r-cat"></select></div>
        ${accounts.length ? `<div class="field"><label for="r-acc">Cuenta</label>
          <select id="r-acc">${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === r?.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
            <option value="" ${r && !r.account ? 'selected' : ''}>Ninguna</option></select></div>` : ''}
        <div class="field"><label for="r-tags">Etiquetas</label>
          <input id="r-tags" placeholder="#suscripciones" autocapitalize="off" value="${esc((r?.tags || []).map((t) => '#' + t).join(' '))}"></div>
        ${r ? `<div class="field"><label for="r-active">Activo</label><span class="field-note"></span>
          <input id="r-active" type="checkbox" class="switch" role="switch" ${r.active ? 'checked' : ''}></div>`
          : `<div class="field"><label for="r-done">Ya pagado</label><span class="field-note">este mes</span>
          <input id="r-done" type="checkbox" class="switch" role="switch"></div>`}
      </div>
      ${r ? '' : '<p class="hint" style="margin-top:-8px">Si el día de cobro de este mes ya pasó y no lo has apuntado, deja "Ya pagado" desactivado y se añadirá ahora.</p>'}
      <button class="btn btn-primary" type="submit">Guardar</button>
      ${r ? '<button class="btn btn-danger" type="button" id="r-del">Eliminar</button>' : ''}
      <button class="btn" type="button" data-close>Cancelar</button>
    </form>
  `);

  const $ = (s) => el.querySelector(s);
  const renderType = () => {
    el.querySelectorAll('[data-rtype]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rtype === type)));
    const cats = categoriesOf(type);
    const selected = r?.type === type ? r.category : (type === 'expense' ? 'suscripciones' : 'nomina');
    $('#r-cat').innerHTML = cats.map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rtype]');
    if (b) { type = b.dataset.rtype; renderType(); }
  });

  $('#r-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseAmount($('#r-amount').value);
    const day = Number($('#r-day').value);
    if (!(amount > 0)) return toast('Importe no válido');
    if (!(day >= 1 && day <= 31)) return toast('El día debe estar entre 1 y 31');
    const data = {
      name: $('#r-name').value.trim(), type, amount: round2(amount), day,
      category: $('#r-cat').value, account: $('#r-acc')?.value ?? '', tags: normalizeTags($('#r-tags').value),
    };
    if (r) updateRecurring(r.id, { ...data, active: $('#r-active').checked });
    else addRecurring({ ...data, alreadyThisMonth: $('#r-done').checked });
    const added = runRecurring();
    close();
    toast(added ? `Guardado · ${added} cargo${added > 1 ? 's' : ''} apuntado${added > 1 ? 's' : ''}` : 'Guardado');
    onDone();
  });

  $('#r-del')?.addEventListener('click', () => {
    if (!confirm(`¿Eliminar ${r.name}? Los movimientos ya apuntados se conservan.`)) return;
    deleteRecurring(r.id); close(); onDone();
  });

  renderType();
}

/* ---------- Compartir / descargar archivos ----------------------------- */

async function shareFiles(list, doneMsg) {
  const files = list.map((f) => new File([f.content], f.name, { type: 'text/csv' }));
  // En iOS (PWA instalada) la hoja de compartir permite "Guardar en Archivos" (varios a la vez).
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: list.length > 1 ? 'Finanzas · Power BI' : list[0].name });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = Object.assign(document.createElement('a'), { href: url, download: f.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    await new Promise((res) => setTimeout(res, 250)); // los navegadores bloquean descargas simultáneas
  }
  toast(doneMsg);
}
