// Llavero del sistema operativo — donde vive la contraseña del correo del abogado.
//
// REGLA DE PRODUCTO: la contraseña del buzón NO sale nunca de este ordenador. No viaja a
// RobinLawyer, no la recibe ninguna herramienta MCP (acabaría en el contexto del modelo) y no
// se escribe en ajustes.json. Aquí solo se habla con el guardián de credenciales del propio SO.
//
// SIN MÓDULOS NATIVOS. `keytar` habría sido lo cómodo, pero es un binario por plataforma y
// arquitectura: el .mcpb tiene que instalarse igual en macOS, Windows y Linux desde un solo
// paquete, y un módulo nativo lo rompe. Se usan los binarios que YA trae cada sistema.
//
// SIEMPRE POR STDIN, NUNCA EN ARGV. Todo lo que se pasa como argumento aparece en `ps` para
// cualquier proceso del equipo (y en el historial de la shell). La contraseña se escribe en la
// entrada estándar del proceso hijo y no se registra en ningún sitio.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { log } from '../logger.js';

// Etiqueta con la que el abogado ve la entrada en Acceso a Llaveros / el Administrador de
// credenciales. Cambiarla deja huérfana la contraseña ya guardada: es parte del formato.
export const SERVICIO = 'RobinSearch correo';
const TIEMPO_MAX_MS = 15000;

// Ejecuta un binario del sistema pasándole `entrada` por stdin. Nunca lanza: devuelve el
// resultado para que quien llama decida. `entrada` puede ser la contraseña, así que ni el
// comando ni la salida se registran con detalle.
function ejecutar(cmd, args, entrada = null) {
  return new Promise((resolve) => {
    let hijo;
    try {
      hijo = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, code: null, out: '', err: String(err?.message ?? err), noExiste: true });
    }
    let out = '';
    let errOut = '';
    let hecho = false;
    const fin = (r) => { if (!hecho) { hecho = true; clearTimeout(tope); resolve(r); } };
    const tope = setTimeout(() => { try { hijo.kill('SIGKILL'); } catch { /* ya murió */ } fin({ ok: false, code: null, out, err: 'tiempo agotado', agotado: true }); }, TIEMPO_MAX_MS);
    hijo.stdout.setEncoding('utf8');
    hijo.stderr.setEncoding('utf8');
    hijo.stdout.on('data', (d) => { out += d; });
    hijo.stderr.on('data', (d) => { errOut += d; });
    // ENOENT (no está el binario) es un caso normal, no un fallo: en Linux puede no haber
    // secret-tool. Sin este oyente, además, tumbaría el proceso entero.
    hijo.on('error', (err) => fin({ ok: false, code: null, out: '', err: String(err?.message ?? err), noExiste: err?.code === 'ENOENT' }));
    hijo.on('close', (code) => fin({ ok: code === 0, code, out, err: errOut }));
    try {
      if (entrada !== null) hijo.stdin.end(entrada);
      else hijo.stdin.end();
    } catch { /* el hijo ya cerró su entrada */ }
  });
}

// ── macOS: Acceso a Llaveros ──────────────────────────────────────────────────────────────
//
// `security add-generic-password -w` SIN valor detrás pide la contraseña y la relee para
// confirmar: hay que mandarla DOS veces por stdin o responde «passwords don't match» y guarda
// una entrada vacía (comprobado en macOS 15, 20-sep-2026).
const mac = {
  async guardar(cuenta, clave) {
    const r = await ejecutar('security', ['add-generic-password', '-a', cuenta, '-s', SERVICIO, '-U', '-w'], `${clave}\n${clave}\n`);
    return r.ok;
  },
  async leer(cuenta) {
    // `-g` y no `-w`: con `-w`, una contraseña con acentos («ñ», «á») sale en HEXADECIMAL sin
    // avisar y una contraseña que por casualidad solo tenga letras a-f sale tal cual — no hay
    // forma de distinguirlas. Con `-g` la línea trae el prefijo «0x» cuando es hexadecimal.
    const r = await ejecutar('security', ['find-generic-password', '-a', cuenta, '-s', SERVICIO, '-g']);
    if (!r.ok) return null;
    // La contraseña sale por STDERR y en la PRIMERA línea; por stdout vienen detrás todos los
    // atributos del llavero, llenos de comillas. Se mira solo stderr y solo esa línea: con una
    // expresión que cruzara líneas, lo «leído» era medio volcado del llavero y el servidor
    // rechazaba la contraseña sin que se entendiera por qué (20-sep-2026, cuenta de Alonso).
    const hex = /^password: 0x([0-9A-Fa-f]+)/m.exec(r.err);
    if (hex) return Buffer.from(hex[1], 'hex').toString('utf8');
    const literal = /^password: "([^"\n]*)"[ \t]*$/m.exec(r.err);
    // En la forma entrecomillada, `security` escapa en octal lo que no es imprimible.
    return literal ? literal[1].replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))) : null;
  },
  async borrar(cuenta) {
    const r = await ejecutar('security', ['delete-generic-password', '-a', cuenta, '-s', SERVICIO]);
    return r.ok;
  },
};

