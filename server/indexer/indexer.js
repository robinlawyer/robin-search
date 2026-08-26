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
} from '../config.js';
import { log } from '../logger.js';
import { state, setIndexando, setActivo, setError } from '../state.js';
import { extractFile } from './extract.js';
import { chunkPages } from './chunk.js';
import { embedPassages } from '../embedder/embedder.js';
import * as store from '../search/store.js';
import * as registry from './registry.js';

function isSupported(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// Recorre recursivamente una carpeta y devuelve rutas absolutas de ficheros soportados.
// Ignora directorios ocultos y el propio directorio de datos por si estuviera anidado.
function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    log.warn('No se pudo leer directorio', { dir, err: String(err) });
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (full === config.dataDir) continue;
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && isSupported(full)) {
      yield full;
    }
  }
}

// Indexa (o re-indexa) un único fichero. Devuelve el resumen de lo procesado.
export async function indexFile(absPath, { force = false } = {}) {
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

  // Si ya había chunks de este documento (fichero modificado), los borramos antes de reinsertar.
  await store.deleteByDoc(docId);

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
    state.ficherosSinOcr.add(rutaLogica);
    registry.set(abs, { ...baseEntry, numChunks: 0, sinOcr: true });
    log.warn('PDF sin OCR (no legible), omitido del índice', { ruta: rutaLogica });
    return { ruta: rutaLogica, estado: 'sin_ocr' };
  }

  state.ficherosSinOcr.delete(rutaLogica);

  const chunks = chunkPages(pages, {
    chunkSizeTokens: config.chunkSizeTokens,
    chunkOverlapTokens: config.chunkOverlapTokens,
  });

  if (chunks.length === 0) {
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

  await store.upsertChunks(docId, items);
  registry.set(abs, { ...baseEntry, numChunks: chunks.length, sinOcr: false });

  return { ruta: rutaLogica, estado: 'indexado', chunks: chunks.length };
}

// Elimina un fichero del índice (invocado por el watcher al borrarse un fichero).
export async function removeFilePath(absPath) {
  const abs = path.resolve(absPath);
  const rutaLogica = logicalPath(abs);
  const entry = registry.remove(abs);
  state.ficherosSinOcr.delete(rutaLogica);
  if (entry) await store.deleteByDoc(entry.docId);
  return { ruta: rutaLogica, estado: 'eliminado' };
}

// Indexa una o varias carpetas (incremental salvo `force`). Por defecto, todas las raíces
// configuradas. Actualiza el estado runtime.
export async function indexFolder({ folders, force = false, onProgress } = {}) {
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
    errores: 0,
    fragmentosNuevos: 0,
  };

  const files = [];
  for (const root of roots) for (const f of walk(root)) files.push(f);
  setIndexando({ procesados: 0, total: files.length, ficheroActual: null });

  try {
    let i = 0;
    for (const abs of files) {
      i += 1;
      state.progreso = { procesados: i, total: files.length, ficheroActual: logicalPath(abs) };
      try {
        const r = await indexFile(abs, { force });
        if (r.estado === 'indexado') {
          resumen.indexados += 1;
          resumen.fragmentosNuevos += r.chunks || 0;
        } else if (r.estado === 'sin_cambios') resumen.sinCambios += 1;
        else if (r.estado === 'sin_ocr') resumen.sinOcr += 1;
        else resumen.omitidos += 1;
      } catch (err) {
        resumen.errores += 1;
        log.error('Error indexando fichero', { fichero: logicalPath(abs), err: String(err) });
      }
      if (onProgress) onProgress(state.progreso, resumen);
    }
    setActivo();
  } catch (err) {
    setError(err);
    throw err;
  }

  log.info('Indexado completado', resumen);
  return resumen;
}

export default { indexFile, removeFilePath, indexFolder };
