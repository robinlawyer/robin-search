// Índice vectorial local de RobinSearch — formato POR DOCUMENTO (desde la 1.4.5).
//
// Hasta la 1.4.4 el índice era vectra: UN fichero index.json con todos los vectores y el texto
// de todos los fragmentos (~9 KB por fragmento). vectra lo cargaba ENTERO en memoria al
// arrancar (readFile + JSON.parse) y lo reescribía ENTERO, sin escritura atómica, cada vez que
// se indexaba un solo documento. Con un expediente grande eso agota la memoria del proceso —
// Claude lo enseña como «Server disconnected» en cada arranque— y un corte a mitad de escritura
// dejaba el índice ilegible para siempre (todos los ficheros fallaban, sin reparación posible).
//
// Ahora cada documento vive en sus propios ficheros, dentro de <dataDir>/indice/docs:
//   <docId>.<gen>.vec  vectores Float32 (n × dim), binario
//   <docId>.jsonl      1.ª línea: cabecera {docId, n, dim, gen, expediente, …};
//                      después, una línea de metadatos (con el texto) por fragmento
// Escribir un documento no toca los demás. Cada fichero se escribe en .tmp y se renombra
// (atómico), y el .jsonl es el que CONFIRMA el documento: la cabecera nombra la generación
// (`gen`) de sus vectores, así que nunca se mezclan vectores nuevos con textos viejos.
//
// En memoria solo se guardan las cabeceras y, bajo demanda, los vectores (con un tope de
// memoria, ROBIN_MAX_VECTORES_MB); el texto se lee del disco solo para los resultados que se
// devuelven. El índice vive en el directorio de datos del usuario, NUNCA en la carpeta de
// expedientes.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { log } from '../logger.js';
import { conReintentos, escribirAtomico } from '../persistencia.js';
import { rutas } from '../rutas.js';
import { itemsVectra } from './migracion-vectra.js';

const TOPE_VECTORES_BYTES = (() => {
  const n = parseInt(process.env.ROBIN_MAX_VECTORES_MB, 10);
  return (Number.isFinite(n) && n > 0 ? n : 768) * 1024 * 1024;
})();
// Caché de metadatos (con el texto) por BYTES, no por documentos: 48 documentos pequeños son
// nada, pero 48 tomos de miles de fragmentos eran gigas.
const TOPE_META_BYTES = (() => {
  const n = parseInt(process.env.ROBIN_MAX_META_MB, 10);
  return (Number.isFinite(n) && n > 0 ? n : 96) * 1024 * 1024;
})();
const MAX_META_EN_CACHE = 48;
// Cada cuánto suelta el proceso una búsqueda sobre todo el índice (ms).
const CEDER_CADA_MS = 25;
const RESTOS_MIN_EDAD_MS = 10 * 60 * 1000;

// Un docId es un hash hexadecimal (registry.docIdForAbsPath). Las herramientas lo reciben del
// modelo: sin validarlo, un «../../» llegaría a construir una ruta fuera del índice.
const DOC_ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;
export function esDocIdValido(docId) {
  return typeof docId === 'string' && DOC_ID_VALIDO.test(docId);
}

export function dirIndice() {
  return path.join(config.dataDir, 'indice');
}
const dirDocs = () => path.join(dirIndice(), 'docs');
const rutaMeta = (docId) => path.join(dirDocs(), `${docId}.jsonl`);
const rutaVec = (docId, gen) => path.join(dirDocs(), `${docId}.${gen}.vec`);
const rutaVectraAntigua = () => path.join(config.indexDir || path.join(config.dataDir, 'index'), 'index.json');

// docId → { docId, n, dim, gen, expediente, rutaRelativa, fichero, raiz, mtimeMs, bytes }
let _cab = null;
let _dirMtime = -1;
// docId → { gen, v: Float32Array, normas: Float32Array, bytes }   (LRU por orden de inserción)
const _vec = new Map();
let _vecBytes = 0;
// docId → { gen, lista: [metadata], bytes }
const _meta = new Map();
let _metaBytes = 0;
function quitarMeta(docId) {
  const e = _meta.get(docId);
  if (e) {
    _metaBytes -= e.bytes || 0;
    _meta.delete(docId);
  }
}

