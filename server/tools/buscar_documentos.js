// buscar_documentos — búsqueda semántica en lenguaje natural sobre los documentos del
// expediente indexado. Solo lee el índice → readOnlyHint: true.

import { config } from '../config.js';
import { embedQuery } from '../embedder/embedder.js';
import * as store from '../search/store.js';
import { ok, fail, matchesFolder } from './util.js';

export const definition = {
  name: 'buscar_documentos',
  title: 'Buscar en los documentos del expediente',
  description:
    'Búsqueda semántica sobre los documentos indexados del despacho (expediente local). ' +
    'Recibe una consulta en lenguaje natural y devuelve los fragmentos más relevantes con ' +
    'su fichero, página y puntuación. El contenido nunca sale del ordenador.',
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
      carpeta_filtro: {
        type: 'string',
        description: 'Opcional: limitar la búsqueda a una subcarpeta (ruta relativa).',
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
  const query = (args?.query || '').trim();
  if (!query) return fail('El parámetro "query" es obligatorio.');
  const n = args?.n_resultados || config.nResultsDefault;
  const carpetaFiltro = args?.carpeta_filtro || null;

  const vector = await embedQuery(query);
  // Si hay filtro de carpeta, pedimos de más y filtramos en memoria (portable, sin
  // depender de operadores de metadata del store).
  const topK = carpetaFiltro ? Math.min(n * 5, 200) : n;
  const raw = await store.query(vector, topK);

  const fragmentos = raw
    .filter((r) => matchesFolder(r.metadata.rutaRelativa, carpetaFiltro))
    .slice(0, n)
    .map((r) => ({
      doc_id: r.docId,
      chunk_id: r.chunkId,
      texto: r.metadata.texto,
      fichero: r.metadata.fichero,
      ruta_relativa: r.metadata.rutaRelativa,
      pagina: r.metadata.pagina,
      fecha_modificacion: r.metadata.fechaModificacion,
      score: Number(r.score.toFixed(4)),
    }));

  return ok({ query, n_resultados: fragmentos.length, fragmentos });
}

export default { definition, handler };
