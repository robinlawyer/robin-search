// Configuración central de Robin Search (servidor MCP local).
// Todo se resuelve desde variables de entorno (código portable, sin rutas hardcodeadas)
// para cumplir el requisito catalog-ready de Anthropic.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const VERSION = '1.1.0';

// Endpoint público de Robin para comprobar la última versión disponible del servidor
// local (aviso de actualización en `estado_servidor`). NO transporta contenido documental.
export const UPDATE_CHECK_URL =
  process.env.ROBIN_UPDATE_URL || 'https://robinlawyer.ai/descargas/robin-search-latest.json';

// Formatos soportados. Un expediente real no son solo PDF/DOCX limpios: es un ecosistema
// de pruebas, comunicaciones y archivos técnicos. Robin Search los indexa TODOS en local
// (RGPD / secreto profesional), con extractores 100% JS/WASM (sin binarios nativos):
//   · Texto / histórico documental: .pdf .docx .rtf .odt .txt .md .html
//   · Presentaciones: .pptx .odp
//   · Matrices financieras/concursales: .xlsx .xls .ods .csv .tsv
//   · Comunicaciones y evidencias: .eml .msg (Outlook) + volcados de WhatsApp (.txt)
//   · Peritajes gráficos (OCR local): .jpg .jpeg .png .tiff .bmp .gif .heic
//   · Contenedores judiciales (LexNet / Justizia.eus): .zip .rar .7z
export const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.rtf', '.odt', '.txt', '.md', '.markdown', '.html', '.htm',
  '.pptx', '.odp',
  '.xlsx', '.xls', '.xlsm', '.ods', '.fods', '.csv', '.tsv',
  '.eml', '.msg',
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.gif', '.heic', '.heif',
  '.zip', '.rar', '.7z',
]);

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
      return path.join(home, 'Library', 'Application Support', 'RobinLawyer', 'robin-search');
    case 'win32':
      return path.join(
        firstDefined(process.env.APPDATA, path.join(home, 'AppData', 'Roaming')),
        'RobinLawyer',
        'robin-search',
      );
    default:
      return path.join(
        firstDefined(process.env.XDG_DATA_HOME, path.join(home, '.local', 'share')),
        'robin-lawyer',
        'robin-search',
      );
  }
}

function toInt(val, fallback) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Multi-raíz: el abogado puede vigilar VARIAS carpetas de expedientes independientes.
//   ROBIN_FOLDERS = varias carpetas (array JSON, o separadas por salto de línea / ; / ,)
//   ROBIN_FOLDER  = una sola (compatibilidad hacia atrás)
function parseFolders() {
  const multi = firstDefined(process.env.ROBIN_FOLDERS);
  const single = firstDefined(process.env.ROBIN_FOLDER, process.env.ROBIN_WATCHED_FOLDER);
  let list = [];
  if (multi) {
    const t = multi.trim();
    if (t.startsWith('[')) {
      try {
        list = JSON.parse(t);
      } catch {
        list = [];
      }
    } else {
      list = t.split(/[\n;,]+/);
    }
  } else if (single) {
    list = [single];
  }
  return list.map((s) => String(s).trim()).filter(Boolean);
}

// Cada carpeta vigilada es una "raíz" con un nombre (por defecto, el nombre de la carpeta).
// El nombre es el "asa" con la que se filtra la búsqueda y se cita el documento, así que se
// desduplica si dos carpetas comparten nombre de base.
function buildRoots(paths) {
  const roots = [];
  const used = new Map();
  for (const p of paths) {
    const abs = path.resolve(p);
    let name = path.basename(abs) || abs;
    if (used.has(name)) {
      const n = used.get(name) + 1;
      used.set(name, n);
      name = `${name}-${n}`;
    } else {
      used.set(name, 1);
    }
    roots.push({ name, path: abs });
  }
  return roots;
}

function buildConfig() {
  const roots = buildRoots(parseFolders());
  const dataDir = firstDefined(process.env.ROBIN_DATA_DIR) || defaultDataDir();

  const cfg = {
    version: VERSION,
    // Token Robin Lawyer: solo se usa para verificación en arranque y para las llamadas
    // a la API remota de jurisprudencia/normativa. NUNCA viaja con contenido documental.
    robinToken: firstDefined(process.env.ROBIN_TOKEN),
    robinApiUrl: firstDefined(process.env.ROBIN_API_URL) || 'https://api.robinlawyer.ai/mcp',
    // Servidor OAuth de Robin Lawyer (el mismo que usa el conector remoto). El abogado inicia
    // sesión en el navegador; Robin Search no pide token que pegar. `ROBIN_TOKEN` sigue
    // disponible como fallback headless para despliegue IT masivo (sin navegador).
    oauthIssuer: (firstDefined(process.env.ROBIN_OAUTH_ISSUER) || 'https://api.robinlawyer.ai').replace(/\/+$/, ''),

    // Carpetas de expedientes vigiladas (multi-raíz).
    roots,
    watchedFolders: roots.map((r) => r.path),
    // Primera raíz — solo para mensajes/compatibilidad; el código itera watchedFolders/roots.
    watchedFolder: roots[0]?.path ?? null,

    dataDir,
    indexDir: path.join(dataDir, 'index'),
    manifestPath: path.join(dataDir, 'files.json'),
    logDir: path.join(dataDir, 'logs'),
    // Credenciales OAuth (client_id + tokens) — fichero 0600, nunca en la carpeta vigilada.
    authStatePath: path.join(dataDir, 'auth.json'),

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

    // OCR de PDFs escaneados (v1.0). 100% local vía tesseract.js (WASM). Activado por
    // defecto; se puede desactivar en despliegues que hagan OCR externo por lotes.
    ocrEnabled: process.env.ROBIN_OCR !== 'false',
    ocrLang: firstDefined(process.env.ROBIN_OCR_LANG) || 'spa',
    ocrDpi: toInt(process.env.ROBIN_OCR_DPI, 200),
    // Tope de páginas a las que se aplica OCR por fichero (el OCR es lento; evita que un
    // escaneado gigante bloquee la cola indefinidamente).
    ocrMaxPages: toInt(process.env.ROBIN_OCR_MAX_PAGES, 5000),

    logLevel: firstDefined(process.env.ROBIN_LOG_LEVEL) || 'info',
  };
  cfg.tesseractCache = path.join(cfg.dataDir, 'tesseract');

  return cfg;
}

export const config = buildConfig();

// Crea los directorios de datos si no existen. Idempotente.
export function ensureDataDirs() {
  for (const dir of [config.dataDir, config.indexDir, config.logDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Devuelve la raíz (carpeta vigilada) a la que pertenece una ruta absoluta, o null.
// Ante anidamiento, gana la raíz más específica (prefijo más largo).
export function rootForPath(absPath) {
  const resolved = path.resolve(absPath);
  let best = null;
  for (const r of config.roots) {
    if (resolved === r.path || resolved.startsWith(r.path + path.sep)) {
      if (!best || r.path.length > best.path.length) best = r;
    }
  }
  return best;
}

// Ruta "lógica" de un fichero = `${nombreRaíz}/${rutaRelativaDentroDeLaRaíz}`. Es lo que se
// muestra en las citas y contra lo que actúa `carpeta_filtro`, de modo que dos ficheros con
// la misma ruta relativa en raíces distintas no colisionan.
export function logicalPath(absPath) {
  const r = rootForPath(absPath);
  const resolved = path.resolve(absPath);
  if (!r) return path.basename(resolved);
  const rel = path.relative(r.path, resolved).split(path.sep).join('/');
  return rel ? `${r.name}/${rel}` : r.name;
}

export default config;
