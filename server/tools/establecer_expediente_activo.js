// establecer_expediente_activo — fija el expediente (o los expedientes) sobre el que trabajan el
// resto de herramientas, para no tener que repetirlo en cada pregunta.
//
// El servidor corre por stdio ligado a UNA instancia del cliente (Claude Desktop / Code /
// Cursor), así que la selección vive a nivel de proceso y NO se persiste: al cerrar el cliente
// no queda un expediente "pegado" de la sesión anterior. Pero es COMÚN a todas las conversaciones
// de ese cliente: por eso la respuesta pide a Claude que, en adelante, pase el expediente en cada
// llamada (expedientes.AVISO_CONVERSACIONES).
//
// Para que el abogado lo elija con un clic en la ventana de carpetas, elegir_expediente.

import { ok, fail } from './util.js';
import * as expedientes from '../expedientes.js';
import { fijarSeleccion } from '../seleccion.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

export const definition = {
  name: 'establecer_expediente_activo',
  title: 'Fijar el expediente activo',
  description:
    'Fija el expediente (carpeta del caso) sobre el que buscarán el resto de herramientas, para ' +
    'no repetirlo en cada pregunta. Llámala al abrir o cambiar de asunto. El nombre se resuelve ' +
    'de forma tolerante: vale la ruta completa ("Expedientes/Pérez"), solo el nombre de la ' +
    'carpeta ("Pérez") o su slug ("perez"). Si coincide con varios, no elige ninguno: devuelve ' +
    'los candidatos. Admite VARIOS expedientes (lista) cuando el abogado quiere trabajar con ' +
    'carpetas separadas a la vez; "anadir": true los suma a los que ya hay. Si el abogado no da ' +
    'un nombre, usa elegir_expediente, que le abre la ventana de carpetas del sistema. Usa ' +
    '"limpiar": true al cerrar el asunto. El expediente activo es uno para todas las conversaciones ' +
    'abiertas en este Claude: si trabajas en varios asuntos a la vez, indica también "expediente" ' +
    'en cada llamada de lectura.',
  inputSchema: {
    type: 'object',
    properties: {
      expediente: {
        anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, minItems: 1 }],
        description:
          'Nombre o ruta de la carpeta del expediente bajo la carpeta vigilada, o una lista de ' +
          'ellos para trabajar con varios a la vez.',
      },
      anadir: {
        type: 'boolean',
        description: 'Si es true, suma estos expedientes a los ya seleccionados en vez de sustituirlos. Exige "seleccion_actual".',
        default: false,
      },
      seleccion_actual: {
        type: ['string', 'array'],
        items: { type: 'string' },
        description: 'Con "anadir": la selección que tiene ESTA conversación (la de "pasa_en_cada_llamada" de la última respuesta).',
      },
      limpiar: {
        type: 'boolean',
        description:
          'Si es true, deja la sesión SIN expediente activo (al cerrar un asunto). Las ' +
          'búsquedas volverán a exigir que se indique uno.',
        default: false,
      },
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handler(args) {
  const auth = await ensureAuthorized();
  if (!auth.ok) return authPromptResult(auth.loginUrl, auth);

  if (args?.limpiar === true) {
    // No se dice cuál había: podía ser el de otra conversación (revisión de Codex, 25-nov).
    expedientes.setActivo(null);
    return ok({
      expediente_activo: null,
      documentos_indexados: 0,
      mensaje:
        'Sesión sin expediente activo. Las búsquedas pedirán que indiques uno antes de ' +
        'devolver contenido.',
    });
  }

  const pedidos = expedientes.normalizarSeleccion(args?.expediente ?? []);
  if (!pedidos.length) {
    return fail(
      'Se requiere "expediente" (o "limpiar": true para dejar la sesión sin expediente). Si el ' +
        'abogado no sabe el nombre, elegir_expediente le abre la ventana de carpetas.',
      { expedientes_disponibles: expedientes.nombresConocidos() },
    );
  }

  const r = expedientes.resolverVarios(pedidos);
  if (!r.ok) {
    return fail(
      r.extra?.candidatos
        ? r.error
        : `${r.error} Comprueba el nombre de la carpeta, o revisa las carpetas configuradas con estado_servidor.`,
      r.extra,
    );
  }

  const f = await fijarSeleccion(r.expedientes, { anadir: args?.anadir === true, seleccionActual: args?.seleccion_actual ?? null });
  if (!f.ok) return fail(f.error, f.extra);
  return ok(f.respuesta);
}

export default { definition, handler };
