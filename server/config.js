// Configuración central de RobinSearch (servidor MCP local).
// Todo se resuelve desde variables de entorno (código portable, sin rutas hardcodeadas)
// para cumplir el requisito catalog-ready de Anthropic.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { escribirJson, leerJson } from './persistencia.js';
import { rutas, extensionDe, nombreValido } from './rutas.js';

// La versión sale del package.json que viaja en el paquete, NO de una
// constante a mano: escrita dos veces, se olvida una. El servidor estuvo
// diciendo que era la 1.4.0 siendo la 1.4.2, y eso se enseña al abogado.
function leerVersion() {
  try {
    // fileURLToPath y no `new URL().pathname`: en Windows este da «/C:/...» y la
    // lectura fallaba siempre → versión 0.0.0 y aviso de actualización perpetuo.
    const aqui = path.dirname(fileURLToPath(import.meta.url));
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

// Ajustes cortados (apagón a mitad) no pueden dejar al abogado sin carpetas: se recuperan de la
// copia .bak que deja cada escritura.
//
// Formato de ajustes.json:
//   { "carpetas": ["/ruta/A", "/ruta/B"], "nombres": { "/ruta/B": "Expedientes-2" } }
// `carpetas` sigue siendo una lista de RUTAS porque la app de escritorio la lee y la escribe así
// (y la reescribe entera sin `nombres`). Se acepta también `{ruta, nombre}` en `carpetas`.
// `fiable` = se ha podido leer (o no existe): con un fichero dañado o bloqueado NO se sabe qué
// carpetas hay, y entonces nada se puede dar por «quitado de la configuración».
function leerAjustes(dataDir) {
  try {
    const r = leerJson(rutaAjustes(dataDir));
    const v = r.valor || {};
    const carpetas = [];
    const nombres = new Map();
    for (const c of Array.isArray(v.carpetas) ? v.carpetas : []) {
      const ruta = c && typeof c === 'object' ? c.ruta : c;
      if (typeof ruta !== 'string' || !ruta.trim()) continue;
      carpetas.push(ruta);
      if (c && typeof c === 'object' && nombreValido(c.nombre)) nombres.set(rutas.claveRuta(path.resolve(ruta.trim())), c.nombre);
    }
    if (v.nombres && typeof v.nombres === 'object') {
      for (const [ruta, nombre] of Object.entries(v.nombres)) {
        const k = rutas.claveRuta(path.resolve(ruta));
        if (nombreValido(nombre) && !nombres.has(k)) nombres.set(k, nombre);
      }
    }
    return {
      carpetas,
      nombres,
      fiable: r.estado !== 'corrupto',
      existe: r.estado !== 'no_existe',
      tieneCarpetas: Array.isArray(v.carpetas),
    };
  } catch {
    return { carpetas: [], nombres: new Map(), fiable: false, existe: true, tieneCarpetas: false };
  }
}

// Migración de un solo uso: quien ya tenía la carpeta puesta en la pantalla de
// configuración de Claude no debe perderla al actualizar. Se lee UNA vez el
// fichero de ajustes de la extensión y se copia al nuestro.
function migrarDesdeClaude(dataDir, ajustes = leerAjustes(dataDir)) {
  try {
    // Solo si el abogado aún no tiene carpetas propias. Un ajustes.json que solo guarda los
    // nombres de las carpetas (despliegue por variable de entorno) no cuenta como «ya migrado»;
    // uno ilegible, sí: no se pisa lo que no se ha podido leer.
    if (ajustes.existe && (ajustes.tieneCarpetas || !ajustes.fiable)) return [];
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
      escribirJson(rutaAjustes(dataDir), { carpetas: lista, migradoDeClaude: true }, { bak: true, indent: 2 });
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
  const ajustes = dataDir ? leerAjustes(dataDir) : { carpetas: [], nombres: new Map(), fiable: true };
  let list = [];
  let fiable = true;
  if (multi) {
    const t = multi.trim();
    if (t.startsWith('[')) {
      try {
        list = JSON.parse(t);
      } catch {
        list = [];
        fiable = false;
      }
    } else {
      list = t.split(/[\n;]+/).flatMap(desdoblarPorComa);
    }
  } else if (single) {
    list = [single];
  } else if (dataDir) {
    list = ajustes.carpetas;
    fiable = ajustes.fiable;
    if (!list.length) list = migrarDesdeClaude(dataDir, ajustes);
  }
  return {
    lista: (Array.isArray(list) ? list : []).map((s) => String(s).trim()).filter(Boolean),
    nombres: ajustes.nombres,
    fiable,
  };
}

// Cada carpeta vigilada es una "raíz" con un NOMBRE LÓGICO: el primer segmento del id de sus
// expedientes («Expedientes/Caso»), con el que se filtra la búsqueda y se cita el documento.
//
// El nombre es ESTABLE: se guarda en ajustes.json junto a la ruta y se respeta al quitar o
// añadir otras carpetas. Antes se recalculaba por orden: con `A/Expedientes` y `B/Expedientes`,
// B era «Expedientes-2»; al quitar A, B pasaba a «Expedientes» y el expediente «Expedientes/Caso»
// devolvía los documentos que A había dejado en el índice — los de OTRO cliente.
//
// `guardados`: Map claveRuta → nombre. Primero se respetan los guardados; después se nombra lo
// nuevo por el nombre de la carpeta, desduplicando sin distinguir mayúsculas.
function buildRoots(paths, guardados = new Map()) {
  const unicas = [];
  const vistas = new Set();
  for (const p of paths) {
    const abs = path.resolve(p);
    const k = rutas.claveRuta(abs);
    if (vistas.has(k)) continue; // la misma carpeta escrita dos veces
    vistas.add(k);
    unicas.push({ path: abs, clave: k });
  }
  const usados = new Set();
  const roots = unicas.map((u) => ({ name: null, path: u.path, clave: u.clave }));
  for (const r of roots) {
    const g = guardados.get(r.clave);
    if (nombreValido(g) && !usados.has(rutas.claveNombre(g))) {
      r.name = g;
      r.nombreGuardado = true;
      usados.add(rutas.claveNombre(g));
    }
  }
  for (const r of roots) {
    if (r.name) continue;
    const base = rutas.nombreBase(r.path);
    let name = base;
    for (let n = 2; usados.has(rutas.claveNombre(name)); n += 1) name = `${base}-${n}`;
    r.name = name;
    r.nombreGuardado = false;
    usados.add(rutas.claveNombre(name));
  }
  return roots.map(({ clave: _k, ...r }) => r);
}

function buildConfig() {
  const dataDir = firstDefined(process.env.ROBIN_DATA_DIR) || defaultDataDir();
  const leidas = parseFolders(dataDir);
  const roots = buildRoots(leidas.lista, leidas.nombres);

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
    // ¿Se ha podido leer de verdad la configuración de carpetas? Con ajustes.json dañado no se
    // puede concluir que una carpeta «se ha quitado» (y retirar sus documentos del índice).
    carpetasFiables: leidas.fiable,

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
    // escaneado gigante bloquee la cola indefinidamente). Hasta la 1.4.7 eran 5000: a varios
    // segundos por página, un solo escaneado tenía el indexado parado horas. 300 páginas cubren
    // casi cualquier escrito; un tomo mayor se indexa hasta ahí y se dice en el registro.
    ocrMaxPages: toInt(process.env.ROBIN_OCR_MAX_PAGES, 300),
    // Y un tope de TIEMPO por documento (minutos), por si las páginas son lentísimas.
    ocrMaxMsPorDocumento: toInt(process.env.ROBIN_OCR_MAX_MIN, 30) * 60 * 1000,

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

    // 🔴 RED DE SEGURIDAD DE LAS CARPETAS LOCALES (21-sep-2026, Eduardo: «meto documentos
    // nuevos y no los indexa»). Una carpeta local se vigila con el vigilante del sistema
    // (FSEvents en Mac, ReadDirectoryChangesW en Windows) y eso basta casi siempre — pero
    // «casi» aquí no vale. FSEvents se pierde cambios de verdad: carpetas sincronizadas por
    // iCloud / Drive / Dropbox (el fichero aparece como marcador y se materializa después),
    // discos externos que se desmontan y vuelven, el equipo suspendido, o una copia enorme
    // que desborda la cola del sistema. Cuando eso pasa, hasta ahora NADIE volvía a mirar:
    // el documento se quedaba fuera del índice para siempre y el abogado buscaba creyendo
    // tenerlo. Así que además del vigilante se repasa la carpeta cada `rescanLocalMs`. Es
    // incremental (compara tamaño y fecha contra el registro): sobre una carpeta al día es
    // un recorrido de directorios y nada más. ROBIN_RESCAN_LOCAL_MS=0 lo desactiva.
    rescanLocalMs: (() => {
      const raw = process.env.ROBIN_RESCAN_LOCAL_MS;
      if (raw === undefined || raw === '') return 15 * 60 * 1000;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 ? n : 15 * 60 * 1000;
    })(),

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
  // Hojas de cálculo y CSV: xlsx/papaparse los cargan enteros y el texto resultante se multiplica
  // (cada celda con su separador); por encima de 32 MB el proceso se quedaba sin memoria.
  '.xlsx': 32,
  '.xlsm': 32,
  '.xls': 32,
  '.ods': 32,
  '.fods': 32,
  '.csv': 32,
  '.tsv': 32,
};

// Tope de fragmentos por documento: un documento enorme (un volcado de miles de páginas) se
// indexa hasta aquí. Sin tope, su .jsonl crecía sin límite y volvía a no poder leerse.
export const MAX_FRAGMENTOS_POR_DOCUMENTO = (() => {
  const n = parseInt(process.env.ROBIN_MAX_FRAGMENTOS, 10);
  return Number.isFinite(n) && n > 0 ? n : 20000;
})();
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
// Ante anidamiento, gana la raíz más específica. La comparación la hace rutas.js: sin distinguir
// mayúsculas en Windows y macOS ("Z:\Expedientes" y "z:\expedientes" son la MISMA carpeta),
// y correcta con raíces de unidad (`I:\`) y recursos UNC (`\\srv\exp\`), que ya llevan la barra
// final y con `startsWith(raíz + sep)` no casaban con nada.
export function rootForPath(absPath) {
  return rutas.raizDe(config.roots, absPath)?.raiz ?? null;
}

// Ruta "lógica" de un fichero = `${nombreRaíz}/${rutaRelativaDentroDeLaRaíz}`. Es lo que se
// muestra en las citas y contra lo que actúa `carpeta_filtro`, de modo que dos ficheros con
// la misma ruta relativa en raíces distintas no colisionan.
export function logicalPath(absPath) {
  return rutas.rutaLogica(config.roots, absPath) ?? path.basename(path.resolve(absPath));
}

// Una ruta que entra (la que pide Claude en indexar_carpeta, la de un evento del vigilante)
// escrita como la escribe el recorrido de la carpeta: raíz tal cual está configurada y el resto
// con la caja y la forma Unicode del disco. La clave del registro es la ruta: escrita de otra
// manera, el mismo documento entraba dos veces.
export function canonizarRuta(absPath, { disco = true } = {}) {
  return rutas.canonizar(config.roots, absPath, { realpath: disco ? realpathNativo : null });
}

function realpathNativo(p) {
  return fs.realpathSync.native(p);
}

// ¿Se indexa este fichero? Por su extensión, sin distinguir mayúsculas ni espacios finales.
// Los «~$Demanda.docx» que Word, Excel y PowerPoint dejan junto a un documento ABIERTO no son
// documentos (unos 160 bytes con el nombre de quien lo tiene abierto): cada vez que el abogado
// abría un .docx, el vigilante los recogía y salía «Can't find end of central directory» como
// error de indexado (aviso técnico del 16-sep, 1.6.0).
export function esExtensionSoportada(ruta) {
  if (String(ruta).split(/[\\/]/).pop().startsWith('~$')) return false;
  return SUPPORTED_EXTENSIONS.has(extensionDe(ruta));
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

// Nombres en uso ahora mismo, por ruta: al releer las carpetas mandan sobre los del fichero. La
// app de escritorio reescribe ajustes.json SOLO con `carpetas` justo antes de pedir el cambio,
// así que en ese momento el fichero ya no tiene los nombres y la memoria sí.
function nombresEnMemoria() {
  const m = new Map();
  for (const r of config.roots || []) m.set(rutas.claveRuta(r.path), r.name);
  return m;
}

function aplicarRoots(roots) {
  config.roots = roots;
  config.watchedFolders = roots.map((r) => r.path);
  config.watchedFolder = roots[0]?.path ?? null;
}

// Relee las carpetas sin reiniciar el proceso. Los consumidores leen
// `config.roots` / `config.watchedFolders` en cada uso, así que basta con
// actualizar el objeto: no hay copias congeladas por ahí.
export function recargarCarpetas() {
  const leidas = parseFolders(config.dataDir);
  const nombres = new Map([...leidas.nombres, ...nombresEnMemoria()]);
  aplicarRoots(buildRoots(leidas.lista, nombres));
  config.carpetasFiables = leidas.fiable;
  refinarCarpetas();
  return config.watchedFolders;
}

// La misma ruta con cada segmento escrito como está EN DISCO (caja y forma Unicode), sin seguir
// enlaces: se busca cada nombre en el listado de su carpeta madre. null si algo no se puede leer.
function formaEnDisco(abs) {
  const { root } = path.parse(abs);
  let actual = /^[a-z]:/.test(root) ? root[0].toUpperCase() + root.slice(1) : root;
  for (const seg of abs.slice(root.length).split(path.sep).filter(Boolean)) {
    let nombres;
    try {
      nombres = fs.readdirSync(actual);
    } catch {
      return null;
    }
    const k = rutas.claveRuta(seg);
    const hit = nombres.includes(seg) ? seg : nombres.find((n) => rutas.claveRuta(n) === k);
    if (!hit) return null;
    actual = path.join(actual, hit);
  }
  return actual;
}

// Escribe cada carpeta como está EN DISCO cuando solo cambia la caja o la forma Unicode
// (configurada «z:\expedientes», en disco «Z:\Expedientes»; o «Pérez» en NFC con la carpeta en
// NFD). Así las rutas del recorrido, las del vigilante y las del registro coinciden letra a letra,
// y en macOS el vigilante recibe la ruta que entiende FSEvents (con otra forma Unicode no avisaba
// de nada). Además se guarda la ruta REAL (sin enlaces: /tmp → /private/tmp) en `real`, para
// reconocer rutas que lleguen escritas de esa otra forma.
// No se hace al importar config.js: sobre una unidad de red caída puede tardar, y eso no puede
// retrasar el saludo con Claude. Lo llama el arranque (y el cambio de carpetas desde la app).
export function refinarCarpetas() {
  let cambio = false;
  for (const r of config.roots) {
    if (rutas.sinCaja) {
      const enDisco = formaEnDisco(r.path);
      if (enDisco && enDisco !== r.path && rutas.claveRuta(enDisco) === rutas.claveRuta(r.path)) {
        r.configurada ??= r.path;
        // Un nombre aún no guardado que salió de la ruta mal escrita («CASOS») se escribe también
        // como en disco («Casos»). Uno ya guardado no se toca: es estable a propósito.
        const nombreDisco = rutas.nombreBase(enDisco);
        if (!r.nombreGuardado && r.name === rutas.nombreBase(r.path) && rutas.claveNombre(nombreDisco) === rutas.claveNombre(r.name)) {
          r.name = nombreDisco;
        }
        r.path = enDisco;
        cambio = true;
      }
    }
    try {
      const real = fs.realpathSync.native(r.path);
      if (real !== r.path) r.real = real;
      else delete r.real;
    } catch {
      /* no existe o no responde ahora: se deja como está */
    }
  }
  if (cambio) aplicarRoots(config.roots);
  return cambio;
}

// Rutas tal y como las configuró el abogado (la app compara con lo que guardó, letra a letra),
// aunque internamente se escriban como están en disco.
export function comoConfiguradas(lista) {
  return (lista || []).map((p) => config.roots.find((r) => r.path === p)?.configurada ?? p);
}

// Guarda en ajustes.json el nombre lógico de cada carpeta vigilada, sin tocar el resto del
// fichero (`carpetas` lo gobierna la app). No escribe si ya está al día ni si el fichero no se ha
// podido leer (no se pisa lo que no se sabe qué tiene).
export function guardarNombres() {
  const ruta = rutaAjustes(config.dataDir);
  let actual = {};
  try {
    const r = leerJson(ruta);
    if (r.estado === 'corrupto') return false;
    actual = r.valor || {};
  } catch {
    return false;
  }
  const nombres = {};
  for (const r of config.roots) nombres[r.path] = r.name;
  const previos = actual.nombres && typeof actual.nombres === 'object' ? actual.nombres : {};
  const iguales = Object.keys(nombres).length === Object.keys(previos).length
    && Object.entries(nombres).every(([k, v]) => previos[k] === v);
  if (iguales) return false;
  fs.mkdirSync(config.dataDir, { recursive: true });
  escribirJson(ruta, { ...actual, nombres }, { bak: true, indent: 2 });
  for (const r of config.roots) r.nombreGuardado = true;
  return true;
}

// Guarda las carpetas que ha elegido el abogado en la app y las aplica. `carpetas` es la lista
// de rutas que manda la app (se aceptan también objetos `{ruta, nombre}`). Los nombres de las
// carpetas que siguen se CONSERVAN.
export function guardarCarpetas(carpetas) {
  const lista = [];
  const nombres = {};
  for (const c of Array.isArray(carpetas) ? carpetas : [carpetas]) {
    const bruta = c && typeof c === 'object' ? c.ruta : c;
    const t = String(bruta || '').trim();
    if (!t) continue;
    const abs = path.resolve(t);
    lista.push(abs);
    if (c && typeof c === 'object' && nombreValido(c.nombre)) nombres[abs] = c.nombre;
  }
  const previos = nombresEnMemoria();
  for (const abs of lista) {
    if (!nombres[abs] && previos.has(rutas.claveRuta(abs))) nombres[abs] = previos.get(rutas.claveRuta(abs));
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const datos = { carpetas: lista };
  if (Object.keys(nombres).length) datos.nombres = nombres;
  escribirJson(rutaAjustes(config.dataDir), datos, { bak: true, indent: 2 });
  const vigiladas = recargarCarpetas();
  if (!carpetasFijadasPorEntorno()) {
    try {
      guardarNombres();
    } catch {
      /* se reintenta al reconciliar */
    }
  }
  return vigiladas;
}

export default config;
