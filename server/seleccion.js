// Fijar la selección de expedientes de trabajo. Lo comparten establecer_expediente_activo (por
// nombre) y elegir_expediente (con la ventana de carpetas del sistema), para que las dos vías
// apliquen exactamente las mismas comprobaciones.

import { config } from './config.js';
import { esRutaDeRed } from './net.js';
import { reescanear } from './watcher/watcher.js';
import * as expedientes from './expedientes.js';

const ESPERA_REESCANEO_MS = Number(process.env.ROBIN_ESPERA_REESCANEO_MS) || 20000;

// Un expediente que ABARCA otros (la carpeta vigilada cuando es la de un caso con piezas en
// subcarpetas, o una carpeta madre con ficheros sueltos): sus expedientes de dentro.
export function abarcaVarios(id) {
  return expedientes.ambito(id).filter((c) => c !== id);
}

// → { ok: true, respuesta } | { ok: false, error, extra }
export async function fijarSeleccion(ids, { anadir = false } = {}) {
  const nuevos = expedientes.normalizarSeleccion(ids);

  const seleccion = anadir
    ? expedientes.normalizarSeleccion([...expedientes.getActivos(), ...nuevos])
    : nuevos;
  expedientes.setActivo(seleccion);

  // Si un expediente vive en una carpeta de RED (Z:\\ o montaje del servidor del despacho), se
  // refresca contra el disco AL ABRIRLO: sobre SMB no hay evento fiable de lo que han dejado los
  // compañeros. Incremental, y sin esperar más de ESPERA_REESCANEO_MS: sobre miles de ficheros la
  // pasada dura horas y Claude cortaba la llamada; si no ha terminado, sigue en segundo plano.
  const rutasRed = nuevos
    .map((id) => expedientes.rutaAbsoluta(id))
    .filter((ruta) => ruta && config.rescanAlAbrir && esRutaDeRed(ruta));
  let refresco = null;
  let actualizandose = false;
  if (rutasRed.length) {
    const pasada = reescanear(rutasRed, { motivo: 'apertura' }).catch(() => null);
    let tope;
    const SIGUE = Symbol('sigue');
    const r2 = await Promise.race([pasada, new Promise((res) => (tope = setTimeout(() => res(SIGUE), ESPERA_REESCANEO_MS)))]);
    clearTimeout(tope);
    if (r2 === SIGUE) actualizandose = true;
    else refresco = r2;
  }

  // Contadores de TODO el ámbito (cada expediente y sus subcarpetas), no solo de su raíz.
  const ficha = expedientes.contadoresAmbito(seleccion);
  const activo = expedientes.getActivo();
  const respuesta = {
    expediente_activo: activo,
    documentos_indexados: ficha.documentos,
    fragmentos_indexados: ficha.fragmentos,
    ficheros_sin_ocr: ficha.sin_ocr,
    pasa_en_cada_llamada: { expediente: activo },
    aviso_conversaciones: expedientes.AVISO_CONVERSACIONES,
  };
  if (seleccion.length > 1) {
    respuesta.por_expediente = seleccion.map((id) => ({ expediente: id, ...expedientes.contadoresAmbito(id) }));
    respuesta.nota_varios =
      'Las búsquedas y lecturas cubren todos estos expedientes a la vez y cada resultado dice de ' +
      'cuál viene. Para anotar, archivar un correo, el barrido o los cambios hay que indicar UNO.';
  }

  if (actualizandose) {
    respuesta.ubicacion = 'red';
    respuesta.actualizandose = true;
    respuesta.aviso_actualizacion =
      'La carpeta de red del expediente se está actualizando en segundo plano (tiene muchos ' +
      'ficheros). Ya se puede buscar sobre lo indexado; lo nuevo o modificado irá apareciendo. ' +
      'El progreso se ve en estado_servidor.';
  }
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
  return { ok: true, respuesta };
}

export default { fijarSeleccion, abarcaVarios };
