// listar_documentos_indexados — lista los ficheros indexados de UN expediente con sus
// metadatos. Solo lectura. Aislado por expediente, igual que buscar_documentos.

import { expedienteForLogicalPath } from '../config.js';
import * as registry from '../indexer/registry.js';
import { ok, fail } from './util.js';
import * as expedientes from '../expedientes.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

export const definition = {
  name: 'listar_documentos_indexados',
  title: 'Listar documentos indexados del expediente',
  description:
    'Lista los documentos indexados de UN expediente con su ruta, número de fragmentos, ' +
    'páginas y fecha de indexado. Incluye los ficheros sin texto legible extraíble ' +
    '(PDF escaneado o imagen sin OCR, no indexados). Usa el expediente activo de la sesión o ' +
    'el que indiques en "expediente"; si no hay ninguno, devuelve error en lugar de listar ' +
    'los documentos de todos los expedientes. Para ver qué expedientes hay, usa estado_servidor.',
  inputSchema: {
    type: 'object',
    properties: {
      expediente: {
        type: 'string',
        description:
          'Expediente a listar (carpeta del caso). Si se omite, se usa el expediente activo ' +
          'de la sesión. Si tampoco hay activo, la llamada falla.',
      },
      subcarpeta: {
        type: 'string',
        description: 'Opcional: acotar a una subcarpeta dentro del expediente (ruta relativa).',
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

  const pedido = args?.expediente ?? args?.carpeta_filtro ?? null;
  const gate = expedientes.exigirExpediente(pedido);
  if (!gate.ok) return fail(gate.error, gate.extra);
  const expediente = gate.expediente;

  const subcarpeta = (args?.subcarpeta || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const prefijo = subcarpeta ? `${expediente}/${subcarpeta}` : null;

  const documentos = [];
  for (const e of registry.all()) {
    const exp = e.expediente || expedienteForLogicalPath(e.rutaRelativa);
    if (exp !== expediente) continue;
    if (prefijo) {
      const rel = String(e.rutaRelativa || '').replace(/\\/g, '/');
      if (rel !== prefijo && !rel.startsWith(`${prefijo}/`)) continue;
    }
    documentos.push({
      doc_id: e.docId,
      raiz: e.raiz ?? null,
      expediente: exp,
      ruta_relativa: e.rutaRelativa,
      fragmentos: e.numChunks || 0,
      paginas: e.numPages ?? null,
      sin_ocr: Boolean(e.sinOcr),
      fecha_indexado: e.indexedAt,
    });
  }
  documentos.sort((a, b) => a.ruta_relativa.localeCompare(b.ruta_relativa));
  return ok({ expediente, total: documentos.length, documentos });
}

export default { definition, handler };
