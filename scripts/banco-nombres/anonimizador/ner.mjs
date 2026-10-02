// El reconocedor estadístico, envuelto.
//
// Dos cosas que no vienen de serie y que hay que poner aquí:
//
// 1. POSICIONES. @xenova/transformers 2.17.2 devuelve `start: null` y `end: null` en cada token
//    —está escrito en su propio código, «TODO: null for now, but will add»—. Sin posiciones no se
//    puede cortar el texto, así que se reconstruyen: se tokeniza el fragmento entero y se recorre
//    con un cursor sobre una copia PLEGADA (minúsculas, sin tildes) que conserva las posiciones una
//    a una. Lo de plegar no es un adorno: hay candidatos sin distinción de mayúsculas, y cotejando
//    el literal tal cual no se encuentra ni un token. En la primera corrida del banco eso hizo
//    parecer que el mejor modelo detectaba un 8 %; era un 95 %.
//
// 2. LOTES. La primera versión llamaba al modelo una vez por fragmento: 60 llamadas para una
//    respuesta de obtener_documento. La librería acepta un array y lo pasa en un solo tensor, que
//    es donde está el ahorro. Los fragmentos se agrupan por longitud parecida antes de armar el
//    lote, igual que hace pool.js con los embeddings, porque el relleno hasta el más largo del
//    lote es tiempo tirado.

import { plegar } from './texto.mjs';

export { plegar };

const PLEGAR_CACHE = new WeakMap();

export async function cargarReconocedor({ modelo, modelsDir = null, cacheDir = null, empaquetado = false }) {
  const { pipeline, env } = await import('@xenova/transformers');
  env.allowLocalModels = true;
  if (cacheDir) env.cacheDir = cacheDir;
  if (empaquetado) {
    env.localModelPath = modelsDir;
    env.allowRemoteModels = false;
  } else {
    env.allowRemoteModels = true;
  }
  if (env.backends?.onnx?.wasm) {
    // Mismo ajuste que server/embedder/motor.js: en Node los Web Workers de onnxruntime-web no
    // funcionan (ERR_WORKER_PATH con una URL blob:). El paralelismo lo pone el pool de RobinSearch.
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.numThreads = 1;
  }
  return pipeline('token-classification', modelo, { quantized: true });
}

function tramosDeTokens(pipe, texto) {
  let cache = PLEGAR_CACHE.get(pipe);
  if (!cache) { cache = new Map(); PLEGAR_CACHE.set(pipe, cache); }
  if (cache.has(texto)) return cache.get(texto);

  const ids = pipe.tokenizer(texto, { padding: false, truncation: true }).input_ids;
  const lista = ids.tolist ? ids.tolist()[0] : Array.from(ids.data ?? ids[0]);
  const heno = plegar(texto);
  const tramos = [];
  let cursor = 0;
  for (const id of lista) {
    let w = pipe.tokenizer.decode([Number(id)], { skip_special_tokens: true });
    if (!w) { tramos.push(null); continue; }
    w = w.replace(/^##/, '').replace(/^▁/, '');
    if (!w.trim()) { tramos.push(null); continue; }
    const aguja = plegar(w);
    const i = heno.indexOf(aguja, cursor);
    if (i < 0) { tramos.push(null); continue; }
    tramos.push({ inicio: i, fin: i + aguja.length });
    cursor = i + aguja.length;
  }
  if (cache.size > 512) cache.clear();
  cache.set(texto, tramos);
  return tramos;
}

// Une tokens contiguos de la misma etiqueta. Se une por CONTIGÜEDAD en el texto, no por el prefijo
// B-/I-: los modelos de PII no siempre lo emiten bien (hay uno que marca todo como B-), y un B-
// nuevo pegado al anterior es casi siempre el segundo apellido.
function agrupar(entidades, tramos, texto, traducir) {
  const marcas = [];
  for (const e of entidades) {
    const tipo = traducir(e.entity);
    if (!tipo) continue;
    const t = tramos[e.index];
    if (!t) continue;
    marcas.push({ tipo, inicio: t.inicio, fin: t.fin, score: e.score });
  }
  marcas.sort((a, b) => a.inicio - b.inicio);
  const fuera = [];
  for (const m of marcas) {
    const ult = fuera[fuera.length - 1];
    if (ult && ult.tipo === m.tipo && m.inicio - ult.fin <= 1 && !/[\n.;]/.test(texto.slice(ult.fin, m.inicio))) {
      ult.fin = m.fin;
      ult.score = Math.min(ult.score, m.score);
      continue;
    }
    fuera.push({ ...m });
  }
  for (const f of fuera) {
    // El modelo se lleva el tratamiento por delante («D. Juan Pérez»): se recorta, porque el alias
    // tiene que sustituir al nombre, no al «D.».
    let ini = f.inicio;
    const cabecera = /^(?:D\.ª|D\.|Dña\.|Don|Doña|DON|DOÑA|DONA|Sr\.|Sra\.|Excmo\.|Ilmo\.|Excma\.|Ilma\.)[\s.ª]*/i;
    const m = texto.slice(ini, f.fin).match(cabecera);
    if (m && m[0].length < f.fin - ini) ini += m[0].length;
    f.inicio = ini;
    f.valor = texto.slice(f.inicio, f.fin);
    f.via = 'modelo';
  }
  return fuera.filter((f) => f.valor.trim().length > 1);
}

// Reconoce un LOTE de textos. Devuelve un array paralelo de listas de detecciones.
export async function reconocerLote(pipe, textos, traducir, { tamLote = 16 } = {}) {
  const fuera = new Array(textos.length);
  // Por longitud parecida: el relleno hasta el más largo del lote es cómputo tirado.
  const orden = textos.map((t, i) => ({ i, n: t.length })).sort((a, b) => a.n - b.n);
  for (let k = 0; k < orden.length; k += tamLote) {
    const grupo = orden.slice(k, k + tamLote);
    const entrada = grupo.map((g) => textos[g.i]);
    let salida;
    try {
      salida = await pipe(entrada);
    } catch {
      // Si el lote falla (un texto desmesurado, por ejemplo), se cae a uno por uno: más lento,
      // pero no se pierde el fragmento.
      salida = [];
      for (const t of entrada) {
        try { salida.push(await pipe(t)); } catch { salida.push([]); }
      }
    }
    const lista = Array.isArray(salida[0]) || salida.length === 0 ? salida : [salida];
    grupo.forEach((g, j) => {
      const texto = textos[g.i];
      fuera[g.i] = agrupar(lista[j] ?? [], tramosDeTokens(pipe, texto), texto, traducir);
    });
  }
  return fuera;
}

export default reconocerLote;
