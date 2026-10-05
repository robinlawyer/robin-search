// buscar_documentos — búsqueda semántica en lenguaje natural sobre los documentos de UN
// expediente. Solo lee el índice → readOnlyHint: true.
//
// AISLAMIENTO POR EXPEDIENTE (v1.3.0): la búsqueda se limita SIEMPRE a un expediente. Si no
// se recibe uno explícito y no hay expediente activo en la sesión, devuelve error pidiendo
// elegirlo; nunca cae en "buscar en todo".

import { config } from '../config.js';
import { rutas } from '../rutas.js';
import { embedQuery } from '../embedder/embedder.js';
import * as store from '../search/store.js';
import { ok, fail } from './util.js';
import * as expedientes from '../expedientes.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';
import { log } from '../logger.js';
import { estructuraDe, seccionDeFragmento, remisionesEn, describirRemision, rutaDe, piezasDeNodo, piezasDeRemision, claveDe } from '../estructura/documento.js';
import { registrar } from '../estructura/piezas.js';

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
          'Expediente en el que buscar (carpeta del caso). Incluye sus subcarpetas. Si se ' +
          'omite, se usa el expediente activo de la sesión. Si tampoco hay activo, la llamada ' +
          'falla: nunca se busca en todos.',
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
  // El ámbito es el expediente Y lo que cuelga de él (ver expedientes.enAmbito). Con igualdad
  // estricta, un caso cuyas subcarpetas son expedientes por sí mismas devolvía solo los
  // documentos sueltos de su raíz, sin avisar de nada.
  const alcance = expedientes.ambito(expediente);
  const filtro = alcance.length > 1
    ? { expediente: { $in: alcance } }
    : { expediente: { $eq: expediente } };
  const raw = await store.query(vector, topK, filtro);

  // Sin distinguir mayúsculas (Windows/macOS) ni forma Unicode: Claude escribe «Pérez» en NFC y
  // la carpeta puede estar en NFD; con comparación exacta el filtro devolvía 0 sin avisar.
  const dentroDeSubcarpeta = (ruta) => rutas.bajoPrefijoLogico(ruta, prefijo);

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

  const piezasPorDoc = config.seccionesEnBusqueda ? await anotarSecciones(fragmentos) : null;
  const res = ok({ query, expediente, n_resultados: fragmentos.length, fragmentos });
  // Con el interruptor, los títulos de sección también son texto del despacho (piezas.js).
  for (const d of piezasPorDoc?.values() ?? []) registrar(res, d);
  return res;
}

// FASE 2 (detrás de config.seccionesEnBusqueda): a cada fragmento, la sección del documento en la
// que está y las secciones a las que remite su texto («según el Anexo II» → s31, «Anexo II —
// Tablas salariales»), para que Claude siga la remisión con leer_seccion. Lo que no se pueda
// calcular se omite en silencio: el fragmento sale como siempre.
//
// La primera vez que se ve un documento hay que volver a leerlo (un PDF de cien páginas, segundos).
// La búsqueda no espera más de PRESUPUESTO_MS: lo que no esté listo sale como siempre, sin sección,
// y se termina de calcular en segundo plano para la siguiente.
const PRESUPUESTO_MS = 1500;
async function anotarSecciones(fragmentos) {
  const limite = Date.now() + PRESUPUESTO_MS;
  const piezasPorDoc = new Map();
  for (const f of fragmentos) {
    try {
      const pendiente = estructuraDe(f.doc_id);
      const resto = limite - Date.now();
      const est = resto > 0
        ? await Promise.race([pendiente, new Promise((r) => setTimeout(() => r(null), resto).unref?.())])
        : null;
      if (!est) {
        pendiente.catch(() => {});
        continue;
      }
      if (!est.ok || est.arbol.nodos.length < 2) continue;
      const s = seccionDeFragmento(est, f.chunk_id);
      if (!s) continue;
      if (s.nodo) {
        f.seccion = { id: s.nodo.id, etiqueta: s.nodo.etiqueta, ruta: rutaDe(est, s.nodo) };
        if (s.nodo.titulo) f.seccion.titulo = s.nodo.titulo;
      }
      const vistos = new Set();
      const rem = remisionesEn(est, s.tramo.inicio, s.tramo.fin)
        .filter((r) => r.destino !== s.nodo?.id)
        .map((r) => describirRemision(est, r))
        .filter((r) => (vistos.has(r.seccion_id) ? false : vistos.add(r.seccion_id)));
      if (rem.length) f.remite_a = rem;
      if (est.modo !== 'exacto') f.indice_aproximado = true;
      const entrada = piezasPorDoc.get(f.doc_id) ?? { docId: f.doc_id, clave: claveDe(est), texto: est.texto, piezas: [] };
      let x = s.nodo;
      while (x) { entrada.piezas.push(...piezasDeNodo(est, x)); x = x.padre ? est.porId.get(x.padre) : null; }
      for (const r of remisionesEn(est, s.tramo.inicio, s.tramo.fin)) entrada.piezas.push(...piezasDeRemision(est, r));
      piezasPorDoc.set(f.doc_id, entrada);
    } catch (err) {
      log.warn('No se pudo anotar la sección de un fragmento', { err: String(err?.message ?? err) });
    }
  }
  return piezasPorDoc;
}

export default { definition, handler };
