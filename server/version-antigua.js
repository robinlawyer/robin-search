// Versiones de RobinSearch ANTERIORES a la 1.4.5 que siguen arrancando en el equipo.
//
// 27-sep-2026, Mac de Eduardo (instalación d4ab74fd…): en el mismo registro que la 1.8.3 aparecía
// una RobinSearch 1.4.0 arrancando
//   · cada noche a las 01:30 SIN cliente MCP («Arrancando» sin «Servidor MCP conectado», con
//     carpeta y con «Indexado inicial completado»): el modo IT `robin-search --silent`, lanzado
//     por una tarea programada (launchd o cron; en Windows, el Programador de tareas), y
//   · varias veces al día DESDE Claude, sin carpeta («nada que indexar»): una extensión antigua
//     que sigue instalada con otro identificador, o una entrada en la configuración MCP de Claude
//     Desktop / Claude Code que apunta a una copia vieja.
// Esa versión guarda el índice en index/index.json (vectra) y no conoce el cerrojo de escritor:
// cada vez que corría, la nueva tenía que volver a «pasar el índice al formato por documento»,
// y un arranque que se lo encontró a medio escribir dio el índice por roto y lo borró.
//
// Nadie de RobinLawyer.ai instaló esa tarea (ni el instalador, ni la app, ni ninguna versión de la
// extensión programan nada: el modo --silent se documentó para que el IT del despacho lo
// integrase en sus scripts). Pero lo que ejecuta es NUESTRO programa en una versión que daña el
// índice. Así que, sin pedir nada al abogado, en cada arranque de la instancia que escribe:
//   1. Se buscan los lanzadores de RobinSearch: LaunchAgents del usuario, su crontab, sus tareas
//      programadas de Windows, las extensiones de Claude y las entradas MCP de Claude Desktop y
//      de Claude Code.
//   2. Solo se toca un lanzador si lo que ejecuta es, SIN DUDA, RobinSearch (un package.json
//      «@robinlawyer/robin-search» o un manifest.json «robin-search» de RobinLawyer, encontrado
//      siguiendo sus rutas) y de una versión anterior a la 1.4.5 (la del índice vectra). Un
//      lanzador de otra cosa, uno cuyo programa no se pueda resolver, o uno de una versión
//      actual, no se toca: se registra y ya.
//   3. Se DESACTIVA, no se borra, y se guarda copia de lo que había en <dataDir>/version-antigua/
//      para poder deshacerlo: la tarea de launchd se descarga y su .plist se mueve ahí; la línea
//      del crontab se comenta; la tarea de Windows se deshabilita; la extensión vieja se apaga
//      con su interruptor de Claude; la entrada MCP se retira de la configuración (con copia).
// Y aunque algo se escape (un lanzador que no sepamos ver), el índice nuevo ya no se puede pisar:
// search/store.js pone un «cepo» en index/index.json y aparta, sin migrarlo, el que aparezca.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config, VERSION } from './config.js';
import { log } from './logger.js';
import { escribirAtomico } from './persistencia.js';

// La primera versión con el índice por documento. Todo lo anterior escribe index/index.json.
export const PRIMERA_SEGURA = '1.4.5';
const RAIZ_PROPIA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function compararVersiones(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}
export const esAntigua = (v) => Boolean(v) && /^\d+\.\d+/.test(String(v)) && compararVersiones(v, PRIMERA_SEGURA) < 0;

function leerJson(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return null;
  }
}

const esNuestroManifiesto = (m) =>
  m?.name === 'robin-search' && typeof m.version === 'string' && /robin ?lawyer/i.test(String(m.author?.name ?? m.author ?? ''));

