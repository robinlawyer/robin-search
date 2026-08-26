// Expedientes — detección y resolución del expediente activo.
//
// Un expediente es la carpeta de un caso (un cliente). El aislamiento entre expedientes es
// el comportamiento POR DEFECTO de RobinSearch: ninguna herramienta de lectura devuelve
// contenido si no se sabe de qué expediente se está hablando. Traer contexto del caso B en
// una consulta sobre el caso A no es ruido: es un riesgo de conflicto de intereses y de
// secreto profesional (art. 21 EGAE / art. 542.3 LOPJ).

import fs from 'node:fs';
import path from 'node:path';
import {
  config,
  expedienteForLogicalPath,
  EXPEDIENTE_SIN_CARPETA,
} from './config.js';
import * as registry from './indexer/registry.js';
import { state } from './state.js';

// Normaliza un nombre para comparar de forma tolerante: sin tildes, minúsculas y con
// cualquier separador (espacio, guion, guion bajo, punto) colapsado a "-". Así el slug del
// matter de Robin Lawyer ("ines-perez-divorcio") casa con la carpeta real del disco
// ("Inés Pérez - Divorcio") sin que el abogado tenga que renombrar nada.
export function slug(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Expedientes presentes EN EL ÍNDICE (los que realmente se pueden consultar), con su recuento
// de documentos y fragmentos.
export function detectarIndexados() {
  const mapa = new Map();
  for (const e of registry.all()) {
    const exp = e.expediente || expedienteForLogicalPath(e.rutaRelativa);
    const acc = mapa.get(exp) || { expediente: exp, documentos: 0, fragmentos: 0, sin_ocr: 0 };
    if (e.sinOcr) acc.sin_ocr += 1;
    else {
      acc.documentos += 1;
      acc.fragmentos += e.numChunks || 0;
    }
    mapa.set(exp, acc);
  }
  return [...mapa.values()].sort((a, b) => a.expediente.localeCompare(b.expediente));
}

// Expedientes presentes EN DISCO bajo las carpetas vigiladas, aunque aún no estén indexados.
// Se usa para que `establecer_expediente_activo` funcione mientras el indexado inicial de un
// caso recién copiado sigue en curso, en lugar de dar un "no existe" engañoso.
export function detectarEnDisco() {
  const out = new Set();
  const depth = config.expedienteDepth;
  for (const root of config.roots) {
    if (depth === 0) {
      out.add(root.name);
      continue;
    }
    // Recorre `depth` niveles de subcarpetas por debajo de la raíz.
    let nivel = [{ abs: root.path, id: root.name }];
    for (let d = 0; d < depth; d += 1) {
      const siguiente = [];
      for (const nodo of nivel) {
        let entries = [];
        try {
          entries = fs.readdirSync(nodo.abs, { withFileTypes: true });
        } catch {
          continue;
        }
        // Un fichero suelto en este nivel hace que la propia carpeta sea un expediente.
        if (entries.some((en) => en.isFile() && !en.name.startsWith('.'))) out.add(nodo.id);
        for (const en of entries) {
          if (!en.isDirectory() || en.name.startsWith('.')) continue;
          const abs = path.join(nodo.abs, en.name);
          if (abs === config.dataDir) continue;
          siguiente.push({ abs, id: `${nodo.id}/${en.name}` });
        }
      }
      nivel = siguiente;
    }
    for (const nodo of nivel) out.add(nodo.id);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

// Catálogo completo: lo indexado (con contadores) más lo que está en disco pendiente de indexar.
export function catalogo() {
  const indexados = detectarIndexados();
  const vistos = new Set(indexados.map((e) => e.expediente));
  const out = [...indexados];
  for (const id of detectarEnDisco()) {
    if (!vistos.has(id)) out.push({ expediente: id, documentos: 0, fragmentos: 0, sin_ocr: 0 });
  }
  return out.sort((a, b) => a.expediente.localeCompare(b.expediente));
}

export function nombresConocidos() {
  return catalogo().map((e) => e.expediente);
}

// Resuelve el nombre que da el cliente contra los expedientes conocidos.
// Cascada de estrategias, de la más estricta a la más tolerante; en cuanto una estrategia
// produce EXACTAMENTE un candidato, gana. Si produce varios, se devuelve ambigüedad con los
// candidatos: NUNCA se elige uno "a ojo", porque elegir mal es exactamente la fuga que esto
// viene a evitar.
export function resolver(nombre) {
  const conocidos = nombresConocidos();
  const bruto = String(nombre ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!bruto) return { ok: false, motivo: 'vacio', conocidos };

  const ultimo = (s) => s.split('/').pop();
  const estrategias = [
    (c) => c === bruto,                                     // id exacto
    (c) => c.toLowerCase() === bruto.toLowerCase(),         // id sin distinguir mayúsculas
    (c) => ultimo(c) === bruto,                             // nombre de la carpeta del caso
    (c) => ultimo(c).toLowerCase() === bruto.toLowerCase(),
    (c) => slug(c) === slug(bruto),                         // slug del id completo
    (c) => slug(ultimo(c)) === slug(bruto),                 // slug de la carpeta del caso
  ];

  for (const test of estrategias) {
    const hits = conocidos.filter(test);
    if (hits.length === 1) return { ok: true, expediente: hits[0], conocidos };
    if (hits.length > 1) return { ok: false, motivo: 'ambiguo', candidatos: hits, conocidos };
  }
  return { ok: false, motivo: 'desconocido', conocidos };
}

export function getActivo() {
  return state.expedienteActivo;
}

export function setActivo(expediente) {
  state.expedienteActivo = expediente || null;
  return state.expedienteActivo;
}

// Núcleo de la política de aislamiento. Devuelve `{ ok, expediente }` o `{ ok:false, error }`
// con un error EXPLÍCITO. Nunca devuelve "todos los expedientes": si no se sabe cuál es, no
// se busca.
export function exigirExpediente(explicito) {
  const pedido = explicito ?? null;

  if (pedido) {
    const r = resolver(pedido);
    if (r.ok) return { ok: true, expediente: r.expediente };
    if (r.motivo === 'ambiguo') {
      return {
        ok: false,
        error: `El expediente "${pedido}" es ambiguo: coincide con varios. Indica cuál con su ruta completa.`,
        extra: { candidatos: r.candidatos, expedientes_disponibles: r.conocidos },
      };
    }
    return {
      ok: false,
      error: `No hay ningún expediente llamado "${pedido}". Elige uno de los disponibles.`,
      extra: { expedientes_disponibles: r.conocidos },
    };
  }

  const activo = getActivo();
  if (activo) {
    // El expediente activo puede haber desaparecido del disco (carpeta renombrada o cerrada).
    const r = resolver(activo);
    if (r.ok) return { ok: true, expediente: r.expediente };
    setActivo(null);
    return {
      ok: false,
      error:
        `El expediente activo ("${activo}") ya no existe: puede que se haya renombrado o movido ` +
        'la carpeta. Vuelve a fijar uno con establecer_expediente_activo.',
      extra: { expedientes_disponibles: r.conocidos },
    };
  }

  const conocidos = nombresConocidos();
  return {
    ok: false,
    error:
      'No hay expediente activo y no se ha indicado ninguno. RobinSearch no busca en todos los ' +
      'expedientes a la vez: cada expediente es un cliente distinto y mezclarlos sería un riesgo ' +
      'de conflicto de intereses y de secreto profesional. Fija el expediente con ' +
      'establecer_expediente_activo, o pasa el parámetro "expediente" en esta llamada.',
    extra: { expedientes_disponibles: conocidos },
  };
}

// ¿La ruta lógica de un documento pertenece al expediente dado?
export function perteneceA(rutaLogica, expediente) {
  if (!expediente) return false;
  const exp = expedienteForLogicalPath(rutaLogica);
  return exp === expediente;
}

export default {
  slug,
  detectarIndexados,
  detectarEnDisco,
  catalogo,
  nombresConocidos,
  resolver,
  getActivo,
  setActivo,
  exigirExpediente,
  perteneceA,
  EXPEDIENTE_SIN_CARPETA,
};
