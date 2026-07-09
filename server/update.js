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
export async function checkForUpdate({ timeoutMs = 4000 } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const bearer = await getBearerQuiet();
    const res = await fetch(UPDATE_CHECK_URL, {
      signal: controller.signal,
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    });
    clearTimeout(timer);
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
