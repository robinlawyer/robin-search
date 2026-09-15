# RobinSearch — servidor MCP local de expedientes

RobinSearch es el **Paso 2 del onboarding de Robin Lawyer**: un servidor MCP que corre en el
ordenador del abogado, indexa la carpeta de expedientes del despacho y la hace **buscable
semánticamente sin que ningún byte de los documentos salga del equipo**.

Resuelve el caso de los **expedientes masivos** (decenas de miles de páginas, muy por encima de
la ventana de contexto de Claude): en lugar de cargar todo el expediente, Claude pregunta en
lenguaje natural y recibe solo los fragmentos relevantes.

- **Runtime:** Node.js (incluido en Claude Desktop).
- **Embedding:** `multilingual-e5-small` en ONNX, 100 % local vía `@xenova/transformers`.
  Búsqueda asimétrica con prefijos `query:` / `passage:`. **El modelo viaja dentro del `.mcpb`**
  (carpeta `models/`, con manifiesto de integridad): no hay descarga en casa del abogado, y por
  tanto no hay "0 documentos indexados" porque una descarga se cortara. Se comprueba el tamaño
  de cada fichero del modelo al arrancar; si no cuadra, `estado_servidor` lo dice.
- **Índice vectorial:** `vectra` (local, sin proceso separado).
- **Formatos (v1.1):** un expediente real no son solo PDF/DOCX limpios. RobinSearch indexa,
  todo en local y con librerías 100 % JS/WASM (sin binarios nativos):
  - **Texto / histórico:** `.pdf` (texto y escaneado vía OCR), `.docx`, `.rtf`, `.odt`, `.txt`, `.md`, `.html`.
  - **Presentaciones:** `.pptx`, `.odp`.
  - **Matrices financieras/concursales:** `.xlsx`, `.xls`, `.ods`, `.csv`, `.tsv`.
  - **Comunicaciones y evidencias:** `.eml`, `.msg` (Outlook, con adjuntos) y **volcados de WhatsApp** (`.txt`).
  - **Peritajes gráficos (OCR local):** `.jpg`, `.png`, `.tiff`, `.bmp`, `.gif`, `.heic` (fotos de iPhone).
  - **Contenedores judiciales:** `.zip`, `.rar`, `.7z` (expedientes de LexNet / Justizia.eus, se abren y se indexa su contenido).
- **OCR local:** PDFs escaneados e imágenes se reconocen en el ordenador con `mupdf` + `tesseract.js` (WASM); los `.heic` se convierten antes con `heic-convert`. Ninguna imagen sale del equipo, y **el modelo de idioma también viaja dentro del `.mcpb`** (`models/tesseract/`): cero descargas en la primera ejecución.
- **Multi-carpeta:** vigila **varias carpetas de expedientes independientes** a la vez; cada una es filtrable y citable por su nombre.
- **Da igual el nivel de carpeta que elijas (v1.3.3):** un expediente incluye **lo que cuelga
  de él**. Si eliges la carpeta madre, cada caso es un expediente; si eliges directamente la
  carpeta de un caso, sus subcarpetas siguen estando dentro de ese caso. Antes, elegir el nivel
  "de más adentro" partía el caso en varios expedientes y la búsqueda devolvía solo los
  documentos sueltos de su raíz **sin avisar de nada**. La comparación es por segmentos de
  ruta, así que dos casos hermanos con nombres parecidos («Pérez» y «Pérez - Divorcio») siguen
  totalmente aislados.
- **Carpeta madre, un caso por subcarpeta:** el abogado selecciona **una sola vez** la carpeta que contiene una subcarpeta por expediente. Cada subcarpeta de primer nivel es un caso, se indexa sola, y los casos nuevos aparecen sin reconfigurar nada. Ver [Un proyecto de Claude por expediente](docs/PROYECTO_POR_EXPEDIENTE.md).
- **Aislamiento por expediente (v1.3.0):** cada carpeta de caso es un cliente distinto. Las búsquedas se limitan **siempre** a un expediente — el activo de la sesión (`establecer_expediente_activo`) o el que se indique en el parámetro `expediente`. Si no hay ninguno, la herramienta **devuelve error en lugar de buscar en todo**: traer contexto del caso B en una consulta sobre el caso A no es ruido, es riesgo de conflicto de intereses y de secreto profesional.
- **Privacidad:** el contenido documental **nunca** sale del ordenador (RGPD / secreto profesional).

