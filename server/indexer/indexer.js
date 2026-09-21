// Orquestador del indexado: recorre las carpetas vigiladas (multi-raíz), decide qué ficheros
// procesar (incremental), extrae texto, trocea, genera embeddings locales y los guarda en el
// índice vectorial.
//
// Pipeline por fichero:
//   huella → extractFile → chunkPages → embedPassages (e5-small local) → store.reemplazarDoc → registry.set
//
// Velocidad (1.5.1, medido el 16-sep-2026): el embedding es ~95 % del tiempo. Por eso, cuando hay
// hilos de embedding (embedder/pool.js), varios documentos avanzan a la vez: la LECTURA de los
// ficheros sigue siendo de uno en uno (con su marca de «leyendo este fichero», diagnostico.js) y
// solo el cálculo de vectores va en paralelo. Sin hilos, todo sigue exactamente en serie.
// Además: primero lo más útil (documentos de texto recientes; imágenes que piden OCR al final),
// y un fichero con el mismo contenido que otro ya indexado reutiliza sus vectores.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  config,
  VERSION,
  SUPPORTED_EXTENSIONS,
  logicalPath,
  rootForPath,
  expedienteForLogicalPath,
  limiteBytes,
  canonizarRuta,
  esExtensionSoportada,
  MAX_FRAGMENTOS_POR_DOCUMENTO,
} from '../config.js';
import { rutas, tipoReal, extensionDe } from '../rutas.js';
import nube from './nube.js';
import { log } from '../logger.js';
import { esRutaDeRed } from '../net.js';
import {
  state,
  setIndexando,
  setActivo,
  setError,
  clearError,
  setUltimoIndexado,
} from '../state.js';
import { extractFile } from './extract.js';
import { chunkPages } from './chunk.js';
import { embedPassages, cargaEmbedding, prepararHilos } from '../embedder/embedder.js';
import * as store from '../search/store.js';
import * as registry from './registry.js';
import * as cuarentena from './cuarentena.js';
import * as diagnostico from '../diagnostico.js';
import * as escritor from '../escritor.js';
import * as ausentes from '../carpetas-ausentes.js';

