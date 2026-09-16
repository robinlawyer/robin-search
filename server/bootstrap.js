// Arranque compartido por el servidor MCP (server/index.js) y el modo CLI (cli/index.js).
// Atiende una caída anterior, abre (o migra) el índice, precarga el modelo de embedding,
// comprueba actualizaciones, lanza (opcionalmente) el indexado inicial y el watcher.
//
// Cada fase peligrosa deja su MARCA en disco (diagnostico.js): si el proceso muere dentro de
// ella, el siguiente arranque sabe dónde, lo cuenta a Robin sin que el abogado haga nada y, si
// fue un fichero concreto o el índice, lo aparta o lo rehace para no volver a caer.

import { config, ensureDataDirs, expedienteForLogicalPath, refinarCarpetas } from './config.js';
import { log } from './logger.js';
import { setError } from './state.js';
import { warmup } from './embedder/embedder.js';
import { indexFolder } from './indexer/indexer.js';
import * as registry from './indexer/registry.js';
import { reconciliarCarpetas } from './indexer/reconciliar.js';
import * as cuarentena from './indexer/cuarentena.js';
import * as store from './search/store.js';
import * as escritor from './escritor.js';
import * as diagnostico from './diagnostico.js';
import { startWatcher, stopWatcher } from './watcher/watcher.js';
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
  // Registro vacío o que tuvo que empezar de cero (dañado, sin copia): lo que hay en el índice
  // NO es huérfano, es lo que el registro ha olvidado. Borrarlo obligaba a reindexar decenas de
  // miles de ficheros; se deja, y el indexado lo sustituye documento a documento (mismo docId).
  if (registry.empezadoVacio() || conocidos.size === 0) {
    return { aReindexar: aReindexar.length, huerfanos: 0, registroOlvidado: store.docIds().length };
  }
  for (const id of store.docIds()) {
    if (conocidos.has(id)) continue;
    await store.deleteByDoc(id);
    huerfanos += 1;
  }
  return { aReindexar: aReindexar.length, huerfanos };
}

// Errores de disco pasajeros o ajenos al contenido del índice: el antivirus o la otra instancia
// tienen un fichero abierto, disco lleno, demasiados ficheros abiertos. Borrar el índice por uno
// de estos es perder horas de indexado por un problema que se arregla solo.
const PASAJEROS = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOSPC', 'EMFILE', 'ENFILE', 'EIO', 'EAGAIN']);

// Caídas SEGUIDAS abriendo el índice antes de rehacerlo. Claude mata el proceso al reiniciar (en
// Windows sin aviso) y una marca de fase no distingue eso de un índice que tumba el proceso: con
// 2 bastaba cerrar Claude dos veces mientras abría un índice grande para perderlo entero.
const CAIDAS_PARA_REHACER = 3;

async function abrirIndice(escribo) {
  const derivar = (ruta) => expedienteForLogicalPath(ruta);
  if (escribo && diagnostico.caidasSeguidasEn(FASES_INDICE) >= CAIDAS_PARA_REHACER) {
    log.error('Abrir el índice ha tumbado RobinSearch varios arranques seguidos: se rehace desde los documentos');
    try {
      store.borrarTodo();
      registry.vaciar();
    } catch (err) {
      log.error('No se pudo rehacer el índice', { err: String(err) });
    }
    diagnostico
      .informar('indice_irrecuperable', { fase: 'cargando_indice', causa: 'varias caídas seguidas al abrir el índice; se rehace desde los documentos' })
      .catch(() => {});
  }
  for (let intento = 1; ; intento++) {
    diagnostico.marcarFase('cargando_indice');
    try {
      const r = await store.abrir({
        migrar: escribo,
        derivarExpediente: derivar,
        alMigrar: () => diagnostico.marcarFase('migrando_indice'),
      });
      // Abrió: las caídas anteriores ya no cuentan para rehacerlo (antes solo se ponían a cero al
      // terminar el indexado inicial, que en un expediente grande puede no llegar nunca).
      diagnostico.indiceAbierto();
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
          registro_olvidado: cotejo.registroOlvidado ?? 0,
          migrado: Boolean(r.migracion),
        });
        // Fuera del índice lo de carpetas que ya no están configuradas, y con su nombre al día lo
        // de las que siguen (ver indexer/reconciliar.js). Antes de indexar y de buscar nada.
        try {
          await reconciliarCarpetas({ motivo: 'arranque' });
        } catch (err) {
          log.error('No se pudo ajustar el índice a las carpetas configuradas', { err: String(err) });
        }
      }
      return;
    } catch (err) {
      const pasajero = PASAJEROS.has(err?.code);
      log.error('No se pudo abrir el índice', { err: String(err), code: err?.code ?? null, intento });
      if (pasajero && intento < 5) {
        await new Promise((res) => setTimeout(res, 2000 * intento));
        continue;
      }
      diagnostico.informar('indice_irrecuperable', { fase: 'cargando_indice', causa: String(err?.message ?? err) }).catch(() => {});
      if (!escribo || pasajero) {
        // Un problema de disco no se arregla borrando: se dice y se busca con lo que haya.
        setError(err);
        return;
      }
      try {
        store.borrarTodo();
        registry.vaciar();
        await store.abrir({ migrar: false });
      } catch (err2) {
        log.error('No se pudo rehacer el índice', { err: String(err2) });
        setError(err2);
      }
      return;
    } finally {
      diagnostico.finFase();
    }
  }
}

