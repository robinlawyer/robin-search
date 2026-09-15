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
import { config, VERSION } from './config.js';
import { log } from './logger.js';
import { state } from './state.js';
import { esRutaDeRed } from './net.js';
import { pidVivo } from './escritor.js';
import * as registry from './indexer/registry.js';
import * as cuarentena from './indexer/cuarentena.js';
import { getBearerQuiet } from './auth/oauth.js';

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

function guardarEstado(est) {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${rutaEstado()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(est));
    fs.renameSync(tmp, rutaEstado());
  } catch {
    /* sin disco no hay estado; nada más */
  }
}

// Identificador aleatorio de ESTA instalación (agrupa los informes de un mismo equipo). No se
// deriva de nada de la persona ni del equipo.
function instalacionId() {
  const est = leerEstado();
  if (!est.instalacion) {
    est.instalacion = crypto.randomUUID();
    guardarEstado(est);
  }
  return est.instalacion;
}

// ── 1. Marca de fase ────────────────────────────────────────────────────────────────────────
let _marca = null;

export function marcarFase(fase, extra = {}) {
  _marca = { pid: process.pid, fase, t: new Date().toISOString(), version: VERSION, ...extra };
  try {
    fs.writeFileSync(rutaMarca(), JSON.stringify(_marca));
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
    let d = null;
    try {
      d = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    } catch {
      d = null;
    }
    try {
      fs.rmSync(ruta, { force: true });
    } catch {
      /* nada */
    }
    if (d?.fase) caidas.push(d);
  }
  if (!caidas.length) return null;
  caidas.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  const est = leerEstado();
  est.caidas = [...(est.caidas || []), ...caidas.map((c) => ({ fase: c.faseOriginal || c.fase, t: c.t }))].slice(-10);
  est.caidasSeguidas = (est.caidasSeguidas || 0) + caidas.length;
  guardarEstado(est);
  return { ...caidas[caidas.length - 1], caidasSeguidas: est.caidasSeguidas };
}

// El arranque llegó al final (índice abierto, modelo cargado, indexado inicial hecho).
export function arranqueCompleto() {
  const est = leerEstado();
  if (est.caidasSeguidas) {
    est.caidasSeguidas = 0;
    guardarEstado(est);
  }
}

// Cuántas de las últimas caídas SEGUIDAS ocurrieron en alguna de estas fases.
export function caidasSeguidasEn(fases) {
  const est = leerEstado();
  const seguidas = est.caidasSeguidas ? (est.caidas || []).slice(-est.caidasSeguidas) : [];
  let n = 0;
  for (let i = seguidas.length - 1; i >= 0 && fases.includes(seguidas[i].fase); i--) n += 1;
  return n;
}

// ── 2. Limpieza: nada de los documentos sale del ordenador ─────────────────────────────────
const EXT_DOC =
  '(?:pdf|docx?|dotx?|odt|rtf|txt|md|html?|pptx?|odp|xlsx?|xlsm|ods|csv|tsv|eml|msg|jpe?g|png|tiff?|bmp|gif|heic|webp|zip|rar|7z|pages|numbers|key|xml)';