// Reduce el mensaje de un error a una CAUSA agrupable. Sin esto, 680 ficheros que fallan por
// el mismo motivo producían 680 mensajes distintos (cada uno con su ruta) y no se veía que
// eran un único fallo. Se quitan rutas absolutas y números para que agrupen.
export function normalizarCausa(err) {
  const code = err?.code ? String(err.code) : null;
  const bruto = String(err?.message ?? err ?? 'error desconocido');
  const primeraLinea = bruto.split('\n').find((l) => l.trim()) || bruto;
  const limpio = primeraLinea
    .replace(/'[^'\n]*[\\/][^'\n]*'/g, "'<ruta>'")             // rutas entrecomilladas (con espacios)
    .replace(/(?:[A-Za-z]:)?[\\/][^\s'\"()]{8,}/g, '<ruta>')      // rutas absolutas sueltas
    .replace(/\b\d{3,}\b/g, '<n>')                            // offsets, tamaños, líneas
    .trim()
    .slice(0, 200);
  return code && !limpio.includes(code) ? `${code}: ${limpio}` : limpio;
}

function errorDiscoLleno() {
  return Object.assign(
    new Error(
      'No queda espacio en el disco del ordenador: el indexado se ha parado para no empeorarlo. ' +
        'Libera espacio y vuelve a indexar. Lo que ya estaba indexado sigue buscándose con normalidad.',
    ),
    { code: 'ROBIN_DISCO_LLENO' },
  );
}

function errorSinCerrojo() {
  return Object.assign(new Error('Otra instancia de RobinSearch ha tomado el índice: este indexado se deja a ella.'), {
    code: 'ROBIN_SIN_CERROJO',
  });
}

function isSupported(filePath) {
  return esExtensionSoportada(filePath);
}

// Lo que el recorrido NO ha podido meter en el índice sin que sea un error de lectura: sin esto,
// una carpeta de OneDrive «bajo demanda» o de iCloud daba 0 documentos sin decir nada. Solo
// contadores: ni nombres ni rutas (salen en estado_servidor y en el aviso técnico).
export function nuevaCuentaRecorrido() {
  return { no_descargados: 0, enlaces_inaccesibles: 0, bucles_evitados: 0, protegidos: 0, danados: 0 };
}

// iCloud deja «.Demanda.pdf.icloud» en lugar del fichero mientras no se descarga.
const RE_ICLOUD = /^\.(.+)\.icloud$/i;

// ── Ficheros de la nube que NO están descargados en este equipo ────────────────────────────
//
// 19-sep-2026 (Eduardo, Mac con iCloud): 202 ficheros con `ETIMEDOUT: connection timed out, read`.
// Eran ficheros que iCloud enseña en la carpeta pero cuyo contenido no está en el disco: al
// abrirlos, el sistema intenta bajarlos y, si no puede, la lectura se agota minutos después. Se
// perdía el tiempo fichero a fichero y salían como «error de indexado» — y no hay nada roto.
//
// Se detectan ANTES de leerlos: un fichero con tamaño pero SIN bloques asignados en disco es un
// marcador, no un documento (iCloud y OneDrive en Mac/Linux lo dejan así). En Windows el sistema
// no lo expone por `stat`; allí manda la clasificación del error de lectura, más abajo.
export function esMarcadorDeNube(stat) {
  if (process.platform === 'win32') return false;
  return Number(stat?.size) > 0 && stat?.blocks === 0;
}

// Errores que NO son un fallo de RobinSearch sino del fichero o de la nube del abogado. No
// disparan aviso técnico (bootstrap.js filtra por estos prefijos), pero sí se cuentan y se
// explican en `estado_servidor` con lo que hay que hacer.
const CODIGOS_NUBE = new Set(['ETIMEDOUT', 'EHOSTDOWN', 'EHOSTUNREACH', 'ENOTCONN', 'ENETDOWN', 'ETIME']);

// Disco lleno: no es un problema de un fichero, es del equipo, y seguir intentando ficheros uno
// a uno solo hace daño (el propio OCR escribe temporales). Ver `cortarPorDisco`.
const CODIGOS_DISCO = new Set(['ENOSPC', 'EDQUOT']);

export function claseDeError(err) {
  const code = String(err?.code || '');
  if (CODIGOS_DISCO.has(code)) return 'disco';
  if (CODIGOS_NUBE.has(code)) return 'nube';
  if (code === 'ENOENT') return 'desaparecido';
  return null;
}

// Identidad de una carpeta para no recorrerla dos veces (enlace o junction que apunta hacia
// arriba: sin esto, un bucle infinito). dev+ino; donde el sistema no da inodo (0, algunos
// recursos de red y FAT), la ruta real.
function identidadCarpeta(dir) {
  try {
    const st = fs.statSync(dir, { bigint: true });
    if (st.ino && st.ino !== 0n) return `${st.dev}:${st.ino}`;
  } catch {
    return null;
  }
  try {
    return `r:${rutas.claveRuta(fs.realpathSync.native(dir))}`;
  } catch {
    return null;
  }
}

// Recorre recursivamente una carpeta y devuelve rutas absolutas de ficheros soportados.
// Ignora directorios ocultos y el propio directorio de datos por si estuviera anidado.
function* walk(dir, ilegibles = null, cuenta = nuevaCuentaRecorrido(), visitadas = new Set()) {
  const id = identidadCarpeta(dir);
  if (id) {
    if (visitadas.has(id)) {
      cuenta.bucles_evitados += 1;
      return;
    }
    visitadas.add(id);
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // Una subcarpeta ilegible a mitad del recorrido no puede pasar en silencio: sobre una
    // unidad de red que se cae (o una carpeta que otro usuario tiene bloqueada) el índice
    // quedaría incompleto y la búsqueda diría "no hay nada" sobre documentos que sí existen.
    log.warn('No se pudo leer directorio', { dir, err: String(err) });
    if (ilegibles) ilegibles.push({ carpeta: dir, motivo: String(err?.code || err) });
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      const nube = entry.name.match(RE_ICLOUD);
      if (nube && isSupported(nube[1])) cuenta.no_descargados += 1;
      continue;
    }
    const full = path.join(dir, entry.name);
    if (rutas.dentroDe(full, config.dataDir)) continue;
    const tipo = tipoReal(full, entry, cuenta);
    if (tipo === 'carpeta') {
      yield* walk(full, ilegibles, cuenta, visitadas);
    } else if (tipo === 'fichero' && isSupported(full)) {
      yield full;
    }
  }
}

// Indexa (o re-indexa) un único fichero. Devuelve el resumen de lo procesado.
//
// Antes de leerlo: se salta si está APARTADO (hizo caer el proceso, o es demasiado grande) y se
// deja la marca de «leyendo este fichero» (diagnostico.js). Si el lector tumba el proceso —
// memoria agotada, un comprimido o un PDF que revienta—, la marca sobrevive y el siguiente
// arranque sabe qué fichero fue. Hasta la 1.4.4 ese fichero tumbaba RobinSearch en CADA
// arranque, para siempre, y nadie sabía cuál era.
export async function indexFile(absPath, { force = false, paralelo = false } = {}) {
  const abs = path.resolve(absPath);
  // Nada entra en el índice si no cuelga de una carpeta configurada AHORA. Un indexado que ya
  // estaba en marcha cuando el abogado quitó la carpeta (o un evento rezagado del vigilante)
  // volvería a meter documentos de un cliente que ya no se vigila.
  if (!rootForPath(abs)) return { ruta: path.basename(abs), estado: 'omitido', motivo: 'fuera_de_carpetas' };
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return indexFileSinMarca(abs, { force });
  }
  if (!force && !registry.isStale(abs, stat)) {
    return { ruta: logicalPath(abs), estado: 'sin_cambios' };
  }
  // Fichero de la nube sin descargar: ni se abre. Abrirlo cuesta un timeout de minutos y acaba
  // en «error de indexado» sin que haya nada que arreglar (correo de Eduardo, 19-sep-2026).
  if (esMarcadorDeNube(stat)) {
    // Apuntado, no olvidado: se pide la descarga y se vuelve a mirar hasta que esté (nube.js).
    nube.apuntar(abs, 'sin_descargar');
    return { ruta: logicalPath(abs), estado: 'no_descargado' };
  }
  const ext = path.extname(abs).toLowerCase();
  const apartado = cuarentena.estaApartado(abs, stat);
  if (apartado) return { ruta: logicalPath(abs), estado: 'apartado', motivo: apartado.motivo };
  const limite = limiteBytes(ext);
  if (stat.size > limite) {
    cuarentena.apartarPorTamanyo(abs, stat, limite);
    log.warn('Fichero apartado por tamaño', { ext, bytes: stat.size, limite });
    // Si estaba indexado de antes, se retira: lo indexado ya no es lo que hay en el fichero.
    if (registry.get(abs)) await removeFilePath(abs);
    return { ruta: logicalPath(abs), estado: 'apartado', motivo: cuarentena.MOTIVO_TAMANYO };
  }
  const marca = { fichero: abs, ext, bytes: stat.size };
  // En paralelo, la marca cubre solo la LECTURA (que va de una en una, ver `leerEnSerie`): es lo
  // que puede tumbar el proceso por un fichero concreto. Los vectores se calculan en los hilos de
  // embedding, fuera del hilo principal: si uno muere, el pool repite su lote y lo repone.
  if (paralelo) return indexFileSinMarca(abs, { force, marca });
  marcarLectura(marca);
  try {
    return await indexFileSinMarca(abs, { force });
  } finally {
    diagnostico.finFase();
  }
}