// ── Windows: DPAPI de usuario ─────────────────────────────────────────────────────────────
//
// No hay un `security` equivalente en Windows, pero sí DPAPI: cifra con la credencial de la
// SESIÓN del usuario, de modo que el blob no lo puede descifrar ni otro usuario del equipo ni
// el mismo fichero copiado a otra máquina. El guion de PowerShell va por -EncodedCommand (no es
// secreto) y la contraseña por stdin (sí lo es): así no aparece en la línea de órdenes.
const RUTA_WIN = () => path.join(config.dataDir, 'correo.cred');

function psCodificado(guion) {
  return Buffer.from(guion, 'utf16le').toString('base64');
}

function psProteger(ruta) {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$clave = [Console]::In.ReadToEnd()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($clave)
$cifrado = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
[System.IO.File]::WriteAllText(${JSON.stringify(ruta)}, [Convert]::ToBase64String($cifrado))
$acl = Get-Acl -LiteralPath ${JSON.stringify(ruta)}
$acl.SetAccessRuleProtection($true, $false)
$acl.Access | ForEach-Object { [void]$acl.RemoveAccessRule($_) }
$yo = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$regla = New-Object System.Security.AccessControl.FileSystemAccessRule($yo, 'FullControl', 'Allow')
$acl.SetAccessRule($regla)
Set-Acl -LiteralPath ${JSON.stringify(ruta)} -AclObject $acl
`;
}

function psDesproteger(ruta) {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$b64 = [System.IO.File]::ReadAllText(${JSON.stringify(ruta)})
$cifrado = [Convert]::FromBase64String($b64)
$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($cifrado, $null, 'CurrentUser')
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes))
`;
}

function powershell(guion) {
  // `powershell.exe` (5.1) está en todo Windows 10/11; `pwsh` puede no estar.
  return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psCodificado(guion)]];
}

const win = {
  async guardar(cuenta, clave) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const [cmd, args] = powershell(psProteger(RUTA_WIN()));
    const r = await ejecutar(cmd, args, clave);
    if (!r.ok) return false;
    // El fichero solo guarda la contraseña de ESTA cuenta: el usuario se contrasta al leer.
    try { fs.writeFileSync(`${RUTA_WIN()}.cuenta`, cuenta, 'utf8'); } catch { /* el contraste es un extra */ }
    return true;
  },
  async leer(cuenta) {
    if (!fs.existsSync(RUTA_WIN())) return null;
    try {
      const guardada = fs.readFileSync(`${RUTA_WIN()}.cuenta`, 'utf8').trim();
      if (guardada && guardada !== cuenta) return null;
    } catch { /* sin marca de cuenta: se sigue */ }
    const [cmd, args] = powershell(psDesproteger(RUTA_WIN()));
    const r = await ejecutar(cmd, args);
    return r.ok && r.out ? r.out : null;
  },
  async borrar() {
    for (const f of [RUTA_WIN(), `${RUTA_WIN()}.cuenta`]) {
      try { fs.rmSync(f, { force: true }); } catch { /* ya no está */ }
    }
    return true;
  },
};

// ── Linux: secret-tool (GNOME Keyring / KWallet vía Secret Service) ────────────────────────
const linux = {
  async guardar(cuenta, clave) {
    const r = await ejecutar('secret-tool', ['store', '--label', `${SERVICIO} (${cuenta})`, 'service', 'robinsearch-correo', 'account', cuenta], clave);
    return r.ok;
  },
  async leer(cuenta) {
    const r = await ejecutar('secret-tool', ['lookup', 'service', 'robinsearch-correo', 'account', cuenta]);
    return r.ok && r.out ? r.out : null;
  },
  async borrar(cuenta) {
    const r = await ejecutar('secret-tool', ['clear', 'service', 'robinsearch-correo', 'account', cuenta]);
    return r.ok;
  },
};

