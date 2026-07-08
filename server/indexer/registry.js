// Registro incremental de ficheros indexados (files.json). Permite procesar solo ficheros
// nuevos o modificados desde la última ejecución (RF-03.7). Guarda metadatos, NUNCA
// contenido documental.
//
// Clave = ruta relativa a la carpeta vigilada. Valor:
//   { docId, size, mtimeMs, indexedAt, numChunks, numPages, sinOcr }

import fs from 'node:fs';
import crypto from 'node:crypto';
import { config, ensureDataDirs } from '../config.js';

let _cache = null;

function load() {
  if (_cache) return _cache;
  ensureDataDirs();
  try {
    _cache = JSON.parse(fs.readFileSync(config.manifestPath, 'utf8'));
  } catch {
    _cache = {};
  }
  return _cache;
}

function persist() {
  ensureDataDirs();
  const tmp = `${config.manifestPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(_cache, null, 0));
  fs.renameSync(tmp, config.manifestPath); // escritura atómica
}

export function docIdForRelPath(relPath) {
  return crypto.createHash('sha1').update(relPath).digest('hex').slice(0, 16);
}

export function get(relPath) {
  return load()[relPath] ?? null;
}

// ¿El fichero ha cambiado (o es nuevo) respecto al registro?
export function isStale(relPath, stat) {
  const entry = get(relPath);
  if (!entry) return true;
  return entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs;
}

export function set(relPath, entry) {
  const reg = load();
  reg[relPath] = entry;
  persist();
}

export function remove(relPath) {
  const reg = load();
  const entry = reg[relPath];
  if (entry) {
    delete reg[relPath];
    persist();
  }
  return entry ?? null;
}

export function all() {
  return { ...load() };
}

export function stats() {
  const reg = load();
  let documentos = 0;
  let fragmentos = 0;
  const sinOcr = [];
  for (const [relPath, e] of Object.entries(reg)) {
    if (e.sinOcr) {
      sinOcr.push(relPath);
      continue;
    }
    documentos += 1;
    fragmentos += e.numChunks || 0;
  }
  return { documentos, fragmentos, sinOcr };
}

export default { docIdForRelPath, get, isStale, set, remove, all, stats };
