// Poner el registro y el índice de acuerdo con las carpetas configuradas AHORA.
//
// Se llama al arrancar (instancia que escribe) y cada vez que el abogado cambia las carpetas en
// la app. Hace cuatro cosas, en este orden:
//
//   1. CLAVES. La clave del registro es la ruta del fichero. Si la carpeta pasa a escribirse
//      como está en disco (otra caja, otra forma Unicode), las entradas se re-clavan conservando
//      su docId: no se vuelve a indexar nada por una diferencia de mayúsculas.
//
//   2. RETIRADA. Lo que no cuelga de NINGUNA carpeta configurada se retira del registro y del
//      índice. Antes solo se retiraban los borrados DENTRO de las carpetas vigiladas: al quitar
//      una carpeta, sus documentos se quedaban en el índice para siempre, con su expediente, y
//      en cuanto otra carpeta heredaba ese nombre la búsqueda devolvía documentos del cliente
//      quitado. Es SOLO por configuración: una carpeta configurada cuya unidad no responde, o que
//      no existe ahora mismo, NO pierde nada (la ruta sigue colgando de una carpeta configurada).
//      Y si la configuración no se ha podido leer (ajustes.json dañado), no se retira nada.
//
//   3. NOMBRES. Una carpeta sin nombre guardado (ajustes.json de una versión anterior, o reescrito
//      por la app sin `nombres`) recupera el nombre con el que están archivados sus documentos, si
//      está libre. Así su expediente no cambia de nombre por quitar otra carpeta.
//
//   4. RESELLADO. Si aun así el nombre lógico (o la profundidad de expediente) ha cambiado, se
//      reescriben ruta lógica y expediente de sus documentos en registro e índice, sin recalcular
//      vectores. Primero el índice (es lo que filtra la búsqueda) y después el registro: si el
//      proceso muere en medio, el siguiente arranque vuelve a ver la diferencia y termina.

import { config, rootForPath, logicalPath, expedienteForLogicalPath, guardarNombres, carpetasFijadasPorEntorno } from '../config.js';
import { rutas, nombreValido } from '../rutas.js';
import { log } from '../logger.js';
import { state } from '../state.js';
import * as registry from './registry.js';
import * as store from '../search/store.js';
import * as anotaciones from '../anotaciones.js';
import { removeFilePath } from './indexer.js';

function respirar() {
  return new Promise((r) => setImmediate(r));
}