const PARO = `'"”»\`\n`;
const RE_COMILLAS_CON_RUTA = /(['"“«`])[^'"”»`\n]*[/\\][^'"”»`\n]*(['"”»`])/g;
const RE_RUTA_WIN = /(^|[\s([=:,])(?:[A-Za-z]:[\\/]|\\\\)[^\n]*/g;
const RE_RUTA_POSIX = /(^|[\s([=:,])~?\/[^\s/][^/\n]*\/[^\n]*/g;
const TROZO = `[^\\s:'"()\\[\\],<>/\\\\._-]+`;
const RE_FICHERO = new RegExp(`${TROZO}(?:[ ._-]+${TROZO})*\\.${EXT_DOC}\\b`, 'gi');
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const RE_DNI = /\b(?:\d{8}|[XYZxyz]\d{7})[-\s]?[A-Za-z]\b/g;

// Literales que NUNCA pueden salir: las carpetas vigiladas y la carpeta personal (rutas), y los
// nombres de las carpetas y de los expedientes (un «Pérez - Divorcio» ya es dato del cliente).
export function literalesSensibles() {
  const rutas = new Set();
  const nombres = new Set();
  const addRuta = (x) => {
    if (typeof x !== 'string' || x.trim().length < 3) return;
    rutas.add(x);
    rutas.add(x.replace(/\\/g, '/'));
    rutas.add(x.replace(/\\/g, '\\\\'));
  };
  const addNombre = (x) => {
    if (typeof x === 'string' && x.trim().length >= 3) nombres.add(x.trim());
  };
  for (const r of config.roots || []) {
    addRuta(r.path);
    addNombre(r.name);
  }
  addRuta(os.homedir());
  addRuta(config.dataDir);
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

export function limpiarTexto(entrada, lit = literalesSensibles()) {
  if (entrada === null || entrada === undefined) return entrada;
  let s = String(entrada).slice(0, 4000);
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
    .replace(RE_COMILLAS_CON_RUTA, '$1<ruta>$2')
    .replace(RE_RUTA_WIN, '$1<ruta>')
    .replace(RE_RUTA_POSIX, '$1<ruta>')
    .replace(RE_FICHERO, (m) => `<fichero${path.extname(m).toLowerCase()}>`)
    .replace(RE_EMAIL, '<email>')
    .replace(RE_DNI, '<dni>');
  return s.slice(0, 500);
}

// Lista blanca de lo que puede viajar de cada línea del registro.
const CLAVES_TEXTO = new Set([
  'err', 'causa', 'motivo', 'origen', 'model', 'estado', 'fase', 'code', 'ext', 'ubicacion',
  'version', 'actual', 'disponible', 'tipo', 'cmd', 'protocolo', 'name', 'firma',
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
function rutasLogClaude() {
  const home = os.homedir();
  const dirs = [];
  if (process.platform === 'darwin') dirs.push(path.join(home, 'Library', 'Logs', 'Claude'));
  else if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.push(path.join(appdata, 'Claude', 'logs'));
    for (const p of ['Claude_pzs8sxrjxfjjc', 'AnthropicPBC.Claude_fnn82j28hfe8t']) {
      dirs.push(path.join(local, 'Packages', p, 'LocalCache', 'Roaming', 'Claude', 'logs'));
    }
  } else dirs.push(path.join(home, '.config', 'Claude', 'logs'));
  const out = [];
  for (const d of dirs) for (const n of ['mcp-server-RobinSearch.log', 'mcp-server-Robin Search.log']) out.push(path.join(d, n));
  return out;
}

const RE_CLAUDE_UTIL =
  /(error|fatal|heap|memory|memoria|abort|signal|sigkill|sigabrt|exit|crash|disconnect|killed|terminat|transport closed|initializing server|shutting down|robin-search:)/i;

function lineasDeClaude(lit) {
  let mejor = null;
  let mt = 0;
  for (const r of rutasLogClaude()) {
    try {
      const st = fs.statSync(r);
      if (st.mtimeMs > mt) {
        mt = st.mtimeMs;
        mejor = r;
      }
    } catch {
      /* no existe */
    }
  }
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
    for (const v of new Set([x, JSON.stringify(x).slice(1, -1)])) {
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
function carpetasResumen() {
  const lista = config.watchedFolders || [];
  const red = lista.filter((p) => {
    try {
      return esRutaDeRed(p);
    } catch {
      return false;
    }
  }).length;
  return { total: lista.length, red, nube: lista.filter((p) => RE_NUBE.test(p)).length };
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
  const est = leerEstado();
  const ahora = Date.now();
  est.enviados = Object.fromEntries(
    Object.entries({ ...(est.enviados || {}), [firma]: ahora }).filter(([, t]) => ahora - t < 7 * 24 * 3600 * 1000),
  );
  est.enviosRecientes = [...(est.enviosRecientes || []).filter((t) => ahora - t < 24 * 3600 * 1000), ahora];
  guardarEstado(est);
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
  process.on('unhandledRejection', (motivo) => {
    log.error('Promesa rechazada sin capturar (el servidor sigue)', { err: String(motivo?.stack || motivo?.message || motivo) });
    informar('excepcion', { fase: faseActual() || 'en_marcha', causa: String(motivo?.message ?? motivo) }).catch(() => {});
  });
  // Tras una excepción sin capturar el estado del proceso no es fiable: se deja la marca con la
  // causa (para el siguiente arranque, y para apartar el fichero si fue leyendo uno), se intenta
  // avisar y se sale.
  process.on('uncaughtException', (err) => {
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
      causa: String(err?.message ?? err),
      fichero: previa.ext ? { ext: previa.ext, bytes: previa.bytes } : null,
    })
      .catch(() => {})
      .finally(salir);
    setTimeout(salir, 5000).unref?.();
  });
  return { salirLimpio };
}

export default {
  marcarFase,
  finFase,
  faseActual,
  revisarCaidaAnterior,
  arranqueCompleto,
  caidasSeguidasEn,
  limpiarTexto,
  sanearDatos,
  registroSaneado,
  construirInforme,
  informar,
  instalarManejadores,
  literalesSensibles,
};
