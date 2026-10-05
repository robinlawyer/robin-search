// Estructura de un documento INDEXADO, calculada al vuelo.
//
// El índice vectorial guarda los fragmentos sin saltos de línea (chunkPages une las palabras con un
// espacio), y sin saltos no se ven los rótulos. Así que el texto se vuelve a leer del fichero con
// los saltos (extractFile con `conSaltos`) y se comprueba, palabra por palabra, que es EXACTAMENTE
// lo que está indexado: los mismos fragmentos, carácter a carácter. Solo entonces el índice es
// «exacto» y cada fragmento de buscar_documentos cae en su sección sin margen de error.
//
// Si no se puede (escaneado: volver a pasar el OCR serían minutos; fichero cambiado desde el
// indexado, borrado o ilegible), el texto se reconstruye de los propios fragmentos, sin saltos, y
// el índice sale «aproximado»: solo con los rótulos inconfundibles. Se dice siempre cuál de los dos
// es.
//
// Nada se escribe en disco ni sale del ordenador. Caché pequeña en memoria por (docId, fecha,
// tamaño, nº de fragmentos).

import fs from 'node:fs';
import { config } from '../config.js';
import { log } from '../logger.js';
import * as store from '../search/store.js';
import * as registry from '../indexer/registry.js';
import { extractFile } from '../indexer/extract.js';
import { chunkPages } from '../indexer/chunk.js';
import { construirArbol, remisiones as buscarRemisiones, nodoEn, claveDeId, plegar, RE_ORDINAL } from './arbol.js';
import { localizar } from './piezas.js';

const TOKENS_PER_WORD = 1.4; // el mismo factor que chunk.js
const MAX_EN_CACHE = 24;
const _cache = new Map();

function pasos() {
  const target = Math.max(1, Math.floor(config.chunkSizeTokens / TOKENS_PER_WORD));
  const overlap = Math.min(Math.max(1, Math.floor(config.chunkOverlapTokens / TOKENS_PER_WORD)), target - 1);
  return { target, overlap, step: Math.max(1, target - overlap) };
}

// Páginas → texto global (páginas separadas por una línea en blanco) + tramo de cada fragmento.
// Replica chunkPages: mismas ventanas de palabras, mismo orden, mismos chunkId.
function montar(pages) {
  const { target, step } = pasos();
  let texto = '';
  const paginas = [];
  const tramos = [];
  let chunkId = 0;
  for (const { page, text } of pages) {
    const t = String(text || '').normalize('NFC');
    const posiciones = [...t.matchAll(/\S+/g)].map((m) => [m.index, m.index + m[0].length]);
    if (!posiciones.length) continue;
    if (texto) texto += '\n\n';
    const base = texto.length;
    paginas.push({ pagina: page ?? null, inicio: base, fin: base + t.length });
    texto += t;
    for (let start = 0; start < posiciones.length; start += step) {
      const finPal = Math.min(start + target, posiciones.length);
      tramos.push({ chunkId: chunkId++, pagina: page ?? null, inicio: base + posiciones[start][0], fin: base + posiciones[finPal - 1][1] });
      if (start + target >= posiciones.length) break;
    }
  }
  return { texto, paginas, tramos };
}

// Texto reconstruido de los fragmentos indexados (sin saltos): se quita el solape entre ventanas.
function desdeFragmentos(chunks) {
  const { overlap } = pasos();
  const porPagina = [];
  let actual = null;
  for (const c of chunks) {
    const pg = c.pagina ?? null;
    const palabras = String(c.texto || '').split(/\s+/).filter(Boolean);
    if (!actual || actual.page !== pg) {
      actual = { page: pg, words: [...palabras] };
      porPagina.push(actual);
    } else {
      actual.words.push(...palabras.slice(Math.min(overlap, palabras.length)));
    }
  }
  return porPagina.map((p) => ({ page: p.page, text: p.words.join(' ') }));
}

function rutaAbsoluta(docId) {
  return registry.rutaDeDocId ? registry.rutaDeDocId(docId) : null;
}

function mismoFichero(abs, entry) {
  try {
    const st = fs.statSync(abs);
    return st.size === entry.size && st.mtimeMs === entry.mtimeMs;
  } catch {
    return false;
  }
}

// ¿Lo leído con saltos da EXACTAMENTE los fragmentos indexados?
function casaConIndice(pages, chunks) {
  const nuevos = chunkPages(pages, {
    chunkSizeTokens: config.chunkSizeTokens,
    chunkOverlapTokens: config.chunkOverlapTokens,
  });
  if (nuevos.length < chunks.length) return false;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const n = nuevos[i];
    if (Number(c.chunkId) !== n.chunkId) return false;
    if ((c.texto || '') !== n.text) return false;
    if ((c.pagina ?? null) !== (n.page ?? null)) return false;
  }
  return true;
}

// { ok, docId, entry, modo: 'exacto'|'aproximado', motivo?, texto, paginas, tramos, arbol,
//   remisiones, porId }  |  { ok: false, motivo }
const _enCurso = new Map();