// vectra solo admitía una transacción a la vez y aquí se conserva la misma disciplina: toda
// escritura del proceso pasa por esta cola.
let _cola = Promise.resolve();
function conCerrojo(fn) {
  const run = _cola.then(fn, fn);
  _cola = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Escritura atómica y reintentos ante el antivirus / la otra instancia: persistencia.js.
// Borrar sin hacer fallar la operación: lo que no se pueda quitar ahora (un .vec de una
// generación ya sustituida) lo recoge limpiarRestos en el siguiente arranque.
function quitar(ruta) {
  try {
    conReintentos(() => fs.rmSync(ruta, { force: true }));
  } catch {
    /* queda como resto */
  }
}

function mtimeDir() {
  try {
    return fs.statSync(dirDocs()).mtimeMs;
  } catch {
    return -1;
  }
}

function leerPrimeraLinea(ruta) {
  const fd = fs.openSync(ruta, 'r');
  try {
    const trozos = [];
    const buf = Buffer.alloc(16384);
    let pos = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      const i = buf.subarray(0, n).indexOf(10);
      if (i >= 0) {
        trozos.push(Buffer.from(buf.subarray(0, i)));
        break;
      }
      trozos.push(Buffer.from(buf.subarray(0, n)));
      pos += n;
      if (pos > 4 * 1024 * 1024) throw new Error('cabecera de documento demasiado larga');
    }
    return Buffer.concat(trozos).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function leerCabecera(docId) {
  try {
    const st = fs.statSync(rutaMeta(docId));
    const cab = JSON.parse(leerPrimeraLinea(rutaMeta(docId)));
    if (!cab || cab.docId !== docId || !Number.isInteger(cab.n) || !Number.isInteger(cab.dim) || !cab.gen) return null;
    const vst = fs.statSync(rutaVec(docId, cab.gen));
    if (vst.size !== cab.n * cab.dim * 4) return null;
    return { ...cab, mtimeMs: st.mtimeMs, bytes: st.size + vst.size };
  } catch {
    return null;
  }
}

const LECTURAS_EN_PARALELO = 16;

async function leerPrimeraLineaAsync(ruta) {
  const fh = await fs.promises.open(ruta, 'r');
  try {
    const trozos = [];
    const buf = Buffer.alloc(4096);
    let pos = 0;
    for (;;) {
      const { bytesRead: n } = await fh.read(buf, 0, buf.length, pos);
      if (n <= 0) break;
      const i = buf.subarray(0, n).indexOf(10);
      if (i >= 0) {
        trozos.push(Buffer.from(buf.subarray(0, i)));
        break;
      }
      trozos.push(Buffer.from(buf.subarray(0, n)));
      pos += n;
      if (pos > 4 * 1024 * 1024) throw new Error('cabecera de documento demasiado larga');
    }
    return Buffer.concat(trozos).toString('utf8');
  } finally {
    await fh.close();
  }
}

async function leerCabeceraAsync(docId) {
  try {
    const cab = JSON.parse(await leerPrimeraLineaAsync(rutaMeta(docId)));
    if (!cab || cab.docId !== docId || !Number.isInteger(cab.n) || !Number.isInteger(cab.dim) || !cab.gen) return null;
    const [st, vst] = await Promise.all([fs.promises.stat(rutaMeta(docId)), fs.promises.stat(rutaVec(docId, cab.gen))]);
    if (vst.size !== cab.n * cab.dim * 4) return null;
    return { ...cab, mtimeMs: st.mtimeMs, bytes: st.size + vst.size };
  } catch {
    return null;
  }
}

function soltarVectores(docId) {
  const e = _vec.get(docId);
  if (e) {
    _vecBytes -= e.bytes;
    _vec.delete(docId);
  }
}

function nombresDocs() {
  try {
    return fs.readdirSync(dirDocs());
  } catch {
    return [];
  }
}

// ── El catálogo (las cabeceras de todos los documentos) ───────────────────────────────────
//
// Hasta la 1.9.0 el catálogo se reconstruía ABRIENDO cada .jsonl: un stat, un open, una lectura
// y un close por documento, más el stat de su .vec. Con 45.000 documentos en Windows y el
// antivirus mirando cada fichero que se abre, abrir el índice costaba de 4 a 8 minutos (informes
// de gh-asesores, 29-sep-2026: «Otra instancia tiene el índice» 07:27:39 → «Índice abierto»
// 07:32:55). Y la instancia que solo busca, cada vez que la otra escribía un documento, volvía
// a hacer 45.000 stat SÍNCRONOS: el proceso parado mientras tanto.
//
// Ahora:
//   · La escritora guarda el catálogo entero en UN fichero (indice/catalogo.json) al abrir y
//     poco después de cada tanda de cambios, y lo relee cualquiera al arrancar.
//   · Lo que dice ese fichero se coteja con UN listado de la carpeta (readdir: un solo recorrido,
//     sin abrir ningún fichero). Cada escritura de un documento, sea cual sea, estrena generación
//     y con ella un .vec de nombre NUEVO (<docId>.<gen>.vec), y el borrado quita el .jsonl. Así
//     que el listado basta para saber qué documentos siguen exactamente como estaban: los que
//     tienen su .jsonl y UN solo .vec, el de la generación que se recuerda. Solo se abren los
//     demás (nuevos, reescritos, o a medio escribir).
//   · Un catálogo guardado viejo, cortado o ausente no es un error: solo hace que se abran más
//     cabeceras (en la 1.ª apertura tras actualizar, todas, una vez).
//   · La lectora refresca en segundo plano (readdir asíncrono y cediendo el proceso): las
//     funciones síncronas contestan con la foto que hay y piden el refresco; las asíncronas
//     (buscar, leer) lo esperan sin bloquear el proceso.
const rutaCatalogo = () => path.join(dirIndice(), 'catalogo.jsonl');
const CATALOGO_GUARDAR_TRAS_MS = Number(process.env.ROBIN_CATALOGO_GUARDAR_MS) || 60 * 1000;
let _catalogoSucio = false;
let _tGuardado = null;
// Cambios hechos por ESTE proceso: un refresco que empezó antes de uno de ellos no puede pisarlo.
let _cambiosLocales = 0;
let _refresco = null;
// Cifras de la última apertura y de los refrescos (para el registro y las pruebas).
let _ultimaApertura = null;
const _cuentas = { completas: 0, incrementales: 0, cabecerasReleidas: 0 };
export function estadisticasCatalogo() {
  return { ..._cuentas, ultimaApertura: _ultimaApertura, diario: { pos: _diarioPos, id: _diarioId } };
}

function filaCatalogo(c) {
  return [c.docId, c.n, c.dim, c.gen, c.expediente ?? null, c.rutaRelativa ?? null, c.fichero ?? null, c.raiz ?? null, c.bytes || 0];
}

// Formato: 1.ª línea {"v":2,"t":…}; después, una línea por documento con su fila (array JSON).
// Por líneas y no un solo JSON: con 45.000 documentos un JSON.parse de golpe paraba el proceso
// ~0,3 s; así se lee a trozos y cediendo.
function filaACabecera(f) {
  if (!Array.isArray(f)) return null;
  const [docId, n, dim, gen, expediente, rutaRelativa, fichero, raiz, bytes] = f;
  if (!esDocIdValido(docId) || !Number.isInteger(n) || !Number.isInteger(dim) || typeof gen !== 'string' || !gen) return null;
  return { v: 1, docId, n, dim, gen, expediente, rutaRelativa, fichero, raiz, bytes: Number(bytes) || 0 };
}

async function leerCatalogoGuardado({ ceder = true } = {}) {
  let texto;
  try {
    texto = await fs.promises.readFile(rutaCatalogo(), 'utf8');
  } catch {
    return null; // no está (1.ª vez tras actualizar): se reconstruye abriendo cabeceras
  }
  return parsearCatalogo(texto, ceder);
}

function leerCatalogoGuardadoSincrono() {
  try {
    return parsearCatalogoSincrono(fs.readFileSync(rutaCatalogo(), 'utf8'));
  } catch {
    return null;
  }
}

function cabeceraCatalogo(texto) {
  const fin = texto.indexOf('\n');
  if (fin < 0) return -1;
  try {
    const cab = JSON.parse(texto.slice(0, fin));
    // El catálogo solo vale si lo cierra su última línea: uno cortado a medias se descarta
    // entero (sería un catálogo al que le faltan documentos sin que nada lo diga).
    if (cab?.v !== 2 || !Number.isInteger(cab.docs) || !texto.endsWith('\n#fin\n')) return -1;
    return fin + 1;
  } catch {
    return -1;
  }
}

async function parsearCatalogo(texto, ceder) {
  let pos = cabeceraCatalogo(texto);
  if (pos < 0) return null;
  const m = new Map();
  let t = Date.now();
  let k = 0;
  const fin = texto.length - '#fin\n'.length;
  while (pos < fin) {
    let nl = texto.indexOf('\n', pos);
    if (nl < 0) nl = fin;
    try {
      const c = filaACabecera(JSON.parse(texto.slice(pos, nl)));
      if (c) m.set(c.docId, c);
    } catch {
      /* línea ilegible: ese documento se abre a mano */
    }
    pos = nl + 1;
    if (ceder && (++k & 255) === 0 && Date.now() - t > 15) {
      await new Promise((r) => setImmediate(r));
      t = Date.now();
    }
  }
  return m;
}

function parsearCatalogoSincrono(texto) {
  let pos = cabeceraCatalogo(texto);
  if (pos < 0) return null;
  const m = new Map();
  const fin = texto.length - '#fin\n'.length;
  while (pos < fin) {
    let nl = texto.indexOf('\n', pos);
    if (nl < 0) nl = fin;
    try {
      const c = filaACabecera(JSON.parse(texto.slice(pos, nl)));
      if (c) m.set(c.docId, c);
    } catch {
      /* ilegible */
    }
    pos = nl + 1;
  }
  return m;
}

function guardarCatalogo() {
  if (_tGuardado) clearTimeout(_tGuardado);
  _tGuardado = null;
  if (!_cab) return false;
  try {
    const lineas = [JSON.stringify({ v: 2, t: new Date().toISOString(), docs: _cab.size })];
    for (const c of _cab.values()) lineas.push(JSON.stringify(filaCatalogo(c)));
    lineas.push('#fin', '');
    escribirAtomico(rutaCatalogo(), lineas.join('\n'));
    _catalogoSucio = false;
    rotarDiarioSiHaceFalta();
    return true;
  } catch (err) {
    // Sin catálogo guardado solo se pierde velocidad en el próximo arranque.
    log.warn('No se pudo guardar el catálogo del índice', { err: String(err?.message ?? err), code: err?.code ?? null });
    return false;
  }
}

// Tras un cambio propio: guardar al cabo de un rato (una tanda de indexado es un solo guardado).
function catalogoCambiado(docId) {
  _cambiosLocales += 1;
  _catalogoSucio = true;
  if (docId) anotarDiario(docId);
  if (_tGuardado) return;
  _tGuardado = setTimeout(guardarCatalogo, CATALOGO_GUARDAR_TRAS_MS);
  _tGuardado.unref?.();
}

// Al salir: lo que quede sin guardar (síncrono, vale en el manejador de 'exit').
export function guardarCatalogoPendiente() {
  if (_catalogoSucio) guardarCatalogo();
}
process.on('exit', () => {
  try {
    guardarCatalogoPendiente();
    cerrarDiario();
  } catch {
    /* saliendo */
  }
});

// Nombres de la carpeta → { jsonl: [docId], vecs: Map(docId → gen | [gen, …]) }. El docId se
// valida al usarlo (leerCabecera), no aquí: con 90.000 nombres cada microsegundo cuenta.
function clasificarUno(nombre, jsonl, vecs) {
  const n = nombre.length;
  // «.jsonl» / «.vec» por su último carácter antes de comparar nada más.
  if (nombre.charCodeAt(n - 1) === 108 /* l */ && nombre.endsWith('.jsonl')) {
    jsonl.push(nombre.slice(0, n - 6));
  } else if (nombre.charCodeAt(n - 1) === 99 /* c */ && nombre.endsWith('.vec')) {
    const i = nombre.lastIndexOf('.', n - 5);
    if (i <= 0) return;
    const docId = nombre.slice(0, i);
    const gen = nombre.slice(i + 1, n - 4);
    const previo = vecs.get(docId);
    if (previo === undefined) vecs.set(docId, gen);
    else vecs.set(docId, Array.isArray(previo) ? [...previo, gen] : [previo, gen]);
  }
}

async function clasificarNombres(nombres, ceder = false) {
  const jsonl = [];
  const vecs = new Map();
  let t = Date.now();
  for (let k = 0; k < nombres.length; k++) {
    clasificarUno(nombres[k], jsonl, vecs);
    if (ceder && (k & 255) === 0 && Date.now() - t > 15) {
      await new Promise((r) => setImmediate(r));
      t = Date.now();
    }
  }
  return { jsonl, vecs };
}

function clasificarNombresSincrono(nombres) {
  const jsonl = [];
  const vecs = new Map();
  for (const n of nombres) clasificarUno(n, jsonl, vecs);
  return { jsonl, vecs };
}

// ¿Se puede dar por buena, solo con el listado, la cabecera que se recuerda? Sí si el documento
// tiene UN solo .vec y es el de la generación recordada.
const intacto = (c, gens) => c !== undefined && gens !== undefined && gens === c.gen;

// Coteja un catálogo de partida con el listado de la carpeta. Solo abre las cabeceras de los
// documentos que no se pueden dar por buenos con el listado. `ceder`: soltar el proceso cada
// pocos milisegundos.
async function conciliar(base, nombres, ceder) {
  const { jsonl, vecs } = await clasificarNombres(nombres, ceder);
  const nuevo = new Map();
  const aLeer = [];
  let t = Date.now();
  for (let k = 0; k < jsonl.length; k++) {
    const docId = jsonl[k];
    const c = base.get(docId);
    if (intacto(c, vecs.get(docId))) nuevo.set(docId, c);
    else if (esDocIdValido(docId)) aLeer.push(docId);
    if (ceder && (k & 255) === 0 && Date.now() - t > 15) {
      await new Promise((r) => setImmediate(r));
      t = Date.now();
    }
  }
  // Las cabeceras que hay que abrir, varias a la vez y fuera del hilo principal: en Windows lo
  // caro de cada una es la apertura (el antivirus), y en paralelo se solapan.
  let i = 0;
  const trabajador = async () => {
    while (i < aLeer.length) {
      const docId = aLeer[i++];
      const cab = await leerCabeceraAsync(docId);
      if (cab) nuevo.set(docId, cab);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LECTURAS_EN_PARALELO, aLeer.length) }, trabajador));
  return { nuevo, leidas: aLeer.length };
}

