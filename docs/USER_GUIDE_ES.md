# Guía de uso — iGaming QA Runner

> 📘 ¿Primera vez? Lee el manual detallado paso a paso: [`MANUAL_ES.md`](MANUAL_ES.md).

Herramienta **local** para probar automáticamente los juegos importados en el agregador.
Solo actúa como cliente (API + navegador): no modifica el agregador, ni bases de datos, ni proveedores, y
**nunca realiza apuestas**.

## 1. Puesta en marcha

```bash
npm install
npm run playwright:install   # solo la primera vez
npm run dev                  # o: npm run build && npm start
```

Abre **http://127.0.0.1:3000**.

¿Sin credenciales todavía? `npm run mock:aggregator` arranca un agregador de prueba en
`http://127.0.0.1:4000` (partner `alpha-test`, API Key `mock-api-key-123456`).

## 2. Configuración

**Agregador**
- *URL del agregador*: p. ej. `https://integration.playgg.uno`
- *URL del launcher* (opcional): si los juegos se lanzan desde otro dominio.
- *Código de partner*: p. ej. `alpha-test`
- *API Key*: solo se guarda en memoria durante la ejecución. Nunca se escribe en disco ni en el Excel.

**Prueba**
- *Divisas*: elige de la lista o escribe cualquier código ISO de 3 letras (se pasa a mayúsculas).
- *Idioma*: se envía en la sesión (`1050`) y en la URL de lanzamiento (`?lang=`).
- *Workers*: juegos probados en paralelo (por defecto 5, máximo 20). Empieza con 5.
- *Proveedores / IDs de juego / Máx. juegos* (opcionales): para probar solo una parte del catálogo,
  p. ej. `4182, 4170`.

**Límites esperados** (opcionales): apuesta mínima, por defecto y máxima. Los campos vacíos no se prueban.

**Opciones**
- *Verificar en navegador*: abre cada juego en Chromium (necesario para divisas y límites).
- *Probar divisas* / *Probar límites*.
- *Capturas en FAIL / REVIEW* y *Capturas de todos los juegos*.
- *Probar divisas no declaradas en 1071*: lanza el juego aunque la divisa no esté declarada.

## 3. Flujo

1. **Cargar juegos** → consulta `1070` (proveedores) y `1071` (juegos) y muestra los totales.
2. **Iniciar QA** → los workers prueban los juegos; la tabla se actualiza en tiempo real.
3. **Detener** → no se empiezan juegos nuevos; los que están en curso terminan. El informe queda parcial.
4. **Descargar Excel** → `QA_Report_AAAA-MM-DD_HH-mm-ss.xlsx`.

Usa los filtros (Todos / PASS / FAIL / REVIEW / SKIPPED) y el buscador (juego, ID, proveedor, divisa).
El botón **Detalle** de cada fila muestra los errores, el diagnóstico JSON y la captura.

## 4. Cómo leer los resultados

| Estado | Significado |
|---|---|
| **PASS** | El juego cargó y todo lo comprobado coincide. |
| **FAIL** | Error claro: el juego no carga, el proveedor devuelve un error (aunque sea HTTP 200), un límite no coincide o la divisa es otra. |
| **REVIEW** | No concluyente: no se pudo detectar la divisa o un límite, pantalla vacía, o diferencia detectada solo de forma heurística. Revisar a mano con la captura. |
| **SKIPPED** | No se probó (p. ej. divisa no declarada en 1071 y la opción de probarlas está desactivada). |
| **NOT_DECLARED** | La divisa no aparece en la lista de `1071` de ese juego. No es un fallo. |
| **NOT_DETECTED** | No se encontró el dato en el juego. No es un fallo, genera REVIEW. |

Ejemplo clave: *XXXTreme Lightning Roulette (4170)* responde HTTP 200 en todos los pasos, pero el proveedor
devuelve `{"error":{"code":-1,"description":"Error: Game not found"}}` → **FAIL**.

Muchos slots dibujan todo en un `<canvas>`: en esos casos la divisa o los límites pueden salir como
`NOT_DETECTED` (REVIEW). Es normal; la captura permite verificarlo visualmente.

## 5. Evidencias

Cada ejecución crea `reports/<fecha_hora>/` con el Excel, `screenshots/` (FAIL/REVIEW) y `diagnostics/`
(cadena de lanzamiento, frames, errores de consola y red, detecciones). Tokens y claves aparecen como `***`.

El Excel tiene las hojas **Summary**, **Results**, **Errors** y **Providers**.

## 6. Problemas frecuentes

- *No arranca Chromium*: `npm run playwright:install` (en Linux también `npx playwright install-deps chromium`).
- *Error `ERR-xxxx` al cargar juegos*: revisa API Key y código de partner.
- *Todo da timeout*: comprueba VPN / IP autorizada; sube `REQUEST_TIMEOUT` en `.env`.
- *Capturas en blanco*: sube `GAME_SETTLE_TIMEOUT` o usa `PLAYWRIGHT_HEADLESS=false` para ver el navegador.
- *El equipo va lento*: baja el número de workers.