// ¿Es esta ruta (un fichero, un enlace del bin de npm, una carpeta) parte de una instalación de
// RobinSearch? → { dir, version } o null. Sube como mucho 6 carpetas buscando su package.json
// o su manifest.json.
export function paqueteRobinDe(ruta) {
  if (typeof ruta !== 'string') return null;
  const limpia = ruta.trim().replace(/^["']|["']$/g, '');
  if (!limpia || !path.isAbsolute(limpia)) return null;
  let real;
  try {
    real = fs.realpathSync(limpia);
  } catch {
    return null;
  }
  let dir;
  try {
    dir = fs.statSync(real).isDirectory() ? real : path.dirname(real);
  } catch {
    return null;
  }
  for (let i = 0; i < 6; i++) {
    const pkg = leerJson(path.join(dir, 'package.json'));
    if (pkg?.name === '@robinlawyer/robin-search' && typeof pkg.version === 'string') return { dir, version: pkg.version };
    const man = leerJson(path.join(dir, 'manifest.json'));
    if (esNuestroManifiesto(man)) return { dir, version: man.version };
    const arriba = path.dirname(dir);
    if (arriba === dir) break;
    dir = arriba;
  }
  return null;
}

// Trozos de una línea de órdenes que pueden ser rutas o un «paquete@versión» de npx.
function trozos(texto) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(texto)))) out.push(m[1] ?? m[2] ?? m[3]);
  // «--folder=/ruta» y similares: la parte de después del igual también.
  for (const t of [...out]) {
    const i = t.indexOf('=');
    if (i > 0) out.push(t.slice(i + 1));
  }
  return out;
}

// De un conjunto de argumentos, la instalación de RobinSearch que ejecutan (la primera que se
// identifique con certeza). `npx @robinlawyer/robin-search@1.4.0` cuenta con su versión; sin
// versión no se sabe cuál bajaría npx y no se toca.
export function identificar(args, { home = os.homedir() } = {}) {
  let base = null; // «cd <carpeta> && node cli/index.js …» dentro de un sh -c
  const lista = args.flatMap(trozos).map((a) => (a.startsWith('~/') ? path.join(home, a.slice(2)) : a));
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    if (a === 'cd' && lista[i + 1]) {
      base = lista[i + 1];
      continue;
    }
    const npx = /^@robinlawyer\/robin-search@(\d+\.\d+\.\d+)$/.exec(a);
    if (npx) return { dir: null, version: npx[1], npx: true };
    const p = paqueteRobinDe(a) ?? (base && path.isAbsolute(base) && /[\\/]|\.m?js$/.test(a) ? paqueteRobinDe(path.join(base, a)) : null);
    if (p) return p;
  }
  return null;
}

const esPropia = (p) => Boolean(p?.dir) && path.resolve(p.dir) === RAIZ_PROPIA;
const aDesactivar = (p) => Boolean(p) && !esPropia(p) && esAntigua(p.version);

// Asíncrono y con tope: PowerShell tarda segundos en arrancar y el proceso tiene que seguir
// atendiendo a Claude mientras tanto.
function ejecutarPorDefecto(cmd, args, { input } = {}) {
  return new Promise((resolve) => {
    let hijo;
    try {
      hijo = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err) });
      return;
    }
    let stdout = '';
    let stderr = '';
    const tope = setTimeout(() => hijo.kill(), 30000);
    hijo.stdout.on('data', (d) => (stdout += d));
    hijo.stderr.on('data', (d) => (stderr += d));
    hijo.on('error', (err) => {
      clearTimeout(tope);
      resolve({ code: -1, stdout, stderr: String(err) });
    });
    hijo.on('close', (code) => {
      clearTimeout(tope);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    hijo.stdin.on('error', () => {});
    hijo.stdin.end(input ?? undefined);
  });
}

