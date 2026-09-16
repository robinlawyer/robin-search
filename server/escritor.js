// UNA sola instancia de RobinSearch escribe en el índice.
//
// Claude Desktop arranca el servidor dos veces seguidas (una sonda que luego mata y el
// servidor de verdad), y un abogado puede tener abierto Claude Desktop y Claude Code a la
// vez. Dos procesos indexando el mismo directorio de datos se pisan. El que tiene el
// cerrojo indexa y vigila la carpeta; el otro solo lee (busca) y toma el relevo si el primero
// muere.
//
// El cerrojo es un fichero con el pid del dueño y un TOKEN aleatorio, creado en exclusiva
// ('wx'). Está caducado si ese pid ya no existe o si el dueño lleva más de CADUCIDAD_MS sin
// renovarlo (un pid reciclado por otro programa no puede dejarlo bloqueado para siempre).
//
// Por qué el token (1.4.8): un dueño VIVO puede pasar más de dos minutos sin renovar (el equipo
// en suspensión, el proceso parado por un lector síncrono) y otra instancia le quita el cerrojo
// con razón. Hasta ahora el primero no se enteraba y seguía escribiendo: dos escritores. Ahora
// cada renovación, y cada escritura (confirmar()), comprueba que el token del fichero sigue
// siendo el suyo; si no, pasa a lector de forma ordenada (alPerder).
//
// Y por qué no fiarse solo de la fecha del fichero: con el reloj hacia atrás la fecha de la
// última renovación queda «en el futuro», la edad sale negativa y el cerrojo no caducaba nunca
// (tampoco con un pid reciclado). Quien observa un cerrojo ajeno cuenta además, con SU reloj
// monotónico, cuánto tiempo lleva sin cambiar.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const CADUCIDAD_MS = Number(process.env.ROBIN_ESCRITOR_CADUCIDAD_MS) || 2 * 60 * 1000;
const RENUEVO_MS = Number(process.env.ROBIN_ESCRITOR_RENUEVO_MS) || 30 * 1000;

let _soy = false;
let _token = null;
let _renuevo = null;
const _alPerder = new Set();

const ruta = () => path.join(config.dataDir, 'escritor.lock');
const ahoraMono = () => Number(process.hrtime.bigint() / 1000000n);

export function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM'; // existe, pero es de otro usuario
  }
}

// null = no hay cerrojo. `ilegible` = existe pero ahora no se puede leer (el antivirus lo tiene
// abierto, o el otro proceso lo acaba de crear y aún no ha escrito su contenido): eso NO es
// «no hay cerrojo».
function leer() {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(ruta()).mtimeMs;
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    return { pid: null, token: null, mtimeMs: 0, ilegible: true };
  }
  try {
    const d = JSON.parse(fs.readFileSync(ruta(), 'utf8'));
    return { pid: d?.pid, token: d?.token ?? null, mtimeMs };
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    return { pid: null, token: null, mtimeMs, ilegible: true };
  }
}

// Última versión vista de un cerrojo ajeno y desde cuándo (reloj monotónico de ESTE proceso).
let _visto = null;

function caducado(d) {
  if (!d) return true;
  if (!d.ilegible && d.pid === process.pid && d.token === _token && _token) return false;
  const firma = `${d.pid}|${d.token}|${d.mtimeMs}`;
  const mono = ahoraMono();
  if (!_visto || _visto.firma !== firma) _visto = { firma, desde: mono };
  // Sin cambiar durante CADUCIDAD_MS medidos con nuestro reloj monotónico: caducado, diga lo que
  // diga la fecha del fichero.
  if (mono - _visto.desde > CADUCIDAD_MS) return true;
  if (d.ilegible) return false;
  if (!pidVivo(d.pid)) return true;
  const edad = Date.now() - d.mtimeMs;
  // Una fecha del futuro no dice nada de su edad: decide la observación monotónica de arriba.
  if (edad < 0) return false;
  return edad > CADUCIDAD_MS;
}

