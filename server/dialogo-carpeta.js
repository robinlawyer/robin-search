// Ventana del sistema para elegir carpeta: el Finder en macOS, el Explorador en Windows y zenity
// (o kdialog) en Linux. Existe para que el abogado elija el expediente desde la conversación con un
// clic, sin pegar rutas (propuesta de Juan, 1-oct-2026).
//
// La abre ESTE proceso, que corre en el ordenador del abogado: lo que elige no pasa por Claude ni
// por ningún servidor, solo vuelve el nombre del expediente.
//
// → { estado: 'elegido', rutas: [...] } | { estado: 'cancelado' } | { estado: 'error', motivo, detalle }

import { spawn } from 'node:child_process';
import fs from 'node:fs';

// Pruebas: simula la ventana sin abrir nada. JSON con { rutas } | { cancelar: true } | { error: '…' }
// y, opcional, { tarda_ms } para probar la espera; con «@ruta» se lee de ese fichero en cada
// apertura, para que cada llamada de la prueba elija otra cosa. Nunca en una instalación real.
function simulado() {
  let v = process.env.ROBIN_DIALOGO_SIMULADO;
  if (!v) return null;
  try {
    if (v.startsWith('@')) v = fs.readFileSync(v.slice(1), 'utf8');
    return JSON.parse(v);
  } catch { return { error: 'ROBIN_DIALOGO_SIMULADO ilegible' }; }
}

function ejecutar(cmd, args, { env, entrada } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let hijo;
    try {
      hijo = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: false, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ codigo: null, out, err: String(e?.message || e), noExiste: true });
      return;
    }
    hijo.stdout.setEncoding('utf8');
    hijo.stderr.setEncoding('utf8');
    hijo.stdout.on('data', (d) => { out += d; });
    hijo.stderr.on('data', (d) => { err += d; });
    hijo.on('error', (e) => resolve({ codigo: null, out, err: String(e?.message || e), noExiste: e?.code === 'ENOENT' }));
    hijo.on('close', (codigo) => resolve({ codigo, out, err }));
    if (entrada != null) hijo.stdin.end(entrada);
    else hijo.stdin.end();
  });
}

// Sin recortar los espacios del final: una carpeta puede llamarse «Ruiz » (revisión de Codex, 25-nov).
const lineas = (s) => String(s || '').split(/\r?\n/).map((x) => x.replace(/^\s+/, '')).filter((x) => x.trim() !== '');

// macOS. `activate` sin destino trae la ventana delante (si no, se abre DETRÁS de Claude y parece
// que no ha pasado nada) y no necesita el permiso de Automatización: no se controla otra app. La
// carpeta inicial y el título van como argumentos, nunca pegados en el guion.
async function mac({ inicial, titulo, varias }) {
  const guion = [
    'on run argv',
    'set titulo to item 2 of argv',
    'activate',
    `set r to choose folder with prompt titulo${inicial ? ' default location (POSIX file (item 1 of argv))' : ''}${varias ? ' with multiple selections allowed' : ''}`,
    'set salida to ""',
    'repeat with f in (r as list)',
    'set salida to salida & POSIX path of f & linefeed',
    'end repeat',
    'return salida',
    'end run',
  ];
  const args = guion.flatMap((l) => ['-e', l]).concat([inicial || '', titulo]);
  const r = await ejecutar('/usr/bin/osascript', args);
  if (r.codigo === 0) return { estado: 'elegido', rutas: lineas(r.out) };
  if (/-128/.test(r.err)) return { estado: 'cancelado' };
  return { estado: 'error', motivo: 'ventana_no_disponible', detalle: r.err.trim().slice(0, 300) };
}

