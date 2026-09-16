// Hilo de trabajo de embedding (worker_threads de Node, NO los Web Workers de onnxruntime-web).
//
// Cada hilo carga su propio modelo y calcula lotes que le manda pool.js. Así el cálculo, que es
// el ~95 % del tiempo de indexado, deja de bloquear el hilo principal (el protocolo MCP y las
// búsquedas siguen respondiendo) y se reparte entre varios núcleos.
//
// Mensajes:
//   ← { tipo: 'lote', id, textos }          → { tipo: 'hecho', id, vectores: Float32Array (n × dim) }
//                                             | { tipo: 'fallo', id, error }
//   → { tipo: 'listo', ms } al terminar de cargar | { tipo: 'no_carga', error }

import fs from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { cargarExtractor, vectoresDeLote } from './motor.js';

const { modelo, quantized, modelsDir, empaquetado, cacheDir, dim } = workerData;

// Solo pruebas automáticas (test-velocidad): simula un hilo que muere a mitad de un lote (como
// una memoria agotada), siempre con un texto concreto o una sola vez en todo el proceso (la marca
// es un fichero: la ven todos los hilos), o que no llega a cargar.
const PRUEBA_MORIR = process.env.ROBIN_PRUEBA_HILO_MUERE_CON || null;
const PRUEBA_MORIR_UNA_VEZ = process.env.ROBIN_PRUEBA_HILO_MUERE_UNA_VEZ || null;
const PRUEBA_NO_CARGA = process.env.ROBIN_PRUEBA_HILO_NO_CARGA === '1';

const t0 = Date.now();
let extractor;
try {
  if (PRUEBA_NO_CARGA) throw new Error('carga fallida de prueba');
  extractor = await cargarExtractor({ modelo, quantized, modelsDir, empaquetado, cacheDir });
  parentPort.postMessage({ tipo: 'listo', ms: Date.now() - t0 });
} catch (err) {
  parentPort.postMessage({ tipo: 'no_carga', error: String(err?.message ?? err) });
}

if (extractor) {
  // Un lote cada vez: el pool no manda otro hasta recibir la respuesta.
  parentPort.on('message', async (m) => {
    if (m?.tipo !== 'lote') return;
    try {
      if (PRUEBA_MORIR && m.textos.some((t) => t.includes(PRUEBA_MORIR))) process.exit(70);
      if (PRUEBA_MORIR_UNA_VEZ) {
        try {
          fs.writeFileSync(PRUEBA_MORIR_UNA_VEZ, 'x', { flag: 'wx' });
          process.exit(70);
        } catch {
          /* ya murió uno */
        }
      }
      const vectores = await vectoresDeLote(extractor, m.textos, dim);
      parentPort.postMessage({ tipo: 'hecho', id: m.id, vectores }, [vectores.buffer]);
    } catch (err) {
      parentPort.postMessage({ tipo: 'fallo', id: m.id, error: String(err?.message ?? err) });
    }
  });
}
