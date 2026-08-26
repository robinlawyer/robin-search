// obtener_fragmento — devuelve el texto completo de un fragmento concreto. Solo lectura.

import { expedienteForLogicalPath } from '../config.js';
import * as store from '../search/store.js';
import { ok, fail } from './util.js';
import * as expedientes from '../expedientes.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

export const definition = {
  name: 'obtener_fragmento',
  title: 'Obtener un fragmento por id',
  description:
    'Devuelve el texto completo y los metadatos de un fragmento concreto, identificado por ' +
    'doc_id y chunk_id (por ejemplo, para releer un pasaje encontrado con buscar_documentos). ' +
    'Aislado por expediente: solo devuelve fragmentos del expediente activo (o del que indiques ' +
    'en "expediente").',
  inputSchema: {
    type: 'object',
    properties: {
      doc_id: { type: 'string', description: 'Identificador del documento.' },
      chunk_id: { type: 'integer', description: 'Identificador del fragmento dentro del documento.' },
      expediente: {
        type: 'string',
        description:
          'Expediente al que debe pertenecer el fragmento. Si se omite, se usa el expediente ' +
          'activo de la sesión. Si tampoco hay activo, la llamada falla.',
      },
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
  const auth = await ensureAuthorized();
  if (!auth.ok) return authPromptResult(auth.loginUrl);

  const docId = args?.doc_id;
  const chunkId = args?.chunk_id;
  if (!docId || chunkId === undefined || chunkId === null) {
    return fail('Se requieren "doc_id" y "chunk_id".');
  }
  const gate = expedientes.exigirExpediente(args?.expediente ?? null);
  if (!gate.ok) return fail(gate.error, gate.extra);
  const expediente = gate.expediente;

  const meta = await store.getChunk(docId, chunkId);
  if (!meta) return fail('Fragmento no encontrado.', { doc_id: docId, chunk_id: chunkId });

  // Barrera de aislamiento: un (doc_id, chunk_id) de otro expediente no devuelve texto.
  const expChunk = meta.expediente || expedienteForLogicalPath(meta.rutaRelativa);
  if (expChunk !== expediente) {
    return fail(
      `Ese fragmento pertenece a otro expediente ("${expChunk}"), no al expediente activo ` +
        `("${expediente}").`,
      { doc_id: docId, chunk_id: chunkId, expediente_activo: expediente },
    );
  }

  return ok({
    doc_id: docId,
    chunk_id: chunkId,
    expediente: expChunk,
    texto: meta.texto,
    fichero: meta.fichero,
    ruta_relativa: meta.rutaRelativa,
    pagina: meta.pagina,
    fecha_modificacion: meta.fechaModificacion,
  });
}

export default { definition, handler };
