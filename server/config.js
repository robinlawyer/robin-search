// Configuración central de RobinSearch (servidor MCP local).
// Todo se resuelve desde variables de entorno (código portable, sin rutas hardcodeadas)
// para cumplir el requisito catalog-ready de Anthropic.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// La versión sale del package.json que viaja en el paquete, NO de una
// constante a mano: escrita dos veces, se olvida una. El servidor estuvo
// diciendo que era la 1.4.0 siendo la 1.4.2, y eso se enseña al abogado.
function leerVersion() {
  try {
    const aqui = path.dirname(new URL(import.meta.url).pathname);
    const pkg = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = leerVersion();

// Endpoint público de Robin para comprobar la última versión disponible del servidor
// local (aviso de actualización en `estado_servidor`). NO transporta contenido documental.
export const UPDATE_CHECK_URL =
  process.env.ROBIN_UPDATE_URL || 'https://robinlawyer.ai/descargas/robin-search-latest.json';

// Formatos soportados. Un expediente real no son solo PDF/DOCX limpios: es un ecosistema
// de pruebas, comunicaciones y archivos técnicos. RobinSearch los indexa TODOS en local
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
function esDirectorio(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// La coma NO es separador de carpetas por defecto: en un despacho es normalísimo que la
// carpeta del cliente lleve una en el nombre ("Z:\\Clientes\\Construcciones Vidal, S.L."), y
// partir ahí dejaba esa carpeta sin indexar sin decir nada. Solo se desdobla por coma si el
// texto completo NO es una carpeta y los trozos SÍ lo son (compatibilidad con los
// ROBIN_FOLDERS="A,B" que documentamos antes).
function desdoblarPorComa(trozo) {
  const t = trozo.trim();
  if (!t.includes(',') || esDirectorio(t)) return [t];
  const partes = t.split(',').map((x) => x.trim()).filter(Boolean);
  return partes.length > 1 && partes.every(esDirectorio) ? partes : [t];
}

// Carpetas elegidas desde la app de escritorio. Viven en NUESTRO directorio de
// datos, no en los ajustes de Claude: el abogado configura RobinSearch en la
// app de RobinSearch, y no en dos sitios distintos.
export function rutaAjustes(dataDir) {
  return path.join(dataDir, 'ajustes.json');
}

function leerAjustes(dataDir) {
  try {
    const raw = fs.readFileSync(rutaAjustes(dataDir), 'utf8');
    const d = JSON.parse(raw);
    return Array.isArray(d?.carpetas) ? d.carpetas.map(String) : [];
  } catch {
    return [];
  }
}

// Migración de un solo uso: quien ya tenía la carpeta puesta en la pantalla de
// configuración de Claude no debe perderla al actualizar. Se lee UNA vez el
// fichero de ajustes de la extensión y se copia al nuestro.
function migrarDesdeClaude(dataDir) {
  try {
    if (fs.existsSync(rutaAjustes(dataDir))) return [];
    const home = os.homedir();
    const base = process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Claude')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude')
        : path.join(home, '.config', 'Claude');
    // El id de la extensión lo deriva Claude del autor del manifiesto, y ha cambiado: la 1.0.0
    // era `local.mcpb.robin-lawyer.robin-search` y desde la 1.2.2 es
    // `local.mcpb.robinlawyer.ai.robin-search`. Leer solo el primero dejaba SIN CARPETA a quien
    // actualizaba desde una 1.2.2–1.4.1 sin pasar por la app (visto el 14-sep-2026). Se prueban
    // todos, el más reciente primero.
    const dir = path.join(base, 'Claude Extensions Settings');
    const mtime = (f) => {
      try {
        return fs.statSync(f).mtimeMs;
      } catch {
        return 0;
      }
    };
    const candidatos = fs
      .readdirSync(dir)
      .filter((n) => /^local\.mcpb\..*robin-search\.json$/i.test(n))
      .map((n) => path.join(dir, n))
      .sort((a, b) => mtime(b) - mtime(a));
    for (const f of candidatos) {
      let carpetas;
      try {
        carpetas = JSON.parse(fs.readFileSync(f, 'utf8'))?.userConfig?.robin_folders;
      } catch {
        continue;
      }
      const lista = Array.isArray(carpetas)
        ? carpetas.map(String).filter(Boolean)
        : typeof carpetas === 'string' && carpetas.trim() ? [carpetas.trim()] : [];
      if (!lista.length) continue;
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(rutaAjustes(dataDir), JSON.stringify({ carpetas: lista, migradoDeClaude: true }, null, 2));
      return lista;
    }
    return [];
  } catch {
    return [];
  }
}

// ¿Fija las carpetas el ENTORNO? En un despliegue masivo de IT (GPO/JAMF/
// Intune) se pasan por variable, y entonces lo que elija el abogado en la app
// no se aplica. Hay que saberlo para poder DECÍRSELO en vez de fingir que sí.
export function carpetasFijadasPorEntorno() {
  return Boolean(
    firstDefined(process.env.ROBIN_FOLDERS)
    || firstDefined(process.env.ROBIN_FOLDER, process.env.ROBIN_WATCHED_FOLDER),
  );
}

function parseFolders(dataDir) {
  // Precedencia: variables de entorno (despliegue de IT y pruebas) por encima
  // de todo; después lo que haya elegido el abogado en la app.
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
      list = t.split(/[\n;]+/).flatMap(desdoblarPorComa);
    }
  } else if (single) {
    list = [single];
  } else if (dataDir) {
    list = leerAjustes(dataDir);
    if (!list.length) list = migrarDesdeClaude(dataDir);
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
  const dataDir = firstDefined(process.env.ROBIN_DATA_DIR) || defaultDataDir();
  const roots = buildRoots(parseFolders(dataDir));

  const cfg = {
    version: VERSION,
    // Token Robin Lawyer: solo se usa para verificación en arranque y para las llamadas
    // a la API remota de jurisprudencia/normativa. NUNCA viaja con contenido documental.
    robinToken: firstDefined(process.env.ROBIN_TOKEN),
    robinApiUrl: firstDefined(process.env.ROBIN_API_URL) || 'https://api.robinlawyer.ai/mcp',
    // Servidor OAuth de Robin Lawyer (el mismo que usa el conector remoto). El abogado inicia
    // sesión en el navegador; RobinSearch no pide token que pegar. `ROBIN_TOKEN` sigue
    // disponible como fallback headless para despliegue IT masivo (sin navegador).
    oauthIssuer: (firstDefined(process.env.ROBIN_OAUTH_ISSUER) || 'https://api.robinlawyer.ai').replace(/\/+$/, ''),
    // Aviso técnico automático de fallos (diagnostico.js). Solo datos técnicos: nada de los
    // documentos. null = desactivado.
    diagnosticoUrl: urlDiagnostico(),
    // No abrir el navegador para el login OAuth: pruebas automáticas y
    // despliegues headless de IT (ahí se usa ROBIN_TOKEN).
    noBrowser: firstDefined(process.env.ROBIN_NO_BROWSER) === '1',

    // Carpetas de expedientes vigiladas (multi-raíz).
    roots,
    watchedFolders: roots.map((r) => r.path),
    // Primera raíz — solo para mensajes/compatibilidad; el código itera watchedFolders/roots.
    watchedFolder: roots[0]?.path ?? null,

    dataDir,
    // Índice de vectra (≤1.4.4). Ya no se escribe: solo se lee UNA vez para pasarlo al formato
    // por documento de <dataDir>/indice (search/store.js), y después se borra.
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

    // Aislamiento por expediente. `expedienteDepth` = cuántos niveles de subcarpeta por
    // debajo de cada carpeta vigilada delimitan un expediente:
    //   1 (por defecto) → carpeta madre con una subcarpeta por caso:  Expedientes/Caso-A/...
    //   0               → cada carpeta vigilada ES un expediente (el abogado añade una por caso)
    // Los documentos sueltos directamente bajo la raíz forman el expediente de la propia raíz.
    expedienteDepth: (() => {
      const raw = process.env.ROBIN_EXPEDIENTE_DEPTH;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 ? n : 1;
    })(),

    // OCR de PDFs escaneados (v1.0). 100% local vía tesseract.js (WASM). Activado por
    // defecto; se puede desactivar en despliegues que hagan OCR externo por lotes.
    ocrEnabled: process.env.ROBIN_OCR !== 'false',
    ocrLang: firstDefined(process.env.ROBIN_OCR_LANG) || 'spa',
    ocrDpi: toInt(process.env.ROBIN_OCR_DPI, 200),
    // Tope de páginas a las que se aplica OCR por fichero (el OCR es lento; evita que un
    // escaneado gigante bloquee la cola indefinidamente).
    ocrMaxPages: toInt(process.env.ROBIN_OCR_MAX_PAGES, 5000),

    // Carpetas de RED (unidad mapeada Z:\\ o montaje SMB). El SO no notifica de forma fiable
    // los cambios que hace un compañero desde otro equipo, así que se re-escanean solas cada
    // `rescanRedMs` (incremental: solo se re-indexa lo que cambió) y, además, al abrir el
    // expediente. ROBIN_RESCAN_MS=0 desactiva el re-escaneo periódico.
    rescanRedMs: (() => {
      const raw = process.env.ROBIN_RESCAN_MS;
      if (raw === undefined || raw === '') return 5 * 60 * 1000;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 ? n : 5 * 60 * 1000;
    })(),
    rescanAlAbrir: process.env.ROBIN_RESCAN_ON_OPEN !== 'false',

    logLevel: firstDefined(process.env.ROBIN_LOG_LEVEL) || 'info',
  };
  cfg.tesseractCache = path.join(cfg.dataDir, 'tesseract');

  return cfg;
}

export const config = buildConfig();

// Crea los directorios de datos si no existen. Idempotente.
export function ensureDataDirs() {
  for (const dir of [config.dataDir, config.logDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Tamaño máximo por tipo de fichero. Por encima, el fichero se APARTA del indexado y se dice en
// estado_servidor: un único fichero gigante no puede agotar la memoria del proceso y tumbar
// RobinSearch. ROBIN_MAX_MB fija un tope único para todos los tipos.
const LIMITE_MB_POR_TIPO = {
  '.pdf': 512,
  '.zip': 1024,
  '.rar': 1024,
  '.7z': 1024,
  '.jpg': 64,
  '.jpeg': 64,
  '.png': 64,
  '.bmp': 64,
  '.gif': 64,
  '.heic': 64,
  '.tif': 128,
  '.tiff': 128,
  '.txt': 128,
  '.md': 128,
};
const LIMITE_MB_OTROS = 256;

export function limiteBytes(ext) {
  const unico = parseFloat(process.env.ROBIN_MAX_MB);
  const mb = Number.isFinite(unico) && unico > 0
    ? unico
    : LIMITE_MB_POR_TIPO[String(ext || '').toLowerCase()] ?? LIMITE_MB_OTROS;
  return Math.round(mb * 1024 * 1024);
}

// Adónde va el aviso técnico. ROBIN_DIAGNOSTICO_URL=off lo desactiva (despliegues de IT que no
// quieran más salida que la del login). Si se ha redirigido el feed de actualizaciones a otro
// sitio (pruebas automáticas, entornos de IT), NO se avisa a producción salvo que se diga
// explícitamente: una prueba que rompe el motor adrede no puede llenar de avisos el panel.
function urlDiagnostico() {
  const v = firstDefined(process.env.ROBIN_DIAGNOSTICO_URL);
  if (v) return /^(off|0|false|no)$/i.test(v.trim()) ? null : v.trim();
  const feed = firstDefined(process.env.ROBIN_UPDATE_URL);
  if (feed && !/^https:\/\/([a-z0-9-]+\.)*robinlawyer\.ai\//i.test(feed)) return null;
  const issuer = (firstDefined(process.env.ROBIN_OAUTH_ISSUER) || 'https://api.robinlawyer.ai').replace(/\/+$/, '');
  return `${issuer}/robinsearch/diagnostico`;
}

// Devuelve la raíz (carpeta vigilada) a la que pertenece una ruta absoluta, o null.
// Ante anidamiento, gana la raíz más específica (prefijo más largo).
// En Windows y macOS el sistema de ficheros no distingue mayúsculas: "Z:\\Expedientes" y
// "z:\\expedientes" son la MISMA carpeta. Comparar sensible a mayúsculas dejaba fuera del
// ámbito una ruta correcta (p. ej. la que escribe Claude con otra caja que la configurada).
const COMPARA_SIN_CAJA = process.platform === 'win32' || process.platform === 'darwin';
const paraComparar = (p) => (COMPARA_SIN_CAJA ? p.toLowerCase() : p);

export function rootForPath(absPath) {
  const resolved = path.resolve(absPath);
  const cmp = paraComparar(resolved);
  let best = null;
  for (const r of config.roots) {
    const rc = paraComparar(r.path);
    if (cmp === rc || cmp.startsWith(rc + path.sep)) {
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

// ---------------------------------------------------------------------------------------
// Expediente = unidad de aislamiento. Se deriva de la ruta lógica del documento, así que no
// exige que el abogado configure nada: es la carpeta del caso tal y como ya la tiene en disco.
//
// Regla (con expedienteDepth = 1, el valor por defecto):
//   Expedientes/Caso-A/demanda.pdf        → "Expedientes/Caso-A"
//   Expedientes/Caso-A/anexos/prueba.pdf  → "Expedientes/Caso-A"
//   Expedientes/suelto.pdf                → "Expedientes"   (suelto bajo la raíz)
// Con expedienteDepth = 0, todo lo de una raíz es un único expediente: "Expedientes".
export const EXPEDIENTE_SIN_CARPETA = '_sin_expediente';

// Deriva el expediente a partir de la ruta LÓGICA (`nombreRaíz/rutaRelativa`), que es lo que
// se guarda en el registro y en el índice. Determinista y sin tocar disco.
export function expedienteForLogicalPath(rutaLogica, depth = config.expedienteDepth) {
  if (!rutaLogica) return EXPEDIENTE_SIN_CARPETA;
  const segments = String(rutaLogica).split('/').filter(Boolean);
  const carpetas = segments.slice(0, -1); // el último segmento es el nombre del fichero
  if (carpetas.length === 0) return EXPEDIENTE_SIN_CARPETA;
  return carpetas.slice(0, 1 + Math.max(0, depth)).join('/');
}

// Ídem a partir de una ruta absoluta.
export function expedienteForPath(absPath, depth = config.expedienteDepth) {
  return expedienteForLogicalPath(logicalPath(absPath), depth);
}

// Relee las carpetas sin reiniciar el proceso. Los consumidores leen
// `config.roots` / `config.watchedFolders` en cada uso, así que basta con
// actualizar el objeto: no hay copias congeladas por ahí.
export function recargarCarpetas() {
  const roots = buildRoots(parseFolders(config.dataDir));
  config.roots = roots;
  config.watchedFolders = roots.map((r) => r.path);
  config.watchedFolder = roots[0]?.path ?? null;
  return config.watchedFolders;
}

// Guarda las carpetas que ha elegido el abogado en la app y las aplica.
export function guardarCarpetas(carpetas) {
  const lista = (Array.isArray(carpetas) ? carpetas : [carpetas])
    .map((c) => String(c || '').trim())
    .filter(Boolean)
    .map((c) => path.resolve(c));
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(rutaAjustes(config.dataDir), JSON.stringify({ carpetas: lista }, null, 2));
  return recargarCarpetas();
}

export default config;
