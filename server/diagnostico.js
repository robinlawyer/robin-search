// Avisos técnicos de fallo: RobinSearch nos cuenta SOLA que algo ha ido mal.
//
// Hasta la 1.4.4, cuando RobinSearch se caía en el ordenador de un abogado, lo único que quedaba
// era un registro local que nadie abre, y la única forma de saber qué pasaba era pedirle que
// abriera el Terminal. Eso no es aceptable (14-sep-2026): el fallo tiene que llegarnos
// sin que el cliente haga nada.
//
// Qué hace este módulo:
//   1. Marca en disco QUÉ está haciendo el proceso (fase y, al indexar, qué fichero). Si el
//      proceso muere con la marca puesta —memoria agotada, un lector que revienta—, el
//      siguiente arranque sabe que murió y dónde. Una salida ordenada (Claude cierra, SIGTERM,
//      stdin cerrado) borra la marca: eso no es una caída.
//   2. Envía a Robin un informe técnico: versión, sistema, memoria, fase, causa, extensión y
//      tamaño del fichero, y el final de los registros.
//
// Qué NO viaja nunca: nada de los documentos. Ni contenido, ni nombres de fichero, ni rutas, ni
// nombres de expediente o de carpeta. El registro se envía por LISTA BLANCA de campos (nunca la
// línea en bruto) y todo texto libre pasa por `limpiarTexto`. El servidor vuelve a limpiar lo que
// recibe (segunda barrera).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { leerCuentas } from './correo/ajustes.js';
import { config, VERSION, rootForPath } from './config.js';
import { log } from './logger.js';
import { state } from './state.js';
import { esRutaDeRed } from './net.js';
import { rutas } from './rutas.js';
import { pidVivo } from './escritor.js';
import * as registry from './indexer/registry.js';
import * as cuarentena from './indexer/cuarentena.js';
import nube from './indexer/nube.js';
import { getBearerQuiet, ultimoErrorRed } from './auth/oauth.js';
import { certificadosSistema } from './certificados-sistema.js';
import { escribirAtomico, escribirJson, conCerrojoDeFichero } from './persistencia.js';

const ENTRE_INFORMES_IGUALES_MS = 12 * 3600 * 1000;
const MAX_INFORMES_DIA = 20;
const MAX_LINEAS_PROPIAS = 150;
const MAX_LINEAS_CLAUDE = 60;
const MARCA_CADUCA_MS = 24 * 3600 * 1000;

const rutaEstado = () => path.join(config.dataDir, 'diagnostico.json');
const rutaMarca = (pid = process.pid) => path.join(config.dataDir, `en_curso-${pid}.json`);

// ── Estado persistente (caídas seguidas, envíos, id de instalación) ───────────────────────
function leerEstado() {
  try {
    return JSON.parse(fs.readFileSync(rutaEstado(), 'utf8')) || {};
  } catch {
    return {};
  }
}

// Leer-modificar-escribir BAJO CERROJO: Claude arranca dos instancias y las dos cuentan caídas
// y envíos a la vez; sin cerrojo, la segunda escritura pisaba la primera (una caída contada dos
// veces o ninguna, dos «instalaciones» distintas). `fn` modifica el estado y devuelve lo que sea.
function modificarEstado(fn) {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    return conCerrojoDeFichero(
      rutaEstado(),
      () => {
        const est = leerEstado();
        const r = fn(est);
        escribirJson(rutaEstado(), est);
        return r;
      },
      { esperaMaxMs: 3000 },
    );
  } catch {
    // Sin disco (o cerrojo ocupado demasiado tiempo) no hay estado: se sigue sin él.
    const est = leerEstado();
    return fn(est);
  }
}

// Identificador aleatorio de ESTA instalación (agrupa los informes de un mismo equipo). No se
// deriva de nada de la persona ni del equipo.
function instalacionId() {
  const est = leerEstado();
  if (est.instalacion) return est.instalacion;
  return modificarEstado((e) => {
    if (!e.instalacion) e.instalacion = crypto.randomUUID();
    return e.instalacion;
  });
}

// ── 1. Marca de fase ────────────────────────────────────────────────────────────────────────
let _marca = null;
// Cuándo arrancó ESTE proceso: ata la marca al «Initializing server» de Claude que lo lanzó.
const INICIO_PROCESO = new Date(Date.now() - process.uptime() * 1000).toISOString();
// En un cierre ordenado ya no se escriben marcas: el indexado que sigue unos milisegundos volvía
// a dejar una y el siguiente arranque la tomaba por caída sobre un fichero sano.
let _cerrando = false;

// LATIDO de la marca (29-sep-2026). Sin él, de una marca huérfana solo se sabía cuándo EMPEZÓ la
// fase, no cuándo murió el proceso ni con cuánta memoria: dos equipos Windows de 16 GB «caídos»
// en pleno OCR con 400-700 MB libres —y 5-6 GB libres al volver— sin poder decir si el proceso
// murió de memoria o lo cerró Claude. Mientras hay una fase abierta, la marca se reescribe cada
// pocos segundos con la hora y la memoria del proceso: el siguiente arranque sabe CUÁNDO murió
// (± un latido) y cómo estaba. Solo números.
const LATIDO_MS = Number(process.env.ROBIN_LATIDO_MS) || 5000;
let _latido = null;

function memoriaAhora() {
  const MB = 1048576;
  try {
    const m = process.memoryUsage();
    return {
      rss_mb: Math.round(m.rss / MB),
      heap_mb: Math.round(m.heapUsed / MB),
      externa_mb: Math.round((m.external || 0) / MB),
      libre_mb: Math.round(os.freemem() / MB),
    };
  } catch {
    return {};
  }
}

function escribirMarca() {
  try {
    // Atómica: un proceso que muere A MITAD de escribir la marca (justo lo que se quiere
    // diagnosticar) dejaba un JSON cortado, y el siguiente arranque no sabía ni la fase.
    escribirAtomico(rutaMarca(), JSON.stringify(_marca));
  } catch {
    /* sin marca no hay diagnóstico de caída, pero el trabajo sigue */
  }
}

function latir() {
  if (!_marca || _cerrando) return;
  _marca = { ..._marca, latido: new Date().toISOString(), ...memoriaAhora() };
  escribirMarca();
}

export function marcarFase(fase, extra = {}) {
  if (_cerrando) return;
  const ahora = new Date().toISOString();
  _marca = { pid: process.pid, fase, t: ahora, inicio: INICIO_PROCESO, version: VERSION, latido: ahora, ...memoriaAhora(), ...extra };
  escribirMarca();
  if (!_latido) {
    _latido = setInterval(latir, LATIDO_MS);
    _latido.unref?.();
  }
}

export function finFase() {
  _marca = null;
  if (_latido) clearInterval(_latido);
  _latido = null;
  try {
    fs.rmSync(rutaMarca(), { force: true });
  } catch {
    /* nada */
  }
}

export function faseActual() {
  return _marca?.fase ?? null;
}

