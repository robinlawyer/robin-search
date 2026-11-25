// ESCENARIO (Fernando, Windows, 7→9-nov-2026): 114.800 documentos, el equipo «encendido todo el
// fin de semana» y el lunes 3.960 indexados. Ningún fallo: RobinSearch no estaba corriendo (Claude
// cerrado o Windows suspendido) y nadie lo supo hasta que Juan fue a verlo.
//
// Se prueba (seguimiento.js):
//   · con RobinSearch lanzado como lo lanza Claude, llegan latidos de progreso a /robinsearch/progreso
//     (inicio, empieza, cada poco mientras indexa, termina) con pendientes que bajan hasta 0 y los
//     documentos del índice subiendo;
//   · en los latidos NO va nada de los documentos: ni rutas, ni nombres de fichero, ni carpetas;
//   · mientras indexa, el equipo no se suspende (macOS: caffeinate vivo con nuestro pid) y al
//     terminar se suelta;
//   · un salto del reloj (equipo suspendido) se cuenta y sale un latido «despierta»;
//   · ROBIN_SEGUIMIENTO=off no manda nada.
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(Boolean(c)); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const terminar = (p) => (p.exitCode !== null || p.signalCode !== null ? Promise.resolve() : new Promise((r) => { p.once('exit', r); p.kill(); setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 15000).unref(); }));
const hasta = async (fn, ms = 120000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await fn()) return true; await espera(200); } return false; };

const latidos = []; const rutasPedidas = [];
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { rutasPedidas.push(req.url); if (req.url.endsWith('/progreso')) { try { latidos.push(JSON.parse(b)); } catch {} } res.end('{"ok":true}'); }); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL_DIAG = `http://127.0.0.1:${srv.address().port}/robinsearch/diagnostico`;

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-seguimiento-'));
const DATOS = path.join(base, 'datos');
const EXP = path.join(base, 'Expedientes');
const NOMBRE = 'Pérez García - Divorcio';
fs.mkdirSync(path.join(EXP, NOMBRE), { recursive: true });
const N = 40;
for (let i = 1; i <= N; i++) {
  fs.writeFileSync(path.join(EXP, NOMBRE, `Demanda Juan García ${i}.txt`), `Escrito ${i}. ${'Reclamación de cantidad por arrendamiento de local de negocio y daños. '.repeat(30)}`);
}
fs.mkdirSync(DATOS, { recursive: true });
fs.writeFileSync(path.join(DATOS, 'ajustes.json'), JSON.stringify({ carpetas: [EXP] }, null, 2));

const env = { ...process.env, ROBIN_DATA_DIR: DATOS, ROBIN_TOKEN: 'ROBIN-PRUEBA-SEGUIMIENTO', ROBIN_OCR: 'false', ROBIN_LOG_LEVEL: 'info',
  ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no', ROBIN_OAUTH_ISSUER: 'http://127.0.0.1:9', ROBIN_DIAGNOSTICO_URL: URL_DIAG,
  ROBIN_SEGUIMIENTO_PRIMERA_MS: '200', ROBIN_SEGUIMIENTO_TICK_MS: '250', ROBIN_SEGUIMIENTO_CADA_MS: '1000', ROBIN_SEGUIMIENTO_SOLTAR_MS: '500' };
delete env.ROBIN_SIN_SUPERVISOR; delete env.ROBIN_SEGUIMIENTO; delete env.ROBIN_NO_DESVELAR;

