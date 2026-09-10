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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ensureDataDirs } from '../config.js';
import { log } from '../logger.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS_DIR = process.env.ROBIN_MODELS_DIR || path.join(PKG_ROOT, 'models');
const OCR_DIR = path.join(MODELS_DIR, 'tesseract');

let _workerPromise = null;
let _estado = { listo: false, origen: null, error: null };

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
export function estadoOcr() {
  if (!config.ocrEnabled) return { activo: false, motivo: 'desactivado (ROBIN_OCR=false)' };
  const emp = idiomaEmpaquetado();
  return {
    activo: true,
    idioma: config.ocrLang,
    listo: _estado.listo,
    origen: _estado.origen,
    empaquetado: emp.ok,
    ...(emp.ok ? {} : { idioma_empaquetado: emp }),
    ...(_estado.error ? { error: _estado.error } : {}),
  };
}

async function arrancarWorker() {
  ensureDataDirs();
  fs.mkdirSync(config.tesseractCache, { recursive: true });
  const { createWorker } = await import('tesseract.js');

  const emp = idiomaEmpaquetado();
  const opciones = { cachePath: config.tesseractCache };
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
  const ext = path.extname(filePath).toLowerCase();
  let input;
  if (ext === '.heic' || ext === '.heif') {
    const heicConvert = (await import('heic-convert')).default;
    const buffer = fs.readFileSync(filePath);
    // A PNG sin pérdida para no degradar el OCR de un documento fotografiado.
    input = Buffer.from(await heicConvert({ buffer, format: 'PNG' }));
  } else {
    input = fs.readFileSync(filePath);
  }
  const worker = await getWorker();
  const {
    data: { text },
  } = await worker.recognize(input);
  const clean = (text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return clean ? [{ page: 1, text: clean }] : [];
}

// Rasteriza y aplica OCR a un PDF escaneado. Devuelve [{ page, text }] igual que el
// extractor normal, para que el resto del pipeline no note la diferencia.
export async function ocrPdf(filePath, { maxPages, dpi = config.ocrDpi } = {}) {
  const mupdf = await import('mupdf');
  const buf = fs.readFileSync(filePath);
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  const total = doc.countPages();
  const limit = Math.min(total, maxPages ?? config.ocrMaxPages, config.ocrMaxPages);

  const worker = await getWorker();
  const scale = mupdf.Matrix.scale(dpi / 72, dpi / 72);
  const pages = [];

  for (let i = 0; i < limit; i++) {
    let page;
    try {
      page = doc.loadPage(i);
      const pix = page.toPixmap(scale, mupdf.ColorSpace.DeviceRGB, false, true);
      const png = pix.asPNG();
      const {
        data: { text },
      } = await worker.recognize(Buffer.from(png));
      const clean = (text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (clean) pages.push({ page: i + 1, text: clean });
      pix.destroy?.();
    } catch (err) {
      log.warn('OCR falló en una página', { page: i + 1, err: String(err) });
    } finally {
      page?.destroy?.();
    }
  }
  return pages;
}

export default { ocrPdf, ocrImage, terminateOcr, estadoOcr, idiomaEmpaquetado };