// ¿Murió la ejecución anterior? Mira las marcas de procesos que ya no existen. Las de un proceso
// VIVO son de otra instancia en marcha (Claude arranca dos) y no se tocan.
export function revisarCaidaAnterior() {
  let nombres = [];
  try {
    nombres = fs.readdirSync(config.dataDir);
  } catch {
    return null;
  }
  const caidas = [];
  for (const n of nombres) {
    const m = /^en_curso-(\d+)\.json$/.exec(n);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid) continue;
    const ruta = path.join(config.dataDir, n);
    let edad = 0;
    try {
      edad = Date.now() - fs.statSync(ruta).mtimeMs;
    } catch {
      continue;
    }
    // Un pid vivo con una marca de más de un día es un pid reciclado por otro programa.
    if (pidVivo(pid) && edad < MARCA_CADUCA_MS) continue;
    // Claude arranca dos instancias a la vez: las dos veían la misma marca y la contaban, y UNA
    // caída pasaba por dos (fichero sano apartado, índice rehecho). Solo la cuenta quien consigue
    // renombrarla primero.
    const reclamada = `${ruta}.reclamada-${process.pid}`;
    try {
      fs.renameSync(ruta, reclamada);
    } catch {
      continue;
    }
    let d = null;
    try {
      d = JSON.parse(fs.readFileSync(reclamada, 'utf8'));
    } catch {
      d = null;
    }
    try {
      fs.rmSync(reclamada, { force: true });
    } catch {
      /* nada */
    }
    const cerroClaude = d?.fase && d.fase !== 'excepcion' ? claudeLaCerro(d) : false;
    if (cerroClaude === true) {
      // Claude pidió el cierre (se reinstala o actualiza la extensión, se cierra Claude) y mató el
      // proceso antes de que atendiera la señal: no es una caída ni el fichero tiene culpa.
      log.info('La ejecución anterior la cerró Claude: no es una caída', { fase: d.fase });
      continue;
    }
    if (d?.fase && d.fase !== 'excepcion' && cerradaPorActualizacion(d)) {
      // Sin registro de Claude (o sin que lo mencione) también se sabe: la versión que murió no
      // es esta, y esta se instaló justo cuando aquella dejó de latir. Al actualizar una
      // extensión Claude la cierra para cambiarla; en Windows, sin aviso (24 y 29-sep-2026: dos
      // «caídas» abriendo el índice que eran la actualización a la 1.8.6 y a la 1.9.0).
      log.info('La ejecución anterior la cerró Claude al actualizar la extensión: no es una caída', {
        fase: d.fase,
        version: String(d.version),
      });
      continue;
    }
    // `null` = no hay registro de Claude que consultar. Pudo ser una caída o pudo ser Claude
    // cerrando el servidor para reabrirlo; se anota como INCIERTA: ni se aparta el documento que
    // estaba leyendo (estaba sano) ni cuenta para rehacer el índice, que son las dos reacciones
    // caras. Se sigue avisando, pero dicho como lo que es.
    if (cerroClaude === null && d) d.incierta = true;
    if (d?.fase) caidas.push(d);
  }
  if (!caidas.length) return null;
  caidas.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  const seguidas = modificarEstado((est) => {
    est.caidas = [...(est.caidas || []), ...caidas.map((c) => ({ fase: c.faseOriginal || c.fase, t: c.t, version: c.version ?? null, incierta: c.incierta === true }))].slice(-10);
    est.caidasSeguidas = (est.caidasSeguidas || 0) + caidas.length;
    return est.caidasSeguidas;
  });
  return { ...caidas[caidas.length - 1], caidasSeguidas: seguidas };
}

// Cuándo se instaló ESTA versión en el disco: el cambio (ctime) más reciente de la carpeta de la
// extensión y de su package.json. ctime y no mtime: el descompresor puede conservar la fecha del
// paquete en mtime, pero ctime la pone el sistema al escribir.
export function instalacionMs() {
  const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  let ms = NaN;
  for (const p of [raiz, path.join(raiz, 'package.json')]) {
    try {
      const st = fs.statSync(p);
      const t = Math.max(st.ctimeMs || 0, st.mtimeMs || 0);
      if (!(ms >= t)) ms = t;
    } catch {
      /* sin dato */
    }
  }
  return ms;
}

// Margen entre la última señal de vida de la versión anterior y la instalación de esta.
const MARGEN_ACTUALIZACION_MS = 60_000;

// ¿Murió la ejecución de la marca porque Claude instaló otra versión de la extensión? Solo con
// marcas que LATEN (desde la 1.9.1): sin latido no se sabe cuándo murió, y una caída seguida de
// una actualización hecha a mano no puede pasar por cierre de Claude.
export function cerradaPorActualizacion(marca, instaladaMs = instalacionMs()) {
  if (!marca?.version || marca.version === VERSION) return false;
  const vivo = Date.parse(marca.latido || '');
  if (!Number.isFinite(vivo) || !Number.isFinite(instaladaMs)) return false;
  return Math.abs(instaladaMs - vivo) <= MARGEN_ACTUALIZACION_MS;
}

// Lo técnico de la marca que ayuda a distinguir una caída de un cierre, para el registro (solo
// números y la versión): cuánto hacía que no latía al arrancar esta, y su memoria en ese latido.
export function datosDeMarca(marca, ahora = Date.now()) {
  const vivo = Date.parse(marca?.latido || marca?.t || '');
  const inicio = Date.parse(INICIO_PROCESO);
  const out = {};
  if (Number.isFinite(vivo)) out.sin_latir_s = Math.max(0, Math.round((Math.min(ahora, inicio) - vivo) / 1000));
  out.con_latido = Boolean(marca?.latido);
  for (const k of ['rss_mb', 'heap_mb', 'externa_mb', 'libre_mb']) if (Number.isFinite(marca?.[k])) out[k] = marca[k];
  if (marca?.version) out.version = String(marca.version);
  return out;
}

// El índice abrió bien: las caídas anteriores al abrirlo ya no cuentan.
export function indiceAbierto() {
  arranqueCompleto();
}

// El arranque llegó al final (índice abierto, modelo cargado, indexado inicial hecho).
export function arranqueCompleto() {
  if (!leerEstado().caidasSeguidas) return;
  modificarEstado((est) => {
    est.caidasSeguidas = 0;
  });
}

// Cuántas de las últimas caídas SEGUIDAS ocurrieron en alguna de estas fases, Y con esta misma
// versión. Lo segundo importa porque la única reacción a esta cuenta es REHACER el índice: el
// 21-sep un despacho con 37.910 documentos llegó a la 1.8.0 arrastrando dos caídas de la 1.6.1 y
// a una sola de perder el índice entero por un fallo que la versión nueva podía haber arreglado.
// Al actualizar, la cuenta empieza de cero; una caída de verdad vuelve a sumar enseguida.
export function caidasSeguidasEn(fases) {
  const est = leerEstado();
  const seguidas = est.caidasSeguidas ? (est.caidas || []).slice(-est.caidasSeguidas) : [];
  let n = 0;
  for (let i = seguidas.length - 1; i >= 0 && fases.includes(seguidas[i].fase); i--) {
    if (seguidas[i].version !== VERSION) break;
    // Una caída INCIERTA (sin registro de Claude que la confirme) no puede disparar el rehacer
    // del índice: en un equipo donde ese registro no se lee, cada reapertura de Claude sumaba
    // una y tres seguidas reindexaban 39.000 documentos (22-sep-2026).
    if (seguidas[i].incierta) break;
    n += 1;
  }
  return n;
}

