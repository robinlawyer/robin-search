// Carpetas configuradas que YA NO EXISTEN en el disco.
//
// 19/20-sep-2026 (Eduardo y Juan): una carpeta de un expediente antiguo se había movido, y
// RobinSearch seguía intentándola en cada arranque, en cada re-escaneo y en cada evento del
// vigilante. El resultado era un `ENOENT: no such file or directory` repetido para siempre, un
// estado en 'error' permanente y un abogado que no sabía qué tenía que hacer.
//
// La regla: una carpeta que NO EXISTE se aparta de la vigilancia y del indexado, se dice UNA vez
// en claro (con lo que el abogado tiene que hacer), y se vuelve a mirar cada poco por si vuelve.
// NO se borra de la configuración: la decisión de quitar un expediente es del abogado, no
// nuestra, y una carpeta puede volver (un disco externo que se reconecta, una sincronización).
//
// Y solo ENOENT. Una carpeta de red desconectada o sin permiso (EACCES, ETIMEDOUT, EPERM,
// EHOSTDOWN) NO se aparta: existe, y apartarla sería justo el error de la unidad de red que se
// cae un minuto y se lleva por delante el expediente entero.
import fs from 'node:fs';
import { config } from './config.js';
import { rutas } from './rutas.js';
import { log } from './logger.js';

const REVISAR_CADA_MS = Number(process.env.ROBIN_REVISAR_AUSENTES_MS) || 5 * 60 * 1000;

const _ausentes = new Map(); // clave de ruta → { path, desde, avisada }
let _ultimaRevision = 0;

function clave(p) {
  try {
    return rutas.claveRuta(p);
  } catch {
    return String(p);
  }
}

// ENOENT = no está. Cualquier otro error = está pero ahora no se puede leer (ver arriba).
function noExiste(p) {
  try {
    return !fs.statSync(p).isDirectory();
  } catch (err) {
    return err?.code === 'ENOENT' || err?.code === 'ENOTDIR';
  }
}

// Repasa las carpetas configuradas. Devuelve las que están ausentes AHORA.
// `forzar`: sin esperar al intervalo (arranque, o cambio de carpetas desde la app).
export function revisar({ forzar = false } = {}) {
  const ahora = Date.now();
  if (!forzar && ahora - _ultimaRevision < REVISAR_CADA_MS) return lista();
  _ultimaRevision = ahora;
  for (const p of config.watchedFolders || []) {
    const k = clave(p);
    const ya = _ausentes.get(k);
    if (noExiste(p)) {
      if (!ya) {
        _ausentes.set(k, { path: p, desde: new Date().toISOString(), avisada: false });
        log.warn('Carpeta configurada que ya no existe: se aparta de la vigilancia hasta que vuelva', { code: 'ENOENT' });
      }
    } else if (ya) {
      _ausentes.delete(k);
      log.info('Una carpeta que no existía ha vuelto: se vuelve a vigilar e indexar');
    }
  }
  // Una carpeta que el abogado ha quitado de la configuración deja de contar.
  const configuradas = new Set((config.watchedFolders || []).map(clave));
  for (const k of [..._ausentes.keys()]) if (!configuradas.has(k)) _ausentes.delete(k);
  return lista();
}

export function lista() {
  return [..._ausentes.values()].map((a) => ({ ...a }));
}

export function estaAusente(p) {
  return _ausentes.has(clave(p));
}

// Las carpetas con las que SÍ se trabaja (vigilar, indexar, recorrer).
export function presentes(carpetas = config.watchedFolders || []) {
  return carpetas.filter((p) => !estaAusente(p));
}

// ¿Alguna carpeta nueva ha aparecido o desaparecido desde la última revisión? Para que el
// vigilante sepa si tiene que reiniciarse.
export function hayAusentes() {
  return _ausentes.size > 0;
}

export function _limpiarParaPrueba() {
  _ausentes.clear();
  _ultimaRevision = 0;
}

export default { revisar, lista, estaAusente, presentes, hayAusentes };
