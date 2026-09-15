// Arranque compartido por el servidor MCP (server/index.js) y el modo CLI (cli/index.js).
// Atiende una caída anterior, abre (o migra) el índice, precarga el modelo de embedding,
// comprueba actualizaciones, lanza (opcionalmente) el indexado inicial y el watcher.
//
// Cada fase peligrosa deja su MARCA en disco (diagnostico.js): si el proceso muere dentro de
// ella, el siguiente arranque sabe dónde, lo cuenta a Robin sin que el abogado haga nada y, si
// fue un fichero concreto o el índice, lo aparta o lo rehace para no volver a caer.

import { config, ensureDataDirs, expedienteForLogicalPath } from './config.js';
import { log } from './logger.js';
import { setError } from './state.js';
import { warmup } from './embedder/embedder.js';
import { indexFolder } from './indexer/indexer.js';
import * as registry from './indexer/registry.js';
import * as cuarentena from './indexer/cuarentena.js';
import * as store from './search/store.js';
import * as escritor from './escritor.js';
import * as diagnostico from './diagnostico.js';
import { startWatcher } from './watcher/watcher.js';
import { checkForUpdate } from './update.js';
import { iniciarControl } from './control.js';

const FASES_INDICE = ['cargando_indice', 'migrando_indice'];

async function atenderCaidaAnterior() {
  const caida = diagnostico.revisarCaidaAnterior();
  if (!caida) return;
  const fase = caida.fase === 'excepcion' ? caida.faseOriginal || 'excepcion' : caida.fase;
  log.error('La ejecución anterior de RobinSearch se cortó sin cerrar', {
    fase,
    ext: caida.ext ?? null,
    bytes: caida.bytes ?? null,
    caidas_seguidas: caida.caidasSeguidas,
  });
  if (caida.fichero && fase === 'indexando') {
    // Con una excepción vista no hay duda de qué fichero fue: se aparta a la primera.
    const e = cuarentena.anotarCaida(caida.fichero, { seguro: caida.fase === 'excepcion' });
    if (e) {
      log.warn(e.caidas >= 2 ? 'Fichero apartado: hizo caer el indexador' : 'Fichero sospechoso de la caída: se reintenta una vez', {
        ext: e.ext,
        bytes: e.bytes,
        caidas: e.caidas,
      });
    }
  }
  // Se espera al aviso (con tope) ANTES de la fase que pudo matar el proceso: si vuelve a
  // matarlo, el aviso ya ha salido.
  await diagnostico.informar(caida.fase === 'excepcion' ? 'excepcion' : 'caida_previa', {
    fase,
    causa: caida.causa ?? null,
    fichero: caida.ext ? { ext: caida.ext, bytes: caida.bytes } : null,
  });
}

// Registro (files.json) e índice tienen que decir lo mismo: lo que el registro da por indexado y
// no está (o está a medias) en el índice se vuelve a indexar desde el original, y lo que está en
// el índice sin registro se retira. Es lo que repara un índice cortado o migrado a medias.
async function cotejarRegistro() {
  const aReindexar = [];
  const conocidos = new Set();
  for (const [abs, e] of registry.entries()) {
    if (!e?.docId) continue;
    conocidos.add(e.docId);
    if (e.sinOcr || !e.numChunks) continue;
    const cab = store.cabecera(e.docId);
    if (!cab || cab.n !== e.numChunks) aReindexar.push(abs);
  }
  if (aReindexar.length) registry.removeMany(aReindexar);
  let huerfanos = 0;
  for (const id of store.docIds()) {
    if (conocidos.has(id)) continue;
    await store.deleteByDoc(id);
    huerfanos += 1;
  }
  return { aReindexar: aReindexar.length, huerfanos };
}

