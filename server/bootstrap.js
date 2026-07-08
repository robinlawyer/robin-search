// Arranque compartido por el servidor MCP (server/index.js) y el modo CLI (cli/index.js).
// Prepara directorios, precarga el modelo de embedding, comprueba actualizaciones, lanza
// (opcionalmente) el indexado inicial y el watcher.

import { config, ensureDataDirs } from './config.js';
import { log } from './logger.js';
import { setError } from './state.js';
import { warmup } from './embedder/embedder.js';
import { indexFolder } from './indexer/indexer.js';
import { startWatcher } from './watcher/watcher.js';
import { checkForUpdate } from './update.js';

export async function bootstrap({ initialIndex = true, watch = true, warmModel = true } = {}) {
  ensureDataDirs();
  log.info('Arrancando Robin Search (servidor local)', {
    version: config.version,
    carpeta: config.watchedFolder,
    dataDir: config.dataDir,
  });

  if (!config.watchedFolder) {
    log.warn('ROBIN_FOLDER no configurada: sin carpeta de expedientes que indexar.');
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

  // Indexado inicial (incremental) de la carpeta configurada.
  if (initialIndex && config.watchedFolder) {
    try {
      const resumen = await indexFolder({ folder: config.watchedFolder, force: false });
      log.info('Indexado inicial completado', resumen);
    } catch (err) {
      log.error('Fallo en el indexado inicial', { err: String(err) });
      setError(err);
    }
  }

  if (watch && config.watchedFolder) startWatcher();
}

export default { bootstrap };
