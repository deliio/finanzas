// Ajustes: idioma y moneda, buzón, tarjetas, presupuestos, categorías, copia de seguridad, exportación Power BI (#16),
// clave de Finnhub y borrado de datos.

import { getState, replaceState, resetState, todayISO, setSetting, addRecurring, updateRecurring, deleteRecurring,
  runRecurring, categoriesOf, categoryById, normalizeTags, round2, setBudget, payers, payerById, addPayer, updatePayer, removePayer, pendingReview, markAllReviewed,
  addCategory, updateCategory, deleteCategory, categoryUsage, fallbackCategory,
  creditCards, addCreditCard, updateCreditCard, deleteAccount, cardPending, nextChargeDate } from '../store.js';
import { accountOptionsHtml } from './nuevo-gasto.js';
import { ICONS } from '../icons.js';
import { fetchQuote, estimateHolding } from '../market.js';
import { mailboxConfig, mailboxReady, newToken, testMailbox, pullMailbox, mailboxScript, locationStatus } from '../mailbox.js';
import { stateToCSV, csvToState, powerBIFiles } from '../csv.js';
import { toast, esc, usd, money, icon, openSheet, parseAmount, amountToInput, CUR } from '../ui.js';
import { LOCALE, LANG, LANGUAGES, BASE, CURRENCIES, currencyName } from '../i18n.js';
import { currencySymbol } from '../ui.js';

let catKind = 'expense'; // pestaña del gestor de categorías

