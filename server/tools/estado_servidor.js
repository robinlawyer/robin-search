// estado_servidor — estado, versión, aviso de actualización, carpeta vigilada, contadores
// y ficheros sin OCR. Solo lectura.

import fs from 'node:fs';
import { config, VERSION, logicalPath, rootForPath } from '../config.js';
import { esRutaDeRed } from '../net.js';
import { state } from '../state.js';
import * as registry from '../indexer/registry.js';
import * as cuarentena from '../indexer/cuarentena.js';
import * as store from '../search/store.js';
import * as expedientes from '../expedientes.js';
import { ok } from './util.js';
import { authStatus } from '../auth/oauth.js';
import { estadoMotor } from '../embedder/embedder.js';
import { estadoOcr } from '../indexer/ocr.js';

// Tamaño del índice: de los contadores que ya mantiene el índice. Hasta la 1.4.7 se hacía stat
// de CADA fichero del índice en cada llamada (40.000 ficheros con 20.000 documentos, y el
// antivirus mirando cada uno).
function tamanyoIndiceMb() {
  try {
    return Number((store.resumen().bytes / (1024 * 1024)).toFixed(2));
  } catch {
    return 0;
  }
}

// ¿Se puede leer la carpeta? Asíncrono, con tope y en caché: sobre una unidad de red
// desconectada un readdirSync dejaba estado_servidor (y todo el proceso) parado hasta que el
// sistema se rendía, a veces más de un minuto. Si no contesta en TOPE_ACCESO_MS se dice
// «sin respuesta»; la comprobación sigue por detrás y su resultado vale para la siguiente llamada.
const TOPE_ACCESO_MS = Number(process.env.ROBIN_TOPE_ACCESO_MS) || 3000;
const CACHE_ACCESO_MS = 60 * 1000;
const _acceso = new Map(); // ruta → { t, accesible, promesa }

async function comprobarAcceso(ruta) {
  const dir = await fs.promises.opendir(ruta);
  try {
    await dir.read();
  } finally {
    await dir.close().catch(() => {});
  }
  return true;
}

async function accesible(ruta) {
  const previo = _acceso.get(ruta);
  if (previo && previo.accesible !== undefined && Date.now() - previo.t < CACHE_ACCESO_MS) return previo.accesible;
  let promesa = previo?.promesa;
  if (!promesa) {
    promesa = comprobarAcceso(ruta)
      .catch(() => false)
      .then((ok) => {
        _acceso.set(ruta, { t: Date.now(), accesible: ok, promesa: null });
        return ok;
      });
    _acceso.set(ruta, { ...(previo || {}), promesa });
  }
  let tope;
  const r = await Promise.race([promesa, new Promise((res) => (tope = setTimeout(() => res('sin_respuesta'), TOPE_ACCESO_MS)))]);
  clearTimeout(tope);
  return r;
}

