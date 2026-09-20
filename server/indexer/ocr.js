// OCR local de PDFs escaneados (v1.0). 100% en el ordenador del abogado:
//   mupdf (WASM)  → rasteriza cada página del PDF a PNG
//   tesseract.js (WASM) → reconoce el texto de esa imagen
//
// Ninguna imagen ni texto del documento sale del ordenador, y desde la 1.3.4 tampoco hay
// descarga: el modelo de idioma (spa.traineddata, ≈3 MB) viaja EMPAQUETADO en `models/tesseract/`
// junto al de embedding. Antes se bajaba de un CDN la primera vez que alguien pasaba un PDF
// escaneado — una descarga más que podía fallar en casa del abogado, y con el mismo defecto:
// la promesa rechazada quedaba cacheada y el OCR ya no volvía a intentarlo en toda la sesión.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extensionDe } from '../rutas.js';
import { fileURLToPath } from 'node:url';
import { config, ensureDataDirs } from '../config.js';
import { log } from '../logger.js';
import { tipoReal } from './tipo-real.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS_DIR = process.env.ROBIN_MODELS_DIR || path.join(PKG_ROOT, 'models');
const OCR_DIR = path.join(MODELS_DIR, 'tesseract');

let _workerPromise = null;
let _estado = { listo: false, origen: null, error: null };

// ── Espacio en disco ───────────────────────────────────────────────────────────────────────
//
// 19-sep-2026 (Eduardo, Mac de 8 GB): en el mismo segundo en que empezaron 202 errores de
// lectura, el registro tenía antes un `ENOSPC: no space left on device` sobre un PDF. El OCR
// rasteriza CADA página a PNG y con un escaneado de 98 o 114 páginas eso son cientos de MB de
// temporales; con el disco justo, el propio OCR lo remata y arrastra todo lo demás.
//
// Así que se mira antes de empezar, y cada pocas páginas mientras dura.
const MB = 1024 * 1024;
const MINIMO_LIBRE_MB = Number(process.env.ROBIN_OCR_MINIMO_LIBRE_MB) || 800;
const CADA_N_PAGINAS = 10;

// MB libres en el volumen de `dir`, o null si el sistema no lo dice (nunca frena por no saberlo).
export function espacioLibreMb(dir) {
  try {
    const st = fs.statfsSync(dir);
    return Math.round((Number(st.bavail) * Number(st.bsize)) / MB);
  } catch {
    return null;
  }
}

function errorDiscoLleno(libreMb) {
  return Object.assign(
    new Error(
      `No hay espacio suficiente en el disco para leer este PDF escaneado (${libreMb} MB libres, hacen ` +
        `falta al menos ${MINIMO_LIBRE_MB} MB). El OCR convierte cada página a imagen y necesita sitio. ` +
        'Libera espacio y vuelve a indexar.',
    ),
    { code: 'ROBIN_DISCO_LLENO' },
  );
}

// ¿Hay sitio para rasterizar? Se comprueba donde se escriben los temporales.
function comprobarEspacio() {
  const libre = espacioLibreMb(config.tesseractCache || config.dataDir || os.tmpdir());
  if (libre !== null && libre < MINIMO_LIBRE_MB) throw errorDiscoLleno(libre);
  return libre;
}

// ── Memoria ────────────────────────────────────────────────────────────────────────────────
//
// La caída más repetida del panel (16-19 sep-2026) es la misma en tres despachos distintos:
// el proceso muere LEYENDO UN PDF. Rasterizar una página a 300 ppp son decenas de MB de bitmap
// dentro del WASM, que no los devuelve hasta terminar el documento; con el equipo ya justo de
// memoria, esa página es la que remata el proceso y el PDF —sano— acaba en cuarentena.
//
// Así que con poca memoria libre no se cae: se baja la resolución, y si ni así, se deja el
// documento para más tarde en vez de morir. Un PDF sin OCR se puede reintentar; un proceso
// muerto se lleva por delante el indexado entero y asusta al abogado.
const MINIMO_LIBRE_RAM_MB = Number(process.env.ROBIN_OCR_MINIMO_RAM_MB) || 400;
const RAM_PARA_DPI_PLENO_MB = Number(process.env.ROBIN_OCR_RAM_DPI_MB) || 900;