function marcarLectura(marca) {
  diagnostico.marcarFase('indexando', marca);
  // Solo pruebas automáticas: simula un lector que tumba el proceso (como un OOM).
  if (process.env.ROBIN_PRUEBA_CAER_EN && path.basename(marca.fichero) === process.env.ROBIN_PRUEBA_CAER_EN) {
    process.kill(process.pid, 'SIGKILL');
  }
}

// Lecturas de fichero de una en una aunque los documentos avancen en paralelo: la marca de
// diagnóstico nombra UN fichero, y leer varios PDF grandes a la vez multiplicaría la memoria.
let _lectura = Promise.resolve();
function leerEnSerie(fn) {
  const turno = _lectura.then(fn, fn);
  _lectura = turno.then(
    () => undefined,
    () => undefined,
  );
  return turno;
}

// ── Contenido repetido ─────────────────────────────────────────────────────────────────────
// Huella del CONTENIDO de un fichero más todo lo que decide qué fragmentos salen de él
// (extensión, troceado, OCR, modelo y versión de RobinSearch, que puede cambiar los lectores).
// Dos ficheros con la misma huella dan los mismos fragmentos y los mismos vectores.
async function huellaDe(abs) {
  const h = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(abs)
      .on('data', (d) => h.update(d))
      .on('end', resolve)
      .on('error', reject);
  });
  const ajustes = [
    VERSION,
    path.extname(abs).toLowerCase(),
    config.embeddingModel,
    config.embeddingQuantized,
    config.chunkSizeTokens,
    config.chunkOverlapTokens,
    config.maxPagesPerFile,
    MAX_FRAGMENTOS_POR_DOCUMENTO,
    config.ocrEnabled,
    config.ocrLang,
    config.ocrDpi,
    config.ocrMaxPages,
  ].join('|');
  return `${h.digest('hex')}:${crypto.createHash('sha1').update(ajustes).digest('hex').slice(0, 12)}`;
}

// Huellas de lo que se está indexando AHORA: la segunda copia de un fichero espera a la primera
// en vez de calcular lo mismo a la vez.
const _huellasEnCurso = new Map();

// Un documento ya indexado con esta huella y completo en el índice (o null).
function origenConHuella(huella, abs) {
  // Primero el propio fichero (misma ruta, otra fecha), después cualquier otra copia.
  const candidatos = registry.conHuella(huella).sort((x, y) => (y[0] === abs) - (x[0] === abs));
  for (const [absOrigen, e] of candidatos) {
    if (!e?.docId) continue;
    if (e.numChunks > 0) {
      const cab = store.cabecera(e.docId);
      if (cab && cab.n === e.numChunks) return { abs: absOrigen, entrada: e };
    } else if (absOrigen === abs) {
      return { abs: absOrigen, entrada: e };
    }
  }
  return null;
}

async function indexFileSinMarca(absPath, { force = false, marca = null } = {}) {
  const abs = path.resolve(absPath);
  const rutaLogica = logicalPath(abs);
  const root = rootForPath(abs);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { ruta: rutaLogica, estado: 'omitido', motivo: 'no_existe' };
  }

  if (!force && !registry.isStale(abs, stat)) {
    return { ruta: rutaLogica, estado: 'sin_cambios' };
  }

  // El docId que ya tenía (si la clave del registro se reescribió con otra caja, conserva el suyo:
  // con uno nuevo, los fragmentos viejos quedarían en el índice duplicados).
  const docId = registry.get(abs)?.docId || registry.docIdForAbsPath(abs);

  // NO se borra lo indexado antes de extraer (hasta la 1.4.7 sí): si la extracción o el embedding
  // fallan en un reindexado —fichero abierto en Word, unidad de red que se cae—, el documento
  // DESAPARECÍA del índice. Ahora la versión anterior sigue buscable hasta que la nueva está
  // lista, y se sustituye de una vez (store.reemplazarDoc). Como el registro no se actualiza, el
  // fichero sigue «cambiado» y se reintenta en la siguiente pasada.
  const expediente = expedienteForLogicalPath(rutaLogica);

  // Contenido idéntico a algo ya indexado → se reutiliza (salvo reindexado forzado, que es
  // justo para no fiarse de lo que hay). Una huella que no se puede calcular no impide indexar.
  let huella = null;
  if (!force) {
    try {
      huella = await huellaDe(abs);
    } catch {
      huella = null;
    }
  }
  let alTerminarHuella = null;
  if (huella) {
    while (_huellasEnCurso.has(huella)) await _huellasEnCurso.get(huella).catch(() => {});
    _huellasEnCurso.set(huella, new Promise((r) => (alTerminarHuella = r)));
  }
  try {
    if (huella) {
      const r = await reutilizar({ abs, stat, huella, docId, root, rutaLogica, expediente });
      if (r) return r;
    }
    return await indexarContenido({ abs, stat, huella, docId, root, rutaLogica, expediente, marca });
  } finally {
    if (huella) {
      _huellasEnCurso.delete(huella);
      alTerminarHuella();
    }
  }
}

