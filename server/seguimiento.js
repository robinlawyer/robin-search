// SEGUIMIENTO DEL INDEXADO (1.13.2, 9-nov-2026).
//
// 🔴 POR QUÉ EXISTE. Fernando (fmchocarro, 114.800 documentos) dejó el equipo «encendido todo el
// fin de semana» y el lunes había 3.960 indexados. No hubo ni un fallo: RobinSearch simplemente no
// estaba corriendo (Claude cerrado o Windows suspendido) desde el viernes, y nadie lo supo hasta que
// Juan fue a verlo. Los informes de fallo (diagnostico.js) solo hablan cuando algo se rompe; un
// indexado PARADO no rompe nada y no decía nada.
//
// Dos cosas, las dos desde el propio RobinSearch (dentro de Claude), sin depender de RobinDesktop:
//
//  1. LATIDO DE PROGRESO a Robin (`POST /robinsearch/progreso`) mientras queden documentos por
//     indexar: cada 10 minutos, al empezar y al terminar una pasada y al despertar el equipo. El
//     servidor avisa a Alonso y a Juan si un equipo con documentos pendientes deja de latir o deja
//     de avanzar. SOLO CIFRAS (regla de Alonso, 14-sep: «nada de sus documentos»): procesados,
//     pendientes, documentos en el índice, versión, sistema, memoria libre. Ni nombres, ni rutas,
//     ni carpetas.
//
//  2. EL EQUIPO NO SE DUERME mientras indexa: en macOS `caffeinate -i -w <pid>` y en Windows
//     SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) desde un PowerShell oculto que
//     muere con nosotros. Solo evita la suspensión POR INACTIVIDAD (la pantalla sí se apaga);
//     cerrar la tapa sigue suspendiendo, y eso lo cuenta el latido al despertar.
//
// Solo late la instancia que ESCRIBE el índice (las demás no saben el progreso). Nunca lanza.
// ROBIN_SEGUIMIENTO=off lo apaga entero; ROBIN_NO_DESVELAR=1 solo el «no dormir».

import os from 'node:os';
import { spawn } from 'node:child_process';
import { config, VERSION } from './config.js';
import { log } from './logger.js';
import { state } from './state.js';
import escritor from './escritor.js';
import * as registry from './indexer/registry.js';
import { instalacionId, lanzador } from './diagnostico.js';
import { getBearerQuiet } from './auth/oauth.js';

const MIN = 60 * 1000;
const env = (k, def) => Number(process.env[k]) || def;
export const TICK_MS = env('ROBIN_SEGUIMIENTO_TICK_MS', MIN);
export const CADA_INDEXANDO_MS = env('ROBIN_SEGUIMIENTO_CADA_MS', 10 * MIN);
export const CADA_AL_DIA_MS = env('ROBIN_SEGUIMIENTO_AL_DIA_MS', 6 * 60 * MIN);
// Un salto del reloj entre dos vueltas mayor que esto = el equipo ha estado suspendido.
const SALTO_SUSPENSION_MS = 3 * MIN;
// Tras acabar de indexar, se mantiene el equipo despierto un poco: el vigilante suele encadenar
// otra pasada (carpeta recién añadida, re-escaneo de red) y así no se abre y cierra el PowerShell.
const SOLTAR_TRAS_MS = env('ROBIN_SEGUIMIENTO_SOLTAR_MS', 2 * MIN);

export function urlProgreso(diagnosticoUrl = config.diagnosticoUrl) {
  if (!diagnosticoUrl) return null;
  const u = String(diagnosticoUrl).replace(/\/+$/, '');
  return /\/diagnostico$/.test(u) ? u.replace(/\/diagnostico$/, '/progreso') : null;
}

const apagado = () => /^(off|0|false|no)$/i.test(String(process.env.ROBIN_SEGUIMIENTO || '').trim());

// ── Cifras ──────────────────────────────────────────────────────────────────────────────────
// Una pasada «de carpetas» (no el vigilante indexando un fichero suelto, que no lleva `carpetas`).
function pasadaEnCurso(s = state) {
  return s.estado === 'indexando' && Boolean(s.progreso?.carpetas);
}

function entero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

