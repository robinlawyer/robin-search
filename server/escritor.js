// UNA sola instancia de RobinSearch escribe en el índice.
//
// Claude Desktop arranca el servidor dos veces seguidas (una sonda que luego mata y el
// servidor de verdad), y un abogado puede tener abierto Claude Desktop y Claude Code a la
// vez. Dos procesos indexando el mismo directorio de datos se pisan. El que tiene el
// cerrojo indexa y vigila la carpeta; el otro solo lee (busca) y toma el relevo si el primero
// muere.
//
// El cerrojo es un fichero con el pid del dueño, creado en exclusiva ('wx'). Está caducado si
// ese pid ya no existe o si el dueño lleva más de CADUCIDAD_MS sin renovarlo (un pid reciclado
// por otro programa no puede dejarlo bloqueado para siempre).

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const CADUCIDAD_MS = 2 * 60 * 1000;
const RENUEVO_MS = 30 * 1000;

let _soy = false;
let _renuevo = null;

const ruta = () => path.join(config.dataDir, 'escritor.lock');

export function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM'; // existe, pero es de otro usuario
  }
}

function leer() {
  try {
    const st = fs.statSync(ruta());
    const d = JSON.parse(fs.readFileSync(ruta(), 'utf8'));
    return { pid: d?.pid, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

function caducado(d) {
  if (!d) return true;
  if (d.pid === process.pid) return false;
  if (!pidVivo(d.pid)) return true;
  return Date.now() - d.mtimeMs > CADUCIDAD_MS;
}

export function adquirir() {
  if (_soy) return true;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
  } catch {
    return false;
  }
  for (let intento = 0; intento < 3; intento++) {
    try {
      fs.writeFileSync(ruta(), JSON.stringify({ pid: process.pid, desde: new Date().toISOString() }), { flag: 'wx' });
      _soy = true;
      _renuevo = setInterval(() => {
        try {
          const ahora = new Date();
          fs.utimesSync(ruta(), ahora, ahora);
        } catch {
          /* si no se puede renovar, el cerrojo caducará solo */
        }
      }, RENUEVO_MS);
      _renuevo.unref?.();
      return true;
    } catch (err) {
      if (err?.code !== 'EEXIST') return false;
      const d = leer();
      if (d?.pid === process.pid) {
        _soy = true;
        return true;
      }
      if (!caducado(d)) return false;
      // Se aparta el cerrojo caducado con un RENOMBRADO: si dos procesos lo intentan a la
      // vez, solo a uno le sale (al otro le da ENOENT y vuelve a mirar), y ninguno puede
      // borrar el cerrojo recién creado por el otro.
      try {
        fs.renameSync(ruta(), `${ruta()}.${process.pid}.caducado`);
        fs.rmSync(`${ruta()}.${process.pid}.caducado`, { force: true });
      } catch {
        /* otro se adelantó: siguiente vuelta */
      }
    }
  }
  return false;
}

export function soyEscritor() {
  return _soy;
}

// pid de la instancia que escribe ahora, si es otra y está viva.
export function otraInstancia() {
  const d = leer();
  if (!d || d.pid === process.pid || caducado(d)) return null;
  return d.pid;
}

export function soltar() {
  if (_renuevo) clearInterval(_renuevo);
  _renuevo = null;
  if (!_soy) return;
  _soy = false;
  try {
    const d = leer();
    if (d?.pid === process.pid) fs.rmSync(ruta(), { force: true });
  } catch {
    /* nada que soltar */
  }
}

export default { adquirir, soyEscritor, soltar, otraInstancia, pidVivo };
