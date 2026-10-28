// Documentos que están en la carpeta pero NO en el disco: iCloud, OneDrive, Dropbox.
//
// Hasta la 1.8.1 se contaban («202 ficheros sin descargar», «72 ficheros vacíos») y ahí se
// quedaban: el abogado tenía doscientos documentos que no salían en ninguna búsqueda y nadie se
// lo decía. Contarlos no es arreglarlo. Lo que hace falta es lo que haría una persona: PEDIR la
// descarga y volver a mirar hasta que el fichero esté.
//
//   · Se apunta el fichero como PENDIENTE (no como error) y se pide su descarga a la nube.
//   · Se vuelve a mirar cada poco, con espera creciente: 2 min, 5, 15, 45, 2 h… hasta un día.
//   · En cuanto tiene contenido, se indexa como cualquier otro documento y deja de estar pendiente.
//   · Si después de un día entero sigue a cero bytes, es que está vacío de verdad: se dice como
//     lo que es (un documento vacío, nada que indexar) y se deja de insistir.
//
// La lista se guarda en disco: apagar el ordenador no puede perder los documentos que faltaban.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { rutas } from '../rutas.js';
import { log } from '../logger.js';

const ESPERAS_MS = [2, 5, 15, 45, 120, 360, 720].map((m) => m * 60 * 1000);
// A partir de aquí, un fichero que sigue sin contenido es un fichero vacío, no uno por descargar.
const SE_DA_POR_VACIO_MS = Number(process.env.ROBIN_NUBE_DIAS_MAX || 1) * 24 * 60 * 60 * 1000;
// Cuántas descargas se piden de una vez: no se le pide a iCloud doscientos ficheros a la vez, ni
// se ocupa la línea del despacho a media mañana.
const POR_TANDA = Number(process.env.ROBIN_NUBE_POR_TANDA || 20);
const REVISAR_CADA_MS = Number(process.env.ROBIN_NUBE_REVISAR_MS) || 2 * 60 * 1000;

const _pend = new Map();    // clave de ruta → { ruta, motivo, desde, intentos, proximo, pedida }
const _vacios = new Map();  // clave de ruta → hasta cuándo se le deja en paz (estaba vacío de verdad)
// Una semana sin volver a insistir con un fichero que se dio por vacío. Si el abogado lo rellena,
// cambia su tamaño y entra por el camino normal, sin esperar a nada.
const OLVIDAR_VACIO_MS = 7 * 24 * 60 * 60 * 1000;
let _cargado = false;
let _timer = null;

const ruta_lista = () => path.join(config.dataDir, 'pendientes-nube.json');
const clave = (p) => {
  try {
    return rutas.claveRuta(p);
  } catch {
    return String(p);
  }
};

function cargar() {
  if (_cargado) return;
  _cargado = true;
  try {
    const datos = JSON.parse(fs.readFileSync(ruta_lista(), 'utf8'));
    for (const e of datos?.pendientes || []) if (e?.ruta) _pend.set(clave(e.ruta), e);
    for (const [k, hasta] of Object.entries(datos?.vacios || {})) if (hasta > Date.now()) _vacios.set(k, hasta);
  } catch {
    /* no hay lista todavía */
  }
}

function guardar() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(ruta_lista(), JSON.stringify({
      pendientes: [..._pend.values()],
      vacios: Object.fromEntries(_vacios),
    }), 'utf8');
  } catch (err) {
    log.warn('No se pudo guardar la lista de documentos por descargar', { err: String(err?.message ?? err) });
  }
}

// Un fichero con tamaño y SIN bloques asignados en disco es un marcador de la nube: el contenido
// no está en este equipo. Vale en Mac y Linux y también en Windows, donde libuv calcula
// `blocks` con el tamaño asignado en disco (lo que el Explorador llama «Tamaño en disco: 0
// bytes» en un fichero de OneDrive «solo en la nube»).
//
// En Windows, con un matiz: NTFS guarda los ficheros muy pequeños dentro de la propia tabla de
// ficheros, sin bloques aparte, y esos también dan 0. Por eso allí no se da por marcador lo que
// no llega a una página; el indexador lo comprueba leyéndolo (`traer`).
const MIN_MARCADOR_WIN = 4096;