function conciliarSincrono(base, nombres) {
  const { jsonl, vecs } = clasificarNombresSincrono(nombres);
  const nuevo = new Map();
  let leidas = 0;
  for (const docId of jsonl) {
    const c = base.get(docId);
    if (intacto(c, vecs.get(docId))) nuevo.set(docId, c);
    else if (esDocIdValido(docId)) {
      leidas += 1;
      const cab = leerCabecera(docId);
      if (cab) nuevo.set(docId, cab);
    }
  }
  return { nuevo, leidas };
}

function aplicarCatalogo(nuevo, mtime) {
  for (const [id, e] of [..._vec]) {
    const c = nuevo.get(id);
    if (!c || c.gen !== e.gen) soltarVectores(id);
  }
  for (const [id, e] of [..._meta]) {
    const c = nuevo.get(id);
    if (!c || c.gen !== e.gen) quitarMeta(id);
  }
  _cab = nuevo;
  // La fecha de la carpeta de ANTES de listarla: lo que cambie mientras se listaba provoca otro
  // refresco (hasta la 1.9.0 se tomaba después y ese cambio podía quedarse sin ver).
  _dirMtime = mtime;
}

// Sin catálogo en memoria y desde una función síncrona (no debería pasar: abrir() va antes).
function cargarSincrono() {
  const m = mtimeDir();
  const d = estadoDiario();
  const base = _cab ?? leerCatalogoGuardadoSincrono() ?? new Map();
  const { nuevo } = conciliarSincrono(base, nombresDocs());
  aplicarCatalogo(nuevo, m);
  _diarioPos = d?.size ?? 0;
  _diarioId = d?.id ?? null;
  _ultimaCompleta = Date.now();
}


// ── Diario de cambios (para la instancia que solo busca) ──────────────────────────────────
//
// La escritora anota en indice/diario.log el docId de cada documento que escribe, resella o
// borra, DESPUÉS de confirmarlo. La lectora sigue el diario desde donde se quedó y solo vuelve a
// abrir las cabeceras de esos documentos: con 45.000 documentos y la otra instancia indexando,
// cada cambio le costaba 45.000 stat síncronos (hasta la 1.9.0). El diario solo ACELERA: si
// falta (una escritora de otra versión, un corte entre la confirmación y la anotación), un
// listado completo de la carpeta —en segundo plano y como mucho cada COMPLETA_CADA_MS— pone la
// foto al día; y un documento que la lectora recuerde con una generación que ya no existe no se
// sirve nunca mezclado (vectoresDe y metadatosDe comprueban la generación).
const rutaDiario = () => path.join(dirIndice(), 'diario.log');
const DIARIO_MAX_BYTES = 4 * 1024 * 1024;
const COMPLETA_CADA_MS = Number(process.env.ROBIN_CATALOGO_COMPLETA_MS) || 60 * 1000;
let _fdDiario = null;
let _diarioPos = 0;
let _diarioId = null;
let _ultimaCompleta = 0;
let _tCompleta = null;
let _forzarCompleta = false;

function estadoDiario() {
  try {
    const st = fs.statSync(rutaDiario());
    return { size: st.size, id: `${st.ino}:${st.birthtimeMs}` };
  } catch {
    return null;
  }
}

function anotarDiario(docId) {
  try {
    if (_fdDiario === null) {
      _fdDiario = fs.openSync(rutaDiario(), 'a');
      // La escritora es la única que anota: lo que ella anota ya está en su catálogo, así que
      // su posición en el diario avanza con cada anotación (no tiene que releerse a sí misma).
      const st = fs.fstatSync(_fdDiario);
      const id = `${st.ino}:${st.birthtimeMs}`;
      if (id !== _diarioId) {
        _diarioId = id;
        _diarioPos = st.size;
      }
    }
    const linea = `${docId}\n`;
    fs.writeSync(_fdDiario, linea);
    _diarioPos += Buffer.byteLength(linea);
  } catch {
    // Sin diario la lectora se entera igual, con el listado completo (más tarde y más caro).
    cerrarDiario();
  }
}

