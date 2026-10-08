// Dónde vive la LLAVE DE RENOVACIÓN de la sesión de RobinSearch (Juan, 8-oct-2026: «en el llavero
// del sistema operativo, el mismo mecanismo que ya usas para las contraseñas del correo, no en un
// fichero de texto»).
//
// - macOS: Acceso a Llaveros (`security`), servicio «RobinSearch sesión», cuenta = client_id.
// - Windows: DPAPI de usuario, fichero `sesion-<huella>.cred` en el dir de datos (solo lo descifra
//   esta sesión de Windows en este equipo).
// - Linux: Secret Service (`secret-tool`).
//
// A diferencia del correo, si el llavero falla (PowerShell bloqueado por el despacho, Linux sin
// Secret Service) la llave NO se pierde: se queda en auth.json (0600) como hasta la 1.11 y el
// estado lo dice. Quedarse sin sesión por un llavero roto sería peor que el riesgo que se evita: la
// llave rota en cada uso y el servidor revoca la cadena si alguien reutiliza una copiada.
//
// La llave de ACCESO (24 h) sigue en auth.json: RobinDesktop la lee para el cuadro de mando.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { log } from '../logger.js';
import { piezas } from '../correo/llavero.js';

const SERVICIO = 'RobinSearch sesión';
const SERVICIO_LINUX = 'robinsearch-sesion';

const huella = (cuenta) => crypto.createHash('sha256').update(String(cuenta)).digest('hex').slice(0, 20);
const rutaWin = (cuenta) => path.join(config.dataDir, `sesion-${huella(cuenta)}.cred`);

export function motorSesion() {
  const forzado = process.env.ROBIN_SESION_LLAVERO;
  if (forzado === 'fichero') return 'fichero';
  if (forzado === 'simulado') return 'simulado';
  if (process.platform === 'darwin') return 'llavero_macos';
  if (process.platform === 'win32') return 'dpapi_windows';
  return 'secret_service';
}

// Llavero de mentira para las pruebas (no toca el del abogado): un fichero aparte que hace de llavero.
const rutaSimulada = () => path.join(config.dataDir, 'llavero-simulado.json');
const simulado = {
  leerTodo() { try { return JSON.parse(fs.readFileSync(rutaSimulada(), 'utf8')); } catch { return {}; } },
  async guardar(c, v) { const t = this.leerTodo(); t[c] = v; fs.mkdirSync(config.dataDir, { recursive: true }); fs.writeFileSync(rutaSimulada(), JSON.stringify(t)); return true; },
  async leer(c) { return this.leerTodo()[c] ?? null; },
  async borrar(c) { const t = this.leerTodo(); delete t[c]; fs.writeFileSync(rutaSimulada(), JSON.stringify(t)); return true; },
};

const mac = {
  async guardar(cuenta, valor) {
    const r = await piezas.ejecutar('security', ['add-generic-password', '-a', cuenta, '-s', SERVICIO, '-U', '-w'], `${valor}\n${valor}\n`);
    return r.ok;
  },
  async leer(cuenta) {
    const r = await piezas.ejecutar('security', ['find-generic-password', '-a', cuenta, '-s', SERVICIO, '-w']);
    // La llave es base64url ASCII: con `-w` sale tal cual (no hay acentos que la pasen a hexadecimal).
    const v = r.ok ? r.out.trim() : '';
    return v || null;
  },
  async borrar(cuenta) {
    const r = await piezas.ejecutar('security', ['delete-generic-password', '-a', cuenta, '-s', SERVICIO]);
    return r.ok;
  },
};

const win = {
  async guardar(cuenta, valor) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const [cmd, args] = piezas.powershell(piezas.psProteger(rutaWin(cuenta)));
    const r = await piezas.ejecutar(cmd, args, valor);
    return r.ok;
  },
  async leer(cuenta) {
    if (!fs.existsSync(rutaWin(cuenta))) return null;
    const [cmd, args] = piezas.powershell(piezas.psDesproteger(rutaWin(cuenta)));
    const r = await piezas.ejecutar(cmd, args);
    return r.ok && r.out ? r.out.trim() : null;
  },
  async borrar(cuenta) {
    try { fs.rmSync(rutaWin(cuenta), { force: true }); } catch { /* ya no está */ }
    return true;
  },
};

const linux = {
  async guardar(cuenta, valor) {
    if (!(await piezas.linuxTieneLlavero())) return false;
    const r = await piezas.ejecutar('secret-tool', ['store', '--label', `${SERVICIO} (${cuenta})`, 'service', SERVICIO_LINUX, 'account', cuenta], valor);
    return r.ok;
  },
  async leer(cuenta) {
    if (!(await piezas.linuxTieneLlavero())) return null;
    const r = await piezas.ejecutar('secret-tool', ['lookup', 'service', SERVICIO_LINUX, 'account', cuenta]);
    return r.ok && r.out ? r.out.trim() : null;
  },
  async borrar(cuenta) {
    const r = await piezas.ejecutar('secret-tool', ['clear', 'service', SERVICIO_LINUX, 'account', cuenta]);
    return r.ok;
  },
};

function motor() {
  switch (motorSesion()) {
    case 'simulado': return simulado;
    case 'llavero_macos': return mac;
    case 'dpapi_windows': return win;
    case 'secret_service': return linux;
    default: return null;
  }
}

// true si quedó en el llavero (y se puede quitar de auth.json); false = que siga en el fichero.
export async function guardarLlave(cuenta, valor) {
  const m = motor();
  if (!m || !cuenta || !valor) return false;
  try {
    const ok = await m.guardar(cuenta, valor);
    if (!ok) return false;
    // Se comprueba leyendo: un llavero que «guarda» y no devuelve no sirve.
    return (await m.leer(cuenta)) === valor;
  } catch (e) {
    log.warn('No se pudo guardar la llave de sesión en el llavero', { err: String(e?.message ?? e) });
    return false;
  }
}

export async function leerLlave(cuenta) {
  const m = motor();
  if (!m || !cuenta) return null;
  try {
    return await m.leer(cuenta);
  } catch {
    return null;
  }
}

export async function borrarLlave(cuenta) {
  const m = motor();
  if (!m || !cuenta) return false;
  try {
    return await m.borrar(cuenta);
  } catch {
    return false;
  }
}

export default { guardarLlave, leerLlave, borrarLlave, motorSesion };
