// Registro incremental de ficheros indexados (files.json). Permite procesar solo ficheros
// nuevos o modificados desde la última ejecución (RF-03.7). Guarda metadatos, NUNCA
// contenido documental.
//
// Multi-raíz: la CLAVE es la ruta ABSOLUTA del fichero (única entre carpetas distintas).
// Cada entrada guarda además la raíz y la ruta lógica (`nombreRaíz/rutaRelativa`) que se usa
// para filtrar y citar. Valor:
//   { docId, raiz, rutaRelativa, size, mtimeMs, indexedAt, numChunks, numPages, sinOcr }

import fs from 'node:fs';
import crypto from 'node:crypto';
import { config, ensureDataDirs, expedienteForLogicalPath } from '../config.js';

let _cache = null;
let _knownMtime = 0; // mtime del files.json que refleja _cache

function currentMtime() {
  try {
    return fs.statSync(config.manifestPath).mtimeMs;
  } catch {
    return 0;
  }
}

// Relee files.json si ha cambiado en disco desde la última lectura/escritura. Así stats()/all()
// SIEMPRE reflejan el índice real, aunque otro proceso (o un arranque previo) lo haya escrito —
// evita el caso "indexado en disco pero la tool devuelve 0" por caché en memoria obsoleta.
function load() {
  ensureDataDirs();
  const m = currentMtime();
  if (_cache && m === _knownMtime) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(config.manifestPath, 'utf8'));
  } catch {
    if (!_cache) _cache = {};
  }
  _knownMtime = m;
  return _cache;
}

function persist() {
  ensureDataDirs();
  const tmp = `${config.manifestPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(_cache, null, 0));
  fs.renameSync(tmp, config.manifestPath); // escritura atómica
  _knownMtime = currentMtime(); // nuestra propia escritura no debe forzar una relectura
}

// docId estable y único por fichero, derivado de su ruta absoluta.
export function docIdForAbsPath(absPath) {
  return crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 16);
}

export function get(absPath) {
  return load()[absPath] ?? null;
}

// ¿El fichero ha cambiado (o es nuevo) respecto al registro?
export function isStale(absPath, stat) {
  const entry = get(absPath);
  if (!entry) return true;
  return entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs;
}

export function set(absPath, entry) {
  const reg = load();
  reg[absPath] = entry;
  persist();
}

export function remove(absPath) {
  const reg = load();
  const entry = reg[absPath];
  if (entry) {
    delete reg[absPath];
    persist();
  }
  return entry ?? null;
}

// Todas las entradas (valores), cada una con su ruta lógica y raíz.
export function all() {
  return Object.values(load());
}

// Pares [rutaAbsoluta, entrada]. La ruta absoluta es la CLAVE del registro, no un campo de la
// entrada, así que hace falta esto para reconciliar el índice contra lo que hay en disco.
export function entries() {
  return Object.entries(load());
}

// Migración: rellena el campo `expediente` en las entradas escritas por versiones < 1.3.0.
// Devuelve cuántas se sellaron. Barato: se deriva de la ruta lógica ya guardada.
export function backfillExpediente() {
  const reg = load();
  let sellados = 0;
  for (const [abs, e] of Object.entries(reg)) {
    if (e.expediente) continue;
    reg[abs] = { ...e, expediente: expedienteForLogicalPath(e.rutaRelativa) };
    sellados += 1;
  }
  if (sellados) persist();
  return sellados;
}

export function stats() {
  const reg = load();
  let documentos = 0;
  let fragmentos = 0;
  const sinOcr = [];
  for (const e of Object.values(reg)) {
    if (e.sinOcr) {
      sinOcr.push(e.rutaRelativa);
      continue;
    }
    documentos += 1;
    fragmentos += e.numChunks || 0;
  }
  return { documentos, fragmentos, sinOcr };
}

export default { docIdForAbsPath, get, isStale, set, remove, all, entries, backfillExpediente, stats };