function cerrarDiario() {
  if (_fdDiario === null) return;
  try {
    fs.closeSync(_fdDiario);
  } catch {
    /* ya cerrado */
  }
  _fdDiario = null;
}

// Tras guardar el catálogo: si el diario ha crecido mucho, se empieza uno nuevo. Las lectoras ven
// otro fichero (otro id) y hacen UNA conciliación completa.
function rotarDiarioSiHaceFalta() {
  const d = estadoDiario();
  if (!d || d.size < DIARIO_MAX_BYTES) return;
  cerrarDiario();
  try {
    conReintentos(() => fs.rmSync(rutaDiario(), { force: true }));
  } catch {
    /* se intenta en el próximo guardado */
  }
}

async function leerDiario(desde, hasta) {
  const fh = await fs.promises.open(rutaDiario(), 'r');
  try {
    const buf = Buffer.alloc(hasta - desde);
    let leido = 0;
    while (leido < buf.length) {
      const { bytesRead } = await fh.read(buf, leido, buf.length - leido, desde + leido);
      if (bytesRead <= 0) break;
      leido += bytesRead;
    }
    // Solo líneas completas: la última puede estar a medio escribir.
    const fin = buf.subarray(0, leido).lastIndexOf(10);
    if (fin < 0) return { ids: [], pos: desde };
    const ids = new Set(buf.toString('utf8', 0, fin).split('\n').filter(esDocIdValido));
    return { ids: [...ids], pos: desde + fin + 1 };
  } finally {
    await fh.close();
  }
}

// Relee la cabecera de cada documento anotado (la verdad está en su .jsonl; sin él, ya no existe).
async function releerCabeceras(ids) {
  const leidas = new Map();
  let i = 0;
  const trabajador = async () => {
    while (i < ids.length) {
      const docId = ids[i++];
      leidas.set(docId, await leerCabeceraAsync(docId));
    }
  };
  await Promise.all(Array.from({ length: Math.min(LECTURAS_EN_PARALELO, ids.length) }, trabajador));
  return leidas;
}

async function conciliacionCompleta() {
  const m = mtimeDir();
  const d = estadoDiario(); // ANTES de listar: lo anotado después se aplica en la vuelta siguiente
  const antes = _cambiosLocales;
  let nombres;
  try {
    nombres = await fs.promises.readdir(dirDocs());
  } catch {
    nombres = [];
  }
  const { nuevo, leidas } = await conciliar(_cab ?? (await leerCatalogoGuardado()) ?? new Map(), nombres, true);
  if (antes !== _cambiosLocales) return false;
  _cuentas.completas += 1;
  _cuentas.cabecerasReleidas += leidas;
  aplicarCatalogo(nuevo, m);
  _diarioPos = d?.size ?? 0;
  _diarioId = d?.id ?? null;
  _ultimaCompleta = Date.now();
  return true;
}

// Refresco sin bloquear el proceso. Uno a la vez; si este proceso escribe mientras tanto, el
// resultado se descarta y se vuelve a mirar.
function refrescar() {
  if (_refresco) return _refresco;
  _refresco = (async () => {
    // Sin esto, un refresco que termina sin esperar nada ejecutaba su `finally` ANTES de que
    // `_refresco` quedara asignado, y se quedaba para siempre apuntando a una promesa resuelta:
    // ningún refresco posterior llegaba a hacerse.
    await null;
    try {
      for (let vuelta = 0; vuelta < 8; vuelta++) {
        const m = mtimeDir();
        const d = estadoDiario();
        const diarioIgual = d ? d.id === _diarioId && d.size === _diarioPos : _diarioId === null;
        if (_cab && m === _dirMtime && diarioIgual && !_forzarCompleta) return;
        // Un diario que no existía cuando se miró por última vez se lee desde el principio: todo
        // lo que tiene se anotó DESPUÉS de aquel vistazo (lo de antes lo vio el listado).
        if (_cab && d && _diarioId === null && _diarioPos === 0) _diarioId = d.id;
        if (_cab && !_forzarCompleta && d && d.id === _diarioId && d.size > _diarioPos) {
          // Lo normal: la otra instancia ha escrito unos documentos y los ha anotado.
          const antes = _cambiosLocales;
          const { ids, pos } = await leerDiario(_diarioPos, d.size);
          const leidas = await releerCabeceras(ids);
          if (antes !== _cambiosLocales) continue;
          _cuentas.incrementales += 1;
          _cuentas.cabecerasReleidas += ids.length;
          for (const [docId, cab] of leidas) {
            const previa = _cab.get(docId);
            if (previa && (!cab || previa.gen !== cab.gen)) {
              soltarVectores(docId);
              quitarMeta(docId);
            }
            if (cab) _cab.set(docId, cab);
            else _cab.delete(docId);
          }
          const avanzo = pos > _diarioPos;
          _diarioPos = pos;
          _dirMtime = m;
          if (!avanzo) return; // una línea a medio escribir: en la próxima consulta
          continue;
        }
        const diarioNuevo = !_cab || (d ? d.id !== _diarioId || d.size < _diarioPos : _diarioId !== null);
        if (diarioNuevo || _forzarCompleta) {
          _forzarCompleta = false;
          await conciliacionCompleta();
          continue;
        }
        // La carpeta ha cambiado sin nada anotado: el temporal de una escritura en curso (se
        // anotará al confirmarse), restos que se limpian, o una escritora sin diario. Se mira
        // entero cuando toque, sin repetir el listado en cada consulta.
        // Si para entonces el diario ha avanzado, era una escritura anotada y basta con él.
        _dirMtime = m;
        if (!_tCompleta) {
          const visto = d ? `${d.id}|${d.size}` : null;
          _tCompleta = setTimeout(() => {
            _tCompleta = null;
            const d2 = estadoDiario();
            if (!(d2 && visto && d2.id === d.id && d2.size > d.size)) _forzarCompleta = true;
            refrescar().catch(() => {});
          }, Math.max(1000, COMPLETA_CADA_MS - (Date.now() - _ultimaCompleta)));
          _tCompleta.unref?.();
        }
        return;
      }
    } finally {
      _refresco = null;
    }
  })();
  return _refresco;
}

// Síncrona: contesta con la foto que hay y, si la carpeta ha cambiado (la otra instancia ha
// escrito), pide el refresco en segundo plano. NUNCA relee el catálogo entero parando el proceso.
function asegurarCatalogo() {
  if (!_cab) {
    cargarSincrono();
    return;
  }
  if (_forzarCompleta || mtimeDir() !== _dirMtime) refrescar().catch(() => {});
}

// Asíncrona: espera a tener el catálogo al día (sin bloquear el proceso).
async function catalogoAlDia() {
  if (!_cab || _forzarCompleta || mtimeDir() !== _dirMtime) await refrescar();
}

function vectoresDe(cab) {
  const e = _vec.get(cab.docId);
  if (e && e.gen === cab.gen) {
    _vec.delete(cab.docId);
    _vec.set(cab.docId, e);
    return e;
  }
  if (e) soltarVectores(cab.docId);
  const bytes = cab.n * cab.dim * 4;
  const ab = new ArrayBuffer(bytes);
  const u8 = new Uint8Array(ab);
  const fd = fs.openSync(rutaVec(cab.docId, cab.gen), 'r');
  try {
    let leido = 0;
    while (leido < bytes) {
      const n = fs.readSync(fd, u8, leido, bytes - leido, leido);
      if (n <= 0) break;
      leido += n;
    }
    if (leido !== bytes) return null;
  } finally {
    fs.closeSync(fd);
  }
  const v = new Float32Array(ab);
  const normas = new Float32Array(cab.n);
  for (let j = 0; j < cab.n; j++) {
    let s = 0;
    const o = j * cab.dim;
    for (let k = 0; k < cab.dim; k++) s += v[o + k] * v[o + k];
    normas[j] = Math.sqrt(s);
  }
  const ent = { gen: cab.gen, v, normas, bytes: bytes + cab.n * 4 };
  _vec.set(cab.docId, ent);
  _vecBytes += ent.bytes;
  while (_vecBytes > TOPE_VECTORES_BYTES && _vec.size > 1) {
    const primero = _vec.keys().next().value;
    if (primero === cab.docId) break;
    soltarVectores(primero);
  }
  return ent;
}

