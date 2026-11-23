// Servidor del banco para Finanzas (Cloudflare Worker).
// Guarda en secreto la clave de Enable Banking, firma los JWT y hace de puente con ABANCA.
// La app (GitHub Pages) solo habla con este Worker, con un token propio (APP_TOKEN).
//
// Secretos (wrangler secret put):  EB_APP_ID · EB_PRIVATE_KEY (.pem) · APP_TOKEN
// Variables (wrangler.toml):       APP_URL · ALLOWED_ORIGIN · ASPSP_NAME · ASPSP_COUNTRY
// KV:                              BANK  (estado de la autorización y la sesión)
//
// Endpoints (todos con Authorization: Bearer APP_TOKEN salvo /callback):
//   GET  /aspsps      → datos del banco en Enable Banking (nombre exacto, validez máxima)
//   POST /connect     → empieza la autorización y devuelve { url } del banco
//   GET  /callback    → vuelta del banco: crea la sesión y redirige a la app
//   GET  /status      → { connected, status, validUntil, accounts }
//   POST /sync        → { accounts: [{ iban, balance, transactions }] } desde dateFrom
//   POST /disconnect  → cierra la sesión

const EB = 'https://api.enablebanking.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Psu-Online',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      // La vuelta del banco no lleva nuestro token: se valida con el "state".
      if (url.pathname === '/callback') return await callback(url, env);

      if (!authorized(request, env)) return json({ ok: false, error: 'token' }, 401);

      switch (`${request.method} ${url.pathname}`) {
        case 'GET /aspsps': return json({ ok: true, aspsp: await findAspsp(env) });
        case 'POST /connect': return json({ ok: true, ...(await connect(url, env)) });
        case 'GET /status': return json({ ok: true, ...(await status(env)) });
        case 'POST /sync': return json({ ok: true, ...(await sync(request, env)) });
        case 'POST /disconnect': return json({ ok: true, ...(await disconnect(env)) });
        default: return json({ ok: false, error: 'not_found' }, 404);
      }
    } catch (err) {
      const code = err.code || 'error';
      const status = code === 'expired' ? 409 : code === 'rate_limit' ? 429 : 502;
      return json({ ok: false, error: code, message: err.message }, status);
    }
  },
};

/* ---------- Seguridad ----------------------------------------------------- */

function authorized(request, env) {
  const got = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const want = env.APP_TOKEN || '';
  if (!want || got.length !== want.length) return false;
  let diff = 0; // comparación en tiempo constante
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

/* ---------- JWT RS256 para Enable Banking ------------------------------- */

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (text) => b64url(new TextEncoder().encode(text));

let keyCache = null;

/** La clave puede venir en PKCS#8 ("BEGIN PRIVATE KEY") o PKCS#1 ("BEGIN RSA PRIVATE KEY"). */
async function privateKey(env) {
  if (keyCache) return keyCache;
  const pem = String(env.EB_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem);
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  if (!b64) throw Object.assign(new Error('Falta el secreto EB_PRIVATE_KEY.'), { code: 'config' });
  let der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (isPkcs1) der = pkcs1ToPkcs8(der);
  keyCache = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  return keyCache;
}

function derLength(n) {
  if (n < 128) return [n];
  const out = [];
  while (n > 0) { out.unshift(n & 255); n >>= 8; }
  return [0x80 | out.length, ...out];
}

function pkcs1ToPkcs8(pkcs1) {
  const version = [0x02, 0x01, 0x00];
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]; // rsaEncryption, NULL
  const octet = [0x04, ...derLength(pkcs1.length)];
  const bodyLength = version.length + algorithm.length + octet.length + pkcs1.length;
  const head = [0x30, ...derLength(bodyLength), ...version, ...algorithm, ...octet];
  const out = new Uint8Array(head.length + pkcs1.length);
  out.set(head);
  out.set(pkcs1, head.length);
  return out;
}

