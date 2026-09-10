// Motor de embedding: multilingual-e5-small en ONNX int8, vía @xenova/transformers sobre
// onnxruntime-web (WASM; ver scripts/patch-wasm.mjs). Se ejecuta 100% en local (CPU), sin
// ninguna llamada a APIs externas una vez el modelo está en disco.
//
// e5 es un modelo ASIMÉTRICO: la consulta y los pasajes se codifican con prefijos
// distintos ("query: " / "passage: "). Es justamente el patrón del RAG jurídico
// (la pregunta del abogado y los chunks del expediente son estructuralmente distintos).
//
// El modelo viaja EMPAQUETADO en el .mcpb (carpeta `models/`, ver scripts/fetch-model.mjs).
// Antes se descargaba de HuggingFace en la primera búsqueda: si esa descarga fallaba o
// llegaba corrupta, TODOS los ficheros fallaban al indexar y todas las búsquedas también —
// justo el modo de fallo que dejaba "0 documentos indexados, N errores". Si por lo que sea
// no está empaquetado, se sigue permitiendo la descarga, pero se dice de dónde salió.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../config.js';
import { log } from '../logger.js';

export const EMBEDDING_DIM = 384; // multilingual-e5-small

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS_DIR = process.env.ROBIN_MODELS_DIR || path.join(PKG_ROOT, 'models');
const MANIFEST_PATH = path.join(MODELS_DIR, 'manifest.json');

let _pipelinePromise = null;
let _estado = { cargado: false, cargando: false, origen: null, error: null };

// ¿Está el modelo empaquetado y ÍNTEGRO? Se comprueba por tamaño de cada fichero contra el
// manifiesto que escribe el script de empaquetado: un .onnx truncado (descarga cortada, copia
// a medias) carga "bien" hasta que revienta en el primer embedding, y entonces el error que
// ve el abogado no se parece en nada a la causa.
export function modeloEmpaquetado(modelo = config.embeddingModel) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return { ok: false, motivo: 'no_empaquetado', dir: MODELS_DIR };
  }
  if (manifest.modelo !== modelo) {
    return { ok: false, motivo: 'modelo_distinto', dir: MODELS_DIR, empaquetado: manifest.modelo };
  }
  const incompletos = [];
  for (const [rel, meta] of Object.entries(manifest.ficheros || {})) {
    const abs = path.join(MODELS_DIR, modelo, rel);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      incompletos.push({ fichero: rel, motivo: 'falta' });
      continue;
    }
    if (typeof meta.bytes === 'number' && stat.size !== meta.bytes) {
      incompletos.push({ fichero: rel, motivo: 'tamaño', esperado: meta.bytes, real: stat.size });
    }
  }
  if (incompletos.length) return { ok: false, motivo: 'incompleto', dir: MODELS_DIR, incompletos };
  return { ok: true, dir: MODELS_DIR, modelo };
}

async function cargarPipeline() {
  const { pipeline, env } = await import('@xenova/transformers');
  env.allowLocalModels = true;
  if (process.env.ROBIN_MODEL_CACHE) env.cacheDir = process.env.ROBIN_MODEL_CACHE;

  const local = modeloEmpaquetado();
  if (local.ok) {
    // Todo en disco: ni una petición de red para cargar el modelo.
    env.localModelPath = MODELS_DIR;
    env.allowRemoteModels = false;
    _estado.origen = 'empaquetado';
  } else {
    env.allowRemoteModels = true;
    _estado.origen = 'descarga';
    log.warn('Modelo de embedding NO empaquetado: se intentará descargar', local);
  }

  // WASM en el HILO PRINCIPAL: en Node (y dentro del .mcpb) los Web Workers de
  // onnxruntime-web no funcionan (lanza ERR_WORKER_PATH con una URL blob:). Desactivamos
  // el proxy y forzamos 1 hilo → inferencia WASM síncrona, sin workers.
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.numThreads = 1;
  }

  log.info('Cargando modelo de embedding', { model: config.embeddingModel, origen: _estado.origen });
  const extractor = await pipeline('feature-extraction', config.embeddingModel, {
    quantized: config.embeddingQuantized,
  });
  log.info('Modelo de embedding listo', { origen: _estado.origen });
  return extractor;
}

async function getPipeline() {
  if (_pipelinePromise) return _pipelinePromise;

  _estado.cargando = true;
  const intento = cargarPipeline();
  _pipelinePromise = intento;
  try {
    const extractor = await intento;
    _estado = { ..._estado, cargado: true, cargando: false, error: null };
    return extractor;
  } catch (err) {
    // NO dejar cacheada la promesa RECHAZADA. Cachearla convertía un fallo transitorio (una
    // descarga del modelo cortada) en un servidor inservible hasta reiniciar Claude Desktop:
    // cada fichero y cada búsqueda recibían para siempre el mismo rechazo, sin reintentar.
    if (_pipelinePromise === intento) _pipelinePromise = null;
    _estado = { ..._estado, cargado: false, cargando: false, error: String(err?.message ?? err) };
    throw err;
  }
}

// Precarga explícita (usada en arranque para no pagar la latencia en la primera búsqueda).
export async function warmup() {
  await getPipeline();
}

// Estado del motor para `estado_servidor`. NO fuerza la carga (no dispara una descarga de
// 100+ MB por preguntar): informa de lo que se sabe y de si el modelo está empaquetado.
export function estadoMotor() {
  const empaquetado = modeloEmpaquetado();
  return {
    modelo: config.embeddingModel,
    cargado: _estado.cargado,
    cargando: _estado.cargando,
    origen: _estado.origen,
    empaquetado: empaquetado.ok,
    ...(empaquetado.ok ? {} : { modelo_empaquetado: empaquetado }),
    ...(_estado.error ? { error: _estado.error } : {}),
    ...(_estado.error || !empaquetado.ok
      ? {
          aviso:
            'Sin motor de embedding no se puede indexar ni buscar: todos los ficheros fallan. ' +
            'Reinstala RobinSearch desde robinlawyer.ai/descargas.',
        }
      : {}),
  };
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

export default { warmup, embedPassages, embedQuery, estadoMotor, modeloEmpaquetado, EMBEDDING_DIM };
