// Orquestador del indexado: recorre las carpetas vigiladas (multi-raíz), decide qué ficheros
// procesar (incremental), extrae texto, trocea, genera embeddings locales y los guarda en el
// índice vectorial.
//
// Pipeline por fichero:
//   extractFile → chunkPages → embedPassages (e5-small local) → store.upsertChunks → registry.set

import fs from 'node:fs';
import path from 'node:path';
import {
  config,
  SUPPORTED_EXTENSIONS,
  logicalPath,
  rootForPath,
  expedienteForLogicalPath,
  limiteBytes,
  MAX_FRAGMENTOS_POR_DOCUMENTO,
} from '../config.js';
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
import { embedPassages } from '../embedder/embedder.js';
import * as store from '../search/store.js';
import * as registry from './registry.js';
import * as cuarentena from './cuarentena.js';
import * as diagnostico from '../diagnostico.js';
import * as escritor from '../escritor.js';

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

function errorSinCerrojo() {
  return Object.assign(new Error('Otra instancia de RobinSearch ha tomado el índice: este indexado se deja a ella.'), {
    code: 'ROBIN_SIN_CERROJO',
  });
}

function isSupported(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// Recorre recursivamente una carpeta y devuelve rutas absolutas de ficheros soportados.
// Ignora directorios ocultos y el propio directorio de datos por si estuviera anidado.
function* walk(dir, ilegibles = null) {
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
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (full === config.dataDir) continue;
    if (entry.isDirectory()) {
      yield* walk(full, ilegibles);
    } else if (entry.isFile() && isSupported(full)) {
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
export async function indexFile(absPath, { force = false } = {}) {
  const abs = path.resolve(absPath);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return indexFileSinMarca(abs, { force });
  }
  if (!force && !registry.isStale(abs, stat)) {
    return { ruta: logicalPath(abs), estado: 'sin_cambios' };
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
  diagnostico.marcarFase('indexando', { fichero: abs, ext, bytes: stat.size });
  // Solo pruebas automáticas: simula un lector que tumba el proceso (como un OOM).
  if (process.env.ROBIN_PRUEBA_CAER_EN && path.basename(abs) === process.env.ROBIN_PRUEBA_CAER_EN) {
    process.kill(process.pid, 'SIGKILL');
  }
  try {
    return await indexFileSinMarca(abs, { force });
  } finally {
    diagnostico.finFase();
  }
}

async function indexFileSinMarca(absPath, { force = false } = {}) {
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

  const docId = registry.docIdForAbsPath(abs);

  // NO se borra lo indexado antes de extraer (hasta la 1.4.7 sí): si la extracción o el embedding
  // fallan en un reindexado —fichero abierto en Word, unidad de red que se cae—, el documento
  // DESAPARECÍA del índice. Ahora la versión anterior sigue buscable hasta que la nueva está
  // lista, y se sustituye de una vez (store.reemplazarDoc). Como el registro no se actualiza, el
  // fichero sigue «cambiado» y se reintenta en la siguiente pasada.
  const { pages, sinOcr, numPages } = await extractFile(abs, {
    maxPages: config.maxPagesPerFile,
  });

  const expediente = expedienteForLogicalPath(rutaLogica);

  const baseEntry = {
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
    numPages,
  };

  if (sinOcr) {
    if (!escritor.confirmar()) return { ruta: rutaLogica, estado: 'omitido', motivo: 'solo_lectura' };
    await store.deleteByDoc(docId);
    state.ficherosSinOcr.add(rutaLogica);
    registry.set(abs, { ...baseEntry, numChunks: 0, sinOcr: true });
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
    registry.set(abs, { ...baseEntry, numChunks: 0, sinOcr: false });
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
  registry.set(abs, { ...baseEntry, numChunks: chunks.length, sinOcr: false });

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
  const roots = folders
    ? (Array.isArray(folders) ? folders : [folders]).map((f) => path.resolve(f))
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

  const accesibles = [];
  for (const root of roots) {
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
    for (const f of walk(root, ilegibles)) {
      files.push(f);
      if (Date.now() - desde > 150) {
        buscando(root);
        await respirar();
        desde = Date.now();
      }
    }
  }
  if (ilegibles.length) resumen.subcarpetas_ilegibles = ilegibles;
  setIndexando({ fase: 'indexando', procesados: 0, total: files.length, ficheroActual: null, carpeta: null, carpetas: accesibles });

  try {
    let i = 0;
    let ultimoRespiro = Date.now();
    for (const abs of files) {
      // Otra instancia se quedó con el índice mientras esta estaba parada: se corta aquí, sin
      // una escritura más (escritor.js).
      if (!escritor.soyEscritor()) throw errorSinCerrojo();
      i += 1;
      // Por setIndexando y no asignando `state.progreso` a pelo: así el cambio
      // llega a los observadores (canal de control -> app de escritorio). El
      // efecto sobre el estado es idéntico; lo que se gana es el aviso.
      setIndexando({
        fase: 'indexando',
        procesados: i,
        total: files.length,
        ficheroActual: logicalPath(abs),
        carpeta: rootForPath(abs)?.path ?? null,
        carpetas: accesibles,
      });
      // Miles de ficheros sin cambios se despachan sin esperar a nada: sin soltar el proceso de
      // vez en cuando, el canal de la app se quedaría mudo hasta el final.
      if (Date.now() - ultimoRespiro > 150) {
        await respirar();
        ultimoRespiro = Date.now();
      }
      try {
        const r = await indexFile(abs, { force });
        if (r.estado === 'indexado') {
          resumen.indexados += 1;
          resumen.fragmentosNuevos += r.chunks || 0;
        } else if (r.estado === 'sin_cambios') resumen.sinCambios += 1;
        else if (r.estado === 'sin_ocr') resumen.sinOcr += 1;
        else if (r.estado === 'apartado') resumen.apartados += 1;
        else resumen.omitidos += 1;
      } catch (err) {
        resumen.errores += 1;
        // La CAUSA se agrega aquí, no solo en el log: el abogado no va a abrir un fichero de
        // log, y sin causa un "errores: 680" es indiagnosticable desde el chat.
        const causa = normalizarCausa(err);
        const acc = causas.get(causa) || { causa, ficheros: 0, ejemplo: null };
        acc.ficheros += 1;
        if (!acc.ejemplo) acc.ejemplo = logicalPath(abs);
        causas.set(causa, acc);
        log.error('Error indexando fichero', { fichero: logicalPath(abs), err: String(err) });
      }
      if (onProgress) onProgress(state.progreso, resumen);
    }

    // Documentos que estaban indexados y ya no están en disco. En carpeta local los retira el
    // watcher al vuelo; en una carpeta de RED no hay evento fiable, así que el re-escaneo
    // periódico también tiene que limpiarlos — o el abogado seguiría encontrando en la
    // búsqueda un escrito que un compañero ya retiró del expediente.
    if (reconciliarBorrados && ilegibles.length === 0) {
      const presentes = new Set(files);
      for (const [abs] of registry.entries()) {
        if (presentes.has(abs)) continue;
        const dentro = accesibles.some((r) => abs === r || abs.startsWith(r + path.sep));
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
      clearError();
    }
    setActivo();
  } catch (err) {
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
