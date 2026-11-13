// Comprueba en un endpoint público de Robin si hay una versión más reciente del servidor
// local, para avisar en `estado_servidor` (C.1 de la spec). Es una llamada de metadatos:
// NO transporta ningún contenido documental.

import { UPDATE_CHECK_URL, VERSION } from './config.js';
import { log } from './logger.js';
import { state } from './state.js';
import { getBearerQuiet, cabeceras } from './auth/oauth.js';
import { prepararMotor, supervisado } from './motor.js';
import { feedFirmado } from './firma.js';

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
      headers: cabeceras(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    });
    if (!res.ok) return null;
    // Los bytes EXACTOS: la firma es de ellos, no de un JSON vuelto a escribir.
    const bytes = Buffer.from(await res.arrayBuffer());
    const data = JSON.parse(bytes.toString('utf8'));
    // Versión mínima anunciada CON ANTELACIÓN (docs/versiones-soportadas.md): se avisa antes de que
    // el servidor deje de aceptar esta.
    if (data?.version_minima && isNewer(data.version_minima, VERSION)) {
      state.versionMinimaAnunciada = { version: data.version_minima, desde: data.version_minima_desde || null };
    }
    const latest = data?.version;
    if (latest && isNewer(latest, VERSION)) {
      state.actualizacionDisponible = latest;
      log.info('Actualización disponible', { actual: VERSION, disponible: latest });
      // Bajo el supervisor (1.13.0) se instala SOLA, con su huella comprobada (motor.js): el
      // abogado no tiene que pulsar nada. En segundo plano: no retrasa esta respuesta.
      // 🔴 1.13.3: y SOLO si el fichero de versiones viene firmado con nuestra clave (firma.js):
      // la huella la publica el mismo servidor, así que por sí sola no prueba que el paquete sea
      // nuestro. La firma se pide DESPUÉS de dejar anotados los avisos, en segundo plano y con su
      // propio tope: una firma que tarda no puede llevarse por delante el aviso (revisión de Codex).
      if (supervisado()) instalarSiFirmado(bytes, { version: latest, url: data?.url, sha256: data?.sha256 }).catch(() => {});
      return latest;
    }
    return null;
  } catch {
    // Sin conexión / endpoint caído: no es un error, simplemente no avisamos.
    return null;
  }
}

// La firma, al lado (firma.js): sin una firma válida de los bytes EXACTOS del fichero de versiones
// no se instala nada solo.
async function instalarSiFirmado(bytes, publicada) {
  let firmado = false;
  try {
    const rf = await fetch(`${UPDATE_CHECK_URL}.sig`, { signal: AbortSignal.timeout(15_000), headers: cabeceras({}) });
    if (rf.ok) firmado = feedFirmado(bytes, await rf.text());
  } catch {
    firmado = false;
  }
  if (!firmado) {
    log.warn('Versión nueva publicada, pero el fichero de versiones no trae una firma válida: no se instala sola', { disponible: publicada.version });
    return false;
  }
  return prepararMotor(publicada);
}

export default { checkForUpdate };