// Lee un .jsonl LÍNEA A LÍNEA por trozos de 1 MB. Leerlo de una vez como texto volvía a dar
// ERR_STRING_TOO_LONG con un documento de más de ~512 MB (el mismo fallo que tumbaba vectra).
function* lineasDe(ruta) {
  const fd = fs.openSync(ruta, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let resto = Buffer.alloc(0);
    let pos = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      pos += n;
      let trozo = resto.length ? Buffer.concat([resto, buf.subarray(0, n)]) : buf.subarray(0, n);
      let i;
      while ((i = trozo.indexOf(10)) >= 0) {
        yield trozo.toString('utf8', 0, i);
        trozo = trozo.subarray(i + 1);
      }
      resto = Buffer.from(trozo);
    }
    if (resto.length) yield resto.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// Metadatos (con el texto) de cada fragmento, en el MISMO orden que sus vectores.
function metadatosDe(cab) {
  const e = _meta.get(cab.docId);
  if (e && e.gen === cab.gen) {
    _meta.delete(cab.docId);
    _meta.set(cab.docId, e); // recién usado: al final de la cola
    return e.lista;
  }
  const lista = [];
  let primera = true;
  for (const linea of lineasDe(rutaMeta(cab.docId))) {
    if (primera) {
      primera = false;
      let enDisco = null;
      try {
        enDisco = JSON.parse(linea);
      } catch {
        return null;
      }
      // El documento se reescribió entre la lectura de la cabecera y esta: no se mezclan.
      if (enDisco?.gen !== cab.gen) return null;
      continue;
    }
    if (!linea) continue;
    try {
      lista.push(JSON.parse(linea));
    } catch {
      lista.push(null);
    }
  }
  if (primera) return null;
  if (e) quitarMeta(cab.docId);
  // Tamaño aproximado en memoria: el del .jsonl (el texto domina).
  let bytes = 0;
  try {
    bytes = fs.statSync(rutaMeta(cab.docId)).size;
  } catch {
    bytes = 0;
  }
  _meta.set(cab.docId, { gen: cab.gen, lista, bytes });
  _metaBytes += bytes;
  while ((_metaBytes > TOPE_META_BYTES || _meta.size > MAX_META_EN_CACHE) && _meta.size > 1) {
    const primero = _meta.keys().next().value;
    if (primero === cab.docId) break;
    quitarMeta(primero);
  }
  return lista;
}

function leerDocCompleto(cab) {
  const ent = vectoresDe(cab);
  const metas = metadatosDe(cab);
  if (!ent || !metas) return [];
  const out = [];
  metas.forEach((m, j) => {
    if (!m) return;
    const { docId: _d, chunkId, ...resto } = m;
    out.push({ chunkId, vector: ent.v.slice(j * cab.dim, (j + 1) * cab.dim), metadata: resto });
  });
  return out;
}

function escribirDoc(docId, lista) {
  fs.mkdirSync(dirDocs(), { recursive: true });
  if (!lista.length) {
    borrarDoc(docId);
    return;
  }
  const dim = lista[0].vector.length;
  const f = new Float32Array(lista.length * dim);
  lista.forEach((c, j) => {
    if (c.vector.length !== dim) throw new Error('Fragmentos con vectores de distinta dimensión');
    f.set(c.vector, j * dim);
  });
  const m0 = lista[0].metadata || {};
  const gen = crypto.randomBytes(6).toString('hex');
  const cab = {
    v: 1,
    docId,
    n: lista.length,
    dim,
    gen,
    expediente: m0.expediente ?? null,
    rutaRelativa: m0.rutaRelativa ?? null,
    fichero: m0.fichero ?? null,
    raiz: m0.raiz ?? null,
  };
  const lineas = [JSON.stringify(cab)];
  for (const c of lista) lineas.push(JSON.stringify({ ...c.metadata, docId, chunkId: c.chunkId }));

  const previa = _cab?.get(docId) ?? leerCabecera(docId);
  escribirAtomico(rutaVec(docId, gen), Buffer.from(f.buffer, f.byteOffset, f.byteLength));
  escribirAtomico(rutaMeta(docId), `${lineas.join('\n')}\n`); // ← aquí queda confirmado
  if (previa?.gen && previa.gen !== gen) quitar(rutaVec(docId, previa.gen));

  soltarVectores(docId);
  quitarMeta(docId);
  if (!_cab) _cab = new Map();
  const st = fs.statSync(rutaMeta(docId));
  _cab.set(docId, { ...cab, mtimeMs: st.mtimeMs, bytes: st.size + f.byteLength });
  _dirMtime = mtimeDir();
  catalogoCambiado(docId);
}

function borrarDoc(docId, cab = _cab?.get(docId) ?? leerCabecera(docId)) {
  conReintentos(() => fs.rmSync(rutaMeta(docId), { force: true })); // sin .jsonl el documento deja de existir
  if (cab?.gen) quitar(rutaVec(docId, cab.gen));
  soltarVectores(docId);
  quitarMeta(docId);
  _cab?.delete(docId);
  _dirMtime = mtimeDir();
  catalogoCambiado(docId);
  return cab?.n ?? 0;
}

// ── Filtros (el mismo subconjunto de operadores que se usaba con vectra) ──────────────────
const CAMPOS_CABECERA = new Set(['docId', 'expediente', 'rutaRelativa', 'fichero', 'raiz']);
const OPERADORES = new Set(['$eq', '$ne', '$in', '$nin']);

function cumple(valor, cond) {
  if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) return valor === cond;
  for (const [op, arg] of Object.entries(cond)) {
    if (!OPERADORES.has(op)) throw new Error(`Filtro no soportado: ${op}`);
    if (op === '$eq' && valor !== arg) return false;
    if (op === '$ne' && valor === arg) return false;
    if (op === '$in' && !(Array.isArray(arg) && arg.includes(valor))) return false;
    if (op === '$nin' && Array.isArray(arg) && arg.includes(valor)) return false;
  }
  return true;
}

function partirFiltro(filter) {
  const doc = [];
  const frag = [];
  for (const [campo, cond] of Object.entries(filter || {})) {
    (CAMPOS_CABECERA.has(campo) ? doc : frag).push([campo, cond]);
  }
  return { doc, frag };
}

// ── API (la misma interfaz que tenía la capa de vectra) ───────────────────────────────────

// Inserta (o reemplaza) los fragmentos de un documento. `chunks` = [{ chunkId, vector, metadata }].
export function upsertChunks(docId, chunks) {
  return conCerrojo(async () => {
    if (!esDocIdValido(docId)) throw new Error(`docId no válido: ${docId}`);
    await catalogoAlDia();
    let lista = chunks.map((c) => ({ chunkId: c.chunkId, vector: c.vector, metadata: { ...c.metadata } }));
    const cab = _cab.get(docId);
    if (cab) {
      const nuevos = new Set(lista.map((c) => c.chunkId));
      lista = [...leerDocCompleto(cab).filter((p) => !nuevos.has(p.chunkId)), ...lista];
    }
    escribirDoc(docId, lista);
  });
}