function ramLibreMb() {
  return Math.round(os.freemem() / MB);
}

// En macOS `os.freemem()` solo cuenta páginas LIBRES (la memoria inactiva, que el sistema
// entrega en cuanto se pide, no cuenta): allí la cifra es engañosamente baja y no se frena por
// ella, igual que hace el pool de embedding.
function memoriaFiable() {
  return process.platform !== 'darwin';
}

function dpiSegunMemoria(dpi) {
  if (!memoriaFiable()) return dpi;
  const libre = ramLibreMb();
  if (libre >= RAM_PARA_DPI_PLENO_MB) return dpi;
  if (libre >= MINIMO_LIBRE_RAM_MB) {
    const bajo = Math.max(150, Math.round(dpi * 0.66));
    log.warn('Poca memoria libre: se rasteriza el PDF escaneado a menos resolución', { libre_mb: libre, dpi: bajo });
    return bajo;
  }
  return null; // ni eso: mejor dejarlo para más tarde que morir en el intento
}

// ¿Está el idioma empaquetado y con el tamaño que dice el manifiesto?
export function idiomaEmpaquetado(lang = config.ocrLang) {
  const fichero = path.join(OCR_DIR, `${lang}.traineddata`);
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, 'manifest.json'), 'utf8'));
  } catch {
    /* sin manifiesto: se comprueba solo la existencia */
  }
  let stat;
  try {
    stat = fs.statSync(fichero);
  } catch {
    return { ok: false, motivo: 'no_empaquetado', lang, dir: OCR_DIR };
  }
  const esperado = manifest?.ocr?.lang === lang ? manifest.ocr.bytes : null;
  if (esperado != null && stat.size !== esperado) {
    return { ok: false, motivo: 'incompleto', lang, esperado, real: stat.size };
  }
  return { ok: true, lang, dir: OCR_DIR };
}

// Estado del OCR para `estado_servidor` (no fuerza la inicialización).
//
// El motor arranca PEREZOSO, con el primer documento escaneado: `listo: false` antes de eso se
// leía como un fallo. `estado` lo distingue: 'sin_usar' (aún no hizo falta), 'listo' o 'error'.
// `listo` se mantiene por compatibilidad.
export function estadoOcr() {
  if (!config.ocrEnabled) return { activo: false, estado: 'desactivado', motivo: 'desactivado (ROBIN_OCR=false)' };
  const emp = idiomaEmpaquetado();
  const estado = _estado.error ? 'error' : _estado.listo ? 'listo' : 'sin_usar';
  return {
    activo: true,
    estado,
    ...(estado === 'sin_usar' ? { nota: 'Se pone en marcha con el primer documento escaneado; no es un fallo.' } : {}),
    idioma: config.ocrLang,
    listo: _estado.listo,
    origen: _estado.origen,
    empaquetado: emp.ok,
    ...(emp.ok ? {} : { idioma_empaquetado: emp }),
    ...(_estado.error ? { error: _estado.error } : {}),
    ...(() => {
      const libre = espacioLibreMb(config.tesseractCache || config.dataDir);
      if (libre === null || libre >= MINIMO_LIBRE_MB) return {};
      return {
        espacio_libre_mb: libre,
        aviso_disco:
          `Quedan ${libre} MB libres en el disco. El OCR de PDFs escaneados convierte cada página a ` +
          'imagen y necesita sitio: mientras no haya espacio, esos PDFs no se podrán leer (el resto de ' +
          'documentos sí). Dile al abogado que libere espacio.',
      };
    })(),
  };
}