// Ya calculada y al día, sin esperar a nada (o null).
export function estructuraEnCache(docId) {
  return _cache.get(docId)?.valor ?? null;
}

// Una sola lectura por documento aunque la pidan a la vez varias llamadas.
export function estructuraDe(docId, opciones = {}) {
  const enMarcha = _enCurso.get(docId);
  if (enMarcha) return enMarcha;
  const p = calcular(docId, opciones).finally(() => _enCurso.delete(docId));
  _enCurso.set(docId, p);
  return p;
}

async function calcular(docId, { entry = null, chunks = null } = {}) {
  entry = entry ?? registry.porDocId(docId);
  chunks = chunks ?? (await store.getDocChunks(docId));
  if (!chunks.length) return { ok: false, motivo: 'sin_fragmentos' };

  const clave = `${entry?.mtimeMs ?? '-'}:${entry?.size ?? '-'}:${chunks.length}:${config.chunkSizeTokens}:${config.chunkOverlapTokens}`;
  const enCache = _cache.get(docId);
  if (enCache && enCache.clave === clave) {
    _cache.delete(docId);
    _cache.set(docId, enCache); // LRU
    return enCache.valor;
  }

  let pages = null;
  let modo = 'aproximado';
  let motivo = null;
  const abs = entry ? rutaAbsoluta(docId) : null;
  if (!entry || !abs) motivo = 'sin_registro';
  else if (!mismoFichero(abs, entry)) motivo = 'fichero_cambiado_o_ausente';
  else {
    try {
      const x = await extractFile(abs, { maxPages: config.maxPagesPerFile, conSaltos: true, sinOcrNuevo: true });
      if (x.escaneado) motivo = 'escaneado';
      else if (casaConIndice(x.pages, chunks)) {
        pages = x.pages;
        modo = 'exacto';
      } else motivo = 'no_casa_con_el_indice';
    } catch (err) {
      motivo = 'ilegible';
      log.warn('Estructura: no se pudo releer el fichero', { code: err?.code || null });
    }
  }
  if (!pages) pages = desdeFragmentos(chunks);

  const { texto, paginas, tramos } = montar(pages);
  const arbol = construirArbol(texto, { plano: modo !== 'exacto' });
  const rem = buscarRemisiones(texto, arbol);
  const porId = new Map(arbol.nodos.map((n) => [n.id, n]));
  // Solo los fragmentos que de verdad están indexados (el tope por documento puede dejar fuera la cola).
  const valor = { ok: true, docId, entry, modo, motivo, texto, paginas, tramos: tramos.slice(0, chunks.length), arbol, remisiones: rem, porId };
  _cache.set(docId, { clave, valor });
  while (_cache.size > MAX_EN_CACHE) _cache.delete(_cache.keys().next().value);
  return valor;
}

// Las piezas de texto del documento que lleva la descripción de un nodo (piezas.js): su título, su
// arranque y, si el rótulo es texto del propio documento («DECLARACIÓN DE …», el nombre de un
// adjunto), su etiqueta.
export function piezasDeNodo(est, n) {
  if (!n) return [];
  const out = [];
  for (const v of [n.titulo, n.arranque, ['rotulo', 'bloque', 'adjunto'].includes(n.tipo) ? n.etiqueta : null]) {
    const p = v ? localizar(est.texto, v, n.inicio) : null;
    if (p && p.inicio < n.fin + 200) out.push(p);
  }
  return out;
}

// …y las de una remisión: los nodos de destino y, si lleva aviso, el tema que cita.
export function piezasDeRemision(est, r) {
  const out = [...piezasDeNodo(est, est.porId.get(r.destino))];
  if (r.aviso) {
    out.push(...piezasDeNodo(est, est.porId.get(r.aviso.parece)));
    const t = r.aviso.tema ? localizar(est.texto, r.aviso.tema, Math.max(0, r.inicio - 260)) : null;
    if (t) out.push(t);
  }
  return out;
}

export function claveDe(est) {
  return `${est.docId}:${est.entry?.mtimeMs ?? '-'}:${est.entry?.size ?? '-'}`;
}

export function vaciarCache() {
  _cache.clear();
}

// Página de una posición del texto global.
export function paginaEn(est, pos) {
  for (const p of est.paginas) if (pos >= p.inicio && pos <= p.fin) return p.pagina;
  return est.paginas[est.paginas.length - 1]?.pagina ?? null;
}

// Ruta de la sección: «Capítulo III › Artículo 12».
export function rutaDe(est, nodo) {
  const partes = [];
  let x = nodo;
  while (x) {
    partes.unshift(x.etiqueta);
    x = x.padre ? est.porId.get(x.padre) : null;
  }
  return partes.join(' › ');
}

export function resumenNodo(est, n) {
  const pIni = paginaEn(est, n.inicio);
  const pFin = paginaEn(est, Math.max(n.inicio, n.fin - 1));
  const out = { id: n.id, etiqueta: n.etiqueta };
  if (n.titulo) out.titulo = n.titulo;
  if (pIni != null) out.paginas = pIni === pFin ? `${pIni}` : `${pIni}-${pFin}`;
  out.caracteres = n.fin - n.inicio;
  if (n.numeracion) out.numeracion = n.numeracion;
  return out;
}

