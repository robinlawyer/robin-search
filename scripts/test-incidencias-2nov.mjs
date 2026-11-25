// ESCENARIO (Juan, 2-nov-2026, equipo Windows con Claude de la Tienda): se añade una carpeta madre
// en RobinDesktop con Claude abierto y no se indexa nada hasta reiniciar Claude. Claude arranca
// varias instancias del servidor (cuatro en diez segundos en ese equipo) y solo una escribe en el
// índice: si el canal de la app lo servía otra, la que indexa no se enteraba del cambio. Y si el
// canal no estaba disponible, la app escribía ajustes.json y nadie lo volvía a leer.
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import crypto from 'node:crypto';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(Boolean(c)); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const terminar = (p) => (p.exitCode !== null || p.signalCode !== null ? Promise.resolve() : new Promise((r) => { p.once('exit', r); p.kill(); setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 15000).unref(); }));

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-2nov-'));
const DATOS = path.join(base, 'datos');
const ZETA = path.join(base, 'Z', 'Expedientes'); const TRABAJO = path.join(base, 'C', 'Trabajo'); const OTRA = path.join(base, 'C', 'Otra');
const crear = (raiz, caso, n) => { const d = path.join(raiz, caso); fs.mkdirSync(d, { recursive: true }); for (let i = 1; i <= n; i++) fs.writeFileSync(path.join(d, `escrito ${i}.txt`), `Documento ${i} del caso ${caso}. Contrato de arrendamiento y reclamación de cantidad.`); };
crear(ZETA, '5603 Caso', 3); crear(TRABAJO, '4452 Nercellas', 4); crear(OTRA, '5611 Caso', 2);
fs.mkdirSync(DATOS, { recursive: true });
fs.writeFileSync(path.join(DATOS, 'ajustes.json'), JSON.stringify({ carpetas: [ZETA] }, null, 2));

const env = { ...process.env, ROBIN_DATA_DIR: DATOS, ROBIN_TOKEN: 'ROBIN-PRUEBA-2nov', ROBIN_OCR: 'false', ROBIN_LOG_LEVEL: 'info',
  ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no', ROBIN_OAUTH_ISSUER: 'http://127.0.0.1:9', ROBIN_REPASO_CANAL_MS: '500' };
const lanzar = () => { const p = spawn(process.execPath, [path.join(REPO, 'server/index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] }); p.stdout.on('data', () => {}); p.stderr.on('data', () => {}); return p; };

const huella = crypto.createHash('sha256').update(DATOS).digest('hex').slice(0, 8);
const CANAL = process.platform === 'win32' ? `\\\\.\\pipe\\robinsearch-${huella}` : path.join('/tmp', `robinsearch-${huella}.sock`);
const conectar = () => new Promise((res) => {
  const s = net.connect(CANAL); let buf = ''; const msgs = [];
  s.setEncoding('utf8');
  s.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) { try { msgs.push(JSON.parse(l)); } catch {} } } });
  s.once('connect', () => res({ s, msgs, cerrado: () => s.destroyed }));
  s.once('error', () => res(null));
  s.on('close', () => s.destroy());
});
const conectarVivo = async (ms = 30000) => { const fin = Date.now() + ms; while (Date.now() < fin) { const c = await conectar(); if (c) return c; await espera(150); } return null; };
const manifiesto = () => { try { return Object.values(JSON.parse(fs.readFileSync(path.join(DATOS, 'files.json'), 'utf8'))); } catch { return []; } };
const docsDe = (raiz) => manifiesto().filter((e) => String(e.rutaRelativa || '').startsWith(`${raiz}/`)).length;
const hasta = async (fn, ms = 60000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await fn()) return true; await espera(200); } return false; };
const lock = () => { try { return JSON.parse(fs.readFileSync(path.join(DATOS, 'escritor.lock'), 'utf8')); } catch { return null; } };

const a = lanzar();
check('la primera instancia indexa la carpeta de Z:', await hasta(() => docsDe('Expedientes') === 3), `${docsDe('Expedientes')} documentos`);
const b = lanzar();
await espera(2500);
const dueno = lock()?.pid;
check('solo una instancia escribe', dueno === a.pid, `dueño ${dueno}, primera ${a.pid}`);

// 1. La app, sin canal (o antes de engancharse), deja escrito el fichero con Claude abierto.
fs.writeFileSync(path.join(DATOS, 'ajustes.json'), JSON.stringify({ carpetas: [ZETA, TRABAJO] }, null, 2));
check('una carpeta escrita en ajustes.json con Claude abierto se indexa sin reiniciar nada',
  await hasta(() => docsDe('Trabajo') === 4, 15000), `${docsDe('Trabajo')} de 4 documentos`);

// 2. El canal lo tiene quien escribe aunque se lo hubiera quedado otra instancia.
await terminar(a);
check('al morir la que escribe, otra toma el índice', await hasta(() => lock()?.pid === b.pid, 15000));
const c = lanzar();
await espera(1500);
const app = await conectarVivo();
check('la app encuentra el canal', Boolean(app));
if (app) {
  await hasta(() => app.msgs.some((m) => m.tipo === 'estado'), 5000);
  const r = app.msgs.find((m) => m.tipo === 'estado');
  check('el servidor dice desde qué carpeta corre', typeof r?.dirExtension === 'string' && fs.existsSync(path.join(r.dirExtension, 'server', 'index.js')), r?.dirExtension);
  check('y qué tiene en cola', Array.isArray(r?.enCola), JSON.stringify(r?.enCola));
  // 3. Orden en caliente: tiene que llegar a la instancia que indexa, sea quien sea la que atiende.
  app.s.write(`${JSON.stringify({ cmd: 'configurar', carpetas: [TRABAJO, OTRA] })}\n`);
  check('carpeta añadida en caliente: se indexa', await hasta(() => docsDe('Otra') === 2, 60000), `${docsDe('Otra')} de 2 documentos`);
  check('carpeta quitada en caliente: sale del índice', await hasta(() => docsDe('Expedientes') === 0, 60000), `${docsDe('Expedientes')} documentos`);
  app.s.destroy();
}
await Promise.all([terminar(b), terminar(c)]);
await espera(200);

// 4. Una instancia que solo busca no se queda el canal: el progreso solo lo sabe la que escribe.
// El cerrojo es de otro proceso vivo (este), así que la instancia nueva arranca como lectora.
const LOCK = path.join(DATOS, 'escritor.lock');
const renovar = () => { const t = new Date(); try { fs.utimesSync(LOCK, t, t); } catch {} };
fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, token: 'de-otra-instancia', version: '1.12.2', desde: new Date().toISOString() }));
const vivo = setInterval(renovar, 300);
const lectora = lanzar();
const abierto = async () => { const k = await conectar(); if (k) k.s.destroy(); return Boolean(k); };
await espera(1500);
check('la instancia que solo busca no retiene el canal', await hasta(async () => !(await abierto()), 15000));
clearInterval(vivo);
fs.rmSync(LOCK, { force: true });
check('y al quedarse con el índice, lo abre', await hasta(abierto, 20000));
await terminar(lectora);
await espera(200);
fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const bien = results.filter(Boolean).length;
console.log(`\n${bien}/${results.length} comprobaciones superadas`);
process.exit(bien === results.length ? 0 : 1);