// ── 2. Limpieza: nada de los documentos sale del ordenador ─────────────────────────────────
//
// Hasta la 1.4.7 la limpieza iba «a la caza» de rutas y nombres de fichero con expresiones, y se
// le escapaban: un paréntesis cortaba la expresión («Informe pericial … (definitivo).pdf» salía
// entero) y una ruta RELATIVA («member Pérez García/escrito.pdf») no se reconocía como ruta.
// Ahora se razona al revés, por lista blanca:
//   1. Un mensaje técnico CONOCIDO (lista cerrada) pasa tal cual.
//   2. Cualquier otro texto se parte en TRAMOS («: », «, », «; », saltos de línea) y todo tramo
//      con algo que parezca fichero (extensión), ruta (separadores) o texto entre comillas se
//      sustituye ENTERO. Se pierde algo de detalle técnico; nunca sale un nombre.
const MENSAJES_TECNICOS = [
  /^(?:FATAL ERROR: )?Reached heap limit Allocation failed - JavaScript heap out of memory$/,
  /^(?:(?:Range)?Error: )?Cannot create a string longer than 0x[0-9a-f]+ characters$/i,
  /^(?:(?:Range)?Error: )?(?:Array buffer allocation failed|Invalid string length|Invalid array length|Maximum call stack size exceeded)$/,
  /^(?:(?:Abort|Timeout)?Error: )?(?:tiempo agotado|fetch failed|socket hang up|other side closed|The operation was aborted(?: due to timeout)?|This operation was aborted)$/,
  /^(?:E[A-Z0-9_]{2,}|ERR_[A-Z0-9_]+)$/,
];

const EXT_DOC =
  '(?:pdf|docx?|dotx?|docm|odt|rtf|txt|md|markdown|html?|pptx?|odp|xlsx?|xlsm|ods|fods|csv|tsv|eml|msg|jpe?g|png|tiff?|bmp|gif|heic|heif|webp|zip|rar|7z|pages|numbers|key|xml|json)';
const PARO = `'"”»\`\n`;
const RE_EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const RE_DNI = /\b(?:\d{8}|[XYZxyz]\d{7})[-\s]?[A-Za-z]\b/g;
// Texto entre comillas (de cualquier tipo). Un apóstrofo DENTRO de una palabra («doesn't») no abre.
const RE_COMILLAS = /(^|[^\p{L}\p{N}])('[^'\n]*'|"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|‘[^’\n]*’|`[^`\n]*`)(?![\p{L}\p{N}])/gu;
const RE_CODIGO = /^(?:E[A-Z0-9_]{2,}|ERR_[A-Z0-9_]+|\d+)$/;
const RE_TRAMO = /(:\s+|;\s+|,\s+|\s*\n\s*|\s+\|\s+)/;
const RE_EXT_DOC = new RegExp(`[^\\s<]\\.(${EXT_DOC})(?![\\p{L}\\p{N}])`, 'iu');
// Cualquier «algo.ext» (letra tras el punto): server.js, acta.odg, dominio.es. «1.4.7» no.
const RE_EXT_OTRA = /[\p{L}\p{N})\]_~-]\.\p{L}[\p{L}\p{N}]{0,5}(?![\p{L}\p{N}])/u;
// Barras que no son rutas: «i/o», «n/a», «y/o», «3/10».
const RE_BARRA_INOCUA = /\b(?:i\/o|n\/a|y\/o)\b|\b\d+\/\d+\b/gi;
const RE_TECNICO = /^(?:[a-z0-9 _#=+<>()-]*|[A-Z][A-Z0-9_]+)$/;

const nfc = (x) => (typeof x === 'string' && x.normalize ? x.normalize('NFC') : x);

function tipoSensible(tramo) {
  const m = RE_EXT_DOC.exec(tramo);
  if (m) return `<fichero.${m[1].toLowerCase()}>`;
  if (/[\\/]/.test(tramo.replace(RE_BARRA_INOCUA, ''))) return '<ruta>';
  if (RE_EXT_OTRA.test(tramo)) return '<fichero>';
  return null;
}

function limpiarTramos(s) {
  const partes = s.split(RE_TRAMO); // [tramo, separador, tramo, separador, …]
  const n = Math.ceil(partes.length / 2);
  const marca = new Array(n).fill(null);
  for (let i = 0; i < n; i++) marca[i] = tipoSensible(partes[2 * i]);
  // Una coma puede ser PARTE del nombre («Informe, final.pdf»): lo que va pegado por comas a un
  // tramo sensible y no tiene pinta técnica se va con él.
  for (let pasada = 0; pasada < 2; pasada++) {
    for (let i = 0; i < n; i++) {
      if (!marca[i]) continue;
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= n || marca[j]) continue;
        const sep = partes[2 * Math.min(i, j) + 1] || '';
        if (sep.trim() === ',' && !RE_TECNICO.test(partes[2 * j].trim())) marca[j] = marca[i];
      }
    }
  }
  let out = '';
  for (let i = 0; i < n; i++) {
    const sep = i > 0 ? partes[2 * i - 1] : '';
    if (marca[i] && i > 0 && marca[i - 1] && sep.trim() === ',') continue; // mismo nombre partido
    out += sep + (marca[i] ?? partes[2 * i]);
  }
  return out;
}

// Literales que NUNCA pueden salir: las carpetas vigiladas y la carpeta personal (rutas), y los
// nombres de las carpetas y de los expedientes (un «Pérez - Divorcio» ya es dato del cliente).
export function literalesSensibles() {
  const rutas = new Set();
  const nombres = new Set();
  const addRuta = (x) => {
    if (typeof x !== 'string' || x.trim().length < 3) return;
    const c = nfc(x);
    rutas.add(c);
    rutas.add(c.replace(/\\/g, '/'));
    rutas.add(c.replace(/\\/g, '\\\\'));
  };
  const addNombre = (x) => {
    if (typeof x === 'string' && x.trim().length >= 3) nombres.add(nfc(x.trim()));
  };
  for (const r of config.roots || []) {
    addRuta(r.path);
    addNombre(r.name);
  }
  addRuta(os.homedir());
  addRuta(config.dataDir);
  // La cuenta de correo del abogado y su servidor: el aviso técnico ya tapa cualquier dirección
  // de correo que encuentre, pero el HOST («correoseguro.midespacho.es») identifica al despacho
  // igual de bien y no tiene forma de email. Se añade como literal para que lo tape la barrera.
  try {
    for (const correo of leerCuentas()) {
      addNombre(correo.usuario);
      addNombre(correo.imap?.host);
      addNombre(correo.smtp?.host);
    }
  } catch {
    /* sin correo configurado */
  }
  addRuta(os.tmpdir());
  try {
    for (const e of registry.all()) {
      if (!e?.expediente) continue;
      addNombre(e.expediente);
      for (const seg of String(e.expediente).split('/')) addNombre(seg);
    }
  } catch {
    /* sin registro todavía */
  }
  const porLargo = (a, b) => b.length - a.length;
  return { rutas: [...rutas].sort(porLargo), nombres: [...nombres].sort(porLargo) };
}

const MAX_ENTRADA = 4000;

export function limpiarTexto(entrada, lit = literalesSensibles()) {
  if (entrada === null || entrada === undefined) return entrada;
  let s = nfc(String(entrada));
  if (s.length > MAX_ENTRADA) {
    // Cortar a ciegas puede dejar medio nombre SIN su extensión (y entonces no se reconoce):
    // el último tramo, que es el cortado, se descarta entero.
    s = s.slice(0, MAX_ENTRADA);
    const partes = s.split(RE_TRAMO);
    s = `${partes.slice(0, -1).join('')}<cortado>`;
  }
  const recortado = s.trim();
  if (MENSAJES_TECNICOS.some((re) => re.test(recortado))) return recortado.slice(0, 500);
  // Una ruta conocida se corta desde donde empieza hasta la comilla o el final: lo que sigue a
  // la carpeta del abogado son sus subcarpetas y sus ficheros.
  for (const r of lit.rutas) {
    let i = s.indexOf(r);
    while (i >= 0) {
      let fin = i + r.length;
      while (fin < s.length && !PARO.includes(s[fin])) fin += 1;
      s = `${s.slice(0, i)}<ruta>${s.slice(fin)}`;
      i = s.indexOf(r);
    }
  }
  for (const n of lit.nombres) if (s.includes(n)) s = s.split(n).join('<nombre>');
  s = s
    .replace(RE_EMAIL, '<email>')
    .replace(RE_DNI, '<dni>')
    .replace(RE_COMILLAS, (_m, antes, citado) => {
      const dentro = citado.slice(1, -1);
      return `${antes}${RE_CODIGO.test(dentro) ? citado : `${citado[0]}<texto>${citado[citado.length - 1]}`}`;
    });
  return limpiarTramos(s).slice(0, 500);
}

