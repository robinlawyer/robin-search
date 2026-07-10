// Motor de embedding: multilingual-e5-small en ONNX int8, vía @xenova/transformers
// (onnxruntime-node por debajo). Se ejecuta 100% en local (CPU), sin ninguna llamada
// a APIs externas. El modelo se cachea en disco tras la primera carga (RNF-01, RF-04).
//
// e5 es un modelo ASIMÉTRICO: la consulta y los pasajes se codifican con prefijos
// distintos ("query: " / "passage: "). Es justamente el patrón del RAG jurídico
// (la pregunta del abogado y los chunks del expediente son estructuralmente distintos).

import { config } from '../config.js';
import { log } from '../logger.js';

export const EMBEDDING_DIM = 384; // multilingual-e5-small

let _pipelinePromise = null;

async function getPipeline() {
  if (!_pipelinePromise) {
    _pipelinePromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      // Solo modelos locales/caché; nada de telemetría remota más allá de la descarga
      // inicial del modelo (que no es contenido documental).
      env.allowLocalModels = true;
      if (process.env.ROBIN_MODEL_CACHE) env.cacheDir = process.env.ROBIN_MODEL_CACHE;
      // WASM en el HILO PRINCIPAL: en Node (y dentro del .mcpb) los Web Workers de
      // onnxruntime-web no funcionan (lanza ERR_WORKER_PATH con una URL blob:). Desactivamos
      // el proxy y forzamos 1 hilo → inferencia WASM síncrona, sin workers.
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.proxy = false;
        env.backends.onnx.wasm.numThreads = 1;
      }
      log.info('Cargando modelo de embedding', { model: config.embeddingModel });
      const extractor = await pipeline('feature-extraction', config.embeddingModel, {
        quantized: config.embeddingQuantized,
      });
      log.info('Modelo de embedding listo');
      return extractor;
    })();
  }
  return _pipelinePromise;
}

// Precarga explícita (usada en arranque para no pagar la latencia en la primera búsqueda).
export async function warmup() {
  await getPipeline();
}

function withPrefix(prefix, texts) {
  return texts.map((t) => `${prefix}: ${t}`);
}

async function embedBatch(texts) {
  const extractor = await getPipeline();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  // output.tolist() → array de vectores (uno por texto).
  return output.tolist();
}

// Embedding de pasajes (chunks del expediente). Procesa en lotes para no reventar memoria.
export async function embedPassages(texts, { batchSize = 16 } = {}) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = withPrefix('passage', texts.slice(i, i + batchSize));
    const embedded = await embedBatch(batch);
    for (const v of embedded) vectors.push(v);
  }
  return vectors;
}

// Embedding de una consulta del abogado.
export async function embedQuery(text) {
  const [vector] = await embedBatch(withPrefix('query', [text]));
  return vector;
}

export default { warmup, embedPassages, embedQuery, EMBEDDING_DIM };