async function jwt(env) {
  if (!env.EB_APP_ID) throw Object.assign(new Error('Falta el secreto EB_APP_ID.'), { code: 'config' });
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlText(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: env.EB_APP_ID }));
  const payload = b64urlText(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await privateKey(env), new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(signature)}`;
}

/** Llamada a Enable Banking. Traduce los errores de sesión caducada y de límite del banco. */
async function eb(env, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(EB + path, {
    method,
    headers: { Authorization: `Bearer ${await jwt(env)}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* respuesta no JSON */ }
  if (!res.ok) {
    if (/EXPIRED_SESSION|REVOKED_SESSION|CLOSED_SESSION|SESSION_DOES_NOT_EXIST|WRONG_SESSION_STATUS/.test(text)) {
      throw Object.assign(new Error('La conexión con el banco ha caducado.'), { code: 'expired' });
    }
    if (/ASPSP_RATE_LIMIT_EXCEEDED/.test(text) || res.status === 429) {
      throw Object.assign(new Error('El banco no permite más consultas por ahora.'), { code: 'rate_limit' });
    }
    const err = new Error(`Enable Banking ${res.status}: ${(data.message || data.detail || text || '').toString().slice(0, 300)}`);
    err.code = /WRONG_TRANSACTIONS_PERIOD/.test(text) ? 'period' : 'bank';
    throw err;
  }
  return data;
}

/* ---------- Banco ----------------------------------------------------------- */

async function findAspsp(env) {
  const country = env.ASPSP_COUNTRY || 'ES';
  const { aspsps = [] } = await eb(env, `/aspsps?country=${country}`);
  const want = (env.ASPSP_NAME || 'ABANCA').toLowerCase();
  const hit = aspsps.find((a) => a.name.toLowerCase() === want) || aspsps.find((a) => a.name.toLowerCase().includes(want));
  if (!hit) throw Object.assign(new Error(`No encuentro "${env.ASPSP_NAME}" en Enable Banking (${country}).`), { code: 'config' });
  return {
    name: hit.name,
    country: hit.country,
    maximumConsentValidity: hit.maximum_consent_validity ?? null,
    requiredPsuHeaders: hit.required_psu_headers ?? [],
    psuTypes: hit.psu_types ?? [],
  };
}

async function connect(url, env) {
  const aspsp = await findAspsp(env);
  const maxSeconds = Math.min(aspsp.maximumConsentValidity || 90 * 86400, 180 * 86400);
  const validUntil = new Date(Date.now() + (maxSeconds - 3600) * 1000).toISOString();
  const state = crypto.randomUUID();
  await env.BANK.put(`state:${state}`, JSON.stringify({ aspsp }), { expirationTtl: 3600 });
  const res = await eb(env, '/auth', {
    method: 'POST',
    body: {
      access: { valid_until: validUntil },
      aspsp: { name: aspsp.name, country: aspsp.country },
      state,
      redirect_url: `${url.origin}/callback`,
      psu_type: 'personal',
      language: 'es',
    },
  });
  return { url: res.url };
}

async function callback(url, env) {
  const back = (params) => Response.redirect(`${env.APP_URL}#/ajustes?${new URLSearchParams(params)}`, 302);
  const state = url.searchParams.get('state') || '';
  const pending = state && (await env.BANK.get(`state:${state}`, 'json'));
  if (!pending) return back({ banco: 'error', msg: 'La autorización ha caducado o no es válida. Vuelve a intentarlo.' });
  await env.BANK.delete(`state:${state}`);
  if (url.searchParams.get('error')) {
    return back({ banco: 'error', msg: url.searchParams.get('error_description') || url.searchParams.get('error') });
  }
  try {
    const s = await eb(env, '/sessions', { method: 'POST', body: { code: url.searchParams.get('code') } });
    const session = {
      id: s.session_id,
      validUntil: s.access?.valid_until || null,
      aspsp: pending.aspsp,
      authorizedAt: new Date().toISOString(),
      accounts: (s.accounts || []).map((a) => ({
        uid: a.uid,
        iban: a.account_id?.iban || '',
        name: a.name || a.product || '',
        currency: a.currency || 'EUR',
        hash: a.identification_hash || '',
      })),
    };
    if (!session.accounts.length) {
      return back({ banco: 'error', msg: 'El banco no ha devuelto ninguna cuenta. ¿Está vinculada en Enable Banking?' });
    }
    await env.BANK.put('session', JSON.stringify(session));
    return back({ banco: 'ok' });
  } catch (err) {
    return back({ banco: 'error', msg: err.message });
  }
}

async function getSession(env) {
  return env.BANK.get('session', 'json');
}

async function status(env) {
  const session = await getSession(env);
  if (!session) return { connected: false, status: 'NONE' };
  let state = 'AUTHORIZED';
  let validUntil = session.validUntil;
  try {
    const s = await eb(env, `/sessions/${session.id}`);
    state = s.status || state;
    validUntil = s.access?.valid_until || validUntil;
  } catch (err) {
    if (err.code !== 'expired') throw err;
    state = 'EXPIRED';
  }
  return {
    connected: state === 'AUTHORIZED',
    status: state,
    validUntil,
    bank: session.aspsp?.name,
    accounts: session.accounts.map(({ iban, name, currency }) => ({ iban, name, currency })),
  };
}