export function sinBloques(st, plataforma = process.platform) {
  if (!(Number(st?.size) > 0) || st?.blocks !== 0) return false;
  return plataforma !== 'win32' || Number(st.size) >= MIN_MARCADOR_WIN;
}

// ¿Tiene ya contenido? 'si' | 'no' | 'desaparecido'
export function estadoEnDisco(ruta, plataforma = process.platform) {
  let st;
  try {
    st = fs.statSync(ruta);
  } catch (err) {
    return err?.code === 'ENOENT' || err?.code === 'ENOTDIR' ? 'desaparecido' : 'no';
  }
  if (!st.isFile()) return 'desaparecido';
  if (st.size === 0) return 'no';
  if (sinBloques(st, plataforma)) return 'no';
  return 'si';
}

// Un fichero que sigue en la nube TIENE tamaño: nunca es un documento vacío, por mucho que
// tarde. Solo lo que está a cero bytes puede darse por vacío (ver `revisar`).
function tieneTamanyo(ruta) {
  try {
    return fs.statSync(ruta).size > 0;
  } catch {
    return false;
  }
}

// Lecturas que están trayendo un fichero de la nube ahora mismo. Cada una ocupa uno de los
// cuatro hilos de disco de Node mientras baja (minutos, con una línea lenta); con veinte a la vez
// se quedaba sin hilos todo lo demás que lee disco —el índice, el registro, las búsquedas—. Dos
// como mucho, y el resto espera a la siguiente pasada.
const MAX_DESCARGAS_A_LA_VEZ = Number(process.env.ROBIN_NUBE_A_LA_VEZ || 2);
let _enCurso = 0;

export function descargasEnCurso() {
  return _enCurso;
}

function rutaEnICloud(ruta) {
  return /[\\/]Mobile Documents[\\/]/.test(String(ruta));
}

// Pedirle a la nube que traiga el fichero. Cada sistema tiene su manera, y ninguna es un
// convertidor ni un binario que empaquetemos: es el propio cliente de sincronización del equipo.
function pedirDescarga(ruta) {
  // `brctl` viene con macOS y es lo que usa el Finder al pulsar la nubecita, pero SOLO sirve
  // para iCloud: con OneDrive, Google Drive o Dropbox en el Mac (~/Library/CloudStorage)
  // contesta «Path is outside of any CloudDocs app library, will never sync» y no baja nada.
  // Hasta la 1.12.7 era lo único que se hacía en el Mac, y esos documentos se quedaban fuera
  // para siempre (Eduardo, 28-oct-2026: «¿cómo se comporta con OneDrive cuando los ficheros
  // solo están en la nube?»).
  if (process.platform === 'darwin' && rutaEnICloud(ruta)) {
    try {
      const hijo = spawn('/usr/bin/brctl', ['download', ruta], { stdio: 'ignore', detached: false });
      hijo.on('error', () => { /* se intenta además leyendo, abajo */ });
      setTimeout(() => { try { hijo.kill(); } catch { /* ya terminó */ } }, 30_000).unref?.();
    } catch {
      /* se intenta además leyendo, abajo */
    }
  }
  // En todos los sistemas el contenido se trae solo al LEERLO: macOS (File Provider: iCloud,
  // OneDrive, Google Drive, Dropbox), Windows (OneDrive/SharePoint, Dropbox) y Linux. Leer un byte
  // es lo que dispara la descarga bajo demanda (comprobado el 28-oct-2026 en macOS 15 con un
  // fichero de iCloud «solo en la nube»: 0 bloques → leído 1 byte en 1,4 s → descargado entero).
  //
  // Y se lee SIN ESPERAR. Leer un fichero que todavía está en la nube puede tardar minutos —lo
  // trae el sincronizador mientras tanto—, y hacerlo con `readSync` dejaría el servidor entero
  // parado: ni búsquedas, ni Claude, ni nada. Se lanza la lectura en el hilo de trabajo de Node,
  // se olvida uno de ella y el resultado se ve en la siguiente pasada, cuando el fichero ya tenga
  // contenido.
  if (_enCurso >= MAX_DESCARGAS_A_LA_VEZ) return false;
  _enCurso += 1;
  fsp.open(ruta, 'r')
    .then(async (fh) => {
      try {
        await fh.read(Buffer.alloc(1), 0, 1, 0);
      } finally {
        await fh.close().catch(() => {});
      }
    })
    .catch(() => { /* no se ha podido: se reintenta en la siguiente pasada */ })
    .finally(() => { _enCurso -= 1; });
  return true;
}

