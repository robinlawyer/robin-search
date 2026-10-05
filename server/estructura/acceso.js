// La misma barrera que obtener_documento, para las herramientas de estructura: solo se sirve un
// documento del expediente activo (o del que se pida), nunca de otro.

import { expedienteForLogicalPath } from '../config.js';
import * as store from '../search/store.js';
import * as registry from '../indexer/registry.js';
import * as expedientes from '../expedientes.js';

// → { ok: true, docId, expediente, entry, chunks } | { ok: false, error, extra }
export async function documentoDelExpediente(args) {
  const docId = args?.doc_id;
  if (!docId) return { ok: false, error: 'Se requiere "doc_id".' };

  const gate = expedientes.exigirExpediente(args?.expediente ?? null);
  if (!gate.ok) return { ok: false, error: gate.error, extra: gate.extra };
  const expediente = gate.expediente;

  const entry = registry.porDocId(docId);
  const expDoc = entry ? entry.expediente || expedienteForLogicalPath(entry.rutaRelativa) : null;
  if (entry && !expedientes.enAmbito(expDoc, expediente)) {
    return {
      ok: false,
      error:
        `Ese documento pertenece a otro expediente ("${expDoc}"), no al expediente activo ` +
        `("${expediente}"). Cambia de expediente con establecer_expediente_activo si es lo que quieres.`,
      extra: { doc_id: docId, expediente_activo: expediente },
    };
  }

  const chunks = await store.getDocChunks(docId);
  if (!entry && chunks.length > 0) {
    const expChunk = chunks[0].expediente || expedienteForLogicalPath(chunks[0].rutaRelativa);
    if (!expedientes.enAmbito(expChunk, expediente)) {
      return {
        ok: false,
        error: `Ese documento pertenece a otro expediente ("${expChunk}"), no al expediente activo ("${expediente}").`,
        extra: { doc_id: docId, expediente_activo: expediente },
      };
    }
  }
  if (chunks.length === 0) {
    if (entry?.sinOcr) {
      return {
        ok: false,
        error:
          'Documento sin texto legible (PDF escaneado o imagen) y aún no procesado por OCR, o con el OCR ' +
          'desactivado: no hay texto del que sacar un índice.',
        extra: { doc_id: docId, sin_ocr: true },
      };
    }
    return { ok: false, error: 'Documento no encontrado o sin fragmentos indexados.', extra: { doc_id: docId } };
  }
  return { ok: true, docId, expediente, entry, chunks };
}

export default { documentoDelExpediente };
