# Servidor del banco (ABANCA → Finanzas)

Un Cloudflare Worker gratuito que guarda tu clave de Enable Banking y conecta la app con ABANCA.
La app (GitHub Pages) nunca ve la clave: solo la URL del Worker y un token tuyo.

> ⚠️ **La clave privada (`private.key`) no va nunca en esta carpeta del repo.** GitHub Pages publica todo
> lo que subes. El `.gitignore` ya ignora `*.key` y `*.pem`, pero guárdala mejor fuera, por ejemplo
> en `Documentos\claves\`.

---

## 1. Cloudflare: crear el Worker (10 min)

1. Crea una cuenta gratis en **dash.cloudflare.com**.
2. Abre una terminal (Git Bash) en la carpeta del repo y entra en `worker`:
   ```bash
   cd ~/OneDrive/Documentos/finanzas/worker
   ```
3. Inicia sesión (se abre el navegador):
   ```bash
   npx wrangler login
   ```
4. Crea el almacén de la sesión:
   ```bash
   npx wrangler kv namespace create BANK
   ```
   Copia el `id` que sale y pégalo en `wrangler.toml`, en `id = "PEGA_AQUI_EL_ID_DEL_KV"`.
5. Publica el Worker:
   ```bash
   npx wrangler deploy
   ```
   Apunta la URL que sale, algo como `https://finanzas-banco.TU-USUARIO.workers.dev`.
   La dirección de vuelta del banco será **esa URL + `/callback`**.

## 2. Enable Banking: crear tu app y vincular ABANCA (15 min)

1. Regístrate en **enablebanking.com** y entra en el **Control Panel**.
2. Crea la clave privada y su certificado. Hazlo **fuera del repo**:
   ```bash
   mkdir -p ~/Documents/claves && cd ~/Documents/claves
   openssl genrsa -out private.key 4096
   openssl req -new -x509 -days 3650 -key private.key -out public.crt -subj "/CN=Finanzas"
   ```
   (El Control Panel también puede generarla en el navegador y descargarte el `.pem`; vale igual.)
3. **Applications → Add a new application**:
   - Environment: **Production**
   - Name: `Finanzas`
   - Redirect URL: `https://finanzas-banco.TU-USUARIO.workers.dev/callback`
   - Certificate: sube `public.crt`
4. Copia el **Application ID**. Es el `kid` del JWT y el secreto `EB_APP_ID`.
5. En tu aplicación pulsa **Activate by linking accounts**. Elige **ABANCA**, entra con tus claves
   de Abanca y confirma. La app pasa a **Active** en modo restringido: es gratis y solo puede leer
   las cuentas que vincules.

## 3. Secretos del Worker (5 min)

Desde la carpeta `worker`:

```bash
npx wrangler secret put EB_APP_ID
# pega el Application ID

npx wrangler secret put EB_PRIVATE_KEY < ~/Documents/claves/private.key

node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
# copia lo que sale: es tu token. Luego:
npx wrangler secret put APP_TOKEN
# pega ese token (guárdalo, lo pondrás en la app)
```

Comprueba que todo va y que el nombre del banco es el correcto (cambia `TOKEN` y la URL):

```bash
curl -H "Authorization: Bearer TOKEN" https://finanzas-banco.TU-USUARIO.workers.dev/aspsps
```

Debe salir `"name":"ABANCA"`. Si sale con otro nombre exacto, ponlo en `ASPSP_NAME` de
`wrangler.toml` y repite `npx wrangler deploy`.

## 4. En la app (en TU iPhone, no en el de tu padre)

1. **Ajustes → Banco → Configurar banco**: pega la URL del Worker y el token → **Guardar y probar**.
2. **Conectar Abanca**: te lleva a Abanca, entras y autorizas. Vuelves a la app con
   "Abanca conectada".
3. En **Ajustes → Banco**:
   - **En la app**: la cuenta de la app que es Abanca. Se elige sola si se llama "Abanca".
   - **MyInvestor**: tu cuenta manual de MyInvestor.
   - **Su IBAN**: el IBAN de MyInvestor, para detectar los traspasos.

A partir de ahí:

- **Saldo y movimientos**: se sincronizan al abrir la app (como mucho cada 6 h) o con **Sincronizar**.
- **Desde cuándo**: solo llegan movimientos desde el día en que conectaste.
- **Revisar**: todo lo nuevo va ahí. Lo que ya habías apuntado con Apple Pay o el buzón se fusiona y no
  se duplica.
- **Traspasos con MyInvestor**: si coincide el IBAN, se aplican solos. Si solo pone "MyInvestor" o
  "Andbank" en el concepto, te pregunta en Revisar.
- **Reglas de categorías**: se aprenden al elegir la categoría en Revisar, y puedes editarlas en Ajustes → Banco.

## 5. Cada ~180 días

El permiso del banco caduca y no se puede renovar solo. Unos días antes sale un aviso en Inicio con
**Reconectar Abanca**: pulsas, entras en Abanca y listo. No se pierde nada ni se duplica.

---

### Endpoints del Worker

Todos llevan `Authorization: Bearer APP_TOKEN`, salvo `/callback`.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/aspsps` | Datos de ABANCA en Enable Banking (nombre exacto y validez máxima) |
| POST | `/connect` | Empieza la autorización y devuelve la URL del banco |
| GET | `/callback` | Vuelta del banco: crea la sesión y redirige a la app |
| GET | `/status` | Estado de la conexión, caducidad y cuentas |
| POST | `/sync` | Saldo y movimientos confirmados desde `dateFrom` (pagina con `continuation_key`) |
| POST | `/disconnect` | Cierra la sesión |