export function render(root) {
  const { transactions, accounts, settings, recurring } = getState();

  root.innerHTML = `
    <div class="topbar" style="margin-bottom:0"><a class="left" href="#/inicio">‹ Inicio</a><span></span><span></span></div>
    <header class="page-header" style="margin-top:0"><h1>Ajustes</h1></header>

    <div class="section-title" style="margin-top:8px">Idioma y moneda</div>
    <div class="field-group" style="margin-bottom:0">
      <div class="field"><label for="set-lang">Idioma</label>
        <select id="set-lang" data-no-i18n>${LANGUAGES.map(([v, n]) => `<option value="${v}" ${v === LANG ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="field"><label for="set-cur">Moneda</label>
        <select id="set-cur">${CURRENCIES.map((c) => `<option value="${c}" ${c === BASE ? 'selected' : ''}>${currencySymbol(c)} · ${esc(currencyName(c))}</option>`).join('')}</select></div>
    </div>
    <p class="hint" style="margin:8px 4px 0">La moneda en la que apuntas y ves todo. Los gastos en otras monedas se convierten a esta.</p>

    <div class="section-title">Revisión</div>
    <div class="field-group" style="margin-bottom:0">
      <div class="field"><label for="rev-toggle" class="wide">Revisión manual diaria</label>
        <span class="field-note">${((n) => (settings.reviewEnabled && n ? `${n} pendiente${n === 1 ? '' : 's'}` : ''))(pendingReview().length)}</span>
        <input id="rev-toggle" type="checkbox" class="switch" role="switch" ${settings.reviewEnabled ? 'checked' : ''}></div>
    </div>
    <p class="hint" style="margin:8px 4px 0">Activada: los pagos que llegan por Atajos y los recurrentes se guardan al momento
      como <b>pendientes</b> y los confirmas después desde Inicio. Desactivada: todo entra ya revisado.</p>

    <div class="section-title">Buzón automático</div>
    ${mailboxReady() ? `<div class="list">
      <button class="row" data-action="mailbox">
        <span class="icon">${icon('inbox')}</span>
        <span class="main"><div class="title">Conectado${mailboxConfig().user ? ` · ${esc(mailboxConfig().user)}` : ''}</div>
          <div class="subtitle">Los pagos del Atajo llegan solos a pendientes</div></span>
        <span class="trail muted">${icon('chevron')}</span>
      </button></div>
      <button class="btn" type="button" data-action="mailbox-pull" style="margin-top:10px">Recoger pagos ahora</button>`
    : `<div class="card">
        <p class="muted" style="margin:0 0 14px;font-size:15px">Con un buzón en tu cuenta de Google, el Atajo envía cada pago
          <b style="color:var(--text)">sin abrir la app</b> y al entrar ya los tienes en pendientes. Gratis; sirve para toda la familia.</p>
        <button class="btn btn-primary" type="button" data-action="mailbox">Configurar buzón</button>
      </div>`}

    <a class="btn" href="#/guia" style="margin-top:10px">${icon('book')} Guía paso a paso: buzón y atajos</a>

    <div class="section-title">Tarjetas de crédito <button class="link-btn" data-action="add-card">+ Añadir</button></div>
    ${creditCards().length ? `<div class="list">${creditCards().map((c) => `
      <button class="row" data-card="${esc(c.id)}">
        <span class="icon">${icon('card')}</span>
        <span class="main"><div class="title">${esc(c.name)}</div>
          <div class="subtitle">Se cobra ${c.chargeDay === 31 ? 'el último día del mes' : `el día ${c.chargeDay}`} de ${esc(accounts.find((a) => a.id === c.chargeAccount)?.name || '—')}</div></span>
        <span class="trail num neg">${cardPending(c) ? '−' + money(cardPending(c)) : ''}</span>
      </button>`).join('')}</div>`
      : `<div class="card empty" style="padding:18px">¿Tienes una tarjeta que te cobra todo a fin de mes? Añádela: sus gastos cuentan al momento, pero no bajan tu cuenta hasta el día de cobro.</div>`}

    <div class="section-title">Presupuestos mensuales</div>
    <div class="list">${categoriesOf('expense').map((c) => `
      <button class="row" data-budget="${esc(c.id)}">
        <span class="icon">${icon(c.icon)}</span>
        <span class="main"><div class="title">${esc(c.name)}</div></span>
        <span class="trail num ${c.budget > 0 ? '' : 'muted'}">${c.budget > 0 ? money(c.budget, { decimals: false }) : 'Sin límite'}</span>
      </button>`).join('')}</div>
    <p class="hint" style="margin:8px 4px 0">Las categorías con presupuesto aparecen como anillos en Inicio. Lo que te pagan otras personas no cuenta.</p>

    <div class="section-title">Categorías <button class="link-btn" data-action="add-cat">+ Nueva</button></div>
    <div class="segmented small" role="group" aria-label="Tipo de categoría">
      <button type="button" data-catkind="expense" aria-pressed="${catKind === 'expense'}">Gastos</button>
      <button type="button" data-catkind="income" aria-pressed="${catKind === 'income'}">Ingresos</button>
    </div>
    <div class="list">${categoriesOf(catKind).map((c) => `
      <button class="row" data-cat-edit="${esc(c.id)}">
        <span class="icon" style="color:${c.color}">${icon(c.icon)}</span>
        <span class="main"><div class="title">${esc(c.name)}</div>
          <div class="subtitle">${((n) => `${n} movimiento${n === 1 ? '' : 's'}`)(categoryUsage(c.id))}</div></span>
        <span class="trail color-trail"><span class="swatch" style="background:${c.color}"></span>${icon('chevron')}</span>
      </button>`).join('')}</div>
    <p class="hint" style="margin:8px 4px 0">Toca una para cambiar su nombre, icono o color. El color se usa en las gráficas.</p>

    <div class="section-title">Pagado por otras personas <button class="link-btn" data-action="add-payer">+ Añadir</button></div>
    ${payers().length ? `<div class="list">${payers().map((p) => `
      <button class="row" data-payer="${esc(p.id)}">
        <span class="icon">${icon('user')}</span>
        <span class="main"><div class="title">Pagado por ${esc(p.name)}</div>
          <div class="subtitle">${((n) => `${n} gasto${n === 1 ? '' : 's'}`)(transactions.filter((t) => t.paidBy === p.id).length)}</div></span>
        <span class="trail muted">${icon('chevron')}</span>
      </button>`).join('')}</div>`
      : `<div class="card empty" style="padding:18px">¿Alguien te paga algunos gastos (tu padre, tu pareja…)? Añádelo y al apuntar un gasto podrás elegir quién lo paga. Contará como gasto, pero no restará de tus cuentas, y tendrá su propia gráfica.</div>`}

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
      <a class="btn" href="https://finnhub.io/register" target="_blank" rel="noopener" style="margin-bottom:10px">${icon('trending')} Conseguir clave gratis en Finnhub</a>
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
    const b = e.target.closest('[data-budget]');
    if (b) return openBudgetSheet(b.dataset.budget, () => render(root));
    if (e.target.closest('[data-action="mailbox"]')) return openMailboxSheet(() => render(root));
    if (e.target.closest('[data-action="mailbox-pull"]')) {
      return pullMailbox()
        .then((n) => { toast(n ? `${n} pago${n === 1 ? '' : 's'} recibido${n === 1 ? '' : 's'}` : 'No hay pagos nuevos'); render(root); })
        .catch((err) => alert(err.message));
    }
    const kindBtn = e.target.closest('[data-catkind]');
    if (kindBtn) { catKind = kindBtn.dataset.catkind; return render(root); }
    if (e.target.closest('[data-action="add-cat"]')) return openCategorySheet(null, catKind, () => render(root));
    const catEdit = e.target.closest('[data-cat-edit]');
    if (catEdit) return openCategorySheet(catEdit.dataset.catEdit, catKind, () => render(root));
    if (e.target.closest('[data-action="add-card"]')) return openCardSheet(null, () => render(root));
    const card = e.target.closest('[data-card]');
    if (card) return openCardSheet(card.dataset.card, () => render(root));
    if (e.target.closest('[data-action="add-payer"]')) return openPayerSheet(null, () => render(root));
    const p = e.target.closest('[data-payer]');
    if (p) openPayerSheet(p.dataset.payer, () => render(root));
  };

  root.querySelector('#set-lang').addEventListener('change', (e) => {
    setSetting('language', e.target.value);
    location.reload(); // los textos y formatos se aplican al arrancar
  });
  root.querySelector('#set-cur').addEventListener('change', (e) => {
    const has = getState().transactions.length || getState().accounts.length;
    if (has && !confirm('Los importes que ya tienes no se convierten: solo cambia la moneda en la que se muestran y apuntas. Si tienes inversiones, actualiza luego su valor real. ¿Cambiar?')) {
      e.target.value = BASE;
      return;
    }
    setSetting('currency', e.target.value);
    location.reload();
  });
  root.querySelector('#rev-toggle').addEventListener('change', (e) => {
    const on = e.target.checked;
    setSetting('reviewEnabled', on);
    const pending = pendingReview().length;
    if (!on && pending && confirm(`Tienes ${pending} movimiento${pending === 1 ? '' : 's'} sin revisar. ¿Marcarlos como revisados?`)) markAllReviewed();
    toast(on ? 'Revisión activada' : 'Revisión desactivada');
    render(root);
  });

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

/* ---------- Presupuestos ----------------------------------------------- */

/** Hoja para fijar el presupuesto mensual de una categoría (también se abre desde Inicio). */
export function openBudgetSheet(categoryId, onDone) {
  const c = categoryById(categoryId);
  const { el, close } = openSheet(`
    <h3 class="sheet-title">${esc(c.name)}</h3>
    <p class="muted" style="text-align:center;margin:-8px 0 16px;font-size:14px">¿Cuánto quieres gastar como máximo al mes?</p>
    <form id="b-form">
      <div class="amount-input" style="margin-bottom:18px">
        <input id="b-amount" class="num" inputmode="decimal" autocomplete="off" placeholder="0"
               value="${c.budget > 0 ? esc(amountToInput(c.budget).replace(',00', '')) : ''}" aria-label="Presupuesto">
        <span class="currency">${CUR}</span>
      </div>
      <button class="btn btn-primary" type="submit">Guardar</button>
      ${c.budget > 0 ? '<button class="btn" type="button" id="b-clear">Quitar presupuesto</button>' : ''}
      <button class="btn" type="button" data-close>Cancelar</button>
    </form>
  `);
  const save = (amount) => {
    setBudget(c.id, amount);
    close();
    toast(amount > 0 ? `Presupuesto de ${c.name}: ${money(amount, { decimals: false })}` : `${c.name} sin límite`);
    onDone?.();
  };
  el.querySelector('#b-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = el.querySelector('#b-amount').value.trim();
    const amount = raw ? parseAmount(raw) : 0;
    if (!Number.isFinite(amount) || amount < 0) return toast('Importe no válido');
    save(amount);
  });
  el.querySelector('#b-clear')?.addEventListener('click', () => save(0));
}

