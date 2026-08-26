// buscar_documentos — búsqueda semántica en lenguaje natural sobre los documentos de UN
// expediente. Solo lee el índice → readOnlyHint: true.
//
// AISLAMIENTO POR EXPEDIENTE (v1.3.0): la búsqueda se limita SIEMPRE a un expediente. Si no
// se recibe uno explícito y no hay expediente activo en la sesión, devuelve error pidiendo
// elegirlo; nunca cae en "buscar en todo".

import { config } from '../config.js';
import { embedQuery } from '../embedder/embedder.js';
import * as store from '../search/store.js';
import { ok, fail } from './util.js';
import * as expedientes from '../expedientes.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

export const definition = {
  name: 'buscar_documentos',
  title: 'Buscar en los documentos del expediente',
  description:
    'Búsqueda semántica sobre los documentos indexados de UN expediente del despacho. ' +
    'Recibe una consulta en lenguaje natural y devuelve los fragmentos más relevantes con ' +
    'su fichero, página y puntuación. El contenido nunca sale del ordenador. ' +
    'La búsqueda está aislada por expediente: usa el expediente activo de la sesión (fíjalo ' +
    'con establecer_expediente_activo) o el que indiques en "expediente". Si no hay ninguno, ' +
    'devuelve error en lugar de buscar en todos los expedientes.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Consulta en lenguaje natural.' },
      n_resultados: {
        type: 'integer',
        description: 'Número de fragmentos a devolver.',
        default: config.nResultsDefault,
        minimum: 1,
        maximum: 50,
      },
      expediente: {
        type: 'string',
        description:
          'Expediente en el que buscar (carpeta del caso). Si se omite, se usa el expediente ' +
          'activo de la sesión. Si tampoco hay activo, la llamada falla: nunca se busca en todos.',
      },
      subcarpeta: {
        type: 'string',
        description:
          'Opcional: acotar aún más dentro del expediente, a una subcarpeta concreta ' +
          '(ruta relativa, p. ej. "prueba-documental").',
      },
    },
    required: ['query'],
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

  const query = (args?.query || '').trim();
  if (!query) return fail('El parámetro "query" es obligatorio.');

  // `carpeta_filtro` era el nombre del parámetro hasta la 1.2.x. Se sigue aceptando para no
  // romper a los clientes ya instalados, pero ahora identifica el expediente.
  const pedido = args?.expediente ?? args?.carpeta_filtro ?? null;
  const gate = expedientes.exigirExpediente(pedido);
  if (!gate.ok) return fail(gate.error, gate.extra);
  const expediente = gate.expediente;

  const n = args?.n_resultados || config.nResultsDefault;
  const subcarpeta = (args?.subcarpeta || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

  const vector = await embedQuery(query);

  // Filtro EXACTO por metadato en el índice: vectra descarta los fragmentos de otros
  // expedientes ANTES de puntuar, así que el top-K se calcula ya dentro del expediente. Es lo
  // que hace que el aislamiento no cueste recall (el post-filtro en memoria de la 1.2.x podía
  // devolver menos de n resultados, o ninguno, al quedarse sin candidatos del expediente).
  const prefijo = subcarpeta ? `${expediente}/${subcarpeta}` : null;
  const topK = prefijo ? Math.min(n * 5, 200) : n;
  const raw = await store.query(vector, topK, { expediente: { $eq: expediente } });

  const dentroDeSubcarpeta = (ruta) => {
    if (!prefijo) return true;
    const rel = String(ruta || '').replace(/\\/g, '/');
    return rel === prefijo || rel.startsWith(`${prefijo}/`);
  };

  const fragmentos = raw
    .filter((r) => dentroDeSubcarpeta(r.metadata.rutaRelativa))
    .slice(0, n)
    .map((r) => ({
      doc_id: r.docId,
      chunk_id: r.chunkId,
      texto: r.metadata.texto,
      fichero: r.metadata.fichero,
      raiz: r.metadata.raiz ?? null,
      expediente: r.metadata.expediente ?? expediente,
      ruta_relativa: r.metadata.rutaRelativa,
      pagina: r.metadata.pagina,
      fecha_modificacion: r.metadata.fechaModificacion,
      score: Number(r.score.toFixed(4)),
    }));

  return ok({ query, expediente, n_resultados: fragmentos.length, fragmentos });
}

export default { definition, handler };