// Un error, reducido a lo técnico: nombre, código, llamada al sistema y el mensaje limpio.
export function errorTecnico(err, lit) {
  if (err === null || err === undefined) return '';
  if (typeof err !== 'object') return limpiarTexto(String(err), lit);
  const cabeza = [err.name, err.code, err.syscall]
    .filter((x) => typeof x === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(x))
    .join(' ');
  const msg = limpiarTexto(String(err.message ?? ''), lit);
  return (cabeza && msg ? `${cabeza}: ${msg}` : cabeza || msg).slice(0, 500);
}

// Lista blanca de lo que puede viajar de cada línea del registro.
const CLAVES_TEXTO = new Set([
  'err', 'causa', 'motivo', 'origen', 'model', 'estado', 'fase', 'code', 'ext', 'ubicacion',
  'version', 'actual', 'disponible', 'tipo', 'cmd', 'protocolo', 'name', 'firma', 'syscall', 'como',
]);
const CLAVES_FUERA = new Set([
  'fichero', 'ficheros_ejemplo', 'ruta', 'rutaRelativa', 'ruta_relativa', 'carpeta', 'carpetas',
  'dir', 'dataDir', 'expediente', 'expedientes', 'ejemplo', 'texto', 'query', 'raiz', 'nombre',
  'path', 'file', 'abs', 'ficheroActual', 'subcarpeta', 'url', 'email', 'usuario', 'user',
  'subcarpetas_ilegibles', 'carpetas_inaccesibles', 'sesion',
]);

export function sanearDatos(valor, lit = literalesSensibles(), clave = '', prof = 0) {
  if (CLAVES_FUERA.has(clave)) return undefined;
  if (valor === null || typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'string') return CLAVES_TEXTO.has(clave) ? limpiarTexto(valor, lit).slice(0, 300) : undefined;
  if (prof > 4) return undefined;
  if (Array.isArray(valor)) {
    return valor
      .slice(0, 20)
      .map((x) => sanearDatos(x, lit, clave, prof + 1))
      .filter((x) => x !== undefined);
  }
  if (typeof valor === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(valor)) {
      const r = sanearDatos(v, lit, k, prof + 1);
      if (r !== undefined) o[k] = r;
    }
    return o;
  }
  return undefined;
}

