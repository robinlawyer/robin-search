// estado_servidor — estado, versión, aviso de actualización, carpeta vigilada, contadores
// y ficheros sin OCR. Solo lectura.

import fs from 'node:fs';
import path from 'node:path';
import { config, VERSION } from '../config.js';
import { esRutaDeRed } from '../net.js';
import { state } from '../state.js';
import * as registry from '../indexer/registry.js';
import * as expedientes from '../expedientes.js';
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
    'disponible, carpetas vigiladas, expedientes detectados (con sus contadores), expediente ' +
    'activo de la sesión, documentos y fragmentos indexados, ficheros sin OCR y tamaño del ' +
    'índice. Úsala para saber qué expedientes hay antes de fijar uno.',
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
  const catalogo = expedientes.catalogo();
  const respuesta = {
    estado: state.estado,
    version: VERSION,
    sesion: await authStatus(),
    actualizacion_disponible: state.actualizacionDisponible,
    // Se declara dónde vive cada carpeta y si ahora mismo se puede leer: un expediente en el
    // servidor del despacho se mantiene al día por re-escaneo, no por eventos, y si la unidad
    // se desconecta el abogado tiene que poder verlo aquí y no deducirlo de un "0 resultados".
    carpetas_vigiladas: config.roots.map((r) => {
      const enRed = esRutaDeRed(r.path);
      let accesible = true;
      try {
        fs.readdirSync(r.path);
      } catch {
        accesible = false;
      }
      const ficha = { nombre: r.name, ruta: r.path, ubicacion: enRed ? 'red' : 'local', accesible };
      if (enRed) {
        const cada = config.rescanRedMs >= 60000
          ? `${Math.round(config.rescanRedMs / 60000)} min`
          : `${Math.round(config.rescanRedMs / 1000)} s`;
        ficha.actualizacion = config.rescanRedMs > 0
          ? `re-escaneo cada ${cada} y al abrir el expediente`
          : 'solo al abrir el expediente o al indexar a mano';
      }
      if (!accesible) {
        ficha.aviso = enRed
          ? 'Carpeta de red ILEGIBLE ahora mismo: comprueba que la unidad sigue conectada. Lo ' +
            'que se busque sobre ella puede estar incompleto o desactualizado.'
          : 'Carpeta ilegible: comprueba que sigue existiendo y que tienes permiso.';
      }
      return ficha;
    }),
    // Aislamiento por expediente: qué expedientes hay y en cuál se está trabajando.
    expedientes_detectados: catalogo.map((e) => e.expediente),
    expedientes: catalogo,
    expediente_activo: expedientes.getActivo(),
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
  if (!expedientes.getActivo()) {
    respuesta.aviso_expediente =
      catalogo.length > 0
        ? 'No hay expediente activo. Fíjalo con establecer_expediente_activo antes de buscar: ' +
          'las búsquedas están aisladas por expediente y no cubren todos a la vez.'
        : 'Aún no se ha detectado ningún expediente en las carpetas vigiladas.';
  }
  return ok(respuesta);
}

export default { definition, handler };
