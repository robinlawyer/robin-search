// ¿Sigue en el disco el fichero de un documento indexado? (13-nov-2026, correo de Juan)
//
// El vigilante retira del índice lo que el abogado borra, pero en la MISMA cola que la indexación:
// si en ese momento está con un OCR o recorriendo una carpeta, el borrado espera su turno (una
// carpeta borrada desde Finder siguió «indexada» varios minutos; medido: con 300 documentos
// entrando, más de 15 minutos). Si el abogado saca un documento del expediente por error o por
// confidencialidad, ninguna consulta debe servirlo en ese intervalo. Por eso las herramientas que
// devuelven contenido lo comprueban en el disco al servirlo, DESPUÉS de leer el índice (si se
// borra mientras se lee, tampoco sale).
//
// Mismo criterio que el vigilante (watcher.existeEnDisco): solo ENOENT/ENOTDIR es «ya no está».
// Lo que no se puede mirar (unidad de red que no contesta, permiso) NO cuenta como borrado: un fallo
// de lectura no es un borrado (19-sep-2026, el expediente de Eduardo quedó en 43 de 1.150).
// Asíncrono: un `stat` sobre una unidad de red lenta no bloquea al resto de peticiones ni al
// vigilante.

import fs from 'node:fs';
import * as registry from '../indexer/registry.js';
import * as expedientes from '../expedientes.js';

export const AVISO_RETIRADO =
  'Ese documento ya no está en la carpeta del expediente (se ha borrado o movido fuera de ella): ' +
  'no se sirve, aunque el índice todavía no lo haya retirado.';

const EN_PARALELO = 32;

// Ruta en disco del documento: la del registro y, para un índice heredado sin entrada en el
// registro, la que se deduce de su ruta lógica («raíz/…») en los metadatos del fragmento.
export function rutaEnDisco(docId, meta = null) {
  try {
    const abs = registry.rutaDeDocId(docId);
    if (abs) return abs;
  } catch {
    /* registro ilegible: se intenta por la ruta lógica */
  }
  const logica = meta?.rutaRelativa ?? meta?.ruta_relativa ?? null;
  if (!logica) return null;
  try {
    return expedientes.rutaAbsoluta(logica);
  } catch {
    return null;
  }
}

async function noEsta(abs) {
  if (!abs) return false;
  try {
    await fs.promises.stat(abs);
    return false;
  } catch (err) {
    return err?.code === 'ENOENT' || err?.code === 'ENOTDIR';
  }
}

export async function retiradoDelDisco(docId, meta = null) {
  if (!docId) return false;
  return noEsta(rutaEnDisco(docId, meta));
}

// Filtra una lista de objetos con id de documento; una sola comprobación por documento y como
// mucho EN_PARALELO a la vez. `metaDe(item)` da los metadatos para la ruta lógica de respaldo.
export async function soloEnDisco(items, clave = 'doc_id', metaDe = (it) => it?.metadata ?? it) {
  const porDoc = new Map();
  for (const it of items) {
    const id = it?.[clave];
    if (id && !porDoc.has(id)) porDoc.set(id, metaDe(it));
  }
  const fuera = new Set();
  const ids = [...porDoc.keys()];
  for (let i = 0; i < ids.length; i += EN_PARALELO) {
    const tramo = ids.slice(i, i + EN_PARALELO);
    const r = await Promise.all(tramo.map((id) => retiradoDelDisco(id, porDoc.get(id))));
    tramo.forEach((id, k) => r[k] && fuera.add(id));
  }
  const out = items.filter((it) => !fuera.has(it?.[clave]));
  return { items: out, retirados: items.length - out.length, documentosRetirados: fuera.size };
}

export default { retiradoDelDisco, soloEnDisco, rutaEnDisco, AVISO_RETIRADO };