function colaDeFichero(ruta, bytes) {
  try {
    const st = fs.statSync(ruta);
    const inicio = Math.max(0, st.size - bytes);
    const fd = fs.openSync(ruta, 'r');
    try {
      const buf = Buffer.alloc(st.size - inicio);
      fs.readSync(fd, buf, 0, buf.length, inicio);
      let s = buf.toString('utf8');
      if (inicio > 0) s = s.slice(s.indexOf('\n') + 1);
      return s;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function lineaPropia(j, lit) {
  const out = { t: String(j?.t || '').slice(0, 40), level: String(j?.level || '').slice(0, 10), msg: limpiarTexto(j?.msg ?? '', lit) };
  if (j?.data && typeof j.data === 'object') out.data = sanearDatos(j.data, lit);
  return out;
}

// Registro de Claude sobre NUESTRO proceso: ahí queda lo que el proceso escribió al morir
// (p. ej. «FATAL ERROR: Reached heap limit»), que nuestro propio registro no llega a ver.
function dirsLogClaude() {
  // Salida de emergencia para soporte (y para las pruebas): dónde tiene Claude sus registros en
  // este equipo, si estuvieran en un sitio que no sabemos encontrar.
  if (process.env.ROBIN_CLAUDE_LOGS_DIR) return [process.env.ROBIN_CLAUDE_LOGS_DIR];
  const home = os.homedir();
  const dirs = [];
  if (process.platform === 'darwin') dirs.push(path.join(home, 'Library', 'Logs', 'Claude'));
  else if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.push(path.join(appdata, 'Claude', 'logs'));
    // Tres equipos Windows con `sin_fichero` (24-sep a 1-oct-2026): por si esa instalación los
    // deja en Local y no en Roaming. Mirar una carpeta que no existe no cuesta nada.
    dirs.push(path.join(local, 'Claude', 'logs'));
    // Claude instalado desde la Tienda (MSIX) escribe bajo `Packages\<familia>\LocalCache`. La
    // familia lleva un sufijo que cambia con la firma del paquete, así que NO se puede escribir a
    // mano: se buscan las carpetas que empiecen por «Claude» o acaben en «.Claude_…».
    const packages = path.join(local, 'Packages');
    let familias = [];
    try {
      familias = fs.readdirSync(packages).filter((n) => /(^|\.)Claude[._]/i.test(n) || /^Claude_/i.test(n));
    } catch {
      familias = ['Claude_pzs8sxrjxfjjc', 'AnthropicPBC.Claude_fnn82j28hfe8t'];
    }
    for (const f of familias) dirs.push(path.join(packages, f, 'LocalCache', 'Roaming', 'Claude', 'logs'));
  } else dirs.push(path.join(home, '.config', 'Claude', 'logs'));
  return dirs;
}

// El nombre del fichero lo pone CLAUDE con el nombre que tenga la extensión instalada
// («mcp-server-RobinSearch.log», «mcp-server-Robin Search.log», «mcp-server-robin-search.log»…).
// Hasta la 1.8.3 se probaban DOS nombres exactos: donde no coincidía, no había registro de Claude
// que leer, y sin él toda reapertura del servidor pasaba por CAÍDA (22-sep-2026, un despacho con
// tres «caídas» en diez minutos y un .xlsx sano apartado). Ahora se listan los
// «mcp-server-*.log» de la carpeta y se reconoce el nuestro sin puntuación ni mayúsculas.
export const esLogNuestro = (n) =>
  /^mcp-server-.*\.log$/i.test(n) && /robinsearch/.test(n.toLowerCase().replace(/[^a-z0-9]/g, ''));

// Estado de la última búsqueda del registro de Claude: para dejar de adivinar por qué en un
// equipo no lo encontramos (viaja en el informe, nunca la ruta).
let _estadoLogClaude = 'sin_mirar';
let _detalleLogClaude = null;
export function estadoLogClaude() {
  if (_estadoLogClaude === 'sin_mirar') fuenteLogClaude();
  return _estadoLogClaude;
}

// Qué se vio al buscarlo, en números (29-sep-2026). Tres equipos Windows siguen trayendo
// `sin_fichero` con la 1.9.0 y no se sabía ni si la carpeta que miramos es la que Claude usa
// (MSIX redirige %APPDATA%\Claude a su paquete). Viaja en el registro: nunca nombres ni rutas.
export function detalleLogClaude() {
  if (_estadoLogClaude === 'sin_mirar') fuenteLogClaude();
  return _detalleLogClaude;
}

// Nuestra huella: la línea que el servidor escribe por stderr al quedar listo (server/index.js).
// 🔴 29-sep-2026: con el Node que trae Claude (UtilityProcess), lo que el servidor escribe por
// stderr NO va a «mcp-server-<nombre>.log» sino a main.log («[UtilityProcess stderr] …»), así que
// reconocer el registro por esta huella (1.8.5) no casaba nunca. Se conserva por si Claude vuelve
// a guardarla ahí, pero lo que reconoce un registro por su contenido es la ETIQUETA con la que
// Claude firma cada línea sobre nuestro servidor: «[RobinSearch]».
export const HUELLA_PROPIA = 'robin-search:';

// ¿Habla esta línea de NUESTRO servidor? Claude pone el nombre del servidor entre corchetes.
export function lineaEsNuestra(linea) {
  for (const m of String(linea).matchAll(/\[([^\]\n]{1,80})\]/g)) {
    if (/robinsearch/.test(m[1].toLowerCase().replace(/[^a-z0-9]/g, ''))) return true;
  }
  return false;
}

// ¿Este registro ajeno es, por lo que DICE, el nuestro? Se mira solo la cola, y solo se busca lo
// nuestro: nada de un fichero ajeno sale del equipo.
function colaEsNuestra(ruta) {
  try {
    const cola = colaDeFichero(ruta, 64 * 1024);
    if (cola.includes(HUELLA_PROPIA)) return true;
    return cola.split('\n').some((l) => /(Initializing server|Shutting down server|transport closed)/i.test(l) && lineaEsNuestra(l));
  } catch {
    return false;
  }
}

// El registro de Claude sobre NUESTRO servidor: `{ ruta, soloNuestras, main, mtimeMs }` o null.
// Por orden:
//   1. «mcp-server-*.log» cuyo NOMBRE lo diga (el más reciente: al reinstalar quedan dos);
//   2. «mcp-server-*.log» cuyo CONTENIDO lo diga (el nombre lo pone la instalación);
//   3. «mcp.log», el registro común de todos los servidores, quedándose solo con NUESTRAS líneas
//      (las lleva igual, con la misma hora UTC): si falta el fichero propio, está este.
// Y además, `main`: el «main.log» de Claude si habla de nuestro servidor (ver eventoDeLinea).
// 🔴 2-oct-2026: Claude Desktop lanza el servidor por DOS caminos. El de los chats deja su
// «Initializing server» / «Shutting down server» en el registro del servidor; el de las sesiones
// de Cowork y Code (LocalMcpServerManager, al abrir la aplicación) SOLO escribe en main.log. Un
// proceso lanzado por el segundo y cerrado por Claude no aparecía en ningún registro que
// leyéramos, y se daba por CAÍDA (no incierta: caída, con documento apartado) — Mac de Eduardo,
// 1-oct, «se cortó sin cerrar cargando el modelo».
function fuenteLogClaude() {
  let mejor = null;
  let mt = 0;
  let estado = null;
  let vistoDir = false;
  let sinPermiso = false;
  const det = { carpetas_probadas: 0, carpetas_legibles: 0, logs_mcp_server: 0, mcp_log: false, main_log: false, main_log_nuestro: false, reciente_min: null };
  const ajenos = [];
  const comunes = [];
  const principales = [];
  const dirs = dirsLogClaude();
  det.carpetas_probadas = dirs.length;
  if (process.platform === 'win32') {
    det.msix_familias = dirs.filter((d) => /[\\/]Packages[\\/]/i.test(d)).length;
    det.claude_empaquetado = /[\\/]WindowsApps[\\/]/i.test(process.execPath || '');
  }
  let masReciente = 0;
  for (const d of dirs) {
    let nombres;
    try {
      nombres = fs.readdirSync(d);
      vistoDir = true;
      det.carpetas_legibles += 1;
    } catch (err) {
      // En el equipo del 22-sep el sistema devolvía EPERM hasta al listar carpetas. Si es eso,
      // se dice: «no lo encuentro» y «no me dejan mirar» piden cosas distintas a soporte.
      if (err?.code === 'EPERM' || err?.code === 'EACCES') sinPermiso = true;
      else if (err?.code !== 'ENOENT') vistoDir = true;
      continue;
    }
    for (const n of nombres) {
      if (!/\.log$/i.test(n)) continue;
      const r = path.join(d, n);
      let st;
      try {
        st = fs.statSync(r);
      } catch {
        continue; /* desaparecido entre el listado y el stat */
      }
      if (st.mtimeMs > masReciente) masReciente = st.mtimeMs;
      if (/^main\.log$/i.test(n)) {
        det.main_log = true;
        principales.push([r, st.mtimeMs]);
        continue;
      }
      if (/^mcp\.log$/i.test(n)) {
        det.mcp_log = true;
        comunes.push([r, st.mtimeMs]);
        continue;
      }
      if (!/^mcp-server-.*\.log$/i.test(n)) continue;
      det.logs_mcp_server += 1;
      if (esLogNuestro(n)) {
        if (st.mtimeMs > mt) {
          mt = st.mtimeMs;
          mejor = { ruta: r, soloNuestras: false, mtimeMs: st.mtimeMs };
          estado = 'leido';
        }
      } else ajenos.push([r, st.mtimeMs]);
    }
  }
  if (masReciente) det.reciente_min = Math.max(0, Math.round((Date.now() - masReciente) / 60000));
  if (!mejor) {
    ajenos.sort((a, b) => b[1] - a[1]);
    for (const [r, m] of ajenos) {
      if (!colaEsNuestra(r)) continue;
      mejor = { ruta: r, soloNuestras: false, mtimeMs: m };
      estado = 'leido_por_contenido';
      break;
    }
  }
  if (!mejor) {
    comunes.sort((a, b) => b[1] - a[1]);
    for (const [r, m] of comunes) {
      if (!colaEsNuestra(r)) continue;
      mejor = { ruta: r, soloNuestras: true, mtimeMs: m };
      estado = 'leido_mcp_log';
      break;
    }
  }
  // main.log: el más reciente que hable de nuestro servidor (lanzamientos y cierres).
  principales.sort((a, b) => b[1] - a[1]);
  for (const [r, m] of principales) {
    if (!colaDeFichero(r, BYTES_MAIN_LOG).split('\n').some((l) => eventoDeLinea(l, { soloNuestras: true }))) continue;
    det.main_log_nuestro = true;
    if (mejor) {
      mejor.main = r;
      mejor.mtimeMs = Math.max(mejor.mtimeMs || 0, m);
    } else {
      mejor = { ruta: null, soloNuestras: true, main: r, mtimeMs: m };
      estado = 'leido_main_log';
    }
    break;
  }
  _estadoLogClaude = estado || (sinPermiso ? 'sin_permiso' : vistoDir ? 'sin_fichero' : 'sin_carpeta');
  _detalleLogClaude = det;
  return mejor;
}

// main.log crece deprisa (todo Claude escribe ahí): se lee más cola que de los otros.
const BYTES_MAIN_LOG = 1024 * 1024;

// Las líneas del registro de Claude que hablan de nuestro servidor (todas, si el fichero es solo
// nuestro; solo las etiquetadas, si es el común).
function lineasFuente(fuente, bytes) {
  if (!fuente.ruta) return [];
  const lineas = colaDeFichero(fuente.ruta, bytes).split('\n');
  return fuente.soloNuestras ? lineas.filter(lineaEsNuestra) : lineas;
}

// Las líneas de main.log que son lanzamientos o cierres de NUESTRO servidor. Con un registro de
// servidor delante, de main.log solo hace falta el camino que ese registro no ve (Cowork/Code);
// sin él, los dos.
function lineasMain(fuente) {
  if (!fuente.main) return [];
  const soloLocal = Boolean(fuente.ruta);
  return colaDeFichero(fuente.main, BYTES_MAIN_LOG)
    .split('\n')
    .filter((l) => {
      const e = eventoDeLinea(l, { soloNuestras: true });
      return e && (!soloLocal || e.canal === 'local');
    });
}

const RE_CLAUDE_UTIL =
  /(error|fatal|heap|memory|memoria|abort|signal|sigkill|sigabrt|exit|crash|disconnect|killed|terminat|transport closed|initializing server|shutting down|robin-search:)/i;

function lineasDeClaude(lit) {
  const fuente = fuenteLogClaude();
  if (!fuente) return [];
  const out = [];
  for (const bruto of lineasFuente(fuente, 64 * 1024)) {
    const l = bruto.trim();
    // Los mensajes del protocolo pueden llevar lo que el abogado pidió: fuera, siempre.
    if (!l || /Message from (client|server)/i.test(l) || !RE_CLAUDE_UTIL.test(l)) continue;
    const m = /^(\S+)\s+(.*)$/.exec(l);
    const t = m ? m[1].slice(0, 40) : '';
    const resto = m ? m[2] : l;
    const k = resto.indexOf('{"t":"');
    if (k >= 0) {
      // Una línea de NUESTRO registro que Claude recogió de stderr: misma lista blanca.
      try {
        out.push({ ...lineaPropia(JSON.parse(resto.slice(k)), lit), level: 'claude' });
        continue;
      } catch {
        /* no era JSON completo: se trata como texto */
      }
    }
    out.push({ t, level: 'claude', msg: limpiarTexto(resto, lit) });
  }
  // De main.log, solo los lanzamientos y cierres de nuestro servidor, con la hora pasada a UTC.
  for (const bruto of lineasMain(fuente).slice(-MAX_LINEAS_CLAUDE)) {
    const h = horaDeLinea(bruto.trim());
    if (!h) continue;
    out.push({ t: new Date(h.t).toISOString(), level: 'claude', msg: limpiarTexto(`[main] ${h.resto}`, lit) });
  }
  return out.slice(-MAX_LINEAS_CLAUDE);
}

// Hora de una línea de un registro de Claude. Los de servidor (mcp-server-*.log, mcp.log) van en
// UTC con milisegundos («2026-10-01T16:41:01.893Z …»); main.log va en hora LOCAL y al segundo
// («2026-10-01 18:40:49 [info] …»).
export function horaDeLinea(linea) {
  let m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(.*)$/.exec(linea);
  if (m) {
    const t = Date.parse(m[1]);
    return Number.isFinite(t) ? { t, resto: m[2] } : null;
  }
  m = /^\[?(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\]?\s+(.*)$/.exec(linea);
  if (!m) return null;
  // Sin zona, Date.parse de «AAAA-MM-DDTHH:MM:SS» es hora LOCAL: la del equipo, como la escribe Claude.
  const t = Date.parse(`${m[1]}T${m[2]}`);
  return Number.isFinite(t) ? { t, resto: m[3] } : null;
}

const esNombreNuestro = (s) => /robinsearch/.test(String(s).toLowerCase().replace(/[^a-z0-9]/g, ''));

// Qué cuenta una línea de Claude del ciclo de vida de NUESTRO servidor: `{ t, tipo, canal }` o null.
//   tipo:  inicio · cierre (lo pidió Claude) · muerte (el proceso terminó solo) · sondeo
//   canal: 'chat' (el lanzador de las conversaciones) o 'local' (LocalMcpServerManager, el de las
//          sesiones de Cowork y Code). Un cierre solo vale para un proceso de SU canal.
// `soloNuestras`: el registro es común a varios servidores y la línea tiene que nombrar el nuestro.
export function eventoDeLinea(linea, { soloNuestras = false } = {}) {
  const h = horaDeLinea(String(linea).trim());
  if (!h) return null;
  const { t, resto } = h;
  const ev = (tipo, canal, nombre) => (nombre === undefined || esNombreNuestro(nombre) ? { t, tipo, canal } : null);
  let m;
  // main.log
  if ((m = /\[LocalMcpServerManager\] Connecting to (.+?)\s*$/.exec(resto))) return ev('inicio', 'local', m[1]);
  if ((m = /\[LocalMcpServerManager\] Closing (.+?)\s*$/.exec(resto))) return ev('cierre', 'local', m[1]);
  if ((m = /\[LocalMcpServerManager\] (.+?) connected after closeAll; reaping/.exec(resto))) return ev('cierre', 'local', m[1]);
  if ((m = /\[LocalMcpServerManager\] (.+?) disconnected\s*$/.exec(resto))) return ev('muerte', 'local', m[1]);
  if ((m = /Launching MCP Server: (.+?)\s*$/.exec(resto))) return ev('inicio', 'chat', m[1]);
  if ((m = /Shutting down MCP [Ss]erver:? (.+?)(?: for extension .*)?\s*$/.exec(resto))) return ev('cierre', 'chat', m[1]);
  // Registros de servidor (mcp-server-*.log; mcp.log con la etiqueta del servidor)
  if (soloNuestras && !lineaEsNuestra(resto)) return null;
  if (/Initializing server/i.test(resto)) return ev('inicio', 'chat');
  if (/Shutting down server|intentional shutdown/i.test(resto)) return ev('cierre', 'chat');
  if (/Server transport closed/i.test(resto)) return ev('muerte', 'chat');
  // Al lanzar, Claude arranca un proceso de SONDEO; si no completa el intercambio («legacy»), lo
  // descarta y lanza otro. El descartado no deja «Shutting down» (Mac de Alonso, 1-oct-2026:
  // «Initializing» 16:41:01.89, proceso, «Era probe verdict: legacy» 16:41:06.15, otro proceso).
  if (/Era probe verdict: legacy/i.test(resto)) return ev('sondeo', 'chat');
  return null;
}

// ¿Terminó la ejecución que dejó la marca porque Claude la cerró? En el registro de Claude, esa
// ejecución empieza con el «Initializing server» que la lanzó (unos segundos antes de que el
// proceso arrancase) y lo primero que Claude anota sobre su final es «Shutting down server…» si la
// cerró él, o «Server transport closed» a secas si el proceso murió solo.
//
// Hasta la 1.6.0 una marca huérfana era SIEMPRE una caída. Pero Claude, al cerrar, no siempre da
// tiempo a atender SIGTERM (proceso ocupado leyendo un PDF): el siguiente arranque avisaba de una
// «caída» y ponía bajo sospecha un fichero sano (aviso técnico del 16-sep, 1.6.0: 94 ms entre el cierre
// pedido por Claude y el fin del proceso).
//
// Sin el arranque del proceso en la marca (marcas de antes de la 1.6.1) o sin un lanzamiento que
// case con él (lanzado por la app, la CLI, una prueba), se sigue contando como caída.
export function claudeLaCerro(marca, lineas = null) {
  const inicio = Date.parse(marca?.inicio);
  if (!Number.isFinite(inicio)) return false;
  if (!lineas) {
    const fuente = fuenteLogClaude();
    // Sin registro de Claude no se sabe si la cerró él o se cayó: `null`, nunca «se cayó».
    if (!fuente) return null;
    // Un registro que Claude no ha tocado desde ANTES de lanzar ese proceso (el lanzamiento se
    // anota como mucho un minuto antes de que arranque) no puede contar cómo terminó: es de otra
    // instalación o de otra época. Su silencio no prueba nada.
    if (Number.isFinite(fuente.mtimeMs) && fuente.mtimeMs < inicio - 60_000) return null;
    lineas = [...lineasFuente(fuente, 256 * 1024), ...lineasMain(fuente)];
  }
  const eventos = [];
  for (const l of lineas) {
    const e = eventoDeLinea(l);
    if (e) eventos.push(e);
  }
  // Por tiempo, no por orden en el fichero: Claude escribe estas líneas desde varios sitios y en
  // el mismo milisegundo salen cambiadas («Server transport closed» antes que el «Shutting down»
  // que lo provocó). Leído en bruto, un cierre ordenado pasaba por muerte del proceso.
  eventos.sort((a, b) => a.t - b.t);
  // El lanzamiento del proceso es el más cercano ANTES de su arranque, dentro de 60 s (en
  // Windows, con el antivirus mirando node.exe, entre la línea y el proceso pasan segundos).
  // 🔴 29-sep-2026: se admitía también uno hasta 1 s DESPUÉS del arranque y, al recorrerlos todos,
  // ganaba el último: Claude cerró un proceso a los 0,3 s de nacer y lo relanzó 23 ms después; el
  // «Initializing» del RELANZAMIENTO caía dentro de ese segundo, se tomaba por el del proceso
  // muerto, detrás no había cierre y el cierre ordenado pasaba por CAÍDA. Uno posterior al
  // arranque solo vale si no hay ninguno anterior (desfase de reloj de milisegundos).
  let lanzado = -1;
  let posterior = -1;
  for (let i = 0; i < eventos.length; i++) {
    const e = eventos[i];
    if (e.tipo !== 'inicio') continue;
    if (e.t <= inicio && inicio - e.t <= 60_000) lanzado = i;
    else if (e.t > inicio && e.t <= inicio + 1000 && posterior < 0) posterior = i;
  }
  if (lanzado < 0) lanzado = posterior;
  // El registro existe y no menciona el arranque de esa ejecución: no la lanzó ESTE Claude (la
  // lanzó la app, el CLI o una prueba), así que Claude no pudo cerrarla.
  if (lanzado < 0) return false;
  const canal = eventos[lanzado].canal;
  // Solo cuenta lo que le pasó a SU canal; y un veredicto de sondeo anterior al arranque es de
  // otro proceso (el relanzado nace después del veredicto).
  const resto = eventos
    .slice(lanzado + 1)
    .filter((e) => e.tipo !== 'inicio' && e.canal === canal && !(e.tipo === 'sondeo' && e.t <= inicio));
  const fin = resto[0];
  if (!fin) return false;
  if (fin.tipo === 'cierre') return true;
  // Nació entre el lanzamiento y el veredicto del sondeo: era el proceso de sondeo, y Claude lo
  // descartó para lanzar otro.
  if (fin.tipo === 'sondeo') return true;
  // El cierre y la muerte que lo acompaña llegan juntos: si hay un «Shutting down» pegado al final
  // (±2 s), lo cerró Claude. Una caída de verdad no trae ninguno.
  return resto.some((e) => e.tipo === 'cierre' && Math.abs(e.t - fin.t) <= 2000);
}

export function registroSaneado(lit = literalesSensibles()) {
  const out = [];
  const propio = colaDeFichero(path.join(config.logDir, 'robin-search.log'), 256 * 1024)
    .split('\n')
    .filter(Boolean)
    .slice(-MAX_LINEAS_PROPIAS);
  for (const l of propio) {
    try {
      out.push(lineaPropia(JSON.parse(l), lit));
    } catch {
      /* línea cortada */
    }
  }
  out.push(...lineasDeClaude(lit));
  return out;
}

// Última barrera sobre el JSON entero: ningún literal sensible, ni siquiera escapado.
function barrera(cuerpo, lit) {
  let s = cuerpo;
  for (const x of [...lit.rutas, ...lit.nombres]) {
    // También en NFD (macOS entrega los nombres de fichero descompuestos: «e» + tilde).
    const formas = [x, x.normalize('NFD')];
    for (const v of new Set(formas.flatMap((f) => [f, JSON.stringify(f).slice(1, -1)]))) {
      if (v && s.includes(v)) s = s.split(v).join('<privado>');
    }
  }
  return s;
}

// ── 3. El informe ──────────────────────────────────────────────────────────────────────────
function tamanyoDir(dir) {
  let bytes = 0;
  const pila = [dir];
  while (pila.length) {
    const d = pila.pop();
    let entradas = [];
    try {
      entradas = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) pila.push(p);
      else {
        try {
          bytes += fs.statSync(p).size;
        } catch {
          /* desapareció */
        }
      }
    }
  }
  return bytes;
}

function sistema() {
  let heap = null;
  try {
    heap = Math.round(v8.getHeapStatistics().heap_size_limit / 1048576);
  } catch {
    heap = null;
  }
  return {
    plataforma: process.platform,
    arch: process.arch,
    os: os.release(),
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    certificados_sistema: certificadosSistema,
    ultimo_error_red: ultimoErrorRed(),
    ram_total_mb: Math.round(os.totalmem() / 1048576),
    ram_libre_mb: Math.round(os.freemem() / 1048576),
    heap_limite_mb: heap,
  };
}

function indiceResumen() {
  const r = { documentos: null, fragmentos: null, bytes: 0, cuarentena: 0 };
  try {
    const s = registry.stats();
    r.documentos = s.documentos;
    r.fragmentos = s.fragmentos;
  } catch {
    /* sin registro */
  }
  r.bytes = tamanyoDir(path.join(config.dataDir, 'indice')) + tamanyoDir(config.indexDir || path.join(config.dataDir, 'index'));
  try {
    r.cuarentena = cuarentena.lista().length;
  } catch {
    /* nada */
  }
  return r;
}

const RE_NUBE = /(Mobile Documents|CloudStorage|iCloud|OneDrive|Dropbox|Google Drive|GoogleDrive|Box Sync)/i;

// Por el nombre no basta: cuando OneDrive se queda con «Documentos» o «Escritorio» (lo que
// Microsoft llama «copia de seguridad de carpetas»), la ruta no lleva «OneDrive» por ningún lado
// y una carpeta de la nube pasaba por carpeta local. Windows sí lo dice en el entorno. 21-sep-2026:
// un despacho con 72 ficheros sin bajar salía en el informe con «carpetas en la nube: 0».
function raicesDeNubeDelEntorno() {
  return ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer', 'iCloudDrive']
    .map((v) => process.env[v])
    .filter((v) => v && v.length > 3);
}

function esDeLaNube(p) {
  if (RE_NUBE.test(p)) return true;
  const ruta = String(p).toLowerCase();
  return raicesDeNubeDelEntorno().some((raiz) => ruta.startsWith(raiz.toLowerCase()));
}
// Una carpeta con documentos que la nube todavía no ha bajado ES una carpeta de la nube, diga lo
// que diga su ruta. Es la prueba que no se puede discutir, y la que faltaba: el 22-sep-2026 un
// informe traía 72 ficheros «sin descargar de la nube» y, a la vez, «carpetas en la nube: 0»
// (OneDrive con las carpetas redirigidas, sin «OneDrive» en la ruta ni en el entorno de ESTE
// proceso). Sin esto, el diagnóstico apunta al sitio equivocado.
function raicesConPendientesDeNube() {
  const out = new Set();
  try {
    for (const e of nube.lista()) {
      const r = e?.ruta && rootForPath(e.ruta);
      if (r?.path) out.add(rutas.claveRuta(r.path));
    }
  } catch {
    /* sin lista de pendientes se decide solo por la ruta */
  }
  return out;
}

export const carpetasResumenParaPruebas = () => carpetasResumen();

function carpetasResumen() {
  const lista = config.watchedFolders || [];
  const red = lista.filter((p) => {
    try {
      return esRutaDeRed(p);
    } catch {
      return false;
    }
  }).length;
  const conPendientes = raicesConPendientesDeNube();
  return {
    total: lista.length,
    red,
    nube: lista.filter((p) => esDeLaNube(p) || conPendientes.has(rutas.claveRuta(p))).length,
  };
}

function puedeEnviar(firma) {
  const est = leerEstado();
  const ahora = Date.now();
  const ultimo = est.enviados?.[firma];
  if (ultimo && ahora - ultimo < ENTRE_INFORMES_IGUALES_MS) return false;
  const hoy = (est.enviosRecientes || []).filter((t) => ahora - t < 24 * 3600 * 1000);
  return hoy.length < MAX_INFORMES_DIA;
}

function anotarEnvio(firma) {
  const ahora = Date.now();
  modificarEstado((est) => {
    est.enviados = Object.fromEntries(
      Object.entries({ ...(est.enviados || {}), [firma]: ahora }).filter(([, t]) => ahora - t < 7 * 24 * 3600 * 1000),
    );
    est.enviosRecientes = [...(est.enviosRecientes || []).filter((t) => ahora - t < 24 * 3600 * 1000), ahora];
  });
}

function conTope(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((_, rechazar) => {
      const t = setTimeout(() => rechazar(new Error('tiempo agotado')), ms);
      t.unref?.();
    }),
  ]);
}

