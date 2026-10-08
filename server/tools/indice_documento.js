// indice_documento — el índice de un documento por su estructura (cláusulas, anexos, artículos,
// hechos, fundamentos…) y a qué otras secciones remite cada una. Se calcula al vuelo, en local y
// sin modelo (server/estructura/). Solo lee → readOnlyHint: true.

import { ok, fail } from './util.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';
import { documentoDelExpediente } from '../estructura/acceso.js';
import { estructuraDe, resumenNodo, describirRemision, piezasDeNodo, piezasDeRemision, claveDe } from '../estructura/documento.js';
import { registrar } from '../estructura/piezas.js';

const MAX_SECCIONES = 250;
const PREAMBULO_MIN = 200; // texto antes del primer rótulo que merece entrada propia

export const definition = {
  name: 'indice_documento',
  title: 'Índice de un documento del expediente',
  description:
    'Devuelve el ÍNDICE de un documento indexado, construido por su estructura (títulos, capítulos, ' +
    'artículos, cláusulas o estipulaciones, anexos, hechos, fundamentos, fallo, suplico…), con las ' +
    'páginas de cada sección y a qué otras secciones del MISMO documento remite cada una. Úsalo ' +
    'cuando un fragmento de buscar_documentos remite a otra parte del documento («según el Anexo II», ' +
    '«en los términos de la cláusula quinta», «como se expone en el hecho tercero»): localiza la ' +
    'sección en el índice y léela con leer_seccion, en vez de leerte el documento entero. Si ' +
    '"modo" es "aproximado" (escaneado o fichero cambiado desde el indexado), el índice solo recoge ' +
    'los rótulos inconfundibles. Si el documento no tiene estructura reconocible, lo dice: usa ' +
    'obtener_documento. "avisos_de_remision" señala remisiones que no casan con el título de su ' +
    'destino (el propio documento puede remitir a una sección equivocada): compruébalas antes de ' +
    'citar. Todo se calcula en el ordenador del abogado. Aislado por expediente.',
  inputSchema: {
    type: 'object',
    properties: {
      doc_id: {
        type: 'string',
        description: 'Identificador del documento (de buscar_documentos o listar_documentos_indexados).',
      },
      seccion: {
        type: 'string',
        description:
          'Opcional: desplegar solo esta sección y sus subsecciones (id «s12» del índice). Útil en ' +
          'documentos con cientos de secciones, donde el índice completo se da plegado.',
      },
      expediente: {
        type: 'string',
        description:
          'Expediente al que debe pertenecer el documento. Si se omite, se usa el expediente activo de ' +
          'la sesión. Si tampoco hay activo, la llamada falla.',
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
  if (!auth.ok) return authPromptResult(auth.loginUrl, auth);

  const doc = await documentoDelExpediente(args);
  if (!doc.ok) return fail(doc.error, doc.extra);

  const est = await estructuraDe(doc.docId, { entry: doc.entry, chunks: doc.chunks });
  if (!est.ok) return fail('Documento sin fragmentos indexados.', { doc_id: doc.docId });

  const base = {
    doc_id: doc.docId,
    expediente: doc.expediente,
    fichero: doc.chunks[0]?.fichero ?? doc.entry?.rutaRelativa?.split('/').pop() ?? null,
    ruta_relativa: doc.entry?.rutaRelativa ?? doc.chunks[0]?.rutaRelativa ?? null,
    total_paginas: doc.entry?.numPages ?? null,
    caracteres: est.texto.length,
    modo: est.modo,
  };
  if (est.modo !== 'exacto') base.aviso_modo = avisoModo(est.motivo);

  const nodos = est.arbol.nodos;
  if (nodos.length < 2) {
    return registrar(ok({
      ...base,
      sin_estructura: true,
      total_secciones: nodos.length,
      secciones: nodos.map((n) => ({ ...resumenNodo(est, n), nivel: n.nivel })),
      nota:
        'Este documento no tiene una estructura de secciones reconocible (rótulos o numeración). ' +
        'Léelo con obtener_documento o busca dentro con buscar_documentos.',
    }), { docId: doc.docId, clave: claveDe(est), texto: est.texto, piezas: nodos.flatMap((n) => piezasDeNodo(est, n)) });
  }

  // Remisiones por sección de origen.
  const remitePor = new Map();
  for (const r of est.remisiones) {
    const origen = nodoMasProfundo(est, r.inicio);
    const k = origen?.id ?? 's0';
    if (!remitePor.has(k)) remitePor.set(k, new Set());
    remitePor.get(k).add(r.destino);
  }

  let seleccion = nodos;
  let raizPedida = null;
  if (args?.seccion) {
    raizPedida = est.porId.get(String(args.seccion).trim().toLowerCase());
    if (!raizPedida) {
      return fail(`No hay ninguna sección "${args.seccion}" en el índice de este documento.`, { doc_id: doc.docId });
    }
    seleccion = nodos.filter((n) => n.inicio >= raizPedida.inicio && n.fin <= raizPedida.fin);
  }

  // Muy largo: se pliega a los niveles de arriba y se dice cómo desplegar.
  let plegado = false;
  if (seleccion.length > MAX_SECCIONES) {
    const nivelBase = raizPedida ? raizPedida.nivel : 0;
    let nivelMax = nivelBase + 2;
    while (nivelMax > nivelBase && seleccion.filter((n) => n.nivel <= nivelMax).length > MAX_SECCIONES) nivelMax -= 1;
    seleccion = seleccion.filter((n) => n.nivel <= nivelMax).slice(0, MAX_SECCIONES);
    plegado = true;
  }

  const secciones = [];
  const primero = nodos[0];
  if (!raizPedida && primero.inicio >= PREAMBULO_MIN) {
    secciones.push({ id: 's0', etiqueta: '(antes de la primera sección)', paginas: paginasDe(est, 0, primero.inicio), caracteres: primero.inicio, nivel: 0 });
  }
  for (const n of seleccion) {
    const s = { ...resumenNodo(est, n), nivel: n.nivel };
    if (plegado && n.hijos.length && !seleccion.some((x) => x.padre === n.id)) s.subsecciones_plegadas = n.hijos.length;
    const rem = remitePor.get(n.id);
    if (rem?.size) s.remite_a = [...rem];
    secciones.push(s);
  }

  const avisos = est.remisiones.filter((r) => r.aviso).map((r) => {
    const origen = nodoMasProfundo(est, r.inicio);
    return { desde: origen?.id ?? 's0', ...describirRemision(est, r) };
  });

  const out = {
    ...base,
    total_secciones: nodos.length,
    secciones,
  };
  if (plegado) {
    out.plegado = true;
    out.nota_plegado =
      `El documento tiene ${nodos.length} secciones: se muestran los niveles de arriba. Para ver las ` +
      'subsecciones de una, vuelve a llamar con "seccion" igual a su id.';
  }
  if (avisos.length) out.avisos_de_remision = avisos;
  out.como_leer = 'Lee una sección con leer_seccion(doc_id, seccion: "<id>"), o por su nombre: "Anexo II", "cláusula quinta", "hecho tercero".';
  // Texto del despacho que sale en esta respuesta, para el filtro del punto de respuesta (piezas.js).
  const piezas = [
    ...seleccion.flatMap((n) => piezasDeNodo(est, n)),
    ...est.remisiones.filter((r) => r.aviso).flatMap((r) => piezasDeRemision(est, r)),
  ];
  return registrar(ok(out), { docId: doc.docId, clave: claveDe(est), texto: est.texto, piezas });
}

function nodoMasProfundo(est, pos) {
  let mejor = null;
  for (const n of est.arbol.nodos) if (n.inicio <= pos && pos < n.fin && (!mejor || n.nivel >= mejor.nivel)) mejor = n;
  return mejor;
}

function paginasDe(est, ini, fin) {
  const a = est.paginas.find((p) => ini >= p.inicio && ini <= p.fin)?.pagina ?? null;
  const b = est.paginas.find((p) => fin - 1 >= p.inicio && fin - 1 <= p.fin)?.pagina ?? null;
  if (a == null) return undefined;
  return a === b || b == null ? `${a}` : `${a}-${b}`;
}

export function avisoModo(motivo) {
  const porque = {
    escaneado: 'es un escaneado (su texto viene del OCR)',
    fichero_cambiado_o_ausente: 'el fichero ha cambiado o ya no está donde se indexó',
    no_casa_con_el_indice: 'el fichero no se lee hoy igual que cuando se indexó',
    ilegible: 'el fichero no se ha podido volver a leer',
    sin_registro: 'el documento no está en el registro de indexado',
  }[motivo] ?? 'no se ha podido volver a leer el fichero';
  return `Índice APROXIMADO: ${porque}, así que se ha construido con el texto indexado, sin saltos de línea, y solo recoge los rótulos inconfundibles (CLÁUSULA, ANEXO, ARTÍCULO, PRIMERO.-…). Puede faltar alguna sección.`;
}

export default { definition, handler };
