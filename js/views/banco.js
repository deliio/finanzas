// Ajustes → Banco: servidor (URL + token), conectar/reconectar cada banco (Abanca, MyInvestor),
// cuenta enlazada, MyInvestor manual (si no está conectado) y reglas de categorías.
// Solo aparece activo en tu móvil si lo configuras.

import { getState, setSetting, categoriesOf, categoryById } from '../store.js';
import { BANKS, bankName, bankConfig, bankState, bankReady, bankConnected, needsReconnect, bankExpired, syncAgo,
  testBankServer, startConnect, refreshStatus, syncBank, disconnectBank, connectedBanks } from '../bank.js';
import { esc, icon, toast, openSheet } from '../ui.js';
import { LOCALE } from '../i18n.js';

const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
const saveBank = (patch) => setSetting('bank', { ...bankConfig(), ...patch });
const saveBankState = (id, patch) => {
  const c = bankConfig();
  setSetting('bank', { ...c, banks: { ...(c.banks || {}), [id]: { ...(c.banks?.[id] || {}), ...patch } } });
};

export function bankSectionHtml() {
  return `<div id="bank-section">${sectionInner()}</div>`;
}

/** Bloque de un banco: estado, conectar/reconectar y cuenta de la app enlazada. */
function bankBlock(id) {
  const name = bankName(id);
  if (!bankConnected(id)) {
    return `<div class="list" style="margin-top:10px"><div class="row">
      <span class="icon">${icon('bank')}</span>
      <span class="main"><div class="title">${esc(name)}</div><div class="subtitle">Sin conectar</div></span>
      <button class="link-btn" type="button" data-bank="connect" data-id="${id}">Conectar</button>
    </div></div>`;
  }
  const s = bankState(id);
  const expired = bankExpired(id);
  const usedByOthers = new Set(BANKS.filter((b) => b.id !== id).map((b) => bankState(b.id).accountId));
  const options = getState().accounts.filter((a) => a.kind === 'liquidez' && !usedByOthers.has(a.id));
  return `<div class="list" style="margin-top:10px"><div class="row">
      <span class="icon">${icon('bank')}</span>
      <span class="main"><div class="title">${esc(name)} ${expired ? '<span class="review-missing small">Caducada</span>' : ''}</div>
        <div class="subtitle">${s.validUntil ? `${expired ? 'Caducó' : 'Conectada hasta'} el ${dateFmt.format(new Date(s.validUntil))}` : 'Conectada'} · sincronizada ${syncAgo(id)}</div></span>
      <button class="link-btn" type="button" data-bank="disconnect" data-id="${id}">Quitar</button>
    </div></div>
    ${needsReconnect(id) ? `<button class="btn btn-primary" type="button" data-bank="connect" data-id="${id}" style="margin-top:10px">Reconectar ${esc(name)}</button>` : ''}
    <div class="field-group" style="margin:10px 0 0">
      <div class="field"><label for="bk-acc-${id}">En la app</label>
        <select id="bk-acc-${id}" data-acc-for="${id}">${options.map((a) => `<option value="${esc(a.id)}" ${a.id === s.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
      ${(s.accounts || []).length > 1 ? `<div class="field"><label for="bk-iban-${id}">Cuenta del banco</label>
        <select id="bk-iban-${id}" data-iban-for="${id}">${s.accounts.map((a) => `<option value="${esc(a.iban)}" ${a.iban === s.iban ? 'selected' : ''}>${esc(a.name || a.iban)} · ${esc(a.iban.slice(-4))}</option>`).join('')}</select></div>` : ''}
    </div>`;
}

function sectionInner() {
  const c = bankConfig();
  const title = '<div class="section-title">Bancos</div>';
  if (!bankReady()) {
    return `${title}<div class="card">
      <p class="muted" style="margin:0 0 14px;font-size:15px">Conecta <b style="color:var(--text)">Abanca</b> y <b style="color:var(--text)">MyInvestor</b> para que los saldos y los
        movimientos lleguen solos. Necesitas tu servidor (Worker) ya desplegado.</p>
      <button class="btn btn-primary" type="button" data-bank="setup">Configurar banco</button>
    </div>`;
  }
  const anyConnected = connectedBanks().length > 0;
  const miConnected = bankConnected('myinvestor');
  const linked = new Set(connectedBanks().map((b) => bankState(b).accountId));
  const others = getState().accounts.filter((a) => a.kind !== 'deuda' && !linked.has(a.id));
  return `${title}
    ${BANKS.map((b) => bankBlock(b.id)).join('')}
    ${anyConnected ? '<button class="btn" type="button" data-bank="sync" style="margin-top:12px">Sincronizar ahora</button>' : ''}
    <p class="hint" style="margin:8px 4px 0">El saldo de cada cuenta enlazada es el del banco. Lo que pasa entre tus cuentas es un <b>traspaso</b>:
      no cuenta como ingreso ni gasto.${miConnected ? '' : ' Si solo pone "MyInvestor" en el concepto, te lo pregunto en Revisar.'}</p>

    ${miConnected ? '' : `<div class="field-group" style="margin:14px 0 0">
      <div class="field"><label for="bk-mi">MyInvestor (manual)</label>
        <select id="bk-mi"><option value="">Sin traspasos</option>${others.map((a) => `<option value="${esc(a.id)}" ${a.id === c.myInvestorId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="bk-mi-iban">Su IBAN</label>
        <input id="bk-mi-iban" class="mono" style="font-size:12px" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ES00 0000 0000 0000 0000 0000" value="${esc(c.myInvestorIban || '')}"></div>
    </div>`}

    <div class="list" style="margin-top:14px">
      <button class="row" type="button" data-bank="rules">
        <span class="icon">${icon('tag')}</span>
        <span class="main"><div class="title">Reglas de categorías</div>
          <div class="subtitle">${(c.rules || []).length} regla${(c.rules || []).length === 1 ? '' : 's'} · se aprenden al revisar</div></span>
        <span class="trail muted">${icon('chevron')}</span>
      </button>
      <button class="row" type="button" data-bank="setup">
        <span class="icon">${icon('gear')}</span>
        <span class="main"><div class="title">Servidor</div><div class="subtitle">${esc(String(c.url).replace(/^https:\/\//, ''))}</div></span>
        <span class="trail muted">${icon('chevron')}</span>
      </button>
    </div>`;
}

/** Engancha los botones de la sección (su contenedor se crea de nuevo en cada pintado). */
export function bindBankSection(page, rerender) {
  const root = page.querySelector('#bank-section');
  if (!root) return;
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-bank]');
    if (!btn) return;
    const action = btn.dataset.bank;
    const id = btn.dataset.id;
    try {
      if (action === 'setup') return openServerSheet(rerender);
      if (action === 'rules') return openRulesSheet(rerender);
      if (action === 'connect') { btn.disabled = true; btn.textContent = `Abriendo ${bankName(id)}…`; return await startConnect(id); }
      if (action === 'sync') {
        btn.disabled = true; btn.textContent = 'Sincronizando…';
        const n = await syncBank({ online: true });
        for (const b of connectedBanks()) await refreshStatus(b).catch(() => {});
        toast(n ? `${n} movimiento${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'} · en Revisar` : 'Todo al día');
        return rerender();
      }
      if (action === 'disconnect') {
        if (!confirm(`¿Desconectar ${bankName(id)}? Los movimientos que ya tienes se quedan.`)) return;
        await disconnectBank(id);
        toast(`${bankName(id)} desconectado`);
        return rerender();
      }
    } catch (err) {
      alert(err.message);
      rerender();
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.dataset.accFor) saveBankState(e.target.dataset.accFor, { accountId: e.target.value });
    if (e.target.dataset.ibanFor) saveBankState(e.target.dataset.ibanFor, { iban: e.target.value });
    if (e.target.id === 'bk-mi') saveBank({ myInvestorId: e.target.value });
    if (e.target.id === 'bk-mi-iban') {
      const iban = e.target.value.replace(/\s+/g, '').toUpperCase();
      if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return toast('Ese IBAN no parece válido');
      saveBank({ myInvestorIban: iban });
      toast(iban ? 'IBAN guardado' : 'IBAN quitado');
    }
  });
}

