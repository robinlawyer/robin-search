// estado_servidor — estado, versión, aviso de actualización, carpeta vigilada, contadores
// y ficheros sin OCR. Solo lectura.

import fs from 'node:fs';
import path from 'node:path';
import { config, VERSION } from '../config.js';
import { state } from '../state.js';
import * as registry from '../indexer/registry.js';
import { ok } from './util.js';
import { authStatus } from '../auth/oauth.js';

function dirSizeMb(dir) {
  let bytes = 0;
  try {
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else bytes += fs.statSync(full).size;
      }
    }
  } catch {
    /* índice aún no creado */
  }
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

export const definition = {
  name: 'estado_servidor',
  title: 'Estado del servidor local',
  description:
    'Devuelve el estado del servidor de búsqueda local: versión, si hay actualización ' +
    'disponible, carpeta vigilada, documentos y fragmentos indexados, ficheros sin OCR y ' +
    'tamaño del índice.',
  inputSchema: { type: 'object', properties: {} },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handler() {
  const { documentos, fragmentos, sinOcr } = registry.stats();
  const respuesta = {
    estado: state.estado,
    version: VERSION,
    sesion: await authStatus(),
    actualizacion_disponible: state.actualizacionDisponible,
    carpetas_vigiladas: config.roots.map((r) => ({ nombre: r.name, ruta: r.path })),
    documentos_indexados: documentos,
    fragmentos_totales: fragmentos,
    ficheros_sin_ocr: sinOcr,
    tamanyo_indice_mb: dirSizeMb(config.indexDir),
  };
  if (state.actualizacionDisponible) {
    respuesta.aviso = `Nueva versión disponible (${state.actualizacionDisponible}). Descárgala desde robinlawyer.ai/descargas`;
  }
  if (state.estado === 'indexando' && state.progreso) respuesta.progreso = state.progreso;
  if (state.estado === 'error' && state.ultimoError) respuesta.ultimo_error = state.ultimoError;
  return ok(respuesta);
}

export default { definition, handler };