export async function reconciliarCarpetas({ motivo = 'arranque' } = {}) {
  const resumen = { motivo, reclavados: 0, retirados: 0, huerfanosIndice: 0, renombradas: 0, resellados: 0 };
  if (!config.carpetasFiables) {
    log.warn('No se ha podido leer la configuración de carpetas: no se retira nada del índice');
    return { ...resumen, omitido: 'configuracion_ilegible' };
  }
  const roots = config.roots;
  let t = Date.now();
  const quizaRespirar = async () => {
    if (Date.now() - t > 50) {
      await respirar();
      t = Date.now();
    }
  };

  // 1. Claves escritas como la carpeta configurada.
  for (const [abs, e] of registry.entries()) {
    const canon = rutas.canonizar(roots, abs);
    if (canon === abs) continue;
    const otra = registry.get(canon);
    if (!otra) {
      if (registry.renombrarClave(abs, canon)) resumen.reclavados += 1;
      continue;
    }
    // La misma ruta estaba DOS veces (versiones anteriores): se queda la escrita bien.
    registry.remove(abs);
    if (e?.docId && e.docId !== otra.docId) await store.deleteByDoc(e.docId);
    resumen.reclavados += 1;
    await quizaRespirar();
  }

  // 2. Retirar lo que no cuelga de ninguna carpeta configurada.
  const retiradosIds = new Set();
  for (const [abs, e] of registry.entries()) {
    if (rootForPath(abs)) continue;
    try {
      if (e?.docId) retiradosIds.add(e.docId);
      await removeFilePath(abs);
      resumen.retirados += 1;
    } catch (err) {
      log.error('No se pudo retirar del índice un documento de una carpeta quitada', { err: String(err) });
    }
    await quizaRespirar();
  }
  // Y lo que está en el índice sin registro y con una raíz que ya no existe. Con el registro
  // olvidado (dañado y sin copia) lo que tiene raíz vigente se deja: lo sustituye el indexado.
  const conocidos = new Set(registry.all().map((e) => e.docId));
  const nombresVivos = new Set(roots.map((r) => r.name));
  for (const id of store.docIds()) {
    if (conocidos.has(id)) continue;
    const cab = store.cabecera(id);
    if (cab && nombresVivos.has(cab.raiz)) continue;
    await store.deleteByDoc(id);
    retiradosIds.add(id);
    resumen.huerfanosIndice += 1;
    await quizaRespirar();
  }
  try {
    anotaciones.olvidarDocumentos(retiradosIds);
  } catch (err) {
    log.warn('No se pudieron borrar las fichas de revisión de una carpeta quitada', { err: String(err) });
  }

  // 3. Recuperar el nombre con el que están archivados los documentos de cada carpeta.
  const porRaiz = new Map(roots.map((r) => [r, new Map()]));
  for (const [abs, e] of registry.entries()) {
    const r = rootForPath(abs);
    if (!r) continue;
    const cuenta = porRaiz.get(r);
    cuenta.set(e.raiz, (cuenta.get(e.raiz) || 0) + 1);
  }
  const renombres = [];
  for (const r of roots) {
    if (r.nombreGuardado) continue;
    const cuenta = porRaiz.get(r);
    if (cuenta.size !== 1) continue; // sin documentos, o archivados con nombres mezclados
    const [previo] = cuenta.keys();
    if (!nombreValido(previo) || previo === r.name) continue;
    const ocupado = roots.some((o) => o !== r && rutas.claveNombre(o.name) === rutas.claveNombre(previo));
    if (ocupado) continue;
    renombres.push([r.name, previo]);
    r.name = previo;
    resumen.renombradas += 1;
  }

  // 4. Resellar lo que esté archivado con otro nombre u otra profundidad.
  const paresAnotaciones = new Map();
  for (const [abs, e] of registry.entries()) {
    const r = rootForPath(abs);
    if (!r || !e) continue;
    const rutaRelativa = logicalPath(abs);
    const expediente = expedienteForLogicalPath(rutaRelativa);
    const cab = e.docId ? store.cabecera(e.docId) : null;
    const registroMal = e.rutaRelativa !== rutaRelativa || e.expediente !== expediente || e.raiz !== r.name;
    const indiceMal = Boolean(cab) && (cab.rutaRelativa !== rutaRelativa || cab.expediente !== expediente || cab.raiz !== r.name);
    if (!registroMal && !indiceMal) continue;
    if (e.raiz && e.raiz !== r.name && nombreValido(e.raiz)) paresAnotaciones.set(e.raiz, r.name);
    try {
      if (indiceMal) await store.resellar(e.docId, { rutaRelativa, expediente, raiz: r.name });
      if (registroMal) {
        if (e.sinOcr && state.ficherosSinOcr.delete(e.rutaRelativa)) state.ficherosSinOcr.add(rutaRelativa);
        registry.set(abs, { ...e, rutaRelativa, expediente, raiz: r.name });
      }
      resumen.resellados += 1;
    } catch (err) {
      log.error('No se pudo resellar un documento con el nombre nuevo de su carpeta', { err: String(err) });
      // Mejor fuera del índice que respondiendo bajo un nombre que ya no es el suyo: se retira y
      // el indexado lo vuelve a meter desde el original.
      try {
        await removeFilePath(abs);
      } catch {
        /* lo intentará el siguiente arranque */
      }
    }
    await quizaRespirar();
  }
  if (paresAnotaciones.size) {
    try {
      anotaciones.renombrarRaices([...paresAnotaciones]);
    } catch (err) {
      log.warn('No se pudo llevar el barrido anotado al nombre nuevo de la carpeta', { err: String(err) });
    }
  }

  // 5. Guardar los nombres para la próxima vez.
  try {
    guardarNombres();
  } catch (err) {
    log.warn('No se pudieron guardar los nombres de las carpetas', { err: String(err) });
  }
  if (resumen.reclavados || resumen.retirados || resumen.huerfanosIndice || resumen.renombradas || resumen.resellados) {
    registry.guardarPendiente();
    log.info('Registro e índice ajustados a las carpetas configuradas', {
      ...resumen,
      renombres: renombres.length,
      entorno: carpetasFijadasPorEntorno(),
    });
  }
  return resumen;
}

export default { reconciliarCarpetas };