/* ---------- Buzón automático ------------------------------------------- */

function openMailboxSheet(onDone) {
  const current = mailboxConfig();
  const token = current.token || getState().settings.mailboxDraftToken || newToken();
  if (!current.token) setSetting('mailboxDraftToken', token); // mismo código aunque cierres y vuelvas
  const { el, close } = openSheet(`
    <h3 class="sheet-title">Buzón automático</h3>
    <ol class="steps">
      <li>¿Te unes al buzón de alguien de tu familia? Pon <b>su código y su URL</b>, tu nombre y pulsa <b>Guardar y probar</b>. Si no, sigue:</li>
      <li>Pulsa <b>Copiar script</b>.</li>
      <li>En el ordenador, crea una hoja en <b>sheets.new</b> → <b>Extensiones → Apps Script</b>, borra lo que haya y pega.</li>
      <li><b>Implementar → Nueva implementación → Aplicación web</b>: ejecutar como <b>Yo</b>, acceso <b>Cualquier usuario</b>. Autoriza y copia la URL.</li>
      <li>Pega aquí la URL y pulsa <b>Guardar y probar</b>.</li>
    </ol>
    <div class="field-group">
      <div class="field"><label for="mb-token">Código</label>
        <input id="mb-token" class="mono" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(token)}"></div>
      <div class="field"><label for="mb-user">Tu nombre</label>
        <input id="mb-user" maxlength="20" placeholder="Para compartir el buzón" autocomplete="off" value="${esc(current.user || '')}"></div>
      <div class="field"><label for="mb-url">URL</label>
        <input id="mb-url" type="url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off" value="${esc(current.url || '')}"></div>
    </div>
    <button class="btn" type="button" id="mb-copy">${icon('download')} Copiar script</button>
    <button class="btn btn-primary" type="button" id="mb-save">Guardar y probar</button>
    ${current.url ? '<button class="btn btn-danger" type="button" id="mb-del">Quitar buzón</button>' : ''}
    ${(getState().settings.mailboxLog || []).length ? `<div class="section-title" style="font-size:16px">Últimos recibidos</div>
      <div class="list kv">${getState().settings.mailboxLog.map((l) => `<div class="row">
        <span class="main">${esc(l.merchant || '(sin concepto)')} · ${esc(String(l.amount))}<div class="subtitle">${esc(String(l.at).slice(0, 16).replace('T', ' '))} · ${l.type === 'income' ? 'ingreso' : 'gasto'}</div></span>
        <span class="trail ${locationStatus(l).ok ? 'pos' : 'neg'}">${esc(locationStatus(l).text)}</span></div>`).join('')}</div>
      <p class="hint" style="margin-top:8px">"Sin ubicación": el Atajo no la envía (revisa <b>Get Current Location</b> y los permisos de Atajos). "⚠️": llega pero se guardó mal; actualiza el script del buzón (Copiar script → pegar → Nueva versión).</p>` : ''}
    <button class="btn" type="button" data-close>Cerrar</button>
  `);
  const $ = (s) => el.querySelector(s);
  // Editable: para unirse a un buzón que ya existe (familia), se pone el mismo código.
  const codeValue = () => $('#mb-token').value.trim();
  $('#mb-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(mailboxScript(codeValue())); toast('Script copiado'); }
    catch { alert('No se pudo copiar. Inténtalo de nuevo.'); }
  });
  $('#mb-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const config = { url: $('#mb-url').value.trim(), token: codeValue(), user: $('#mb-user').value.trim() };
    if (config.token.length < 8) return toast('El código debe tener al menos 8 caracteres');
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(config.url)) return toast('Pega la URL de la aplicación web de Apps Script');
    btn.disabled = true; btn.textContent = 'Probando…';
    try {
      const waiting = await testMailbox(config);
      setSetting('mailbox', config);
      setSetting('reviewEnabled', true); // lo que llega del buzón se revisa en la bandeja
      close();
      toast(waiting ? `Conectado · ${waiting} pago${waiting === 1 ? '' : 's'} esperando` : 'Buzón conectado');
      await pullMailbox().catch(() => {});
      onDone();
    } catch (err) {
      alert(err.message);
      btn.disabled = false; btn.textContent = 'Guardar y probar';
    }
  });
  $('#mb-del')?.addEventListener('click', () => {
    if (!confirm('¿Quitar el buzón? Los pagos que ya recibiste se quedan.')) return;
    setSetting('mailbox', null); close(); onDone();
  });
}

