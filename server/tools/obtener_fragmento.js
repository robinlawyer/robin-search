// obtener_fragmento — devuelve el texto completo de un fragmento concreto. Solo lectura.

import * as store from '../search/store.js';
import { ok, fail } from './util.js';

export const definition = {
  name: 'obtener_fragmento',
  title: 'Obtener un fragmento por id',
  description:
    'Devuelve el texto completo y los metadatos de un fragmento concreto, identificado por ' +
    'doc_id y chunk_id (por ejemplo, para releer un pasaje encontrado con buscar_documentos).',
  inputSchema: {
    type: 'object',
    properties: {
      doc_id: { type: 'string', description: 'Identificador del documento.' },
      chunk_id: { type: 'integer', description: 'Identificador del fragmento dentro del documento.' },
    },
    required: ['doc_id', 'chunk_id'],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handler(args) {
  const docId = args?.doc_id;
  const chunkId = args?.chunk_id;
  if (!docId || chunkId === undefined || chunkId === null) {
    return fail('Se requieren "doc_id" y "chunk_id".');
  }
  const meta = await store.getChunk(docId, chunkId);
  if (!meta) return fail('Fragmento no encontrado.', { doc_id: docId, chunk_id: chunkId });
  return ok({
    doc_id: docId,
    chunk_id: chunkId,
    texto: meta.texto,
    fichero: meta.fichero,
    ruta_relativa: meta.rutaRelativa,
    pagina: meta.pagina,
    fecha_modificacion: meta.fechaModificacion,
  });
}

export default { definition, handler };
