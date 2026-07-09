// listar_documentos_indexados — lista los ficheros indexados con sus metadatos. Solo lectura.

import * as registry from '../indexer/registry.js';
import { ok, matchesFolder } from './util.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

export const definition = {
  name: 'listar_documentos_indexados',
  title: 'Listar documentos indexados',
  description:
    'Lista los documentos indexados del expediente con su ruta, número de fragmentos, ' +
    'páginas y fecha de indexado. Incluye los PDFs detectados sin OCR (no indexados).',
  inputSchema: {
    type: 'object',
    properties: {
      carpeta_filtro: {
        type: 'string',
        description: 'Opcional: limitar a una subcarpeta (ruta relativa).',
      },
    },
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

  const carpetaFiltro = args?.carpeta_filtro || null;
  const documentos = [];
  for (const e of registry.all()) {
    if (!matchesFolder(e.rutaRelativa, carpetaFiltro)) continue;
    documentos.push({
      doc_id: e.docId,
      raiz: e.raiz ?? null,
      ruta_relativa: e.rutaRelativa,
      fragmentos: e.numChunks || 0,
      paginas: e.numPages ?? null,
      sin_ocr: Boolean(e.sinOcr),
      fecha_indexado: e.indexedAt,
    });
  }
  documentos.sort((a, b) => a.ruta_relativa.localeCompare(b.ruta_relativa));
  return ok({ total: documentos.length, documentos });
}

export default { definition, handler };