async function arrancarWorker() {
  ensureDataDirs();
  fs.mkdirSync(config.tesseractCache, { recursive: true });
  const { createWorker } = await import('tesseract.js');

  const emp = idiomaEmpaquetado();
  // errorHandler OBLIGATORIO: sin él, tesseract.js relanza el fallo de un trabajo DESDE el
  // manejador de mensajes del worker (createWorker.js), fuera de cualquier promesa. Una sola
  // imagen que no puede leer («Error attempting to read image.», p. ej. un .bmp roto de 243
  // bytes) era una excepción sin capturar que tumbaba RobinSearch entero. Con él, el rechazo
  // llega a `recognize` y solo falla ese fichero.
  const opciones = {
    cachePath: config.tesseractCache,
    errorHandler: (err) => log.warn('OCR: el motor no pudo leer una imagen', { err: String(err?.message ?? err).slice(0, 200) }),
  };
  if (emp.ok) {
    // Ruta local (no URL) → tesseract.js lo lee del disco. Guardamos el fichero sin
    // comprimir, así que `gzip:false`.
    opciones.langPath = OCR_DIR;
    opciones.gzip = false;
    _estado.origen = 'empaquetado';
  } else {
    _estado.origen = 'descarga';
    log.warn('Idioma de OCR NO empaquetado: se intentará descargar', emp);
  }

  log.info('Inicializando OCR (tesseract.js)', { lang: config.ocrLang, origen: _estado.origen });
  const worker = await createWorker(config.ocrLang, 1, opciones);
  log.info('OCR listo', { origen: _estado.origen });
  return worker;
}

async function getWorker() {
  if (_workerPromise) return _workerPromise;
  const intento = arrancarWorker();
  _workerPromise = intento;
  try {
    const worker = await intento;
    _estado = { ..._estado, listo: true, error: null };
    return worker;
  } catch (err) {
    // Igual que en el motor de embedding: no dejar cacheado el rechazo.
    if (_workerPromise === intento) _workerPromise = null;
    _estado = { ..._estado, listo: false, error: String(err?.message ?? err) };
    throw err;
  }
}

// Una página o imagen tarda segundos. Si el worker muere (memoria del WASM) o se queda colgado,
// tesseract.js no rechaza nunca y el indexado entero esperaba para siempre. Pasado el tope se
// descarta ese worker (el siguiente fichero arranca uno nuevo) y solo falla este.
const TOPE_RECONOCER_MS = Number(process.env.ROBIN_OCR_TOPE_MS) || 180_000;

async function reconocer(input) {
  const worker = await getWorker();
  let tope;
  try {
    return await Promise.race([
      worker.recognize(input),
      new Promise((_, rechazar) => {
        tope = setTimeout(() => rechazar(new Error(`OCR sin respuesta en ${TOPE_RECONOCER_MS / 1000} s`)), TOPE_RECONOCER_MS);
      }),
    ]);
  } catch (err) {
    if (/sin respuesta/.test(String(err?.message))) {
      if (_workerPromise) _workerPromise = null;
      _estado = { ..._estado, listo: false, error: String(err.message) };
      worker.terminate().catch(() => {});
    }
    throw err;
  } finally {
    clearTimeout(tope);
  }
}

export async function terminateOcr() {
  if (_workerPromise) {
    try {
      const w = await _workerPromise;
      await w.terminate();
    } catch {
      /* best-effort */
    }
    _workerPromise = null;
  }
}

