// Configuración central de Robin Search (servidor MCP local).
// Todo se resuelve desde variables de entorno (código portable, sin rutas hardcodeadas)
// para cumplir el requisito catalog-ready de Anthropic.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const VERSION = '1.0.0';

// Endpoint público de Robin para comprobar la última versión disponible del servidor
// local (aviso de actualización en `estado_servidor`). NO transporta contenido documental.
export const UPDATE_CHECK_URL =
  process.env.ROBIN_UPDATE_URL || 'https://robinlawyer.ai/descargas/robin-local-latest.json';

// Formatos soportados en v1.0 (TXT/MD → v1.1).
export const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx']);

function firstDefined(...vals) {
  return vals.find((v) => v !== undefined && v !== null && v !== '');
}

// Directorio de datos de la aplicación (índice vectorial, registro incremental, logs).
// SIEMPRE fuera de la carpeta de expedientes para no disparar el watcher ni contaminar
// el expediente del abogado.
function defaultDataDir() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'RobinLawyer', 'robin-local');
    case 'win32':
      return path.join(
        firstDefined(process.env.APPDATA, path.join(home, 'AppData', 'Roaming')),
        'RobinLawyer',
        'robin-local',
      );
    default:
      return path.join(
        firstDefined(process.env.XDG_DATA_HOME, path.join(home, '.local', 'share')),
        'robin-lawyer',
        'robin-local',
      );
  }
}

function toInt(val, fallback) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildConfig() {
  const watchedFolder = firstDefined(process.env.ROBIN_FOLDER, process.env.ROBIN_WATCHED_FOLDER);
  const dataDir = firstDefined(process.env.ROBIN_DATA_DIR) || defaultDataDir();

  const cfg = {
    version: VERSION,
    // Token Robin Lawyer: solo se usa para verificación en arranque y para las llamadas
    // a la API remota de jurisprudencia/normativa. NUNCA viaja con contenido documental.
    robinToken: firstDefined(process.env.ROBIN_TOKEN),
    robinApiUrl: firstDefined(process.env.ROBIN_API_URL) || 'https://api.robinlawyer.ai/mcp',

    watchedFolder: watchedFolder ? path.resolve(watchedFolder) : null,

    dataDir,
    indexDir: path.join(dataDir, 'index'),
    manifestPath: path.join(dataDir, 'files.json'),
    logDir: path.join(dataDir, 'logs'),

    // Modelo de embedding: multilingual-e5-small en ONNX int8, ejecutado 100% en local.
    embeddingModel: firstDefined(process.env.ROBIN_EMBED_MODEL) || 'Xenova/multilingual-e5-small',
    embeddingQuantized: process.env.ROBIN_EMBED_QUANTIZED !== 'false',

    // Chunking (decisión spec: 512 tokens / solapamiento 64).
    chunkSizeTokens: toInt(process.env.ROBIN_CHUNK_SIZE, 512),
    chunkOverlapTokens: toInt(process.env.ROBIN_CHUNK_OVERLAP, 64),

    // Tope de páginas por fichero — configurable y muy por encima del límite de 500 del
    // antiguo app/documents/ (RF-03.8).
    maxPagesPerFile: toInt(process.env.ROBIN_MAX_PAGES, 100000),

    nResultsDefault: toInt(process.env.ROBIN_N_RESULTS, 5),

    logLevel: firstDefined(process.env.ROBIN_LOG_LEVEL) || 'info',
  };

  return cfg;
}

export const config = buildConfig();

// Crea los directorios de datos si no existen. Idempotente.
export function ensureDataDirs() {
  for (const dir of [config.dataDir, config.indexDir, config.logDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export default config;
