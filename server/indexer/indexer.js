// Orquestador del indexado: recorre la carpeta, decide qué ficheros procesar (incremental),
// extrae texto, trocea, genera embeddings locales y los guarda en el índice vectorial.
//
// Pipeline por fichero:
//   extractFile → chunkPages → embedPassages (e5-small local) → store.upsertChunks → registry.set

import fs from 'node:fs';
import path from 'node:path';
import { config, SUPPORTED_EXTENSIONS } from '../config.js';
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

function relOf(absPath, folder) {
  return path.relative(folder, absPath);
}

// Recorre recursivamente la carpeta y devuelve rutas absolutas de ficheros soportados.
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
export async function indexFile(absPath, { folder = config.watchedFolder, force = false } = {}) {
  const relPath = relOf(absPath, folder);
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return { relPath, estado: 'omitido', motivo: 'no_existe' };
  }

  if (!force && !registry.isStale(relPath, stat)) {
    return { relPath, estado: 'sin_cambios' };
  }

  const docId = registry.docIdForRelPath(relPath);

  // Si ya había chunks de este documento (fichero modificado), los borramos antes de reinsertar.
  await store.deleteByDoc(docId);

  const { pages, sinOcr, numPages } = await extractFile(absPath, {
    maxPages: config.maxPagesPerFile,
  });

  if (sinOcr) {
    state.ficherosSinOcr.add(relPath);
    registry.set(relPath, {
      docId,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      indexedAt: new Date().toISOString(),
      numChunks: 0,
      numPages,
      sinOcr: true,
    });
    log.warn('PDF sin OCR detectado, omitido del índice', { relPath });
    return { relPath, estado: 'sin_ocr' };
  }

  state.ficherosSinOcr.delete(relPath);

  const chunks = chunkPages(pages, {
    chunkSizeTokens: config.chunkSizeTokens,
    chunkOverlapTokens: config.chunkOverlapTokens,
  });

  if (chunks.length === 0) {
    registry.set(relPath, {
      docId,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      indexedAt: new Date().toISOString(),
      numChunks: 0,
      numPages,
      sinOcr: false,
    });
    return { relPath, estado: 'vacio' };
  }

  const vectors = await embedPassages(chunks.map((c) => c.text));

  const fichero = path.basename(relPath);
  const fechaModificacion = stat.mtime.toISOString();
  const items = chunks.map((c, i) => ({
    chunkId: c.chunkId,
    vector: vectors[i],
    metadata: {
      texto: c.text,
      fichero,
      rutaRelativa: relPath,
      pagina: c.page,
      fechaModificacion,
    },
  }));

  await store.upsertChunks(docId, items);

  registry.set(relPath, {
    docId,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    indexedAt: new Date().toISOString(),
    numChunks: chunks.length,
    numPages,
    sinOcr: false,
  });

  return { relPath, estado: 'indexado', chunks: chunks.length };
}

// Elimina un fichero del índice (invocado por el watcher al borrarse un fichero).
export async function removeFilePath(absPath, { folder = config.watchedFolder } = {}) {
  const relPath = relOf(absPath, folder);
  const entry = registry.remove(relPath);
  state.ficherosSinOcr.delete(relPath);
  if (entry) await store.deleteByDoc(entry.docId);
  return { relPath, estado: 'eliminado' };
}

// Indexa la carpeta completa (incremental salvo `force`). Actualiza el estado runtime.
export async function indexFolder({ folder = config.watchedFolder, force = false, onProgress } = {}) {
  if (!folder) throw new Error('No hay carpeta de expedientes configurada (ROBIN_FOLDER).');
  const resumen = {
    carpeta: folder,
    indexados: 0,
    sinCambios: 0,
    sinOcr: 0,
    omitidos: 0,
    errores: 0,
    fragmentosNuevos: 0,
  };

  const files = [...walk(folder)];
  setIndexando({ procesados: 0, total: files.length, ficheroActual: null });

  try {
    let i = 0;
    for (const abs of files) {
      i += 1;
      state.progreso = { procesados: i, total: files.length, ficheroActual: relOf(abs, folder) };
      try {
        const r = await indexFile(abs, { folder, force });
        if (r.estado === 'indexado') {
          resumen.indexados += 1;
          resumen.fragmentosNuevos += r.chunks || 0;
        } else if (r.estado === 'sin_cambios') resumen.sinCambios += 1;
        else if (r.estado === 'sin_ocr') resumen.sinOcr += 1;
        else resumen.omitidos += 1;
      } catch (err) {
        resumen.errores += 1;
        log.error('Error indexando fichero', { fichero: relOf(abs, folder), err: String(err) });
      }
      if (onProgress) onProgress(state.progreso, resumen);
    }
    setActivo();
  } catch (err) {
    setError(err);
    throw err;
  }

  log.info('Indexado de carpeta completado', resumen);
  return resumen;
}

export default { indexFile, removeFilePath, indexFolder };
