// Extracción de texto por fichero. El objetivo de RobinSearch es entender la realidad
// desordenada de un despacho, no solo los PDF/DOCX "limpios": correos, hojas de cálculo,
// fotos de siniestros, volcados de WhatsApp y expedientes comprimidos de LexNet/Justizia.eus.
//
// Todo se procesa 100% en el ordenador del abogado (RGPD / secreto profesional): las librerías
// elegidas son puro JS o WASM, sin binarios nativos (Claude Desktop bloquea .node por Team ID).
//
// Cada extractor devuelve el mismo contrato que el resto del pipeline:
//   { pages: [{ page: number|null, text: string }], sinOcr: boolean, numPages: number|null }
// donde `pages` se trocea por página cuando la fuente lo permite (PDF), para anotar el nº de
// página en los metadatos de cada chunk (RF-03.6).

import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { config, limiteBytes } from '../config.js';
import { extensionDe } from '../rutas.js';
import { log } from '../logger.js';
import { ocrPdf, ocrImage } from './ocr.js';

const require = createRequire(import.meta.url);

// Umbral: caracteres de texto extraíble por página por debajo del cual consideramos que
// el PDF es una imagen escaneada sin capa OCR.
const MIN_CHARS_PER_PAGE = 12;

// Conjuntos de extensiones por familia (para el dispatcher y para saber qué recursión aplica).
const EXT_TEXT = new Set(['.txt', '.md', '.markdown']);
const EXT_HTML = new Set(['.html', '.htm']);
const EXT_OFFICE_XML = new Set(['.odt', '.odp', '.pptx']); // ZIP + XML (como DOCX)
const EXT_SPREADSHEET = new Set(['.xlsx', '.xls', '.ods', '.xlsm', '.fods']);
const EXT_CSV = new Set(['.csv', '.tsv']);
const EXT_IMAGE = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.gif', '.heic', '.heif']);
const EXT_ARCHIVE = new Set(['.zip', '.rar', '.7z']);

// ─────────────────────────────────────────────────────────────────────────────
// PDF (con detección de escaneado → OCR local)
// ─────────────────────────────────────────────────────────────────────────────
export async function extractPdf(filePath, { maxPages }) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // En Node (y dentro del .mcpb) pdfjs necesita un workerSrc explícito o lanza
  // "No GlobalWorkerOptions.workerSrc specified". Lo resolvemos al fichero real del worker,
  // que pdfjs carga como "fake worker" en el hilo principal (no hay Web Workers en Node).
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    // El worker se carga YA en este hilo y se deja en globalThis.pdfjsWorker, que pdfjs usa sin
    // pasar por ninguna ruta. Con la ruta a pelo, pdfjs hacía `import('C:\\...')` y en Windows
    // Node lo rechaza (ERR_UNSUPPORTED_ESM_URL_SCHEME): NINGÚN PDF se indexaba. Por si acaso,
    // workerSrc va como URL file://, que vale en todos los sistemas.
    globalThis.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
    if (typeof pdfjs.setVerbosityLevel === 'function') {
      pdfjs.setVerbosityLevel(pdfjs.VerbosityLevel ? pdfjs.VerbosityLevel.ERRORS : 0);
    }
  }
  const { getDocument } = pdfjs;
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
  if (!escaneado) return { pages, sinOcr: false, numPages, viaOcr: false };

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

