// Escritura y lectura de los ficheros de estado (registro, anotaciones, apartados, sesión,
// ajustes). Una sola implementación para que ninguno pueda dejar RobinSearch roto:
//
// - Escritura atómica de verdad: temporal propio del proceso (dos instancias no se pisan el
//   .tmp), fsync ANTES de renombrar (un apagón en NTFS deja a cero bytes lo que no se volcó) y
//   renombrado con reintentos (en Windows el antivirus o la otra instancia tienen el fichero
//   abierto unos milisegundos: EPERM/EBUSY/EACCES).
// - Copia .bak de la versión anterior: si la actual aparece cortada o vacía se recupera de ahí.
// - Lectura que DISTINGUE «no existe» de «no se puede leer»: tratar un EBUSY o un JSON cortado
//   como «vacío» y escribir encima es lo que borraba el trabajo del usuario.

import fs from 'node:fs';
import crypto from 'node:crypto';

export const OCUPADO = new Set(['EPERM', 'EBUSY', 'EACCES']);
const _dormir = new Int32Array(new SharedArrayBuffer(4));

export function conReintentos(fn, intentos = 20) {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (err) {
      if (!OCUPADO.has(err?.code) || i >= intentos) throw err;
      Atomics.wait(_dormir, 0, 0, 25 + i * 10);
    }
  }
}

export function escribirAtomico(ruta, datos, { bak = false, mode } = {}) {
  const tmp = `${ruta}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'w', mode);
    fs.writeFileSync(fd, datos);
    fs.fsyncSync(fd);
  } catch (err) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* nada */ }
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  fs.closeSync(fd);
  try {
    if (bak) {
      try {
        conReintentos(() => fs.copyFileSync(ruta, `${ruta}.bak`));
      } catch {
        /* primera escritura, o sin copia esta vez: la escritura sigue */
      }
    }
    conReintentos(() => fs.renameSync(tmp, ruta));
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export function escribirJson(ruta, valor, opciones = {}) {
  escribirAtomico(ruta, JSON.stringify(valor, null, opciones.indent ?? 0), opciones);
}

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function leerUno(ruta, validar) {
  const raw = conReintentos(() => fs.readFileSync(ruta, 'utf8'));
  const valor = JSON.parse(raw);
  if (!validar(valor)) throw Object.assign(new Error('forma inesperada'), { code: 'EFORMA' });
  return valor;
}

// Devuelve { estado, valor }:
//   'ok'         → valor leído (de la actual o, si estaba dañada, del .bak: `recuperado`)
//   'no_existe'  → no hay fichero (primer uso): valor = null
//   'corrupto'   → ni la actual ni el .bak se pueden leer; la dañada se aparta a
//                  `<ruta>.corrupto-<fecha>` para no perderla ni volver a tropezar
// Un error de E/S que no sea «no existe» ni contenido dañado (disco, permisos) se LANZA: quien
// llama no puede confundirlo con un fichero vacío.
export function leerJson(ruta, { validar = esObjeto, bak = true } = {}) {
  try {
    return { estado: 'ok', valor: leerUno(ruta, validar) };
  } catch (err) {
    if (err?.code === 'ENOENT') {
      if (!bak) return { estado: 'no_existe', valor: null };
      try {
        return { estado: 'ok', valor: leerUno(`${ruta}.bak`, validar), recuperado: true };
      } catch {
        return { estado: 'no_existe', valor: null };
      }
    }
    if (!(err instanceof SyntaxError) && err?.code !== 'EFORMA') throw err;
  }
  let recuperado = null;
  if (bak) {
    try {
      recuperado = leerUno(`${ruta}.bak`, validar);
    } catch {
      recuperado = null;
    }
  }
  try {
    conReintentos(() => fs.renameSync(ruta, `${ruta}.corrupto-${new Date().toISOString().replace(/[:.]/g, '-')}`));
  } catch {
    /* si no se puede apartar, al menos no se usa */
  }
  if (recuperado) return { estado: 'ok', valor: recuperado, recuperado: true };
  return { estado: 'corrupto', valor: null };
}

// Leer-modificar-escribir entre PROCESOS: Claude arranca dos instancias y las dos pueden guardar
// a la vez. Sin cerrojo, la segunda escritura pisaba la primera y se perdían cambios dados por
// buenos. Cerrojo de fichero (`wx` falla si ya existe); uno de más de 30 s es de un proceso que
// murió dentro y se retira.
export function conCerrojoDeFichero(ruta, fn, { esperaMaxMs = 10000 } = {}) {
  const cerrojo = `${ruta}.lock`;
  const inicio = Date.now();
  for (let i = 0; ; i++) {
    try {
      fs.closeSync(fs.openSync(cerrojo, 'wx'));
      break;
    } catch (err) {
      if (err?.code !== 'EEXIST' && !OCUPADO.has(err?.code)) throw err;
      try {
        if (Date.now() - fs.statSync(cerrojo).mtimeMs > 30000) fs.rmSync(cerrojo, { force: true });
      } catch {
        /* lo acaban de soltar */
      }
      if (Date.now() - inicio > esperaMaxMs) throw Object.assign(new Error('fichero ocupado por otra instancia'), { code: 'EBUSY' });
      Atomics.wait(_dormir, 0, 0, Math.min(20 + i * 10, 200));
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.rmSync(cerrojo, { force: true });
    } catch {
      /* caduca solo */
    }
  }
}

export default { OCUPADO, conReintentos, escribirAtomico, escribirJson, leerJson, conCerrojoDeFichero };
