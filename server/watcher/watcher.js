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
import fs from 'node:fs';
import path from 'node:path';
import { config, logicalPath, esExtensionSoportada, canonizarRuta, rootForPath } from '../config.js';
import { rutas } from '../rutas.js';
import * as registry from '../indexer/registry.js';
import { esRutaDeRed } from '../net.js';
import { log } from '../logger.js';
import { setActivo, setIndexando, setError, clearError } from '../state.js';
import { indexFile, removeFilePath, indexFolder, normalizarCausa } from '../indexer/indexer.js';
import * as diagnostico from '../diagnostico.js';
import * as ausentes from '../carpetas-ausentes.js';

let _watcher = null;
let _rescanTimer = null;
let _nativos = []; // fs.watch recursivos (Windows y macOS)
let _rescanLocalTimer = null; // re-escaneo de carpetas locales cuando no se pueden vigilar
let _redSeguridadTimer = null; // repaso periódico de las carpetas locales SÍ vigiladas (ver abajo)
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
  return esExtensionSoportada(p);
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => serializar(drain), DEBOUNCE_MS);
}

// Ficheros que un evento dio por borrados pero que SIGUEN en disco: un error de lectura no es
// un borrado. Ver `existeEnDisco` y `filtrarBorradosFalsos`.
const UMBRAL_BORRADO_MASIVO = Number(process.env.ROBIN_UMBRAL_BORRADO_MASIVO) || 25;

// ¿Existe el fichero AHORA mismo? Tres respuestas, no dos: `true` (está), `false` (no está de
// verdad, ENOENT) y `null` (no se sabe: la unidad no contesta, permiso denegado, disco lleno).
// El «no se sabe» es lo que el 19-sep-2026 se tomó por borrado: en el mismo tramo de ENOSPC y
// ETIMEDOUT del Mac de Eduardo, el vigilante disparó ~90 «eliminado» en 24 ms sobre ficheros que
// estaban donde siempre, y el expediente se quedó en 43 documentos de 1.150.
export function existeEnDisco(abs) {
  try {
    fs.statSync(abs);
    return true;
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return false;
    return null;
  }
}

// Antes de retirar del índice: se comprueba en disco uno a uno. Lo que sigue estando se vuelve a
// indexar (por si el evento era un cambio) y lo que no se sabe se deja como está — el índice se
// queda algo viejo, que es infinitamente mejor que vaciarle el expediente al abogado.
// Y si el lote de borrados es MASIVO y casi ninguno resulta ser un borrado real, se descarta
// entero y se avisa: eso no es el abogado vaciando una carpeta, es el disco portándose mal.
function filtrarBorradosFalsos(lote) {
  const borrados = lote.filter(([, j]) => j.tipo === 'remove');
  if (!borrados.length) return { lote, descartados: 0, dudosos: 0 };
  let siguen = 0;
  let dudosos = 0;
  const salida = [];
  for (const [abs, job] of lote) {
    if (job.tipo !== 'remove') {
      salida.push([abs, job]);
      continue;
    }
    const existe = existeEnDisco(abs);
    if (existe === true) {
      siguen += 1;
      salida.push([abs, { tipo: 'index' }]); // estaba: no es un borrado, es un cambio
    } else if (existe === null) {
      dudosos += 1; // no se sabe: ni se retira ni se reindexa
    } else {
      salida.push([abs, job]);
    }
  }
  const reales = salida.filter(([, j]) => j.tipo === 'remove').length;
  if (borrados.length >= UMBRAL_BORRADO_MASIVO && reales > 0 && siguen + dudosos >= borrados.length / 2) {
    log.error('Borrado masivo NO creíble: la mayoría de los ficheros sigue en disco; no se retira ninguno', {
      borrados: borrados.length,
      siguen_en_disco: siguen,
      sin_respuesta: dudosos,
    });
    diagnostico
      .informar('borrado_masivo_descartado', {
        fase: 'vigilando',
        causa: `${borrados.length} borrados en un lote con ${siguen} ficheros todavía en disco y ${dudosos} sin respuesta: se descarta el lote`,
      })
      .catch(() => {});
    return { lote: salida.filter(([, j]) => j.tipo !== 'remove'), descartados: reales, dudosos };
  }
  if (siguen || dudosos) {
    log.warn('Borrados descartados: el fichero sigue en disco o no contesta', { siguen_en_disco: siguen, sin_respuesta: dudosos });
  }
  return { lote: salida, descartados: 0, dudosos };
}