async function abrirIndice(escribo) {
  const derivar = (ruta) => expedienteForLogicalPath(ruta);
  if (escribo && diagnostico.caidasSeguidasEn(FASES_INDICE) >= 2) {
    log.error('Abrir el índice ha tumbado RobinSearch dos arranques seguidos: se rehace desde los documentos');
    store.borrarTodo();
    registry.vaciar();
    diagnostico
      .informar('indice_irrecuperable', { fase: 'cargando_indice', causa: 'dos caídas seguidas al abrir el índice; se rehace desde los documentos' })
      .catch(() => {});
  }
  diagnostico.marcarFase('cargando_indice');
  try {
    const r = await store.abrir({
      migrar: escribo,
      derivarExpediente: derivar,
      alMigrar: () => diagnostico.marcarFase('migrando_indice'),
    });
    if (escribo) {
      // Migración a aislamiento por expediente (1.3.0) de las entradas del registro antiguas.
      registry.backfillExpediente();
      const cotejo = await cotejarRegistro();
      log.info('Índice abierto', {
        documentos: r.documentos,
        fragmentos: r.fragmentos,
        bytes: r.bytes,
        a_reindexar: cotejo.aReindexar,
        huerfanos: cotejo.huerfanos,
        migrado: Boolean(r.migracion),
      });
    }
  } catch (err) {
    log.error('No se pudo abrir el índice', { err: String(err) });
    diagnostico.informar('indice_irrecuperable', { fase: 'cargando_indice', causa: String(err?.message ?? err) }).catch(() => {});
    if (escribo) {
      store.borrarTodo();
      registry.vaciar();
      await store.abrir({ migrar: false });
    } else {
      setError(err);
    }
  } finally {
    diagnostico.finFase();
  }
}

export async function bootstrap({ initialIndex = true, watch = true, warmModel = true, control = false } = {}) {
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

  // 0. ¿Se cortó la ejecución anterior? (se avisa antes de volver a entrar donde murió)
  try {
    await atenderCaidaAnterior();
  } catch (err) {
    log.warn('No se pudo revisar la ejecución anterior', { err: String(err) });
  }

  // 1. Índice. Solo UNA instancia escribe; la otra busca y toma el relevo si la primera muere.
  const escribo = escritor.adquirir();
  if (!escribo) log.info('Otra instancia de RobinSearch tiene el índice: esta solo busca hasta que la otra termine');
  await abrirIndice(escribo);

  // Canal de control para la app de escritorio. Accesorio: si no se puede
  // abrir, se registra y seguimos — el servidor MCP no depende de él.
  if (control) {
    iniciarControl().catch((err) => log.warn('Canal de control no iniciado', { err: String(err) }));
  }

  // Comprobación de actualización en background (no bloquea el arranque).
  checkForUpdate().catch(() => {});

  // 2. Modelo. Precarga para no pagar la latencia en la primera búsqueda.
  if (warmModel) {
    diagnostico.marcarFase('cargando_modelo');
    try {
      await warmup();
    } catch (err) {
      // Sin modelo no se puede indexar NI buscar: todo fichero fallará. El error se marca
      // aquí y ya NO lo borra el indexado que viene a continuación (antes, el `setActivo()`
      // final de `indexFolder` lo pisaba y la causa desaparecía de `estado_servidor`).
      log.error('No se pudo cargar el modelo de embedding', { err: String(err) });
      setError(err);
      diagnostico.informar('fallo_arranque', { fase: 'cargando_modelo', causa: String(err?.message ?? err) }).catch(() => {});
    } finally {
      diagnostico.finFase();
    }
  }

  // 3. Indexado inicial (incremental) y watcher: solo la instancia que escribe.
  const indexar = async () => {
    if (initialIndex && hayCarpetas) {
      try {
        const resumen = await indexFolder({ force: false, reconciliarBorrados: true });
        log.info('Indexado inicial completado', resumen);
        if (resumen.errores > 0) {
          const top = resumen.errores_por_causa?.[0];
          diagnostico
            .informar('errores_indexado', {
              fase: 'indexando',
              causa: top ? `${resumen.errores} ficheros con error; causa principal: ${top.causa}` : `${resumen.errores} ficheros con error`,
            })
            .catch(() => {});
        }
      } catch (err) {
        log.error('Fallo en el indexado inicial', { err: String(err) });
        setError(err);
      }
    }
    if (watch && hayCarpetas) startWatcher();
    diagnostico.arranqueCompleto();
  };

  if (escribo) {
    await indexar();
  } else if (!watch) {
    // Modo IT (--silent): no hay relevo que esperar; se dice y se sale.
    setError('Otra instancia de RobinSearch está usando este mismo directorio de datos. Ciérrala y vuelve a intentarlo.');
  } else {
    const relevo = setInterval(() => {
      if (!escritor.adquirir()) return;
      clearInterval(relevo);
      log.info('Esta instancia toma el relevo del índice');
      // El canal de la app lo servía la instancia muerta: su socket quedó huérfano y
      // iniciarControl lo detecta y lo sustituye.
      if (control) iniciarControl().catch((err) => log.warn('Canal de control no iniciado', { err: String(err) }));
      abrirIndice(true)
        .then(indexar)
        .catch((err) => log.error('Fallo al tomar el relevo del índice', { err: String(err) }));
    }, 5000);
    relevo.unref?.();
  }
}

export default { bootstrap };
