// Guía paso a paso: crear tu propio buzón de Google (código + script) y los 3 Atajos del iPhone.
// Cada paso lleva un dibujo de la pantalla que vas a ver con lo que hay que tocar resaltado.
// Google aparece en español; el iPhone, con los nombres en inglés (entre paréntesis en español).

import { getState, setSetting } from '../store.js';
import { mailboxConfig, newToken, testMailbox, pullMailbox, mailboxScript } from '../mailbox.js';
import { esc, icon, toast } from '../ui.js';

// Enlaces de iCloud para instalar los atajos de un toque (vacío = solo instrucciones).
const SHORTCUT_LINKS = { ingreso: '', gasto: '' };

/* ---------- Dibujos ------------------------------------------------------ */

const tap = (txt, extra = '') => `<span class="mk-tap ${extra}">${txt}</span>`;

// Ventana de ordenador estilo Google (clara).
const desk = (title, body) => `<div class="mock mk-desk" aria-hidden="true">
  <div class="mk-titlebar"><i></i><i></i><i></i><span>${title}</span></div>${body}</div>`;

// Pantalla de iPhone (oscura).
const phone = (body) => `<div class="mock mk-phone" aria-hidden="true"><div class="mk-notch"></div>${body}</div>`;

const field = (k, v, hot = false) => `<div class="mk-field ${hot ? 'hot' : ''}"><span>${k}</span><b>${v}</b></div>`;

/* ---------- Pasos -------------------------------------------------------- */