async function drain() {
  if (draining) {
    scheduleFlush();
    return;
  }
  draining = true;
  // El watcher tenía el mismo punto ciego que el indexado: registraba el fallo en el log y
  // volvía a 'activo'. Un watcher que falla en TODOS los cambios (motor caído, disco lleno)
  // dejaba el expediente congelado en silencio.
  let fallos = 0;
  let hechos = 0;
  let ultimaCausa = null;
  try {
    while (pending.size > 0) {
      // El lote entero pasa por la comprobación en disco ANTES de tocar el índice. Se hace una
      // vez por LOTE y no por fichero: con 1.000 cambios en cola, comprobarlo en cada vuelta
      // serían un millón de `stat` sobre una carpeta que ya está teniendo un mal día.
      if (pending.size && [...pending.values()].some((j) => j.tipo === 'remove')) {
        const { lote } = filtrarBorradosFalsos([...pending]);
        pending.clear();
        for (const [a, j] of lote) pending.set(a, j);
        if (pending.size === 0) break;
      }
      const [absPath, job] = pending.entries().next().value;
      pending.delete(absPath);
      const ruta = logicalPath(absPath);
      setIndexando({ procesados: 0, total: 1, ficheroActual: ruta });
      try {
        if (job.tipo === 'remove') await removeFilePath(absPath);
        else await indexFile(absPath);
        hechos += 1;
        log.info('Watcher: re-indexado', { ruta, tipo: job.tipo });
      } catch (err) {
        fallos += 1;
        ultimaCausa = normalizarCausa(err);
        log.error('Watcher: error procesando cambio', { ruta, err: String(err) });
      }
    }
  } finally {
    draining = false;
    if (fallos > 0) {
      setError(`El watcher no pudo procesar ${fallos} cambio(s) del expediente. Causa: ${ultimaCausa}`);
    } else if (hechos > 0) {
      clearError();
    }
    setActivo();
  }
}

function enqueue(absPath, tipo) {
  // Escrita como la escribe el recorrido de la carpeta: si no, el mismo documento tendría dos
  // claves en el registro.
  let abs = path.resolve(absPath);
  try {
    abs = canonizarRuta(abs);
  } catch {
    /* se queda como llega */
  }
  pending.set(abs, { tipo });
  scheduleFlush();
}

// ¿Se ignora esta ruta? Datos de RobinSearch y todo lo oculto (cualquier segmento con «.»).
function ignorada(abs, raiz) {
  if (rutas.dentroDe(abs, config.dataDir)) return true;
  const rel = raiz ? rutas.relativaDentro(abs, raiz) : null;
  const segs = rel ? rel.split(path.sep) : [path.basename(abs)];
  return segs.some((s) => s.startsWith('.'));
}

// Un evento del vigilante nativo sobre `abs`. fs.watch no dice qué ha pasado (solo «rename» o
// «change»): se mira el disco. Si ya no existe, se retira el fichero o TODO lo indexado bajo la
// carpeta que desapareció o se renombró; si es una carpeta nueva (o renombrada), se recorre.
// Lo de carpetas se agrupa (una copia de 500 ficheros no son 500 recorridos).
const _carpetas = new Map(); // abs → 'recorrer' | 'retirar'
let _carpetasTimer = null;

function programarCarpetas() {
  if (_carpetasTimer) clearTimeout(_carpetasTimer);
  _carpetasTimer = setTimeout(() => {
    _carpetasTimer = null;
    const lote = [..._carpetas];
    _carpetas.clear();
    const retirar = lote.filter(([, q]) => q === 'retirar').map(([c]) => c);
    const recorrer = lote.filter(([, q]) => q === 'recorrer').map(([c]) => c);
    if (retirar.length) {
      for (const [clave] of registry.entries()) {
        if (retirar.some((c) => clave !== c && rutas.dentroDe(clave, c))) enqueue(clave, 'remove');
      }
    }
    if (recorrer.length) reescanear(recorrer, { motivo: 'carpeta_cambiada' });
  }, DEBOUNCE_MS);
  _carpetasTimer.unref?.();
}

