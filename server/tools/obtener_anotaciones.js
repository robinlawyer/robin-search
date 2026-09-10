// obtener_anotaciones — la fase de SÍNTESIS. Devuelve lo que dejó el barrido: las fichas del
// expediente entero, que ocupan ~1% de los documentos originales y por eso SÍ caben en el
// contexto. Sobre esto se hace la due diligence.
//
// El modo que de verdad importa es `agrupar_por`: pone juntos todos los hechos de un mismo
// tipo de TODO el expediente (todas las fechas, todos los importes, todas las afirmaciones)
// con su documento y su página. Una contradicción entre el anexo de un contrato y un correo
// de hace tres años aparece ahí, una línea debajo de la otra, sin que nadie haya tenido que
// sospecharla — que es justo lo que la búsqueda semántica no puede hacer.
//
// Toda respuesta lleva la COBERTURA por delante: cuántas ventanas se han revisado y qué
// documentos no se han podido leer. Una síntesis sobre un barrido a medias que no lo diga
// sería peor que no tenerla.

import * as expedientes from '../expedientes.js';
import * as anotaciones from '../anotaciones.js';
import { ok, fail } from './util.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

export const definition = {
  name: 'obtener_anotaciones',
  title: 'Fichas del barrido (síntesis)',
  description:
    'Devuelve las fichas que dejó el barrido del expediente (siguiente_por_revisar + anotar), ' +
    'para hacer la síntesis: due diligence, cronología, contradicciones, puntos fuertes y ' +
    'débiles. Usa "agrupar_por" para ver juntos todos los hechos de un tipo en TODO el ' +
    'expediente (fechas, importes, obligaciones, afirmaciones…): así saltan las ' +
    'contradicciones entre documentos. Siempre informa de la cobertura: qué parte del ' +
    'expediente está revisada y qué documentos no se han podido leer.',
  inputSchema: {
    type: 'object',
    properties: {
      expediente: { type: 'string', description: 'Expediente. Si se omite, el activo de la sesión.' },
      agrupar_por: {
        type: 'string',
        enum: anotaciones.CAMPOS_CRUZABLES,
        description:
          'Devuelve SOLO ese campo, de todas las fichas del expediente, con su documento y ' +
          'página. Es la vista que hace visibles las contradicciones. "afirmaciones" es la más ' +
          'útil para una due diligence.',
      },
      doc_id: { type: 'string', description: 'Opcional: solo las fichas de un documento.' },
      desde: { type: 'integer', description: 'Paginación: ficha inicial (0 por defecto).' },
      limite: { type: 'integer', description: 'Paginación: cuántas fichas devolver (50 por defecto, 200 máx.).' },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

function cabeceraCobertura(estado) {
  const cab = {
    expediente: estado.expediente,
    cobertura: estado.cobertura,
    ventanas_revisadas: estado.ventanas_revisadas,
    ventanas_totales: estado.ventanas_totales,
    barrido_completo: estado.completado,
  };
  const avisos = [];
  if (!estado.completado) {
    avisos.push(
      `EL BARRIDO ESTÁ INCOMPLETO: quedan ${estado.ventanas_pendientes} ventana(s) sin leer ` +
        `(cobertura ${estado.cobertura}). Cualquier conclusión que saques de estas fichas cubre ` +
        'solo esa parte del expediente y TIENES que decirlo. Para completarlo, sigue llamando a ' +
        'siguiente_por_revisar.',
    );
  }
  if (estado.no_revisables.length) {
    avisos.push(
      `${estado.no_revisables.length} documento(s) no se han podido leer (escaneados sin texto ` +
        'legible). NO están cubiertos por el barrido; menciónalos como zona ciega.',
    );
    cab.no_revisables = estado.no_revisables;
  }
  if (avisos.length) cab.aviso = avisos.join(' ');
  return cab;
}

export async function handler(args) {
  const auth = await ensureAuthorized();
  if (!auth.ok) return authPromptResult(auth.loginUrl);

  const gate = expedientes.exigirExpediente(args?.expediente ?? null);
  if (!gate.ok) return fail(gate.error, gate.extra);
  const expediente = gate.expediente;

  const estado = anotaciones.estadoBarrido(expediente);
  const cabecera = cabeceraCobertura(estado);

  if (estado.ventanas_revisadas === 0) {
    return fail(
      'Todavía no hay ninguna ficha de este expediente: el barrido no se ha empezado. ' +
        'Empieza con siguiente_por_revisar.',
      cabecera,
    );
  }

  if (args?.agrupar_por) {
    const g = anotaciones.agrupar(expediente, args.agrupar_por);
    if (!g.ok) return fail(g.error);
    return ok({ ...cabecera, campo: g.campo, total: g.total, filas: g.filas });
  }

  const r = anotaciones.todas(expediente, {
    doc_id: args?.doc_id ?? null,
    desde: args?.desde ?? 0,
    limite: args?.limite ?? 50,
  });
  return ok({
    ...cabecera,
    fichas_totales: r.total,
    devueltas: r.devueltas,
    siguiente_ficha: r.siguiente,
    ...(r.siguiente != null
      ? { continuar: `Quedan fichas: vuelve a llamar con desde=${r.siguiente}.` }
      : {}),
    fichas: r.fichas,
  });
}

export default { definition, handler };
