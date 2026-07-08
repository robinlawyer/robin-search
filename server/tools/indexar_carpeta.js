// indexar_carpeta — indexa (o re-indexa) la carpeta de expedientes. Escribe en el índice
// pero no borra datos del usuario ni es destructiva: readOnlyHint:false, destructiveHint:false,
// idempotentHint:true (re-ejecutar con los mismos ficheros no cambia el resultado).

import { config } from '../config.js';
import { indexFolder } from '../indexer/indexer.js';
import { ok, fail } from './util.js';

export const definition = {
  name: 'indexar_carpeta',
  title: 'Indexar la carpeta de expedientes',
  description:
    'Indexa los documentos (PDF/DOCX) de la carpeta de expedientes para poder buscarlos ' +
    'semánticamente. Por defecto solo procesa ficheros nuevos o modificados (incremental). ' +
    'Usa forzar=true para re-indexar todo.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Opcional: carpeta a indexar. Por defecto, la carpeta de expedientes configurada.',
      },
      forzar: {
        type: 'boolean',
        description: 'Si es true, re-indexa aunque no haya cambios detectados.',
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
  const folder = args?.path || config.watchedFolder;
  if (!folder) {
    return fail(
      'No hay carpeta de expedientes configurada. Define ROBIN_FOLDER o pasa el parámetro "path".',
    );
  }
  const resumen = await indexFolder({ folder, force: Boolean(args?.forzar) });
  return ok(resumen);
}

export default { definition, handler };