function dirCopias(dataDir) {
  const d = path.join(dataDir, 'version-antigua');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const sello = () => new Date().toISOString().replace(/[:.]/g, '-');

function moverConCopia(origen, destino) {
  try {
    fs.renameSync(origen, destino);
  } catch {
    fs.copyFileSync(origen, destino);
    fs.rmSync(origen, { force: true });
  }
}

const decodificarXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// ── macOS: LaunchAgents del usuario ─────────────────────────────────────────────────────
async function launchAgents(ctx) {
  const dir = path.join(ctx.home, 'Library', 'LaunchAgents');
  let nombres = [];
  try {
    nombres = fs.readdirSync(dir).filter((n) => n.endsWith('.plist'));
  } catch {
    return;
  }
  for (const n of nombres) {
    const ruta = path.join(dir, n);
    let texto;
    try {
      const buf = fs.readFileSync(ruta);
      texto = buf.subarray(0, 6).toString('latin1') === 'bplist' ? (await ctx.ejecutar('plutil', ['-convert', 'xml1', '-o', '-', ruta])).stdout : buf.toString('utf8');
    } catch {
      continue;
    }
    if (!/robin/i.test(texto)) continue;
    const cadenas = [...texto.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => decodificarXml(m[1]));
    const p = identificar(cadenas, { home: ctx.home });
    const label = /<key>Label<\/key>\s*<string>([\s\S]*?)<\/string>/.exec(texto)?.[1] ?? null;
    ctx.visto({ tipo: 'launchd', version: p?.version ?? null, nuestro: Boolean(p) });
    if (!aDesactivar(p)) continue;
    // Descargarlo de launchd (deja de dispararse ya) y apartar el .plist (no vuelve al iniciar
    // sesión). Con copia: moverlo de vuelta a LaunchAgents lo restaura.
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (uid !== null) await ctx.ejecutar('launchctl', ['bootout', `gui/${uid}`, ruta]);
    if (label && uid !== null) await ctx.ejecutar('launchctl', ['bootout', `gui/${uid}/${decodificarXml(label)}`]);
    try {
      moverConCopia(ruta, path.join(dirCopias(ctx.dataDir), `${n}.${sello()}.desactivado`));
      ctx.hecho({ tipo: 'launchd', version: p.version });
    } catch (err) {
      ctx.fallo({ tipo: 'launchd', version: p.version, code: err?.code ?? null });
    }
  }
}

// ── macOS y Linux: crontab del usuario ──────────────────────────────────────────────────
async function crontab(ctx) {
  const r = await ctx.ejecutar('crontab', ['-l']);
  if (r.code !== 0 || !r.stdout) return;
  const lineas = r.stdout.split('\n');
  let cambios = 0;
  let version = null;
  const nuevas = lineas.map((l) => {
    const t = l.trim();
    if (!t || t.startsWith('#') || !/robin/i.test(t)) return l;
    const p = identificar([t], { home: ctx.home });
    ctx.visto({ tipo: 'cron', version: p?.version ?? null, nuestro: Boolean(p) });
    if (!aDesactivar(p)) return l;
    cambios += 1;
    version = p.version;
    return `# [desactivado por RobinSearch ${VERSION}: RobinSearch ${p.version} reescribía el índice antiguo] ${l}`;
  });
  if (!cambios) return;
  try {
    fs.writeFileSync(path.join(dirCopias(ctx.dataDir), `crontab.${sello()}.copia`), r.stdout);
  } catch {
    /* sin copia no se toca */
    ctx.fallo({ tipo: 'cron', version, code: 'sin_copia' });
    return;
  }
  const w = await ctx.ejecutar('crontab', ['-'], { input: nuevas.join('\n') });
  if (w.code === 0) ctx.hecho({ tipo: 'cron', version, lineas: cambios });
  else ctx.fallo({ tipo: 'cron', version, code: w.code });
}

// ── Windows: Programador de tareas (tareas del usuario) ────────────────────────────────
const PS_LISTAR =
  "$ErrorActionPreference='SilentlyContinue';" +
  'Get-ScheduledTask | Where-Object { $_.State -ne \'Disabled\' } | ForEach-Object { $t=$_; foreach($a in $t.Actions){ ' +
  "if((\"$($a.Execute) $($a.Arguments)\") -match 'robin'){ [pscustomobject]@{n=$t.TaskName;p=$t.TaskPath;e=$a.Execute;a=$a.Arguments;w=$a.WorkingDirectory} } } } | ConvertTo-Json -Compress";

const comillaPs = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function tareasWindows(ctx) {
  const r = await ctx.ejecutar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_LISTAR]);
  if (r.code !== 0 || !r.stdout.trim()) return;
  let lista;
  try {
    lista = JSON.parse(r.stdout);
  } catch {
    return;
  }
  for (const t of Array.isArray(lista) ? lista : [lista]) {
    const args = [t.e, ...trozos(t.a || '')];
    // Una ruta relativa se resuelve contra la carpeta de trabajo de la acción.
    if (t.w) for (const x of trozos(t.a || '')) if (!path.isAbsolute(x)) args.push(path.join(t.w, x));
    const p = identificar(args, { home: ctx.home });
    ctx.visto({ tipo: 'tarea_windows', version: p?.version ?? null, nuestro: Boolean(p) });
    if (!aDesactivar(p)) continue;
    try {
      fs.writeFileSync(path.join(dirCopias(ctx.dataDir), `tarea-windows.${sello()}.json`), JSON.stringify(t, null, 2));
    } catch {
      ctx.fallo({ tipo: 'tarea_windows', version: p.version, code: 'sin_copia' });
      continue;
    }
    const w = await ctx.ejecutar('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Disable-ScheduledTask -TaskName ${comillaPs(t.n)} -TaskPath ${comillaPs(t.p || '\\')} | Out-Null`,
    ]);
    if (w.code === 0) ctx.hecho({ tipo: 'tarea_windows', version: p.version });
    else ctx.fallo({ tipo: 'tarea_windows', version: p.version, code: w.code });
  }
}