function entradaBase({ abs, stat, docId, root, rutaLogica, expediente }) {
  return {
    docId,
    raiz: root?.name ?? null,
    rutaRelativa: rutaLogica,
    // Expediente del documento: es el campo por el que se AÍSLA la búsqueda. Se deriva de la
    // carpeta del caso al indexar, se guarda en cada fragmento y se filtra de forma exacta en
    // el índice vectorial (antes de puntuar), no a posteriori en memoria.
    expediente,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    indexedAt: new Date().toISOString(),
  };
}

// ¿Sigue el fichero como estaba al calcular la huella? Si ha cambiado entretanto, lo indexado no
// corresponde a esa huella y no se guarda (la siguiente pasada lo vuelve a ver cambiado).
function mismoFichero(abs, stat) {
  try {
    const ahora = fs.statSync(abs);
    return ahora.size === stat.size && ahora.mtimeMs === stat.mtimeMs;
  } catch {
    return false;
  }
}

async function reutilizar({ abs, stat, huella, docId, root, rutaLogica, expediente }) {
  const origen = origenConHuella(huella, abs);
  if (!origen) return null;
  const e = origen.entrada;
  const base = { ...entradaBase({ abs, stat, docId, root, rutaLogica, expediente }), numPages: e.numPages ?? null, huella };
  if (!(e.numChunks > 0)) {
    // El mismo fichero, sin cambios de contenido (solo la fecha): ni texto antes ni ahora.
    if (!escritor.confirmar()) return { ruta: rutaLogica, estado: 'omitido', motivo: 'solo_lectura' };
    registry.set(abs, { ...base, numChunks: 0, sinOcr: Boolean(e.sinOcr) });
    if (e.sinOcr) state.ficherosSinOcr.add(rutaLogica);
    return { ruta: rutaLogica, estado: e.sinOcr ? 'sin_ocr' : 'vacio', reutilizado: true };
  }
  // Mismo fichero con otra fecha (una sincronización de OneDrive que solo la toca) o una copia en
  // otra ruta: se reescriben sus fragmentos con la ruta, el expediente y la fecha de ESTE fichero.
  if (!escritor.confirmar()) return { ruta: rutaLogica, estado: 'omitido', motivo: 'solo_lectura' };
  const n = await store.copiarDoc(e.docId, docId, {
    fichero: path.basename(abs),
    rutaRelativa: rutaLogica,
    raiz: root?.name ?? null,
    expediente,
    fechaModificacion: stat.mtime.toISOString(),
  });
  if (n === null) return null;
  if (!mismoFichero(abs, stat)) delete base.huella;
  state.ficherosSinOcr.delete(rutaLogica);
  registry.set(abs, { ...base, numChunks: n, sinOcr: false });
  return { ruta: rutaLogica, estado: 'indexado', chunks: n, reutilizado: true };
}

async function indexarContenido({ abs, stat, huella, docId, root, rutaLogica, expediente, marca }) {
  const leer = () =>
    extractFile(abs, {
      maxPages: config.maxPagesPerFile,
    });
  const { pages, sinOcr, numPages } = marca
    ? await leerEnSerie(async () => {
        marcarLectura(marca);
        try {
          return await leer();
        } finally {
          diagnostico.finFase();
        }
      })
    : await leer();

  const baseEntry = { ...entradaBase({ abs, stat, docId, root, rutaLogica, expediente }), numPages };

  // La huella solo se guarda si el fichero no ha cambiado mientras se leía.
  const conHuella = () => (huella && mismoFichero(abs, stat) ? { huella } : {});

  if (sinOcr) {
    if (!escritor.confirmar()) return { ruta: rutaLogica, estado: 'omitido', motivo: 'solo_lectura' };
    await store.deleteByDoc(docId);
    state.ficherosSinOcr.add(rutaLogica);
    registry.set(abs, { ...baseEntry, ...conHuella(), numChunks: 0, sinOcr: true });
    log.warn('PDF sin OCR (no legible), omitido del índice', { ruta: rutaLogica });
    return { ruta: rutaLogica, estado: 'sin_ocr' };
  }

  state.ficherosSinOcr.delete(rutaLogica);

  let chunks = chunkPages(pages, {
    chunkSizeTokens: config.chunkSizeTokens,
    chunkOverlapTokens: config.chunkOverlapTokens,
  });
  if (chunks.length > MAX_FRAGMENTOS_POR_DOCUMENTO) {
    log.warn('Documento con más fragmentos que el tope: se indexa hasta el tope', {
      fragmentos: chunks.length,
      tope: MAX_FRAGMENTOS_POR_DOCUMENTO,
    });
    chunks = chunks.slice(0, MAX_FRAGMENTOS_POR_DOCUMENTO);
  }

  if (chunks.length === 0) {
    if (!escritor.confirmar()) return { ruta: rutaLogica, estado: 'omitido', motivo: 'solo_lectura' };
    await store.deleteByDoc(docId);
    registry.set(abs, { ...baseEntry, ...conHuella(), numChunks: 0, sinOcr: false });
    return { ruta: rutaLogica, estado: 'vacio' };
  }

  const vectors = await embedPassages(chunks.map((c) => c.text));

  const fichero = path.basename(abs);
  const fechaModificacion = stat.mtime.toISOString();
  const items = chunks.map((c, i) => ({
    chunkId: c.chunkId,
    vector: vectors[i],
    metadata: {
      texto: c.text,
      fichero,
      rutaRelativa: rutaLogica,
      raiz: root?.name ?? null,
      expediente,
      pagina: c.page,
      fechaModificacion,
    },
  }));

  // Justo antes de escribir: ¿sigue siendo esta la instancia que escribe? (escritor.js)
  if (!escritor.confirmar()) return { ruta: rutaLogica, estado: 'omitido', motivo: 'solo_lectura' };
  await store.reemplazarDoc(docId, items);
  registry.set(abs, { ...baseEntry, ...conHuella(), numChunks: chunks.length, sinOcr: false });

  return { ruta: rutaLogica, estado: 'indexado', chunks: chunks.length };
}

