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
import { cargarExtractor, conPrefijo, vectoresDeLote } from './motor.js';
import * as pool from './pool.js';

export const EMBEDDING_DIM = 384; // multilingual-e5-small

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS_DIR = process.env.ROBIN_MODELS_DIR || path.join(PKG_ROOT, 'models');
const MANIFEST_PATH = path.join(MODELS_DIR, 'manifest.json');

let _pipelinePromise = null;
let _estado = { cargado: false, cargando: false, origen: null, error: null };
// null mientras mandan los hilos; { modo: 'hilo_principal', motivo } si se calcula aquí.
let _modo = null;
let _hilosPromise = null;

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

// Hilos de embedding: ROBIN_EMBED_HILOS=0 → todo en el hilo principal (el modo de siempre);
// =N → N hilos exactos; sin definir → según núcleos y memoria (pool.js).
function hilosPedidos() {
  const bruto = process.env.ROBIN_EMBED_HILOS;
  if (bruto === undefined || bruto === '' || bruto === 'auto') return { hilos: pool.hilosPorDefecto(), explicito: false };
  const n = parseInt(bruto, 10);
  return { hilos: Number.isFinite(n) && n >= 0 ? Math.min(n, 16) : pool.hilosPorDefecto(), explicito: true };
}

// Fragmentos por llamada al modelo: 16, de un mismo documento y en orden, como siempre. NO es un
// parámetro de rendimiento que se pueda tocar: el modelo cuantizado calcula la escala de
// cuantización de las activaciones sobre el lote entero, y el mismo fragmento calculado en un
// lote distinto da un vector algo distinto (coseno ≈0,997; medido el 16-sep-2026). Con los mismos
// lotes, los vectores son idénticos bit a bit a los de los índices que ya tienen los despachos.
// (El ritmo por fragmento apenas cambia con el lote: 1, 4, 8 y 16 dieron lo mismo.)
const LOTE = 16;

async function cargarPipeline() {
  const local = modeloEmpaquetado();
  if (local.ok) {
    _estado.origen = 'empaquetado';
  } else {
    _estado.origen = 'descarga';
    log.warn('Modelo de embedding NO empaquetado: se intentará descargar', local);
  }
  log.info('Cargando modelo de embedding', { model: config.embeddingModel, origen: _estado.origen });
  const extractor = await cargarExtractor({
    modelo: config.embeddingModel,
    quantized: config.embeddingQuantized,
    modelsDir: MODELS_DIR,
    empaquetado: local.ok,
    cacheDir: process.env.ROBIN_MODEL_CACHE || null,
  });
  log.info('Modelo de embedding listo', { origen: _estado.origen });
  return extractor;
}

// Arranca los hilos de embedding. Devuelve true si hay al menos uno listo. Si no, todo sigue en
// el hilo principal: nunca peor que antes de los hilos.
async function arrancarHilos() {
  const { hilos, explicito } = hilosPedidos();
  if (hilos === 0) {
    _modo = { modo: 'hilo_principal', motivo: 'ROBIN_EMBED_HILOS=0' };
    return false;
  }
  const local = modeloEmpaquetado();
  // Sin modelo empaquetado cada hilo lo descargaría por su cuenta: se deja en el hilo principal.
  if (!local.ok) {
    _modo = { modo: 'hilo_principal', motivo: 'modelo no empaquetado' };
    return false;
  }
  _estado.cargando = true;
  let ok = false;
  try {
    ok = await pool.iniciar({
      objetivo: hilos,
      ajustarPorMemoria: !explicito,
      datosHilo: {
        modelo: config.embeddingModel,
        quantized: config.embeddingQuantized,
        modelsDir: MODELS_DIR,
        empaquetado: true,
        cacheDir: process.env.ROBIN_MODEL_CACHE || null,
        dim: EMBEDDING_DIM,
      },
      topeCargaMs: Number(process.env.ROBIN_EMBED_TOPE_CARGA_MS) || 120000,
      respaldo: (textos) => lotePrincipal(textos),
      avisar: (nivel, msg, datos) => log[nivel]?.(msg, datos),
    });
  } catch (err) {
    log.warn('Hilos de embedding no disponibles', { err: String(err?.message ?? err) });
    ok = false;
  }
  if (ok) {
    _estado = { ..._estado, cargado: true, cargando: false, origen: 'empaquetado', error: null };
    _modo = null;
  } else {
    _estado.cargando = false;
    _modo = { modo: 'hilo_principal', motivo: pool.estado().motivo || 'los hilos no arrancaron' };
  }
  return ok;
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

// ¿Hay hilos de embedding? Se decide UNA vez (la primera carga); si no arrancan, hilo principal.
function conHilos() {
  if (!_hilosPromise) _hilosPromise = arrancarHilos();
  return _hilosPromise;
}

// Arranca los hilos (si procede) sin cargar el modelo en el hilo principal: el indexado lo llama
// antes de repartir documentos, para saber si puede llevar varios a la vez.
export async function prepararHilos() {
  return conHilos();
}

// Precarga explícita (usada en arranque para no pagar la latencia en la primera búsqueda).
export async function warmup() {
  if (await conHilos()) return;
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
    calculo: _modo ?? (_hilosPromise ? pool.estado() : { modo: 'sin_cargar' }),
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

// Un lote en el hilo principal (modo sin hilos, o respaldo del pool): Float32Array n × dim.
async function lotePrincipal(textos) {
  const extractor = await getPipeline();
  return vectoresDeLote(extractor, textos, EMBEDDING_DIM);
}

function trocear(v) {
  const out = [];
  for (let k = 0; k < v.length / EMBEDDING_DIM; k++) out.push(v.subarray(k * EMBEDDING_DIM, (k + 1) * EMBEDDING_DIM));
  return out;
}

// Embedding de pasajes (chunks del expediente). Devuelve un Float32Array de 384 por texto, en
// orden. Con hilos, los lotes de un mismo documento se calculan a la vez en hilos distintos.
export async function embedPassages(texts, { batchSize = LOTE } = {}) {
  if (!texts.length) return [];
  const prefijados = conPrefijo('passage', texts);
  const lotes = [];
  for (let i = 0; i < prefijados.length; i += batchSize) lotes.push(prefijados.slice(i, i + batchSize));
  if (await conHilos()) return (await Promise.all(lotes.map((l) => pool.calcular(l)))).flatMap(trocear);
  const vectors = [];
  for (const l of lotes) for (const v of trocear(await lotePrincipal(l))) vectors.push(v);
  return vectors;
}

// Embedding de una consulta del abogado. Con hilos pasa DELANTE de los fragmentos del indexado.
export async function embedQuery(text) {
  const prefijado = conPrefijo('query', [text]);
  if (await conHilos()) {
    return trocear(await pool.calcular(prefijado, { consulta: true }))[0];
  }
  return trocear(await lotePrincipal(prefijado))[0];
}

// Para el indexado: cuánto trabajo hay en cola y cuántos hilos lo consumen (control de memoria).
export function cargaEmbedding() {
  return pool.activo() ? { pendientes: pool.pendientes(), hilos: pool.capacidad(), lote: LOTE } : null;
}

export default { warmup, prepararHilos, embedPassages, embedQuery, estadoMotor, modeloEmpaquetado, cargaEmbedding, EMBEDDING_DIM };