function eventoNativo(tipoEvento, abs) {
  let st = null;
  try {
    st = fs.statSync(abs);
  } catch (err) {
    // ENOENT (y ENOTDIR, la carpeta que lo contenía ya no está) = de verdad no está. Cualquier
    // otro error —EIO, ETIMEDOUT de un fichero de iCloud sin descargar, EACCES, ENOSPC— es «no
    // se ha podido mirar», y hasta la 1.6.1 se trataba igual que un borrado.
    if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') {
      log.warn('El vigilante no pudo mirar un fichero: NO se toca el índice', { code: String(err?.code || err) });
      return;
    }
    st = null;
  }
  if (!st) {
    if (isSupported(abs)) {
      enqueue(abs, 'remove');
      if (registry.get(canonizarRuta(abs, { disco: false }))) return; // era un fichero indexado
    }
    _carpetas.set(abs, 'retirar');
    programarCarpetas();
    return;
  }
  if (st.isDirectory()) {
    // «change» sobre una carpeta es que ha cambiado algo DENTRO, y eso llega con su propio evento.
    if (tipoEvento !== 'rename' || !rootForPath(abs)) return;
    _carpetas.set(abs, 'recorrer');
    programarCarpetas();
    return;
  }
  if (st.isFile() && isSupported(abs)) enqueue(abs, 'index');
}

// Windows y macOS: UN solo vigilante recursivo por carpeta, del propio sistema
// (ReadDirectoryChangesW / FSEvents). chokidar 3 abre un vigilante POR SUBCARPETA, y en Windows
// una carpeta con un descriptor abierto no se puede renombrar: el abogado no podía cambiar el
// nombre de la carpeta de un caso mientras Claude estaba abierto.
function vigilarNativo(locales) {
  for (const raiz of locales) {
    let w;
    try {
      w = fs.watch(raiz, { recursive: true, persistent: true }, (tipoEvento, nombre) => {
        if (!nombre) {
          // Algunos sistemas no dicen qué cambió: se repasa la carpeta entera (incremental).
          reescanear([raiz], { motivo: 'evento_sin_nombre' });
          return;
        }
        const abs = path.join(raiz, String(nombre));
        if (ignorada(abs, raiz)) return;
        eventoNativo(tipoEvento, abs);
      });
    } catch (err) {
      log.error('No se pudo vigilar la carpeta: se re-escaneará periódicamente', { err: String(err) });
      pasarAReescaneo([raiz], err);
      continue;
    }
    w.on('error', (err) => {
      log.error('Watcher error', { err: String(err) });
      try {
        w.close();
      } catch {
        /* ya cerrado */
      }
      _nativos = _nativos.filter((x) => x !== w);
      pasarAReescaneo([raiz], err);
    });
    _nativos.push(w);
  }
}

// Sin vigilante (Linux sin descriptores de inotify —ENOSPC/EMFILE—, o una carpeta que el sistema
// no deja vigilar): no se deja la carpeta congelada en silencio, se re-escanea cada poco como las
// de red.
const _enReescaneo = new Set();
function pasarAReescaneo(carpetas, err) {
  for (const c of carpetas) _enReescaneo.add(c);
  log.warn('Carpetas locales sin vigilante: se re-escanean periódicamente', {
    carpetas: [..._enReescaneo],
    causa: String(err?.code || err),
  });
  if (_rescanLocalTimer) return;
  const cada = config.rescanRedMs > 0 ? config.rescanRedMs : 5 * 60 * 1000;
  _rescanLocalTimer = setInterval(() => reescanear([..._enReescaneo], { motivo: 'sin_vigilante' }), cada);
  _rescanLocalTimer.unref?.();
}

// Carpetas de red configuradas (las que necesitan re-escaneo en vez de eventos).
export function carpetasDeRed() {
  return (config.watchedFolders || []).filter((p) => esRutaDeRed(p));
}

// Re-escaneo incremental de una o varias carpetas. Reconcilia también los borrados, porque
// en red no hay evento de borrado en el que confiar. Serializado con el resto del trabajo.
//
// Uno por conjunto de carpetas: si ya hay uno esperando turno o en marcha, se devuelve ESE. Con
// miles de ficheros en red una pasada dura más que el intervalo (5 min), y el temporizador iba
// encolando pasadas sin fin detrás de la que no había terminado.
const _reescaneos = new Map(); // clave → promesa

