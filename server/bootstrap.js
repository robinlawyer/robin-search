// Arranque compartido por el servidor MCP (server/index.js) y el modo CLI (cli/index.js).
// Prepara directorios, precarga el modelo de embedding, comprueba actualizaciones, lanza
// (opcionalmente) el indexado inicial y el watcher.

import { config, ensureDataDirs, expedienteForLogicalPath } from './config.js';
import { log } from './logger.js';
import { setError } from './state.js';
import { warmup } from './embedder/embedder.js';
import { indexFolder } from './indexer/indexer.js';
import * as registry from './indexer/registry.js';
import * as store from './search/store.js';
import { startWatcher } from './watcher/watcher.js';
import { checkForUpdate } from './update.js';

export async function bootstrap({ initialIndex = true, watch = true, warmModel = true } = {}) {
  ensureDataDirs();
  log.info('Arrancando RobinSearch (servidor local)', {
    version: config.version,
    carpetas: config.watchedFolders,
    dataDir: config.dataDir,
  });

  const hayCarpetas = config.watchedFolders.length > 0;
  if (!hayCarpetas) {
    log.warn('Sin carpetas de expedientes (ROBIN_FOLDER / ROBIN_FOLDERS): nada que indexar.');
  }

  // Migración a aislamiento por expediente (1.3.0). Los índices creados por versiones
  // anteriores no llevan el campo `expediente` en sus fragmentos; sin sellarlos, el filtro por
  // expediente los dejaría fuera y el abogado que actualiza vería "no encuentro nada" sobre
  // documentos que sí tiene indexados. Es idempotente: en arranques posteriores no hace nada.
  try {
    const sellRegistro = registry.backfillExpediente();
    const sellIndice = await store.backfillExpediente((ruta) => expedienteForLogicalPath(ruta));
    if (sellRegistro || sellIndice.sellados) {
      log.info('Migración a aislamiento por expediente completada', {
        entradasRegistro: sellRegistro,
        fragmentosIndice: sellIndice.sellados,
      });
    }
  } catch (err) {
    log.error('Fallo al migrar el índice a aislamiento por expediente', { err: String(err) });
  }

  // Comprobación de actualización en background (no bloquea el arranque).
  checkForUpdate().catch(() => {});

  // Precarga del modelo para no pagar la latencia en la primera búsqueda.
  if (warmModel) {
    try {
      await warmup();
    } catch (err) {
      log.error('No se pudo cargar el modelo de embedding', { err: String(err) });
      setError(err);
    }
  }

  // Indexado inicial (incremental) de todas las carpetas configuradas.
  if (initialIndex && hayCarpetas) {
    try {
      const resumen = await indexFolder({ force: false });
      log.info('Indexado inicial completado', resumen);
    } catch (err) {
      log.error('Fallo en el indexado inicial', { err: String(err) });
      setError(err);
    }
  }

  if (watch && hayCarpetas) startWatcher();
}

export default { bootstrap };
