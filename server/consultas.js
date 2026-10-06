// «¿Qué ha cambiado desde la última vez?», SIN que el abogado lo pregunte (nota de mejora de
// Juan, 6-oct-2026): «que Robin detecte reactivamente qué ha cambiado y lo comunique al abogado
// cuando este haga la primera consulta en el chat sobre ese asunto».
//
// cambios_expediente compara con el último BARRIDO de revisión, y la mayoría de los abogados no
// hace barridos: consulta. Aquí la referencia es su última CONSULTA del expediente. Por cada
// expediente se guarda una foto (qué documentos había, con su tamaño y fecha) y cuándo se
// consultó por última vez. La primera llamada sobre ese expediente después de una pausa (30 min
// por defecto, ROBIN_PAUSA_CONSULTA_MIN) o de reiniciar el servidor compara el índice con la
// foto: documentos nuevos, modificados, retirados y llegados sin texto legible. Si hay algo, va
// en la respuesta de esa herramienta para que Claude se lo diga al abogado antes de contestar.
// Una vez por sesión de consulta; la foto se refresca mientras el abogado trabaja.
//
// Todo es local: la foto vive en el directorio de datos del usuario (consultas.json), como el
// índice y las anotaciones, y no sale del ordenador.

import fs from 'node:fs';
import { config, ensureDataDirs, expedienteForLogicalPath } from './config.js';
import { log } from './logger.js';
import { conCerrojoDeFichero, escribirJson, leerJson } from './persistencia.js';
import * as registry from './indexer/registry.js';
import * as expedientes from './expedientes.js';

const PAUSA_MS = (() => {
  const n = parseFloat(process.env.ROBIN_PAUSA_CONSULTA_MIN);
  return (Number.isFinite(n) && n >= 0 ? n : 30) * 60 * 1000;
})();
const REFRESCO_MS = 60 * 1000;
const MAX_LISTA = 25;

// Herramientas que son «una consulta sobre el expediente».
export const HERRAMIENTAS_CONSULTA = new Set([
  'buscar_documentos',
  'obtener_documento',
  'obtener_fragmento',
  'indice_documento',
  'leer_seccion',
  'listar_documentos_indexados',
  'establecer_expediente_activo',
  'siguiente_por_revisar',
  'obtener_anotaciones',
]);

// Última actividad por expediente EN ESTE PROCESO (y cuándo se refrescó su foto).
const actividad = new Map();

function rutaFichero() {
  return `${config.dataDir}/consultas.json`;
}

function cargar() {
  ensureDataDirs();
  const r = leerJson(rutaFichero());
  return r.estado === 'ok' && r.valor && typeof r.valor === 'object' ? r.valor : {};
}

function modificar(fn) {
  ensureDataDirs();
  return conCerrojoDeFichero(rutaFichero(), () => {
    const todo = cargar();
    const r = fn(todo);
    escribirJson(rutaFichero(), todo, { bak: true });
    return r;
  });
}

function entradasDe(expediente) {
  return registry
    .entries()
    .map(([abs, e]) => ({ abs, ...e }))
    .filter((e) =>
      expedientes.enAmbito(e.expediente || expedienteForLogicalPath(e.rutaRelativa), expediente),
    );
}

function foto(expediente) {
  const docs = {};
  for (const e of entradasDe(expediente)) {
    docs[e.docId] = { r: e.rutaRelativa, s: e.size ?? null, m: e.mtimeMs ?? null };
  }
  return docs;
}

// Compara el índice de ahora con la foto. Puro, para poder probarlo.
export function comparar(fotoAnterior, entradas) {
  const nuevos = [];
  const modificados = [];
  const sinTexto = [];
  const vistos = new Set();
  for (const e of entradas) {
    vistos.add(e.docId);
    const antes = fotoAnterior[e.docId];
    const base = {
      ruta_relativa: e.rutaRelativa,
      modificado_en: e.mtimeMs != null ? new Date(e.mtimeMs).toISOString() : null,
    };
    if (!antes) {
      if (e.sinOcr || !e.numChunks) sinTexto.push(base);
      else nuevos.push(base);
    } else if ((antes.s ?? null) !== (e.size ?? null) || (antes.m ?? null) !== (e.mtimeMs ?? null)) {
      modificados.push(base);
    }
  }
  const retirados = Object.entries(fotoAnterior)
    .filter(([id]) => !vistos.has(id))
    .map(([, v]) => ({ ruta_relativa: v.r }));
  const orden = (a, b) => String(a.ruta_relativa).localeCompare(String(b.ruta_relativa));
  return {
    nuevos: nuevos.sort(orden),
    modificados: modificados.sort(orden),
    retirados: retirados.sort(orden),
    sin_texto: sinTexto.sort(orden),
  };
}

