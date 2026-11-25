// Expedientes — detección y resolución del expediente activo.
//
// Un expediente es la carpeta de un caso (un cliente). El aislamiento entre expedientes es
// el comportamiento POR DEFECTO de RobinSearch: ninguna herramienta de lectura devuelve
// contenido si no se sabe de qué expediente se está hablando. Traer contexto del caso B en
// una consulta sobre el caso A no es ruido: es un riesgo de conflicto de intereses y de
// secreto profesional (art. 21 EGAE / art. 542.3 LOPJ).

import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import {
  config,
  expedienteForLogicalPath,
  EXPEDIENTE_SIN_CARPETA,
} from './config.js';
import * as registry from './indexer/registry.js';
import { rutas, tipoReal } from './rutas.js';
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
        // tipoReal y no isFile()/isDirectory(): en Windows las carpetas de OneDrive/SharePoint
        // bajo demanda y las junctions llegan como «enlace» y no salían como expedientes.
        let haySuelto = false;
        for (const en of entries) {
          if (en.name.startsWith('.')) continue;
          const abs = path.join(nodo.abs, en.name);
          const tipo = tipoReal(abs, en);
          if (tipo === 'fichero') haySuelto = true;
          if (tipo !== 'carpeta' || rutas.dentroDe(abs, config.dataDir)) continue;
          siguiente.push({ abs, id: `${nodo.id}/${en.name}` });
        }
        // Un fichero suelto en este nivel hace que la propia carpeta sea un expediente.
        if (haySuelto) out.add(nodo.id);
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
  // Primero el id EXACTO, sin recortar: «R/Caso » y «R/Caso» pueden ser dos clientes (revisión de
  // Codex, 25-nov, 7.ª ronda).
  const crudo = String(nombre ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (crudo.trim() && conocidos.includes(crudo)) return { ok: true, expediente: crudo, conocidos };
  const bruto = crudo.trim().replace(/^\/+|\/+$/g, '');
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

// Ruta absoluta en disco de un expediente. El id es `nombreRaíz/subcarpetas...`, así que se
// traduce contra la raíz configurada. Devuelve null si el expediente no cuelga de ninguna.
export function rutaAbsoluta(expedienteId) {
  if (!expedienteId || expedienteId === EXPEDIENTE_SIN_CARPETA) return null;
  const [nombreRaiz, ...resto] = String(expedienteId).split('/');
  const raiz = config.roots.find((x) => x.name === nombreRaiz);
  if (!raiz) return null;
  return resto.length ? path.join(raiz.path, ...resto) : raiz.path;
}

// La SELECCIÓN de trabajo es una lista de expedientes. Lo normal es uno; varios cuando el
// abogado lo pide expresamente (un asunto con la documentación repartida en carpetas separadas,
// o dos casos conexos). Hacia fuera se conserva la forma de siempre: `getActivo()` devuelve un
// texto si hay uno, una lista si hay varios y null si no hay ninguno, para no romper a quien ya
// lee `expediente_activo` como texto.
// Sin recortar: el resolvedor prueba primero el texto tal cual (un id puede acabar en espacio) y
// después la versión recortada (revisión de Codex, 7.ª ronda).
export function normalizarSeleccion(x) {
  return listaIds(x);
}

// Ids que YA son del catálogo (resueltos): se guardan y comparan tal cual, sin recortar. Recortar
// convertía «R/Caso » en «R/Caso», que puede ser otro expediente (revisión de Codex, 7.ª ronda).
// normalizarSeleccion (con trim) es solo para lo que escribe el cliente, antes de resolverlo.
export function listaIds(x) {
  const lista = (Array.isArray(x) ? x : [x]).filter((v) => typeof v === 'string' && v.trim() !== '');
  return [...new Set(lista)];
}

function formaPublica(lista) {
  if (!lista || lista.length === 0) return null;
  return lista.length === 1 ? lista[0] : [...lista];
}

// Para los mensajes: «Madre/Pérez» o «Madre/Pérez» + «Madre/García».
export function etiqueta(sel) {
  return listaIds(sel).map((e) => `«${e}»`).join(' + ') || '(ninguno)';
}

export function getActivo() {
  return formaPublica(state.expedientesActivos);
}

export function getActivos() {
  return [...(state.expedientesActivos || [])];
}

// VARIAS CONVERSACIONES A LA VEZ (27-oct-2026, al estudiar RobinSearch como conector remoto).
// Claude Desktop arranca UN proceso de RobinSearch y lo comparten todos sus chats; el protocolo
// no dice de qué chat viene cada llamada. Con el abogado en dos asuntos a la vez (Pérez en un
// chat, Acme en otro), el segundo `establecer_expediente_activo` cambiaba el expediente del
// primero, y la siguiente búsqueda de ese chat sin «expediente» contestaba con documentos del
// otro cliente, sin error. Ahora se recuerda qué expedientes se han fijado hace poco: si hay más
// de uno, una llamada que no diga el suyo NO se resuelve con el activo (podría ser el de la otra
// conversación) y se pide que lo indique. Con un solo asunto todo sigue igual.
const VENTANA_MS = (() => {
  const n = parseFloat(process.env.ROBIN_VENTANA_VARIOS_EXPEDIENTES_MIN);
  return (Number.isFinite(n) && n >= 0 ? n : 8 * 60) * 60 * 1000;
})();
const _fijados = new Map(); // expediente → cuándo se fijó por última vez

export function setActivo(expediente) {
  const lista = listaIds(expediente);
  state.expedientesActivos = lista;
  // OJO: sumar con «anadir» NO borra la selección anterior de la memoria. El servidor no sabe de
  // qué conversación viene la llamada: si la ampliación la hizo OTRO chat, borrarla haría pasar
  // la barrera a los dos (revisión de Codex, 25-nov). Tras «anadir», las lecturas piden el
  // parámetro "expediente" durante la ventana: más pesado, pero nunca mezcla clientes.
  // Cerrar un asunto deja a TODAS las conversaciones sin activo, pero NO borra la memoria de lo
  // fijado: si un chat cierra el suyo y otro fija C, un tercero que siguiera con A sin indicarlo
  // recibiría C (revisión de Codex, 25-nov). Lo fijado caduca solo, con la ventana. Una selección
  // de varios cuenta como UNA selección (la de una conversación).
  if (lista.length) _fijados.set(claveSeleccion(lista), { t: Date.now(), etiqueta: etiquetaSeleccion(lista) });
  return getActivo();
}

// Clave con la que se recuerda una selección: inequívoca (la lista ordenada en JSON: una carpeta
// que se llame «A + B» no coincide con la selección de A y B) y sin depender del orden. Para los
// mensajes, la etiqueta: el expediente si es uno (como en la 1.12.6) y «A + B» si son varios.
export function claveSeleccion(lista) {
  return JSON.stringify([...listaIds(lista)].sort());
}

function etiquetaSeleccion(lista) {
  const l = listaIds(lista);
  return l.length === 1 ? l[0] : [...l].sort().join(' + ');
}

// Se dice en la respuesta de las herramientas que fijan la selección. Claude Desktop arranca UN
// solo RobinSearch para todas sus conversaciones, así que la selección es común a todas: si el
// abogado abre el caso García en otra conversación y vuelve a esta, sin el parámetro explícito
// buscaría en García sin que nadie lo notase.
export const AVISO_CONVERSACIONES =
  'El expediente activo es COMÚN a todas las conversaciones abiertas en Claude: si en otra se ' +
  'elige otro, cambia también aquí. En el resto de esta conversación pasa SIEMPRE el parámetro ' +
  '"expediente" con este mismo valor en cada llamada a RobinSearch, y no confíes en el activo.';

function resolverUno(pedido) {
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

// Resuelve una lista entera: si UNO solo falla, falla todo (buscar en «los que sí» sin decirlo
// dejaría fuera un caso que el abogado cree estar consultando).
export function resolverVarios(pedidos) {
  const out = [];
  for (const p of normalizarSeleccion(pedidos)) {
    const r = resolverUno(p);
    if (!r.ok) return r;
    if (!out.includes(r.expediente)) out.push(r.expediente);
  }
  if (out.length === 0) return { ok: false, error: 'No se ha indicado ningún expediente.', extra: {} };
  return { ok: true, expedientes: out };
}

// ¿Cae `t` dentro de la ventana de «varias conversaciones»? (0 = ventana apagada.)
export function enVentanaDeConversaciones(t, ahora = Date.now()) {
  return VENTANA_MS > 0 && ahora - t <= VENTANA_MS;
}

// Otros expedientes fijados dentro de la ventana, además del activo.
export function otrosFijadosRecientes(ahora = Date.now()) {
  if (VENTANA_MS === 0) return []; // 0 = como hasta la 1.12.5 (pruebas de una sola conversación)
  const activa = getActivos().length ? claveSeleccion(getActivos()) : null;
  return [..._fijados]
    .filter(([clave, f]) => clave !== activa && ahora - f.t <= VENTANA_MS)
    .map(([, f]) => f.etiqueta);
}

// Núcleo de la política de aislamiento. Devuelve `{ ok, expediente }` o `{ ok:false, error }`
// con un error EXPLÍCITO. Nunca devuelve "todos los expedientes": si no se sabe cuál es, no
// se busca. `expediente` es un texto si la selección es de uno y una lista si es de varios;
// enAmbito/ambito/contadoresAmbito aceptan las dos formas.
// El expediente que ha usado DE VERDAD cada llamada a una herramienta (index.js la ejecuta dentro
// de `ambitoLlamada.run`). Con varias conversaciones a la vez, el activo global puede cambiar a
// mitad de una llamada; el aviso de cambios tiene que hablar del expediente que esa llamada leyó
// (revisión de Codex, 25-nov).
export const ambitoLlamada = new AsyncLocalStorage();
export function anotarAmbito(expediente) {
  const s = ambitoLlamada.getStore();
  if (s) s.expediente = expediente;
}

export function exigirExpediente(explicito) {
  const g = exigirExpedienteSinAnotar(explicito);
  if (g.ok) {
    anotarAmbito(g.expediente);
    // Una lectura con el expediente EXPLÍCITO también cuenta como «este expediente está en uso»:
    // si otra conversación fija otro después, la que leía este sin fijarlo no hereda el ajeno en
    // su siguiente llamada sin parámetro (revisión de Codex, 25-nov).
    // Y también la lectura del ACTIVO sin parámetro: esta conversación sigue usándolo, así que si
    // otra fija otro, la barrera tiene que saltar (revisión de Codex, 5.ª ronda).
    recordarSeleccion(g.expedientes);
  }
  return g;
}

// También renueva la hora de la selección ACTIVA: si su apunte había caducado y otra conversación
// fija otra después, la que la leía de forma explícita no se queda sin barrera (Codex, 25-nov).
function recordarSeleccion(lista) {
  _fijados.set(claveSeleccion(lista), { t: Date.now(), etiqueta: etiquetaSeleccion(lista) });
}

// Los activos, si TODOS siguen en el catálogo con su id exacto; si no, null.
function idsVigentes(activos) {
  const conocidos = new Set(nombresConocidos());
  return activos.every((id) => conocidos.has(id)) ? [...activos] : null;
}

function exigirExpedienteSinAnotar(explicito) {
  const pedidos = normalizarSeleccion(explicito ?? []);

  if (pedidos.length) {
    const r = resolverVarios(pedidos);
    if (!r.ok) return r;
    return { ok: true, expediente: formaPublica(r.expedientes), expedientes: r.expedientes };
  }

  const activos = getActivos();
  let vigentes = null;
  // Primero, que el activo siga existiendo (antes de la barrera: si no, un activo desaparecido se
  // quedaba fijado y bloqueando; revisión de Codex, 6.ª ronda). Coincidencia EXACTA: los ids ya
  // se resolvieron al fijarlos, y pasarlos otra vez por el resolvedor tolerante podría convertir
  // un «Cliente-Ana» desaparecido en «Cliente Ana», que es otro cliente (5.ª ronda).
  if (activos.length) {
    vigentes = idsVigentes(activos);
    if (!vigentes) {
      setActivo(null);
      return {
        ok: false,
        error:
          `El expediente activo (${etiqueta(activos)}) ya no existe: puede que se haya renombrado o ` +
          'movido la carpeta. Vuelve a fijarlo con elegir_expediente o establecer_expediente_activo.',
        extra: { expedientes_disponibles: nombresConocidos() },
      };
    }
  }
  const otros = activos.length ? otrosFijadosRecientes() : [];
  if (otros.length) {
    const activa = etiquetaSeleccion(activos);
    return {
      ok: false,
      error:
        `En este Claude se han fijado hace poco varios expedientes (${[activa, ...otros].join(', ')}), ` +
        'seguramente desde conversaciones distintas, y el expediente activo es uno solo para todas: ' +
        'podría ser el de otra conversación. RobinSearch no lo adivina, porque mezclar clientes es un ' +
        'riesgo de secreto profesional. Repite la llamada indicando el expediente de ESTA conversación ' +
        'en el parámetro "expediente", y sigue indicándolo en las siguientes.',
      extra: { expediente_activo: getActivo(), expedientes_recientes: [activa, ...otros], expedientes_disponibles: nombresConocidos() },
    };
  }
  if (vigentes) {
    return { ok: true, expediente: formaPublica(vigentes), expedientes: vigentes };
  }

  const conocidos = nombresConocidos();
  return {
    ok: false,
    error:
      'No hay expediente activo y no se ha indicado ninguno. RobinSearch no busca en todos los ' +
      'expedientes a la vez: cada expediente es un cliente distinto y mezclarlos sería un riesgo ' +
      'de conflicto de intereses y de secreto profesional. Pregunta al abogado en qué expediente ' +
      'trabajar (elegir_expediente le abre la ventana de carpetas) o pasa el parámetro ' +
      '"expediente" en esta llamada.',
    extra: { expedientes_disponibles: conocidos },
  };
}

// La misma puerta para lo que actúa sobre UN expediente concreto: escribir (anotar, archivar un
// correo) o llevar su cuenta (barrido, cambios). Con varios seleccionados no se elige uno «a
// ojo»: se pide cuál, que es el mismo criterio que con un nombre ambiguo.
export function exigirExpedienteUnico(explicito) {
  const g = exigirExpediente(explicito);
  if (!g.ok) return g;
  if (g.expedientes.length === 1) return { ok: true, expediente: g.expedientes[0], expedientes: g.expedientes };
  return {
    ok: false,
    error:
      `Hay varios expedientes seleccionados (${etiqueta(g.expedientes)}) y esta operación es sobre ` +
      'UNO: indica en cuál con el parámetro "expediente".',
    extra: { motivo: 'varios_expedientes', expedientes_activos: g.expedientes },
  };
}

// ¿Está `exp` DENTRO del expediente seleccionado? Un expediente incluye lo que cuelga de él.
//
// Por qué no basta la igualdad: el abogado elige la carpeta al instalar, y si elige la del
// CASO (en vez de la carpeta madre) sus subcarpetas pasan a ser expedientes por derecho
// propio — "Caso", "Caso/01 Demanda", "Caso/02 Prueba". Con igualdad estricta, fijar "Caso"
// dejaba fuera sus propias subcarpetas y la búsqueda contestaba con los sueltos de la raíz,
// SIN error: el abogado creía haber buscado en el expediente entero y no era verdad.
// La comparación es POR SEGMENTOS, así que "Madre/Pérez" nunca alcanza a "Madre/Pérez - Divorcio":
// el aislamiento entre casos HERMANOS —que es el que protege el secreto profesional— intacto.
// `seleccionado` puede ser una lista: basta con estar dentro de UNO de ellos.
export function enAmbito(exp, seleccionado) {
  if (!seleccionado || !exp) return false;
  if (Array.isArray(seleccionado)) return seleccionado.some((s) => enAmbito(exp, s));
  return exp === seleccionado || String(exp).startsWith(`${seleccionado}/`);
}

// Los expedientes conocidos que caen dentro de la selección (ella incluida).
export function ambito(seleccionado) {
  if (!seleccionado || (Array.isArray(seleccionado) && seleccionado.length === 0)) return [];
  return nombresConocidos().filter((c) => enAmbito(c, seleccionado));
}

// Contadores sumados de todo el ámbito, para no anunciar "0 documentos" sobre un caso que sí
// los tiene repartidos en subcarpetas.
export function contadoresAmbito(seleccionado) {
  const acc = { documentos: 0, fragmentos: 0, sin_ocr: 0 };
  for (const e of catalogo()) {
    if (!enAmbito(e.expediente, seleccionado)) continue;
    acc.documentos += e.documentos;
    acc.fragmentos += e.fragmentos;
    acc.sin_ocr += e.sin_ocr;
  }
  return acc;
}

// ¿La ruta lógica de un documento pertenece al expediente dado?
export function perteneceA(rutaLogica, expediente) {
  if (!expediente) return false;
  return enAmbito(expedienteForLogicalPath(rutaLogica), expediente);
}

// Una carpeta del disco (la que el abogado elige en la ventana del sistema) → su expediente.
//   · fuera de las carpetas vigiladas          → { ok:false, motivo:'fuera' }
//   · la carpeta vigilada misma (o un nivel intermedio, con expedienteDepth > 1)
//                                               → { ok:false, motivo:'raiz', raiz, contiene }
//   · dentro de un expediente (o él mismo)      → { ok:true, expediente, exacta }
// Una subcarpeta de un caso («Pérez/02 Prueba») da el caso entero: el aislamiento es por
// expediente, y buscar solo en una parte se hace con el parámetro `subcarpeta` de la búsqueda.
export function expedienteDeCarpeta(absPath) {
  let abs = path.resolve(String(absPath || ''));
  try { abs = fs.realpathSync.native(abs); } catch { /* si no existe, se compara tal cual */ }
  // La raíz también por su ruta real: /tmp → /private/tmp en macOS, unidades mapeadas…
  const roots = (config.roots || []).map((r) => {
    let real = r.real || r.path;
    try { real = fs.realpathSync.native(r.path); } catch { /* ídem */ }
    return { ...r, real };
  });
  const hit = rutas.raizDe(roots, abs);
  if (!hit) return { ok: false, motivo: 'fuera' };
  const raiz = hit.raiz;
  const rel = rutas.relativaDentro(abs, hit.base);
  const segmentos = String(rel || '').split(process.platform === 'win32' ? /[\\/]+/ : path.sep).filter(Boolean);
  const depth = config.expedienteDepth;
  if (segmentos.length < depth) {
    const prefijo = [raiz.name, ...segmentos].join('/');
    return {
      ok: false,
      motivo: 'raiz',
      raiz: prefijo,
      contiene: nombresConocidos().filter((c) => c.startsWith(`${prefijo}/`)),
    };
  }
  const id = [raiz.name, ...segmentos.slice(0, depth)].join('/');
  // Con el nombre exacto del disco (caja y forma Unicode), que es como está en el índice.
  // resolver() prueba primero el id tal cual (sin recortar espacios finales).
  const r = resolver(id);
  return { ok: true, expediente: r.ok ? r.expediente : id, exacta: segmentos.length === depth };
}

export default {
  slug,
  detectarIndexados,
  detectarEnDisco,
  catalogo,
  nombresConocidos,
  resolver,
  resolverVarios,
  normalizarSeleccion,
  listaIds,
  etiqueta,
  enAmbito,
  ambito,
  contadoresAmbito,
  getActivo,
  getActivos,
  setActivo,
  otrosFijadosRecientes,
  exigirExpediente,
  exigirExpedienteUnico,
  expedienteDeCarpeta,
  perteneceA,
  AVISO_CONVERSACIONES,
  EXPEDIENTE_SIN_CARPETA,
};