function steps(ctx) {
  const { token, url, user } = ctx;
  const copyRow = (label, value, key) => `<div class="guide-copy">
    <span class="muted">${label}</span><code>${esc(value || '—')}</code>
    ${value ? `<button type="button" class="link-btn" data-copy="${key}">Copiar</button>` : ''}</div>`;

  const jsonBody = (type, amount, merchant, extra = []) => `
    <div class="guide-table">
      <div class="gt-head"><span>Key (clave)</span><span>Value (valor)</span></div>
      <div><code>token</code><span>${esc(token)} <button type="button" class="link-btn" data-copy="token">Copiar</button></span></div>
      <div><code>user</code><span>${esc(user || 'tu nombre')}${user ? ' <button type="button" class="link-btn" data-copy="user">Copiar</button>' : ''}</span></div>
      <div><code>type</code><span>${type}</span></div>
      <div><code>amount</code><span>${amount}</span></div>
      <div><code>merchant</code><span>${merchant}</span></div>
      ${extra.map(([k, v]) => `<div><code>${k}</code><span>${v}</span></div>`).join('')}
      <div><code>lat</code><span class="var">Current Location › Latitude</span></div>
      <div><code>lon</code><span class="var">Current Location › Longitude</span></div>
    </div>`;

  const urlAction = `
    <ol class="steps" start="4">
      <li>Pulsa <b>Add Action</b> y busca <b>Get Current Location</b> (ubicación actual).</li>
      <li>Añade <b>Get Contents of URL</b>. En la URL pega la de tu buzón ${url ? '<button type="button" class="link-btn" data-copy="url">Copiar URL</button>' : '(paso 8)'}.</li>
      <li>Toca la flecha <b>›</b> → <b>Method: POST</b> → <b>Request Body: JSON</b>.</li>
      <li>Con <b>Add new field → Text</b> crea estos campos. Lo que está en <span class="var">azul</span> es una variable: tócala en la barra sobre el teclado (y vuelve a tocarla para elegir la propiedad).</li>
    </ol>`;

  const manualShortcut = (type, verb) => `
    ${phone(`<div class="mk-ios-title">${verb}</div>
      <div class="mk-action"><b>Ask for Input</b> · Number · “¿Cuánto?”</div>
      <div class="mk-action"><b>Set Variable</b> · Importe</div>
      <div class="mk-action"><b>Ask for Input</b> · Text · “¿Concepto?”</div>
      <div class="mk-action"><b>Set Variable</b> · Concepto</div>
      <div class="mk-action"><b>Get Current Location</b></div>
      <div class="mk-action hot"><b>Get Contents of URL</b> · POST · JSON</div>`)}
    <ol class="steps">
      <li>App <b>Shortcuts</b> → pestaña <b>Shortcuts</b> → <b>+</b>. Ponle de nombre <b>${verb}</b>.</li>
      <li><b>Ask for Input</b> → tipo <b>Number</b>, pregunta “¿Cuánto?”. Debajo <b>Set Variable</b> → nombre <b>Importe</b>.</li>
      <li><b>Ask for Input</b> → tipo <b>Text</b>, pregunta “¿Concepto?”. Debajo <b>Set Variable</b> → <b>Concepto</b>.
        <br><span class="muted">Así no se te mezclan los dos “Provided Input”.</span></li>
    </ol>
    ${urlAction}
    ${jsonBody(type, '<span class="var">Importe</span>', '<span class="var">Concepto</span>')}
    <p class="hint" style="margin:10px 4px 0">Para tenerlo a mano: mantén pulsado el atajo → <b>Share → Add to Home Screen</b>, o añádelo como widget.</p>`;

  const link = (key) => SHORTCUT_LINKS[key] ? `<a class="btn btn-primary" href="${esc(SHORTCUT_LINKS[key])}" target="_blank" rel="noopener">${icon('download')} Añadir el atajo de un toque</a>
    <p class="hint" style="margin:8px 4px 16px">Al instalarlo te preguntará tu <b>URL</b>, tu <b>código</b> y tu <b>nombre</b> (cópialos arriba). Si prefieres hacerlo a mano:</p>` : '';

  return [
    {
      title: 'Tu buzón automático',
      body: `
        <div class="guide-hero">${icon('inbox')}</div>
        <p>El buzón es una <b>hoja de Google tuya</b>. Los atajos del iPhone le envían cada pago al momento,
          <b>sin abrir la app</b>, y al entrar la app los recoge y te los deja en <b>Revisar</b>.</p>
        <ul class="steps">
          <li>Gratis, solo necesitas una cuenta de Google.</li>
          <li>La primera parte se hace mejor en el <b>ordenador</b> (unos 10 minutos).</li>
          <li>Luego creas <b>3 atajos</b> en el iPhone: Apple Pay, ingresos y gastos de Bizum/online.</li>
        </ul>
        <div class="card" style="margin-top:8px">
          <p class="muted" style="margin:0 0 12px;font-size:14px">¿Alguien de tu familia ya tiene buzón? No hace falta crear otro:
            pídele su <b style="color:var(--text)">código</b> y su <b style="color:var(--text)">URL</b> y ve directo al paso 8.</p>
          <button type="button" class="btn" data-goto="7">Unirme a uno que ya existe</button>
        </div>`,
    },
    {
      title: 'Tu código secreto y tu script',
      body: `
        <p>Este código es la <b>llave</b> de tu buzón: solo quien lo tenga puede enviar o leer pagos. La app ya te ha creado uno y lo ha metido en tu script.</p>
        ${copyRow('Tu código', token, 'token')}
        <button type="button" class="btn btn-primary" data-copy="script" style="margin-top:14px">${icon('download')} Copiar mi script</button>
        <p class="hint" style="margin:10px 4px 0">Si lo vas a pegar en el ordenador, mándatelo a ti mismo (Notas, correo o WhatsApp) o abre esta app en el ordenador: <b>deliio.github.io/finanzas</b>.</p>`,
    },
    {
      title: 'Crea una hoja de Google',
      body: `
        ${desk('Hoja de cálculo sin título', `
          <div class="mk-menu">Archivo&nbsp; Editar&nbsp; Ver&nbsp; Insertar&nbsp; Formato&nbsp; Datos&nbsp; ${tap('Extensiones')}&nbsp; Ayuda</div>
          <div class="mk-dropdown" style="left:46%"><div>Complementos</div><div>Macros</div>${tap('Apps Script', 'mk-line')}</div>
          <div class="mk-grid"></div>`)}
        <ol class="steps">
          <li>En el ordenador entra en <b>sheets.new</b> (crea una hoja vacía). Ponle de nombre “Buzón”, por ejemplo.</li>
          <li>Menú <b>Extensiones → Apps Script</b>. Se abre una pestaña nueva con el editor.</li>
        </ol>
        <a class="btn" href="https://sheets.new" target="_blank" rel="noopener">Abrir sheets.new</a>`,
    },
    {
      title: 'Pega el script',
      body: `
        ${desk('Apps Script · Proyecto sin título', `
          <div class="mk-toolbar"><span>Código.gs</span><span class="mk-sp"></span>${tap('💾 Guardar')}<span>▶ Ejecutar</span><span class="mk-blue">Implementar ▾</span></div>
          <pre class="mk-code"><s>function myFunction() {\n\n}</s>\n<em>// Buzón de Finanzas · pega esto…\nconst TOKEN = '${esc(token)}';\nconst HOJA = 'Buzon';\n…</em></pre>`)}
        <ol class="steps">
          <li>Borra todo lo que hay (<b>function myFunction…</b>): Ctrl+A y Suprimir.</li>
          <li>Pega tu script (Ctrl+V). Arriba debe verse <b>const TOKEN = '${esc(token)}'</b>.</li>
          <li>Pulsa <b>💾 Guardar</b> (o Ctrl+S).</li>
        </ol>`,
    },
    {
      title: 'Implementa como aplicación web',
      body: `
        ${desk('Apps Script', `
          <div class="mk-toolbar"><span>Código.gs</span><span class="mk-sp"></span>${tap('Implementar ▾', 'blue')}</div>
          <div class="mk-dropdown" style="right:8px">${tap('Nueva implementación', 'mk-line')}<div>Gestionar implementaciones</div><div>Probar implementaciones</div></div>
          <div class="mk-dialog" style="margin-top:96px"><b>Nueva implementación</b>
            <div class="mk-row">Seleccionar tipo ${tap('⚙️')}</div>
            <div class="mk-dropdown inline">${tap('Aplicación web', 'mk-line')}<div>API ejecutable</div><div>Complemento</div></div></div>`)}
        <ol class="steps">
          <li>Arriba a la derecha: <b>Implementar → Nueva implementación</b>.</li>
          <li>Junto a “Seleccionar tipo” pulsa la <b>rueda ⚙️</b> → <b>Aplicación web</b>.</li>
        </ol>`,
    },
    {
      title: 'Quién puede usarlo',
      body: `
        ${desk('Nueva implementación', `
          <div class="mk-dialog">
            ${field('Descripción', 'Buzón')}
            ${field('Ejecutar como', 'Yo (tu correo)')}
            ${field('Quién tiene acceso', 'Cualquier usuario', true)}
            <div class="mk-actions"><span>Cancelar</span>${tap('Implementar', 'blue')}</div>
          </div>`)}
        <ol class="steps">
          <li><b>Ejecutar como:</b> Yo.</li>
          <li><b>Quién tiene acceso:</b> <b>Cualquier usuario</b>. Ojo: no “Solo yo” ni “Cualquier usuario con cuenta de Google”, o el atajo no podrá enviar.</li>
          <li>Pulsa <b>Implementar</b>.</li>
        </ol>
        <p class="hint" style="margin:10px 4px 0">Tranquilo: sin tu código secreto nadie puede leer ni escribir nada.</p>`,
    },
    {
      title: 'Autoriza el script',
      body: `
        ${desk('accounts.google.com', `
          <div class="mk-dialog">
            <b>Google no ha verificado esta aplicación</b>
            <p>La aplicación solicita acceso a información sensible de tu cuenta…</p>
            <div class="mk-actions" style="justify-content:space-between">${tap('Configuración avanzada', 'link')}<span class="mk-blue">Volver a seguridad</span></div>
            <p>${tap('Ir a Proyecto sin título (no seguro)', 'link')}</p>
            <div class="mk-actions"><span>Cancelar</span>${tap('Permitir', 'blue')}</div>
          </div>`)}
        <ol class="steps">
          <li>Pulsa <b>Autorizar acceso</b> y elige tu cuenta.</li>
          <li>Sale “Google no ha verificado esta aplicación”: es normal, el script es <b>tuyo</b>. Pulsa <b>Configuración avanzada</b> → <b>Ir a … (no seguro)</b>.</li>
          <li>Pulsa <b>Permitir</b>. Así puede escribir en tu hoja.</li>
        </ol>`,
    },
    {
      title: 'Conecta la app',
      body: `
        ${desk('Nueva implementación', `
          <div class="mk-dialog"><b>Implementación actualizada</b>
            <div class="mk-row">Aplicación web</div>
            ${field('URL', 'https://script.google.com/macros/s/AKfy…/exec', true)}
            <div class="mk-actions">${tap('Copiar', 'link')}<span class="mk-blue">Hecho</span></div></div>`)}
        <p>Copia la <b>URL</b> (termina en <b>/exec</b>) y pégala aquí. Si te unes al buzón de tu familia, pon <b>su</b> código y <b>su</b> URL.</p>
        <div class="field-group">
          <div class="field"><label for="g-token">Código</label>
            <input id="g-token" class="mono" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(token)}"></div>
          <div class="field"><label for="g-user">Tu nombre</label>
            <input id="g-user" maxlength="20" placeholder="Ej.: Deli, Papi…" autocomplete="off" value="${esc(user)}"></div>
          <div class="field"><label for="g-url">URL</label>
            <input id="g-url" type="url" placeholder="https://script.google.com/…/exec" autocomplete="off" autocapitalize="off" value="${esc(url)}"></div>
        </div>
        <p class="hint">Tu nombre separa tus pagos de los de tu familia si compartís buzón. Escríbelo igual en tus atajos.</p>
        <button type="button" class="btn btn-primary" id="g-connect">Guardar y probar</button>`,
    },
    {
      title: 'Atajo 1 · Pagos con Apple Pay',
      body: `
        ${phone(`<div class="mk-ios-title">New Automation</div>
          <div class="mk-action">Personal Automation</div>
          <div class="mk-action hot"><b>Transaction</b> (Wallet)</div>
          <div class="mk-action">When I tap: <b>todas tus tarjetas</b></div>
          <div class="mk-action">${tap('Run Immediately', 'mk-line')}</div>`)}
        <p>Se ejecuta solo cada vez que pagas con el móvil en una tienda.</p>
        <ol class="steps">
          <li>App <b>Shortcuts</b> → pestaña <b>Automation</b> → <b>+</b> → <b>Transaction</b> (Wallet).</li>
          <li>En <b>When I tap</b> marca <b>todas</b> las tarjetas con las que pagas.</li>
          <li>Elige <b>Run Immediately</b> (ejecutar sin preguntar) → <b>Next</b> → <b>New Blank Automation</b>.</li>
        </ol>
        ${urlAction}
        ${jsonBody('expense', '<span class="var">Shortcut Input › Amount</span>', '<span class="var">Shortcut Input › Merchant</span>',
          [['card', '<span class="var">Shortcut Input › Card or Pass</span>']])}`,
    },
    {
      title: 'Atajo 2 · Apuntar un ingreso',
      body: `<p>Para Bizums recibidos, nómina, regalos… Lo lanzas tú y te pregunta cuánto y de qué.</p>
        ${link('ingreso')}${manualShortcut('income', 'Ingreso')}`,
    },
    {
      title: 'Atajo 3 · Gasto de Bizum o compra online',
      body: `<p>Los pagos que no pasan por Apple Pay en tienda (Bizum enviado, compras por internet…).</p>
        ${link('gasto')}${manualShortcut('expense', 'Gasto')}`,
    },
    {
      title: '¡Listo!',
      body: `
        <div class="guide-hero ok">${icon('check')}</div>
        <ol class="steps">
          <li>Prueba un atajo (por ejemplo el de gasto con 1 €).</li>
          <li>Abre la app: verás “1 pago recibido” y lo tendrás en <b>Revisar</b>.</li>
          <li>En <b>Ajustes → Buzón → Últimos recibidos</b> ves lo que llegó tal cual (con ubicación y tarjeta).</li>
        </ol>
        <div class="card" style="margin-top:8px">
          <p class="muted" style="margin:0 0 10px;font-size:14px">Para que alguien de tu familia use <b style="color:var(--text)">tu</b> buzón, pásale esto y que ponga su propio nombre:</p>
          ${copyRow('Código', token, 'token')}
          ${copyRow('URL', url, 'url')}
        </div>
        <a class="btn btn-primary" href="#/ajustes" style="margin-top:16px">Volver a Ajustes</a>`,
    },
  ];
}

/* ---------- Vista -------------------------------------------------------- */

export function render(root) {
  document.body.classList.add('is-modal');
  const settings = getState().settings;
  const current = mailboxConfig();
  const ctx = {
    token: current.token || settings.mailboxDraftToken || newToken(),
    url: current.url || '',
    user: current.user || '',
  };
  if (!current.token && !settings.mailboxDraftToken) setSetting('mailboxDraftToken', ctx.token);
  let i = Math.min(Number(settings.guideStep) || 0, 11);

  const show = () => {
    const list = steps(ctx);
    const step = list[i];
    setSetting('guideStep', i);
    root.innerHTML = `
      <div class="topbar">
        <a class="left" href="#/ajustes">Cerrar</a>
        <h2>Guía</h2>
        <span class="muted review-step">${i + 1}/${list.length}</span>
      </div>
      <div class="guide-progress"><span style="width:${((i + 1) / list.length) * 100}%"></span></div>
      <div class="guide-kicker">${i < 8 ? 'Google · en el ordenador' : 'iPhone · app Atajos'}</div>
      <h1 class="guide-title">${step.title}</h1>
      <div class="guide-body">${step.body}</div>
      <div class="guide-nav">
        <button type="button" class="btn" id="g-prev" ${i === 0 ? 'disabled' : ''}>‹ Atrás</button>
        ${i < list.length - 1 ? '<button type="button" class="btn btn-primary" id="g-next">Siguiente ›</button>' : ''}
      </div>`;
    window.scrollTo(0, 0);

    const $ = (s) => root.querySelector(s);
    $('#g-prev').addEventListener('click', () => { if (i > 0) { i--; show(); } });
    $('#g-next')?.addEventListener('click', () => { i++; show(); });
    root.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { i = Number(b.dataset.goto); show(); }));

    root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const what = b.dataset.copy;
      const text = what === 'script' ? mailboxScript(ctx.token) : ctx[what];
      try { await navigator.clipboard.writeText(text); toast(what === 'script' ? 'Script copiado' : 'Copiado'); }
      catch { alert('No se pudo copiar. Inténtalo de nuevo.'); }
    }));

    $('#g-connect')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const config = { url: $('#g-url').value.trim(), token: $('#g-token').value.trim(), user: $('#g-user').value.trim() };
      if (config.token.length < 8) return toast('El código debe tener al menos 8 caracteres');
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(config.url)) return toast('Pega la URL de la aplicación web (script.google.com)');
      btn.disabled = true; btn.textContent = 'Probando…';
      try {
        await testMailbox(config);
        setSetting('mailbox', config);
        setSetting('reviewEnabled', true);
        Object.assign(ctx, config);
        toast('Buzón conectado');
        pullMailbox().catch(() => {});
        i++; show();
      } catch (err) {
        alert(err.message);
        btn.disabled = false; btn.textContent = 'Guardar y probar';
      }
    });
  };

  show();
  return () => document.body.classList.remove('is-modal');
}
