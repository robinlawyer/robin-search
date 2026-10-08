// leer_seccion — el texto de UNA sección de un documento (el Anexo II, la cláusula quinta, el hecho
// tercero…), con sus saltos de línea y sus páginas, y a qué otras secciones remite. Complementa a
// indice_documento. Solo lee → readOnlyHint: true.

import { ok, fail } from './util.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';
import { documentoDelExpediente } from '../estructura/acceso.js';
import { estructuraDe, localizarSeccion, rutaDe, resumenNodo, remisionesEn, describirRemision, piezasDeNodo, piezasDeRemision, claveDe } from '../estructura/documento.js';
import { registrar } from '../estructura/piezas.js';
import { avisoModo } from './indice_documento.js';

const MAX_CARACTERES = 30000;

export const definition = {
  name: 'leer_seccion',
  title: 'Leer una sección de un documento',
  description:
    'Devuelve el texto ÍNTEGRO de una sección de un documento indexado —un anexo, una cláusula, un ' +
    'artículo, un hecho, un fundamento, el fallo…— con sus páginas, y la lista de secciones del mismo ' +
    'documento a las que remite (para seguir la remisión con otra llamada). "seccion" acepta el id ' +
    'del índice («s12», de indice_documento) o el nombre tal como lo cita el documento: «Anexo II», ' +
    '«cláusula quinta», «hecho tercero», «artículo 5», «Fundamentos de derecho». Si el nombre casa ' +
    'con varias secciones, devuelve los candidatos. Las secciones largas se devuelven por tramos: si ' +
    '"siguiente_caracter" no es null, vuelve a llamar con "desde_caracter" igual a ese valor. Si una ' +
    'remisión trae "aviso", el documento puede remitir a una sección equivocada: compruébalo antes ' +
    'de citar. Todo se calcula en el ordenador del abogado. Aislado por expediente.',
  inputSchema: {
    type: 'object',
    properties: {
      doc_id: {
        type: 'string',
        description: 'Identificador del documento (de buscar_documentos o listar_documentos_indexados).',
      },
      seccion: {
        type: 'string',
        description: 'Id del índice («s12») o nombre de la sección («Anexo II», «cláusula quinta», «hecho tercero»).',
      },
      desde_caracter: {
        type: 'integer',
        description: 'Para secciones largas: carácter desde el que seguir (el "siguiente_caracter" de la llamada anterior).',
      },
      expediente: {
        type: 'string',
        description:
          'Expediente al que debe pertenecer el documento. Si se omite, se usa el expediente activo de ' +
          'la sesión. Si tampoco hay activo, la llamada falla.',
      },
    },
    required: ['doc_id', 'seccion'],
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
  if (!auth.ok) return authPromptResult(auth.loginUrl, auth);

  const pedido = String(args?.seccion ?? '').trim();
  if (!pedido) return fail('Se requiere "seccion" (id del índice o nombre, p. ej. "Anexo II").');

  const doc = await documentoDelExpediente(args);
  if (!doc.ok) return fail(doc.error, doc.extra);

  const est = await estructuraDe(doc.docId, { entry: doc.entry, chunks: doc.chunks });
  if (!est.ok) return fail('Documento sin fragmentos indexados.', { doc_id: doc.docId });

  // «s0»: el texto antes de la primera sección (comparecencia, encabezado…).
  let nodo = null;
  let inicio;
  let fin;
  if (/^s0$/i.test(pedido)) {
    inicio = 0;
    fin = est.arbol.nodos[0]?.inicio ?? est.texto.length;
  } else {
    const loc = localizarSeccion(est, pedido);
    if (!loc) {
      return fail(`No encuentro la sección "${pedido}" en este documento.`, {
        doc_id: doc.docId,
        modo: est.modo,
        secciones_disponibles: est.arbol.nodos.slice(0, 80).map((n) => (n.titulo ? `${n.id}: ${n.etiqueta} — ${n.titulo}` : `${n.id}: ${n.etiqueta}`)),
        nota: est.arbol.nodos.length > 80 ? 'Hay más: pide el índice completo con indice_documento.' : undefined,
      });
    }
    if (loc.candidatos) {
      return registrar(ok({
        doc_id: doc.docId,
        desambiguacion_requerida: true,
        nota: `"${pedido}" casa con varias secciones de este documento. Vuelve a llamar con el id de la que quieras.`,
        candidatos: loc.candidatos.map((n) => ({ ...resumenNodo(est, n), ruta: rutaDe(est, n) })),
      }), { docId: doc.docId, clave: claveDe(est), texto: est.texto, piezas: loc.candidatos.flatMap((n) => piezasDeNodo(est, n)) });
    }
    nodo = loc.nodo;
    inicio = nodo.inicio;
    fin = nodo.fin;
  }

  const total = fin - inicio;
  const desde = Math.min(Math.max(0, Number(args?.desde_caracter) || 0), Math.max(0, total));
  let hasta = Math.min(desde + MAX_CARACTERES, total);
  // No partir una palabra por la mitad al trocear.
  if (hasta < total) {
    const corte = est.texto.lastIndexOf('\n', inicio + hasta);
    const blanco = est.texto.lastIndexOf(' ', inicio + hasta);
    const mejor = Math.max(corte, blanco) - inicio;
    if (mejor > desde + MAX_CARACTERES / 2) hasta = mejor;
  }
  const texto = conPaginas(est, inicio + desde, inicio + hasta);
  const remisionesAqui = remisionesEn(est, inicio + desde, inicio + hasta).filter((r) => !nodo || r.destino !== nodo.id);
  const remite = remisionesAqui.map((r) => describirRemision(est, r));
  // Sin repetir el mismo destino.
  const vistos = new Set();
  const remite_a = remite.filter((r) => (vistos.has(r.seccion_id + (r.aviso ? '!' : '')) ? false : vistos.add(r.seccion_id + (r.aviso ? '!' : ''))));

  const out = {
    doc_id: doc.docId,
    expediente: doc.expediente,
    fichero: doc.chunks[0]?.fichero ?? null,
    modo: est.modo,
    seccion: nodo
      ? { ...resumenNodo(est, nodo), ruta: rutaDe(est, nodo) }
      : { id: 's0', etiqueta: '(antes de la primera sección)', caracteres: total },
    caracteres_totales: total,
    desde_caracter: desde,
    hasta_caracter: hasta,
    siguiente_caracter: hasta < total ? hasta : null,
    texto,
  };
  if (est.modo !== 'exacto') out.aviso_modo = avisoModo(est.motivo);
  if (nodo?.hijos.length) out.subsecciones = nodo.hijos.map((id) => { const h = est.porId.get(id); return h.titulo ? `${h.id}: ${h.etiqueta} — ${h.titulo}` : `${h.id}: ${h.etiqueta}`; });
  if (remite_a.length) out.remite_a = remite_a;
  // Navegación: la sección anterior y la siguiente del mismo nivel.
  if (nodo) {
    const hermanos = est.arbol.nodos.filter((n) => n.padre === nodo.padre);
    const i = hermanos.findIndex((n) => n.id === nodo.id);
    if (i > 0) out.anterior = hermanos[i - 1].id;
    if (i >= 0 && i < hermanos.length - 1) out.siguiente = hermanos[i + 1].id;
  }
  // Texto del despacho que sale en esta respuesta, para el filtro del punto de respuesta (piezas.js):
  // el de la sección, página a página tal como va en "texto", y los títulos que se citan.
  const piezas = [
    ...tramosDePagina(est, inicio + desde, inicio + hasta),
    ...(nodo ? piezasDeNodo(est, nodo) : []),
    ...(nodo ? nodo.hijos.flatMap((id) => piezasDeNodo(est, est.porId.get(id))) : []),
    ...remisionesAqui.flatMap((r) => piezasDeRemision(est, r)),
  ];
  return registrar(ok(out), { docId: doc.docId, clave: claveDe(est), texto: est.texto, piezas });
}

// Los trozos del documento que forman "texto" (sin las marcas de página).
function tramosDePagina(est, ini, fin) {
  const out = [];
  for (const p of est.paginas) {
    if (p.fin <= ini || p.inicio >= fin) continue;
    const a = Math.max(ini, p.inicio);
    const b = Math.min(fin, p.fin);
    if (b > a) out.push({ valor: est.texto.slice(a, b), inicio: a, fin: b });
  }
  if (!est.paginas.length && fin > ini) out.push({ valor: est.texto.slice(ini, fin), inicio: ini, fin });
  return out;
}

// Texto [ini, fin) con un «[pág. N]» donde cambia la página, como obtener_documento.
function conPaginas(est, ini, fin) {
  let out = '';
  let pos = ini;
  let primera = true;
  for (const p of est.paginas) {
    if (p.fin <= ini || p.inicio >= fin) continue;
    const a = Math.max(pos, p.inicio);
    const b = Math.min(fin, p.fin);
    if (p.pagina != null && (primera || a === p.inicio)) out += `${out ? '\n\n' : ''}[pág. ${p.pagina}]\n`;
    else if (out) out += '\n\n';
    out += est.texto.slice(a, b);
    pos = b;
    primera = false;
  }
  return out.trim();
}

export default { definition, handler };