function openServerSheet(onDone) {
  const c = bankConfig();
  const { el, close } = openSheet(`
    <h3 class="sheet-title">Servidor del banco</h3>
    <p class="hint" style="margin:-6px 4px 14px">La dirección de tu Worker de Cloudflare y el token secreto (APP_TOKEN) que pusiste al desplegarlo.
      Se guardan solo en este móvil.</p>
    <div class="field-group">
      <div class="field"><label for="bs-url">URL</label>
        <input id="bs-url" type="url" placeholder="https://finanzas-banco.tu-usuario.workers.dev" autocomplete="off" autocapitalize="off" value="${esc(c.url || '')}"></div>
      <div class="field"><label for="bs-token">Token</label>
        <input id="bs-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(c.token || '')}"></div>
    </div>
    <button class="btn btn-primary" type="button" id="bs-save">Guardar y probar</button>
    <button class="btn" type="button" data-close>Cancelar</button>`);
  el.querySelector('#bs-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const config = { url: el.querySelector('#bs-url').value.trim().replace(/\/+$/, ''), token: el.querySelector('#bs-token').value.trim() };
    if (!/^https:\/\//.test(config.url)) return toast('Pega la URL del Worker (https://…)');
    if (config.token.length < 16) return toast('El token debe tener al menos 16 caracteres');
    btn.disabled = true; btn.textContent = 'Probando…';
    try {
      await testBankServer(config);
      saveBank(config);
      close();
      toast('Servidor listo');
      onDone();
    } catch (err) {
      alert(err.message);
      btn.disabled = false; btn.textContent = 'Guardar y probar';
    }
  });
}

