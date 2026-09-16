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
import { escribirJson, leerJson } from '../persistencia.js';

let _cache = null;
// docId → ruta absoluta, construido bajo demanda. Las herramientas buscaban la entrada de un
// documento con all().find(): recorrer 20.000 entradas en cada llamada.
let _porDocId = null;
let _knownMtime = 0; // mtime del files.json que refleja _cache
let _sucio = false; // cambios en memoria aún no volcados
let _temporizador = null;
let _ultimaEscritura = 0;
// files.json no se pudo leer (dañado y sin .bak) y se empezó vacío: el índice tiene documentos
// que el registro no conoce, pero NO son huérfanos — el cotejo no debe borrarlos.
let _empezadoVacio = false;

// Con 20.000 ficheros files.json pesa varios MB: reescribirlo entero por CADA fichero indexado
// eran decenas de GB de escritura y 20.000 ocasiones de chocar con el antivirus. Se vuelca como
// mucho cada GUARDAR_CADA_MS y siempre al salir. Si el proceso muere antes, lo no volcado se
// vuelve a indexar (el cotejo del arranque lo detecta): se pierde tiempo, nunca datos.
const GUARDAR_CADA_MS = 2000;

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
// Un fichero ilegible por E/S (bloqueado, permisos) NO se toma por vacío: se sigue con lo que
// hay en memoria, o se lanza si no hay nada.
function load() {
  ensureDataDirs();
  const m = currentMtime();
  if (_cache && (_sucio || m === _knownMtime)) return _cache;
  let r;
  try {
    r = leerJson(config.manifestPath);
  } catch (err) {
    if (_cache) return _cache;
    throw err;
  }
  _porDocId = null;
  if (r.estado === 'ok') {
    _cache = r.valor;
  } else {
    if (r.estado === 'corrupto') _empezadoVacio = true;
    if (!_cache) _cache = {};
  }
  _knownMtime = currentMtime();
  return _cache;
}

function volcar() {
  if (_temporizador) {
    clearTimeout(_temporizador);
    _temporizador = null;
  }
  if (!_sucio || !_cache) return;
  ensureDataDirs();
  escribirJson(config.manifestPath, _cache, { bak: true });
  _sucio = false;
  _ultimaEscritura = Date.now();
  _knownMtime = currentMtime(); // nuestra propia escritura no debe forzar una relectura
}

function persist({ ya = false } = {}) {
  _sucio = true;
  const espera = GUARDAR_CADA_MS - (Date.now() - _ultimaEscritura);
  if (ya || espera <= 0) {
    volcar();
    return;
  }
  if (!_temporizador) {
    _temporizador = setTimeout(() => {
      _temporizador = null;
      try {
        volcar();
      } catch {
        /* se reintenta con el siguiente cambio o al salir */
      }
    }, espera);
    _temporizador.unref?.();
  }
}

// Volcado pendiente al terminar (también lo llama el cierre ordenado).
export function guardarPendiente() {
  try {
    volcar();
  } catch {
    /* sin disco no hay más que hacer */
  }
}
process.on('exit', guardarPendiente);

// Esta instancia ha dejado de escribir (otra tomó el cerrojo): lo que tuviera sin volcar NO se
// escribe —pisaría el registro de la que escribe ahora— y se vuelve a leer del disco.
export function descartarPendiente() {
  if (_temporizador) {
    clearTimeout(_temporizador);
    _temporizador = null;
  }
  _sucio = false;
  _cache = null;
  _porDocId = null;
  _knownMtime = 0;
}

export function empezadoVacio() {
  load();
  return _empezadoVacio;
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
  const previa = reg[absPath];
  reg[absPath] = entry;
  if (_porDocId) {
    if (previa?.docId && previa.docId !== entry?.docId) _porDocId.delete(previa.docId);
    if (entry?.docId) _porDocId.set(entry.docId, absPath);
  }
  persist();
}

// Entrada del registro de un documento por su docId (o null).
export function porDocId(docId) {
  const reg = load();
  if (!_porDocId) {
    _porDocId = new Map();
    for (const [abs, e] of Object.entries(reg)) if (e?.docId) _porDocId.set(e.docId, abs);
  }
  const abs = _porDocId.get(docId);
  const e = abs ? reg[abs] : null;
  return e && e.docId === docId ? e : null;
}

export function remove(absPath) {
  const reg = load();
  const entry = reg[absPath];
  if (entry) {
    delete reg[absPath];
    if (_porDocId && entry.docId) _porDocId.delete(entry.docId);
    persist();
  }
  return entry ?? null;
}

// Cambia la CLAVE de una entrada (la misma ruta escrita con otra caja o forma Unicode) sin
// perder su docId: así no hay que volver a indexar el documento. No pisa una clave existente.
export function renombrarClave(de, a) {
  const reg = load();
  if (de === a || !reg[de] || reg[a]) return false;
  reg[a] = reg[de];
  delete reg[de];
  persist();
  return true;
}

// Varias de una vez (una sola escritura de files.json). Lo usa el cotejo registro↔índice del
// arranque: lo que se quita aquí se vuelve a indexar desde el documento original.
export function removeMany(absPaths) {
  const reg = load();
  let quitadas = 0;
  for (const p of absPaths) {
    if (reg[p]) {
      if (_porDocId && reg[p].docId) _porDocId.delete(reg[p].docId);
      delete reg[p];
      quitadas += 1;
    }
  }
  if (quitadas) persist({ ya: true });
  return quitadas;
}

// Olvidarlo todo (índice irrecuperable que se rehace desde los documentos).
export function vaciar() {
  _cache = {};
  _porDocId = null;
  persist({ ya: true });
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

export default { docIdForAbsPath, porDocId, get, isStale, set, remove, renombrarClave, removeMany, vaciar, all, entries, backfillExpediente, stats, guardarPendiente, descartarPendiente, empezadoVacio };
