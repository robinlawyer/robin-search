// ESCENARIO (Eduardo, Mac, 7-nov-2026 07:44): se instala la 1.13.0 con Claude abierto. Claude solo
// reinicia uno de sus servidores; el otro, una 1.12.2 de la víspera, sigue con el índice. La nueva
// se quedaba de lectora, mandaba «instancias_duplicadas» y pedía cerrar Claude del todo, y la vieja
// seguía indexando con el motor que tumbaba el proceso.
//
// Se prueba con la 1.12.2 DE VERDAD (sacada del historial de git), no con un simulacro:
//   · la nueva se queda el índice sin informe de error, y la vieja pasa a solo buscar;
//   · tras el margen, lo nuevo de la carpeta lo indexa la nueva;
//   · el canal de RobinDesktop pasa a la nueva (macOS/Linux) y sigue vivo cuando la vieja se cierra;
//   · una versión ANTERIOR que llega con una nueva escribiendo no le quita nada.
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import crypto from 'node:crypto';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(Boolean(c)); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const terminar = (p) => (p.exitCode !== null || p.signalCode !== null ? Promise.resolve() : new Promise((r) => { p.once('exit', r); p.kill(); setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 15000).unref(); }));
const hasta = async (fn, ms = 60000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await fn()) return true; await espera(200); } return false; };

// La 1.12.2 publicada, del historial. Sin git (paquete descomprimido) no hay prueba que hacer.
const COMMIT_1122 = '6db8bb5';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-7nov-'));
const VIEJA = path.join(base, 'v1.12.2');
try {
  fs.mkdirSync(VIEJA);
  const tar = execFileSync('git', ['-C', REPO, 'archive', COMMIT_1122, 'server', 'package.json'], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', VIEJA], { input: tar });
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(VIEJA, 'node_modules'), 'junction');
  if (fs.existsSync(path.join(REPO, 'models'))) fs.symlinkSync(path.join(REPO, 'models'), path.join(VIEJA, 'models'), 'junction');
} catch (err) {
  console.log(`  --    sin historial de git para sacar la 1.12.2 (${String(err?.message || err).slice(0, 80)}): prueba omitida`);
  process.exit(0);
}
const vVieja = JSON.parse(fs.readFileSync(path.join(VIEJA, 'package.json'), 'utf8')).version;
// NUEVA: otra copia a probar en lugar de este árbol (para comprobar que la prueba ve el fallo).
const NUEVA = process.env.ROBIN_PRUEBA_NUEVA || REPO;
const vNueva = JSON.parse(fs.readFileSync(path.join(NUEVA, 'package.json'), 'utf8')).version;

// Los informes de fallo se recogen aquí: no tiene que llegar ninguno de «instancias_duplicadas».
const informes = [];
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { try { informes.push(JSON.parse(b)); } catch {} res.end('{}'); }); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL_INF = `http://127.0.0.1:${srv.address().port}/diag`;

const DATOS = path.join(base, 'datos');
const EXP = path.join(base, 'Expedientes');
const crear = (n, desde = 1) => { const d = path.join(EXP, '5603 Caso'); fs.mkdirSync(d, { recursive: true }); for (let i = desde; i < desde + n; i++) fs.writeFileSync(path.join(d, `escrito ${i}.txt`), `Documento ${i}. Contrato de arrendamiento y reclamación de cantidad.`); };
crear(3);
fs.mkdirSync(DATOS, { recursive: true });
fs.writeFileSync(path.join(DATOS, 'ajustes.json'), JSON.stringify({ carpetas: [EXP] }, null, 2));

const env = { ...process.env, ROBIN_DATA_DIR: DATOS, ROBIN_TOKEN: 'ROBIN-PRUEBA-7nov', ROBIN_OCR: 'false', ROBIN_LOG_LEVEL: 'info',
  ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no', ROBIN_OAUTH_ISSUER: 'http://127.0.0.1:9', ROBIN_DIAGNOSTICO_URL: URL_INF,
  ROBIN_REPASO_CANAL_MS: '500', ROBIN_ESCRITOR_RENUEVO_MS: '2000' };
