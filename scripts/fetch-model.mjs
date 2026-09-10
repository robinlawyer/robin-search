#!/usr/bin/env node
// Empaqueta el modelo de embedding DENTRO del paquete (carpeta `models/`), para que el
// .mcpb no dependa de una descarga en casa del abogado.
//
// Por qué existe: @xenova/transformers descargaba `multilingual-e5-small` de HuggingFace la
// primera vez que se usaba, a `node_modules/@xenova/transformers/.cache` — es decir, DENTRO
// de la carpeta de la extensión, que se borra al reinstalar o actualizar. Si esa descarga
// (≈135 MB) fallaba o llegaba a medias, el motor no cargaba y entonces TODOS los ficheros
// fallaban al indexar y todas las búsquedas también. El abogado veía "0 documentos, N
// errores" sin ninguna causa.
//
// Fuentes, por orden: ROBIN_MODEL_SRC → caché local de transformers → descarga de HuggingFace.
// Escribe `models/manifest.json` con tamaño y sha256 de cada fichero: el servidor comprueba
// la integridad al arrancar (ver server/embedder/embedder.js).
//
// Idempotente: si `models/` ya cuadra con el manifiesto, no hace nada.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELO = process.env.ROBIN_EMBED_MODEL || 'Xenova/multilingual-e5-small';
const DESTINO = path.join(ROOT, 'models');
const MANIFEST = path.join(DESTINO, 'manifest.json');
const BASE_HF = process.env.ROBIN_HF_BASE || 'https://huggingface.co';

// Ficheros que necesita `pipeline('feature-extraction', …, { quantized: true })`.
const FICHEROS = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
];

// Modelo de idioma del OCR (tesseract.js). Misma historia que el de embedding: se bajaba de
// un CDN la primera vez que alguien pasaba un PDF escaneado. Es pequeño (≈3 MB) y solo afecta
// a los escaneados, pero es una descarga menos que puede fallar en casa del abogado.
const OCR_LANG = process.env.ROBIN_OCR_LANG || 'spa';
const OCR_DIR = path.join(DESTINO, 'tesseract');
// oem=1 (LSTM only) es lo que usa server/indexer/ocr.js → variante `_best_int` del CDN.
const OCR_URL = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${OCR_LANG}/4.0.0_best_int/${OCR_LANG}.traineddata.gz`;

function ocrDesdeDisco() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const cachés = [];
  if (process.env.ROBIN_MODEL_SRC) cachés.push(path.join(process.env.ROBIN_MODEL_SRC, 'tesseract'));
  if (home && process.platform === 'darwin') {
    cachés.push(path.join(home, 'Library', 'Application Support', 'RobinLawyer', 'robin-search', 'tesseract'));
  }
  if (process.env.APPDATA) cachés.push(path.join(process.env.APPDATA, 'RobinLawyer', 'robin-search', 'tesseract'));
  for (const dir of cachés) {
    try {
      const buf = fs.readFileSync(path.join(dir, `${OCR_LANG}.traineddata`));
      if (buf.length > 0) return { buf, origen: dir };
    } catch {
      /* siguiente */
    }
  }
  return null;
}

async function empaquetarOcr() {
  let fuente = ocrDesdeDisco();
  if (!fuente) {
    process.stdout.write(`fetch-model: descargando ${OCR_LANG}.traineddata… `);
    const res = await fetch(OCR_URL);
    if (!res.ok) throw new Error(`${OCR_URL} → HTTP ${res.status}`);
    const gz = Buffer.from(await res.arrayBuffer());
    // El CDN sirve .gz; se guarda descomprimido y el servidor lo carga con gzip:false.
    fuente = { buf: zlib.gunzipSync(gz), origen: OCR_URL };
    process.stdout.write('ok\n');
  }
  fs.mkdirSync(OCR_DIR, { recursive: true });
  fs.writeFileSync(path.join(OCR_DIR, `${OCR_LANG}.traineddata`), fuente.buf);
  console.log(`fetch-model: ${OCR_LANG}.traineddata — ${fuente.buf.length} bytes (${fuente.origen})`);
  return { lang: OCR_LANG, bytes: fuente.buf.length, sha256: sha256(fuente.buf) };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function candidatos() {
  const out = [];
  if (process.env.ROBIN_MODEL_SRC) out.push(process.env.ROBIN_MODEL_SRC);
  out.push(path.join(ROOT, 'node_modules', '@xenova', 'transformers', '.cache'));
  // La extensión ya instalada en Claude Desktop: sirve para empaquetar sin volver a bajar.
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const ext = 'Claude Extensions/local.mcpb.robin-lawyer.robin-search/node_modules/@xenova/transformers/.cache';
  if (home && process.platform === 'darwin') {
    out.push(path.join(home, 'Library', 'Application Support', 'Claude', ext));
  }
  if (home && process.platform === 'win32' && process.env.APPDATA) {
    out.push(path.join(process.env.APPDATA, 'Claude', ext));
  }
  return out;
}

function desdeDisco(rel) {
  for (const base of candidatos()) {
    const abs = path.join(base, MODELO, rel);
    try {
      const buf = fs.readFileSync(abs);
      if (buf.length > 0) return { buf, origen: abs };
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

async function desdeRed(rel) {
  const url = `${BASE_HF}/${MODELO}/resolve/main/${rel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Una descarga cortada devuelve 200 con el cuerpo a medias: si el servidor declara tamaño,
  // se comprueba aquí y no seis meses después en el ordenador de un abogado.
  const declarado = Number(res.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > 0 && buf.length !== declarado) {
    throw new Error(`${rel}: descarga incompleta (${buf.length} de ${declarado} bytes)`);
  }
  return { buf, origen: url };
}

function manifiestoVigente() {
  let m;
  try {
    m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    return null;
  }
  if (m.modelo !== MODELO) return null;
  for (const rel of FICHEROS) {
    const meta = m.ficheros?.[rel];
    if (!meta) return null;
    try {
      if (fs.statSync(path.join(DESTINO, MODELO, rel)).size !== meta.bytes) return null;
    } catch {
      return null;
    }
  }
  if (!m.ocr || m.ocr.lang !== OCR_LANG) return null;
  try {
    if (fs.statSync(path.join(OCR_DIR, `${OCR_LANG}.traineddata`)).size !== m.ocr.bytes) return null;
  } catch {
    return null;
  }
  return m;
}

async function main() {
  if (manifiestoVigente()) {
    console.log(`fetch-model: ${MODELO} ya empaquetado y con tamaños correctos.`);
    return;
  }

  const ficheros = {};
  for (const rel of FICHEROS) {
    let fuente = desdeDisco(rel);
    if (!fuente) {
      process.stdout.write(`fetch-model: descargando ${rel}… `);
      fuente = await desdeRed(rel);
      process.stdout.write('ok\n');
    }
    const destino = path.join(DESTINO, MODELO, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, fuente.buf);
    ficheros[rel] = { bytes: fuente.buf.length, sha256: sha256(fuente.buf) };
    console.log(`fetch-model: ${rel} — ${fuente.buf.length} bytes (${fuente.origen})`);
  }

  const ocr = await empaquetarOcr();

  fs.writeFileSync(
    MANIFEST,
    JSON.stringify({ modelo: MODELO, quantized: true, ficheros, ocr }, null, 2) + '\n',
  );
  console.log(`fetch-model: manifiesto escrito en ${MANIFEST}`);
}

main().catch((err) => {
  console.error(`fetch-model: ${err?.message ?? err}`);
  process.exit(1);
});