// Elimina un fichero del índice (invocado por el watcher al borrarse un fichero).
export async function removeFilePath(absPath) {
  const abs = path.resolve(absPath);
  const rutaLogica = logicalPath(abs);
  if (!escritor.confirmar()) return { ruta: rutaLogica, estado: 'omitido', motivo: 'solo_lectura' };
  const entry = registry.remove(abs);
  state.ficherosSinOcr.delete(rutaLogica);
  if (entry) await store.deleteByDoc(entry.docId);
  return { ruta: rutaLogica, estado: 'eliminado' };
}

// Indexa una o varias carpetas (incremental salvo `force`). Por defecto, todas las raíces
// configuradas. Actualiza el estado runtime.
function respirar() {
  return new Promise((r) => setImmediate(r));
}

// Indexados en curso en ESTE proceso (el inicial del arranque, el que pide la app, el
// re-escaneo de una carpeta de red). El canal de control lo usa para poner en cola lo que pida
// la app en vez de lanzar un segundo indexado encima del primero.
let _enCurso = 0;
const _alTerminar = new Set();

export function indexandoAhora() {
  return _enCurso > 0;
}

export function alTerminarIndexado(fn) {
  _alTerminar.add(fn);
  return () => _alTerminar.delete(fn);
}

// ¿Esperar a que termine algún documento antes de empezar otro? Sin hilos, siempre (en serie,
// como siempre). Con hilos: como mucho dos documentos por hilo en marcha y no más de dos lotes por
// hilo esperando. Leer por delante de lo que se puede calcular solo llenaría la memoria de textos.
function hayQueEsperar(enMarcha) {
  const carga = cargaEmbedding();
  if (!carga) return true;
  return enMarcha >= carga.hilos * 2 + 1 || carga.pendientes >= carga.hilos * carga.lote * 2;
}

// Orden del indexado: lo que más pronto sirve al abogado, primero.
//   0 escritos, correos, PDF y presentaciones · 1 hojas de cálculo · 2 comprimidos
//   3 imágenes (siempre OCR, lo más lento por documento)
// y dentro de cada grupo, lo modificado más recientemente antes. Los PDF escaneados no se pueden
// distinguir sin leerlos; van con los demás PDF.
const PRIORIDAD_EXT = new Map([
  ...['.xlsx', '.xls', '.xlsm', '.ods', '.fods', '.csv', '.tsv'].map((e) => [e, 1]),
  ...['.zip', '.rar', '.7z'].map((e) => [e, 2]),
  ...['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.gif', '.heic', '.heif'].map((e) => [e, 3]),
]);

async function planificar(files, force = false) {
  const orden = [];
  let bytesPendientes = 0;
  let t = Date.now();
  for (const abs of files) {
    let stat = null;
    try {
      const st = fs.statSync(abs);
      const pendiente = force || registry.isStale(abs, st);
      stat = { size: st.size, mtimeMs: st.mtimeMs, pendiente };
      if (pendiente) bytesPendientes += st.size;
    } catch {
      /* desaparecido: indexFile lo dirá */
    }
    orden.push({ abs, stat, prioridad: PRIORIDAD_EXT.get(path.extname(abs).toLowerCase()) ?? 0 });
    if (Date.now() - t > 30) {
      await respirar();
      t = Date.now();
    }
  }
  orden.sort((a, b) => a.prioridad - b.prioridad || (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0));
  return { orden, bytesPendientes };
}

// Tiempo restante estimado, con el ritmo MEDIDO en este indexado (bytes de ficheros que había
// que indexar ya terminados por segundo). Es aproximado: un PDF escaneado pesa poco y tarda
// mucho (OCR), una hoja de cálculo al revés. No se da hasta tener algo de muestra.
export function nuevaEta(bytesTotales, ahora = () => Date.now()) {
  const t0 = ahora();
  let hechos = 0;
  let ficheros = 0;
  return {
    hecho(bytes) {
      hechos += bytes || 0;
      ficheros += 1;
    },
    estimar() {
      const s = (ahora() - t0) / 1000;
      if (!bytesTotales || ficheros < 3 || s < 10 || hechos <= 0) return {};
      const restante = Math.max(0, bytesTotales - hechos);
      const eta = Math.round((s * restante) / hechos);
      return { eta_segundos: eta, eta: textoEta(eta) };
    },
  };
}