// Lo que se manda. Lista blanca: todo número o un texto corto de una lista cerrada.
export function cifras(s = state, { documentos = null } = {}) {
  const p = s.progreso || {};
  const u = s.ultimoIndexado || {};
  const enCurso = pasadaEnCurso(s);
  let pendientes = null;
  if (enCurso) pendientes = p.fase === 'indexando' ? entero(p.pendientes) : null;
  else if (u && typeof u.pendientes === 'number') pendientes = entero(u.pendientes);
  return {
    estado: ['activo', 'indexando', 'error'].includes(s.estado) ? s.estado : 'otro',
    fase: enCurso ? (['buscando', 'indexando'].includes(p.fase) ? p.fase : 'otra') : null,
    procesados: enCurso ? entero(p.procesados) : null,
    total: enCurso ? entero(p.total) : null,
    encontrados: enCurso && p.fase === 'buscando' ? entero(p.encontrados) : null,
    pendientes,
    a_indexar: enCurso ? null : entero(u.a_indexar),
    eta_segundos: enCurso ? entero(p.eta_segundos) : null,
    documentos: entero(documentos),
    errores: entero(u.errores),
    sin_texto: s.ficherosSinOcr ? s.ficherosSinOcr.size : null,
    hay_error: Boolean(s.ultimoError),
  };
}

// ── El equipo no se duerme mientras indexa ────────────────────────────────────────────────────
let _desvelo = null; // proceso hijo
let _soltarEn = 0;

