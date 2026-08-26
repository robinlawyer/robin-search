# Arquitectura — RobinSearch

## Flujo

```
[Abogado] → [Claude Desktop / Code / Cursor]
                ├── MCP remoto (OAuth) → api.robinlawyer.ai   (jurisprudencia, normativa)
                └── MCP local (este servidor) → documentos del expediente
                        extractFile → chunkPages → embedPassages (e5-small ONNX) → vectra
                                                          ↑ 0 llamadas externas
                        [Carpeta de expedientes en disco del abogado]
```

## Módulos (`server/`)

| Módulo                    | Responsabilidad                                                        |
| ------------------------- | ---------------------------------------------------------------------- |
| `config.js`               | Configuración desde entorno; rutas de datos fuera de la carpeta vigilada |
| `logger.js`               | Log local con rotación (10 MB × 3), sin contenido documental           |
| `state.js`                | Estado runtime (activo/indexando/error, sin-OCR, progreso)             |
| `embedder/embedder.js`    | e5-small ONNX local, prefijos `query:`/`passage:`, batching            |
| `search/store.js`         | Índice vectorial vectra tras interfaz aislada (migrable a hnswlib)     |
| `indexer/extract.js`      | PDF (pdfjs-dist) por página + DOCX (mammoth); detecta escaneado sin OCR |
| `indexer/chunk.js`        | Troceado 512/64 tokens, respetando fronteras de página                 |
| `indexer/registry.js`     | Registro incremental `files.json` (size+mtime)                         |
| `indexer/indexer.js`      | Orquestación extract→chunk→embed→store, incremental                     |
| `watcher/watcher.js`      | chokidar con debounce y cola serializada                               |
| `update.js`               | Aviso de versión (metadatos, sin documentos)                          |
| `tools/*.js`              | Las herramientas MCP con anotaciones catalog-ready                    |
| `index.js`                | Servidor MCP stdio                                                     |

## Decisiones (correos 23-jun)

- **Node.js** sobre Python: runtime integrado en Claude Desktop → `.mcpb` mínimo.
- **e5-small ONNX** vía `@xenova/transformers`: honra "onnxruntime-node + e5-small" e incluye el
  tokenizador; sigue siendo 100 % local.
- **vectra** para el MVP: puro JS, sin binario nativo → empaquetado `.mcpb` limpio y
  cross-platform. La capa `store.js` está aislada para migrar a `hnswlib-node` en v1.1 si un
  expediente de 50.000 páginas satura la RAM (vectra mantiene el índice en memoria).

## Privacidad / RGPD

- **En reposo:** índice + documentos en el disco del abogado. Robin no tiene acceso.
- **En tránsito:** solo el login OAuth con Robin Lawyer (autorización + refresco del token) y la
  comprobación de versión. Nunca viaja el documento.
- **Embedding:** local, sin API ni telemetría.
- **Datos generados** (índice `vectra`, `files.json`, logs) viven en el dir de datos de la app
  (`~/Library/Application Support/RobinLawyer/robin-search` en macOS), **nunca** en la carpeta de
  expedientes → no disparan el watcher ni contaminan el expediente.

## Escala (criterios de aceptación)

- 10.000 páginas: indexado < 30 min (M1 / i7 16 GB).
- 50.000 páginas: < 3 h, sin errores de memoria. **Riesgo conocido:** vectra en memoria; si se
  supera, migrar `store.js` a hnswlib-node (v1.1).
- Re-indexado incremental: 100 PDFs nuevos disponibles en < 5 min sin re-indexar todo.