function openRulesSheet(onDone) {
  const cats = [...categoriesOf('expense'), ...categoriesOf('income')];
  const { el } = openSheet(`
    <h3 class="sheet-title">Reglas de categorías</h3>
    <p class="hint" style="margin:-6px 4px 14px">Si el concepto del banco contiene el texto, el movimiento llega con esa categoría.
      También se crean solas cuando eliges la categoría al revisar.</p>
    <div class="list" id="rl-list"></div>
    <div class="field-group" style="margin-top:14px">
      <div class="field"><label for="rl-match">Contiene</label>
        <input id="rl-match" autocomplete="off" placeholder="MERCADONA"></div>
      <div class="field"><label for="rl-cat">Categoría</label>
        <select id="rl-cat">${cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.kind === 'income' ? ' (ingreso)' : ''}</option>`).join('')}</select></div>
    </div>
    <button class="btn btn-primary" type="button" id="rl-add">Añadir regla</button>
    <button class="btn" type="button" data-close>Hecho</button>`);
  const draw = () => {
    const rules = bankConfig().rules || [];
    el.querySelector('#rl-list').innerHTML = rules.length ? rules.map((r, i) => `
      <div class="row">
        <span class="icon">${icon(categoryById(r.category).icon || 'tag')}</span>
        <span class="main"><div class="title">${esc(r.match)}</div><div class="subtitle">→ ${esc(categoryById(r.category).name)}</div></span>
        <button type="button" class="icon-btn" data-del="${i}" aria-label="Eliminar">${icon('trash')}</button>
      </div>`).join('') : '<div class="row"><span class="main muted">Aún no hay reglas.</span></div>';
  };
  el.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const rules = [...(bankConfig().rules || [])];
      rules.splice(Number(del.dataset.del), 1);
      saveBank({ rules });
      draw(); onDone();
    }
  });
  el.querySelector('#rl-add').addEventListener('click', () => {
    const match = el.querySelector('#rl-match').value.trim();
    if (!match) return toast('Escribe el texto a buscar');
    saveBank({ rules: [...(bankConfig().rules || []), { match, category: el.querySelector('#rl-cat').value }] });
    el.querySelector('#rl-match').value = '';
    draw(); onDone();
  });
  draw();
}
