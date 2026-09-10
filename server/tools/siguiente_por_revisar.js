// siguiente_por_revisar — motor del barrido exhaustivo. Devuelve la SIGUIENTE ventana del
// expediente que nadie ha leído todavía, con su texto ya dentro, más el progreso.
//
// Está pensada para llamarse EN BUCLE: leer → anotar → siguiente → anotar… El estado de qué
// se ha revisado lo lleva el servidor en disco, no la conversación, así que el barrido de un
// expediente grande sobrevive a cerrar Claude y se reanuda donde iba.

import { expedienteForLogicalPath } from '../config.js';
import * as store from '../search/store.js';
import * as registry from '../indexer/registry.js';
import * as expedientes from '../expedientes.js';
import * as anotaciones from '../anotaciones.js';
import { ok, fail } from './util.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

export const definition = {
  name: 'siguiente_por_revisar',
  title: 'Siguiente ventana del expediente por revisar',
  description:
    'Devuelve el siguiente trozo del expediente que NADIE ha leído aún, con su texto, y el ' +
    'progreso del barrido. Es la herramienta para revisar un expediente ENTERO cuando no cabe ' +
    'en el contexto (due diligence, revisión integral): se llama en bucle — esta tool para ' +
    'leer, "anotar" para dejar la ficha, y vuelta a empezar — hasta que "completado" sea true. ' +
    'A diferencia de buscar_documentos, que devuelve lo que se parece a una pregunta, esto ' +
    'recorre el expediente completo sin dejarse nada. El estado se guarda en disco: el barrido ' +
    'se reanuda solo aunque se cierre la sesión.',
  inputSchema: {
    type: 'object',
    properties: {
      expediente: {
        type: 'string',
        description:
          'Expediente a barrer. Si se omite, el expediente activo de la sesión.',
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

// Texto de una ventana de un documento, con marcadores de página, aplicando la barrera de
// aislamiento por expediente igual que obtener_documento.
async function textoVentana(v, expediente) {
  const entry = registry.all().find((e) => e.docId === v.doc_id) || null;
  const expDoc = entry ? entry.expediente || expedienteForLogicalPath(entry.rutaRelativa) : null;
  if (entry && !expedientes.enAmbito(expDoc, expediente)) return null;

  const chunks = await store.getDocChunks(v.doc_id);
  if (chunks.length === 0) return { texto: '', paginas: null, fichero: null };
  const expChunk = chunks[0].expediente || expedienteForLogicalPath(chunks[0].rutaRelativa);
  if (!expedientes.enAmbito(expChunk, expediente)) return null;

  const seleccion = chunks.slice(v.desde, v.hasta);
  let texto = '';
  let paginaActual = null;
  const paginas = [];
  for (const c of seleccion) {
    if (c.pagina != null && c.pagina !== paginaActual) {
      texto += `\n\n[pág. ${c.pagina}]\n`;
      paginaActual = c.pagina;
      paginas.push(c.pagina);
    }
    texto += `${c.texto || ''}\n`;
  }
  return {
    texto: texto.trim(),
    paginas: paginas.length ? { desde: paginas[0], hasta: paginas[paginas.length - 1] } : null,
    fichero: seleccion[0]?.fichero || null,
  };
}

export async function handler(args) {
  const auth = await ensureAuthorized();
  if (!auth.ok) return authPromptResult(auth.loginUrl);

  const gate = expedientes.exigirExpediente(args?.expediente ?? null);
  if (!gate.ok) return fail(gate.error, gate.extra);
  const expediente = gate.expediente;

  const { ventana: v, estado } = anotaciones.siguiente(expediente);
  const progreso = {
    expediente,
    ventanas_totales: estado.ventanas_totales,
    ventanas_revisadas: estado.ventanas_revisadas,
    ventanas_pendientes: estado.ventanas_pendientes,
    cobertura: estado.cobertura,
    completado: estado.completado,
  };

  if (estado.ventanas_totales === 0) {
    return fail(
      'Este expediente no tiene ningún documento con texto indexado que revisar. ' +
        'Comprueba con estado_servidor que el indexado ha terminado.',
      { ...progreso, no_revisables: estado.no_revisables },
    );
  }

  if (!v) {
    // Barrido terminado. Lo que NO se ha podido leer se dice aquí, en el mismo sitio donde se
    // anuncia el 100%: una revisión que se calla 300 escaneados no es una revisión completa.
    return ok({
      ...progreso,
      mensaje:
        'Barrido completo: todas las ventanas del expediente están revisadas. ' +
        'Usa obtener_anotaciones para la síntesis.',
      ...(estado.no_revisables.length
        ? {
            aviso:
              `ATENCIÓN: ${estado.no_revisables.length} documento(s) del expediente NO se han ` +
              'podido leer (escaneados sin texto legible). NO están cubiertos por este barrido: ' +
              'dilo explícitamente en cualquier conclusión que entregues.',
            no_revisables: estado.no_revisables,
          }
        : {}),
    });
  }

  const contenido = await textoVentana(v, expediente);
  if (contenido === null) {
    return fail(
      `La ventana pendiente pertenece a otro expediente ("${v.ruta_relativa}"). ` +
        'Vuelve a lanzar el indexado; el índice y el registro no cuadran.',
      progreso,
    );
  }

  return ok({
    ...progreso,
    doc_id: v.doc_id,
    ruta_relativa: v.ruta_relativa,
    fichero: contenido.fichero,
    desde_fragmento: v.desde,
    hasta_fragmento: v.hasta,
    fragmentos_documento: v.fragmentos_documento,
    paginas: contenido.paginas,
    texto: contenido.texto,
    siguiente_paso:
      'Lee este texto ENTERO y llama a "anotar" con doc_id y desde_fragmento tal cual vienen ' +
      'aquí. No resumas: extrae hechos con su página. Luego vuelve a llamar a esta tool.',
  });
}

export default { definition, handler };
