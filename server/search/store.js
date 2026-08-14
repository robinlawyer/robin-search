// Capa de índice vectorial. Aísla vectra tras una interfaz mínima para poder migrar a
// hnswlib-node en v1.1 (mayor escala) sin tocar indexador ni tools.
//
// vectra persiste el índice como fichero JSON local en config.indexDir. El índice vive en
// el directorio de datos del usuario, NUNCA en la carpeta de expedientes.

import { LocalIndex } from 'vectra';
import { config, ensureDataDirs } from '../config.js';
import { log } from '../logger.js';

let _indexPromise = null;

// Memoiza la PROMESA (no la instancia): si dos llamadores concurren en el primer uso
// (bootstrap + herramienta indexar_carpeta), el segundo debe esperar a que createIndex()
// termine; devolver la instancia a medio crear producía "Index does not exist".
function getIndex() {
  if (!_indexPromise) {
    _indexPromise = (async () => {
      ensureDataDirs();
      const index = new LocalIndex(config.indexDir);
      if (!(await index.isIndexCreated())) {
        await index.createIndex({ version: 1, deleteIfExists: false });
        log.info('Índice vectorial creado', { dir: config.indexDir });
      }
      return index;
    })();
  }
  return _indexPromise;
}

function chunkKey(docId, chunkId) {
  return `${docId}::${chunkId}`;
}

// vectra solo admite UNA transacción beginUpdate/endUpdate a la vez sobre el índice. Si dos
// pasadas de indexado concurren (bootstrap de arranque + herramienta indexar_carpeta, o el
// watcher), la segunda fallaba con "Update already in progress". Cola de promesas que
// serializa toda escritura al índice.
let _writeQueue = Promise.resolve();
function withWriteLock(fn) {
  const run = _writeQueue.then(fn, fn);
  _writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Inserta (o reemplaza) los chunks de un documento. `chunks` = [{ chunkId, vector, metadata }].
export function upsertChunks(docId, chunks) {
  return withWriteLock(async () => {
    const index = await getIndex();
    await index.beginUpdate();
    try {
      for (const c of chunks) {
        await index.upsertItem({
          id: chunkKey(docId, c.chunkId),
          vector: c.vector,
          metadata: { docId, chunkId: c.chunkId, ...c.metadata },
        });
      }
      await index.endUpdate();
    } catch (err) {
      index.cancelUpdate();
      throw err;
    }
  });
}

// Elimina todos los chunks de un documento (usado antes de re-indexar un fichero modificado).
export function deleteByDoc(docId) {
  return withWriteLock(async () => {
    const index = await getIndex();
    const items = await index.listItemsByMetadata({ docId: { $eq: docId } });
    if (items.length === 0) return 0;
    await index.beginUpdate();
    try {
      for (const item of items) await index.deleteItem(item.id);
      await index.endUpdate();
    } catch (err) {
      index.cancelUpdate();
      throw err;
    }
    return items.length;
  });
}

// Búsqueda por similitud. `filter` opcional en metadata (p.ej. { rutaRelativa: { $regex } }).
export async function query(vector, topK, filter = undefined) {
  const index = await getIndex();
  const results = await index.queryItems(vector, topK, filter);
  return results.map((r) => ({
    score: r.score, // similitud coseno [0-1]
    docId: r.item.metadata.docId,
    chunkId: r.item.metadata.chunkId,
    metadata: r.item.metadata,
  }));
}

// Devuelve un chunk concreto por (docId, chunkId).
export async function getChunk(docId, chunkId) {
  const index = await getIndex();
  const items = await index.listItemsByMetadata({
    docId: { $eq: docId },
    chunkId: { $eq: chunkId },
  });
  return items.length ? items[0].metadata : null;
}

// Devuelve TODOS los chunks de un documento, ordenados por chunkId. Para lectura íntegra
// (revisión exhaustiva documento a documento, p.ej. due diligence: recorrer el documento
// completo, no solo el top-K semántico de query()).
export async function getDocChunks(docId) {
  const index = await getIndex();
  const items = await index.listItemsByMetadata({ docId: { $eq: docId } });
  return items
    .map((it) => it.metadata)
    .sort((a, b) => (a.chunkId ?? 0) - (b.chunkId ?? 0));
}

// Nº total de fragmentos en el índice.
export async function totalChunks() {
  const index = await getIndex();
  const items = await index.listItems();
  return items.length;
}

export default { upsertChunks, deleteByDoc, query, getChunk, getDocChunks, totalChunks };
