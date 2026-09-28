# Manual de uso paso a paso — iGaming QA Runner

Este manual explica **todo desde cero**, sin prisas. Si en algún momento te pierdes, vuelve al
[índice](#índice) y sigue por el paso en el que estabas. No hace falta saber programar.

---

## Índice

1. [¿Qué hace esta herramienta?](#1-qué-hace-esta-herramienta)
2. [Palabras que vas a ver (mini diccionario)](#2-palabras-que-vas-a-ver-mini-diccionario)
3. [Antes de empezar: lo que necesitas](#3-antes-de-empezar-lo-que-necesitas)
4. [Instalación (solo la primera vez)](#4-instalación-solo-la-primera-vez)
5. [Arrancar la herramienta (cada vez que la uses)](#5-arrancar-la-herramienta-cada-vez-que-la-uses)
6. [Tu primera prueba, sin riesgo (con el agregador de mentira)](#6-tu-primera-prueba-sin-riesgo-con-el-agregador-de-mentira)
7. [La pantalla, parte por parte](#7-la-pantalla-parte-por-parte)
8. [Hacer una prueba real](#8-hacer-una-prueba-real)
9. [Cómo leer los resultados](#9-cómo-leer-los-resultados)
10. [Qué hacer con cada resultado](#10-qué-hacer-con-cada-resultado)
11. [El informe Excel](#11-el-informe-excel)
12. [Las evidencias (capturas y diagnósticos)](#12-las-evidencias-capturas-y-diagnósticos)
13. [Detener una prueba](#13-detener-una-prueba)
14. [Apagar la herramienta](#14-apagar-la-herramienta)
15. [Problemas frecuentes y cómo resolverlos](#15-problemas-frecuentes-y-cómo-resolverlos)
16. [Preguntas frecuentes](#16-preguntas-frecuentes)
17. [Chuleta rápida (resumen de una página)](#17-chuleta-rápida-resumen-de-una-página)

---

## 1. ¿Qué hace esta herramienta?

Imagina que tienes que abrir **500 juegos**, uno por uno, para ver si funcionan. Eso lleva días.

Esta herramienta lo hace sola:

1. Le pide al agregador la **lista de proveedores** y la **lista de juegos**.
2. Para cada juego, **crea una sesión de jugador de prueba** (como si entrara un jugador nuevo).
3. **Abre el juego** en un navegador invisible (Chromium).
4. Mira si el juego **carga de verdad** o si da un error.
5. Si se lo pides, comprueba la **divisa** (GBP, EUR…) y los **límites de apuesta** (mínima, por defecto, máxima).
6. Te enseña los resultados **en directo** en una tabla.
7. Al final te da un **Excel** con todo, más **capturas de pantalla** de los juegos que fallan.

Cosas importantes que **NO hace** (para que estés tranquilo):

- ❌ **No apuesta dinero.** Nunca pulsa "girar" ni hace apuestas.
- ❌ **No cambia nada** en el agregador ni en los proveedores. Solo mira.
- ❌ **No guarda tu API Key** en ningún sitio. Cuando cierras, se olvida.
- ❌ **No necesita base de datos.** Todo vive mientras está abierta y el resultado final va al Excel.

> 💡 **Lo más importante que detecta:** hay juegos que "responden bien" (HTTP 200) pero en realidad
> muestran un error por dentro, por ejemplo *"Game not found"*. Una persona lo ve; un programa simple no.
> Esta herramienta **sí lo detecta** y lo marca como **FAIL**.

---

## 2. Palabras que vas a ver (mini diccionario)

| Palabra | Qué significa, en fácil |
|---|---|
| **Agregador** | La plataforma que junta juegos de muchos proveedores. |
| **Proveedor** | La empresa que hizo el juego (Evolution, Pragmatic…). |
| **Partner / código de partner** | Tu "cuenta" dentro del agregador. Ejemplo: `alpha-test`. |
| **API Key** | La contraseña para hablar con el agregador. **Es secreta.** |
| **1070, 1071, 1050** | Nombres de "preguntas" que se le hacen al agregador: 1070 = dame los proveedores, 1071 = dame los juegos, 1050 = crea una sesión de jugador. |
| **Token** | Un código de un solo uso para entrar a un juego. La herramienta crea uno nuevo cada vez. |
| **Divisa** | La moneda: GBP (libra), EUR (euro), USD (dólar), BRL (real), RON (leu)… |
| **Declarada en 1071** | Que el agregador dice que ese juego acepta esa divisa. |
| **Límites** | Apuesta mínima, apuesta por defecto (la que sale al abrir) y apuesta máxima. |
| **Worker** | Un "ayudante" que prueba juegos. 5 workers = 5 juegos a la vez. |
| **Navegador / Playwright / Chromium** | Un Chrome invisible que la herramienta usa para abrir los juegos. |
| **Terminal** | La ventana negra donde se escriben comandos. |
| **PASS / FAIL / REVIEW / SKIPPED** | Los resultados. Se explican en la [sección 9](#9-cómo-leer-los-resultados). |

---

## 3. Antes de empezar: lo que necesitas

Marca cada punto:

- [ ] Un ordenador con la carpeta del proyecto (`aggregator-QA`).
- [ ] **Node.js** instalado (versión 20 o más nueva). Ver abajo cómo comprobarlo.
- [ ] Conexión a internet (y VPN si tu empresa la pide para llegar al agregador).
- [ ] Para pruebas reales: **URL del agregador**, **código de partner** y **API Key** de un partner **de pruebas autorizado**.

### ¿Cómo sé si tengo Node.js?

1. Abre una **terminal**.
   - En Linux: busca "Terminal" en el menú.
   - En Mac: `Cmd + Espacio`, escribe "Terminal", Enter.
   - En Windows: busca "PowerShell".
2. Escribe esto y pulsa **Enter**:

   ```bash
   node -v
   ```
3. Si sale algo como `v20.20.2` o `v22.x.x` → ✅ perfecto.
   Si sale "command not found" o un número menor que 20 → instala Node.js desde <https://nodejs.org> (botón "LTS") y vuelve a probar.

---

## 4. Instalación (solo la primera vez)

Esto solo se hace **una vez** por ordenador.

**Paso 1.** Entra en la carpeta del proyecto. En la terminal escribe (cambia la ruta si tu carpeta está en otro sitio):

```bash
cd ~/Desktop/solutionTecJavier/aggregator-QA
```

> 💡 Truco: escribe `cd ` (con espacio) y **arrastra la carpeta** a la terminal. Se escribe la ruta sola.

**Paso 2.** Instala las piezas que usa la herramienta:

```bash
npm install
```

Tarda 1–2 minutos. Verás mucho texto; es normal. Si al final sale algo de "vulnerabilities", **ignóralo**.

**Paso 3.** Instala el navegador invisible:

```bash
npm run playwright:install
```

Descarga unos 100–150 MB. Espera a que llegue al 100 %.

> 🐧 Solo en Linux, si más adelante sale un error de que Chromium no arranca, ejecuta también:
> `npx playwright install-deps chromium` (puede pedir tu contraseña).

**Paso 4 (opcional).** Copia el archivo de configuración:

```bash
cp .env.example .env
```

No hace falta tocarlo. Los valores por defecto funcionan.

✅ **Instalación terminada.**

---

## 5. Arrancar la herramienta (cada vez que la uses)

**Paso 1.** Abre una terminal y entra en la carpeta:

```bash
cd ~/Desktop/solutionTecJavier/aggregator-QA
```

**Paso 2.** Arranca:

```bash
npm run dev
```

**Paso 3.** Espera a ver esta línea:

```text
[INFO] iGaming QA Runner listening on http://127.0.0.1:3000
```

**Paso 4.** Abre tu navegador normal (Chrome, Firefox…) y ve a:

> **http://127.0.0.1:3000**

⚠️ **No cierres la terminal** mientras uses la herramienta. Si la cierras, la herramienta se apaga.

---

## 6. Tu primera prueba, sin riesgo (con el agregador de mentira)

Antes de usar credenciales reales, practica con un **agregador de mentira** que viene incluido.
Tiene 3 juegos de ejemplo:

| Juego | ID | Qué pasa |
|---|---|---|
| Crazy Time | 4182 | Funciona bien → debería salir **PASS** |
| XXXTreme Lightning Roulette | 4170 | Responde "bien" pero por dentro dice *Game not found* → debería salir **FAIL** |
| Blank Slot | 4200 | Se abre pero no muestra nada → debería salir **REVIEW** |

**Paso 1.** Deja la terminal de `npm run dev` abierta. Abre **otra terminal nueva**, entra en la carpeta y escribe:

```bash
cd ~/Desktop/solutionTecJavier/aggregator-QA
npm run mock:aggregator
```

> 💡 Si quieres que el agregador de mentira se comporte **igual que el vuestro** (registra jugadores y usa
> `/front/launcher`), arráncalo así: `MOCK_DRIVER=local npm run mock:aggregator`

Verás: `Mock aggregator on http://127.0.0.1:4000 · partner: alpha-test · Api-Key: mock-api-key-123456`

**Paso 2.** En la página http://127.0.0.1:3000 rellena:

| Campo | Escribe |
|---|---|
| Endpoint de integración | `http://127.0.0.1:4000/alpha-test` |
| API Key | `mock-api-key-123456` |
| Divisas | deja solo `EUR` |
| Mínima / Por defecto / Máxima | `0.10` · `1` · `100` |

**Paso 3.** Pulsa **1 · Probar conexión**. Debe salir ✅ EUR.

**Paso 4.** Pulsa **2 · Cargar juegos**. Arriba debe salir **3 Proveedores** y **3 Juegos**.

**Paso 5.** Pulsa **3 · Iniciar QA**. En unos 10 segundos verás la tabla llenarse.

**Paso 6.** Comprueba que:
- Crazy Time sale **PASS** (verde).
- XXXTreme sale **FAIL** (rojo).
- Blank Slot sale **REVIEW** (amarillo).

**Paso 7.** Pulsa **Detalle** en la fila roja de XXXTreme. Verás el error *"Error: Game not found"* y la captura.

**Paso 8.** Pulsa **Descargar Excel** y ábrelo.

🎉 Si todo esto te ha salido, ya sabes usar la herramienta. Cierra la terminal del agregador de mentira
(`Ctrl + C`) y pasa a la prueba real.

---

## 7. La pantalla, parte por parte

La pantalla tiene **dos zonas**: a la **izquierda** configuras, a la **derecha** ves los resultados.
A la izquierda solo hay **4 cosas que rellenar**. Todo lo demás está escondido en **Opciones avanzadas**
y **no hace falta tocarlo**.

### 7.1 Tarjeta "Configuración"

| Campo | Qué poner | Ejemplo |
|---|---|---|
| **Endpoint de integración** | La URL completa, **con el código de partner al final**. | `https://integration.playgg.uno/alpha-test` |
| **API Key** | La clave secreta. Se ve con puntitos. | `••••••••` |
| **Divisas** | En qué monedas probar. Haz clic y elige, o escribe 3 letras (`bob`) y pulsa **Enter**. Para quitar una, pulsa su **✕**. | `EUR`, `USD`, `GBP` |
| **Mínima / Por defecto / Máxima** | Los límites de apuesta que **debería** tener el juego. Punto o coma valen (`0.10` o `0,10`). **Vacío = no se prueba.** | `0.10` · `1` · `100` |

> 🔒 La API Key **no se guarda**. Si recargas la página, hay que escribirla otra vez. Es a propósito.
> El resto de campos sí se recuerdan.

> ⏱️ Cada divisa multiplica el trabajo: 100 juegos × 3 divisas = 300 pruebas.

### 7.2 Los botones (en orden)

| Botón | Qué hace |
|---|---|
| **1 · Probar conexión** | Comprueba en 2 segundos que el endpoint y la API Key funcionan y que se pueden crear los jugadores de prueba. Sale ✅ o ❌ por cada divisa. **Púlsalo siempre primero.** |
| **2 · Cargar juegos** | Pide la lista de proveedores y juegos. |
| **3 · Iniciar QA** | Empieza la prueba. |
| **Detener** | Para la prueba (ver [sección 13](#13-detener-una-prueba)). |
| **Descargar Excel** | Descarga el informe. Funciona también a mitad de prueba. |

### 7.3 Lo que la herramienta hace sola (no tienes que hacer nada)

- **Crea los jugadores de prueba**: uno por divisa y por worker, por ejemplo `qa-runner-eur-w01`,
  `qa-runner-usd-w01`… Si el agregador no los conoce, **los registra** (operación 1053) y luego inicia sesión (1050).
  La siguiente vez **reutiliza los mismos**: no llena el agregador de jugadores.
- **Averigua cómo se abren los juegos** en tu partner. Algunos partners usan `/{partner}/launch/…` y otros
  `/front/launcher/…`. En el **Registro** verás cuál ha elegido.
- **Pregunta qué juegos hay en cada divisa** (1071 con divisa). En el Registro: `1071 con divisa EUR: 935 juegos disponibles`.
- **Si no puede crear sesiones**, se para sola a los pocos segundos y te explica por qué, en vez de marcar
  todos los juegos como FAIL.

> 💰 **¿Y el saldo?** Los jugadores de prueba empiezan con saldo **0**. Para comprobar que un juego carga
> no hace falta saldo, porque la herramienta **nunca apuesta**. Nadie nos pide el balance: lo guarda el propio agregador.

> 💱 **Aviso sobre divisas:** en algunos partners, el agregador asigna **siempre la misma divisa** a los jugadores
> que se registran (por ejemplo EUR), aunque se pida otra. Si pasa, lo verás como ⚠️ en **Probar conexión**,
> y esas filas saldrán en **REVIEW** con el texto *"El agregador asignó EUR al jugador de prueba"*. Para probar
> USD o GBP de verdad, hay que cambiar la divisa de esos jugadores en el back office, o usar
> **Jugadores existentes** (ver abajo).

### 7.4 Opciones avanzadas (solo si las necesitas)

Pulsa **Opciones avanzadas** para abrirlas.

| Opción | Para qué | Por defecto |
|---|---|---|
| **Workers** | Cuántos juegos a la vez. Más = más rápido, pero el ordenador trabaja más. **Recomendado: 5**; hasta 8–10 si tienes 16 GB de RAM o más. | 5 |
| **Idioma** | Idioma en que se abren los juegos. | en |
| **Proveedores** | Probar solo algunos proveedores (se activa tras "Cargar juegos"). | todos |
| **IDs de juego** | Probar solo algunos juegos, por ejemplo `4182, 4170`. | todos |
| **Máx. juegos** | Probar solo los primeros N (`0` = todos). Útil para una prueba rápida. | 0 |
| **Verificar en navegador** | Abre cada juego de verdad. Sin esto no se prueban divisa ni límites. | ✅ |
| **Probar divisas / Probar límites** | Activan esas comprobaciones. | ✅ |
| **Capturas en FAIL / REVIEW** | Guarda foto de los juegos con problemas. | ✅ |
| **Capturas de todos los juegos** | Foto de todos (ocupa más espacio). | ⬜ |
| **Probar divisas no declaradas en 1071** | Prueba también divisas que el agregador dice que el juego no tiene. | ⬜ |
| **Prefijo del jugador** | Primera parte del nombre de los jugadores automáticos. | `qa-runner` |
| **Jugadores existentes** | Usar jugadores concretos que ya existan, una línea por divisa: `EUR;username;user_id;md5`. No se guarda. | vacío |
| **Código de partner** | Solo si **no** lo pusiste al final del endpoint. | se toma del endpoint |
| **URL del launcher** | Solo si los juegos se abren desde otro dominio. | la del endpoint |
| **Cabecera de acceso (Cloudflare)** | Nombre y valor de la cabecera que vuestra regla de Cloudflare deja pasar. Se envía **solo a vuestro dominio**, nunca a los proveedores. El valor no se guarda. | vacío |

### 7.5 Zona derecha

- **Catálogo:** cuántos proveedores y juegos hay.
- **Progreso:** barra azul, "X / Y juegos", tiempo, y los contadores PASS / FAIL / REVIEW / SKIPPED.
- **Workers en ejecución:** qué está haciendo cada ayudante ahora mismo (qué juego, qué divisa, qué paso).
- **Resultados:** la tabla. Una fila = **un juego en una divisa**.
- **Registro:** texto de lo que va pasando. No hace falta leerlo, pero ayuda si algo falla.

Encima de la tabla:
- **Filtros** (Todos / PASS / FAIL / REVIEW / SKIPPED): muestra solo esos.
- **Buscador**: escribe parte del nombre, el ID, el proveedor o la divisa.

---

## 7 bis. Partners "seamless": el monedero ficticio (saldo 100)

Algunos partners (por ejemplo los de **staging**) son **seamless**: antes de abrir un juego, el agregador
**llama a vuestra plataforma** para preguntar el saldo del jugador (operación **2051**). Si nadie contesta, el juego
no abre y sale:

> `get_game failed: ERROR: GetBalance Seamless failed.`

La herramienta trae un **monedero ficticio** que contesta a esas llamadas con saldo **100** (dinero de mentira,
solo en memoria). Está en `http://127.0.0.1:3000/wallet` y se enciende solo con `npm run dev`.

**El problema:** el agregador está en internet y `127.0.0.1` es **tu ordenador**, así que no lo ve. Hace falta un
**túnel** que le dé una dirección pública. Pasos:

1. Arranca la herramienta como siempre (`npm run dev`).
2. En **otra terminal**:
   ```bash
   cd ~/Desktop/solutionTecJavier/aggregator-QA
   npm run tunnel
   ```
   La primera vez, ngrok te pedirá tu *authtoken* (cuenta gratuita en <https://ngrok.com>):
   `ngrok config add-authtoken TU_TOKEN`.
3. ngrok muestra una línea **Forwarding**, por ejemplo `https://abcd-1234.ngrok-free.app`.
   Tu monedero público es esa dirección **+ `/wallet`**: `https://abcd-1234.ngrok-free.app/wallet`
4. En el **back office del agregador** (staging), en la configuración del partner, pon esa dirección como
   **endpoint** de la plataforma de cuentas (el campo al que el agregador envía 2051/2052).
5. Vuelve a la herramienta y lanza la prueba. En la tarjeta **💰 Monedero ficticio** verás
   *"✅ El agregador lo está usando: balance N"*. Si ahí no sube el número, el agregador no está llegando al túnel.

Detalles:
- El saldo se cambia en `.env`: `FAKE_WALLET_BALANCE=100`, o por divisa: `FAKE_WALLET_BALANCES=EUR:100,USD:100,GBP:100`.
- Desde fuera solo se ve `/wallet`. El resto de la herramienta sigue siendo solo para tu ordenador.
- La herramienta **nunca apuesta**. Si algún juego enviara una apuesta (2052), se descuenta del saldo ficticio, nunca de dinero real.
- Cada vez que cierras ngrok, la dirección cambia: hay que volver a ponerla en el back office.
- Si tu agregador lo tienes **en tu propio ordenador** (con Docker), no hace falta túnel: el endpoint sería
  `http://host.docker.internal:3000/wallet`.

---

## 8. Hacer una prueba real

Te recomiendo **empezar pequeño** y luego ir a lo grande.

### 8.1 Prueba pequeña (2 juegos) — hazla siempre primero

1. Arranca la herramienta ([sección 5](#5-arrancar-la-herramienta-cada-vez-que-la-uses)).
2. Rellena **Endpoint de integración** (con el partner al final) y **API Key**.
3. En **Divisas** deja solo `EUR` (o la principal).
4. Pulsa **1 · Probar conexión**.
   - ✅ → todo bien, sigue.
   - ❌ → lee el mensaje y mira la [sección 15](#15-problemas-frecuentes-y-cómo-resolverlos).
5. Pulsa **2 · Cargar juegos**. Deben salir números (por ejemplo *29 proveedores, 935 juegos*).
6. Abre **Opciones avanzadas** y en **IDs de juego** escribe `4182, 4170`.
7. Pulsa **3 · Iniciar QA**. Ahora cada juego tarda **varios segundos**, porque se abre de verdad.
8. Resultado esperado:
   - **Crazy Time (4182)** → Lanzamiento **PASS**.
   - **XXXTreme Lightning Roulette (4170)** → **FAIL** con *Game not found*.

Si esto sale así, la herramienta funciona bien con tu agregador. 👍

### 8.2 Prueba mediana (un proveedor)

1. En **Opciones avanzadas**, borra los **IDs de juego**.
2. En **Proveedores** elige uno.
3. Pulsa **Iniciar QA**.

### 8.3 Prueba completa (todo el catálogo)

1. En **Opciones avanzadas**, deja vacíos **Proveedores** e **IDs de juego**, y **Máx. juegos** en `0`.
2. Elige las divisas que quieras (por ejemplo GBP, EUR, USD).
3. Pon los límites esperados si los tienes.
4. Workers (en Opciones avanzadas): 5. Sube a 8–10 si el ordenador va sobrado.
5. Pulsa **Iniciar QA** y déjalo trabajar.

⏱️ **¿Cuánto tarda?** Cada prueba tarda unos 5–20 segundos. Cálculo aproximado:

> tiempo ≈ (juegos × divisas × 12 segundos) ÷ workers
>
> Ejemplo: 500 juegos × 3 divisas × 12 s ÷ 5 workers ≈ **1 hora**.

Mientras tanto puedes mirar la tabla, pero **no cierres la terminal** ni apagues el ordenador.

---

## 9. Cómo leer los resultados

Cada fila tiene varias columnas de estado:

| Columna | Qué comprueba |
|---|---|
| **Lanzamiento** | ¿El juego se abre de verdad? |
| **Divisa (check)** | ¿El juego muestra la moneda correcta? |
| **Mín / Defecto / Máx** | ¿Los límites coinciden con lo esperado? Debajo sale el valor encontrado. |
| **Resultado** | La nota final de esa fila. |

### Los colores

| Etiqueta | Color | En palabras sencillas |
|---|---|---|
| **PASS** | 🟢 Verde | Todo bien. |
| **FAIL** | 🔴 Rojo | Hay un problema **seguro**. Hay que avisar / arreglar. |
| **REVIEW** | 🟡 Amarillo | La herramienta **no está segura**. Míralo tú con la captura. |
| **NOT_DETECTED** | 🟡 Amarillo | No encontró el dato (la divisa o un límite). **No es un fallo**, pero hace que el resultado sea REVIEW. |
| **SKIPPED** | ⚪ Gris | No se probó (porque no hacía falta o no se podía). |
| **NOT_DECLARED** | ⚪ Blanco | El agregador dice que el juego no acepta esa divisa. **No es un fallo.** |
| **ND** (junto a la divisa) | — | Abreviatura de "No declarada en 1071". |

### Cómo se decide el "Resultado" final

Piensa en un semáforo, de arriba a abajo. La primera regla que se cumple, gana:

1. ¿Algo está en **FAIL** (lanzamiento, divisa o un límite)? → **FAIL** 🔴
2. Si no, ¿algo está en **REVIEW** o **NOT_DETECTED**? → **REVIEW** 🟡
3. Si no, ¿el juego ni siquiera se lanzó (por ejemplo divisa no declarada)? → **SKIPPED** ⚪
4. Si no → **PASS** 🟢

### Ejemplos reales

**Ejemplo A — Todo bien**

| Lanzamiento | Divisa | Mín | Defecto | Máx | Resultado |
|---|---|---|---|---|---|
| PASS | PASS | PASS 0.10 | PASS 1.00 | PASS 100.00 | **PASS** |

**Ejemplo B — El juego no existe en el proveedor**

| Lanzamiento | Divisa | Mín | Defecto | Máx | Resultado |
|---|---|---|---|---|---|
| FAIL | SKIPPED | SKIPPED | SKIPPED | SKIPPED | **FAIL** |

Divisa y límites salen SKIPPED porque, si el juego no abre, no se pueden mirar.

**Ejemplo C — Límite mínimo distinto**

| Lanzamiento | Divisa | Mín | Defecto | Máx | Resultado |
|---|---|---|---|---|---|
| PASS | PASS | FAIL 0.20 | PASS 1.00 | PASS 100.00 | **FAIL** |

Esperabas 0.10, el juego tiene 0.20.

**Ejemplo D — El juego abre pero no se pudo leer la divisa**

| Lanzamiento | Divisa | Mín | Defecto | Máx | Resultado |
|---|---|---|---|---|---|
| PASS | NOT_DETECTED | NOT_DETECTED | NOT_DETECTED | NOT_DETECTED | **REVIEW** |

Muy típico en tragaperras que se dibujan como una "imagen" (canvas): la herramienta no puede leer el texto.
**El juego funciona**; solo hay que mirar la captura para confirmar divisa y límites.

**Ejemplo E — Divisa no declarada**

| Divisa | Lanzamiento | Divisa (check) | Resultado |
|---|---|---|---|
| BRL **ND** | SKIPPED | NOT_DECLARED | **SKIPPED** |

El agregador dice que ese juego no tiene BRL, así que no se prueba. Si quieres probarlo igualmente,
marca **Probar divisas no declaradas en 1071**.

### Ver el detalle de una fila

Pulsa **Detalle** (a la derecha de cada fila). Se abre una ventana con:

- Cada comprobación con su explicación en español.
- Una tabla de **Errores y avisos**:
  - Fondo **rojo** = error.
  - Fondo **amarillo** = aviso (no cambia el resultado, es información).
- Botones **Diagnóstico JSON** y **Abrir captura**.
- La **captura de pantalla** del juego (si la hay).

---

## 10. Qué hacer con cada resultado

### 🔴 FAIL

1. Abre **Detalle**.
2. Lee la columna **Descripción** del error en rojo. Algunos ejemplos:

| Mensaje | Qué suele significar | A quién avisar |
|---|---|---|
| `Game not found` | El proveedor no tiene ese juego o el ID está mal mapeado. | Integración / proveedor |
| `Invalid token` / `Session expired` | Problema con la sesión del jugador. | Integración |
| `Unauthorized` / `Forbidden` | Permisos o IP no autorizada. | Integración / proveedor |
| `Currency not supported` | El proveedor no acepta esa divisa. | Proveedor / comercial |
| `HTTP 404`, `HTTP 500` | La página no existe o el servidor falla. | Proveedor |
| `Timeout` | Tardó demasiado en cargar. | Prueba otra vez; si se repite, proveedor |
| `Sesión (1050): ERR-…` | El agregador no quiso crear la sesión. | Integración |
| `Apuesta mínima: esperado 0.10, detectado 0.20` | El límite está mal configurado. | Configuración del juego |

3. Mira la **captura** para confirmarlo con tus ojos.
4. Apunta el juego (o pasa el Excel, que ya lo tiene todo).

### 🟡 REVIEW

1. Abre **Detalle** y mira la **captura**.
2. Pregúntate:
   - ¿Se ve el juego? → probablemente está bien; la herramienta no pudo leer algún dato.
   - ¿Se ve la moneda correcta (£, €, $…)? → la divisa está bien.
   - ¿La pantalla está en blanco o negro? → puede que el juego tarde mucho; ábrelo tú a mano para confirmar.
3. Si ves un problema real, trátalo como un FAIL.

### ⚪ SKIPPED / NOT_DECLARED

Normalmente **no hay que hacer nada**. Solo significa que esa combinación no se probó.

### 🟢 PASS

Nada. 🙂

---

## 11. El informe Excel

Se descarga con **Descargar Excel**. Nombre: `QA_Report_2026-09-28_11-30-00.xlsx` (fecha y hora de inicio).
También queda guardado en la carpeta `reports/` (ver [sección 12](#12-las-evidencias-capturas-y-diagnósticos)).

Tiene **4 pestañas** (abajo en Excel):

### Pestaña "Summary" (resumen)

Una hoja con los datos generales: partner, fecha, duración, cuántos juegos, divisas, workers,
límites esperados y los totales de PASS / FAIL / REVIEW / SKIPPED. **Ideal para enviar a tu jefe.**

### Pestaña "Results" (resultados)

Una fila por **juego × divisa**. Las columnas más útiles:

| Columna | Qué tiene |
|---|---|
| Game / Game ID / Provider / Currency | Qué se probó |
| Declared (1071) | `yes` si el agregador declara esa divisa |
| Min / Default / Max | Estado y valores, p. ej. `FAIL (esp. 0.10 / det. 0.20)` → *esp.* = esperado, *det.* = detectado |
| Launch / Currency check / Overall | Estados |
| Error | El motivo principal si algo falla |
| Screenshot / Diagnostics | Nombre del archivo de evidencia |

### Pestaña "Errors" (errores)

Una fila por cada error o aviso: en qué paso pasó, tipo, código HTTP, URL (con los tokens tapados con `***`)
y descripción. La columna **Severity** dice `ERROR` o `WARNING` (aviso).

### Pestaña "Providers" (proveedores)

Totales por proveedor. Sirve para ver rápido si **un proveedor entero** está fallando.

### Trucos de Excel

- La primera fila está **fija**: al bajar, siempre ves los títulos.
- Cada título tiene una **flechita de filtro**. Ejemplo: en **Overall** elige solo `FAIL` para ver solo los fallos.
- Los estados tienen **colores** (verde, rojo, amarillo, gris).

---

## 12. Las evidencias (capturas y diagnósticos)

Cada prueba crea una carpeta nueva dentro de `reports/`, con la fecha y hora:

```text
aggregator-QA/
└── reports/
    └── 2026-09-28_11-30-00/
        ├── QA_Report_2026-09-28_11-30-00.xlsx   ← el Excel
        ├── screenshots/                          ← fotos
        │   └── 4170_GBP.png                      ← juego 4170 en GBP
        └── diagnostics/                          ← información técnica
            └── 4170_GBP.json
```

- Los archivos se llaman **`<ID del juego>_<divisa>`**. Así los encuentras fácil.
- Por defecto solo se guardan de los juegos **FAIL** y **REVIEW**.
- La ruta exacta de la carpeta aparece en la pantalla, en la tarjeta **Workers en ejecución** (arriba a la derecha: *Evidencias: …*).
- Los archivos **.json** son para el equipo técnico: tienen todos los pasos que siguió el juego al abrirse.
  Puedes adjuntarlos cuando reportes un fallo.
- Los tokens y claves aparecen como `***`. **Se pueden compartir sin peligro.**

> 🧹 Las carpetas antiguas no se borran solas. Puedes borrar las que ya no necesites.

---

## 13. Detener una prueba

1. Pulsa **Detener**.
2. Arriba a la derecha sale **DETENCIÓN SOLICITADA**.
3. La herramienta **no empieza juegos nuevos**, pero **termina** los que estaban a medias (puede tardar unos segundos).
4. Cuando termina, el estado cambia a **Detenido**.
5. Puedes pulsar **Descargar Excel**: tendrás un informe **parcial** con lo que dio tiempo.

---

## 14. Apagar la herramienta

1. Ve a la terminal donde escribiste `npm run dev`.
2. Pulsa **`Ctrl + C`**.
3. Listo. La API Key se olvida por completo.

---

## 15. Problemas frecuentes y cómo resolverlos

| Lo que ves | Qué hacer |
|---|---|
| En el navegador: *"No se puede acceder a este sitio"* | La herramienta no está arrancada. Haz la [sección 5](#5-arrancar-la-herramienta-cada-vez-que-la-uses). |
| *Forbidden host* | Entra por `http://127.0.0.1:3000` o `http://localhost:3000`, no por otra dirección. |
| *El agregador rechaza la creación de sesión (1050): …* | Pulsa **1 · Probar conexión** y lee el mensaje de cada divisa. Si pone *Invalid Api-Key* → revisa la API Key. Si pone *Username or password incorrect* con **Jugadores existentes**, ese md5 no es correcto: borra esa línea para usar los jugadores automáticos. |
| Todos los juegos salen FAIL muy rápido (menos de 1 segundo) | Casi seguro es la sesión 1050. Abre **Detalle**: si pone `Sesión (1050): …`, es eso. Pulsa **1 · Probar conexión**. |
| Muchos juegos en **REVIEW** con *«Bloqueado por la verificación anti-bot de Cloudflare»* | Cloudflare no deja pasar al navegador automático, así que el juego **no se llegó a probar**. No es un fallo del juego. Pide al equipo que tenga acceso a Cloudflare que cree una regla para permitir la herramienta: por la **IP de tu ordenador**, o por una **cabecera secreta** (por ejemplo `X-QA-Runner`). Si es por cabecera, ponla en **Opciones avanzadas → Cabecera de acceso**. |
| *get_game failed: ERROR: GetBalance Seamless failed* | El partner es seamless y nadie contesta al saldo. Usa el monedero ficticio ([sección 7 bis](#7-bis-partners-seamless-el-monedero-ficticio-saldo-100)). |
| *Site disabled* | El partner está desactivado en el agregador (o lo estuvo un momento). Vuelve a probar; si sigue, avisa al equipo del agregador. |
| *Falta el código de partner* | Escribe el endpoint completo, con el partner al final: `https://integration.playgg.uno/alpha-test`. |
| REVIEW con *"El agregador asignó EUR al jugador de prueba"* | Ver el aviso sobre divisas de la [sección 7.3](#73-lo-que-la-herramienta-hace-sola-no-tienes-que-hacer-nada). |
| *La API Key es obligatoria* | Escribe la API Key (se borra al recargar la página). |
| *El endpoint de integración no es una URL válida* | Debe empezar por `https://`. Bien: `https://integration.playgg.uno/alpha-test`. Mal: `integration.playgg.uno/alpha-test`. |
| *El código de partner solo puede contener…* | Quita espacios o símbolos raros. |
| *No se pudo cargar el catálogo: opType 1070: ERR-…* | El agregador rechazó la petición: revisa API Key y partner. |
| *…error de red…* o *…tiempo de espera agotado…* | ¿Tienes internet? ¿Necesitas VPN? ¿Tu IP está autorizada en el agregador? |
| *Ya hay una ejecución en curso* | Espera a que termine o pulsa **Detener**. |
| *Executable doesn't exist … chromium* | Ejecuta `npm run playwright:install`. |
| Chromium no arranca (Linux) | Ejecuta `npx playwright install-deps chromium`. |
| El ordenador va muy lento | Detén la prueba y vuelve a empezar con menos **Workers** (3–5). |
| Muchas capturas en blanco | El juego tarda en cargar. Abre `.env` y sube `GAME_SETTLE_TIMEOUT=20000`. Reinicia la herramienta. |
| Casi todo sale REVIEW con NOT_DETECTED | Normal en tragaperras tipo "imagen". El juego suele estar bien; revisa algunas capturas. |
| *REVIEW: la cadena HTTP falló … pero el juego cargó en el navegador* | El proveedor bloquea la comprobación rápida, pero el juego abre en el navegador. Suele estar bien. |
| `npm: command not found` | Node.js no está instalado. Ver [sección 3](#3-antes-de-empezar-lo-que-necesitas). |
| *EADDRINUSE* o *address already in use* al arrancar | Ya hay otra copia abierta. Ciérrala (`Ctrl + C` en su terminal) o arranca con otro puerto: `PORT=3001 npm run dev` y entra en `http://127.0.0.1:3001`. |

Si nada de esto lo arregla: copia el texto del **Registro** (abajo en la pantalla) y el de la terminal y
pásaselo al equipo técnico. **No contienen la API Key.**

---

## 16. Preguntas frecuentes

**¿Puede gastar dinero o hacer apuestas?**
No. Nunca apuesta ni pulsa botones del juego. Solo lo abre y lo mira.

**¿Se guarda mi API Key?**
No. Solo está en memoria mientras la herramienta trabaja. No va a ningún archivo, ni al Excel, ni al registro.

**¿Por qué tengo que volver a escribir la API Key al recargar?**
Por seguridad. Es a propósito.

**¿Puedo usar el ordenador mientras prueba?**
Sí. El navegador de pruebas es invisible. Solo no cierres la terminal ni apagues el equipo.

**¿Puedo cerrar la pestaña del navegador mientras prueba?**
Sí. La prueba sigue en la terminal. Al volver a abrir `http://127.0.0.1:3000` verás el progreso otra vez.
(Eso sí, la API Key habrá que escribirla de nuevo solo si quieres **empezar otra** prueba.)

**¿Se pueden hacer dos pruebas a la vez?**
No. Una cada vez. Espera a que termine o detenla.

**¿Por qué un juego sale varias veces en la tabla?**
Porque hay una fila **por cada divisa**. 1 juego × 3 divisas = 3 filas.

**¿"NOT_DETECTED" significa que está mal?**
No. Significa "no he podido leerlo". Por eso el resultado es REVIEW (revisar), no FAIL.

**¿Qué diferencia hay entre REVIEW y FAIL?**
FAIL = seguro que hay un problema. REVIEW = no estoy seguro, míralo tú.

**¿Los resultados se guardan si cierro la herramienta?**
Lo que queda es el **Excel** y las **evidencias** de la carpeta `reports/`. La tabla de la pantalla se pierde.
Por eso: **descarga el Excel antes de cerrar** (igualmente se guarda una copia en `reports/` cuando lo descargas).

**¿Puedo compartir el Excel y las capturas?**
Sí. Los tokens y claves están tapados con `***`.

---

## 17. Chuleta rápida (resumen de una página)

```text
ARRANCAR
  1. Terminal → cd ~/Desktop/solutionTecJavier/aggregator-QA
  2. npm run dev
  3. Navegador → http://127.0.0.1:3000

CONFIGURAR (solo 4 cosas)
  4. Endpoint de integración  → https://integration.playgg.uno/alpha-test
  5. API Key
  6. Divisas (EUR, USD, GBP…)
  7. (Opcional) Límites: Mínima / Por defecto / Máxima

PROBAR
  8. 1 · Probar conexión   → ✅ en todas las divisas
  9. 2 · Cargar juegos
 10. 3 · Iniciar QA        → mira la tabla en directo
 11. Filtra por FAIL → pulsa Detalle → mira error y captura

TERMINAR
 12. Descargar Excel
 13. Terminal → Ctrl + C

COLORES
  🟢 PASS    = bien
  🔴 FAIL    = problema seguro → reportar
  🟡 REVIEW  = no seguro → mirar la captura
  ⚪ SKIPPED = no se probó → normalmente nada que hacer
```

¡Y ya está! Si algo no queda claro, vuelve a la [sección 6](#6-tu-primera-prueba-sin-riesgo-con-el-agregador-de-mentira)
y repite la práctica con el agregador de mentira: no rompe nada y ayuda mucho a entenderlo.