export async function bootstrap({ initialIndex = true, watch = true, warmModel = true, control = false } = {}) {
  ensureDataDirs();
  // Las carpetas, escritas como están en disco (caja y forma Unicode). No se hace al importar la
  // configuración: sobre una unidad de red caída puede tardar, y el saludo con Claude no espera.
  try {
    refinarCarpetas();
  } catch (err) {
    log.warn('No se pudieron comprobar las rutas de las carpetas', { err: String(err) });
  }
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

  // Solo pruebas automáticas: una promesa rechazada que nadie recoge no debe tumbar el servidor.
  // DESPUÉS de cargar el modelo a propósito: es onnxruntime-web (Emscripten) el que instala el
  // manejador que relanza los rechazos; antes de cargarlo la prueba no probaba nada.
  if (process.env.ROBIN_PRUEBA_RECHAZO === '1') {
    setTimeout(() => {
      Promise.reject(new Error('rechazo de prueba leyendo /Users/prueba/Expedientes/Pérez - Divorcio/demanda.pdf'));
    }, 300);
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

  // Espera a que la instancia que escribe muera (o suelte el cerrojo) para tomar el relevo.
  let relevo = null;
  const esperarRelevo = () => {
    if (relevo) return;
    relevo = setInterval(() => {
      if (!escritor.adquirir()) return;
      clearInterval(relevo);
      relevo = null;
      log.info('Esta instancia toma el relevo del índice');
      // El canal de la app lo servía la instancia muerta: su socket quedó huérfano y
      // iniciarControl lo detecta y lo sustituye.
      if (control) iniciarControl().catch((err) => log.warn('Canal de control no iniciado', { err: String(err) }));
      abrirIndice(true)
        .then(indexar)
        .catch((err) => log.error('Fallo al tomar el relevo del índice', { err: String(err) }));
    }, 5000);
    relevo.unref?.();
  };

  // Otra instancia se ha quedado con el cerrojo mientras esta estaba parada (suspensión, un
  // lector que bloqueó el proceso más de dos minutos): esta pasa a LECTOR de forma ordenada. Deja
  // de vigilar, descarta lo que tuviera sin volcar del registro (lo escribiría encima del de la
  // otra) y el indexado en curso se corta antes de su siguiente escritura (indexer.js).
  escritor.alPerder(() => {
    log.warn('Otra instancia de RobinSearch ha tomado el índice: esta pasa a solo buscar');
    registry.descartarPendiente();
    stopWatcher().catch((err) => log.warn('No se pudo parar el vigilante', { err: String(err) }));
    if (watch) esperarRelevo();
  });

  if (escribo) {
    await indexar();
  } else if (!watch) {
    // Modo IT (--silent): no hay relevo que esperar; se dice y se sale.
    setError('Otra instancia de RobinSearch está usando este mismo directorio de datos. Ciérrala y vuelve a intentarlo.');
  } else {
    esperarRelevo();
  }
}

export default { bootstrap };