// Errores con los que la nube dice «ahora no te lo doy» (sin conexión, cliente cerrado o en
// pausa, descarga bloqueada). En Windows, los propios de OneDrive (ERROR_CLOUD_FILE_*) no tienen
// traducción en libuv y llegan a Node como UNKNOWN (libuv, src/win/error.c).
const CODIGOS_NUBE_LECTURA = new Set(['ETIMEDOUT', 'EHOSTDOWN', 'EHOSTUNREACH', 'ENOTCONN', 'ENETDOWN', 'ETIME', 'EIO', 'UNKNOWN']);

export function esErrorDeNube(err) {
  return CODIGOS_NUBE_LECTURA.has(String(err?.code || ''));
}

// Traer ENTERO un fichero que puede estar en la nube, sin bloquear el servidor, ANTES de que el
// extractor lo lea de golpe (y en síncrono). Es la vía de Windows: allí OneDrive deja leer el
// marcador y lo va bajando mientras se lee (hidratación «progresiva» de la Cloud Files API), y
// un `readFileSync` sobre él dejaba RobinSearch sin contestar a Claude mientras bajaba cada
// documento. Se lee por trozos, en el hilo de disco, con un plazo:
//   'ok'    → ya está en el disco: se indexa como cualquier otro.
//   'tarde' → sigue bajando (o ya hay dos bajando): se apunta como pendiente y se mira después.
//   'nube'  → la nube no lo entrega (sin conexión, OneDrive cerrado o bloqueado): pendiente.
//   'otro'  → un error que no es de la nube (bloqueado por Word, sin permiso…): sigue el camino
//             normal, que lo clasifica y lo explica.
const PLAZO_TRAER_MS = Number(process.env.ROBIN_NUBE_PLAZO_MS || 20_000);

export async function traer(ruta, { plazoMs = PLAZO_TRAER_MS } = {}) {
  if (_enCurso >= MAX_DESCARGAS_A_LA_VEZ) return { estado: 'tarde' };
  _enCurso += 1;
  let liberado = false;
  const liberar = () => {
    if (!liberado) {
      liberado = true;
      _enCurso -= 1;
    }
  };
  const lectura = (async () => {
    const fh = await fsp.open(ruta, 'r');
    try {
      const buf = Buffer.allocUnsafe(1024 * 1024);
      let pos = 0;
      for (;;) {
        const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
        if (!bytesRead) break;
        pos += bytesRead;
      }
    } finally {
      await fh.close().catch(() => {});
    }
  })();
  // El hilo sigue ocupado hasta que la lectura acabe, aunque aquí se deje de esperar: el cupo se
  // devuelve entonces, no antes.
  lectura.then(liberar, liberar);
  let reloj;
  const plazo = new Promise((resolve) => {
    reloj = setTimeout(() => resolve('tarde'), plazoMs);
    reloj.unref?.();
  });
  // El error se convierte en valor: si llegara después del plazo, un rechazo sin nadie esperando
  // sería un «unhandledRejection» y un aviso técnico falso.
  const resultado = lectura.then(() => 'ok', (err) => ({ err }));
  try {
    const r = await Promise.race([resultado, plazo]);
    if (typeof r === 'string') return { estado: r };
    return { estado: esErrorDeNube(r.err) ? 'nube' : 'otro', code: String(r.err?.code || '') };
  } finally {
    clearTimeout(reloj);
  }
}