// ─────────────────────────────────────────────────────────────────────────────
// DOCX
// ─────────────────────────────────────────────────────────────────────────────
// DOCX no tiene paginación fiable → todo el documento como un único bloque (page: null).
export async function extractDocx(filePath) {
  const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
  const { value } = await mammoth.extractRawText({ path: filePath });
  return pagesFromText((value || '').replace(/\r\n/g, '\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Texto plano, Markdown y volcados de WhatsApp (.txt / .md)
// ─────────────────────────────────────────────────────────────────────────────
export async function extractText(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  // Los volcados de WhatsApp se exportan como .txt: si detectamos su formato de línea,
  // lo normalizamos (unimos mensajes multilínea) para que cada mensaje sea un bloque
  // coherente y la búsqueda semántica no se rompa en los saltos de línea.
  const wa = normalizeWhatsApp(text);
  if (wa) text = wa;
  return pagesFromText(text);
}

// Detecta y normaliza un export de WhatsApp. Formatos habituales:
//   [12/03/24, 9:41:03] Juan Pérez: mensaje            (iOS)
//   12/3/24, 9:41 - Juan Pérez: mensaje                (Android)
// Devuelve el texto normalizado, o null si no parece un chat de WhatsApp.
export function normalizeWhatsApp(text) {
  const lines = text.split(/\r?\n/);
  const head = /^\s*(?:\[)?\d{1,2}[/.]\d{1,2}[/.]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[APap]\.?[Mm]\.?)?\s*(?:\])?\s*(?:-\s*)?([^:]{1,80}?):\s?(.*)$/;
  let matched = 0;
  let checked = 0;
  for (const l of lines) {
    if (!l.trim()) continue;
    checked++;
    if (head.test(l)) matched++;
    if (checked >= 40) break;
  }
  // Umbral prudente: mayoría de las primeras líneas con marca de tiempo → es WhatsApp.
  if (checked === 0 || matched / checked < 0.6) return null;

  const out = [];
  let current = null;
  for (const l of lines) {
    const m = l.match(head);
    if (m) {
      if (current) out.push(current);
      const remitente = m[1].trim();
      const mensaje = m[2] ?? '';
      current = `${remitente}: ${mensaje}`;
    } else if (current !== null) {
      // Continuación del mensaje anterior (mensaje con saltos de línea).
      current += ` ${l.trim()}`;
    } else if (l.trim()) {
      out.push(l.trim());
    }
  }
  if (current) out.push(current);
  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML (correos guardados, exportaciones) → texto
// ─────────────────────────────────────────────────────────────────────────────
export async function extractHtml(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return pagesFromText(htmlToText(raw));
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// RTF
// ─────────────────────────────────────────────────────────────────────────────
export async function extractRtf(filePath) {
  try {
    const mod = await import('rtf-stream-parser');
    const buffer = fs.readFileSync(filePath);
    // rtf-stream-parser sabe "des-encapsular" el RTF que envuelve HTML/texto y devolverlo plano.
    const result = mod.deEncapsulateSync(buffer, { mode: 'text' });
    const text = typeof result?.text === 'string' ? result.text : String(result?.text ?? '');
    if (text.trim()) return pagesFromText(text.replace(/\r\n/g, '\n'));
  } catch {
    /* RTF no encapsulado (Word nativo): caemos al parser genérico de control-words. */
  }
  return pagesFromText(rtfToTextFallback(fs.readFileSync(filePath, 'latin1')));
}

// Parser minimalista RTF→texto para RTF nativo de Word (no encapsulado). Resuelve grupos,
// escapes \'hh (latin1) y \uN (unicode), e ignora grupos binarios (imágenes, tablas de fuentes).
function rtfToTextFallback(rtf) {
  let out = '';
  let i = 0;
  const n = rtf.length;
  const stack = [];
  let ignore = 0; // >0 → dentro de un grupo cuyo contenido no es cuerpo del documento
  let ignoreNext = false;
  let ucSkip = 1;
  const IGNORE_WORDS = new Set(['pict', 'bin', 'object', 'fonttbl', 'colortbl', 'stylesheet',
    'info', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'themedata',
    'datastore', 'latentstyles', 'listtable', 'listoverridetable', 'rsidtbl']);
  while (i < n) {
    const c = rtf[i];
    if (c === '{') {
      stack.push(ignore);
      if (ignoreNext) { ignore += 1; ignoreNext = false; }
      i += 1;
      continue;
    }
    if (c === '}') {
      ignore = stack.length ? stack.pop() : 0;
      i += 1;
      continue;
    }
    if (c === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        if (!ignore) out += next;
        i += 2;
        continue;
      }
      if (next === "'") {
        const hex = rtf.substr(i + 2, 2);
        if (!ignore) out += Buffer.from(hex, 'hex').toString('latin1');
        i += 4;
        continue;
      }
      if (next === '*') { ignoreNext = true; i += 2; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i));
      if (m) {
        const word = m[1];
        const arg = m[2];
        if (word === 'u') {
          const code = parseInt(arg, 10);
          if (!ignore && Number.isFinite(code)) out += String.fromCharCode(code < 0 ? code + 65536 : code);
          i += m[0].length;
          for (let s = 0; s < ucSkip && i < n; s++) {
            if (rtf[i] === '\\' && rtf[i + 1] === "'") i += 4;
            else if (rtf[i] === '{' || rtf[i] === '}') break;
            else i += 1;
          }
          continue;
        }
        if (word === 'uc') ucSkip = Math.max(0, parseInt(arg, 10) || 0);
        else if (word === 'par' || word === 'line' || word === 'sect' || word === 'row') { if (!ignore) out += '\n'; }
        else if (word === 'tab' || word === 'cell') { if (!ignore) out += '\t'; }
        else if (IGNORE_WORDS.has(word)) ignoreNext = true;
        i += m[0].length;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '\n' || c === '\r') { i += 1; continue; }
    if (!ignore) out += c;
    i += 1;
  }
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// ODT / ODP / PPTX  (ZIP + XML, como DOCX pero sin mammoth)
// ─────────────────────────────────────────────────────────────────────────────
export async function extractOfficeXml(filePath) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const ext = path.extname(filePath).toLowerCase();

  const wantedXml = (name) => {
    if (ext === '.pptx') {
      return /^ppt\/slides\/slide\d+\.xml$/i.test(name) || /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name);
    }
    // .odt / .odp → content.xml (todo el cuerpo).
    return /(^|\/)content\.xml$/i.test(name);
  };

  // Para PPTX, cada slide es una "página" natural.
  const parts = entries
    .filter((e) => !e.isDirectory && wantedXml(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));

  const pages = [];
  let pageNo = 0;
  for (const e of parts) {
    const xml = e.getData().toString('utf8');
    const text = odfTextRuns(xml);
    if (text.trim()) {
      pageNo += 1;
      pages.push({ page: ext === '.pptx' ? pageNo : null, text });
    }
  }
  return { pages, sinOcr: false, numPages: ext === '.pptx' ? pageNo : null };
}

// Extrae los runs de texto de un XML de OpenDocument / OOXML. Los elementos de texto son
// <text:p>/<text:span> (ODF) y <a:t> (OOXML de PowerPoint). Insertamos saltos en párrafos.
function odfTextRuns(xml) {
  return String(xml)
    .replace(/<text:tab\/?>/g, '\t')
    .replace(/<text:line-break\/?>/g, '\n')
    .replace(/<\/text:p>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<a:br\/?>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Hojas de cálculo: .xlsx / .xls / .ods  (SheetJS, puro JS)
// ─────────────────────────────────────────────────────────────────────────────
export async function extractSpreadsheet(filePath) {
  const XLSX = (await import('xlsx')).default ?? (await import('xlsx'));
  const wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer', cellDates: true });
  const pages = [];
  let pageNo = 0;
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    // A CSV legible: preserva la estructura fila/columna, que es lo que da sentido a una
    // liquidación o a un cuadro concursal en la búsqueda semántica.
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, FS: ' | ' }).trim();
    if (csv) {
      pageNo += 1;
      pages.push({ page: pageNo, text: `[hoja: ${name}]\n${csv}` });
    }
  }
  return { pages, sinOcr: false, numPages: pageNo || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV / TSV  (papaparse — tolerante a volcados bancarios grandes)
// ─────────────────────────────────────────────────────────────────────────────
export async function extractCsv(filePath) {
  const Papa = (await import('papaparse')).default ?? (await import('papaparse'));
  const raw = fs.readFileSync(filePath, 'utf8');
  const delimiter = path.extname(filePath).toLowerCase() === '.tsv' ? '\t' : '';
  const parsed = Papa.parse(raw, { skipEmptyLines: true, delimiter });
  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  if (rows.length === 0) return pagesFromText(raw);

  const header = rows[0].map((h) => String(h).trim());
  const looksLikeHeader = header.some((h) => h && !/^-?[\d.,]+$/.test(h));
  const lines = [];
  const start = looksLikeHeader ? 1 : 0;
  for (let r = start; r < rows.length; r++) {
    const cells = rows[r];
    if (looksLikeHeader) {
      // "col: valor | col: valor" — etiquetar cada celda mejora el retrieval.
      const parts = header
        .map((h, c) => (cells[c] != null && cells[c] !== '' ? `${h}: ${cells[c]}` : null))
        .filter(Boolean);
      if (parts.length) lines.push(parts.join(' | '));
    } else {
      const joined = cells.map((v) => String(v)).join(' | ').trim();
      if (joined) lines.push(joined);
    }
  }
  const text = (looksLikeHeader ? `[columnas: ${header.join(', ')}]\n` : '') + lines.join('\n');
  return pagesFromText(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Emails: .eml (mailparser) y .msg (Outlook, @kenjiuno/msgreader)
// ─────────────────────────────────────────────────────────────────────────────
export async function extractEml(filePath, opts) {
  const { simpleParser } = await import('mailparser');
  const parsed = await simpleParser(fs.readFileSync(filePath));
  const header = [
    parsed.subject ? `Asunto: ${parsed.subject}` : null,
    parsed.from?.text ? `De: ${parsed.from.text}` : null,
    parsed.to?.text ? `Para: ${parsed.to.text}` : null,
    parsed.cc?.text ? `Cc: ${parsed.cc.text}` : null,
    parsed.date ? `Fecha: ${parsed.date.toISOString?.() ?? parsed.date}` : null,
  ].filter(Boolean).join('\n');
  const body = (parsed.text || (parsed.html ? htmlToText(parsed.html) : '') || '').trim();

  const attachments = (parsed.attachments || [])
    .filter((a) => a?.content)
    .map((a) => ({ filename: a.filename || 'adjunto', content: Buffer.from(a.content) }));
  return assembleEmail(header, body, attachments, opts);
}

export async function extractMsg(filePath, opts) {
  const MsgReaderMod = await import('@kenjiuno/msgreader');
  const MsgReader = MsgReaderMod.default?.default ?? MsgReaderMod.default ?? MsgReaderMod.MsgReader;
  const reader = new MsgReader(fs.readFileSync(filePath));
  const data = reader.getFileData();
  const header = [
    data.subject ? `Asunto: ${data.subject}` : null,
    data.senderName || data.senderEmail ? `De: ${[data.senderName, data.senderEmail].filter(Boolean).join(' ')}` : null,
    Array.isArray(data.recipients) && data.recipients.length
      ? `Para: ${data.recipients.map((r) => r.name || r.email).filter(Boolean).join(', ')}`
      : null,
    data.messageDeliveryTime ? `Fecha: ${data.messageDeliveryTime}` : null,
  ].filter(Boolean).join('\n');
  const body = (data.body || (data.bodyHtml ? htmlToText(String(data.bodyHtml)) : '') || '').trim();

  const attachments = [];
  for (const att of data.attachments || []) {
    try {
      const file = reader.getAttachment(att);
      if (file?.content) {
        attachments.push({ filename: file.fileName || att.fileName || 'adjunto', content: Buffer.from(file.content) });
      }
    } catch {
      /* adjunto ilegible: se ignora, el cuerpo del correo ya se indexa */
    }
  }
  return assembleEmail(header, body, attachments, opts);
}

// Monta el "documento" de un correo: cabecera + cuerpo + texto de los adjuntos soportados
// (un correo con una demanda en PDF adjunta debe ser buscable por el contenido de la demanda).
async function assembleEmail(header, body, attachments, opts) {
  const pages = [];
  const main = [header, body].filter(Boolean).join('\n\n').trim();
  if (main) pages.push({ page: null, text: main });

  const depth = opts?.depth ?? 0;
  if (depth < 1) {
    for (const att of attachments) {
      const inner = await extractBufferByName(att.filename, att.content, { ...opts, depth: depth + 1 });
      if (inner?.pages?.length) {
        pages.push({ page: null, text: `[adjunto: ${att.filename}]` });
        for (const pg of inner.pages) pages.push({ page: null, text: pg.text });
      }
    }
  } else if (attachments.length) {
    // A más profundidad no recursamos, pero dejamos constancia de los adjuntos.
    pages.push({ page: null, text: `[adjuntos: ${attachments.map((a) => a.filename).join(', ')}]` });
  }
  return { pages, sinOcr: pages.length === 0, numPages: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Imágenes (OCR local): .jpg .png .tiff .bmp .gif .heic
// ─────────────────────────────────────────────────────────────────────────────
export async function extractImage(filePath) {
  if (!config.ocrEnabled) return { pages: [], sinOcr: true, numPages: 1 };
  log.info('Imagen: aplicando OCR local', { fichero: path.basename(filePath) });
  let pages = [];
  try {
    pages = await ocrImage(filePath);
  } catch (err) {
    log.error('OCR de imagen falló; se marca sin OCR', { fichero: path.basename(filePath), err: String(err) });
    return { pages: [], sinOcr: true, numPages: 1 };
  }
  if (pages.length === 0) return { pages: [], sinOcr: true, numPages: 1 };
  return { pages, sinOcr: false, numPages: 1, viaOcr: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Contenedores: .zip / .rar / .7z  (expedientes de LexNet / Justizia.eus)
// ─────────────────────────────────────────────────────────────────────────────
// Límites de seguridad frente a zip-bombs y expedientes enormes.
//
// Hasta la 1.4.7 los tres formatos se descomprimían ENTEROS en memoria (zip: getData() de todo;
// rar: extract({}) con copia; 7z: todo al sistema de ficheros en memoria del WASM) y SOLO después
// se miraban los límites: un zip de 1 MB con 1 GB de ceros dentro agotaba la memoria y tumbaba
// RobinSearch. Ahora se leen primero las CABECERAS (tamaño descomprimido declarado, tamaño
// comprimido, número de miembros), se descarta lo que no cabe, y se extrae miembro a miembro con
// la salida acotada a lo declarado: una cabecera que miente se corta en cuanto se pasa.
const ARCHIVE_MAX_MEMBERS = 2000;
const ARCHIVE_MAX_TOTAL_BYTES = 500 * 1024 * 1024;
// Proporción descomprimido/comprimido a partir de la que un miembro grande se trata como bomba.
// Un texto normal comprime 5-20 veces; un bloque de ceros, ~1000.
const ARCHIVE_MAX_RATIO = 250;
const ARCHIVE_RATIO_DESDE_BYTES = 32 * 1024 * 1024;
// Entradas del directorio que se llegan a MIRAR (no a extraer): un zip con millones de entradas
// vacías no puede tenernos leyendo cabeceras para siempre.
const ARCHIVE_MAX_ENTRADAS = 200000;

// ¿Se extrae este miembro? Decide con lo DECLARADO en la cabecera, antes de descomprimir nada.
function admitirMiembro(m, cuenta) {
  const ext = path.extname(m.name).toLowerCase();
  if (!SUPPORTED_INNER.has(ext)) return null;
  if (m.cifrado) return 'cifrado';
  if (cuenta.miembros >= ARCHIVE_MAX_MEMBERS) return 'demasiados_miembros';
  if (!Number.isFinite(m.size) || m.size < 0) return 'tamaño_desconocido';
  if (m.size > limiteBytes(ext)) return 'demasiado_grande';
  if (cuenta.bytes + m.size > ARCHIVE_MAX_TOTAL_BYTES) return 'total_superado';
  if (m.size > ARCHIVE_RATIO_DESDE_BYTES && m.packed > 0 && m.size / m.packed > ARCHIVE_MAX_RATIO) return 'proporcion_sospechosa';
  return 'ok';
}

export async function extractArchive(filePath, opts) {
  const ext = extensionDe(filePath);
  const depth = opts?.depth ?? 0;
  // No recursamos archivos dentro de archivos (profundidad 1): evita zip-bombs anidadas.
  if (depth >= 1) return { pages: [], sinOcr: false, numPages: null };

  const pages = [];
  const cuenta = { miembros: 0, bytes: 0 };
  const descartes = {};
  const admitir = (m) => {
    const r = admitirMiembro(m, cuenta);
    if (r === 'ok') {
      cuenta.miembros += 1;
      cuenta.bytes += m.size;
      return true;
    }
    if (r) descartes[r] = (descartes[r] || 0) + 1;
    return false;
  };
  const alMiembro = async (name, destino) => {
    try {
      const inner = Buffer.isBuffer(destino)
        ? await extractBufferByName(name, destino, { ...opts, depth: depth + 1 })
        : await extractByExtension(destino, path.extname(name).toLowerCase(), { ...opts, depth: depth + 1 });
      if (inner?.pages?.length) {
        pages.push({ page: null, text: `[archivo: ${name}]` });
        for (const pg of inner.pages) pages.push({ page: pg.page, text: pg.text });
      }
    } catch (err) {
      log.warn('Miembro del contenedor ilegible', { ext: path.extname(name).toLowerCase(), err: String(err?.message ?? err) });
    }
  };

  try {
    if (ext === '.zip') await recorrerZip(filePath, admitir, alMiembro, descartes);
    else if (ext === '.rar') await recorrerRar(filePath, admitir, alMiembro, descartes);
    else if (ext === '.7z') await recorrer7z(filePath, admitir, alMiembro, descartes);
  } catch (err) {
    log.error('No se pudo abrir el contenedor', { fichero: path.basename(filePath), err: String(err) });
    return { pages, sinOcr: pages.length === 0, numPages: null };
  }
  if (Object.keys(descartes).length) {
    log.warn('Contenedor: miembros no extraídos por límite de seguridad', { ext, ...descartes, extraidos: cuenta.miembros });
  }
  return { pages, sinOcr: pages.length === 0, numPages: null };
}

// ── ZIP: directorio central leído del disco, un miembro cada vez ──────────────────────────
function leerExacto(fd, buf, posicion) {
  let leido = 0;
  while (leido < buf.length) {
    const n = fs.readSync(fd, buf, leido, buf.length - leido, posicion + leido);
    if (n <= 0) throw new Error('zip cortado');
    leido += n;
  }
  return buf;
}

// Entradas del directorio central: { name, method, flags, packed, size, local, cifrado }.
export function cabecerasZip(fd, tamanyo) {
  const colaLen = Math.min(tamanyo, 22 + 65535 + 20);
  const cola = leerExacto(fd, Buffer.alloc(colaLen), tamanyo - colaLen);
  let eocd = -1;
  for (let i = colaLen - 22; i >= 0; i--) {
    if (cola.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip sin directorio central');
  let total = cola.readUInt16LE(eocd + 10);
  let cdSize = cola.readUInt32LE(eocd + 12);
  let cdOff = cola.readUInt32LE(eocd + 16);
  if ((total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) && eocd >= 20 && cola.readUInt32LE(eocd - 20) === 0x07064b50) {
    const e64 = leerExacto(fd, Buffer.alloc(56), Number(cola.readBigUInt64LE(eocd - 20 + 8)));
    if (e64.readUInt32LE(0) !== 0x06064b50) throw new Error('zip64 dañado');
    total = Number(e64.readBigUInt64LE(32));
    cdSize = Number(e64.readBigUInt64LE(40));
    cdOff = Number(e64.readBigUInt64LE(48));
  }
  if (cdOff + cdSize > tamanyo || cdSize > 256 * 1024 * 1024) throw new Error('zip con directorio central dañado');
  const cd = leerExacto(fd, Buffer.alloc(cdSize), cdOff);
  const out = [];
  let p = 0;
  while (p + 46 <= cd.length && out.length < Math.min(total || Infinity, ARCHIVE_MAX_ENTRADAS)) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    let packed = cd.readUInt32LE(p + 20);
    let size = cd.readUInt32LE(p + 24);
    const nLen = cd.readUInt16LE(p + 28);
    const xLen = cd.readUInt16LE(p + 30);
    const cLen = cd.readUInt16LE(p + 32);
    let local = cd.readUInt32LE(p + 42);
    const nombre = cd.subarray(p + 46, p + 46 + nLen);
    // Campo extra zip64: solo trae los valores que en la cabecera valen 0xFFFFFFFF, en este orden.
    let x = p + 46 + nLen;
    const finX = x + xLen;
    while (x + 4 <= finX) {
      const id = cd.readUInt16LE(x);
      const len = cd.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (size === 0xffffffff && q + 8 <= x + 4 + len) (size = Number(cd.readBigUInt64LE(q))), (q += 8);
        if (packed === 0xffffffff && q + 8 <= x + 4 + len) (packed = Number(cd.readBigUInt64LE(q))), (q += 8);
        if (local === 0xffffffff && q + 8 <= x + 4 + len) local = Number(cd.readBigUInt64LE(q));
      }
      x += 4 + len;
    }
    const name = nombre.toString(flags & 0x800 ? 'utf8' : 'latin1');
    p = finX + cLen;
    if (name.endsWith('/')) continue; // carpeta
    out.push({ name, flags, method, packed, size, local, cifrado: Boolean(flags & 0x1) });
  }
  return out;
}

const inflarRaw = (buf, maxOutputLength) =>
  new Promise((resolve, reject) => zlib.inflateRaw(buf, { maxOutputLength }, (err, r) => (err ? reject(err) : resolve(r))));

async function recorrerZip(filePath, admitir, alMiembro, descartes) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const tamanyo = fs.fstatSync(fd).size;
    for (const m of cabecerasZip(fd, tamanyo)) {
      if (!admitir(m)) continue;
      if (m.method !== 0 && m.method !== 8) {
        descartes.compresion_no_soportada = (descartes.compresion_no_soportada || 0) + 1;
        continue;
      }
      // Lo comprimido tampoco puede ser mayor que lo que dice descomprimir (con margen para deflate).
      if (m.packed > m.size + m.size / 100 + 1024 * 1024 || m.local + 30 > tamanyo) {
        descartes.cabecera_incoherente = (descartes.cabecera_incoherente || 0) + 1;
        continue;
      }
      let contenido;
      try {
        const lh = leerExacto(fd, Buffer.alloc(30), m.local);
        if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('cabecera local dañada');
        const inicio = m.local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
        if (inicio + m.packed > tamanyo) throw new Error('zip cortado');
        const comprimido = leerExacto(fd, Buffer.alloc(m.packed), inicio);
        // La salida se acota a lo DECLARADO: una cabecera que miente (dice 2 KB y trae 1 GB) se
        // corta en cuanto lo supera, sin llegar a reservar esa memoria.
        contenido = m.method === 0 ? comprimido : await inflarRaw(comprimido, Math.max(1, m.size));
        if (contenido.length !== m.size) throw new Error('tamaño distinto del declarado');
      } catch (err) {
        descartes.miembro_danado = (descartes.miembro_danado || 0) + 1;
        log.warn('Miembro del zip no extraído', { ext: path.extname(m.name).toLowerCase(), err: String(err?.code || err?.message || err) });
        continue;
      }
      await alMiembro(m.name, contenido);
      contenido = null;
    }
  } finally {
    fs.closeSync(fd);
  }
}

// ── RAR: node-unrar-js leyendo del disco y escribiendo cada miembro a un temporal ─────────
// (createExtractorFromData guardaba en memoria el archivo entero Y todo lo extraído.)
function dirTemporal() {
  const d = path.join(os.tmpdir(), `robin-search-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function recorrerRar(filePath, admitir, alMiembro, descartes) {
  const { createExtractorFromFile } = await import('node-unrar-js');
  const wasmBinary = fs.readFileSync(require.resolve('node-unrar-js/esm/js/unrar.wasm'));
  const dir = dirTemporal();
  let lista = null;
  let extractor = null;
  try {
    // Lista primero (solo cabeceras) y decide qué se extrae.
    lista = await createExtractorFromFile({ wasmBinary, filepath: filePath, targetPath: dir });
    const elegidos = new Set();
    let vistas = 0;
    for (const h of lista.getFileList().fileHeaders) {
      if (++vistas > ARCHIVE_MAX_ENTRADAS) break;
      if (h.flags.directory) continue;
      if (admitir({ name: h.name, size: h.unpSize, packed: h.packSize, cifrado: h.flags.encrypted })) elegidos.add(h.name);
    }
    if (!elegidos.size) return;
    // El nombre en disco lo ponemos NOSOTROS (número + extensión): un nombre de miembro con «../»
    // no puede escribir fuera del temporal.
    // (unrar ya limpia el nombre antes de pasárnoslo, así que se casa por ORDEN, no por nombre.)
    let n = 0;
    let ultimo = null;
    extractor = await createExtractorFromFile({
      wasmBinary,
      filepath: filePath,
      targetPath: dir,
      filenameTransform: (nombre) => {
        ultimo = `m${n++}${path.extname(nombre).toLowerCase().replace(/[^.a-z0-9]/g, '')}`;
        return ultimo;
      },
    });
    const { files } = extractor.extract({ files: (h) => elegidos.has(h.name) });
    // El generador extrae de uno en uno al avanzar: se procesa y se borra cada miembro antes del
    // siguiente.
    for (const f of files) {
      const seguro = ultimo;
      ultimo = null;
      if (!seguro || f.fileHeader.flags.directory) continue;
      const ruta = path.join(dir, seguro);
      try {
        if (fs.existsSync(ruta)) await alMiembro(f.fileHeader.name, ruta);
      } finally {
        fs.rmSync(ruta, { force: true });
      }
    }
  } catch (err) {
    descartes.rar_ilegible = (descartes.rar_ilegible || 0) + 1;
    throw err;
  } finally {
    // node-unrar-js solo cierra el archivo si se recorre ENTERO y sin errores: un corte (tope de
    // entradas, un miembro dañado) dejaba el descriptor abierto hasta que el proceso muriera.
    for (const x of [lista, extractor]) {
      try {
        if (x?._archive) x.closeArc();
      } catch {
        /* ya cerrado */
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── 7z: 7z-wasm leyendo el archivo del disco (NODEFS), en lotes acotados ──────────────────
const LOTE_7Z_BYTES = 64 * 1024 * 1024;

async function recorrer7z(filePath, admitir, alMiembro) {
  const SevenZipFactory = (await import('7z-wasm')).default;
  const salida = [];
  const sevenZip = await SevenZipFactory({ print: (l) => salida.push(String(l)), printErr: () => {} });
  // 7z-wasm (Emscripten) deja process.exitCode con el código de 7-Zip cuando algo sale mal: sin
  // restaurarlo, RobinSearch saldría más tarde con código de error por un 7z ilegible.
  const ejecutar = (args) => {
    const previo = process.exitCode;
    try {
      sevenZip.callMain(args);
    } catch {
      /* 7-Zip termina lanzando su código de salida: se mira el resultado, no la excepción */
    } finally {
      process.exitCode = previo;
    }
  };
  const entrada = '/in';
  let archivo;
  sevenZip.FS.mkdir(entrada);
  try {
    // El archivo se LEE del disco: copiarlo al sistema de ficheros en memoria duplicaba su tamaño.
    sevenZip.FS.mount(sevenZip.NODEFS, { root: path.dirname(filePath) }, entrada);
    archivo = `${entrada}/${path.basename(filePath)}`;
    sevenZip.FS.stat(archivo);
  } catch {
    // Sin NODEFS en esta plataforma (rutas de red raras): copia en memoria (ya limitada por tamaño).
    archivo = '/archivo.7z';
    sevenZip.FS.writeFile(archivo, fs.readFileSync(filePath));
  }

  ejecutar(['l', '-slt', '-ba', archivo]);
  const miembros = [];
  let actual = null;
  for (const linea of salida) {
    const m = /^([A-Za-z ]+?) = (.*)$/.exec(linea);
    if (!m) {
      if (actual?.name != null) miembros.push(actual);
      actual = null;
      continue;
    }
    actual ??= {};
    if (m[1] === 'Path') actual.name = m[2];
    else if (m[1] === 'Size') actual.size = Number(m[2]);
    else if (m[1] === 'Packed Size') actual.packed = Number(m[2]) || 0;
    else if (m[1] === 'Attributes') actual.dir = /^D/.test(m[2]);
    else if (m[1] === 'Folder') actual.dir = actual.dir || m[2] === '+';
    else if (m[1] === 'Encrypted') actual.cifrado = m[2] === '+';
  }
  if (actual?.name != null) miembros.push(actual);

  // Un archivo «sólido» no trae tamaño comprimido por miembro: la proporción se mira sobre el total.
  const tamArchivo = fs.statSync(filePath).size || 1;
  const totalDeclarado = miembros.reduce((s, m) => s + (m.dir ? 0 : m.size || 0), 0);
  const solido = miembros.every((m) => !m.packed);
  const elegidos = miembros
    .slice(0, ARCHIVE_MAX_ENTRADAS)
    .filter((m) => !m.dir && admitir({ ...m, packed: solido ? (m.size * tamArchivo) / Math.max(1, totalDeclarado) : m.packed }));

  const out = '/out';
  sevenZip.FS.mkdir(out);
  for (let i = 0; i < elegidos.length; ) {
    const lote = [];
    let bytes = 0;
    while (i < elegidos.length && (lote.length === 0 || bytes + elegidos[i].size <= LOTE_7Z_BYTES)) {
      bytes += elegidos[i].size;
      lote.push(elegidos[i++]);
    }
    // -spd: los nombres son literales (sin comodines). Lo extraído está acotado por lo declarado.
    ejecutar(['x', archivo, `-o${out}`, '-y', '-spd', '--', ...lote.map((m) => m.name)]);
    for (const m of lote) {
      const ruta = `${out}/${m.name}`;
      let contenido = null;
      try {
        contenido = Buffer.from(sevenZip.FS.readFile(ruta));
        sevenZip.FS.unlink(ruta);
      } catch {
        continue; // no se extrajo (dañado): se sigue
      }
      await alMiembro(m.name, contenido);
    }
  }
  try {
    sevenZip.FS.unmount(entrada);
  } catch {
    /* nada */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades comunes
// ─────────────────────────────────────────────────────────────────────────────
// Envuelve un texto plano en el contrato de páginas (documento = una página, page: null).
function pagesFromText(text) {
  const t = (text || '').trim();
  return { pages: t ? [{ page: null, text: t }] : [], sinOcr: false, numPages: null };
}

// Extensiones que tiene sentido extraer DENTRO de un contenedor o adjunto de correo.
const SUPPORTED_INNER = new Set([
  '.pdf', '.docx', '.txt', '.md', '.markdown', '.html', '.htm', '.rtf',
  '.odt', '.odp', '.pptx', '.xlsx', '.xls', '.ods', '.xlsm', '.fods', '.csv', '.tsv',
  '.eml', '.msg', '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.gif', '.heic', '.heif',
]);

// Extrae texto de un buffer en memoria (adjunto de correo o miembro de contenedor) escribiendo
// a un fichero temporal, porque las librerías esperan una ruta o releen del disco.
async function extractBufferByName(name, content, opts) {
  const ext = path.extname(name).toLowerCase();
  const tmp = path.join(os.tmpdir(), `robin-search-${process.pid}-${Math.abs(hashName(name + content.length))}${ext}`);
  fs.writeFileSync(tmp, content);
  try {
    return await extractByExtension(tmp, ext, opts);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
  }
}

function hashName(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────────
async function extractByExtension(filePath, ext, opts) {
  const maxPages = opts?.maxPages ?? config.maxPagesPerFile;
  if (ext === '.pdf') return extractPdf(filePath, { maxPages });
  if (ext === '.docx') return extractDocx(filePath);
  if (EXT_TEXT.has(ext)) return extractText(filePath);
  if (EXT_HTML.has(ext)) return extractHtml(filePath);
  if (ext === '.rtf') return extractRtf(filePath);
  if (EXT_OFFICE_XML.has(ext)) return extractOfficeXml(filePath);
  if (EXT_SPREADSHEET.has(ext)) return extractSpreadsheet(filePath);
  if (EXT_CSV.has(ext)) return extractCsv(filePath);
  if (ext === '.eml') return extractEml(filePath, opts);
  if (ext === '.msg') return extractMsg(filePath, opts);
  if (EXT_IMAGE.has(ext)) return extractImage(filePath);
  if (EXT_ARCHIVE.has(ext)) return extractArchive(filePath, opts);
  throw new Error(`Formato no soportado: ${ext}`);
}

// Dispatcher público por extensión. `opts` incluye maxPages y depth (recursión de contenedores).
export async function extractFile(filePath, { maxPages } = {}) {
  // extensionDe y no extname a secas: «demanda.pdf » (espacio final) es un PDF.
  const ext = extensionDe(filePath);
  return extractByExtension(filePath, ext, { maxPages, depth: 0 });
}

export default {
  extractFile, extractPdf, extractDocx, extractText, extractHtml, extractRtf,
  extractOfficeXml, extractSpreadsheet, extractCsv, extractEml, extractMsg,
  extractImage, extractArchive, normalizeWhatsApp,
};