const cli = path.join(REPO, 'cli/index.js');
const p = spawn(process.execPath, [fs.existsSync(cli) ? cli : path.join(REPO, 'server/index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
p.stdout.on('data', () => {}); p.stderr.on('data', () => {});

// macOS: ¿hay un caffeinate esperando a nuestro pid?
const caffeinateVivo = () => {
  if (process.platform !== 'darwin') return null;
  try { return execFileSync('pgrep', ['-f', `caffeinate -i -w ${p.pid}`], { encoding: 'utf8' }).trim().length > 0; } catch { return false; }
};
let vistoDesvelado = false; let vistoCaffeinate = false;
const vigia = setInterval(() => { if (latidos.some((l) => l.desvelado)) vistoDesvelado = true; if (caffeinateVivo()) vistoCaffeinate = true; }, 150);

const termino = await hasta(() => latidos.some((l) => l.evento === 'termina' || (l.estado !== 'indexando' && l.pendientes === 0 && (l.documentos ?? 0) >= N)), 600000);
await espera(1500);
clearInterval(vigia);
check('llegan latidos de progreso a /robinsearch/progreso', latidos.length >= 2, `${latidos.length} latidos: ${[...new Set(latidos.map((l) => l.evento))].join(', ')}`);
check('el primero es «inicio»', latidos[0]?.evento === 'inicio');
check('la pasada termina y se dice (pendientes 0, documentos en el índice)', termino, JSON.stringify(latidos.at(-1) || {}).slice(0, 220));
const conPend = latidos.filter((l) => typeof l.pendientes === 'number');
check('mientras indexa, los pendientes se cuentan y bajan', conPend.length >= 1 && conPend.at(-1).pendientes <= (conPend[0].pendientes ?? 0), conPend.map((l) => l.pendientes).join('→'));
check('documentos del índice al final = los de la carpeta', (latidos.at(-1)?.documentos ?? 0) >= N, String(latidos.at(-1)?.documentos));
const todo = JSON.stringify(latidos);
check('NADA de los documentos en los latidos (ni rutas, ni nombres, ni carpeta)',
  !todo.includes('Pérez') && !todo.includes('García') && !todo.includes('Demanda') && !todo.includes(base) && !todo.includes('Expedientes') && !/[\\/](Users|home|tmp|var)[\\/]/.test(todo));
check('lleva instalación, versión, sistema y memoria', latidos.every((l) => l.instalacion && l.version && l.plataforma && Number.isFinite(l.ram_libre_mb)));
if (process.platform === 'darwin') {
  check('mientras indexa, el Mac no se suspende (caffeinate con nuestro pid)', vistoCaffeinate && vistoDesvelado);
  check('al terminar se suelta (sin caffeinate)', await hasta(() => !caffeinateVivo(), 10000));
}
await terminar(p);

// ── Equipo suspendido: un salto de reloj entre dos vueltas → «despierta» con los minutos ──────
{
  const DATOS2 = path.join(base, 'datos2'); fs.mkdirSync(DATOS2, { recursive: true });
  fs.writeFileSync(path.join(DATOS2, 'ajustes.json'), JSON.stringify({ carpetas: [EXP] }, null, 2));
  const codigo = `
    const esc = (await import(${JSON.stringify(path.join(REPO, 'server/escritor.js'))})).default;
    esc.adquirir();
    const s = await import(${JSON.stringify(path.join(REPO, 'server/seguimiento.js'))});
    const t0 = Date.now();
    const a = await s.vuelta(t0);
    const b = await s.vuelta(t0 + 1000);
    const c = await s.vuelta(t0 + 1000 + 3 * 3600 * 1000);
    console.log(JSON.stringify({ a, b, c }));
    process.exit(0);`;
  const r = execFileSync(process.execPath, ['--input-type=module', '-e', codigo], { env: { ...env, ROBIN_DATA_DIR: DATOS2, ROBIN_SEGUIMIENTO_TICK_MS: '1000', ROBIN_NO_DESVELAR: '1' }, encoding: 'utf8' });
  const o = JSON.parse(r.trim().split('\n').at(-1));
  await espera(300);
  const desp = latidos.filter((l) => l.evento === 'despierta').at(-1);
  check('tras una suspensión del equipo sale «despierta» con los minutos dormido', o.a === 'inicio' && o.b === null && o.c === 'despierta' && desp?.suspendido_min >= 179, `${JSON.stringify(o)} · ${desp?.suspendido_min} min`);
}

// ── Apagado: ROBIN_SEGUIMIENTO=off no manda nada ─────────────────────────────────────────────
{
  const antes = latidos.length;
  const DATOS3 = path.join(base, 'datos3'); fs.mkdirSync(DATOS3, { recursive: true });
  fs.writeFileSync(path.join(DATOS3, 'ajustes.json'), JSON.stringify({ carpetas: [EXP] }, null, 2));
  const q = spawn(process.execPath, [fs.existsSync(cli) ? cli : path.join(REPO, 'server/index.js')], { env: { ...env, ROBIN_DATA_DIR: DATOS3, ROBIN_SEGUIMIENTO: 'off' }, stdio: ['pipe', 'pipe', 'pipe'] });
  q.stdout.on('data', () => {}); q.stderr.on('data', () => {});
  await espera(6000);
  await terminar(q);
  check('ROBIN_SEGUIMIENTO=off: ni un latido', latidos.length === antes, `${latidos.length - antes} de más`);
}

srv.close();
try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok === results.length ? 0 : 1);
