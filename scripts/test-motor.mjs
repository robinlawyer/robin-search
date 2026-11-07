// MOTOR AUTOACTUALIZABLE (1.13.0, 7-nov-2026): una versión publicada llega sola al equipo, sin que
// el abogado pulse nada ni confirme el cuadro de Claude — y solo si su huella coincide. Aquí un
// servidor local publica la «99.0.0» (un motor de prueba que se identifica como tal) y se
// comprueba que RobinSearch la baja, la verifica, la instala y pasa a usarla sin cortar a Claude;
// y que con la huella mal no se instala nada.
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http'; import crypto from 'node:crypto';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const AdmZip = createRequire(path.join(REPO, 'package.json'))('adm-zip');
const results = []; const check = (n, c, d = '') => { results.push(Boolean(c)); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-motor-'));

// El motor «99.0.0»: contesta al protocolo MCP diciendo quién es.
const MOTOR = `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; }
  if (m.id === undefined) return;
  const result = m.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'robin-search', version: '99.0.0' } }
    : m.method === 'tools/list' ? { tools: [] } : { content: [{ type: 'text', text: JSON.stringify({ motor: '99.0.0' }) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n'); });
rl.on('close', () => process.exit(0));
`;
const zip = new AdmZip();
zip.addFile('package.json', Buffer.from(JSON.stringify({ name: '@robinlawyer/robin-search', version: '99.0.0', type: 'module', robinSupervisor: 1 })));
zip.addFile('server/index.js', Buffer.from(MOTOR));
zip.addFile('manifest.json', Buffer.from('{}'));
const paquete = zip.toBuffer();
const huella = crypto.createHash('sha256').update(paquete).digest('hex');

let feed = {};
let bajadas = 0;
const srv = http.createServer((q, r) => {
  if (q.url === '/feed.json') { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(feed)); }
  if (q.url === '/p.mcpb') { bajadas += 1; r.writeHead(200, { 'content-length': paquete.length }); return r.end(paquete); }
  r.writeHead(404); r.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const P = srv.address().port;

function claude(datos, carpeta) {
  const env = { ...process.env, ROBIN_TOKEN: 't', ROBIN_DATA_DIR: datos, ROBIN_FOLDERS: carpeta, ROBIN_OCR: 'false', ROBIN_DIAGNOSTICO_URL: 'off',
    ROBIN_OAUTH_ISSUER: 'http://127.0.0.1:9', ROBIN_UPDATE_URL: `http://127.0.0.1:${P}/feed.json`, ROBIN_MOTOR_PERMITIR_LOCAL: '1' };
  delete env.ROBIN_SIN_SUPERVISOR;
  const c = spawn(process.execPath, [path.join(REPO, 'cli/index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const w = new Map(); let id = 1; const s = { c };
  c.stderr.on('data', () => {});
  c.stdout.on('data', (d) => { buf += d.toString(); let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue;
      let m; try { m = JSON.parse(l); } catch { continue; } const f = w.get(m.id); if (f) { w.delete(m.id); f(m); } } });
  s.rpc = (method, params) => new Promise((res, rej) => { const i = id++; const t = setTimeout(() => rej(new Error(`timeout ${method}`)), 60000);
    w.set(i, (m) => { clearTimeout(t); res(m); }); c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`); });
  s.cerrar = () => new Promise((r) => { if (c.exitCode !== null) return r(); c.once('exit', r); c.stdin.end(); setTimeout(() => c.kill('SIGKILL'), 15000).unref(); });
  return s;
}

// ─── 1. Huella equivocada: no se instala nada ─────────────────────────────────────────────────
{
  feed = { version: '99.0.0', url: `http://127.0.0.1:${P}/p.mcpb`, sha256: 'a'.repeat(64) };
  const datos = path.join(base, 'd1'); const carpeta = path.join(base, 'e1'); fs.mkdirSync(carpeta, { recursive: true });
  const s = claude(datos, carpeta);
  const ini = await s.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  s.c.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  for (let i = 0; i < 40 && !bajadas; i++) await espera(250);
  await espera(1500);
  check('con la huella equivocada se baja pero NO se instala', bajadas >= 1 && !fs.existsSync(path.join(datos, 'motor', '99.0.0')), `bajadas=${bajadas}`);
  check('y no queda nada a medio bajar', !fs.readdirSync(path.join(datos, 'motor')).some((n) => n.includes('99.0.0')), fs.readdirSync(path.join(datos, 'motor')).join(','));
  check('se sigue con el motor de la extensión', ini.result?.serverInfo?.version !== '99.0.0');
  await s.cerrar();
}

// ─── 2. Huella buena: se instala sola y Claude pasa a hablar con ella sin cortarse ─────────────
{
  feed = { version: '99.0.0', url: `http://127.0.0.1:${P}/p.mcpb`, sha256: huella };
  const datos = path.join(base, 'd2'); const carpeta = path.join(base, 'e2'); fs.mkdirSync(carpeta, { recursive: true });
  const s = claude(datos, carpeta);
  const ini = await s.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  s.c.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  await s.rpc('tools/list', {});
  check('arranca con el motor de la extensión', ini.result?.serverInfo?.version && ini.result.serverInfo.version !== '99.0.0', ini.result?.serverInfo?.version);
  let r = null;
  for (let i = 0; i < 120; i++) {
    r = await s.rpc('tools/call', { name: 'estado_servidor', arguments: {} });
    if ((r.result?.content?.[0]?.text || '').includes('"motor":"99.0.0"')) break;
    await espera(500);
  }
  check('la versión publicada se instala sola y pasa a atender a Claude', (r?.result?.content?.[0]?.text || '').includes('"motor":"99.0.0"'), (r?.result?.content?.[0]?.text || JSON.stringify(r)).slice(0, 100));
  const ficha = JSON.parse(fs.readFileSync(path.join(datos, 'motor', '99.0.0', 'robin-motor.json'), 'utf8'));
  check('queda instalada con su huella anotada', ficha.sha256 === huella && ficha.version === '99.0.0');
  check('sin restos de la bajada', !fs.readdirSync(path.join(datos, 'motor')).some((n) => /parcial|instalando|\.lock$/.test(n)), fs.readdirSync(path.join(datos, 'motor')).join(','));
  check('Claude no vio caer el servidor (mismo proceso)', s.c.exitCode === null);
  await s.cerrar();
}

srv.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} OK`);
fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 });
process.exit(ok === results.length ? 0 : 1);
