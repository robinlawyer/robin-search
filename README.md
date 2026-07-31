# Robin Search — servidor MCP local de expedientes

Robin Search es el **Paso 2 del onboarding de Robin Lawyer**: un servidor MCP que corre en el
ordenador del abogado, indexa la carpeta de expedientes del despacho y la hace **buscable
semánticamente sin que ningún byte de los documentos salga del equipo**.

Resuelve el caso de los **expedientes masivos** (decenas de miles de páginas, muy por encima de
la ventana de contexto de Claude): en lugar de cargar todo el expediente, Claude pregunta en
lenguaje natural y recibe solo los fragmentos relevantes.

- **Runtime:** Node.js (incluido en Claude Desktop → el `.mcpb` pesa decenas de MB, no 1-2 GB).
- **Embedding:** `multilingual-e5-small` en ONNX, 100 % local vía `@xenova/transformers`.
  Búsqueda asimétrica con prefijos `query:` / `passage:`.
- **Índice vectorial:** `vectra` (local, sin proceso separado).
- **Formatos (v1.1):** un expediente real no son solo PDF/DOCX limpios. Robin Search indexa,
  todo en local y con librerías 100 % JS/WASM (sin binarios nativos):
  - **Texto / histórico:** `.pdf` (texto y escaneado vía OCR), `.docx`, `.rtf`, `.odt`, `.txt`, `.md`, `.html`.
  - **Presentaciones:** `.pptx`, `.odp`.
  - **Matrices financieras/concursales:** `.xlsx`, `.xls`, `.ods`, `.csv`, `.tsv`.
  - **Comunicaciones y evidencias:** `.eml`, `.msg` (Outlook, con adjuntos) y **volcados de WhatsApp** (`.txt`).
  - **Peritajes gráficos (OCR local):** `.jpg`, `.png`, `.tiff`, `.bmp`, `.gif`, `.heic` (fotos de iPhone).
  - **Contenedores judiciales:** `.zip`, `.rar`, `.7z` (expedientes de LexNet / Justizia.eus, se abren y se indexa su contenido).
- **OCR local:** PDFs escaneados e imágenes se reconocen en el ordenador con `mupdf` + `tesseract.js` (WASM); los `.heic` se convierten antes con `heic-convert`. Ninguna imagen sale del equipo.
- **Multi-carpeta:** vigila **varias carpetas de expedientes independientes** a la vez; cada una es filtrable y citable por su nombre (`carpeta_filtro`).
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

## Herramientas MCP

| Herramienta                   | Qué hace                                                        | Anotación         |
| ----------------------------- | -------------------------------------------------------------- | ----------------- |
| `buscar_documentos`           | Búsqueda semántica en lenguaje natural sobre el expediente     | `readOnlyHint`    |
| `indexar_carpeta`             | Indexa/re-indexa la carpeta (incremental por defecto)          | `idempotentHint`  |
| `obtener_fragmento`           | Texto completo de un fragmento por `doc_id`+`chunk_id`         | `readOnlyHint`    |
| `obtener_documento`           | Texto íntegro de un documento (todos sus fragmentos en orden)  | `readOnlyHint`    |
| `listar_documentos_indexados` | Lista documentos indexados (incluye PDFs sin OCR)             | `readOnlyHint`    |
| `estado_servidor`             | Estado, versión, actualización, contadores, ficheros sin OCR   | `readOnlyHint`    |

---

## Ejemplos de uso

### Ejemplo 1 — Contradicciones en un expediente masivo

> **Prompt del abogado:** «¿Hay contradicciones entre la declaración de María García (carpeta
> `03_Testigos`) y el contrato de obra de `02_Documentos`?»

Claude llama a `buscar_documentos` con `carpeta_filtro` para cada carpeta y compara los
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

## Privacy Policy (Política de privacidad)

**Política de privacidad completa: https://robinlawyer.ai/privacidad**

Robin Search está diseñado para que **ningún byte del contenido de tus documentos salga de tu
ordenador**, en cumplimiento del RGPD (Reglamento (UE) 2016/679), la LOPDGDD (LO 3/2018) y el
secreto profesional del abogado (art. 542.3 LOPJ).

- **Qué se procesa en local (y nunca se envía a ningún servidor):** el texto de tus documentos, el
  OCR de los escaneados, los embeddings y el índice vectorial. Todo ello se calcula y se almacena
  en el disco de tu equipo (`~/Library/Application Support/RobinLawyer/robin-search` en macOS; la
  carpeta equivalente `%APPDATA%` en Windows). El modelo de embedding corre 100 % en local, **sin
  telemetría**.
- **Únicas llamadas de red que hace el servidor:** (1) el **login OAuth 2.1 + PKCE** con Robin
  Lawyer, que solo transmite las credenciales de autenticación y el token (ningún documento), y
  (2) una **comprobación de versión** al arrancar (solo consulta el número de versión publicado).
  Ninguna de las dos envía contenido documental.
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
npm run pack:mcpb                             # empaqueta dist/robin-search.mcpb
```