export function reescanear(folders, { motivo = 'periodico' } = {}) {
  const lista = (Array.isArray(folders) ? folders : [folders]).filter(Boolean);
  if (lista.length === 0) return Promise.resolve(null);
  const clave = [...lista].sort().join('\n');
  const ya = _reescaneos.get(clave);
  if (ya) return ya;
  const p = serializar(async () => {
    try {
      const resumen = await indexFolder({ folders: lista, reconciliarBorrados: true });
      const huboCambios =
        resumen.indexados > 0 || resumen.eliminados > 0 || resumen.carpetas_inaccesibles;
      if (huboCambios) {
        log.info(motivo === 'red_de_seguridad' ? 'Repaso de carpeta local (red de seguridad)' : 'Re-escaneo de carpeta de red', {
          motivo,
          carpetas: lista,
          indexados: resumen.indexados,
          eliminados: resumen.eliminados,
          inaccesibles: resumen.carpetas_inaccesibles?.length ?? 0,
        });
      }
      return resumen;
    } catch (err) {
      // Que el índice lo tenga la otra ventana de Claude no es un fallo: ella hace el trabajo y
      // este repaso vuelve a pasar solo. Como «error» ensuciaba el registro y viajaba en el
      // informe técnico como si algo estuviera roto (22-sep-2026). Y el repaso de una carpeta
      // LOCAL no es «de red»: se dice cuál de los dos es.
      const que = motivo === 'red_de_seguridad' ? 'repaso de carpeta local' : 're-escaneo de carpeta de red';
      if (err?.code === 'ROBIN_OTRA_INSTANCIA' || err?.code === 'ROBIN_SIN_CERROJO') {
        log.info(`El ${que} lo deja a la otra instancia, que tiene el índice`, { motivo });
      } else {
        log.error(`Fallo en el ${que}`, { carpetas: lista, err: String(err) });
      }
      return null;
    } finally {
      _reescaneos.delete(clave);
    }
  });
  _reescaneos.set(clave, p);
  return p;
}

// ¿Hay un re-escaneo de estas carpetas esperando turno o en marcha?
export function reescaneoEnCurso(folders) {
  const lista = (Array.isArray(folders) ? folders : [folders]).filter(Boolean);
  return _reescaneos.has([...lista].sort().join('\n'));
}

