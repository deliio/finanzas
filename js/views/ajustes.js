// Ajustes: copia de seguridad CSV y borrado de datos.

import { getState, replaceState, resetState, todayISO, setSetting } from '../store.js';
import { fetchQuote } from '../market.js';
import { stateToCSV, csvToState } from '../csv.js';
import { toast, esc, usd } from '../ui.js';

export function render(root) {
  const { transactions, accounts, settings } = getState();

  root.innerHTML = `
    <header class="page-header"><h1>Ajustes</h1></header>

    <div class="section-title" style="margin-top:8px">Copia de seguridad</div>
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

    <div class="section-title">Cotizaciones · Finnhub</div>
    <div class="card">
      <p class="muted" style="margin:0 0 14px;font-size:15px">
        Pega solo la <strong style="color:var(--text)">API key</strong> (20 caracteres), no el Webhook Secret.
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

    <p class="muted" style="text-align:center;font-size:13px;margin-top:28px">Finanzas · v0.1</p>
  `;

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

  root.querySelector('#export').addEventListener('click', exportCSV);
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

async function exportCSV() {
  const filename = `finanzas-backup-${todayISO()}.csv`;
  const blob = new Blob([stateToCSV(getState())], { type: 'text/csv;charset=utf-8' });

  // En iOS (PWA instalada) la hoja de compartir permite "Guardar en Archivos".
  const file = new File([blob], filename, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Copia exportada');
}