// Sustituye el documento ENTERO por estos fragmentos, de una vez: hasta que la escritura se
// confirma, se sigue viendo la versión anterior. Es lo que usa el indexado (a diferencia de
// upsertChunks, que conserva los fragmentos que no vengan en la lista).
export function reemplazarDoc(docId, chunks) {
  return conCerrojo(async () => {
    if (!esDocIdValido(docId)) throw new Error(`docId no válido: ${docId}`);
    await catalogoAlDia();
    escribirDoc(
      docId,
      chunks.map((c) => ({ chunkId: c.chunkId, vector: c.vector, metadata: { ...c.metadata } })),
    );
  });
}

// Elimina todos los fragmentos de un documento. Devuelve cuántos había.
export function deleteByDoc(docId) {
  return conCerrojo(async () => {
    if (!esDocIdValido(docId)) return 0;
    await catalogoAlDia();
    const cab = _cab.get(docId) ?? leerCabecera(docId);
    if (!cab && !fs.existsSync(rutaMeta(docId))) return 0;
    return borrarDoc(docId, cab);
  });
}

// Cambia DÓNDE está archivado un documento (ruta lógica, expediente, raíz) sin volver a leerlo
// ni a calcular sus vectores: cuando una carpeta vigilada cambia de nombre lógico, o cambia la
// profundidad de expediente, sus documentos tienen que salir con el nombre nuevo — y NUNCA
// seguir respondiendo bajo el viejo, que puede pasar a ser el de otra carpeta (otro cliente).
// Se escribe con una generación NUEVA (copia de los vectores) para que la otra instancia, que
// guarda los metadatos en memoria por generación, no siga sirviendo los de antes.
// Devuelve true si había documento que cambiar.
export function resellar(docId, campos) {
  return conCerrojo(async () => {
    if (!esDocIdValido(docId)) return false;
    await catalogoAlDia();
    const cab = _cab.get(docId) ?? leerCabecera(docId);
    if (!cab) return false;
    const lineas = fs.readFileSync(rutaMeta(docId), 'utf8').split('\n');
    let cabDisco;
    try {
      cabDisco = JSON.parse(lineas[0]);
    } catch {
      return false;
    }
    if (cabDisco?.gen !== cab.gen) return false;
    const cambios = {};
    for (const k of ['rutaRelativa', 'expediente', 'raiz']) if (k in campos) cambios[k] = campos[k];
    const gen = crypto.randomBytes(6).toString('hex');
    const nuevas = [JSON.stringify({ ...cabDisco, ...cambios, gen })];
    for (let i = 1; i < lineas.length; i++) {
      if (!lineas[i]) continue;
      let m;
      try {
        m = JSON.parse(lineas[i]);
      } catch {
        nuevas.push(lineas[i]);
        continue;
      }
      nuevas.push(JSON.stringify({ ...m, ...cambios }));
    }
    fs.mkdirSync(dirDocs(), { recursive: true });
    const destino = rutaVec(docId, gen);
    conReintentos(() => fs.copyFileSync(rutaVec(docId, cab.gen), `${destino}.tmp`));
    conReintentos(() => fs.renameSync(`${destino}.tmp`, destino));
    escribirAtomico(rutaMeta(docId), `${nuevas.join('\n')}\n`); // ← aquí queda confirmado
    quitar(rutaVec(docId, cab.gen));
    soltarVectores(docId);
    _meta.delete(docId);
    const st = fs.statSync(rutaMeta(docId));
    _cab.set(docId, { ...cab, ...cambios, gen, mtimeMs: st.mtimeMs, bytes: st.size + cab.n * cab.dim * 4 });
    _dirMtime = mtimeDir();
    catalogoCambiado(docId);
    return true;
  });
}

// Escribe `destino` con los fragmentos (texto, página y vectores) de `origen`, que es un fichero
// de CONTENIDO idéntico en otra ruta (indexer.js lo comprueba por huella). En un despacho el mismo
// PDF está en varias carpetas o llega adjunto varias veces: recalcular sus vectores es lo más caro
// del indexado y daría exactamente lo mismo. El destino es un documento propio con SU ruta, SU
// expediente y SU raíz en cada fragmento (el aislamiento por expediente filtra por ellos): de
// `origen` solo se toma lo que sale del contenido (texto, página, vector). También vale sobre sí
// mismo (origen = destino): el mismo fichero con otra fecha y el mismo contenido. Devuelve cuántos
// fragmentos escribió, o null si `origen` no está completo (quien llama indexa entonces de cero).
export function copiarDoc(origen, destino, { fichero, rutaRelativa, raiz, expediente, fechaModificacion }) {
  return conCerrojo(async () => {
    if (!esDocIdValido(origen) || !esDocIdValido(destino)) return null;
    await catalogoAlDia();
    const cab = _cab.get(origen);
    if (!cab) return null;
    const trozos = leerDocCompleto(cab);
    if (!trozos.length || trozos.length !== cab.n) return null;
    // Mismos campos y en el mismo orden que escribe el indexado.
    const lista = trozos.map(({ chunkId, vector, metadata: { texto, pagina } }) => ({
      chunkId,
      vector,
      metadata: { texto, fichero, rutaRelativa, raiz, expediente, pagina, fechaModificacion },
    }));
    escribirDoc(destino, lista);
    return lista.length;
  });
}

// Búsqueda por similitud coseno. `filter` opcional sobre metadatos ({campo: valor|{$eq|$ne|$in|$nin}}).
export async function query(vector, topK, filter = undefined) {
  await catalogoAlDia();
  const K = Math.max(1, topK | 0);
  const q = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  let qn = 0;
  for (let k = 0; k < q.length; k++) qn += q[k] * q[k];
  qn = Math.sqrt(qn) || 1;
  const { doc: fDoc, frag: fFrag } = partirFiltro(filter);

  const top = []; // ordenado de mayor a menor score
  const meter = (score, docId, j, gen) => {
    if (top.length === K && score <= top[K - 1].score) return;
    let lo = 0;
    let hi = top.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (top[mid].score >= score) lo = mid + 1;
      else hi = mid;
    }
    top.splice(lo, 0, { score, docId, j, gen });
    if (top.length > K) top.pop();
  };

  // Sobre una FOTO del catálogo: al soltar el proceso, la instancia que indexa puede cambiarlo.
  // Con 5.000 documentos una búsqueda pasaba de 15 s sin soltar el proceso: Claude no recibía
  // respuesta a nada más mientras tanto.
  let cedido = Date.now();
  for (const cab of [..._cab.values()]) {
    if (Date.now() - cedido > CEDER_CADA_MS) {
      await new Promise((r) => setImmediate(r));
      cedido = Date.now();
    }
    if (cab.dim !== q.length) continue;
    if (!fDoc.every(([c, cond]) => cumple(cab[c], cond))) continue;
    let ent;
    let metas = null;
    try {
      ent = vectoresDe(cab);
      if (fFrag.length) metas = metadatosDe(cab);
    } catch {
      continue; // documento retirado por la instancia que indexa mientras se buscaba
    }
    if (!ent || (fFrag.length && !metas)) continue;
    const { v, normas } = ent;
    const dim = cab.dim;
    for (let j = 0; j < cab.n; j++) {
      if (metas && !fFrag.every(([c, cond]) => cumple(metas[j]?.[c], cond))) continue;
      let s = 0;
      const o = j * dim;
      for (let k = 0; k < dim; k++) s += v[o + k] * q[k];
      meter(s / (qn * (normas[j] || 1)), cab.docId, j, cab.gen);
    }
  }

  const out = [];
  for (const t of top) {
    const cab = _cab.get(t.docId);
    if (cab && cab.gen !== t.gen) continue; // reescrito mientras se buscaba: el orden ya no vale
    let metas = null;
    try {
      metas = cab ? metadatosDe(cab) : null;
    } catch {
      metas = null;
    }
    const m = metas?.[t.j];
    if (!m) continue;
    out.push({ score: t.score, docId: t.docId, chunkId: m.chunkId, metadata: m });
  }
  return out;
}

