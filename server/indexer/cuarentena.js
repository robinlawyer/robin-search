// Ficheros APARTADOS del indexado.
//
// Hasta la 1.4.4, un solo fichero que hacía caer el proceso al leerlo (un PDF que agota la
// memoria del lector, un comprimido gigante) tumbaba RobinSearch en CADA arranque y para
// siempre: el indexado inicial volvía a él cada vez. El abogado solo veía «Server
// disconnected» y nadie sabía qué fichero era.
//
// Ahora el indexador deja marcado en disco qué fichero está leyendo (diagnostico.js). Si el
// proceso muere con esa marca puesta, el siguiente arranque lo anota aquí:
//   · 1.ª caída con ese fichero → queda SOSPECHOSO y se reintenta una vez (la caída pudo ser
//     ajena: Claude cerrado a la fuerza, el ordenador apagado).
//   · 2.ª caída con el mismo fichero → queda APARTADO: se salta y se dice en estado_servidor.
// También se apartan, a la primera, los ficheros por encima del tamaño máximo de su tipo.
//
// Un fichero apartado vuelve a intentarse solo si CAMBIA (tamaño o fecha) o si cambia la
// versión de RobinSearch (puede traer el arreglo). Este fichero vive en el ordenador del
// abogado y guarda rutas locales: NUNCA se envía a ningún sitio.

import fs from 'node:fs';
import path from 'node:path';
import { config, VERSION } from '../config.js';
import { escribirJson, leerJson } from '../persistencia.js';

export const MOTIVO_CAIDA = 'hizo_caer_el_indexador';
export const MOTIVO_TAMANYO = 'demasiado_grande';
const CAIDAS_PARA_APARTAR = 2;

let _cache = null;

const ruta = () => path.join(config.dataDir, 'apartados.json');

// Se relee si el fichero cambió (la otra instancia también aparta): con la caché fija, cada una
// sobrescribía lo de la otra con datos viejos.
let _mtime = -1;
function mtimeActual() {
  try {
    return fs.statSync(ruta()).mtimeMs;
  } catch {
    return 0;
  }
}

function cargar() {
  const m = mtimeActual();
  if (_cache && m === _mtime) return _cache;
  try {
    const r = leerJson(ruta());
    _cache = r.estado === 'ok' ? r.valor : _cache || {};
  } catch {
    _cache ??= {};
  }
  _mtime = m;
  return _cache;
}

function guardar() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    escribirJson(ruta(), _cache, { bak: true });
    _mtime = mtimeActual();
  } catch {
    /* sin disco no hay nada que apartar; el indexado sigue */
  }
}

function mismoFichero(e, stat) {
  return e && stat && e.bytes === stat.size && e.mtimeMs === stat.mtimeMs;
}

// El proceso murió leyendo `abs`. Con `seguro` (se vio la excepción, no hay duda de qué fichero
// fue) se aparta a la primera. Devuelve la entrada resultante.
export function anotarCaida(abs, { seguro = false } = {}) {
  const reg = cargar();
  let stat = null;
  try {
    stat = fs.statSync(abs);
  } catch {
    return null; // el fichero ya no está: nada que apartar
  }
  const previa = reg[abs];
  const contadas =
    previa && previa.motivo === MOTIVO_CAIDA && mismoFichero(previa, stat) && previa.version === VERSION
      ? (previa.caidas || 1) + 1
      : 1;
  const caidas = seguro ? Math.max(contadas, CAIDAS_PARA_APARTAR) : contadas;
  reg[abs] = {
    motivo: MOTIVO_CAIDA,
    caidas,
    bytes: stat.size,
    mtimeMs: stat.mtimeMs,
    ext: path.extname(abs).toLowerCase(),
    version: VERSION,
    desde: previa?.desde ?? new Date().toISOString(),
  };
  guardar();
  return reg[abs];
}

export function apartarPorTamanyo(abs, stat, limiteBytes) {
  const reg = cargar();
  reg[abs] = {
    motivo: MOTIVO_TAMANYO,
    bytes: stat.size,
    mtimeMs: stat.mtimeMs,
    limiteBytes,
    ext: path.extname(abs).toLowerCase(),
    version: VERSION,
    desde: new Date().toISOString(),
  };
  guardar();
  return reg[abs];
}

function vigente(e) {
  if (!e) return false;
  if (e.motivo === MOTIVO_TAMANYO) return true;
  return e.motivo === MOTIVO_CAIDA && e.version === VERSION && (e.caidas || 1) >= CAIDAS_PARA_APARTAR;
}

// ¿Se salta este fichero? Si ha cambiado desde que se apartó, se olvida y se reintenta.
export function estaApartado(abs, stat) {
  const reg = cargar();
  const e = reg[abs];
  if (!e) return null;
  if (!mismoFichero(e, stat)) {
    delete reg[abs];
    guardar();
    return null;
  }
  return vigente(e) ? e : null;
}

export function quitar(abs) {
  const reg = cargar();
  if (reg[abs]) {
    delete reg[abs];
    guardar();
  }
}

// Apartados en vigor (los sospechosos de una sola caída no cuentan: se reintentan).
export function lista() {
  return Object.entries(cargar())
    .filter(([, e]) => vigente(e))
    .map(([abs, e]) => ({ abs, ...e }));
}

// Solo para pruebas: olvidar la caché en memoria.
export function _olvidarCache() {
  _cache = null;
}

export default { anotarCaida, apartarPorTamanyo, estaApartado, quitar, lista, MOTIVO_CAIDA, MOTIVO_TAMANYO };
