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
import { leerCorreo } from './correo/ajustes.js';
import { config, VERSION, rootForPath } from './config.js';
import { log } from './logger.js';
import { state } from './state.js';
import { esRutaDeRed } from './net.js';
import { rutas } from './rutas.js';
import { pidVivo } from './escritor.js';
import * as registry from './indexer/registry.js';
import * as cuarentena from './indexer/cuarentena.js';
import nube from './indexer/nube.js';
import { getBearerQuiet } from './auth/oauth.js';
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

export function marcarFase(fase, extra = {}) {
  if (_cerrando) return;
  _marca = { pid: process.pid, fase, t: new Date().toISOString(), inicio: INICIO_PROCESO, version: VERSION, ...extra };
  try {
    // Atómica: un proceso que muere A MITAD de escribir la marca (justo lo que se quiere
    // diagnosticar) dejaba un JSON cortado, y el siguiente arranque no sabía ni la fase.
    escribirAtomico(rutaMarca(), JSON.stringify(_marca));
  } catch {
    /* sin marca no hay diagnóstico de caída, pero el trabajo sigue */
  }
}

export function finFase() {
  _marca = null;
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
    const correo = leerCorreo();
    addNombre(correo.usuario);
    addNombre(correo.imap?.host);
    addNombre(correo.smtp?.host);
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
export function estadoLogClaude() {
  if (_estadoLogClaude === 'sin_mirar') rutaLogClaude();
  return _estadoLogClaude;
}

// El fichero de registro de Claude sobre NUESTRO servidor, o null si no lo hay. Se queda con el
// más reciente: al reinstalar la extensión con otro nombre quedan los dos.
function rutaLogClaude() {
  let mejor = null;
  let mt = 0;
  let vistoDir = false;
  let sinPermiso = false;
  for (const d of dirsLogClaude()) {
    let nombres;
    try {
      nombres = fs.readdirSync(d);
      vistoDir = true;
    } catch (err) {
      // En el equipo del 22-sep el sistema devolvía EPERM hasta al listar carpetas. Si es eso,
      // se dice: «no lo encuentro» y «no me dejan mirar» piden cosas distintas a soporte.
      if (err?.code === 'EPERM' || err?.code === 'EACCES') sinPermiso = true;
      else if (err?.code !== 'ENOENT') vistoDir = true;
      continue;
    }
    for (const n of nombres) {
      if (!esLogNuestro(n)) continue;
      const r = path.join(d, n);
      try {
        const st = fs.statSync(r);
        if (st.mtimeMs > mt) {
          mt = st.mtimeMs;
          mejor = r;
        }
      } catch {
        /* desaparecido entre el listado y el stat */
      }
    }
  }
  _estadoLogClaude = mejor ? 'leido' : sinPermiso ? 'sin_permiso' : vistoDir ? 'sin_fichero' : 'sin_carpeta';
  return mejor;
}

const RE_CLAUDE_UTIL =
  /(error|fatal|heap|memory|memoria|abort|signal|sigkill|sigabrt|exit|crash|disconnect|killed|terminat|transport closed|initializing server|shutting down|robin-search:)/i;

function lineasDeClaude(lit) {
  const mejor = rutaLogClaude();
  if (!mejor) return [];
  const out = [];
  for (const bruto of colaDeFichero(mejor, 64 * 1024).split('\n')) {
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
  return out.slice(-MAX_LINEAS_CLAUDE);
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
// Sin el arranque del proceso en la marca (marcas de antes de la 1.6.1) o sin un «Initializing
// server» que case con él (lanzado por la app, la CLI, una prueba), se sigue contando como caída.
export function claudeLaCerro(marca, lineas = null) {
  const inicio = Date.parse(marca?.inicio);
  if (!Number.isFinite(inicio)) return false;
  if (!lineas) {
    const mejor = rutaLogClaude();
    // Sin registro de Claude no se sabe si la cerró él o se cayó: `null`, nunca «se cayó».
    if (!mejor) return null;
    lineas = colaDeFichero(mejor, 256 * 1024).split('\n');
  }
  const eventos = [];
  for (const bruto of lineas) {
    const m = /^(\d{4}-\d{2}-\d{2}T\S+Z)\s+(.*)$/.exec(bruto.trim());
    if (!m) continue;
    const t = Date.parse(m[1]);
    if (!Number.isFinite(t)) continue;
    if (/Initializing server/i.test(m[2])) eventos.push({ t, tipo: 'inicio' });
    else if (/Shutting down server|intentional shutdown/i.test(m[2])) eventos.push({ t, tipo: 'cierre' });
    else if (/Server transport closed/i.test(m[2])) eventos.push({ t, tipo: 'muerte' });
  }
  // Por tiempo, no por orden en el fichero: Claude escribe estas líneas desde varios sitios y en
  // el mismo milisegundo salen cambiadas («Server transport closed» antes que el «Shutting down»
  // que lo provocó). Leído en bruto, un cierre ordenado pasaba por muerte del proceso.
  eventos.sort((a, b) => a.t - b.t);
  // El «Initializing server» más cercano ANTES del arranque (el proceso nace tras él), dentro de 60 s
  // (en Windows, con el antivirus mirando node.exe, entre la línea y el proceso pasan segundos).
  let lanzado = -1;
  for (let i = 0; i < eventos.length; i++) {
    const e = eventos[i];
    if (e.tipo === 'inicio' && e.t <= inicio + 1000 && inicio - e.t <= 60_000) lanzado = i;
  }
  // El registro existe y no menciona el arranque de esa ejecución: no la lanzó ESTE Claude (la
  // lanzó la app, el CLI o una prueba), así que Claude no pudo cerrarla.
  if (lanzado < 0) return false;
  const resto = eventos.slice(lanzado + 1).filter((e) => e.tipo !== 'inicio');
  const fin = resto[0];
  if (!fin) return false;
  if (fin.tipo === 'cierre') return true;
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
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
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
