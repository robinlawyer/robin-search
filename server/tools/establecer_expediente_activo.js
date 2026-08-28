// establecer_expediente_activo — fija el expediente sobre el que trabajan el resto de
// herramientas durante esta sesión, para no tener que repetirlo en cada pregunta.
//
// El servidor corre por stdio ligado a UNA instancia del cliente (Claude Desktop / Code /
// Cursor), así que el expediente activo vive a nivel de proceso y NO se persiste: al cerrar
// el cliente no queda un expediente "pegado" de la sesión anterior.

import { ok, fail } from './util.js';
import * as expedientes from '../expedientes.js';
import { config } from '../config.js';
import { esRutaDeRed } from '../net.js';
import { reescanear } from '../watcher/watcher.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

export const definition = {
  name: 'establecer_expediente_activo',
  title: 'Fijar el expediente activo',
  description:
    'Fija el expediente (carpeta del caso) sobre el que buscarán el resto de herramientas ' +
    'durante esta sesión, para no repetirlo en cada pregunta. Llámala al abrir o cambiar de ' +
    'asunto. El nombre se resuelve de forma tolerante: vale la ruta completa ' +
    '("Expedientes/Pérez"), solo el nombre de la carpeta ("Pérez") o su slug ' +
    '("perez"). Si coincide con varios, no elige ninguno: devuelve los candidatos. ' +
    'Usa "limpiar": true al cerrar el asunto para quedarse sin expediente activo.',
  inputSchema: {
    type: 'object',
    properties: {
      expediente: {
        type: 'string',
        description: 'Nombre o ruta de la carpeta del expediente bajo la carpeta vigilada.',
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
  if (!auth.ok) return authPromptResult(auth.loginUrl);

  if (args?.limpiar === true) {
    const anterior = expedientes.getActivo();
    expedientes.setActivo(null);
    return ok({
      expediente_activo: null,
      expediente_anterior: anterior,
      documentos_indexados: 0,
      mensaje:
        'Sesión sin expediente activo. Las búsquedas pedirán que indiques uno antes de ' +
        'devolver contenido.',
    });
  }

  const pedido = (args?.expediente || '').trim();
  if (!pedido) {
    return fail('Se requiere "expediente" (o "limpiar": true para dejar la sesión sin expediente).', {
      expedientes_disponibles: expedientes.nombresConocidos(),
    });
  }

  const r = expedientes.resolver(pedido);
  if (!r.ok) {
    if (r.motivo === 'ambiguo') {
      return fail(
        `El expediente "${pedido}" es ambiguo: coincide con varios. Indica cuál con su ruta completa.`,
        { candidatos: r.candidatos, expedientes_disponibles: r.conocidos },
      );
    }
    return fail(
      `No hay ningún expediente llamado "${pedido}" bajo las carpetas vigiladas. ` +
        'Comprueba el nombre de la carpeta, o revisa las carpetas configuradas con estado_servidor.',
      { expedientes_disponibles: r.conocidos },
    );
  }

  expedientes.setActivo(r.expediente);

  // Si el expediente vive en una carpeta de RED (Z:\\ o montaje del servidor del despacho), se
  // refresca contra el disco AL ABRIRLO. Es el momento exacto en que el abogado va a trabajar
  // sobre el asunto, y sobre SMB no hay evento fiable que nos avise de lo que han dejado ahí
  // los compañeros desde la última vez. Es incremental: solo se re-indexa lo que ha cambiado.
  const ruta = expedientes.rutaAbsoluta(r.expediente);
  let refresco = null;
  if (config.rescanAlAbrir && ruta && esRutaDeRed(ruta)) {
    refresco = await reescanear([ruta], { motivo: 'apertura' });
  }

  const ficha =
    expedientes.catalogo().find((e) => e.expediente === r.expediente) ||
    { documentos: 0, fragmentos: 0, sin_ocr: 0 };

  const respuesta = {
    expediente_activo: r.expediente,
    documentos_indexados: ficha.documentos,
    fragmentos_indexados: ficha.fragmentos,
    ficheros_sin_ocr: ficha.sin_ocr,
  };

  if (refresco) {
    respuesta.ubicacion = 'red';
    respuesta.actualizado_desde_disco = {
      documentos_nuevos_o_modificados: refresco.indexados,
      documentos_retirados: refresco.eliminados,
    };
    if (refresco.carpetas_inaccesibles || refresco.subcarpetas_ilegibles) {
      // La carpeta de red no responde: NO es un expediente vacío, y hay que decirlo así.
      respuesta.aviso_red =
        'No se ha podido leer la carpeta de red del expediente, así que lo que se busque puede ' +
        'estar incompleto o desactualizado. Comprueba que la unidad sigue conectada.';
      if (refresco.carpetas_inaccesibles) respuesta.carpetas_inaccesibles = refresco.carpetas_inaccesibles;
      if (refresco.subcarpetas_ilegibles) respuesta.subcarpetas_ilegibles = refresco.subcarpetas_ilegibles;
    }
  }
  if (ficha.documentos === 0) {
    respuesta.aviso =
      'El expediente existe pero aún no tiene documentos indexados: puede que el indexado ' +
      'siga en curso (consulta estado_servidor) o que la carpeta esté vacía.';
  }
  return ok(respuesta);
}

export default { definition, handler };
