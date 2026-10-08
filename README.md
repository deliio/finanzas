# Finanzas — PWA personal

Gestor de gastos y patrimonio 100 % estático (sin backend). Los datos viven en
`localStorage` del dispositivo; haz copias con **Ajustes → Exportar datos a CSV**.

## Estructura

```
index.html            Shell + TabBar
manifest.json         PWA (rutas relativas → funciona en usuario.github.io/repo/)
sw.js                 Cache offline (sube CACHE_VERSION al publicar cambios)
css/styles.css        Tema oscuro iOS
js/app.js             Router, modo privacidad, recurrentes y hooks de URL al arrancar
js/store.js           Estado, persistencia y migraciones
js/networth.js        Cálculo del patrimonio + histórico diario
js/market.js          Finnhub (ETF espejo) y tipos de cambio (Frankfurter)
js/charts.js          Gráficas SVG (donut, línea, barras, progreso)
js/csv.js             Copia de seguridad CSV + exportación Power BI
js/ui.js              Formato, helpers de interfaz, hojas inferiores
js/views/*.js         Una vista por pantalla (inicio, movimientos, nuevo, analisis, patrimonio, ajustes)
```

## Probar en local

```bash
npx http-server . -p 5174 -c-1
```

Abre `http://localhost:5174/?importe=15.50&comercio=Mercadona`.

## Publicar en GitHub Pages

Sube la carpeta tal cual a un repo → Settings → Pages → *Deploy from branch* (`main`, `/root`).

## ETF Espejo (Patrimonio → Inversiones)

- Cotizaciones: [Finnhub](https://finnhub.io) (gratis, 60 consultas/min). La API key se pega en
  **Ajustes** y se guarda solo en el dispositivo; **nunca** la pongas en el código (el repo es público).
- Tipo EUR/USD: [Frankfurter](https://frankfurter.dev) (BCE, sin clave).
- Valor estimado = `valorRef × (precioETF / precioRef) × (eurusdRef / eurusd)`.
- **Recalibrar**: cuando veas el valor real en tu banco, introdúcelo y pasa a ser la nueva referencia.
- **Aportar**: suma al importe aportado y a la referencia al precio actual.

## Hook de Apple Pay (Atajos de iOS)

La PWA instalada y Safari tienen almacenamiento separado, y "Abrir URL" desde
Atajos siempre abre Safari. Por eso el Atajo **copia** el pago al portapapeles y
en la app se pulsa **Pegar pago**.

Automatización (Atajos → Automatización → + → Transacción):

1. *Texto*: `FINANZAS|` [Importe] `|` [Comercio]
2. *Copiar al portapapeles*
3. *Mostrar notificación*: `[Importe] en [Comercio] · abre Finanzas y pulsa Pegar pago`

Formatos admitidos en el portapapeles: `FINANZAS|15,50 €|Mercadona` o una URL con
`?importe=15.50&comercio=Mercadona`.

La URL con parámetros sigue funcionando si se usa la web desde Safari sin instalar:
`https://USUARIO.github.io/REPO/?importe=15.50&comercio=Mercadona`
(opcionales: `categoria`, `fecha` AAAA-MM-DD, `etiquetas` (#viajes), `divisa` (GBP|USD)).

### Ingresos (Atajos)

- Portapapeles: `INGRESO|1.850,00 €|Nómina`
- URL: `?ingreso=1850&origen=Nómina`

## Power BI

**Ajustes → Exportar para Power BI** genera 7 CSV (modelo en estrella): `transacciones`,
`etiquetas_transacciones` (puente N:M), `categorias`, `cuentas`, `patrimonio_historico`,
`inversiones` y `huchas`. Separador coma, decimal punto, fechas ISO, UTF-8.
En Power BI: *Obtener datos → Texto/CSV* con configuración regional **Inglés (Estados Unidos)**.
Relaciones: `transacciones[categoria_id] → categorias`, `transacciones[cuenta_id] → cuentas`,
`etiquetas_transacciones[transaccion_id] → transacciones`.