function perder(motivo) {
  if (!_soy) return;
  _soy = false;
  _token = null;
  if (_renuevo) clearInterval(_renuevo);
  _renuevo = null;
  for (const fn of _alPerder) {
    try {
      fn(motivo);
    } catch {
      /* un observador roto no impide pasar a lector */
    }
  }
}

// ¿Sigue siendo nuestro el cerrojo? Se mira el FICHERO, no la memoria: es lo que cuenta si otra
// instancia lo tomó mientras este proceso estaba parado. Se llama antes de cada escritura.
export function confirmar() {
  if (!_soy) return false;
  const d = leer();
  if (d?.ilegible) return true; // no se sabe: se vuelve a mirar en la siguiente
  if (d && d.pid === process.pid && d.token === _token) return true;
  if (!d) {
    // Nadie lo tiene (lo borró una limpieza, o el antivirus): se recupera si nadie se adelanta.
    try {
      fs.writeFileSync(ruta(), JSON.stringify({ pid: process.pid, token: _token, desde: new Date().toISOString() }), { flag: 'wx' });
      return true;
    } catch {
      /* se adelantó otro */
    }
    const otra = leer();
    if (otra?.ilegible || (otra && otra.pid === process.pid && otra.token === _token)) return true;
  }
  perder('otra_instancia');
  return false;
}

function renovar() {
  if (!confirmar()) return;
  try {
    const ahora = new Date();
    fs.utimesSync(ruta(), ahora, ahora);
  } catch {
    /* si no se puede renovar, el cerrojo caducará solo */
  }
}

export function adquirir() {
  if (_soy) return confirmar();
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
  } catch {
    return false;
  }
  for (let intento = 0; intento < 3; intento++) {
    const token = crypto.randomBytes(12).toString('hex');
    try {
      fs.writeFileSync(ruta(), JSON.stringify({ pid: process.pid, token, desde: new Date().toISOString() }), { flag: 'wx' });
      _soy = true;
      _token = token;
      _visto = null;
      _renuevo = setInterval(renovar, RENUEVO_MS);
      _renuevo.unref?.();
      return true;
    } catch (err) {
      if (err?.code !== 'EEXIST') return false;
      if (!caducado(leer())) return false;
      // Se aparta el cerrojo caducado con un RENOMBRADO: si dos procesos lo intentan a la
      // vez, solo a uno le sale (al otro le da ENOENT y vuelve a mirar), y ninguno puede
      // borrar el cerrojo recién creado por el otro.
      try {
        fs.renameSync(ruta(), `${ruta()}.${process.pid}.caducado`);
        fs.rmSync(`${ruta()}.${process.pid}.caducado`, { force: true });
      } catch {
        /* otro se adelantó: siguiente vuelta */
      }
      _visto = null;
    }
  }
  return false;
}

export function soyEscritor() {
  return _soy;
}

// `fn(motivo)` se llama cuando otra instancia se ha quedado con el cerrojo (una vez por pérdida).
export function alPerder(fn) {
  _alPerder.add(fn);
  return () => _alPerder.delete(fn);
}

// pid de la instancia que escribe ahora, si es otra y está viva.
export function otraInstancia() {
  const d = leer();
  if (!d || d.ilegible || (d.pid === process.pid && d.token === _token) || caducado(d)) return null;
  return d.pid;
}

export function soltar() {
  if (_renuevo) clearInterval(_renuevo);
  _renuevo = null;
  if (!_soy) return;
  _soy = false;
  try {
    const d = leer();
    if (d?.pid === process.pid && d.token === _token) fs.rmSync(ruta(), { force: true });
  } catch {
    /* nada que soltar */
  }
  _token = null;
}

export default { adquirir, soyEscritor, soltar, otraInstancia, pidVivo, confirmar, alPerder };
