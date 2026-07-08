// Capa de índice vectorial. Aísla vectra tras una interfaz mínima para poder migrar a
// hnswlib-node en v1.1 (mayor escala) sin tocar indexador ni tools.
//
// vectra persiste el índice como fichero JSON local en config.indexDir. El índice vive en
// el directorio de datos del usuario, NUNCA en la carpeta de expedientes.

import { LocalIndex } from 'vectra';
import { config, ensureDataDirs } from '../config.js';
import { log } from '../logger.js';

let _index = null;

async function getIndex() {
  if (!_index) {
    ensureDataDirs();
    _index = new LocalIndex(config.indexDir);
    if (!(await _index.isIndexCreated())) {
      await _index.createIndex({ version: 1, deleteIfExists: false });
      log.info('Índice vectorial creado', { dir: config.indexDir });
    }
  }
  return _index;
}

function chunkKey(docId, chunkId) {
  return `${docId}::${chunkId}`;
}

// Inserta (o reemplaza) los chunks de un documento. `chunks` = [{ chunkId, vector, metadata }].
export async function upsertChunks(docId, chunks) {
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
}

// Elimina todos los chunks de un documento (usado antes de re-indexar un fichero modificado).
export async function deleteByDoc(docId) {
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

// Nº total de fragmentos en el índice.
export async function totalChunks() {
  const index = await getIndex();
  const items = await index.listItems();
  return items.length;
}

export default { upsertChunks, deleteByDoc, query, getChunk, totalChunks };