---

## Instalación

### Claude Desktop (`.mcpb` — doble clic)

1. Descarga `robin-search.mcpb` desde `robinlawyer.ai/descargas`.
2. Doble clic → Claude Desktop abre el diálogo nativo.
3. Selecciona la **Carpeta de expedientes** (una o varias). **No hay que pegar ningún token.**
4. Confirma. El servidor arranca, indexa en segundo plano y queda añadido al arranque.
5. La **primera vez que busques**, se abre el navegador para que **inicies sesión con tu cuenta de
   Robin Lawyer** (OAuth, igual que el conector remoto). Hecho una vez, se recuerda.

> **Úsalo desde el CHAT de Claude Desktop.** RobinSearch es una extensión **local**: vive en el
> ordenador del abogado. En las **tareas de Cowork** no está disponible salvo que se vincule el
> equipo, porque esas sesiones corren fuera de él y Claude Desktop les fija su propio juego de
> servidores MCP. El conector remoto de Robin (jurisprudencia y normativa) sí funciona en las
> dos superficies; el `.mcpb`, no. Si Claude responde que «no puede acceder a esa carpeta de tu
> ordenador» o que «esta sesión no está vinculada a tu equipo», es esto: abre un chat normal.
>
> Y ojo con el planteamiento: RobinSearch **no le da a Claude acceso al disco** — ese es su
> diseño. Pedir «lee la carpeta C:\…» no funciona ni en el chat. Se pide **buscar en el
> expediente**, y el servidor local es quien lee los documentos.

### Claude Code / Cursor (npm)

```bash
npm install -g @robinlawyer/robin-search
```

Ver [docs/CLAUDE_CODE_SETUP.md](docs/CLAUDE_CODE_SETUP.md) y [docs/CURSOR_SETUP.md](docs/CURSOR_SETUP.md).

### IT — despliegue masivo (pre-indexado headless)

```bash
robin-search --silent --token="TOKEN" --folder="/ruta/a/Expedientes"
```

Indexa una vez y sale (código 0). Integrable en GPO / JAMF / Intune. Ver [docs/IT_DEPLOYMENT.md](docs/IT_DEPLOYMENT.md).

---

## Due diligence: barrido exhaustivo (v1.4.0)

`buscar_documentos` encuentra lo que se parece a la pregunta. Una due diligence vale por lo que
**no** se te ocurrió preguntar, y 40.000 páginas (~48 millones de tokens) no caben en ningún
contexto. Para eso está el **barrido**: se recorre el expediente ventana a ventana, cada una se
lee entera una sola vez y deja una **ficha de hechos con su página**, y la revisión final se
hace sobre las fichas — que ocupan ~1 % y sí caben. Cruzar hechos hace saltar una contradicción
entre dos documentos sin que nadie la haya sospechado.

El estado vive en disco, así que el barrido **se reanuda solo** aunque se cierre Claude; la
**cobertura se declara siempre**; los documentos que no se han podido leer se declaran como
zona ciega; y una ficha se invalida sola si su documento cambia.

Ver [Barrido exhaustivo](docs/BARRIDO_DUE_DILIGENCE.md).

## Herramientas MCP