// OCR de una imagen suelta (foto de siniestro, escaneo, pantallazo). Reutiliza el mismo
// worker de tesseract.js (WASM) que el OCR de PDF: nada sale del ordenador.
// Los .heic/.heif (fotos de iPhone) se convierten antes a un bitmap PNG con heic-convert
// (libheif en WASM), porque tesseract no lee HEIC directamente.
// Devuelve [{ page: 1, text }] (una imagen = una "página") o [] si no hay texto legible.
export async function ocrImage(filePath) {
  comprobarEspacio();
  const ext = extensionDe(filePath);
  let input;
  // Por contenido, no solo por extensión: una foto de iPhone en HEIC llamada «.jpg» es corriente
  // y tesseract la rechazaba con «Error attempting to read image.».
  if (ext === '.heic' || ext === '.heif' || tipoReal(filePath) === 'heic') {
    const heicConvert = (await import('heic-convert')).default;
    const buffer = fs.readFileSync(filePath);
    // A PNG sin pérdida para no degradar el OCR de un documento fotografiado.
    input = Buffer.from(await heicConvert({ buffer, format: 'PNG' }));
  } else {
    input = fs.readFileSync(filePath);
  }
  const {
    data: { text },
  } = await reconocer(input);
  const clean = (text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return clean ? [{ page: 1, text: clean }] : [];
}

// Rasteriza y aplica OCR a un PDF escaneado. Devuelve [{ page, text }] igual que el
// extractor normal, para que el resto del pipeline no note la diferencia.
export async function ocrPdf(filePath, { maxPages, dpi = config.ocrDpi } = {}) {
  const mupdf = await import('mupdf');
  const buf = fs.readFileSync(filePath);
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  const pages = [];
  try {
    const total = doc.countPages();
    const limit = Math.min(total, maxPages ?? config.ocrMaxPages, config.ocrMaxPages);
    if (total > limit) log.warn('PDF escaneado con más páginas que el tope de OCR: se lee hasta el tope', { paginas: total, tope: limit });

    await getWorker(); // si el OCR no arranca, falla el fichero antes de rasterizar nada
    comprobarEspacio(); // ni una página si no hay sitio para los temporales
    const dpiReal = dpiSegunMemoria(dpi);
    if (dpiReal === null) {
      throw Object.assign(
        new Error(
          `No hay memoria suficiente para leer este PDF escaneado (${ramLibreMb()} MB libres). Se ` +
            'reintentará solo cuando el equipo tenga más memoria; cerrar alguna aplicación pesada ayuda.',
        ),
        { code: 'ROBIN_FICHERO_SIN_MEMORIA' },
      );
    }
    const scale = mupdf.Matrix.scale(dpiReal / 72, dpiReal / 72);
    const inicio = Date.now();

    for (let i = 0; i < limit; i++) {
      if (Date.now() - inicio > config.ocrMaxMsPorDocumento) {
        log.warn('OCR: tope de tiempo por documento alcanzado; se indexa lo leído', { paginas_leidas: i, paginas: total });
        break;
      }
      // Un escaneado de 100 páginas puede llenar el disco a mitad: se vuelve a mirar cada poco y
      // se para con lo leído en vez de dejar el equipo sin espacio.
      if (i > 0 && i % CADA_N_PAGINAS === 0) {
        const libre = espacioLibreMb(config.tesseractCache || config.dataDir);
        if (libre !== null && libre < MINIMO_LIBRE_MB) {
          log.error('OCR parado: se está quedando sin espacio en disco; se indexa lo leído', { paginas_leidas: i, libre_mb: libre });
          break;
        }
        // Y la memoria: un escaneado de 100 páginas la va comiendo página a página. Parar con
        // lo leído es mucho mejor que que el sistema mate el proceso a mitad.
        if (memoriaFiable() && ramLibreMb() < MINIMO_LIBRE_RAM_MB) {
          log.error('OCR parado: se está quedando sin memoria; se indexa lo leído', { paginas_leidas: i, libre_mb: ramLibreMb() });
          break;
        }
      }
      let page;
      let pix;
      try {
        page = doc.loadPage(i);
        // Rasterizar es síncrono (WASM): con el proceso ocupado página tras página, Claude no
        // recibía respuesta y lo daba por muerto. Se suelta el proceso antes de cada página.
        await new Promise((r) => setImmediate(r));
        pix = page.toPixmap(scale, mupdf.ColorSpace.DeviceRGB, false, true);
        const png = pix.asPNG();
        pix.destroy?.();
        pix = null;
        const {
          data: { text },
        } = await reconocer(Buffer.from(png));
        const clean = (text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (clean) pages.push({ page: i + 1, text: clean });
      } catch (err) {
        log.warn('OCR falló en una página', { page: i + 1, err: String(err) });
      } finally {
        pix?.destroy?.();
        page?.destroy?.();
      }
    }
  } finally {
    // Sin esto, cada PDF escaneado dejaba su documento entero reservado en la memoria del WASM.
    doc.destroy?.();
  }
  return pages;
}

export default { ocrPdf, ocrImage, terminateOcr, estadoOcr, idiomaEmpaquetado, espacioLibreMb };
