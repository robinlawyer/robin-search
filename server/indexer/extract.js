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
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from '../config.js';
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
    pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
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
const ARCHIVE_MAX_MEMBERS = 2000;
const ARCHIVE_MAX_TOTAL_BYTES = 500 * 1024 * 1024;

export async function extractArchive(filePath, opts) {
  const ext = path.extname(filePath).toLowerCase();
  const depth = opts?.depth ?? 0;
  // No recursamos archivos dentro de archivos (profundidad 1): evita zip-bombs anidadas.
  if (depth >= 1) return { pages: [], sinOcr: false, numPages: null };

  let members = [];
  try {
    if (ext === '.zip') members = await readZipMembers(filePath);
    else if (ext === '.rar') members = await readRarMembers(filePath);
    else if (ext === '.7z') members = await read7zMembers(filePath);
  } catch (err) {
    log.error('No se pudo abrir el contenedor', { fichero: path.basename(filePath), err: String(err) });
    return { pages: [], sinOcr: false, numPages: null };
  }

  const pages = [];
  let total = 0;
  let count = 0;
  for (const m of members) {
    if (count >= ARCHIVE_MAX_MEMBERS || total >= ARCHIVE_MAX_TOTAL_BYTES) {
      log.warn('Contenedor truncado por límite de seguridad', { fichero: path.basename(filePath), miembros: count });
      break;
    }
    if (!SUPPORTED_INNER.has(path.extname(m.name).toLowerCase())) continue;
    count += 1;
    total += m.content.length;
    try {
      const inner = await extractBufferByName(m.name, m.content, { ...opts, depth: depth + 1 });
      if (inner?.pages?.length) {
        pages.push({ page: null, text: `[archivo: ${m.name}]` });
        for (const pg of inner.pages) pages.push({ page: pg.page, text: pg.text });
      }
    } catch (err) {
      log.warn('Miembro del contenedor ilegible', { miembro: m.name, err: String(err) });
    }
  }
  return { pages, sinOcr: pages.length === 0, numPages: null };
}

async function readZipMembers(filePath) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(filePath);
  return zip.getEntries()
    .filter((e) => !e.isDirectory)
    .map((e) => ({ name: e.entryName, content: e.getData() }));
}

async function readRarMembers(filePath) {
  const { createExtractorFromData } = await import('node-unrar-js');
  const wasmBinary = fs.readFileSync(require.resolve('node-unrar-js/esm/js/unrar.wasm'));
  const data = Uint8Array.from(fs.readFileSync(filePath)).buffer;
  const extractor = await createExtractorFromData({ wasmBinary, data });
  const extracted = extractor.extract({});
  const members = [];
  for (const file of extracted.files) {
    if (file.fileHeader.flags.directory) continue;
    if (file.extraction) members.push({ name: file.fileHeader.name, content: Buffer.from(file.extraction) });
  }
  return members;
}

async function read7zMembers(filePath) {
  const SevenZipFactory = (await import('7z-wasm')).default;
  const sevenZip = await SevenZipFactory();
  const archiveName = 'archive' + path.extname(filePath).toLowerCase();
  const outDir = '/out';
  sevenZip.FS.writeFile(archiveName, Uint8Array.from(fs.readFileSync(filePath)));
  sevenZip.FS.mkdir(outDir);
  sevenZip.callMain(['x', archiveName, '-o' + outDir, '-y']);
  const members = [];
  const walkFs = (dir) => {
    for (const name of sevenZip.FS.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      const full = dir + '/' + name;
      const stat = sevenZip.FS.stat(full);
      if (sevenZip.FS.isDir(stat.mode)) walkFs(full);
      else members.push({ name: full.slice(outDir.length + 1), content: Buffer.from(sevenZip.FS.readFile(full)) });
    }
  };
  try { walkFs(outDir); } catch { /* nada extraído */ }
  return members;
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
  const ext = path.extname(filePath).toLowerCase();
  return extractByExtension(filePath, ext, { maxPages, depth: 0 });
}

export default {
  extractFile, extractPdf, extractDocx, extractText, extractHtml, extractRtf,
  extractOfficeXml, extractSpreadsheet, extractCsv, extractEml, extractMsg,
  extractImage, extractArchive, normalizeWhatsApp,
};
