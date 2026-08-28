// Vigila las carpetas de expedientes y re-indexa de forma incremental al añadir, modificar
// o borrar ficheros (RF-02.7 / US-04).
//
// Hay DOS mecanismos, según dónde viva la carpeta:
//
//   · Carpeta LOCAL (disco del abogado) → eventos del sistema de ficheros (chokidar). El SO
//     avisa al instante; se agrupan con debounce para absorber copias masivas.
//
//   · Carpeta de RED (unidad mapeada Z:\ o montaje SMB del servidor del despacho) → RE-ESCANEO
//     PERIÓDICO incremental. Sobre SMB las notificaciones de cambio no son fiables: cuando un
//     compañero deja un escrito nuevo en el expediente desde SU equipo, el evento llega tarde,
//     incompleto o no llega. Fiarse de ellos significaría que el abogado busca creyendo tener
//     el expediente entero y le falta el último documento — el peor fallo posible aquí. El
//     re-escaneo compara tamaño y fecha contra el registro, así que solo re-indexa lo que ha
//     cambiado: sobre una carpeta ya indexada es un recorrido de directorios, nada más.
//
// Todo el trabajo (eventos y re-escaneos) se serializa en una única cadena para que dos
// mecanismos no escriban a la vez en el registro ni solapen embeddings.

import chokidar from 'chokidar';
import path from 'node:path';
import { config, SUPPORTED_EXTENSIONS, logicalPath } from '../config.js';
import { esRutaDeRed } from '../net.js';
import { log } from '../logger.js';
import { setActivo, setIndexando } from '../state.js';
import { indexFile, removeFilePath, indexFolder } from '../indexer/indexer.js';

let _watcher = null;
let _rescanTimer = null;
const pending = new Map(); // absPath → { absPath, tipo: 'index'|'remove' }
let flushTimer = null;
let draining = false;
const DEBOUNCE_MS = 1500;

// Cadena única de trabajo: eventos del watcher y re-escaneos de red nunca corren a la vez.
let _cadena = Promise.resolve();
function serializar(fn) {
  const p = _cadena.then(fn, fn);
  _cadena = p.then(
    () => {},
    () => {},
  );
  return p;
}

function isSupported(p) {
  return SUPPORTED_EXTENSIONS.has(path.extname(p).toLowerCase());
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => serializar(drain), DEBOUNCE_MS);
}

async function drain() {
  if (draining) {
    scheduleFlush();
    return;
  }
  draining = true;
  try {
    while (pending.size > 0) {
      const [absPath, job] = pending.entries().next().value;
      pending.delete(absPath);
      const ruta = logicalPath(absPath);
      setIndexando({ procesados: 0, total: 1, ficheroActual: ruta });
      try {
        if (job.tipo === 'remove') await removeFilePath(absPath);
        else await indexFile(absPath);
        log.info('Watcher: re-indexado', { ruta, tipo: job.tipo });
      } catch (err) {
        log.error('Watcher: error procesando cambio', { ruta, err: String(err) });
      }
    }
  } finally {
    draining = false;
    setActivo();
  }
}

function enqueue(absPath, tipo) {
  pending.set(path.resolve(absPath), { tipo });
  scheduleFlush();
}

// Carpetas de red configuradas (las que necesitan re-escaneo en vez de eventos).
export function carpetasDeRed() {
  return (config.watchedFolders || []).filter((p) => esRutaDeRed(p));
}

// Re-escaneo incremental de una o varias carpetas. Reconcilia también los borrados, porque
// en red no hay evento de borrado en el que confiar. Serializado con el resto del trabajo.
export function reescanear(folders, { motivo = 'periodico' } = {}) {
  const lista = (Array.isArray(folders) ? folders : [folders]).filter(Boolean);
  if (lista.length === 0) return Promise.resolve(null);
  return serializar(async () => {
    try {
      const resumen = await indexFolder({ folders: lista, reconciliarBorrados: true });
      const huboCambios =
        resumen.indexados > 0 || resumen.eliminados > 0 || resumen.carpetas_inaccesibles;
      if (huboCambios) {
        log.info('Re-escaneo de carpeta de red', {
          motivo,
          carpetas: lista,
          indexados: resumen.indexados,
          eliminados: resumen.eliminados,
          inaccesibles: resumen.carpetas_inaccesibles?.length ?? 0,
        });
      }
      return resumen;
    } catch (err) {
      log.error('Fallo en el re-escaneo de carpeta de red', { carpetas: lista, err: String(err) });
      return null;
    }
  });
}

export function startWatcher() {
  if (!config.watchedFolders || config.watchedFolders.length === 0) {
    log.warn('Watcher no iniciado: sin carpetas configuradas');
    return null;
  }
  if (_watcher || _rescanTimer) return _watcher;

  const red = carpetasDeRed();
  const locales = config.watchedFolders.filter((p) => !red.includes(p));

  if (locales.length > 0) {
    _watcher = chokidar.watch(locales, {
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

    log.info('Watcher activo (carpetas locales)', { carpetas: locales });
  }

  if (red.length > 0) {
    if (config.rescanRedMs > 0) {
      _rescanTimer = setInterval(() => reescanear(red, { motivo: 'periodico' }), config.rescanRedMs);
      _rescanTimer.unref?.(); // no debe mantener vivo el proceso por sí solo
      log.info('Re-escaneo periódico activo (carpetas de red)', {
        carpetas: red,
        cada_segundos: Math.round(config.rescanRedMs / 1000),
      });
    } else {
      log.info('Carpetas de red sin re-escaneo periódico (ROBIN_RESCAN_MS=0)', { carpetas: red });
    }
  }

  return _watcher;
}

export async function stopWatcher() {
  if (_rescanTimer) {
    clearInterval(_rescanTimer);
    _rescanTimer = null;
  }
  if (_watcher) {
    await _watcher.close();
    _watcher = null;
  }
}

export default { startWatcher, stopWatcher, reescanear, carpetasDeRed };