/** Cabeceras del usuario presente (sincronización manual): no gastan el límite diario del banco. */
function psuHeaders(request, required) {
  if (!required?.length) return {};
  const source = {
    'psu-ip-address': request.headers.get('CF-Connecting-IP'),
    'psu-user-agent': request.headers.get('User-Agent'),
    'psu-referer': request.headers.get('Referer') || request.headers.get('Origin'),
    'psu-accept': request.headers.get('Accept') || '*/*',
    'psu-accept-charset': 'utf-8',
    'psu-accept-encoding': request.headers.get('Accept-Encoding') || 'gzip',
    'psu-accept-language': request.headers.get('Accept-Language') || 'es-ES',
    'psu-ip-port': '443',
    'psu-http-method': 'GET',
  };
  const out = {};
  for (const name of required) {
    const value = source[String(name).toLowerCase()];
    if (!value) return {}; // o todas o ninguna
    out[name] = value;
  }
  return out;
}

const BALANCE_PRIORITY = ['CLBD', 'ITBD', 'ITAV', 'XPCD', 'CLAV', 'OPBD', 'OPAV'];

async function sync(request, env) {
  const session = await getSession(env);
  if (!session) throw Object.assign(new Error('No hay ninguna cuenta conectada.'), { code: 'expired' });
  const body = await request.json().catch(() => ({}));
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(body.dateFrom || '') ? body.dateFrom : new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const online = request.headers.get('X-Psu-Online') === '1';
  const headers = online ? psuHeaders(request, session.aspsp?.requiredPsuHeaders) : {};
  const accounts = session.accounts.filter((a) => !body.iban || a.iban === body.iban);

  const out = [];
  for (const acc of accounts) {
    const { balances = [] } = await eb(env, `/accounts/${acc.uid}/balances`, { headers });
    const balance = BALANCE_PRIORITY.map((t) => balances.find((b) => b.balance_type === t)).find(Boolean) || balances[0];

    const raw = [];
    let strategy = 'default';
    let key = null;
    for (let page = 0; page < 50; page++) {
      const q = new URLSearchParams({ date_from: dateFrom });
      if (strategy !== 'default') q.set('strategy', strategy);
      if (key) q.set('continuation_key', key);
      let data;
      try {
        data = await eb(env, `/accounts/${acc.uid}/transactions?${q}`, { headers });
      } catch (err) {
        if (err.code === 'period' && strategy === 'default' && !key) { strategy = 'longest'; page--; continue; }
        throw err;
      }
      raw.push(...(data.transactions || []));
      key = data.continuation_key || null;
      if (!key) break;
    }

    const transactions = [];
    for (const t of raw) {
      if (t.status && t.status !== 'BOOK') continue; // solo lo confirmado; lo pendiente llegará cuando se apunte
      const dir = t.credit_debit_indicator === 'CRDT' ? 'in' : 'out';
      const party = dir === 'in' ? t.debtor : t.creditor;
      const partyAccount = dir === 'in' ? t.debtor_account : t.creditor_account;
      const description = (t.remittance_information || []).join(' ').replace(/\s+/g, ' ').trim();
      const date = t.booking_date || t.value_date || t.transaction_date;
      const amount = Math.abs(Number(t.transaction_amount?.amount));
      if (!date || !Number.isFinite(amount)) continue;
      const counterparty = (party?.name || '').replace(/\s+/g, ' ').trim();
      const id = t.entry_reference ? `er:${t.entry_reference}`
        : t.transaction_id ? `id:${t.transaction_id}`
        : `h:${await sha(`${date}|${amount}|${dir}|${description}|${counterparty}`)}`;
      transactions.push({
        key: id, date, amount, dir,
        currency: t.transaction_amount?.currency || acc.currency,
        description, counterparty,
        counterIban: (partyAccount?.iban || '').replace(/\s+/g, '').toUpperCase(),
      });
    }

    out.push({
      iban: acc.iban,
      name: acc.name,
      balance: balance ? { amount: Number(balance.balance_amount?.amount), currency: balance.balance_amount?.currency, type: balance.balance_type } : null,
      transactions,
    });
  }
  return { online: Object.keys(headers).length > 0, dateFrom, accounts: out };
}

async function disconnect(env) {
  const session = await getSession(env);
  if (session) {
    try { await eb(env, `/sessions/${session.id}`, { method: 'DELETE' }); } catch { /* ya no existía */ }
    await env.BANK.delete('session');
  }
  return { connected: false };
}

async function sha(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
