// obtener_documento — devuelve el texto ÍNTEGRO de un documento (todos sus fragmentos en
// orden, con marcadores de página), para leerlo de principio a fin. Habilita la revisión
// exhaustiva documento a documento (due diligence, revisión integral de un expediente),
// donde la búsqueda semántica top-K de buscar_documentos no garantiza cobertura completa.
// Los documentos largos se devuelven por ventanas de fragmentos para no desbordar el contexto.

import * as store from '../search/store.js';
import * as registry from '../indexer/registry.js';
import { ok, fail } from './util.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

const MAX_FRAGMENTOS_POR_LLAMADA = 60;

export const definition = {
  name: 'obtener_documento',
  title: 'Obtener el texto íntegro de un documento',
  description:
    'Devuelve el texto completo de un documento indexado (todos sus fragmentos en orden, con ' +
    'marcadores de página) para leerlo de principio a fin. Úsalo en revisión exhaustiva ' +
    'documento a documento (due diligence, revisión integral de un expediente), donde no basta ' +
    'la búsqueda semántica top-K de buscar_documentos. Los documentos largos se devuelven por ' +
    'ventanas: si "siguiente_fragmento" no es null, vuelve a llamar con "desde_fragmento" igual ' +
    'a ese valor hasta agotar el documento.',
  inputSchema: {
    type: 'object',
    properties: {
      doc_id: {
        type: 'string',
        description: 'Identificador del documento (de listar_documentos_indexados o buscar_documentos).',
      },
      desde_fragmento: {
        type: 'integer',
        description: 'Fragmento inicial (0 por defecto). Para paginar documentos largos con siguiente_fragmento.',
      },
      max_fragmentos: {
        type: 'integer',
        description: `Máximo de fragmentos por llamada (por defecto y tope ${MAX_FRAGMENTOS_POR_LLAMADA}).`,
      },
    },
    required: ['doc_id'],
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
  if (!docId) return fail('Se requiere "doc_id".');

  const entry = registry.all().find((e) => e.docId === docId) || null;
  const chunks = await store.getDocChunks(docId);

  if (chunks.length === 0) {
    if (entry && entry.sinOcr) {
      return ok({
        doc_id: docId,
        ruta_relativa: entry.rutaRelativa,
        sin_ocr: true,
        total_fragmentos: 0,
        texto: '',
        aviso:
          'Documento sin texto legible (PDF escaneado o imagen) y aún no procesado por OCR, o ' +
          'con el OCR desactivado: no hay texto que devolver. Vuelve a intentarlo cuando el OCR ' +
          'lo haya indexado.',
      });
    }
    return fail('Documento no encontrado o sin fragmentos indexados.', { doc_id: docId });
  }

  const total = chunks.length;
  const desde = Math.max(0, Number(args?.desde_fragmento) || 0);
  const ventana = Math.max(
    1,
    Math.min(Number(args?.max_fragmentos) || MAX_FRAGMENTOS_POR_LLAMADA, MAX_FRAGMENTOS_POR_LLAMADA),
  );
  const hasta = Math.min(desde + ventana, total);
  const seleccion = chunks.slice(desde, hasta);

  let texto = '';
  let paginaActual = null;
  for (const c of seleccion) {
    if (c.pagina != null && c.pagina !== paginaActual) {
      texto += `\n\n[pág. ${c.pagina}]\n`;
      paginaActual = c.pagina;
    }
    texto += `${c.texto || ''}\n`;
  }

  const fichero = seleccion[0]?.fichero || (entry ? entry.rutaRelativa.split('/').pop() : null);

  return ok({
    doc_id: docId,
    fichero,
    ruta_relativa: entry?.rutaRelativa ?? seleccion[0]?.rutaRelativa ?? null,
    total_fragmentos: total,
    total_paginas: entry?.numPages ?? null,
    desde_fragmento: desde,
    hasta_fragmento: hasta,
    siguiente_fragmento: hasta < total ? hasta : null,
    sin_ocr: Boolean(entry?.sinOcr),
    texto: texto.trim(),
  });
}

export default { definition, handler };