/* ---------- Categorías: nombre, icono y color --------------------------- */

// Sugerencias que quedan bien sobre negro (incluye verde neón).
const SWATCHES = ['#ffffff', '#8e8e93', '#39ff14', '#32d74b', '#00e5ff', '#64d2ff', '#0a84ff', '#5e5ce6',
  '#bf5af2', '#ff2d95', '#ff375f', '#ff453a', '#ff9f0a', '#ffd60a', '#a2845e', '#30b0c7'];

// Iconos disponibles para las categorías.
const CAT_ICONS = ['cart', 'utensils', 'coffee', 'car', 'fuel', 'plane', 'home', 'film', 'heart', 'dumbbell', 'bag', 'gift',
  'book', 'phone', 'repeat', 'paw', 'briefcase', 'wallet', 'bank', 'trending', 'piggy', 'card', 'plus', 'box'].filter((k) => ICONS[k]);

/** Crear (id = null) o editar una categoría: nombre, icono y color. */
function openCategorySheet(categoryId, kind, onDone) {
  const c = categoryId ? categoryById(categoryId) : null;
  kind = c?.kind ?? kind;
  let color = c?.color ?? SWATCHES[2];
  let iconName = c?.icon ?? 'box';
  const used = c ? categoryUsage(c.id) : 0;
  const isFallback = c && c.id === fallbackCategory(kind);
  const { el, close } = openSheet(`
    <h3 class="sheet-title">${c ? 'Editar categoría' : `Nueva categoría de ${kind === 'income' ? 'ingreso' : 'gasto'}`}</h3>
    <div class="color-preview"><span class="icon" id="cp-icon">${icon(iconName)}</span><span class="dot-lg" id="cp-dot"></span></div>
    <div class="field-group">
      <div class="field"><label for="cp-name">Nombre</label>
        <input id="cp-name" maxlength="24" placeholder="Gasolina, Universidad…" autocomplete="off" value="${esc(c?.name ?? '')}"></div>
    </div>
    <div class="area-label">Icono</div>
    <div class="icon-grid">${CAT_ICONS.map((k) => `<button type="button" class="icon-pick" data-icon="${k}" aria-label="${k}">${icon(k)}</button>`).join('')}</div>
    <div class="area-label">Color</div>
    <div class="swatch-grid">${SWATCHES.map((s) => `<button type="button" class="swatch-btn" data-swatch="${s}" style="background:${s}" aria-label="${s}"></button>`).join('')}</div>
    <div class="field-group" style="margin-top:16px">
      <div class="field"><label for="cp-hex">Código</label>
        <input id="cp-hex" maxlength="7" autocapitalize="characters" spellcheck="false" placeholder="#39FF14"></div>
      <div class="field"><label for="cp-picker">Otro color</label>
        <span class="field-note">Elegir libremente</span>
        <input id="cp-picker" type="color" class="color-input"></div>
    </div>
    <button class="btn btn-primary" type="button" id="cp-save">Guardar</button>
    ${c && !isFallback ? `<button class="btn btn-danger" type="button" id="cp-del">Eliminar categoría</button>` : ''}
    <button class="btn" type="button" data-close>Cancelar</button>
    ${isFallback ? '<p class="hint" style="margin-top:10px">"Otros" no se puede borrar: es donde van los movimientos de las categorías que elimines.</p>' : ''}
  `);
  const $ = (s) => el.querySelector(s);
  const paint = (fromInput) => {
    $('#cp-dot').style.background = color;
    $('#cp-icon').style.color = color;
    $('#cp-icon').innerHTML = icon(iconName);
    el.querySelectorAll('[data-icon]').forEach((b) => b.classList.toggle('selected', b.dataset.icon === iconName));
    if (fromInput !== 'hex') $('#cp-hex').value = color.toUpperCase();
    if (fromInput !== 'picker') $('#cp-picker').value = color;
    el.querySelectorAll('[data-swatch]').forEach((b) => b.classList.toggle('selected', b.dataset.swatch === color));
  };
  el.querySelectorAll('[data-swatch]').forEach((b) => b.addEventListener('click', () => { color = b.dataset.swatch; paint(); }));
  el.querySelectorAll('[data-icon]').forEach((b) => b.addEventListener('click', () => { iconName = b.dataset.icon; paint(); }));
  $('#cp-picker').addEventListener('input', (e) => { color = e.target.value.toLowerCase(); paint('picker'); });
  $('#cp-hex').addEventListener('input', (e) => {
    const v = ('#' + e.target.value.replace(/[^0-9a-f]/gi, '')).slice(0, 7).toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) { color = v; paint('hex'); }
  });
  $('#cp-save').addEventListener('click', () => {
    const name = $('#cp-name').value.trim();
    if (!name) return toast('Ponle un nombre');
    if (c) updateCategory(c.id, { name, icon: iconName, color });
    else addCategory({ kind, name, icon: iconName, color });
    close(); toast(c ? 'Categoría guardada' : `Categoría "${name}" creada`); onDone();
  });
  $('#cp-del')?.addEventListener('click', () => {
    const msg = used ? `¿Eliminar "${c.name}"? Sus ${used} movimiento${used === 1 ? '' : 's'} pasarán a "Otros".` : `¿Eliminar "${c.name}"?`;
    if (!confirm(msg)) return;
    deleteCategory(c.id); close(); toast('Categoría eliminada'); onDone();
  });
  paint();
}