delete env.ROBIN_SIN_SUPERVISOR;
// La nueva, como la lanza Claude: por el supervisor (cli/index.js) si lo trae.
const lanzar = (raiz) => { const cli = path.join(raiz, 'cli/index.js'); const p = spawn(process.execPath, [raiz !== VIEJA && fs.existsSync(cli) ? cli : path.join(raiz, 'server/index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] }); p.stdout.on('data', () => {}); p.stderr.on('data', () => {}); return p; };

const huella = crypto.createHash('sha256').update(DATOS).digest('hex').slice(0, 8);
const CANAL = process.platform === 'win32' ? `\\\\.\\pipe\\robinsearch-${huella}` : path.join('/tmp', `robinsearch-${huella}.sock`);
const versionCanal = () => new Promise((res) => {
  const s = net.connect(CANAL); let buf = '';
  const fin = (v) => { try { s.destroy(); } catch {} res(v); };
  s.setEncoding('utf8');
  s.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { try { fin(JSON.parse(buf.slice(0, i)).version); } catch { fin(null); } } });
  s.once('error', () => fin(null));
  setTimeout(() => fin(null), 1500).unref();
});
const manifiesto = () => { try { return Object.values(JSON.parse(fs.readFileSync(path.join(DATOS, 'files.json'), 'utf8'))); } catch { return []; } };
const lock = () => { try { return JSON.parse(fs.readFileSync(path.join(DATOS, 'escritor.lock'), 'utf8')); } catch { return null; } };
const registro = () => { try { return fs.readFileSync(path.join(DATOS, 'logs', 'robin-search.log'), 'utf8'); } catch { return ''; } };

console.log(`\n== Una ${vNueva} llega con una ${vVieja} escribiendo (lo de Eduardo, 7-nov)`);
const vieja = lanzar(VIEJA);
check(`la ${vVieja} indexa la carpeta`, await hasta(() => manifiesto().length === 3 && lock()?.pid === vieja.pid), `${manifiesto().length} documentos`);
if (process.platform !== 'win32') check(`el canal lo sirve la ${vVieja}`, await hasta(async () => (await versionCanal()) === vVieja, 15000));

const nueva = lanzar(NUEVA);
check('la nueva se queda el cerrojo del índice', await hasta(() => lock()?.pid === nueva.pid, 15000), `dueño ${lock()?.pid}, nueva ${nueva.pid}, vieja ${vieja.pid}`);
check(`la ${vVieja} pasa a solo buscar, sola`, await hasta(() => /ha tomado el índice: esta pasa a solo buscar/.test(registro()), 15000));
check('ningún «DOS versiones» en el registro de la nueva', !/DOS versiones de RobinSearch corriendo a la vez/.test(registro().split('\n').filter((l) => l.includes(`"actual":"${vNueva}"`)).join('\n')));
check('la nueva dice lo que ha hecho', /esta, más nueva, se lo queda/.test(registro()));

// Pasado el margen (2 s de renovación + 15 s), escribe la nueva: un documento nuevo se indexa.
check('tras el margen la nueva toma el relevo', await hasta(() => /Esta instancia toma el relevo del índice/.test(registro()), 40000));
crear(2, 4);
check('lo nuevo de la carpeta se indexa (lo hace la nueva)', await hasta(() => manifiesto().length === 5, 60000), `${manifiesto().length} de 5`);
check('la vieja no ha vuelto a quitarle el cerrojo', lock()?.pid === nueva.pid);

if (process.platform !== 'win32') {
  check(`el canal de RobinDesktop pasa a la ${vNueva}`, await hasta(async () => (await versionCanal()) === vNueva, 15000));
  await terminar(vieja);
  await espera(1500);
  check(`cerrada la ${vVieja}, el canal sigue vivo y es de la nueva`, await hasta(async () => (await versionCanal()) === vNueva, 10000));
} else {
  await terminar(vieja);
}
check('ningún informe de «instancias_duplicadas»', !informes.some((i) => i?.motivo === 'instancias_duplicadas'), informes.map((i) => i?.motivo).join(', '));
await terminar(nueva);
await espera(300);

console.log(`\n== Al revés: una ${vVieja} llega con la ${vNueva} escribiendo`);
const nueva2 = lanzar(NUEVA);
check('la nueva escribe', await hasta(() => lock()?.pid === nueva2.pid, 20000));
const vieja2 = lanzar(VIEJA);
await espera(8000);
check('la vieja no le quita el cerrojo', lock()?.pid === nueva2.pid, `dueño ${lock()?.pid}`);
if (process.platform !== 'win32') check('ni el canal', (await versionCanal()) === vNueva);
await Promise.all([terminar(nueva2), terminar(vieja2)]);

srv.close();
try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok === results.length ? 0 : 1);
