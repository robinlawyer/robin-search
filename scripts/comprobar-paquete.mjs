// Comprueba un .mcpb ANTES de publicarlo.
//
//   node scripts/comprobar-paquete.mjs dist/robin-search.mcpb
//
// Lo que Claude Desktop instala es este zip, no el repositorio. Se comprueba:
//   1. Ni un binario nativo (.node .dll .dylib .so .exe): Claude Desktop en Mac los bloquea
//      (library validation / Team ID) y en Windows y Linux serían de la plataforma equivocada.
//   2. Ni enlaces simbólicos (Windows no los descomprime sin privilegios) ni rutas absolutas o
//      con «..» dentro del zip.
//   3. Ni rastro de la máquina que empaquetó: su carpeta personal, su directorio de trabajo o su
//      usuario metidos en una ruta. (Solo lo que es de la máquina de build: textos de ejemplo
//      como «/Users/prueba» en las pruebas no cuentan.)
//   4. manifest.json y package.json dicen la MISMA versión, y el entry_point existe.
//   5. El parche WASM está aplicado (sin él, @xenova/transformers carga onnxruntime-node).
//   6. El modelo de embedding y el idioma de OCR están dentro, con el tamaño y sha256 de su
//      manifiesto.
//   7. `cli/index.js --version`, arrancado desde el paquete descomprimido en una ruta con espacios
//      y tildes, dice la versión del manifest (el fallo de Windows del 16-sep-2026 daba 0.0.0).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const fichero = process.argv[2];
if (!fichero) {
  console.error('uso: node scripts/comprobar-paquete.mjs <paquete.mcpb>');
  process.exit(2);
}
const results = [];
const check = (n, c, d = '') => {
  results.push(Boolean(c));
  console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`);
};

const zip = new AdmZip(fichero);
const entradas = zip.getEntries();
const nombres = entradas.map((e) => e.entryName);
const texto = (n) => zip.getEntry(n)?.getData().toString('utf8');
console.log(`${fichero}: ${entradas.length} entradas, ${(fs.statSync(fichero).size / 1048576).toFixed(1)} MB\n`);

// 1. Binarios nativos
const NATIVO = /\.(node|dll|dylib|exe|so)$|\.so\.\d+/i;
const nativos = nombres.filter((n) => NATIVO.test(n));
check('sin binarios nativos (.node .dll .dylib .so .exe)', nativos.length === 0, nativos.slice(0, 5).join(', '));
const PROHIBIDOS = ['node_modules/onnxruntime-node/', 'node_modules/sharp/', 'node_modules/@img/', 'node_modules/@napi-rs/', 'node_modules/fsevents/'];
const colados = PROHIBIDOS.filter((p) => nombres.some((n) => n.startsWith(p)));
check('.mcpbignore ha dejado fuera los módulos nativos', colados.length === 0, colados.join(', '));
// Lo que solo sirve para instalar sharp o generar código (sin uso en ejecución).
const SOBRANTES = [/^node_modules\/bare-[^/]+\//, /^node_modules\/protobufjs\/cli\//, /^node_modules\/prebuild-install\//];
const sobrantes = [...new Set(nombres.filter((n) => SOBRANTES.some((re) => re.test(n))).map((n) => n.split('/').slice(0, 3).join('/')))];
check('.mcpbignore ha dejado fuera bare-*, protobufjs/cli y prebuild-install', sobrantes.length === 0, sobrantes.slice(0, 5).join(', '));

// 2. Enlaces simbólicos y rutas raras
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const enlaces = entradas.filter((e) => ((e.header.attr >>> 16) & S_IFMT) === S_IFLNK).map((e) => e.entryName);
check('sin enlaces simbólicos', enlaces.length === 0, enlaces.slice(0, 5).join(', '));
const raras = nombres.filter((n) => n.startsWith('/') || /^[A-Za-z]:/.test(n) || n.split(/[\\/]/).includes('..') || n.includes('\\'));
check('sin rutas absolutas, «..» ni barras invertidas en el zip', raras.length === 0, raras.slice(0, 5).join(', '));

// 3. Rastro de la máquina de build
const huellas = new Set();
for (const p of [process.cwd(), os.homedir()]) {
  if (p && p.length > 3) {
    huellas.add(p);
    huellas.add(p.replace(/\\/g, '/'));
    huellas.add(p.replace(/\\/g, '\\\\'));
  }
}
const usuario = os.userInfo().username;
const reUsuario = usuario && usuario.length >= 3
  ? new RegExp(`(?:/Users/|/home/|\\\\Users\\\\|\\\\\\\\Users\\\\\\\\)${usuario.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i')
  : null;
const TEXTO = /\.(js|mjs|cjs|json|md|txt|html|ts|map|yml|yaml)$/i;
const rastro = [];
for (const e of entradas) {
  if (e.isDirectory || !TEXTO.test(e.entryName) || e.header.size > 8 * 1048576) continue;
  const t = e.getData().toString('utf8');
  for (const h of huellas) if (t.includes(h)) rastro.push(`${e.entryName} (${h})`);
  if (reUsuario?.test(t)) rastro.push(`${e.entryName} (usuario ${usuario})`);
  if (rastro.length > 10) break;
}
check('sin rutas de la máquina que empaquetó', rastro.length === 0, [...new Set(rastro)].slice(0, 5).join(', '));

// 4. Versiones y entry_point
let manifest = null;
let pkg = null;
try { manifest = JSON.parse(texto('manifest.json')); } catch { /* abajo */ }
try { pkg = JSON.parse(texto('package.json')); } catch { /* abajo */ }
check('manifest.json y package.json viajan en el paquete', Boolean(manifest && pkg));
check('y dicen la misma versión', manifest?.version && manifest.version === pkg?.version, `manifest ${manifest?.version} · package.json ${pkg?.version}`);
check('el entry_point del manifest existe', nombres.includes(manifest?.server?.entry_point), manifest?.server?.entry_point);

// 5. Parche WASM
const onnx = texto('node_modules/@xenova/transformers/src/backends/onnx.js') || '';
check('parche WASM aplicado a @xenova/transformers', onnx.includes('[ROBIN]') && !onnx.includes("from 'onnxruntime-node'"));

// 6. Modelos
let mm = null;
try { mm = JSON.parse(texto('models/manifest.json')); } catch { /* abajo */ }
const malos = [];
if (mm) {
  const lista = Object.entries(mm.ficheros || {}).map(([rel, m]) => [`models/${mm.modelo}/${rel}`, m]);
  if (mm.ocr) lista.push([`models/tesseract/${mm.ocr.lang}.traineddata`, mm.ocr]);
  for (const [n, m] of lista) {
    const e = zip.getEntry(n);
    if (!e) { malos.push(`${n} falta`); continue; }
    const b = e.getData();
    if (b.length !== m.bytes) malos.push(`${n} ${b.length}≠${m.bytes}`);
    else if (m.sha256 && crypto.createHash('sha256').update(b).digest('hex') !== m.sha256) malos.push(`${n} sha256`);
  }
}
check('modelo de embedding y OCR dentro, íntegros (tamaño y sha256)', Boolean(mm) && malos.length === 0, mm ? malos.join(', ') : 'sin models/manifest.json');

// 7. Versión que lee el servidor arrancado desde el paquete descomprimido
const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'Paquete Robin Ñ '));
try {
  for (const e of entradas) {
    if (e.isDirectory) continue;
    if (!/^(cli\/|server\/|package\.json$|manifest\.json$)/.test(e.entryName)) continue;
    const p = path.join(destino, ...e.entryName.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, e.getData());
  }
  const salida = execFileSync(process.execPath, [path.join(destino, 'cli', 'index.js'), '--version'], {
    cwd: os.tmpdir(),
    env: { ...process.env, ROBIN_DATA_DIR: path.join(destino, 'datos'), ROBIN_DIAGNOSTICO_URL: 'off' },
    encoding: 'utf8',
    timeout: 60000,
  }).trim();
  check(`«cli/index.js --version» desde «${path.basename(destino)}» da la versión del manifest`,
    salida === `robin-search ${manifest?.version}` && !salida.endsWith('0.0.0'), salida);
} catch (err) {
  check('«cli/index.js --version» arranca desde el paquete descomprimido', false, String(err.message).slice(0, 200));
} finally {
  fs.rmSync(destino, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

const fallos = results.filter((r) => !r).length;
console.log(`\n${results.length - fallos}/${results.length} comprobaciones OK`);
process.exit(fallos ? 1 : 0);
