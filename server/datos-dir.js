// Dónde viven los datos de RobinSearch (índice, registro, sesión) en cada sistema.
//
// Módulo aparte y sin dependencias porque lo necesitan dos sitios que no pueden cargar lo mismo:
// config.js (el servidor) y supervisor.js (el proceso que habla con Claude, que no carga nada del
// servidor para que nada del servidor pueda tumbarlo).

import os from 'node:os';
import path from 'node:path';

const primero = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');

export function defaultDataDir() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'RobinLawyer', 'robin-search');
    case 'win32':
      return path.join(primero(process.env.APPDATA, path.join(home, 'AppData', 'Roaming')), 'RobinLawyer', 'robin-search');
    default:
      return path.join(primero(process.env.XDG_DATA_HOME, path.join(home, '.local', 'share')), 'robin-lawyer', 'robin-search');
  }
}

// El de ESTA ejecución: el de --data-dir / ROBIN_DATA_DIR si lo hay.
export function dataDirEfectivo() {
  return primero(process.env.ROBIN_DATA_DIR) || defaultDataDir();
}

export default { defaultDataDir, dataDirEfectivo };