// Construye el informe (sin enviarlo). Exportado para las pruebas.
export function construirInforme(motivo, datos = {}) {
  let lit;
  try {
    lit = literalesSensibles();
  } catch {
    lit = { rutas: [os.homedir()], nombres: [] };
  }
  const causa = datos.causa ? limpiarTexto(datos.causa, lit) : null;
  const fichero = datos.fichero?.ext
    ? {
        ext: String(datos.fichero.ext).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10),
        bytes: Number.isFinite(Number(datos.fichero.bytes)) ? Number(datos.fichero.bytes) : null,
      }
    : null;
  const firma = crypto
    .createHash('sha1')
    .update([motivo, datos.fase || '', String(causa || '').replace(/\d+/g, '#'), fichero?.ext || ''].join('|'))
    .digest('hex')
    .slice(0, 12);
  const informe = {
    esquema: 1,
    motivo,
    firma,
    version: VERSION,
    instalacion: instalacionId(),
    sistema: sistema(),
    indice: indiceResumen(),
    carpetas: carpetasResumen(),
    fase: datos.fase ?? null,
    causa,
    fichero,
    caidas_seguidas: leerEstado().caidasSeguidas || 0,
    // Si el registro de Claude se ha podido leer en este equipo o no: de ello depende que una
    // marca huérfana se sepa distinguir de un cierre de Claude, y hasta hoy lo adivinábamos.
    claude_log: estadoLogClaude(),
    registro: registroSaneado(lit),
  };
  let cuerpo = barrera(JSON.stringify(informe), lit);
  while (cuerpo.length > 60000 && informe.registro.length > 10) {
    informe.registro = informe.registro.slice(Math.floor(informe.registro.length / 2));
    cuerpo = barrera(JSON.stringify(informe), lit);
  }
  return { informe, cuerpo, firma };
}

