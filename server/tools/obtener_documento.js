// obtener_documento — devuelve el texto ÍNTEGRO de un documento (todos sus fragmentos en
// orden, con marcadores de página), para leerlo de principio a fin. Habilita la revisión
// exhaustiva documento a documento (due diligence, revisión integral de un expediente),
// donde la búsqueda semántica top-K de buscar_documentos no garantiza cobertura completa.
// Los documentos largos se devuelven por ventanas de fragmentos para no desbordar el contexto.

import { expedienteForLogicalPath } from '../config.js';
import * as store from '../search/store.js';
import * as registry from '../indexer/registry.js';
import { ok, fail } from './util.js';
import * as expedientes from '../expedientes.js';
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
    'a ese valor hasta agotar el documento. Aislado por expediente: solo devuelve documentos ' +
    'del expediente activo (o del que indiques en "expediente").',
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
      expediente: {
        type: 'string',
        description:
          'Expediente al que debe pertenecer el documento. Si se omite, se usa el expediente ' +
          'activo de la sesión. Si tampoco hay activo, la llamada falla.',
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

  const gate = expedientes.exigirExpediente(args?.expediente ?? null);
  if (!gate.ok) return fail(gate.error, gate.extra);
  const expediente = gate.expediente;

  const entry = registry.all().find((e) => e.docId === docId) || null;

  // Barrera de aislamiento: un doc_id de OTRO expediente no devuelve contenido. Sin esto,
  // bastaría arrastrar un identificador de una conversación anterior para leer entero un
  // documento del cliente equivocado.
  const expDoc = entry ? entry.expediente || expedienteForLogicalPath(entry.rutaRelativa) : null;
  if (entry && expDoc !== expediente) {
    return fail(
      `Ese documento pertenece a otro expediente ("${expDoc}"), no al expediente activo ` +
        `("${expediente}"). Cambia de expediente con establecer_expediente_activo si es lo que quieres.`,
      { doc_id: docId, expediente_activo: expediente },
    );
  }

  const chunks = await store.getDocChunks(docId);

  // Documento que no está en el registro (índice heredado): se comprueba contra el metadato
  // del propio fragmento antes de devolver nada.
  if (!entry && chunks.length > 0) {
    const expChunk =
      chunks[0].expediente || expedienteForLogicalPath(chunks[0].rutaRelativa);
    if (expChunk !== expediente) {
      return fail(
        `Ese documento pertenece a otro expediente ("${expChunk}"), no al expediente activo ` +
          `("${expediente}").`,
        { doc_id: docId, expediente_activo: expediente },
      );
    }
  }

  if (chunks.length === 0) {
    if (entry && entry.sinOcr) {
      return ok({
        doc_id: docId,
        expediente,
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
    expediente,
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
