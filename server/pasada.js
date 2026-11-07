// La pasada de una vez (modo --silent): indexar las carpetas y salir.
//
// La lanzan los despliegues de IT y, desde la 0.4.56, RobinDesktop cuando Claude está cerrado
// (Alonso, 6-nov-2026: «no debería influir que Claude esté abierto para indexar»). Desde la 1.13.0
// corre en un hilo vigilado por supervisor.js: si un documento tumba el motor, el supervisor lo
// repone y la pasada sigue hasta el final. Fuera de un hilo (ROBIN_SIN_SUPERVISOR=1) funciona igual
// que antes.

import './version-node.js';
import './certificados-sistema.js';
import { isMainThread, parentPort } from 'node:worker_threads';

const { usarCertificadosDelSistema } = await import('./red-corporativa.js');
usarCertificadosDelSistema();
const { bootstrap } = await import('./bootstrap.js');
const { state } = await import('./state.js');
const { config } = await import('./config.js');
const diagnostico = await import('./diagnostico.js');
const escritor = await import('./escritor.js');
const registry = await import('./indexer/registry.js');
const noLegibles = await import('./indexer/ilegibles.js');

// Parar LIMPIO (RobinDesktop cuando vuelve Claude, o el sistema cerrando la sesión): se guarda lo
// hecho, se suelta el índice y se borra la marca de fase, así que no cuenta como caída ni pone
// bajo sospecha el documento que se estaba leyendo.
let parando = false;
function pararLimpio() {
  if (parando) return;
  parando = true;
  try {
    registry.guardarPendiente();
  } catch {
    /* nada */
  }
  try {
    noLegibles.guardarYa();
  } catch {
    /* nada */
  }
  try {
    escritor.soltar();
  } catch {
    /* nada */
  }
  diagnostico.finFase();
  setTimeout(() => process.exit(0), 50);
}
// Una excepción sin capturar (un WASM que revienta leyendo un documento) se registra y deja la
// marca de fase «excepcion» con el fichero: la pasada repuesta lo aparta a la primera.
diagnostico.instalarManejadores({
  alCerrar: () => {
    try {
      registry.guardarPendiente();
      noLegibles.guardarYa();
    } catch {
      /* nada */
    }
    escritor.soltar();
  },
});
if (!isMainThread) {
  parentPort?.on('message', (m) => {
    if (m?.robin === 'parar') pararLimpio();
  });
  parentPort?.postMessage({ robin: 'dataDir', dataDir: config.dataDir });
} else {
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    try {
      process.on(s, pararLimpio);
    } catch {
      /* señal no disponible */
    }
  }
}

if (config.watchedFolders.length === 0) {
  process.stderr.write('robin-search: falta --folder/--folders o ROBIN_FOLDER/ROBIN_FOLDERS.\n');
  process.exit(2);
}
process.stdout.write(`Indexando ${config.watchedFolders.length} carpeta(s):\n  ${config.watchedFolders.join('\n  ')}\n`);
await bootstrap({ initialIndex: true, watch: false, warmModel: true });
if (state.estado === 'error') {
  process.stderr.write(`robin-search: indexado con errores: ${state.ultimoError}\n`);
  // En un hilo, 3 = «terminó, con errores» (el supervisor lo devuelve como 1): un 1 a secas sería
  // una caída, y la pasada se repetiría.
  process.exit(isMainThread ? 1 : 3);
}
process.stdout.write('Indexado completado.\n');
// Salida explícita: los hilos de embedding que quedan esperando trabajo mantendrían vivo el
// proceso, y un despliegue de IT que espera a que termine se quedaba colgado. El registro
// pendiente se vuelca en el manejador de 'exit'.
process.exit(0);