// Envía el aviso técnico. Nunca lanza: un fallo al avisar no puede tumbar nada.
export async function informar(motivo, datos = {}, { esperarMs = 6000 } = {}) {
  const resultado = { motivo, fase: datos.fase ?? null, t: new Date().toISOString(), enviado: false };
  try {
    const { cuerpo, firma } = construirInforme(motivo, datos);
    resultado.firma = firma;
    state.ultimoInforme = resultado;
    if (!config.diagnosticoUrl) {
      resultado.noEnviado = 'desactivado';
      return resultado;
    }
    if (!puedeEnviar(firma)) {
      resultado.noEnviado = 'ya_avisado';
      return resultado;
    }
    const bearer = await conTope(getBearerQuiet(), 3000).catch(() => null);
    const res = await fetch(config.diagnosticoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RobinSearch-Version': VERSION, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: cuerpo,
      signal: AbortSignal.timeout(esperarMs),
    });
    resultado.enviado = res.ok;
    resultado.http = res.status;
    if (res.ok) {
      try {
        resultado.id = (await res.json())?.id ?? null;
      } catch {
        resultado.id = null;
      }
      anotarEnvio(firma);
      log.info('Aviso técnico enviado a Robin', { motivo, fase: datos.fase ?? null, firma });
    } else {
      log.warn('Robin no aceptó el aviso técnico', { motivo, code: String(res.status) });
    }
  } catch (err) {
    log.warn('No se pudo enviar el aviso técnico', { motivo, err: String(err?.message ?? err) });
  }
  return resultado;
}

