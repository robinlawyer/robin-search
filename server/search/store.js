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
import { itemsVectra } from './migracion-vectra.js';

const TOPE_VECTORES_BYTES = (() => {
  const n = parseInt(process.env.ROBIN_MAX_VECTORES_MB, 10);
  return (Number.isFinite(n) && n > 0 ? n : 768) * 1024 * 1024;
})();
const MAX_META_EN_CACHE = 48;
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
// docId → { gen, lista: [metadata] }
const _meta = new Map();

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

function cabeceraAlDia(nombre, nuevo) {
  if (!nombre.endsWith('.jsonl')) return;
  const docId = nombre.slice(0, -'.jsonl'.length);
  if (!esDocIdValido(docId)) return;
  let mt;
  try {
    mt = fs.statSync(rutaMeta(docId)).mtimeMs;
  } catch {
    return;
  }
  const previa = _cab?.get(docId);
  if (previa && previa.mtimeMs === mt) {
    nuevo.set(docId, previa);
    return;
  }
  const cab = leerCabecera(docId);
  if (cab) nuevo.set(docId, cab);
}

function aplicarCatalogo(nuevo) {
  for (const [id, e] of [..._vec]) {
    const c = nuevo.get(id);
    if (!c || c.gen !== e.gen) soltarVectores(id);
  }
  for (const [id, e] of [..._meta]) {
    const c = nuevo.get(id);
    if (!c || c.gen !== e.gen) _meta.delete(id);
  }
  _cab = nuevo;
  _dirMtime = mtimeDir();
}

// Relee las cabeceras del disco. Solo vuelve a abrir los documentos que han cambiado.
function escanear() {
  const nuevo = new Map();
  for (const nombre of nombresDocs()) cabeceraAlDia(nombre, nuevo);
  aplicarCatalogo(nuevo);
}

// Lo mismo al ABRIR, soltando el proceso cada pocos milisegundos: con 20.000 documentos (y un
// antivirus mirando cada fichero) la primera lectura pasa del minuto, y si el proceso no atiende
// a Claude mientras tanto, Claude lo da por muerto («Server disconnected»).
async function escanearCediendo() {
  const nuevo = new Map();
  let t = Date.now();
  for (const nombre of nombresDocs()) {
    cabeceraAlDia(nombre, nuevo);
    if (Date.now() - t > 30) {
      await new Promise((r) => setImmediate(r));
      t = Date.now();
    }
  }
  aplicarCatalogo(nuevo);
}

// Otra instancia (la que indexa) puede haber escrito documentos: si el directorio ha cambiado
// desde el último vistazo, se refrescan las cabeceras.
function asegurarCatalogo() {
  if (!_cab || mtimeDir() !== _dirMtime) escanear();
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

// Metadatos (con el texto) de cada fragmento, en el MISMO orden que sus vectores.
function metadatosDe(cab) {
  const e = _meta.get(cab.docId);
  if (e && e.gen === cab.gen) return e.lista;
  const lineas = fs.readFileSync(rutaMeta(cab.docId), 'utf8').split('\n');
  let enDisco = null;
  try {
    enDisco = JSON.parse(lineas[0]);
  } catch {
    return null;
  }
  // El documento se reescribió entre la lectura de la cabecera y esta: no se mezclan.
  if (enDisco?.gen !== cab.gen) return null;
  const lista = [];
  for (let i = 1; i < lineas.length; i++) {
    if (!lineas[i]) continue;
    try {
      lista.push(JSON.parse(lineas[i]));
    } catch {
      lista.push(null);
    }
  }
  _meta.set(cab.docId, { gen: cab.gen, lista });
  while (_meta.size > MAX_META_EN_CACHE) _meta.delete(_meta.keys().next().value);
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
  _meta.delete(docId);
  if (!_cab) _cab = new Map();
  const st = fs.statSync(rutaMeta(docId));
  _cab.set(docId, { ...cab, mtimeMs: st.mtimeMs, bytes: st.size + f.byteLength });
  _dirMtime = mtimeDir();
}

function borrarDoc(docId, cab = _cab?.get(docId) ?? leerCabecera(docId)) {
  conReintentos(() => fs.rmSync(rutaMeta(docId), { force: true })); // sin .jsonl el documento deja de existir
  if (cab?.gen) quitar(rutaVec(docId, cab.gen));
  soltarVectores(docId);
  _meta.delete(docId);
  _cab?.delete(docId);
  _dirMtime = mtimeDir();
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
    asegurarCatalogo();
    let lista = chunks.map((c) => ({ chunkId: c.chunkId, vector: c.vector, metadata: { ...c.metadata } }));
    const cab = _cab.get(docId);
    if (cab) {
      const nuevos = new Set(lista.map((c) => c.chunkId));
      lista = [...leerDocCompleto(cab).filter((p) => !nuevos.has(p.chunkId)), ...lista];
    }
    escribirDoc(docId, lista);
  });
}