// ── Claude: extensiones antiguas con otro identificador ────────────────────────────────
export function dirsClaude(home, plataforma, env = process.env) {
  if (plataforma === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Claude')];
  if (plataforma === 'win32') {
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(roaming, 'Claude'),
      ...['Claude_pzs8sxrjxfjjc', 'AnthropicPBC.Claude_fnn82j28hfe8t'].map((p) => path.join(local, 'Packages', p, 'LocalCache', 'Roaming', 'Claude')),
    ];
  }
  return [path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude')];
}

function extensionesClaude(ctx) {
  for (const base of ctx.dirsClaude) {
    const dirExt = path.join(base, 'Claude Extensions');
    let ids = [];
    try {
      ids = fs.readdirSync(dirExt);
    } catch {
      continue;
    }
    for (const id of ids) {
      const man = leerJson(path.join(dirExt, id, 'manifest.json'));
      if (!esNuestroManifiesto(man)) continue;
      const p = { dir: path.join(dirExt, id), version: man.version };
      ctx.visto({ tipo: 'extension_claude', version: man.version, nuestro: true });
      if (!aDesactivar(p)) continue;
      const rutaAjustes = path.join(base, 'Claude Extensions Settings', `${id}.json`);
      const ajustes = leerJson(rutaAjustes) || {};
      if (ajustes.isEnabled === false) continue; // ya apagada
      try {
        fs.mkdirSync(path.dirname(rutaAjustes), { recursive: true });
        if (fs.existsSync(rutaAjustes)) fs.copyFileSync(rutaAjustes, path.join(dirCopias(ctx.dataDir), `${id}.ajustes.${sello()}.json`));
        escribirAtomico(rutaAjustes, JSON.stringify({ ...ajustes, isEnabled: false }, null, 2));
        ctx.hecho({ tipo: 'extension_claude', version: man.version });
      } catch (err) {
        ctx.fallo({ tipo: 'extension_claude', version: man.version, code: err?.code ?? null });
      }
    }
  }
}

// ── Claude Desktop y Claude Code: entradas MCP que lanzan una copia antigua ───────────────
function entradasMcp(ctx, ruta, tipo) {
  let texto;
  let st;
  try {
    st = fs.statSync(ruta);
    texto = fs.readFileSync(ruta, 'utf8');
  } catch {
    return;
  }
  if (!/robin/i.test(texto)) return;
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    return;
  }
  const quitadas = [];
  const revisar = (servidores, donde) => {
    if (!servidores || typeof servidores !== 'object') return;
    for (const [nombre, s] of Object.entries(servidores)) {
      if (!s || typeof s !== 'object') continue;
      const args = [s.command, ...(Array.isArray(s.args) ? s.args : [])].filter((x) => typeof x === 'string');
      if (!args.some((a) => /robin/i.test(a))) continue;
      const p = identificar(args, { home: ctx.home });
      ctx.visto({ tipo, version: p?.version ?? null, nuestro: Boolean(p) });
      if (!aDesactivar(p)) continue;
      quitadas.push({ donde, nombre, entrada: s, version: p.version });
      delete servidores[nombre];
    }
  };
  revisar(json.mcpServers, 'mcpServers');
  if (json.projects && typeof json.projects === 'object') {
    for (const [proy, v] of Object.entries(json.projects)) revisar(v?.mcpServers, `projects.${proy}.mcpServers`);
  }
  if (!quitadas.length) return;
  try {
    fs.writeFileSync(path.join(dirCopias(ctx.dataDir), `${tipo}.${sello()}.retiradas.json`), JSON.stringify(quitadas, null, 2));
    // Claude reescribe su configuración a menudo: si ha cambiado mientras se miraba, se deja
    // para el próximo arranque antes que pisar lo que acaba de escribir.
    if (fs.statSync(ruta).mtimeMs !== st.mtimeMs) return;
    escribirAtomico(ruta, JSON.stringify(json, null, 2));
    for (const q of quitadas) ctx.hecho({ tipo, version: q.version });
  } catch (err) {
    for (const q of quitadas) ctx.fallo({ tipo, version: q.version, code: err?.code ?? null });
  }
}