| Herramienta                   | Qué hace                                                        | Anotación         |
| ----------------------------- | -------------------------------------------------------------- | ----------------- |
| `buscar_documentos`           | Búsqueda semántica en lenguaje natural sobre el expediente     | `readOnlyHint`    |
| `indexar_carpeta`             | Indexa/re-indexa la carpeta (incremental por defecto)          | `idempotentHint`  |
| `obtener_fragmento`           | Texto completo de un fragmento por `doc_id`+`chunk_id`         | `readOnlyHint`    |
| `obtener_documento`           | Texto íntegro de un documento (todos sus fragmentos en orden)  | `readOnlyHint`    |
| `listar_documentos_indexados` | Lista documentos indexados del expediente (incluye PDFs sin OCR) | `readOnlyHint`    |
| `establecer_expediente_activo` | Fija el expediente de la sesión (o lo limpia al cerrar el asunto) | —                 |
| `estado_servidor`             | Estado, versión, actualización, expedientes detectados y activo, contadores | `readOnlyHint`    |
| `siguiente_por_revisar`       | Siguiente trozo del expediente que nadie ha leído, con su texto y el progreso | `readOnlyHint`    |
| `anotar`                      | Guarda la ficha de hechos de la ventana revisada                | —                 |
| `obtener_anotaciones`         | Fichas del barrido para la síntesis, con vista cruzada por campo | `readOnlyHint`    |

---

## Ejemplos de uso

### Ejemplo 1 — Contradicciones en un expediente masivo

> **Prompt del abogado:** «¿Hay contradicciones entre la declaración de María García (carpeta
> `03_Testigos`) y el contrato de obra de `02_Documentos`?»

Claude llama a `buscar_documentos` con `expediente` para cada caso y compara los
fragmentos. **Respuesta esperada:** un análisis fundamentado en el texto real de ambos
documentos, con cita de fichero y página, sin haber cargado los 40.000 folios al contexto.

### Ejemplo 2 — Localizar una cláusula concreta

> **Prompt del abogado:** «Busca en el expediente la cláusula de penalización por retraso y
> dime en qué documento y página está.»

`buscar_documentos({ query: "cláusula de penalización por retraso" })` devuelve los fragmentos
ordenados por similitud. **Respuesta esperada:** el pasaje literal de la cláusula, con
`fichero`, `pagina` y `score`, listo para citar.

### Ejemplo 3 — Comprobar el estado del índice y los escaneados

> **Prompt del abogado:** «¿Está todo indexado? ¿Hay documentos que no se hayan podido leer?»

`estado_servidor()` devuelve documentos y fragmentos indexados, tamaño del índice y la lista
`ficheros_sin_ocr`. **Respuesta esperada:** «1.247 documentos indexados (18.930 fragmentos),
incluidos los escaneados que se han pasado por OCR local. `ficheros_sin_ocr` está vacío.» (Solo
aparecen aquí los PDFs cuyo OCR ha fallado o si el OCR está desactivado.)

---

## Si algo no aparece en las búsquedas

Todo lo necesario para diagnosticar sale de `estado_servidor`, sin abrir ningún log:

- **`motor_embedding`** — si el modelo no cargó, no se indexa **ni** se busca: fallan *todos*
  los ficheros. Es lo primero que hay que mirar; antes no se veía en ningún sitio.
- **`ultimo_indexado`** — resumen de la última pasada, con **`errores_por_causa`**: las causas
  agrupadas, con su recuento y un fichero de ejemplo. Que 680 ficheros fallen por el mismo
  motivo no es un problema de los documentos, y ahora se lee de un vistazo.
- **`estado`** — un indexado con errores deja el servidor en `error`, no en `activo`. Un
  `activo` con 0 documentos era indistinguible de una carpeta vacía.
- **`carpetas_vigiladas[].accesible`** — carpeta ilegible ≠ carpeta vacía.

Para acotar, `indexar_carpeta` acepta `expediente` (un caso) o `path` (una subcarpeta dentro
de las carpetas configuradas).

## Expedientes en una unidad de red