// Windows. FolderBrowserDialog de Windows Forms, con un formulario dueño «siempre encima» para que
// no se quede detrás de Claude. Va en -EncodedCommand (UTF-16LE): sin comillas que escapar, y las
// rutas con tildes o espacios llegan por variables de entorno. Una sola carpeta por vez: para
// varias, se vuelve a abrir añadiendo.
async function windows({ inicial, titulo }) {
  const ps = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$d.Description = $env:ROBIN_DLG_TITULO',
    '$d.ShowNewFolderButton = $false',
    'if ($env:ROBIN_DLG_INICIAL) { $d.SelectedPath = $env:ROBIN_DLG_INICIAL }',
    '$f = New-Object System.Windows.Forms.Form',
    '$f.TopMost = $true',
    '$f.ShowInTaskbar = $false',
    '$r = $d.ShowDialog($f)',
    'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath; exit 0 } else { exit 3 }',
  ].join('\n');
  const codificado = Buffer.from(ps, 'utf16le').toString('base64');
  const r = await ejecutar('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', codificado], {
    env: { ROBIN_DLG_INICIAL: inicial || '', ROBIN_DLG_TITULO: titulo },
  });
  if (r.codigo === 0) return { estado: 'elegido', rutas: lineas(r.out) };
  if (r.codigo === 3) return { estado: 'cancelado' };
  return { estado: 'error', motivo: 'ventana_no_disponible', detalle: (r.err || `código ${r.codigo}`).trim().slice(0, 300) };
}

// Linux: zenity (GNOME y casi todos) o kdialog (KDE). Sin pantalla gráfica no hay ventana posible.
async function linux({ inicial, titulo, varias }) {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return { estado: 'error', motivo: 'sin_pantalla', detalle: 'No hay sesión gráfica (DISPLAY/WAYLAND_DISPLAY).' };
  }
  const z = await ejecutar('zenity', [
    '--file-selection', '--directory', `--title=${titulo}`,
    ...(inicial ? [`--filename=${inicial.replace(/\/?$/, '/')}`] : []),
    ...(varias ? ['--multiple', '--separator=\n'] : []),
  ]);
  if (!z.noExiste) {
    if (z.codigo === 0) return { estado: 'elegido', rutas: lineas(z.out) };
    if (z.codigo === 1) return { estado: 'cancelado' };
    return { estado: 'error', motivo: 'ventana_no_disponible', detalle: z.err.trim().slice(0, 300) };
  }
  const k = await ejecutar('kdialog', ['--getexistingdirectory', inicial || process.env.HOME || '/', '--title', titulo]);
  if (!k.noExiste) {
    if (k.codigo === 0) return { estado: 'elegido', rutas: lineas(k.out) };
    if (k.codigo === 1) return { estado: 'cancelado' };
    return { estado: 'error', motivo: 'ventana_no_disponible', detalle: k.err.trim().slice(0, 300) };
  }
  return { estado: 'error', motivo: 'sin_programa', detalle: 'No están instalados ni zenity ni kdialog.' };
}

export const admiteVarias = () => process.platform !== 'win32';

export async function elegirCarpetas({ inicial = null, titulo = 'Elige la carpeta del expediente', varias = false } = {}) {
  const sim = simulado();
  if (sim) {
    if (sim.tarda_ms) await new Promise((r) => setTimeout(r, sim.tarda_ms));
    if (sim.cancelar) return { estado: 'cancelado' };
    if (sim.error) return { estado: 'error', motivo: 'ventana_no_disponible', detalle: sim.error };
    return { estado: 'elegido', rutas: sim.rutas || [] };
  }
  const ini = inicial && fs.existsSync(inicial) ? inicial : null;
  try {
    if (process.platform === 'darwin') return await mac({ inicial: ini, titulo, varias });
    if (process.platform === 'win32') return await windows({ inicial: ini, titulo });
    return await linux({ inicial: ini, titulo, varias });
  } catch (e) {
    return { estado: 'error', motivo: 'ventana_no_disponible', detalle: String(e?.message || e).slice(0, 300) };
  }
}

export default { elegirCarpetas, admiteVarias };