// ── 4. Manejadores del proceso ──────────────────────────────────────────────────────────────
export function instalarManejadores({ alCerrar } = {}) {
  let cerrando = false;
  const salirLimpio = (motivo) => {
    if (cerrando) return;
    cerrando = true;
    _cerrando = true;
    log.info('Cierre ordenado de RobinSearch', { motivo });
    try {
      alCerrar?.();
    } catch {
      /* nada */
    }
    finFase();
    setTimeout(() => process.exit(0), 100);
  };
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    try {
      process.on(s, () => salirLimpio(s));
    } catch {
      /* señal no disponible en esta plataforma */
    }
  }
  // Una promesa rechazada que nadie recoge TUMBA el proceso en Node ≥15. Aquí se registra, se
  // avisa y el servidor sigue atendiendo.
  //
  // Y nadie más puede cambiar eso: los módulos WASM de Emscripten (onnxruntime-web al cargar el
  // modelo, y cualquier otro que se cargue después) añaden manejadores que RELANZAN el rechazo
  // o la excepción, y el host de Node de Claude sale con exit(1). Cualquier manejador ajeno de
  // estos dos eventos se retira en cuanto se añade.
  const propios = new Set();
  process.on('newListener', (evento, fn) => {
    if ((evento === 'unhandledRejection' || evento === 'uncaughtException') && !propios.has(fn)) {
      queueMicrotask(() => process.removeListener(evento, fn));
    }
  });
  const alRechazo = (motivo) => {
    log.error('Promesa rechazada sin capturar (el servidor sigue)', { err: String(motivo?.stack || motivo?.message || motivo) });
    informar('excepcion', { fase: faseActual() || 'en_marcha', causa: errorTecnico(motivo) }).catch(() => {});
  };
  propios.add(alRechazo);
  process.on('unhandledRejection', alRechazo);
  // Tras una excepción sin capturar el estado del proceso no es fiable: se deja la marca con la
  // causa (para el siguiente arranque, y para apartar el fichero si fue leyendo uno), se intenta
  // avisar y se sale.
  const alExcepcion = (err) => {
    log.error('Excepción no capturada', { err: String(err?.stack || err) });
    const previa = _marca || {};
    marcarFase('excepcion', {
      faseOriginal: previa.fase ?? null,
      fichero: previa.fichero ?? null,
      ext: previa.ext ?? null,
      bytes: previa.bytes ?? null,
      causa: String(err?.message ?? err).slice(0, 1000),
    });
    const salir = () => process.exit(1);
    informar('excepcion', {
      fase: previa.fase || 'en_marcha',
      causa: errorTecnico(err),
      fichero: previa.ext ? { ext: previa.ext, bytes: previa.bytes } : null,
    })
      .catch(() => {})
      .finally(salir);
    setTimeout(salir, 5000).unref?.();
  };
  propios.add(alExcepcion);
  process.on('uncaughtException', alExcepcion);
  return { salirLimpio };
}

export default {
  marcarFase,
  finFase,
  faseActual,
  revisarCaidaAnterior,
  indiceAbierto,
  arranqueCompleto,
  caidasSeguidasEn,
  limpiarTexto,
  errorTecnico,
  sanearDatos,
  registroSaneado,
  construirInforme,
  informar,
  instalarManejadores,
  literalesSensibles,
};
