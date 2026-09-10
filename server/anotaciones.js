// Barrido anotado del expediente — la vía para revisar EXHAUSTIVAMENTE lo que no cabe en el
// contexto de un modelo.
//
// El problema: un expediente de 40.000 páginas son ~48 millones de tokens. No caben, ni con
// la ventana más grande que exista. La búsqueda semántica (buscar_documentos) es excelente
// para ENCONTRAR, pero devuelve lo que se parece a la pregunta — y una due diligence vale
// justo por lo que nadie pensó en preguntar.
//
// La solución es la clásica de dos fases:
//   1. BARRIDO  — se recorre el expediente ventana a ventana, cada una se lee entera UNA vez
//                 y deja una ficha estructurada (hechos con su página, no un resumen).
//   2. SÍNTESIS — la due diligence se hace sobre las FICHAS, que ocupan ~1% del original y
//                 sí caben. Las contradicciones salen de cruzar hechos, no de buscar.
//
// Este módulo es el que hace el barrido REANUDABLE: el estado de qué se ha revisado vive en
// disco, no en la conversación. Un barrido de 1.800 ventanas no cabe en un solo chat, y si
// el estado viviera en el hilo, cerrar Claude sería empezar de cero.
//
// Las fichas son metadatos del despacho: se guardan en el directorio de datos del usuario,
// nunca en la carpeta del expediente, y no salen del ordenador (igual que el índice).

import fs from 'node:fs';
import { config, ensureDataDirs, expedienteForLogicalPath } from './config.js';
import { log } from './logger.js';
import * as registry from './indexer/registry.js';
import * as expedientes from './expedientes.js';

// Tamaño de ventana por defecto, en fragmentos (≈22 páginas). Coincide con el tope de
// obtener_documento: es lo que un modelo lee cómodamente de una vez dejando sitio para pensar.
const VENTANA_DEFECTO = (() => {
  const n = parseInt(process.env.ROBIN_VENTANA_REVISION, 10);
  return Number.isFinite(n) && n > 0 && n <= 200 ? n : 60;
})();

// Campos de la ficha que son LISTAS de hechos cruzables. Son los que hacen que una
// contradicción entre dos documentos aparezca sola al agrupar.
export const CAMPOS_CRUZABLES = [
  'fechas',
  'importes',
  'partes',
  'obligaciones',
  'afirmaciones',
  'clausulas_atipicas',
  'alertas',
];

function rutaFichero() {
  return `${config.dataDir}/anotaciones.json`;
}

let _cache = null;
let _mtime = 0;

function mtimeActual() {
  try {
    return fs.statSync(rutaFichero()).mtimeMs;
  } catch {
    return 0;
  }
}

// Mismo patrón que el registro: relee si otro proceso lo tocó, para no servir un estado de
// barrido obsoleto (que se traduciría en revisar dos veces o dar por revisado lo que no).
function cargar() {
  ensureDataDirs();
  const m = mtimeActual();
  if (_cache && m === _mtime) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(rutaFichero(), 'utf8'));
  } catch {
    if (!_cache) _cache = {};
  }
  _mtime = m;
  return _cache;
}