// Devuelve un fragmento concreto por (docId, chunkId).
export async function getChunk(docId, chunkId) {
  if (!esDocIdValido(docId)) return null;
  await catalogoAlDia();
  const cab = _cab.get(docId);
  if (!cab) return null;
  const metas = metadatosDe(cab) || [];
  return metas.find((m) => m && (m.chunkId === chunkId || (Number.isFinite(Number(chunkId)) && Number(m.chunkId) === Number(chunkId)))) ?? null;
}

// Devuelve TODOS los fragmentos de un documento, ordenados por chunkId (lectura íntegra).
export async function getDocChunks(docId) {
  if (!esDocIdValido(docId)) return [];
  await catalogoAlDia();
  const cab = _cab.get(docId);
  if (!cab) return [];
  return (metadatosDe(cab) || []).filter(Boolean).sort((a, b) => (a.chunkId ?? 0) - (b.chunkId ?? 0));
}

// Compatibilidad: el sellado de `expediente` (1.3.0) lo hace ahora `abrir()` al migrar.
export async function backfillExpediente() {
  await catalogoAlDia();
  return { sellados: 0, total: resumen().fragmentos };
}

export async function totalChunks() {
  return resumen().fragmentos;
}

export function resumen() {
  try {
    asegurarCatalogo();
  } catch {
    /* sin índice todavía */
  }
  let fragmentos = 0;
  let bytes = 0;
  for (const c of _cab?.values() ?? []) {
    fragmentos += c.n;
    bytes += c.bytes || 0;
  }
  return { documentos: _cab?.size ?? 0, fragmentos, bytes };
}

export function cabecera(docId) {
  if (!esDocIdValido(docId)) return null;
  asegurarCatalogo();
  return _cab.get(docId) ?? null;
}

export function docIds() {
  asegurarCatalogo();
  return [..._cab.keys()];
}

// Restos de escrituras cortadas (.tmp) y vectores de generaciones ya sustituidas. Solo los
// viejos: uno reciente puede ser una escritura en curso.
function limpiarRestos(nombres = null) {
  if (!nombres) {
    try {
      nombres = fs.readdirSync(dirDocs());
    } catch {
      return 0;
    }
  }
  const vivos = new Set([..._cab.values()].map((c) => `${c.docId}.${c.gen}.vec`));
  const ahora = Date.now();
  let quitados = 0;
  for (const n of nombres) {
    const esResto = n.endsWith('.tmp') || (n.endsWith('.vec') && !vivos.has(n));
    if (!esResto) continue;
    const ruta = path.join(dirDocs(), n);
    try {
      if (ahora - fs.statSync(ruta).mtimeMs < RESTOS_MIN_EDAD_MS) continue;
      fs.rmSync(ruta, { force: true });
      quitados += 1;
    } catch {
      /* siguiente */
    }
  }
  return quitados;
}

// Paso ÚNICO del índice de vectra (≤1.4.4) a este formato, en streaming: memoria acotada a un
// documento, sea cual sea el tamaño del index.json. Tolera un index.json cortado.
async function migrarDesdeVectra(ruta, derivarExpediente) {
  let bytes = 0;
  try {
    bytes = fs.statSync(ruta).size;
  } catch {
    /* sin tamaño */
  }
  log.info('Pasando el índice al formato por documento (una sola vez)', { bytes });
  if (!_cab) await refrescar();
  const info = {};
  const escritos = new Set();
  let actual = null;
  let documentos = 0;
  let fragmentos = 0;
  let descartados = 0;
  let fusionados = 0;

  const volcar = () => {
    if (!actual || !actual.chunks.length) {
      actual = null;
      return;
    }
    let lista = actual.chunks;
    if (escritos.has(actual.docId)) {
      // Trozos del mismo documento separados en el fichero (se reindexó): se juntan.
      const cab = _cab.get(actual.docId);
      if (cab) {
        const nuevos = new Set(lista.map((c) => c.chunkId));
        lista = [...leerDocCompleto(cab).filter((p) => !nuevos.has(p.chunkId)), ...lista];
      }
      fusionados += 1;
    } else {
      documentos += 1;
    }
    escribirDoc(actual.docId, lista);
    escritos.add(actual.docId);
    actual = null;
  };

  for await (const it of itemsVectra(ruta, info)) {
    const m = it?.metadata && typeof it.metadata === 'object' ? it.metadata : {};
    const docId = m.docId ?? String(it?.id ?? '').split('::')[0];
    if (!esDocIdValido(docId) || !Array.isArray(it?.vector) || !it.vector.length) {
      descartados += 1;
      continue;
    }
    const { docId: _d, chunkId: cid, ...resto } = m;
    if (!resto.expediente && derivarExpediente) resto.expediente = derivarExpediente(resto.rutaRelativa);
    if (!actual || actual.docId !== docId) {
      volcar();
      actual = { docId, chunks: [] };
    }
    actual.chunks.push({ chunkId: Number.isInteger(cid) ? cid : actual.chunks.length, vector: it.vector, metadata: resto });
    fragmentos += 1;
  }
  // Fichero cortado: el último documento puede estar a medias y no se escribe. El cotejo con
  // el registro (bootstrap) manda reindexar desde el original todo lo que no cuadre.
  if (info.completo) volcar();
  else actual = null;

  // Con reintentos: en Windows otra instancia de una versión anterior puede tenerlo abierto.
  borrarCarpetaPropia(path.dirname(ruta));
  const r = {
    documentos,
    fragmentos,
    descartados,
    fusionados,
    completo: Boolean(info.completo),
    ilegibles: info.ilegibles || 0,
    bytes,
  };
  log.info('Índice pasado al formato por documento', r);
  return r;
}

// ── Versiones anteriores a la 1.4.5 que sigan vivas en el equipo ──────────────────────────
//
// 27-sep-2026, Mac de Eduardo: una RobinSearch 1.4.0 (índice vectra en UN index.json) seguía
// arrancando cada noche a las 01:30 en modo `--silent` (tarea programada) y desde Claude, y
// volvía a crear index/index.json. La 1.8.3 lo «pasaba al formato por documento (una sola vez)»
// en CADA arranque, y un arranque que se lo encontró a medio escribir dio el índice por roto.
//
// Dos defensas que no dependen de encontrar a la versión antigua:
//   1. CEPO: una vez pasado el índice al formato actual, index/index.json pasa a ser una CARPETA
//      (con un LEEME dentro). vectra da el índice por creado (fs.access) y todo lo que intenta
//      leer o escribir en él falla con EISDIR: la versión antigua ya no puede crear un índice
//      paralelo, ni tocar el registro por un documento que no ha podido indexar (su indexado
//      borra en el índice ANTES de apuntar nada en files.json).
//   2. Si aun así aparece un index.json después de la migración (cepo quitado a mano, o creado
//      entre medias), NO se vuelve a migrar: se aparta y se devuelven los docId que traía, para
//      que el arranque los reindexe DESDE LOS ORIGINALES (lo que la versión antigua indexó es
//      el contenido nuevo de esos ficheros; lo que hay en el índice actual de ellos, el viejo).
const LEEME_CEPO =
  'Esta carpeta la pone RobinSearch a proposito (no es un error y no hay que borrarla).\n' +
  'Las versiones de RobinSearch anteriores a la 1.4.5 guardaban aqui el indice en un solo fichero\n' +
  '«index.json». El indice actual vive en la carpeta «indice». Con esta carpeta en su lugar, una\n' +
  'version antigua que siga instalada en el equipo no puede volver a escribir un indice paralelo.\n';