function fechaLegible(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })
    : iso;
}

// Llamada tras cada consulta sobre `expediente`. Devuelve el bloque para la respuesta si es la
// primera de una sesión de consulta y algo ha cambiado; si no, null.
export function alConsultar(expediente, ahora = Date.now()) {
  if (!expediente) return null;
  const previa = actividad.get(expediente);
  actividad.set(expediente, { ultima: ahora, refrescada: previa?.refrescada ?? 0 });
  const enSesion = previa && ahora - previa.ultima < PAUSA_MS;
  try {
    if (enSesion) {
      // Seguimos en la misma sesión: solo se mantiene la foto al día (lo que llegue mientras
      // trabaja ya lo está viendo; se contará como cambio solo si llega DESPUÉS de esta sesión).
      if (ahora - previa.refrescada >= REFRESCO_MS) {
        const docs = foto(expediente);
        modificar((todo) => {
          todo[expediente] = { ...(todo[expediente] || {}), docs, ultima: new Date(ahora).toISOString() };
        });
        actividad.set(expediente, { ultima: ahora, refrescada: ahora });
      }
      return null;
    }
    const entradas = entradasDe(expediente);
    const guardado = cargar()[expediente];
    const docs = {};
    for (const e of entradas) docs[e.docId] = { r: e.rutaRelativa, s: e.size ?? null, m: e.mtimeMs ?? null };
    modificar((todo) => {
      todo[expediente] = { docs, ultima: new Date(ahora).toISOString() };
    });
    actividad.set(expediente, { ultima: ahora, refrescada: ahora });
    if (!guardado?.docs) return null; // primera vez: no hay con qué comparar
    const c = comparar(guardado.docs, entradas);
    const recuento = {
      nuevos: c.nuevos.length,
      modificados: c.modificados.length,
      retirados: c.retirados.length,
      sin_texto: c.sin_texto.length,
    };
    if (!recuento.nuevos && !recuento.modificados && !recuento.retirados && !recuento.sin_texto) {
      return null;
    }
    log.info('Cambios desde la última consulta', { expediente, ...recuento });
    const recortar = (l) => l.slice(0, MAX_LISTA);
    return {
      expediente,
      ultima_consulta: guardado.ultima,
      recuento,
      nuevos: recortar(c.nuevos),
      modificados: recortar(c.modificados),
      retirados: recortar(c.retirados),
      sin_texto: recortar(c.sin_texto),
      ...(Object.values(recuento).some((n) => n > MAX_LISTA)
        ? { nota_listas: `Listas recortadas a ${MAX_LISTA}; el detalle completo, con cambios_expediente.` }
        : {}),
      aviso_al_abogado:
        `ANTES de contestar a lo que ha preguntado, dile al abogado en una o dos líneas qué ha ` +
        `cambiado en este expediente desde su última consulta (${fechaLegible(guardado.ultima)}): ` +
        'cuántos documentos nuevos, modificados y retirados, nombrándolos si son pocos, y los que ' +
        'han llegado sin texto legible (zona ciega). Ofrécele revisarlos (para un repaso ' +
        'completo, siguiente_por_revisar o cambios_expediente). Díselo una sola vez y sigue con ' +
        'su pregunta. Si acaba de copiar ficheros y el índice aún trabaja (estado_servidor), ' +
        'adviértelo: puede que falte alguno.',
    };
  } catch (err) {
    log.warn('No se pudo comparar con la última consulta', { expediente, err: String(err) });
    return null;
  }
}

// Expediente al que va una llamada: el explícito o el activo. Sin error si no hay (la propia
// herramienta ya lo habrá dicho).
export function expedienteDeLaLlamada(args) {
  const g = expedientes.exigirExpediente(args?.expediente ?? null);
  return g.ok ? g.expediente : null;
}

// Para las pruebas.
export function _olvidarActividad() {
  actividad.clear();
}

export function _existeFichero() {
  return fs.existsSync(rutaFichero());
}