function comandoDesvelo(pid = process.pid, plataforma = process.platform) {
  if (plataforma === 'darwin') return ['/usr/bin/caffeinate', ['-i', '-w', String(pid)]];
  if (plataforma === 'win32') {
    const ps =
      "$t = Add-Type -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);' " +
      "-Name RobinDesvelo -Namespace RobinSearch -PassThru; " +
      '[void]$t::SetThreadExecutionState([uint32]2147483649); ' +
      `while (Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 20 }`;
    const enc = Buffer.from(ps, 'utf16le').toString('base64');
    const raiz = process.env.SystemRoot || 'C:\\Windows';
    return [
      `${raiz}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', enc],
    ];
  }
  if (plataforma === 'linux') {
    return ['systemd-inhibit', ['--what=idle:sleep', '--who=RobinSearch', '--why=Indexando documentos', '--mode=block', 'sleep', '86400']];
  }
  return null;
}
export const _comandoDesvelo = comandoDesvelo;

export function desvelado() {
  return Boolean(_desvelo && _desvelo.exitCode === null && !_desvelo.killed);
}

function desvelar() {
  _soltarEn = 0;
  if (desvelado() || process.env.ROBIN_NO_DESVELAR === '1') return;
  const cmd = comandoDesvelo();
  if (!cmd) return;
  try {
    const hijo = spawn(cmd[0], cmd[1], { stdio: 'ignore', windowsHide: true, detached: false });
    hijo.on('error', (err) => {
      log.warn('No se pudo evitar la suspensión del equipo mientras indexa', { code: String(err?.code || ''), err: String(err?.message || err).slice(0, 120) });
      if (_desvelo === hijo) _desvelo = null;
    });
    hijo.on('exit', () => {
      if (_desvelo === hijo) _desvelo = null;
    });
    hijo.unref?.();
    _desvelo = hijo;
    log.info('Indexando: el equipo no se suspenderá por inactividad hasta terminar');
  } catch (err) {
    log.warn('No se pudo evitar la suspensión del equipo mientras indexa', { err: String(err?.message || err).slice(0, 120) });
  }
}

function soltarDesvelo() {
  _soltarEn = 0;
  const h = _desvelo;
  _desvelo = null;
  if (!h) return;
  try {
    h.kill();
  } catch {
    /* ya no estaba */
  }
  log.info('Indexado terminado: el equipo vuelve a poder suspenderse');
}

// ── Latido ───────────────────────────────────────────────────────────────────────────────────
let _tick = null;
let _ultimaVuelta = 0;
let _ultimoEnvio = 0;
let _enVuelo = false;
let _suspendidoMs = 0;
let _pasadaAntes = false;
let _modo = 'claude';
let _primero = true;

function documentosEnIndice() {
  try {
    return registry.contarEnMemoria();
  } catch {
    return null;
  }
}

export function construirLatido(evento, extra = {}) {
  return {
    esquema: 1,
    evento,
    instalacion: instalacionId(),
    version: VERSION,
    modo: _modo,
    plataforma: process.platform,
    lanzador: lanzador() || 'desconocido',
    ...cifras(state, { documentos: documentosEnIndice() }),
    desvelado: desvelado(),
    suspendido_min: _suspendidoMs ? Math.round(_suspendidoMs / MIN) : 0,
    ram_libre_mb: Math.round(os.freemem() / 1048576),
    ram_total_mb: Math.round(os.totalmem() / 1048576),
    vivo_min: Math.round(process.uptime() / 60),
    ...extra,
  };
}

async function enviar(evento) {
  const url = urlProgreso();
  if (!url || _enVuelo) return false;
  _enVuelo = true;
  _ultimoEnvio = Date.now();
  try {
    const cuerpo = JSON.stringify(construirLatido(evento));
    const bearer = await Promise.race([getBearerQuiet(), new Promise((r) => setTimeout(() => r(null), 3000).unref?.())]).catch(() => null);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RobinSearch-Version': VERSION, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: cuerpo,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      _suspendidoMs = 0;
      return true;
    }
    log.debug?.('Robin no aceptó el latido de progreso', { code: String(res.status) });
  } catch (err) {
    log.debug?.('No se pudo enviar el latido de progreso', { err: String(err?.message || err).slice(0, 120) });
  } finally {
    _enVuelo = false;
  }
  return false;
}

// Una vuelta: decide si desvelar/soltar y si toca latir. Exportada para las pruebas.
export async function vuelta(ahora = Date.now()) {
  if (_ultimaVuelta && ahora - _ultimaVuelta > TICK_MS + SALTO_SUSPENSION_MS) {
    _suspendidoMs += ahora - _ultimaVuelta - TICK_MS;
  }
  const despierta = _ultimaVuelta && ahora - _ultimaVuelta > TICK_MS + SALTO_SUSPENSION_MS;
  _ultimaVuelta = ahora;

  if (!escritor.soyEscritor()) {
    if (_desvelo) soltarDesvelo();
    _pasadaAntes = false;
    return null;
  }
  const enCurso = pasadaEnCurso();
  const quedan = enCurso || (state.ultimoIndexado?.pendientes ?? 0) > 0;

  if (enCurso) desvelar();
  else if (_desvelo) {
    if (!_soltarEn) _soltarEn = ahora + SOLTAR_TRAS_MS;
    else if (ahora >= _soltarEn) soltarDesvelo();
  }

  let evento = null;
  if (_primero) evento = 'inicio';
  else if (enCurso && !_pasadaAntes) evento = 'empieza';
  else if (!enCurso && _pasadaAntes) evento = 'termina';
  else if (despierta) evento = 'despierta';
  else if (ahora - _ultimoEnvio >= (quedan ? CADA_INDEXANDO_MS : CADA_AL_DIA_MS)) evento = 'latido';
  _pasadaAntes = enCurso;
  if (!evento) return null;
  _primero = false;
  await enviar(evento);
  return evento;
}

// Un latido YA (la pasada silenciosa, al terminar, antes de salir). Con tope: nunca retrasa la salida
// más de unos segundos.
export async function latirAhora(evento, topeMs = 5000) {
  if (apagado() || !escritor.soyEscritor()) return false;
  _pasadaAntes = pasadaEnCurso();
  _primero = false;
  return Promise.race([enviar(evento), new Promise((r) => setTimeout(() => r(false), topeMs).unref?.())]);
}

export function iniciarSeguimiento({ modo = 'claude', primeraMs = env('ROBIN_SEGUIMIENTO_PRIMERA_MS', 30_000) } = {}) {
  if (_tick || apagado()) return;
  _modo = modo === 'pasada' ? 'pasada' : 'claude';
  const correr = () => {
    vuelta().catch(() => {});
  };
  const t1 = setTimeout(() => {
    _ultimaVuelta = Date.now();
    correr();
    _tick = setInterval(correr, TICK_MS);
    _tick.unref?.();
  }, primeraMs);
  t1.unref?.();
  _tick = t1;
}

export function pararSeguimiento() {
  if (_tick) {
    clearTimeout(_tick);
    clearInterval(_tick);
  }
  _tick = null;
  soltarDesvelo();
}

// Solo pruebas.
export function _reiniciar() {
  pararSeguimiento();
  _ultimaVuelta = 0;
  _ultimoEnvio = 0;
  _enVuelo = false;
  _suspendidoMs = 0;
  _pasadaAntes = false;
  _primero = true;
}

export default { iniciarSeguimiento, latirAhora, pararSeguimiento, vuelta, cifras, construirLatido, urlProgreso, desvelado };