function esFichero(ruta) {
  try {
    return fs.statSync(ruta).isFile();
  } catch {
    return false;
  }
}

export function ponerCepo() {
  const ruta = rutaVectraAntigua();
  try {
    if (fs.statSync(ruta).isDirectory()) return true;
    return false; // hay un index.json de verdad: primero se migra o se aparta
  } catch {
    /* no existe: se pone */
  }
  try {
    fs.mkdirSync(ruta, { recursive: true });
    fs.writeFileSync(path.join(ruta, 'LEEME.txt'), LEEME_CEPO);
    return true;
  } catch (err) {
    log.warn('No se pudo proteger la ruta del índice antiguo', { code: err?.code ?? null });
    return false;
  }
}

async function apartarIndiceAntiguo(ruta) {
  const docIds = new Set();
  const info = {};
  let bytes = 0;
  try {
    bytes = fs.statSync(ruta).size;
  } catch {
    /* sin tamaño */
  }
  try {
    for await (const it of itemsVectra(ruta, info)) {
      const m = it?.metadata && typeof it.metadata === 'object' ? it.metadata : {};
      const docId = m.docId ?? String(it?.id ?? '').split('::')[0];
      if (esDocIdValido(docId)) docIds.add(docId);
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') log.warn('No se pudo leer el índice antiguo que ha vuelto a aparecer', { code: err?.code ?? null });
  }
  // Una sola copia (la última), por si hiciera falta mirarla: es un derivado, los originales
  // siguen en su carpeta.
  const destino = path.join(path.dirname(ruta), 'apartado-por-version-antigua.json');
  try {
    conReintentos(() => fs.renameSync(ruta, destino));
  } catch (err) {
    try {
      conReintentos(() => fs.rmSync(ruta, { force: true }));
    } catch {
      log.warn('No se pudo apartar el índice antiguo', { code: err?.code ?? null });
    }
  }
  log.warn('Una versión antigua de RobinSearch ha vuelto a escribir el índice antiguo: se aparta sin migrarlo y sus documentos se reindexan desde los originales', {
    bytes,
    documentos: docIds.size,
  });
  return { apartado: true, repetida: true, docIdsAReindexar: [...docIds], documentos: docIds.size, bytes };
}

// Abre el índice. `migrar` solo en la instancia que escribe (escritor.js).
export async function abrir({ migrar = true, derivarExpediente = null, alMigrar = null } = {}) {
  const t0 = Date.now();
  fs.mkdirSync(dirDocs(), { recursive: true });
  let migracion = null;
  const viejo = rutaVectraAntigua();
  if (migrar && esFichero(viejo)) {
    alMigrar?.();
    const repetida = fs.existsSync(rutaMigrado());
    if (repetida) {
      // Ya se pasó una vez: esto lo ha escrito una versión antigua que sigue viva. Se aparta.
      migracion = await conCerrojo(() => apartarIndiceAntiguo(viejo));
    } else {
      try {
        migracion = await conCerrojo(() => migrarDesdeVectra(viejo, derivarExpediente));
        migracion.repetida = false;
        try {
          escribirAtomico(rutaMigrado(), JSON.stringify({ t: new Date().toISOString() }));
        } catch {
          /* sin testigo solo se pierde el aviso de la próxima vez */
        }
      } catch (err) {
        // El index.json antiguo desapareció a mitad (lo ha pasado y borrado otra instancia, o la
        // versión antigua lo está reescribiendo). Eso NO es un índice dañado: hasta la 1.9.0 este
        // ENOENT subía hasta abrirIndice como «índice irrecuperable» y se BORRABA el índice entero.
        if (err?.code !== 'ENOENT') throw err;
        log.warn('El índice antiguo desapareció mientras se pasaba al formato nuevo: se sigue con el actual', {
          code: 'ENOENT',
        });
        migracion = { desaparecido: true, repetida };
      }
    }
  }
  if (migrar) ponerCepo();

  // El catálogo: el guardado (si lo hay) cotejado con UN listado de la carpeta.
  const m = mtimeDir();
  const diario = estadoDiario(); // antes de listar: lo que se anote después se aplica luego
  const guardado = _cab ? null : await leerCatalogoGuardado();
  const base = _cab ?? guardado ?? new Map();
  let nombres;
  try {
    nombres = await fs.promises.readdir(dirDocs());
  } catch {
    nombres = [];
  }
  const { nuevo, leidas } = await conciliar(base, nombres, true);
  aplicarCatalogo(nuevo, m);
  _diarioPos = diario?.size ?? 0;
  _diarioId = diario?.id ?? null;
  _ultimaCompleta = Date.now();
  _forzarCompleta = false;
  if (migrar) {
    // Quitar restos cambia la fecha de la carpeta y, sin esto, la PRIMERA consulta del catálogo
    // (el cotejo con el registro, justo después) lo releía. Los restos no son documentos del
    // catálogo: la foto sigue valiendo.
    if (limpiarRestos(nombres) > 0) _dirMtime = mtimeDir();
    // Lo abierto a mano (1.ª vez tras actualizar, o cambios desde el último guardado) se guarda
    // ya: el próximo arranque no tiene que volver a abrirlo.
    if (leidas > 0 || !guardado || guardado.size !== nuevo.size || migracion) guardarCatalogo();
  }
  _ultimaApertura = { ms: Date.now() - t0, documentos: nuevo.size, cabecerasLeidas: leidas, desdeCatalogo: Boolean(guardado) };
  log.info('Catálogo del índice cargado', {
    ms: _ultimaApertura.ms,
    documentos: nuevo.size,
    cabeceras_leidas: leidas,
    desde_catalogo: Boolean(guardado),
  });
  return { ...resumen(), migracion, apertura: _ultimaApertura };
}

// Testigo de que el índice antiguo (vectra) ya se pasó una vez a este formato.
const rutaMigrado = () => path.join(dirIndice(), 'migrado-desde-vectra.json');

// Rehacer desde cero (índice irrecuperable). Los documentos originales siguen en su carpeta: se
// vuelven a indexar desde ellos.
// Borrado recursivo SOLO de carpetas propias de RobinSearch. Si por una configuración rara (un
// ROBIN_DATA_DIR puesto a mano) una carpeta de expedientes quedara dentro de lo que se va a borrar,
// o lo que se va a borrar dentro de ella, no se borra nada: se lanza. Los documentos del cliente
// no se tocan nunca.
function borrarCarpetaPropia(dir) {
  const carpetas = (config.watchedFolders || []).map((c) => (typeof c === 'string' ? c : c?.path)).filter(Boolean);
  if (carpetas.some((c) => rutas.dentroDe(c, dir) || rutas.dentroDe(dir, c))) {
    throw new Error('Negado: una carpeta de expedientes coincide con la carpeta de datos de RobinSearch');
  }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

export function borrarTodo() {
  cerrarDiario();
  borrarCarpetaPropia(dirIndice());
  borrarCarpetaPropia(path.dirname(rutaVectraAntigua()));
  _cab = new Map();
  _vec.clear();
  _vecBytes = 0;
  _meta.clear();
  _metaBytes = 0;
  fs.mkdirSync(dirDocs(), { recursive: true });
  _dirMtime = mtimeDir();
  _cambiosLocales += 1;
  ponerCepo();
  guardarCatalogo();
}

export default {
  upsertChunks,
  reemplazarDoc,
  deleteByDoc,
  resellar,
  copiarDoc,
  query,
  getChunk,
  getDocChunks,
  backfillExpediente,
  totalChunks,
  resumen,
  cabecera,
  docIds,
  abrir,
  borrarTodo,
  guardarCatalogoPendiente,
  ponerCepo,
  estadisticasCatalogo,
  dirIndice,
  esDocIdValido,
};