// La sección donde cae un fragmento: la más profunda que contiene su mitad.
export function seccionDeFragmento(est, chunkId) {
  const tr = est.tramos.find((x) => x.chunkId === Number(chunkId));
  if (!tr) return null;
  const n = nodoEn(est.arbol, Math.floor((tr.inicio + tr.fin) / 2)) ?? nodoEn(est.arbol, tr.inicio);
  return { tramo: tr, nodo: n };
}

// Remisiones dentro de un tramo del texto, con su destino.
export function remisionesEn(est, inicio, fin) {
  return est.remisiones.filter((r) => r.inicio >= inicio && r.inicio < fin);
}

export function describirRemision(est, r) {
  const d = est.porId.get(r.destino);
  const out = { texto: r.texto.replace(/\s+/g, ' '), seccion_id: d.id, etiqueta: d.etiqueta };
  if (d.titulo) out.titulo = d.titulo;
  if (r.ambiguo) out.ambigua = true;
  if (r.aviso) {
    const p = est.porId.get(r.aviso.parece);
    out.aviso = `${r.aviso.motivo} El documento remite a ${d.etiqueta}; puede que quisiera decir ${p.etiqueta} (${p.id}). Comprueba las dos antes de citar.`;
    out.posible_seccion_id = p.id;
  }
  return out;
}

// Localiza una sección por id («s12») o por cómo la nombra el abogado («Anexo II», «cláusula
// quinta», «hecho tercero», «art. 5», «Fundamentos de derecho»). Devuelve { nodo } o
// { candidatos: [...] } o null.
export function localizarSeccion(est, pedido) {
  const q = String(pedido || '').trim();
  if (!q) return null;
  if (/^s\d+$/i.test(q)) {
    const n = est.porId.get(q.toLowerCase());
    return n ? { nodo: n } : null;
  }
  const p = plegar(q).replace(/\s+/g, ' ').trim();
  const nodos = est.arbol.nodos;
  // Etiqueta exacta («Anexo II», «Artículo 5», «Hechos probados»).
  const exactos = nodos.filter((n) => plegar(n.etiqueta) === p || plegar(`${n.etiqueta} ${n.titulo}`).startsWith(p));
  if (exactos.length === 1) return { nodo: exactos[0] };
  // Tipo + identificador («cláusula quinta», «hecho 3», «anexo 2», «art. 5»).
  const m = p.match(new RegExp(`^(clausula|estipulacion|pacto|anexo|apendice|articulo|art\\.?|hecho(?: probado)?|fundamento(?: de derecho| juridico)?|f\\.?j\\.?|antecedente(?: de hecho)?|capitulo|titulo|seccion|apartado|disposicion \\w+)\\s+(?:n(?:um)?\\.?\\s*[ºo°]?\\s*)?(${RE_ORDINAL}|\\d[\\w.]*|[ivxlc]+|[a-z])\\b`));
  if (m) {
    const tipo = m[1];
    const idOrig = q.slice(q.length - (p.length - p.indexOf(m[2], m[1].length)), q.length).split(/\s+/)[0];
    const clave = claveDeId(/^[ivxlc]+$/.test(m[2]) ? m[2].toUpperCase() : (m[2].length === 1 ? idOrig : m[2]), { permitirLetra: true });
    const fam = /^(clausula|estipulacion|pacto)/.test(tipo) ? 'clausula'
      : /^(anexo|apendice)/.test(tipo) ? 'anexo'
      : /^art/.test(tipo) ? 'articulo'
      : /^hecho/.test(tipo) ? 'hecho'
      : /^(fundamento|f\.?j)/.test(tipo) ? 'fundamento'
      : /^antecedente/.test(tipo) ? 'antecedente'
      : /^apartado/.test(tipo) ? 'apartado'
      : tipo.split(' ')[0];
    const cands = nodos.filter((n) => n.clave === clave && (
      (fam === 'clausula' && (n.tipo === 'clausula' || (n.tipo === 'ordinal' && n.familia === 'clausula')))
      || (['hecho', 'fundamento', 'antecedente'].includes(fam) && ['ordinal', 'romano', 'numerado'].includes(n.tipo) && n.familia === fam)
      || (fam === 'apartado' && (n.tipo === 'numerado' || n.tipo === 'romano'))
      || n.tipo === fam));
    if (cands.length === 1) return { nodo: cands[0] };
    if (cands.length > 1) return { candidatos: cands };
  }
  // Por título («Comisión Paritaria», «tabla salarial»).
  const porTitulo = nodos.filter((n) => n.titulo && plegar(n.titulo).includes(p));
  if (porTitulo.length === 1) return { nodo: porTitulo[0] };
  if (porTitulo.length > 1) return { candidatos: porTitulo };
  return null;
}

export default { estructuraDe, vaciarCache, paginaEn, rutaDe, resumenNodo, seccionDeFragmento, remisionesEn, describirRemision, localizarSeccion };
