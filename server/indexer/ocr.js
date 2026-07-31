// OCR local de PDFs escaneados (v1.0). 100% en el ordenador del abogado:
//   mupdf (WASM)  → rasteriza cada página del PDF a PNG
//   tesseract.js (WASM) → reconoce el texto de esa imagen
//
// Ninguna imagen ni texto del documento sale del ordenador. La única descarga externa es
// el modelo de idioma de Tesseract (spa.traineddata) la primera vez, cacheado en el dir de
// datos — es el modelo, no contenido documental (mismo criterio que el modelo de embedding).

import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDirs } from '../config.js';
import { log } from '../logger.js';

let _workerPromise = null;

async function getWorker() {
  if (!_workerPromise) {
    _workerPromise = (async () => {
      ensureDataDirs();
      fs.mkdirSync(config.tesseractCache, { recursive: true });
      const { createWorker } = await import('tesseract.js');
      log.info('Inicializando OCR (tesseract.js)', { lang: config.ocrLang });
      const worker = await createWorker(config.ocrLang, 1, {
        cachePath: config.tesseractCache,
      });
      log.info('OCR listo');
      return worker;
    })();
  }
  return _workerPromise;
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

export default { ocrPdf, ocrImage, terminateOcr };