export function startWatcher() {
  if (!config.watchedFolders || config.watchedFolders.length === 0) {
    log.warn('Watcher no iniciado: sin carpetas configuradas');
    return null;
  }
  if (_watcher || _rescanTimer || _nativos.length || _rescanLocalTimer || _redSeguridadTimer) return _watcher;

  // Una carpeta que ya no existe no se vigila: fs.watch sobre ella falla en cada intento y deja
  // el servidor en error para siempre (correo de Eduardo, 19-sep-2026). Se mira cada poco por si
  // vuelve, y entonces el vigilante se reinicia solo.
  ausentes.revisar({ forzar: true });
  const vigilables = ausentes.presentes(config.watchedFolders);
  if (vigilables.length === 0) {
    log.warn('Watcher no iniciado: ninguna de las carpetas configuradas existe ahora mismo');
    programarRevisionAusentes();
    return null;
  }
  if (ausentes.hayAusentes()) programarRevisionAusentes();

  const red = carpetasDeRed().filter((p) => vigilables.includes(p));
  const locales = vigilables.filter((p) => !red.includes(p));

  // ROBIN_VIGILANTE=ninguno: sin vigilante de eventos, solo el repaso periódico. Es la palanca
  // para un equipo donde el vigilante del sistema da problemas (una carpeta sincronizada que
  // dispara miles de eventos, un montaje raro) y lo que usan las pruebas para comprobar que el
  // repaso, por sí solo, acaba encontrando el documento nuevo.
  const sinVigilante = process.env.ROBIN_VIGILANTE === 'ninguno';
  const nativo = process.env.ROBIN_VIGILANTE !== 'chokidar'
    && (process.platform === 'win32' || process.platform === 'darwin');
  if (locales.length > 0 && sinVigilante) {
    log.warn('Vigilante de eventos desactivado (ROBIN_VIGILANTE=ninguno): las carpetas locales solo se repasan periódicamente', {
      carpetas: locales,
    });
  } else if (locales.length > 0 && nativo) {
    vigilarNativo(locales);
    log.info('Watcher activo (carpetas locales, vigilante del sistema)', { carpetas: locales });
  } else if (locales.length > 0) {
    _watcher = chokidar.watch(locales, {
      ignoreInitial: true, // el indexado inicial lo hace indexFolder en el arranque
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
      // Los ficheros que no se indexan ni se vigilan: en Linux cada uno gasta un descriptor de
      // inotify, y una carpeta de despacho tiene miles de ficheros que no son documentos.
      ignored: (p, stats) =>
        rutas.dentroDe(p, config.dataDir)
        || path.basename(p).startsWith('.')
        || Boolean(stats?.isFile?.() && !isSupported(p)),
    });

    _watcher
      .on('add', (p) => isSupported(p) && enqueue(p, 'index'))
      .on('change', (p) => isSupported(p) && enqueue(p, 'index'))
      .on('unlink', (p) => isSupported(p) && enqueue(p, 'remove'))
      .on('error', (err) => {
        log.error('Watcher error', { err: String(err) });
        if (err?.code === 'ENOSPC' || err?.code === 'EMFILE') {
          const w = _watcher;
          _watcher = null;
          w?.close().catch(() => {});
          pasarAReescaneo(locales, err);
        }
      });

    log.info('Watcher activo (carpetas locales)', { carpetas: locales });
  }

  // RED DE SEGURIDAD de las carpetas locales YA vigiladas. El vigilante del sistema no es
  // infalible —iCloud/Drive materializando un fichero después de crearlo, un disco externo que
  // se va y vuelve, el equipo suspendido, una copia masiva que desborda su cola— y cuando se
  // pierde un cambio, hasta la 1.8.0 nadie volvía a mirar: ese documento se quedaba fuera del
  // índice para siempre (Eduardo, 21-sep-2026). Así que se repasa la carpeta cada tanto, de
  // forma incremental. No sustituye al vigilante: es la red debajo.
  if (locales.length > 0 && config.rescanLocalMs > 0) {
    _redSeguridadTimer = setInterval(() => {
      const aRepasar = ausentes.presentes(locales).filter((c) => !_enReescaneo.has(c));
      if (aRepasar.length === 0 || reescaneoEnCurso(aRepasar)) return;
      reescanear(aRepasar, { motivo: 'red_de_seguridad' }).catch(() => {});
    }, config.rescanLocalMs);
    _redSeguridadTimer.unref?.();
    log.info('Repaso periódico de las carpetas locales (red de seguridad del vigilante)', {
      carpetas: locales,
      cada_minutos: Math.round(config.rescanLocalMs / 60000),
    });
  }

  if (red.length > 0) {
    if (config.rescanRedMs > 0) {
      _rescanTimer = setInterval(() => {
        if (reescaneoEnCurso(red)) return; // el anterior aún no ha terminado: no se encola otro
        reescanear(red, { motivo: 'periodico' }).catch(() => {});
      }, config.rescanRedMs);
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

// Revisa cada poco si una carpeta ausente ha vuelto. Si vuelve, se reinicia el vigilante y se
// indexa lo que haya: el abogado no tiene que hacer nada ni reiniciar Claude.
let _ausentesTimer = null;
function programarRevisionAusentes() {
  if (_ausentesTimer) return;
  _ausentesTimer = setInterval(() => {
    const antes = ausentes.lista().length;
    ausentes.revisar({ forzar: true });
    const ahora = ausentes.lista().length;
    if (ahora >= antes) return;
    log.info('Una carpeta ha vuelto: se reinicia el vigilante');
    stopWatcher()
      .then(() => {
        startWatcher();
        return reescanear(ausentes.presentes(config.watchedFolders), { motivo: 'carpeta_recuperada' });
      })
      .catch((err) => log.warn('No se pudo reiniciar el vigilante tras recuperar una carpeta', { err: String(err) }));
  }, Number(process.env.ROBIN_REVISAR_AUSENTES_MS) || 5 * 60 * 1000);
  _ausentesTimer.unref?.();
}

export async function stopWatcher() {
  if (_rescanTimer) {
    clearInterval(_rescanTimer);
    _rescanTimer = null;
  }
  for (const w of _nativos) {
    try {
      w.close();
    } catch {
      /* ya cerrado */
    }
  }
  _nativos = [];
  if (_carpetasTimer) {
    clearTimeout(_carpetasTimer);
    _carpetasTimer = null;
  }
  _carpetas.clear();
  if (_rescanLocalTimer) {
    clearInterval(_rescanLocalTimer);
    _rescanLocalTimer = null;
  }
  if (_redSeguridadTimer) {
    clearInterval(_redSeguridadTimer);
    _redSeguridadTimer = null;
  }
  if (_ausentesTimer) {
    clearInterval(_ausentesTimer);
    _ausentesTimer = null;
  }
  _enReescaneo.clear();
  if (_watcher) {
    await _watcher.close();
    _watcher = null;
  }
}

// Solo pruebas: meter trabajo en la cola del vigilante y drenarla sin esperar al debounce.
export function _encolarParaPrueba(abs, tipo) {
  enqueue(abs, tipo);
}
export async function _drenarParaPrueba() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  await serializar(drain);
}

export default { startWatcher, stopWatcher, reescanear, reescaneoEnCurso, carpetasDeRed };
