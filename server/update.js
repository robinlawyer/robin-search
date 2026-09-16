// Comprueba en un endpoint público de Robin si hay una versión más reciente del servidor
// local, para avisar en `estado_servidor` (C.1 de la spec). Es una llamada de metadatos:
// NO transporta ningún contenido documental.

import { UPDATE_CHECK_URL, VERSION } from './config.js';
import { log } from './logger.js';
import { state } from './state.js';
import { getBearerQuiet } from './auth/oauth.js';

function isNewer(remote, local) {
  const a = String(remote).split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(local).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

// Devuelve la versión disponible (string) o null. Rellena state.actualizacionDisponible.
//
// El tope cubre TODO: obtener la sesión (que puede renovarla por red), la petición y leer la
// respuesta. Antes solo cubría la petición: un servidor que mandaba las cabeceras y no terminaba
// el cuerpo, o una renovación de sesión colgada, dejaban esto esperando para siempre.
export async function checkForUpdate({ timeoutMs = 4000 } = {}) {
  const controller = new AbortController();
  let timer;
  const tope = new Promise((_, rechazar) => {
    timer = setTimeout(() => {
      controller.abort();
      rechazar(new Error('tiempo agotado'));
    }, timeoutMs);
    timer.unref?.();
  });
  tope.catch(() => {});
  try {
    return await Promise.race([comprobar(controller.signal), tope]);
  } catch {
    // Sin conexión / endpoint caído / tope: no es un error, simplemente no avisamos.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function comprobar(signal) {
  try {
    const bearer = await getBearerQuiet();
    if (signal.aborted) return null;
    const res = await fetch(UPDATE_CHECK_URL, {
      signal,
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    });
    if (!res.ok) return null;
    const data = await res.json();
    const latest = data?.version;
    if (latest && isNewer(latest, VERSION)) {
      state.actualizacionDisponible = latest;
      log.info('Actualización disponible', { actual: VERSION, disponible: latest });
      return latest;
    }
    return null;
  } catch {
    // Sin conexión / endpoint caído: no es un error, simplemente no avisamos.
    return null;
  }
}

export default { checkForUpdate };
