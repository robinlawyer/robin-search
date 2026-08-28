// Detección de carpetas de RED (unidad mapeada o recurso compartido).
//
// Por qué existe: un expediente que vive en el servidor del despacho (Z:\ en Windows, un
// montaje SMB en Mac) NO se comporta como una carpeta local. El sistema operativo no avisa
// de forma fiable cuando un compañero añade un escrito al expediente desde su equipo: las
// notificaciones de cambio sobre SMB llegan tarde, incompletas o no llegan. Si RobinSearch
// se fía de ellas, el abogado cree que tiene el expediente entero indexado y no lo tiene —
// que es el peor fallo posible en una búsqueda documental.
//
// Con esta detección, las carpetas de red pasan a un modo distinto: re-escaneo periódico
// incremental + refresco al abrir el expediente (ver watcher.js y establecer_expediente_activo).
//
// No importa `config.js` a propósito: config no debe depender de nada que toque el sistema.

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { log } from './logger.js';

let _letrasRed = null;   // win32: Set de letras mapeadas a red, p. ej. {'Z'}
let _montajesRed = null; // darwin/linux: rutas de montajes de red, p. ej. ['/Volumes/Expedientes']

// Escotilla: fuerza a tratar como red las rutas que empiecen por estos prefijos
// (ROBIN_NETWORK_PATHS, separados por ';'). Sirve si la detección automática falla en algún
// Windows concreto — mejor un ajuste que un abogado con el expediente desactualizado — y es
// lo que usan las pruebas para simular una unidad de red sin montar ninguna.
function prefijosForzados() {
  const raw = process.env.ROBIN_NETWORK_PATHS;
  if (!raw) return [];
  return raw.split(';').map((x) => x.trim()).filter(Boolean).map((x) => path.resolve(x));
}

// Extrae de la salida de `net use` las letras mapeadas a un recurso de red. Puro y exportado
// para poder comprobarlo desde macOS/Linux, donde no se puede ejecutar `net use`.
export function parsearNetUse(salida) {
  const out = new Set();
  for (const linea of String(salida ?? '').split(/\r?\n/)) {
    const m = linea.match(/(?:^|\s)([A-Za-z]):\s+\\\\/);
    if (m) out.add(m[1].toUpperCase());
  }
  return out;
}

// Ídem para la salida de `mount` en macOS/Linux.
export function parsearMount(salida) {
  const out = [];
  for (const linea of String(salida ?? '').split(/\r?\n/)) {
    const m = linea.match(/\son\s(.+?)\s\((smbfs|nfs|afpfs|cifs|webdav|fuse\.\w+)[,)]/);
    if (m) out.push(m[1]);
  }
  return out;
}

// Letras de unidad que ESTA sesión de Windows tiene mapeadas a un recurso de red.
// Se consulta una sola vez con `net use` (barato, ~50 ms) y se cachea.
function letrasDeRed() {
  if (_letrasRed) return _letrasRed;
  _letrasRed = new Set();
  if (process.platform !== 'win32') return _letrasRed;
  try {
    const salida = execFileSync('net', ['use'], {
      encoding: 'latin1', // la consola de Windows en español no es UTF-8; solo buscamos "X:  \\"
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // Líneas del tipo:  "Correcto      Z:        \\servidor\Expedientes    Microsoft Windows Network"
    _letrasRed = parsearNetUse(salida);
    if (_letrasRed.size) log.info('Unidades de red detectadas', { letras: [..._letrasRed] });
  } catch (err) {
    // Sin `net use` no podemos saberlo: se asume local (las rutas UNC se siguen detectando).
    log.warn('No se pudo consultar las unidades de red mapeadas', { err: String(err) });
  }
  return _letrasRed;
}

// Puntos de montaje de red en Mac/Linux (SMB del despacho, NAS, AFP, NFS, WebDAV).
function montajesDeRed() {
  if (_montajesRed) return _montajesRed;
  _montajesRed = [];
  if (process.platform === 'win32') return _montajesRed;
  try {
    const salida = execFileSync('mount', [], { encoding: 'utf8', timeout: 5000 });
    // "//usuario@servidor/Expedientes on /Volumes/Expedientes (smbfs, nodev, ...)"
    _montajesRed = parsearMount(salida);
    if (_montajesRed.length) log.info('Montajes de red detectados', { montajes: _montajesRed });
  } catch (err) {
    log.warn('No se pudo consultar los montajes de red', { err: String(err) });
  }
  return _montajesRed;
}

// ¿Esta ruta vive en un servidor, y no en el disco del abogado?
export function esRutaDeRed(p) {
  if (!p) return false;
  const abs = path.resolve(p);
  for (const pref of prefijosForzados()) {
    if (abs === pref || abs.startsWith(pref + path.sep)) return true;
  }
  if (process.platform === 'win32') {
    if (abs.startsWith('\\\\')) return true; // ruta UNC: \\servidor\recurso\...
    const m = abs.match(/^([A-Za-z]):/);
    return m ? letrasDeRed().has(m[1].toUpperCase()) : false;
  }
  const montajes = montajesDeRed();
  return montajes.some((mp) => abs === mp || abs.startsWith(mp + path.sep));
}

// Descripción legible para `estado_servidor` (el abogado tiene que poder ver de un vistazo
// que su expediente está en red y que por eso se refresca por re-escaneo).
export function tipoDeUbicacion(p) {
  return esRutaDeRed(p) ? 'red' : 'local';
}

export default { esRutaDeRed, tipoDeUbicacion, parsearNetUse, parsearMount };