// Apunta un documento que está en la carpeta pero no en el disco, y pide su descarga.
export function apuntar(ruta, motivo = 'sin_descargar') {
  cargar();
  const k = clave(ruta);
  const ya = _pend.get(k);
  if (ya) return ya;
  // Uno que ya se dio por vacío no vuelve a la lista con cada pasada: estaría eternamente en
  // «pendientes de descarga» y el número no querría decir nada.
  const hasta = _vacios.get(k);
  if (hasta && hasta > Date.now()) return null;
  if (hasta) _vacios.delete(k);
  const e = { ruta, motivo, desde: new Date().toISOString(), intentos: 0, proximo: Date.now(), pedida: false };
  _pend.set(k, e);
  guardar();
  return e;
}

export function olvidar(ruta) {
  cargar();
  if (_pend.delete(clave(ruta))) guardar();
}

export function lista() {
  cargar();
  return [..._pend.values()].map((e) => ({ ...e }));
}

export function cuantos() {
  cargar();
  return _pend.size;
}

// Una pasada: pide las descargas que toquen y devuelve los que YA se pueden indexar.
export async function revisar({ indexar = null, forzar = false } = {}) {
  cargar();
  const ahora = Date.now();
  const listos = [];
  const vacios = [];
  let pedidas = 0;
  for (const [k, e] of [..._pend]) {
    if (!forzar && e.proximo > ahora) continue;
    const estado = estadoEnDisco(e.ruta);
    if (estado === 'desaparecido') {
      _pend.delete(k);
      continue;
    }
    if (estado === 'si') {
      _pend.delete(k);
      listos.push(e.ruta);
      continue;
    }
    // `>=` y no `>`: con el umbral a cero (las pruebas) apuntar y revisar pueden caer en el MISMO
    // milisegundo, y con `>` la prueba fallaba de vez en cuando sin que nada estuviera mal.
    // Solo a cero bytes: uno con tamaño que sigue sin bajar NO está vacío, está en la nube (hasta
    // la 1.12.7 se decía «documento vacío» de un PDF de OneDrive que el Mac no sabía bajar).
    if (ahora - Date.parse(e.desde) >= SE_DA_POR_VACIO_MS && !tieneTamanyo(e.ruta)) {
      _pend.delete(k);
      _vacios.set(k, ahora + OLVIDAR_VACIO_MS);
      vacios.push(e.ruta);
      continue;
    }
    if (pedidas < POR_TANDA) {
      e.pedida = pedirDescarga(e.ruta);
      pedidas += 1;
    }
    e.intentos += 1;
    e.proximo = ahora + (ESPERAS_MS[Math.min(e.intentos, ESPERAS_MS.length - 1)]);
  }
  guardar();
  if (listos.length) {
    log.info('Documentos que ya se han descargado de la nube: se indexan', { n: listos.length });
    if (indexar) {
      for (const r of listos) {
        try {
          await indexar(r);
        } catch (err) {
          log.warn('No se pudo indexar un documento recién descargado', { err: String(err?.message ?? err) });
        }
      }
    }
  }
  if (vacios.length) {
    log.info('Documentos que llevan un día sin contenido: se dan por vacíos', { n: vacios.length });
  }
  return { listos: listos.length, vacios: vacios.length, pendientes: _pend.size, pedidas };
}

// Revisión periódica. `indexar(ruta)` es lo que hay que hacer con el que ya está descargado.
export function arrancar({ indexar = null } = {}) {
  if (_timer) return;
  _timer = setInterval(() => {
    revisar({ indexar }).catch((err) => log.warn('Fallo revisando los documentos por descargar', { err: String(err?.message ?? err) }));
  }, REVISAR_CADA_MS);
  _timer.unref?.();
}

export function parar() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

export function _limpiarParaPrueba() {
  _pend.clear();
  _vacios.clear();
  _cargado = false;
  parar();
  try {
    fs.rmSync(ruta_lista(), { force: true });
  } catch {
    /* nada */
  }
}

export default {
  apuntar, olvidar, lista, cuantos, revisar, arrancar, parar, estadoEnDisco, sinBloques, traer,
  esErrorDeNube, descargasEnCurso, _limpiarParaPrueba,
};