function textoEta(seg) {
  if (seg < 60) return 'menos de un minuto (estimación)';
  const min = Math.round(seg / 60);
  if (min < 90) return `unos ${min} min (estimación)`;
  const h = seg / 3600;
  return `unas ${h < 10 ? h.toFixed(1).replace('.', ',') : Math.round(h)} h (estimación)`;
}

export async function indexFolder(opciones = {}) {
  _enCurso += 1;
  try {
    return await indexFolderSinContar(opciones);
  } finally {
    _enCurso -= 1;
    if (_enCurso === 0) {
      setImmediate(() => {
        for (const fn of _alTerminar) {
          try {
            fn();
          } catch {
            /* un observador roto no rompe el indexado */
          }
        }
      });
    }
  }
}

async function indexFolderSinContar({ folders, force = false, onProgress, reconciliarBorrados = false } = {}) {
  // Una sola instancia escribe en el índice (escritor.js): Claude arranca el servidor dos veces
  // y dos indexados a la vez sobre el mismo directorio de datos se pisarían.
  if (!escritor.soyEscritor() && !escritor.adquirir()) {
    throw new Error(
      'Otra instancia de RobinSearch (por ejemplo, otra ventana de Claude) está indexando ahora ' +
        'mismo. Vuelve a intentarlo en unos segundos.',
    );
  }
  // Escritas como las escribe el recorrido de la raíz: «indexar_carpeta» con otra caja u otra
  // forma Unicode metía cada documento dos veces en el registro.
  const roots = folders
    ? (Array.isArray(folders) ? folders : [folders]).map((f) => canonizarRuta(f))
    : config.watchedFolders;
  if (!roots || roots.length === 0) {
    throw new Error('No hay carpetas de expedientes configuradas (ROBIN_FOLDER / ROBIN_FOLDERS).');
  }

  const resumen = {
    carpetas: roots,
    indexados: 0,
    sinCambios: 0,
    sinOcr: 0,
    omitidos: 0,
    apartados: 0,
    eliminados: 0,
    errores: 0,
    fragmentosNuevos: 0,
  };

  // Una carpeta ILEGIBLE no es una carpeta vacía. Si la unidad de red está desconectada o la
  // sesión de Windows ha perdido las credenciales del recurso, `walk` no encuentra nada y
  // antes devolvíamos "0 documentos" — que el abogado lee como "aquí no hay expediente".
  // Se distingue de forma explícita.
  // La app y Claude tienen que saber AL INSTANTE que ha empezado algo: lo que sigue (comprobar
  // las carpetas y contar lo que hay) puede tardar.
  setIndexando({ fase: 'buscando', procesados: 0, total: 0, encontrados: 0, carpeta: roots[0] ?? null, carpetas: roots, ficheroActual: null });
  await respirar();

  // Carpetas que ya no existen: se apartan y se dicen UNA vez, en claro y con lo que hay que
  // hacer, en vez de repetir el mismo ENOENT en cada pasada (correo de Eduardo, 19-sep-2026).
  ausentes.revisar({ forzar: true });

  const accesibles = [];
  for (const root of roots) {
    if (ausentes.estaAusente(root)) {
      (resumen.carpetas_ausentes ??= []).push({
        carpeta: root,
        motivo: 'ya_no_existe',
        detalle:
          'Esta carpeta está configurada pero ya no existe en el ordenador (se ha movido, se ha ' +
          'renombrado o estaba en un disco que no está conectado). RobinSearch la ha apartado: no ' +
          'la vigila ni la indexa, y no volverá a dar error por ella. Vuelve a mirarla sola cada ' +
          'pocos minutos por si reaparece. Para arreglarlo, quítala o corrige su ruta en la app de ' +
          'RobinSearch; lo que hubiera indexado de ella sigue disponible hasta que se quite.',
      });
      continue;
    }
    try {
      fs.readdirSync(root);
      accesibles.push(root);
    } catch (err) {
      const enRed = esRutaDeRed(root);
      const code = err?.code;
      (resumen.carpetas_inaccesibles ??= []).push({
        carpeta: root,
        ubicacion: enRed ? 'red' : 'local',
        motivo:
          code === 'ENOENT' ? 'no_existe'
          : code === 'EACCES' || code === 'EPERM' ? 'sin_permiso'
          : String(code || err),
        detalle: enRed
          ? 'No se puede leer la carpeta de red. Comprueba que la unidad sigue conectada en el ' +
            'Explorador y que la sesión tiene credenciales sobre ese recurso.'
          : 'No se puede leer la carpeta. Comprueba que sigue existiendo y que tienes permiso.',
      });
      log.error('Carpeta de expedientes inaccesible', { carpeta: root, err: String(err) });
    }
  }

  // Contar lo que hay puede llevar decenas de segundos (miles de ficheros, iCloud, un disco
  // externo). Antes se contaba de un tirón y sin soltar el proceso: ni la app ni Claude sabían
  // nada hasta el final (15-sep-2026: ~30 s de pantalla quieta tras elegir carpeta).
  // Ahora se va diciendo cuántos lleva, y se suelta el proceso cada poco para que el aviso
  // salga de verdad.
  const files = [];
  const ilegibles = [];
  const cuenta = nuevaCuentaRecorrido();
  const causas = new Map();
  const buscando = (carpeta) =>
    setIndexando({
      fase: 'buscando',
      procesados: 0,
      total: 0,
      encontrados: files.length,
      carpeta,
      carpetas: accesibles,
      ficheroActual: null,
    });
  for (const root of accesibles) {
    buscando(root);
    await respirar();
    let desde = Date.now();
    for (const f of walk(root, ilegibles, cuenta)) {
      files.push(f);
      if (Date.now() - desde > 150) {
        buscando(root);
        await respirar();
        desde = Date.now();
      }
    }
  }
  if (ilegibles.length) resumen.subcarpetas_ilegibles = ilegibles;
  if (Object.values(cuenta).some((n) => n > 0)) resumen.no_indexables = cuenta;
  setIndexando({ fase: 'indexando', procesados: 0, total: files.length, ficheroActual: null, carpeta: null, carpetas: accesibles });
  await respirar();
  const { orden, bytesPendientes } = await planificar(files, force);
  const eta = nuevaEta(bytesPendientes);
  // Con trabajo de verdad por delante, que los hilos de embedding (si los hay) estén arrancando
  // antes de repartir: decide si los documentos van de uno en uno o varios a la vez.
  if (bytesPendientes > 0 || orden.some((f) => f.stat?.pendiente)) await prepararHilos();

  const enVuelo = new Set();
  let empezados = 0;
  let terminados = 0;
  const procesar = async (abs, stat) => {
    try {
      const r = await indexFile(abs, { force, paralelo: Boolean(cargaEmbedding()) });
      if (r.estado === 'indexado') {
        resumen.indexados += 1;
        resumen.fragmentosNuevos += r.chunks || 0;
        nube.olvidar(abs);
      } else if (r.estado === 'sin_cambios') resumen.sinCambios += 1;
      else if (r.estado === 'sin_ocr') resumen.sinOcr += 1;
      else if (r.estado === 'apartado') resumen.apartados += 1;
      else if (r.estado === 'no_descargado') {
        (resumen.no_indexables ??= nuevaCuentaRecorrido()).no_descargados += 1;
        resumen.omitidos += 1;
      } else resumen.omitidos += 1;
      if (r.reutilizado) resumen.reutilizados = (resumen.reutilizados || 0) + 1;
    } catch (err) {
      const clase = claseDeError(err);
      // Desapareció entre el recorrido y la lectura (el abogado lo movió o lo borró mientras se
      // indexaba): no es un error, es la vida normal de una carpeta de trabajo.
      if (clase === 'desaparecido' && !fs.existsSync(abs)) {
        resumen.omitidos += 1;
        resumen.desaparecidos = (resumen.desaparecidos || 0) + 1;
        return;
      }
      // La nube no entrega el contenido: se cuenta como «sin descargar», no como fallo nuestro.
      // Y se apunta para pedir la descarga y volver a mirar: que no lo entregue HOY no puede
      // dejar al abogado sin ese documento para siempre (nube.js).
      if (clase === 'nube') {
        nube.apuntar(abs, 'sin_descargar');
        (resumen.no_indexables ??= nuevaCuentaRecorrido()).no_descargados += 1;
        resumen.omitidos += 1;
        return;
      }
      // Vacío o a ceros. En Windows es lo único que se ve de un fichero de OneDrive que aún no ha
      // bajado (allí `stat` no distingue el marcador): 72 en un solo despacho el 21-sep. Se trata
      // igual —descarga y reintento—, y si después de un día sigue a cero, es que está vacío.
      if (err?.code === 'ROBIN_FICHERO_VACIO') {
        nube.apuntar(abs, 'vacio');
        (resumen.no_indexables ??= nuevaCuentaRecorrido()).no_descargados += 1;
        resumen.omitidos += 1;
        return;
      }
      // Protegido con contraseña o dañado sin arreglo posible (ya se ha intentado rescatar su
      // texto). No es un error DE RobinSearch, pero tampoco se calla: va a `no_indexables`, que
      // `estado_servidor` explica uno a uno con lo que el abogado puede hacer. «errores» queda
      // para lo que sí hay que arreglar aquí.
      if (err?.code === 'ROBIN_FICHERO_PDF_PROTEGIDO') {
        (resumen.no_indexables ??= nuevaCuentaRecorrido()).protegidos += 1;
        resumen.omitidos += 1;
        return;
      }
      if (String(err?.code || '').startsWith('ROBIN_FICHERO_')) {
        (resumen.no_indexables ??= nuevaCuentaRecorrido()).danados += 1;
        resumen.omitidos += 1;
        log.warn('Documento que no se ha podido leer', {
          fichero: logicalPath(abs), ext: extensionDe(abs), bytes: stat?.size ?? null, code: String(err.code),
        });
        return;
      }
      // Disco lleno: se corta la pasada entera. Seguir con los otros 900 ficheros solo alarga el
      // problema y llena el disco un poco más (el OCR escribe temporales).
      if (clase === 'disco') {
        // Bandera y no `throw`: quien llama a `procesar` no siempre está esperando su promesa, y
        // un rechazo suelto dispararía un aviso técnico falso. El bucle lo mira y corta.
        resumen.disco_lleno = true;
        log.error('Disco lleno durante el indexado: se corta la pasada', { code: String(err?.code) });
        return;
      }
      resumen.errores += 1;
      // La CAUSA se agrega aquí, no solo en el log: el abogado no va a abrir un fichero de
      // log, y sin causa un "errores: 680" es indiagnosticable desde el chat.
      const causa = normalizarCausa(err);
      const acc = causas.get(causa) || { causa, ficheros: 0, ejemplo: null };
      acc.ficheros += 1;
      if (!acc.ejemplo) acc.ejemplo = logicalPath(abs);
      causas.set(causa, acc);
      // Extensión y tamaño (nunca el nombre) llegan al aviso técnico: sin ellos, «6 ficheros con
      // error» no decía si eran .docx de Word abierto, fotos o ficheros sin descargar de la nube.
      log.error('Error indexando fichero', {
        fichero: logicalPath(abs),
        ext: extensionDe(abs),
        bytes: stat?.size ?? null,
        code: err?.code ? String(err.code) : undefined,
        err: String(err),
      });
    } finally {
      terminados += 1;
      if (stat?.pendiente) eta.hecho(stat.size);
    }
    if (onProgress) onProgress(state.progreso, resumen);
  };

  try {
    let ultimoRespiro = Date.now();
    for (const { abs, stat } of orden) {
      // Con hilos de embedding, varios documentos a la vez; pero sin acumular más trabajo del que
      // los hilos pueden despachar (memoria acotada: textos y vectores esperando).
      while (enVuelo.size && hayQueEsperar(enVuelo.size)) await Promise.race(enVuelo);
      // Otra instancia se quedó con el índice mientras esta estaba parada: se corta aquí, sin
      // una escritura más (escritor.js).
      if (!escritor.soyEscritor()) throw errorSinCerrojo();
      // Disco lleno: se para aquí. Seguir con los ficheros que quedan solo llena el disco un poco
      // más (el OCR escribe temporales) y llena el informe de errores que son todos el mismo.
      if (resumen.disco_lleno) throw errorDiscoLleno();
      empezados += 1;
      // Por setIndexando y no asignando `state.progreso` a pelo: así el cambio
      // llega a los observadores (canal de control -> app de escritorio). El
      // efecto sobre el estado es idéntico; lo que se gana es el aviso.
      setIndexando({
        fase: 'indexando',
        // Con documentos en paralelo, «procesados» no puede adelantarse a lo terminado más de lo
        // que hay en marcha; en serie es lo de siempre (el que se está procesando cuenta).
        procesados: Math.min(empezados, terminados + 1),
        total: files.length,
        ficheroActual: logicalPath(abs),
        carpeta: rootForPath(abs)?.path ?? null,
        carpetas: accesibles,
        ...eta.estimar(),
      });
      // Miles de ficheros sin cambios se despachan sin esperar a nada: sin soltar el proceso de
      // vez en cuando, el canal de la app se quedaría mudo hasta el final.
      if (Date.now() - ultimoRespiro > 150) {
        await respirar();
        ultimoRespiro = Date.now();
      }
      const p = procesar(abs, stat).finally(() => enVuelo.delete(p));
      enVuelo.add(p);
      if (!cargaEmbedding()) await p;
    }
    await Promise.all(enVuelo);
    if (resumen.disco_lleno) throw errorDiscoLleno();

    // Documentos que estaban indexados y ya no están en disco. En carpeta local los retira el
    // watcher al vuelo; en una carpeta de RED no hay evento fiable, así que el re-escaneo
    // periódico también tiene que limpiarlos — o el abogado seguiría encontrando en la
    // búsqueda un escrito que un compañero ya retiró del expediente.
    if (reconciliarBorrados && ilegibles.length === 0) {
      const presentes = new Set(files);
      for (const [abs] of registry.entries()) {
        if (presentes.has(abs)) continue;
        const dentro = accesibles.some((r) => rutas.dentroDe(abs, r));
        if (!dentro) continue;
        try {
          await removeFilePath(abs);
          resumen.eliminados += 1;
        } catch (err) {
          log.error('Error retirando del índice un fichero borrado', { fichero: abs, err: String(err) });
        }
      }
    }

    if (causas.size) {
      resumen.errores_por_causa = [...causas.values()]
        .sort((a, b) => b.ficheros - a.ficheros)
        .slice(0, 5);
    }

    // Un indexado con TODOS los ficheros en error no es un indexado "activo". Se refleja en el
    // estado del servidor, en lugar de dejarlo en 'activo' con 0 documentos —que se lee como
    // "aquí no hay nada"— y se limpia el error solo cuando la pasada sale limpia de verdad.
    if (resumen.errores > 0) {
      const top = resumen.errores_por_causa?.[0];
      setError(
        `El último indexado falló en ${resumen.errores} de ${files.length} fichero(s)` +
          (top ? `. Causa principal (${top.ficheros}): ${top.causa}` : '.'),
      );
    } else if (!resumen.carpetas_inaccesibles && !resumen.subcarpetas_ilegibles) {
      // Una carpeta APARTADA por no existir no deja el servidor en error: ya está dicha en claro
      // en `carpetas_ausentes` y no hay nada roto que arreglar en RobinSearch.
      clearError();
    }
    setActivo();
  } catch (err) {
    // Lo que ya estaba en marcha termina (sin escribir si esta instancia ya no escribe:
    // escritor.confirmar()) antes de dar el indexado por cortado.
    await Promise.allSettled(enVuelo);
    // Pasar a lector no es un fallo del indexado: lo sigue la otra instancia.
    if (err?.code === 'ROBIN_SIN_CERROJO') setActivo();
    else setError(err);
    setUltimoIndexado(resumen);
    throw err;
  }

  setUltimoIndexado(resumen);
  log[resumen.errores > 0 ? 'error' : 'info']('Indexado completado', resumen);
  return resumen;
}

export default { indexFile, removeFilePath, indexFolder };
