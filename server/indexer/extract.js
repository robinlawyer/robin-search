// Extracción de texto por fichero. Soporta PDF (con texto extraíble) y DOCX en v1.0.
// Devuelve texto segmentado por página cuando la fuente lo permite (PDF), para poder
// anotar el nº de página en los metadatos de cada chunk (RF-03.6).
//
// Detección de PDF escaneado sin OCR: si tras recorrer todas las páginas apenas hay texto
// extraíble, el fichero se marca como `sinOcr` y NO se indexa (RF-03.4 / US-05).

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { log } from '../logger.js';
import { ocrPdf } from './ocr.js';

// Umbral: caracteres de texto extraíble por página por debajo del cual consideramos que
// el PDF es una imagen escaneada sin capa OCR.
const MIN_CHARS_PER_PAGE = 12;

// Resultado: { pages: [{ page: number, text: string }], sinOcr: boolean, numPages: number }
export async function extractPdf(filePath, { maxPages }) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const limit = Math.min(numPages, maxPages);
  const pages = [];
  let totalChars = 0;

  for (let p = 1; p <= limit; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => (typeof it.str === 'string' ? it.str : ''))
      .join(' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
    totalChars += text.length;
    if (text) pages.push({ page: p, text });
    page.cleanup();
  }
  await pdf.destroy();

  const escaneado = limit > 0 && totalChars / limit < MIN_CHARS_PER_PAGE;

  // PDF con capa de texto: devolvemos directamente.
  if (!escaneado) return { pages, sinOcr: false, numPages, viaOcr: false };

  // PDF escaneado: si el OCR está activado (v1.0), lo aplicamos en local. Si está desactivado
  // o no produce texto, se marca sinOcr para que el abogado lo sepa.
  if (!config.ocrEnabled) return { pages: [], sinOcr: true, numPages };

  log.info('PDF escaneado: aplicando OCR local', { fichero: path.basename(filePath), numPages });
  let ocrPages = [];
  try {
    ocrPages = await ocrPdf(filePath, { maxPages });
  } catch (err) {
    log.error('OCR falló; el fichero se marca sin OCR', { err: String(err) });
    return { pages: [], sinOcr: true, numPages };
  }
  if (ocrPages.length === 0) return { pages: [], sinOcr: true, numPages };
  return { pages: ocrPages, sinOcr: false, numPages, viaOcr: true };
}

// DOCX no tiene paginación fiable → todo el documento como un único bloque (page: null).
export async function extractDocx(filePath) {
  const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
  const { value } = await mammoth.extractRawText({ path: filePath });
  const text = (value || '').replace(/\r\n/g, '\n').trim();
  return { pages: text ? [{ page: null, text }] : [], sinOcr: false, numPages: null };
}

// Dispatcher por extensión.
export async function extractFile(filePath, { maxPages }) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return extractPdf(filePath, { maxPages });
  if (ext === '.docx') return extractDocx(filePath);
  throw new Error(`Formato no soportado en v1.0: ${ext}`);
}

export default { extractFile, extractPdf, extractDocx };
