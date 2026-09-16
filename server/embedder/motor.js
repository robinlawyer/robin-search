// Carga del pipeline de embedding (multilingual-e5-small, ONNX int8, onnxruntime-web WASM).
//
// La usan el hilo principal (modo sin hilos, el de siempre) y cada hilo de trabajo del pool
// (hilo.js). Por eso NO importa config.js ni logger.js: dentro de un hilo de trabajo no se leen
// ajustes ni se escribe el log del proceso (eso es del hilo principal); todo lo que necesita le
// llega como parámetro.

// Prefijos del modelo asimétrico e5 (ver embedder.js).
export const conPrefijo = (prefijo, textos) => textos.map((t) => `${prefijo}: ${t}`);

export async function cargarExtractor({ modelo, quantized = true, modelsDir, empaquetado, cacheDir = null }) {
  // onnxruntime-web (Emscripten) instala al cargarse manejadores de proceso que RELANZAN toda
  // promesa rechazada y toda excepción: convertían cualquier fallo menor en la caída del servidor
  // (el host de Node de Claude sale con cualquier excepción sin capturar). Los nuestros
  // (diagnostico.js) ya registran y avisan; los que añada la librería se retiran. En un hilo de
  // trabajo los manejadores son del hilo: allí convertirían un fallo de un lote en la muerte del
  // hilo, que el pool sabe reponer, pero es trabajo perdido.
  const previos = {
    unhandledRejection: new Set(process.listeners('unhandledRejection')),
    uncaughtException: new Set(process.listeners('uncaughtException')),
  };
  const retirarAjenos = () => {
    for (const [evento, antes] of Object.entries(previos)) {
      for (const l of process.listeners(evento)) if (!antes.has(l)) process.removeListener(evento, l);
    }
  };
  const { pipeline, env } = await import('@xenova/transformers');
  env.allowLocalModels = true;
  if (cacheDir) env.cacheDir = cacheDir;
  if (empaquetado) {
    // Todo en disco: ni una petición de red para cargar el modelo.
    env.localModelPath = modelsDir;
    env.allowRemoteModels = false;
  } else {
    env.allowRemoteModels = true;
  }

  // WASM con proxy=false y 1 hilo de onnxruntime: en Node los Web Workers de onnxruntime-web
  // no funcionan (lanza ERR_WORKER_PATH con una URL blob:), ni el proxy ni los pthreads de
  // Emscripten (numThreads>1): el script del hilo sale de una URL blob: que Node no admite y,
  // sin Blob, el fichero ort-wasm-threaded.js no define `ortWasmThreaded` al evaluarse (medido
  // el 16-sep-2026 con onnxruntime-web 1.14). El paralelismo lo ponen los hilos de trabajo
  // PROPIOS de RobinSearch (pool.js), cada uno con su inferencia de 1 hilo.
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.numThreads = 1;
  }

  try {
    return await pipeline('feature-extraction', modelo, { quantized });
  } finally {
    retirarAjenos();
  }
}

// Vectores de un lote como UN Float32Array (n × dim), con mean pooling y normalizados, que es lo
// que ha hecho siempre RobinSearch. El relleno (padding) de los textos cortos hasta el largo del
// más largo del lote queda enmascarado en el modelo (atención y media), así que la composición
// del lote no cambia el vector más allá del redondeo de coma flotante; sí cambia el cómputo, y por
// eso quien arma los lotes junta textos de longitud parecida (pool.js).
export async function vectoresDeLote(extractor, textos, dim) {
  const out = await extractor(textos, { pooling: 'mean', normalize: true });
  const datos = out.data;
  if (!datos || datos.length !== textos.length * dim) {
    throw new Error(`Salida del modelo con forma inesperada (${out?.dims?.join('x')})`);
  }
  // Copia propia: se TRANSFIERE al hilo principal y no puede ser una vista de otro búfer.
  return Float32Array.from(datos);
}
