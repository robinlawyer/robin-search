// Vigila la carpeta de expedientes y re-indexa de forma incremental al añadir, modificar
// o borrar ficheros (RF-02.7 / US-04). Serializa el trabajo en una cola para no solapar
// embeddings, y aplica debounce para agrupar copias masivas de ficheros.

import chokidar from 'chokidar';
import path from 'node:path';
import { config, SUPPORTED_EXTENSIONS } from '../config.js';
import { log } from '../logger.js';
import { setActivo, setIndexando } from '../state.js';
import { indexFile, removeFilePath } from '../indexer/indexer.js';

let _watcher = null;
const pending = new Map(); // relPath → { absPath, tipo: 'index'|'remove' }
let flushTimer = null;
let draining = false;
const DEBOUNCE_MS = 1500;

function isSupported(p) {
  return SUPPORTED_EXTENSIONS.has(path.extname(p).toLowerCase());
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(drain, DEBOUNCE_MS);
}

async function drain() {
  if (draining) {
    scheduleFlush();
    return;
  }
  draining = true;
  try {
    while (pending.size > 0) {
      const [relPath, job] = pending.entries().next().value;
      pending.delete(relPath);
      setIndexando({ procesados: 0, total: 1, ficheroActual: relPath });
      try {
        if (job.tipo === 'remove') await removeFilePath(job.absPath);
        else await indexFile(job.absPath);
        log.info('Watcher: re-indexado', { relPath, tipo: job.tipo });
      } catch (err) {
        log.error('Watcher: error procesando cambio', { relPath, err: String(err) });
      }
    }
  } finally {
    draining = false;
    setActivo();
  }
}

function enqueue(absPath, tipo) {
  const relPath = path.relative(config.watchedFolder, absPath);
  pending.set(relPath, { absPath, tipo });
  scheduleFlush();
}

export function startWatcher() {
  if (!config.watchedFolder) {
    log.warn('Watcher no iniciado: sin carpeta configurada');
    return null;
  }
  if (_watcher) return _watcher;

  _watcher = chokidar.watch(config.watchedFolder, {
    ignoreInitial: true, // el indexado inicial lo hace indexFolder en el arranque
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
    ignored: (p) => p.includes(config.dataDir) || path.basename(p).startsWith('.'),
  });

  _watcher
    .on('add', (p) => isSupported(p) && enqueue(p, 'index'))
    .on('change', (p) => isSupported(p) && enqueue(p, 'index'))
    .on('unlink', (p) => isSupported(p) && enqueue(p, 'remove'))
    .on('error', (err) => log.error('Watcher error', { err: String(err) }));

  log.info('Watcher activo', { carpeta: config.watchedFolder });
  return _watcher;
}

export async function stopWatcher() {
  if (_watcher) {
    await _watcher.close();
    _watcher = null;
  }
}

export default { startWatcher, stopWatcher };