// ── Último recurso (Linux sin Secret Service: servidor, contenedor, escritorio mínimo) ────
//
// Un fichero 0600 en el directorio de datos NO es un llavero: cualquiera que tenga la sesión
// del usuario lo lee en claro. Se usa solo si no hay nada mejor y SE DICE, con todas las
// letras, en la app y en `estado_servidor`. No se hace en macOS ni en Windows, donde siempre
// hay llavero de verdad: si allí falla, falla y se avisa.
const RUTA_FICHERO = () => path.join(config.dataDir, 'correo.clave');

const fichero = {
  async guardar(cuenta, clave) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(RUTA_FICHERO(), JSON.stringify({ cuenta, clave }), { mode: 0o600 });
    try { fs.chmodSync(RUTA_FICHERO(), 0o600); } catch { /* sistema de ficheros sin permisos POSIX */ }
    return true;
  },
  async leer(cuenta) {
    try {
      const d = JSON.parse(fs.readFileSync(RUTA_FICHERO(), 'utf8'));
      return d?.cuenta === cuenta && typeof d.clave === 'string' ? d.clave : null;
    } catch {
      return null;
    }
  },
  async borrar() {
    try { fs.rmSync(RUTA_FICHERO(), { force: true }); } catch { /* ya no está */ }
    return true;
  },
};

// ¿Hay Secret Service en esta sesión de Linux? Se comprueba UNA vez (un `lookup` de algo que no
// existe: devuelve 1 si el servicio está y no hay entrada, y falla de otra forma si no está).
let _linuxUsable = null;
async function linuxTieneLlavero() {
  if (_linuxUsable !== null) return _linuxUsable;
  const r = await ejecutar('secret-tool', ['lookup', 'service', 'robinsearch-correo', 'account', '__sondeo__']);
  // ENOENT (no hay binario) o «no se puede conectar al bus» → no hay llavero.
  _linuxUsable = !r.noExiste && !/cannot autolaunch|Failed to connect|dbus/i.test(r.err || '');
  if (!_linuxUsable) log.warn('Sin llavero del sistema en esta sesión: la contraseña del correo iría a un fichero 0600');
  return _linuxUsable;
}

export async function respaldo() {
  // Escotilla para las pruebas automáticas y para despliegues sin sesión gráfica (un servidor de
  // IT): fuerza el respaldo de fichero sin tocar el llavero real del abogado.
  if (process.env.ROBIN_CORREO_LLAVERO === 'fichero') return 'fichero';
  if (process.platform === 'darwin') return 'llavero_macos';
  if (process.platform === 'win32') return 'dpapi_windows';
  return (await linuxTieneLlavero()) ? 'secret_service' : 'fichero';
}

async function motor() {
  switch (await respaldo()) {
    case 'llavero_macos': return mac;
    case 'dpapi_windows': return win;
    case 'secret_service': return linux;
    default: return fichero;
  }
}

// Texto para el abogado cuando lo que hay no es un llavero de verdad. null = todo correcto.
export async function aviso() {
  if ((await respaldo()) !== 'fichero') return null;
  return 'Esta sesión no tiene llavero del sistema (ni GNOME Keyring ni KWallet), así que la '
    + 'contraseña queda en un fichero solo legible por tu usuario, no cifrada. Instala '
    + '«gnome-keyring» o «kwalletmanager» y vuelve a conectar para que se guarde en el llavero.';
}

export async function guardar(cuenta, clave) {
  if (!cuenta || typeof clave !== 'string' || !clave) throw new Error('Faltan la cuenta o la contraseña');
  const m = await motor();
  const ok = await m.guardar(cuenta, clave);
  // Ni el resultado ni nada de lo anterior lleva la contraseña: solo si se pudo guardar.
  log.info('Contraseña de correo guardada en el llavero', { respaldo: await respaldo(), ok });
  return ok;
}

export async function leer(cuenta) {
  if (!cuenta) return null;
  const m = await motor();
  try {
    return await m.leer(cuenta);
  } catch (err) {
    log.warn('No se pudo leer la contraseña del llavero', { err: String(err?.message ?? err) });
    return null;
  }
}

export async function borrar(cuenta) {
  const m = await motor();
  try {
    return await m.borrar(cuenta);
  } catch {
    return false;
  }
}

// Para las pruebas: rutas que toca el respaldo de fichero (hay que poder limpiarlas).
export function rutasDeRespaldo() {
  return { win: RUTA_WIN(), fichero: RUTA_FICHERO(), dataDir: config.dataDir, home: os.homedir() };
}

export default { guardar, leer, borrar, respaldo, aviso, SERVICIO, rutasDeRespaldo };