Un despacho mediano no suele tener los expedientes en el portátil, sino en el servidor: una
unidad mapeada (`Z:\`), una ruta UNC (`\\servidor\Expedientes`) o un montaje SMB en Mac.
RobinSearch lo detecta solo y cambia de estrategia, porque sobre SMB el sistema operativo **no
notifica de forma fiable** lo que un compañero deja en el expediente desde otro equipo:

- Se re-escanea el expediente **al fijarlo como activo** — justo cuando vas a trabajar en él.
- Y **periódicamente** (5 min por defecto). Ambos son incrementales: solo se re-indexa lo que
  cambió, y lo que se retiró del expediente sale también del índice.
- Si la unidad se cae, se dice explícitamente (con el motivo) en `indexar_carpeta`,
  `establecer_expediente_activo` y `estado_servidor`, en vez de contestar «0 documentos». Y no
  se vacía el índice de lo que no se ha podido leer.

La carpeta de red se selecciona como cualquier otra, en la configuración de la extensión
(Claude Desktop → Configuración → Extensiones → RobinSearch). **No** se puede dar de alta desde
el chat: `indexar_carpeta` solo actúa dentro de las carpetas que el abogado consintió.

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `ROBIN_RESCAN_MS` | `300000` (5 min) | Cada cuánto se re-escanean las carpetas de red. `0` lo desactiva (quedan el refresco al abrir el expediente y el indexado a mano). |
| `ROBIN_RESCAN_ON_OPEN` | `true` | Refrescar el expediente contra el disco al fijarlo como activo. |
| `ROBIN_NETWORK_PATHS` | — | Rutas (separadas por `;`) que deben tratarse como red aunque la detección automática no lo vea. Escotilla para un equipo concreto. |

## Privacy Policy (Política de privacidad)

**Política de privacidad completa: https://robinlawyer.ai/privacidad**

RobinSearch está diseñado para que **ningún byte del contenido de tus documentos salga de tu
ordenador**, en cumplimiento del RGPD (Reglamento (UE) 2016/679), la LOPDGDD (LO 3/2018) y el
secreto profesional del abogado (art. 542.3 LOPJ).

- **Qué se procesa en local (y nunca se envía a ningún servidor):** el texto de tus documentos, el
  OCR de los escaneados, los embeddings y el índice vectorial. Todo ello se calcula y se almacena
  en el disco de tu equipo (`~/Library/Application Support/RobinLawyer/robin-search` en macOS; la
  carpeta equivalente `%APPDATA%` en Windows). El modelo de embedding corre 100 % en local, **sin
  telemetría**.
- **Únicas llamadas de red que hace el servidor:** (1) el **login OAuth 2.1 + PKCE** con Robin
  Lawyer, que solo transmite las credenciales de autenticación y el token (ningún documento),
  (2) una **comprobación de versión** al arrancar (solo consulta el número de versión publicado), y
  (3) desde la 1.4.5, un **aviso técnico cuando RobinSearch falla** (se cae, no puede abrir su
  índice, no carga el modelo o un fichero no se deja leer), para que el soporte de Robin Lawyer se
  entere sin que tengas que mandar nada. El aviso lleva **solo datos técnicos**: versión, sistema
  operativo, memoria, en qué paso falló, el error, la extensión y el tamaño del fichero implicado y
  el final de los registros del programa. **Nunca** lleva contenido, nombres de fichero, rutas ni
  nombres de carpetas o expedientes: el registro se envía por lista blanca de campos y se limpia de
  rutas y nombres antes de salir (y el servidor lo vuelve a limpiar al recibirlo). Se desactiva con
  `ROBIN_DIAGNOSTICO_URL=off`. Ninguna de las tres envía contenido documental.
- **Datos que trata Robin Lawyer como responsable del tratamiento:** únicamente los de tu cuenta
  (identidad y estado de suscripción) a efectos de autenticación. Responsable: **Stay Hungry and
  Foolish, S.L.** Ejercicio de derechos: **privacidad@robinlawyer.ai**.
- **Conservación y borrado:** el índice y los documentos son tuyos y viven en tu disco; desinstalar
  la extensión o borrar el directorio de datos elimina el índice local por completo.

Detalle técnico del modelo de privacidad en
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#privacidad--rgpd).

## Desarrollo

```bash
npm install
ROBIN_FOLDER=/ruta/a/Expedientes npm start   # arranca el servidor MCP (stdio)
npm run check                                 # syntax-check de todos los .js
npm test                                      # aislamiento por expediente + carpetas de red
npm run pack:mcpb                             # empaqueta dist/robin-search.mcpb
```