export const definition = {
  name: 'estado_servidor',
  title: 'Estado del servidor local',
  description:
    'Devuelve el estado del servidor de búsqueda local: versión, si hay actualización ' +
    'disponible, carpetas vigiladas, expedientes detectados (con sus contadores), expediente ' +
    'activo de la sesión, documentos y fragmentos indexados, ficheros sin OCR y tamaño del ' +
    'índice. Mientras indexa, el progreso con una estimación del tiempo restante (eta) que ' +
    'puedes dar al abogado como aproximada. Incluye además el estado del MOTOR DE EMBEDDING y el resumen del último ' +
    'indexado con las causas de sus errores: si algo no se encuentra, mira eso ANTES de ' +
    'concluir que el documento no existe. Úsala para saber qué expedientes hay antes de ' +
    'fijar uno.',
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
    // Sin motor de embedding no se indexa NI se busca: todos los ficheros fallan y todas las
    // consultas también. Es la primera cosa que hay que poder ver, y antes no se veía.
    motor_embedding: estadoMotor(),
    ocr: estadoOcr(),
    actualizacion_disponible: state.actualizacionDisponible,
    // Se declara dónde vive cada carpeta y si ahora mismo se puede leer: un expediente en el
    // servidor del despacho se mantiene al día por re-escaneo, no por eventos, y si la unidad
    // se desconecta el abogado tiene que poder verlo aquí y no deducirlo de un "0 resultados".
    carpetas_vigiladas: (await Promise.all(config.roots.map(async (r) => [r, await accesible(r.path)]))).map(([r, acceso]) => {
      const enRed = esRutaDeRed(r.path);
      const ok = acceso === true;
      const ficha = { nombre: r.name, ruta: r.path, ubicacion: enRed ? 'red' : 'local', accesible: ok };
      if (acceso === 'sin_respuesta') ficha.sin_respuesta = true;
      if (enRed) {
        const cada = config.rescanRedMs >= 60000
          ? `${Math.round(config.rescanRedMs / 60000)} min`
          : `${Math.round(config.rescanRedMs / 1000)} s`;
        ficha.actualizacion = config.rescanRedMs > 0
          ? `re-escaneo cada ${cada} y al abrir el expediente`
          : 'solo al abrir el expediente o al indexar a mano';
      }
      if (acceso === 'sin_respuesta') {
        ficha.aviso =
          `La carpeta no ha contestado en ${TOPE_ACCESO_MS / 1000} s (unidad de red lenta o desconectada). Lo ` +
          'que se busque sobre ella puede estar incompleto o desactualizado.';
      } else if (!ok) {
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
    tamanyo_indice_mb: tamanyoIndiceMb(),
  };
  if (state.actualizacionDisponible) {
    respuesta.aviso = `Nueva versión disponible (${state.actualizacionDisponible}). Descárgala desde robinlawyer.ai/descargas`;
  }
  if (state.estado === 'indexando' && state.progreso) respuesta.progreso = state.progreso;
  if (state.ultimoError) respuesta.ultimo_error = state.ultimoError;

  // Ficheros que el indexado SE SALTA (cuarentena.js): los que hicieron caer el proceso al
  // leerlos y los que superan el tamaño máximo. Sin esto, «no lo encuentro» sobre un documento
  // apartado sería indistinguible de que no exista.
  // Solo los de carpetas vigiladas: los de una carpeta quitada no se enseñan (ni su nombre).
  const apartados = cuarentena.lista().filter((a) => rootForPath(a.abs) && fs.existsSync(a.abs));
  if (apartados.length) {
    respuesta.ficheros_apartados = apartados.map((a) => ({
      ruta: logicalPath(a.abs),
      motivo:
        a.motivo === cuarentena.MOTIVO_TAMANYO
          ? 'demasiado grande para indexarlo'
          : 'hizo que el indexador se cayera al leerlo',
      tamanyo_mb: Number((a.bytes / 1048576).toFixed(1)),
    }));
    respuesta.aviso_apartados =
      `${apartados.length} fichero(s) NO están en el índice (ver ficheros_apartados): lo que se ` +
      'busque no los cubre. Si hace falta su contenido, que el abogado lo abra y lo adjunte a la ' +
      'conversación. Se reintentan solos si el fichero cambia o con la próxima versión de RobinSearch.';
  }

  // Aviso técnico automático (diagnostico.js): el abogado no tiene que mandar nada a nadie.
  if (state.ultimoInforme) {
    respuesta.aviso_tecnico =
      state.ultimoInforme.enviado || state.ultimoInforme.noEnviado === 'ya_avisado'
        ? 'RobinSearch ha detectado un fallo técnico y ya se lo ha comunicado a Robin ' +
          'automáticamente (solo datos técnicos: ni el contenido ni los nombres de los documentos ' +
          'salen del ordenador). El abogado no tiene que hacer nada.'
        : 'RobinSearch ha detectado un fallo técnico y no ha podido comunicárselo a Robin ' +
          '(sin conexión, o aviso desactivado en este equipo).';
  }

  // Resumen del último indexado CON sus causas de error. Un "0 documentos indexados" con 680
  // errores y un servidor en 'activo' era indistinguible de una carpeta vacía.
  if (state.ultimoIndexado) {
    respuesta.ultimo_indexado = state.ultimoIndexado;
    // Lo que el recorrido encontró pero no pudo meter: ficheros de iCloud/OneDrive sin descargar,
    // enlaces o junctions rotos, bucles. Sin esto una carpeta «bajo demanda» daba 0 en silencio.
    const ni = state.ultimoIndexado.no_indexables;
    if (ni) {
      respuesta.no_indexables = ni;
      respuesta.aviso_no_indexables =
        'Hay elementos en las carpetas que no se han podido indexar (ver no_indexables): ' +
        (ni.no_descargados ? `${ni.no_descargados} fichero(s) en la nube sin descargar a este equipo; ` : '') +
        (ni.enlaces_inaccesibles ? `${ni.enlaces_inaccesibles} enlace(s) o acceso(s) directo(s) que no llevan a nada accesible; ` : '') +
        (ni.bucles_evitados ? `${ni.bucles_evitados} enlace(s) en bucle que se han saltado; ` : '') +
        'lo que se busque no los cubre. Para los de la nube, que el abogado marque la carpeta como ' +
        '«Mantener siempre en este dispositivo» y vuelva a indexar.';
    }
    if (state.ultimoIndexado.errores > 0) {
      respuesta.aviso_indexado =
        `El último indexado falló en ${state.ultimoIndexado.errores} fichero(s). ` +
        'Mira "errores_por_causa" en ultimo_indexado: si la causa se repite en todos, el fallo ' +
        'no es de los documentos sino del servidor (motor de embedding, permisos o disco).';
    }
  }
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