// Elimina todos los fragmentos de un documento. Devuelve cuántos había.
export function deleteByDoc(docId) {
  return conCerrojo(async () => {
    if (!esDocIdValido(docId)) return 0;
    asegurarCatalogo();
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
    asegurarCatalogo();
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
    return true;
  });
}

// Búsqueda por similitud coseno. `filter` opcional sobre metadatos ({campo: valor|{$eq|$ne|$in|$nin}}).
export async function query(vector, topK, filter = undefined) {
  asegurarCatalogo();
  const K = Math.max(1, topK | 0);
  const q = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  let qn = 0;
  for (let k = 0; k < q.length; k++) qn += q[k] * q[k];
  qn = Math.sqrt(qn) || 1;
  const { doc: fDoc, frag: fFrag } = partirFiltro(filter);

  const top = []; // ordenado de mayor a menor score
  const meter = (score, docId, j) => {
    if (top.length === K && score <= top[K - 1].score) return;
    let lo = 0;
    let hi = top.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (top[mid].score >= score) lo = mid + 1;
      else hi = mid;
    }
    top.splice(lo, 0, { score, docId, j });
    if (top.length > K) top.pop();
  };

  for (const cab of _cab.values()) {
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
      meter(s / (qn * (normas[j] || 1)), cab.docId, j);
    }
  }

  const out = [];
  for (const t of top) {
    const cab = _cab.get(t.docId);
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
  asegurarCatalogo();
  const cab = _cab.get(docId);
  if (!cab) return null;
  const metas = metadatosDe(cab) || [];
  return metas.find((m) => m && (m.chunkId === chunkId || (Number.isFinite(Number(chunkId)) && Number(m.chunkId) === Number(chunkId)))) ?? null;
}

// Devuelve TODOS los fragmentos de un documento, ordenados por chunkId (lectura íntegra).
export async function getDocChunks(docId) {
  if (!esDocIdValido(docId)) return [];
  asegurarCatalogo();
  const cab = _cab.get(docId);
  if (!cab) return [];
  return (metadatosDe(cab) || []).filter(Boolean).sort((a, b) => (a.chunkId ?? 0) - (b.chunkId ?? 0));
}

// Compatibilidad: el sellado de `expediente` (1.3.0) lo hace ahora `abrir()` al migrar.
export async function backfillExpediente() {
  asegurarCatalogo();
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
function limpiarRestos() {
  let nombres = [];
  try {
    nombres = fs.readdirSync(dirDocs());
  } catch {
    return 0;
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
  if (!_cab) escanear();
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
  fs.rmSync(path.dirname(ruta), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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

// Abre el índice. `migrar` solo en la instancia que escribe (escritor.js).
export async function abrir({ migrar = true, derivarExpediente = null, alMigrar = null } = {}) {
  fs.mkdirSync(dirDocs(), { recursive: true });
  let migracion = null;
  const viejo = rutaVectraAntigua();
  if (migrar && fs.existsSync(viejo)) {
    alMigrar?.();
    migracion = await conCerrojo(() => migrarDesdeVectra(viejo, derivarExpediente));
  }
  await escanearCediendo();
  if (migrar) limpiarRestos();
  return { ...resumen(), migracion };
}

// Rehacer desde cero (índice irrecuperable). Los documentos originales siguen en su carpeta: se
// vuelven a indexar desde ellos.
export function borrarTodo() {
  fs.rmSync(dirIndice(), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  fs.rmSync(path.dirname(rutaVectraAntigua()), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  _cab = new Map();
  _vec.clear();
  _vecBytes = 0;
  _meta.clear();
  fs.mkdirSync(dirDocs(), { recursive: true });
  _dirMtime = mtimeDir();
}

export default {
  upsertChunks,
  deleteByDoc,
  resellar,
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
  dirIndice,
  esDocIdValido,
};
