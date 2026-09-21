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
import { indexFolder, indexFile } from './indexer/indexer.js';
import nube from './indexer/nube.js';
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

// Cómo se llama cada fase en castellano, para que la causa del aviso se entienda sin abrir el
// código: es lo que se lee en el panel y en el correo a hola@.
const FASE_EN_CLARO = {
  cargando_indice: 'abriendo el índice',
  migrando_indice: 'migrando el índice',
  cargando_modelo: 'cargando el modelo de embedding',
  indexando: 'leyendo un documento para indexarlo',
  buscando: 'atendiendo una búsqueda',
  excepcion: 'con una excepción sin capturar',
  en_marcha: 'en marcha',
};

function tamanyoEnClaro(bytes) {
  if (!Number.isFinite(Number(bytes))) return null;
  const mb = Number(bytes) / 1048576;
  return mb >= 1 ? `${mb.toFixed(1).replace('.', ',')} MB` : `${Math.round(Number(bytes) / 1024)} KB`;
}

// La causa de una «caída previa», en una frase. Hasta la 1.6.1 el aviso a hola@ y el panel se
// quedaban con un guion —la causa solo existe cuando hubo EXCEPCIÓN, y una muerte a secas (OOM,
// SIGKILL) no la tiene—, mientras el registro sí decía la fase, la extensión, el tamaño y cuántas
// caídas seguidas iban (correo de Juan, 20-sep-2026: «es un fallo de canalización, no de falta de
// diagnóstico»). Solo datos técnicos: ni el nombre del fichero ni la ruta, como siempre.
export function causaDeCaida(caida, fase) {
  if (caida?.causa) return String(caida.causa);
  const partes = [`la ejecución anterior se cortó sin cerrar ${FASE_EN_CLARO[fase] || `en fase ${fase}`}`];
  if (caida?.ext) {
    const tam = tamanyoEnClaro(caida.bytes);
    partes.push(`fichero ${String(caida.ext).toLowerCase()}${tam ? ` de ${tam}` : ''}`);
  }
  if (caida?.caidasSeguidas > 1) partes.push(`${caida.caidasSeguidas} caídas seguidas`);
  if (caida?.version) partes.push(`versión ${caida.version}`);
  return partes.join('; ');
}

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
    causa: causaDeCaida(caida, fase),
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
  const otra = escribo ? null : escritor.fichaOtraInstancia();
  if (!escribo) {
    log.info('Otra instancia de RobinSearch tiene el índice: esta solo busca hasta que la otra termine', {
      version: otra?.version ?? null,
    });
    // Dos VERSIONES distintas a la vez es un proceso viejo que el instalador dejó huérfano: no se
    // arregla solo y explica síntomas que parecen otra cosa (sesión perdida, canal de control
    // servido por quien no toca). Se dice, para poder cerrarlo (correo de Juan, 20-sep-2026).
    if (otra?.distintaVersion) {
      log.error('Hay DOS versiones de RobinSearch corriendo a la vez: cierra Claude del todo y vuelve a abrirlo', {
        actual: config.version,
        otra: otra.version,
      });
      diagnostico
        .informar('instancias_duplicadas', {
          fase: 'arrancando',
          causa: `dos versiones a la vez: esta ${config.version} y otra ${otra.version} (proceso ${otra.pid ? 'vivo' : 'desconocido'})`,
        })
        .catch(() => {});
    }
  }
  await abrirIndice(escribo);

  // Canal de control para la app de escritorio. Accesorio: si no se puede
  // abrir, se registra y seguimos — el servidor MCP no depende de él.
  if (control) {
    iniciarControl().catch((err) => log.warn('Canal de control no iniciado', { err: String(err) }));
  }

  // Comprobación de actualización en background (no bloquea el arranque).
  checkForUpdate().catch(() => {});

  // 2. Modelo. Precarga para no pagar la latencia en la primera búsqueda.
  //
  // Pero NO en la segunda instancia. Claude Desktop arranca el servidor dos veces (una sonda que
  // luego mata y el servidor de verdad) y un abogado puede tener Claude Desktop y Claude Code a
  // la vez: cada precarga reserva ~1,15 GB que el WASM no devuelve nunca. En un portátil de 8 GB
  // eso es justo la memoria que después falta para los hilos de cálculo (correo de Eduardo,
  // 19-sep-2026: «1 hilo de los 4 previstos»). La instancia que solo busca carga el modelo en la
  // primera búsqueda, que es cuando de verdad le hace falta.
  if (warmModel && !escribo) {
    log.info('Esta instancia solo busca: el modelo se cargará con la primera búsqueda, no ahora');
  }
  if (warmModel && escribo) {
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
        // `resumen.errores` es ya solo lo que hay que ARREGLAR aquí: desde la 1.8.1, el documento
        // protegido, dañado o sin descargar no es un error sino un `no_indexables`, con su
        // explicación y su reintento (indexer.js, nube.js). Por si acaso queda alguno de los
        // antiguos, se siguen descontando los ROBIN_FICHERO_*.
        const deFichero = (resumen.errores_por_causa || [])
          .filter((c) => String(c.causa).startsWith('ROBIN_FICHERO_'))
          .reduce((n, c) => n + (c.ficheros || 0), 0);
        if (resumen.errores - deFichero > 0) {
          const top = resumen.errores_por_causa?.find((c) => !String(c.causa).startsWith('ROBIN_FICHERO_'));
          diagnostico
            .informar('errores_indexado', {
              fase: 'indexando',
              causa: top ? `${resumen.errores - deFichero} ficheros con error; causa principal: ${top.causa}` : `${resumen.errores - deFichero} ficheros con error`,
            })
            .catch(() => {});
        }
      } catch (err) {
        log.error('Fallo en el indexado inicial', { err: String(err) });
        setError(err);
        // El disco lleno se avisa aparte: no es un fichero raro, es el equipo, y es la causa de
        // que todo lo demás empiece a fallar a la vez (19-sep-2026).
        if (err?.code === 'ROBIN_DISCO_LLENO') {
          diagnostico
            .informar('disco_lleno', { fase: 'indexando', causa: 'no queda espacio en el disco: el indexado se ha parado' })
            .catch(() => {});
        }
      }
    }
    if (watch && hayCarpetas) startWatcher();
    // Los documentos que la nube todavía no había traído no se quedan fuera: se pide su descarga
    // y se vuelve a mirar hasta indexarlos (nube.js). Solo la instancia que escribe.
    if (hayCarpetas) {
      // El cerrojo se comprueba en el momento de indexar, no al programar: entre una pasada y la
      // siguiente pueden pasar horas y el índice puede haber cambiado de dueño.
      const indexarSiEscribo = async (ruta) => {
        if (!escritor.soyEscritor()) return;
        await indexFile(ruta, { force: true });
      };
      nube.arrancar({ indexar: indexarSiEscribo });
      nube.revisar({ indexar: indexarSiEscribo, forzar: true })
        .catch((err) => log.warn('No se pudo revisar lo que falta por descargar', { err: String(err?.message ?? err) }));
    }
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
    // Y se deja de perseguir lo que falta por bajar de la nube: escribe en el índice, y el índice
    // ya no es de esta instancia. Al tomar el relevo se vuelve a arrancar con el resto.
    nube.parar();
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