// Recorre todo y desactiva lo que sea, con certeza, una RobinSearch antigua. Devuelve
// { vistos, desactivados, fallos } (solo tipos y versiones: nada de rutas ni nombres).
export async function neutralizarVersionesAntiguas({
  home = os.homedir(),
  plataforma = process.platform,
  ejecutar = ejecutarPorDefecto,
  dataDir = config.dataDir,
  env = process.env,
} = {}) {
  const r = { vistos: [], desactivados: [], fallos: [] };
  const ctx = {
    home,
    dataDir,
    ejecutar: async (cmd, args, o) => {
      try {
        return await ejecutar(cmd, args, o);
      } catch (err) {
        return { code: -1, stdout: '', stderr: String(err) };
      }
    },
    dirsClaude: dirsClaude(home, plataforma, env),
    visto: (x) => r.vistos.push(x),
    hecho: (x) => r.desactivados.push(x),
    fallo: (x) => r.fallos.push(x),
  };
  const pasos = [
    ['launchd', () => plataforma === 'darwin' && launchAgents(ctx)],
    ['cron', () => plataforma !== 'win32' && crontab(ctx)],
    ['tareas', () => plataforma === 'win32' && tareasWindows(ctx)],
    ['extensiones', () => extensionesClaude(ctx)],
    ['claude_desktop', () => ctx.dirsClaude.forEach((d) => entradasMcp(ctx, path.join(d, 'claude_desktop_config.json'), 'mcp_claude_desktop'))],
    ['claude_code', () => entradasMcp(ctx, path.join(home, '.claude.json'), 'mcp_claude_code')],
  ];
  for (const [nombre, fn] of pasos) {
    try {
      await fn();
    } catch (err) {
      r.fallos.push({ tipo: nombre, code: err?.code ?? String(err?.message ?? err).slice(0, 80) });
    }
  }
  return r;
}

export default { neutralizarVersionesAntiguas, identificar, paqueteRobinDe, esAntigua, compararVersiones, dirsClaude };