/* ---------- Tarjetas de crédito ---------------------------------------- */

const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' });
const niceDate = (iso) => dateFmt.format(new Date(iso + 'T00:00:00'));

function openCardSheet(id, onDone) {
  const c = id ? creditCards().find((x) => x.id === id) : null;
  const banks = getState().accounts.filter((a) => a.kind === 'liquidez');
  if (!banks.length) return alert('Primero añade en Patrimonio la cuenta del banco desde la que se cobra la tarjeta.');
  const pending = c ? cardPending(c) : 0;
  const charges = c ? (getState().cardCharges || []).filter((x) => x.cardId === c.id).slice(-6).reverse() : [];
  const { el, close } = openSheet(`
    <h3 class="sheet-title">${c ? esc(c.name) : 'Nueva tarjeta de crédito'}</h3>
    ${c ? `<div class="goal-hero"><div class="num neg" style="font-size:28px;font-weight:700">${pending ? '−' + money(pending) : money(0)}</div>
      <div class="muted">pendiente · se cobra el ${niceDate(nextChargeDate(c))}</div></div>` : ''}
    <div class="field-group" style="margin-top:12px">
      <div class="field"><label for="cc-name">Nombre</label>
        <input id="cc-name" maxlength="24" placeholder="Visa Abanca" autocomplete="off" value="${esc(c?.name ?? '')}"></div>
      <div class="field"><label for="cc-acc">Se cobra de</label>
        <select id="cc-acc">${banks.map((a) => `<option value="${esc(a.id)}" ${a.id === c?.chargeAccount ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="cc-day">Día de cobro</label>
        <input id="cc-day" type="number" inputmode="numeric" min="1" max="31" value="${c?.chargeDay ?? 31}"></div>
    </div>
    <p class="hint" style="margin-top:-8px">31 = último día del mes. Ese día se resta de la cuenta todo lo gastado con la tarjeta desde el cobro anterior.</p>
    ${charges.length ? `<div class="section-title" style="font-size:16px">Últimos cobros</div>
      <div class="list kv">${charges.map((x) => `<div class="row"><span class="main">${niceDate(x.date)}</span><span class="trail num">−${money(x.amount)}</span></div>`).join('')}</div>` : ''}
    <button class="btn btn-primary" type="button" id="cc-save" style="margin-top:14px">Guardar</button>
    ${c ? '<button class="btn btn-danger" type="button" id="cc-del">Quitar tarjeta</button>' : ''}
    <button class="btn" type="button" data-close>Cancelar</button>
  `);
  const $ = (s) => el.querySelector(s);
  $('#cc-save').addEventListener('click', () => {
    const name = $('#cc-name').value.trim();
    const chargeDay = Number($('#cc-day').value);
    if (!name) return toast('Ponle un nombre');
    if (!(chargeDay >= 1 && chargeDay <= 31)) return toast('El día debe estar entre 1 y 31');
    const data = { name, chargeAccount: $('#cc-acc').value, chargeDay };
    if (c) updateCreditCard(c.id, data); else addCreditCard(data);
    close(); toast(c ? 'Tarjeta guardada' : 'Tarjeta añadida: ya puedes elegirla al apuntar gastos'); onDone();
  });
  $('#cc-del')?.addEventListener('click', () => {
    const msg = pending ? `Tiene ${money(pending)} pendientes que ya no se cobrarán de la cuenta. ¿Quitar ${c.name}?` : `¿Quitar ${c.name}?`;
    if (!confirm(msg)) return;
    deleteAccount(c.id); close(); onDone();
  });
}

/* ---------- Pagado por otras personas ---------------------------------- */

function openPayerSheet(id, onDone) {
  const p = id ? payerById(id) : null;
  const count = p ? getState().transactions.filter((t) => t.paidBy === p.id).length : 0;
  const { el, close } = openSheet(`
    <h3 class="sheet-title">${p ? `Pagado por ${esc(p.name)}` : 'Añadir persona'}</h3>
    <p class="muted" style="text-align:center;margin:-8px 0 16px;font-size:14px">
      Sus gastos cuentan como gasto, pero no restan de tus cuentas ni de tu patrimonio.</p>
    <form id="py-form">
      <div class="field-group">
        <div class="field"><label for="py-name">Nombre</label>
          <input id="py-name" required maxlength="20" placeholder="Papi, Mami, Laura…" value="${esc(p?.name ?? '')}"></div>
      </div>
      <button class="btn btn-primary" type="submit">Guardar</button>
      ${p ? '<button class="btn btn-danger" type="button" id="py-del">Quitar</button>' : ''}
      <button class="btn" type="button" data-close>Cancelar</button>
    </form>
    ${p && count ? `<p class="hint" style="margin-top:12px">Si lo quitas, sus ${count} gastos se conservan con sus gráficas; solo deja de aparecer al apuntar gastos nuevos.</p>` : ''}
  `);
  el.querySelector('#py-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.querySelector('#py-name').value.trim();
    if (!name) return;
    if (p) updatePayer(p.id, { name }); else addPayer(name);
    close(); toast(p ? 'Guardado' : `Añadido: ahora puedes marcar gastos pagados por ${name}`); onDone();
  });
  el.querySelector('#py-del')?.addEventListener('click', () => {
    if (!confirm(`¿Quitar a ${p.name}?`)) return;
    removePayer(p.id); close(); onDone();
  });
}

/* ---------- Pagos recurrentes (#8) ------------------------------------- */

export function openRecurringForm(id, onDone) {
  const r = id ? getState().recurring.find((x) => x.id === id) : null;
  let type = r?.type ?? 'expense';
  const accounts = getState().accounts.filter((a) => a.kind === 'liquidez' || a.kind === 'tarjeta');

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
          <input id="r-amount" inputmode="decimal" required placeholder="${money(0)}" value="${r ? esc(amountToInput(r.amount)) : ''}"></div>
        <div class="field"><label for="r-day">Día de cobro</label>
          <input id="r-day" type="number" inputmode="numeric" min="1" max="31" required placeholder="1-31" value="${r?.day ?? ''}"></div>
        <div class="field"><label for="r-cat">Categoría</label><select id="r-cat"></select></div>
        ${accounts.length ? `<div class="field"><label for="r-acc">Cuenta</label>
          <select id="r-acc">${accountOptionsHtml(accounts, r?.account)}
            <option value="" ${r && !r.account ? 'selected' : ''}>Ninguna</option></select></div>` : ''}
        ${payers().length ? `<div class="field" id="r-payer-row"><label for="r-payer">Lo paga</label>
          <select id="r-payer"><option value="">Yo</option>
            ${payers().map((p) => `<option value="${esc(p.id)}" ${p.id === r?.paidBy ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select></div>` : ''}
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
    if ($('#r-payer-row')) $('#r-payer-row').hidden = type === 'income';
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
      category: $('#r-cat').value, account: $('#r-acc')?.value ?? '', tags: r?.tags || [],
      paidBy: type === 'expense' ? ($('#r-payer')?.value ?? '') : '',
    };
    if (data.paidBy) data.account = '';
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