function persistir() {
  ensureDataDirs();
  const tmp = `${rutaFichero()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(_cache, null, 0));
  fs.renameSync(tmp, rutaFichero()); // escritura atómica
  _mtime = mtimeActual();
}

// Entradas del registro que caen dentro del expediente pedido (él y lo que cuelga de él).
function entradasDe(expediente) {
  return registry
    .entries()
    .map(([abs, e]) => ({ abs, ...e }))
    .filter((e) =>
      expedientes.enAmbito(e.expediente || expedienteForLogicalPath(e.rutaRelativa), expediente),
    )
    .sort((a, b) => String(a.rutaRelativa).localeCompare(String(b.rutaRelativa)));
}

// Tamaño de ventana EFECTIVO del expediente. Se fija con la primera ficha y no cambia: si
// cambiara a mitad de barrido, las fichas ya guardadas dejarían de alinearse con el plan y
// habría trozos dados por revisados que en realidad nadie ha leído.
export function ventanaDe(expediente) {
  const est = cargar()[expediente];
  return est?.ventana || VENTANA_DEFECTO;
}

// El plan del barrido: todas las ventanas que hay que leer, en orden estable.
// Un documento SIN TEXTO LEGIBLE (escaneado sin OCR) no genera ventanas — pero tampoco
// desaparece: sale en `no_revisables`. Callarse 300 PDFs escaneados sería exactamente el
// fallo que este módulo existe para evitar.
export function plan(expediente) {
  const ventana = ventanaDe(expediente);
  const ventanas = [];
  const noRevisables = [];
  for (const e of entradasDe(expediente)) {
    const total = e.numChunks || 0;
    if (e.sinOcr || total === 0) {
      noRevisables.push({
        doc_id: e.docId,
        ruta_relativa: e.rutaRelativa,
        motivo: e.sinOcr ? 'sin_texto_legible' : 'sin_fragmentos',
      });
      continue;
    }
    for (let desde = 0; desde < total; desde += ventana) {
      ventanas.push({
        doc_id: e.docId,
        ruta_relativa: e.rutaRelativa,
        desde,
        hasta: Math.min(desde + ventana, total),
        fragmentos_documento: total,
        size: e.size,
        mtimeMs: e.mtimeMs,
      });
    }
  }
  return { ventana, ventanas, no_revisables: noRevisables };
}

// ¿Hay ficha VÁLIDA para esta ventana? Una ficha deja de valer si el documento cambió en
// disco desde que se anotó: el sello es el mismo (size + mtime) que usa el indexado
// incremental, así que un escrito sustituido se vuelve a revisar solo.
function fichaDe(estado, v) {
  const doc = estado?.documentos?.[v.doc_id];
  if (!doc) return null;
  const f = doc.ventanas?.[String(v.desde)];
  if (!f) return null;
  if (doc.size !== v.size || doc.mtimeMs !== v.mtimeMs) return null;
  return f;
}

export function estadoBarrido(expediente) {
  const { ventana, ventanas, no_revisables: noRev } = plan(expediente);
  const estado = cargar()[expediente] || null;
  let revisadas = 0;
  const pendientes = [];
  for (const v of ventanas) {
    if (fichaDe(estado, v)) revisadas += 1;
    else pendientes.push(v);
  }
  const total = ventanas.length;
  return {
    expediente,
    ventana_fragmentos: ventana,
    ventanas_totales: total,
    ventanas_revisadas: revisadas,
    ventanas_pendientes: total - revisadas,
    cobertura: total ? `${Math.round((revisadas / total) * 100)}%` : '—',
    completado: total > 0 && revisadas === total,
    documentos_no_revisables: noRev.length,
    no_revisables: noRev,
    _pendientes: pendientes,
  };
}

// Siguiente ventana por revisar, en orden estable (por ruta, y dentro del documento por
// posición). Es lo que permite que el cliente solo tenga que llamar en bucle.
export function siguiente(expediente) {
  const est = estadoBarrido(expediente);
  return { ventana: est._pendientes[0] || null, estado: est };
}

export function guardar(expediente, docId, desde, ficha) {
  const { ventanas, ventana } = plan(expediente);
  const v = ventanas.find((x) => x.doc_id === docId && x.desde === Number(desde));
  if (!v) {
    return {
      ok: false,
      error:
        `No hay ninguna ventana que empiece en el fragmento ${desde} del documento ${docId} ` +
        'dentro de este expediente. Pide la siguiente con siguiente_por_revisar y anota esa.',
    };
  }

  const todo = cargar();
  const est = (todo[expediente] ??= { ventana, documentos: {} });
  est.ventana ??= ventana;
  const doc = (est.documentos[docId] ??= {
    ruta_relativa: v.ruta_relativa,
    size: v.size,
    mtimeMs: v.mtimeMs,
    ventanas: {},
  });
  // El documento cambió desde que se anotaron sus otras ventanas: se descartan, porque ya no
  // describen lo que hay en disco.
  if (doc.size !== v.size || doc.mtimeMs !== v.mtimeMs) {
    doc.ventanas = {};
    doc.size = v.size;
    doc.mtimeMs = v.mtimeMs;
  }
  doc.ruta_relativa = v.ruta_relativa;
  doc.ventanas[String(desde)] = {
    desde,
    hasta: v.hasta,
    ficha,
    anotado_en: new Date().toISOString(),
  };
  persistir();
  log.info('Ficha de revisión guardada', {
    expediente,
    ruta: v.ruta_relativa,
    desde,
    hasta: v.hasta,
  });
  return { ok: true, ventana: v };
}

// Todas las fichas válidas del expediente, en orden de lectura. Paginado: en un expediente
// grande son cientos, y devolverlas de golpe es justo el desbordamiento que esto evita.
export function todas(expediente, { doc_id = null, desde = 0, limite = 50 } = {}) {
  const { ventanas } = plan(expediente);
  const estado = cargar()[expediente] || null;
  const fichas = [];
  for (const v of ventanas) {
    if (doc_id && v.doc_id !== doc_id) continue;
    const f = fichaDe(estado, v);
    if (!f) continue;
    fichas.push({
      doc_id: v.doc_id,
      ruta_relativa: v.ruta_relativa,
      desde_fragmento: v.desde,
      hasta_fragmento: v.hasta,
      anotado_en: f.anotado_en,
      ...f.ficha,
    });
  }
  const inicio = Math.max(0, Number(desde) || 0);
  const trozo = fichas.slice(inicio, inicio + Math.max(1, Math.min(Number(limite) || 50, 200)));
  return {
    total: fichas.length,
    desde: inicio,
    devueltas: trozo.length,
    siguiente: inicio + trozo.length < fichas.length ? inicio + trozo.length : null,
    fichas: trozo,
  };
}

// Vista CRUZADA: un solo campo de todas las fichas, junto y con su origen. Es el paso que
// hace saltar la contradicción — dos fechas de entrega distintas para la misma obligación
// aparecen una al lado de la otra sin que nadie haya preguntado por ellas.
export function agrupar(expediente, campo) {
  if (!CAMPOS_CRUZABLES.includes(campo)) {
    return {
      ok: false,
      error: `"${campo}" no es un campo cruzable. Usa uno de: ${CAMPOS_CRUZABLES.join(', ')}.`,
    };
  }
  const { fichas } = todas(expediente, { limite: 200000 });
  const filas = [];
  for (const f of fichas) {
    const valores = f[campo];
    if (!Array.isArray(valores)) continue;
    for (const v of valores) {
      filas.push({
        ...(typeof v === 'string' ? { valor: v } : v),
        documento: f.ruta_relativa,
        doc_id: f.doc_id,
        desde_fragmento: f.desde_fragmento,
      });
    }
  }
  return { ok: true, campo, total: filas.length, filas };
}

// Borra el barrido de un expediente (volver a empezar).
export function limpiar(expediente) {
  const todo = cargar();
  const habia = Boolean(todo[expediente]);
  delete todo[expediente];
  persistir();
  return habia;
}

export default {
  plan,
  estadoBarrido,
  siguiente,
  guardar,
  todas,
  agrupar,
  limpiar,
  ventanaDe,
  CAMPOS_CRUZABLES,
};
