// ESCENARIOS (informes del equipo de Eduardo, macOS x64, Claude con Electron 44, 1.12.2):
//
// 1. 16-oct-2026 07:22 UTC — «excepcion · write EPIPE · Caídas seguidas: 6». Claude cerró el
//    servidor («Server transport closed (intentional shutdown)») y el proceso siguió escribiendo en
//    la tubería ya cerrada. Sin oyente de 'error' en stdout/stderr, cada EPIPE era una excepción no
//    capturada; registrarla (por stderr) daba otra: 210 en diez segundos, marca «excepcion»,
//    informe y caída contada. Tiene que ser un cierre ordenado: salir en silencio, sin informe.
//
// 2. 18-oct-2026 07:22 UTC — «sin_conexion_otro_proceso: el proceso node24:node no conecta desde
//    2026-10-17T07:18:54Z: 23 The operation was aborted due to timeout». En el servidor: esa
//    petición nunca llegó a nginx, el mismo proceso descargó el feed 4 s después y pidió su
//    certificado (200) el 18 a las 07:53 y renovó (200) el 18 a las 15:29. Era UN fallo pasajero
//    de hacía 24 h que nada borraba (el éxito del certificado no se apuntaba), contado como «no
//    conecta desde hace un día»; y «23» es el código numérico de DOMException, no la causa.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (n, c, d = '') => {
  results.push(c);
  console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-16oct-'));
const MADRE = path.join(base, 'Expedientes');
fs.mkdirSync(path.join(MADRE, 'Caso'), { recursive: true });
fs.writeFileSync(path.join(MADRE, 'Caso', 'nota.txt'), 'Nota de prueba sobre un arrendamiento.');

// Un «servidor de Robin» local que recoge los avisos técnicos que llegarían a producción.
const avisos = [];
const robin = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    try { avisos.push(JSON.parse(b)); } catch { avisos.push({ crudo: b }); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"id":"x"}');
  });
});
await new Promise((r) => robin.listen(0, '127.0.0.1', r));
const URL_AVISOS = `http://127.0.0.1:${robin.address().port}/robinsearch/diagnostico`;

function servidor(datos, extraEnv = {}) {
  const env = {
    ...process.env, ROBIN_TOKEN: 't', ROBIN_FOLDERS: MADRE, ROBIN_DATA_DIR: datos, ROBIN_OCR: 'false',
    ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no', ROBIN_DIAGNOSTICO_URL: URL_AVISOS, ...extraEnv,
  };
  const c = spawn(process.execPath, [path.join(REPO, 'server/index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let err = '';
  const w = new Map();
  let id = 1;
  c.stderr.on('data', (d) => (err += d.toString()));
  c.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!l) continue;
      let m;
      try { m = JSON.parse(l); } catch { continue; }
      const f = w.get(m.id);
      if (f) { w.delete(m.id); f(m); }
    }
  });
  const enviar = (method, params, conId = true) => {
    const msg = conId ? { jsonrpc: '2.0', id: id++, method, params } : { jsonrpc: '2.0', method, params };
    try { c.stdin.write(`${JSON.stringify(msg)}\n`); } catch { /* cerrado */ }
    return msg.id;
  };
  const rpc = (method, params) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${method}`)), 120000);
    const i = enviar(method, params);
    w.set(i, (m) => { clearTimeout(t); res(m); });
  });
  const fin = new Promise((r) => c.on('exit', (code, signal) => r({ code, signal })));
  return { proc: c, rpc, enviar, fin, stderr: () => err };
}
async function saludar(s) {
  await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } });
  s.enviar('notifications/initialized', {}, false);
}
async function esperarArranque(s, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await s.rpc('tools/call', { name: 'estado_servidor', arguments: {} });
    let d = null;
    try { d = JSON.parse(r.result?.content?.[0]?.text || 'null'); } catch { d = null; }
    if (d && d.estado !== 'indexando' && d.ultimo_indexado) return d;
    await espera(500);
  }
  return null;
}
const registro = (datos) => {
  const dir = path.join(datos, 'logs');
  try {
    return fs.readdirSync(dir).filter((f) => f.startsWith('robin-search.log')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  } catch {
    return '';
  }
};
const marcas = (datos) => { try { return fs.readdirSync(datos).filter((f) => /^en_curso-/.test(f)); } catch { return []; } };
const estadoDiag = (datos) => { try { return JSON.parse(fs.readFileSync(path.join(datos, 'diagnostico.json'), 'utf8')); } catch { return {}; } };
const conTope = (p, ms) => Promise.race([p, espera(ms).then(() => ({ tope: true }))]);

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n1. Claude cierra las tuberías con el servidor en marcha (EPIPE)\n');
{
  const datos = path.join(base, 'datos-epipe');
  const s = servidor(datos);
  await saludar(s);
  const arr = await esperarArranque(s);
  check('1.0 el servidor arranca e indexa', Boolean(arr), arr ? '' : s.stderr().slice(-400));
  avisos.length = 0;
  // Claude se va: cierra su extremo de stdout y stderr. Mientras, llega una petición que el
  // servidor contesta por la tubería ya rota (lo que pasa con una petición en vuelo).
  s.proc.stdout.destroy();
  s.proc.stderr.destroy();
  await espera(200);
  s.enviar('tools/list', {});
  s.enviar('tools/call', { name: 'estado_servidor', arguments: {} });
  const fin = await conTope(s.fin, 15000);
  check('1.1 el proceso termina solo (no se queda colgado ni en bucle)', !fin.tope, JSON.stringify(fin));
  check('1.2 y termina BIEN (código 0), como un cierre ordenado', fin.code === 0, JSON.stringify(fin));
  if (fin.tope) { s.proc.kill('SIGKILL'); await s.fin; }
  const reg = registro(datos);
  const nExc = (reg.match(/Excepción no capturada/g) || []).length;
  check('1.3 ninguna «Excepción no capturada» en el registro', nExc === 0, `${nExc}`);
  check('1.4 el registro dice «Cierre ordenado» por la salida cerrada', /Cierre ordenado[^\n]*salida_cerrada/.test(reg));
  check('1.5 no queda marca de fase (no es una caída para el siguiente arranque)', marcas(datos).length === 0, marcas(datos).join(','));
  await espera(1500);
  check('1.6 no se manda ningún aviso técnico', avisos.length === 0, JSON.stringify(avisos.map((a) => [a.motivo, a.causa])));

  // El siguiente arranque no ve ninguna caída.
  const s2 = servidor(datos);
  await saludar(s2);
  const arr2 = await esperarArranque(s2);
  await espera(1500);
  check('1.7 el siguiente arranque arranca', Boolean(arr2));
  check('1.8 y no avisa de ninguna caída ni excepción', !avisos.some((a) => /excepcion|caida/.test(a.motivo || '')), JSON.stringify(avisos.map((a) => a.motivo)));
  check('1.9 ni cuenta caídas seguidas', !estadoDiag(datos).caidasSeguidas, JSON.stringify(estadoDiag(datos).caidasSeguidas));
  s2.proc.stdin.end();
  await conTope(s2.fin, 10000);
}

console.log('\n2. Claude cierra stdout y LUEGO stdin (orden de «intentional shutdown»)\n');
{
  const datos = path.join(base, 'datos-orden');
  const s = servidor(datos);
  await saludar(s);
  await esperarArranque(s);
  avisos.length = 0;
  s.proc.stdout.destroy();
  s.enviar('tools/list', {});
  await espera(50);
  s.proc.stdin.end();
  const fin = await conTope(s.fin, 15000);
  await espera(1500);
  check('2.1 sale con código 0', fin.code === 0, JSON.stringify(fin));
  check('2.2 sin marca, sin excepción y sin aviso', marcas(datos).length === 0 && !/Excepción no capturada/.test(registro(datos)) && avisos.length === 0,
    JSON.stringify({ m: marcas(datos), a: avisos.map((a) => a.motivo) }));
}

console.log('\n3. Una excepción DE VERDAD se sigue avisando (también con código EPIPE si stdio está sano)\n');
for (const [n, valor] of [['3.1', '1'], ['3.2', 'EPIPE']]) {
  const datos = path.join(base, `datos-exc-${valor}`);
  avisos.length = 0;
  const s = servidor(datos, { ROBIN_PRUEBA_EXCEPCION: valor });
  await saludar(s);
  const fin = await conTope(s.fin, 120000);
  if (fin.tope) { s.proc.kill('SIGKILL'); await s.fin; }
  await espera(500);
  const reg = registro(datos);
  const nExc = (reg.match(/Excepción no capturada/g) || []).length;
  check(`${n} excepción ${valor === 'EPIPE' ? 'con código EPIPE y stdio sano' : 'normal'}: sale con código 1, se registra UNA vez y se avisa`,
    fin.code === 1 && nExc === 1 && avisos.some((a) => a.motivo === 'excepcion'),
    JSON.stringify({ fin, nExc, avisos: avisos.map((a) => a.motivo) }));
}

console.log('\n4. tuberias.js: qué cuenta como tubería cerrada\n');
{
  const t = await import(`${pathToFileURL(path.join(REPO, 'server/tuberias.js')).href}?u=1`);
  check('4.1 EPIPE, ERR_STREAM_DESTROYED → tubería cerrada', t.esTuberiaCerrada({ code: 'EPIPE' }) && t.esTuberiaCerrada({ code: 'ERR_STREAM_DESTROYED' }));
  check('4.2 un error cualquiera no', !t.esTuberiaCerrada(new Error('x')) && !t.esTuberiaCerrada(null));
  const out = new EventEmitter();
  const err = new EventEmitter();
  let avisado = 0;
  t.instalarOyentesStdio({ stdout: out, stderr: err });
  t.alCerrarseLaSalida(() => avisado++);
  err.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  check('4.3 stderr roto: se deja de escribir en él, pero NO se cierra el servidor', t.stderrCerradoYa() && !t.stdoutCerradoYa() && avisado === 0);
  out.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  out.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  check('4.4 stdout roto: se avisa UNA vez para el cierre ordenado', t.stdoutCerradoYa() && avisado === 1, String(avisado));
  let tarde = 0;
  t.alCerrarseLaSalida(() => tarde++);
  await espera(10);
  check('4.5 quien se apunta después también se entera', tarde === 1);
}

console.log('\n5. «Otro proceso no conecta»: solo con fallos de verdad, no con uno pasajero\n');
{
  const o = await import(pathToFileURL(path.join(REPO, 'server/auth/oauth.js')).href);
  const H = 3600 * 1000;
  const ahora = Date.parse('2026-10-18T07:22:15Z');
  // Lo que había en conexion.json el 18-oct en el equipo de Eduardo.
  const eduardo = {
    'electron44:claude helper (plugin)': { ultimo_ok: '2026-10-18T07:22:14Z', version: '1.12.2' },
    'node24:node': { ultimo_error: { codigo: '23', detalle: 'The operation was aborted due to timeout', en: '2026-10-17T07:18:54.542Z' }, fallando_desde: '2026-10-17T07:18:54.542Z', version: '1.12.2' },
  };
  check('5.1 el caso de Eduardo (UN fallo pasajero hace 24 h) NO es «no conecta»',
    o.otroProcesoSinConexion(eduardo, 'electron44:claude helper (plugin)', ahora) === null);
  const pedro = {
    'node24:node': { ultimo_error: { codigo: 'ETIMEDOUT', detalle: 'connect', en: new Date(ahora - 2 * H).toISOString() }, fallando_desde: new Date(ahora - 50 * H).toISOString(), fallos: 9, version: '1.12.2', lanzador: 'claude' },
  };
  const causa = o.otroProcesoSinConexion(pedro, 'electron44:claude helper (plugin)', ahora);
  check('5.2 un proceso que lleva DOS días fallando en cada intento sí se avisa', Boolean(causa), String(causa));
  check('5.3 y el aviso dice cuántos intentos y quién lanzó el proceso', /9 intentos/.test(causa || '') && /lanzado por claude/.test(causa || ''), String(causa));
  const viejo = { 'node24:node': { ...pedro['node24:node'], ultimo_error: { ...pedro['node24:node'].ultimo_error, en: new Date(ahora - 4 * 24 * H).toISOString() } } };
  check('5.4 uno que dejó de intentarlo hace días no se avisa', o.otroProcesoSinConexion(viejo, 'yo', ahora) === null);
  const conOk = { 'node24:node': { ...pedro['node24:node'], ultimo_ok: new Date(ahora - H).toISOString() } };
  check('5.5 si después del último fallo conectó, no se avisa', o.otroProcesoSinConexion(conOk, 'yo', ahora) === null);

  // El código de un tiempo agotado: «TimeoutError», no el 23 de DOMException.
  let e = null;
  try { await fetch('http://10.255.255.1:81/', { signal: AbortSignal.timeout(50) }); } catch (x) { e = x; }
  check('5.6 tiempo agotado → código «TimeoutError» (no «23»)', o.codigoErrorRed(e) === 'TimeoutError', o.codigoErrorRed(e));
  check('5.7 los códigos de red de texto se conservan', o.codigoErrorRed(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })) === 'ENOTFOUND');
}

console.log('\n6. Un éxito de CUALQUIER petición a Robin borra el «fallando desde» de este proceso\n');
{
  // Servidor OAuth falso: /licencia contesta; el token no.
  const datos = path.join(base, 'datos-conexion');
  fs.mkdirSync(datos, { recursive: true });
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/api/v1/robinsearch/licencia')) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const issuer = `http://127.0.0.1:${srv.address().port}`;
  const yo = `${process.versions.electron ? `electron${process.versions.electron.split('.')[0]}` : `node${process.versions.node.split('.')[0]}`}:${path.basename(process.execPath).toLowerCase()}`;
  fs.writeFileSync(path.join(datos, 'conexion.json'), JSON.stringify({ [yo]: { fallando_desde: '2026-10-17T07:18:54.542Z', ultimo_error: { codigo: '23', en: '2026-10-17T07:18:54.542Z' }, fallos: 1 } }));
  const hijo = spawn(process.execPath, ['--input-type=module', '-e', `
    const o = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'server/auth/oauth.js')).href)});
    await o.renovarCertificado('bearer-de-prueba');
    console.log(JSON.stringify(o.leerConexion()));
  `], { env: { ...process.env, ROBIN_DATA_DIR: datos, ROBIN_OAUTH_ISSUER: issuer, ROBIN_DIAGNOSTICO_URL: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  hijo.stdout.on('data', (d) => (out += d));
  hijo.stderr.on('data', (d) => (out += d));
  await new Promise((r) => hijo.on('exit', r));
  srv.close();
  let c = {};
  try { c = JSON.parse(fs.readFileSync(path.join(datos, 'conexion.json'), 'utf8')); } catch { c = {}; }
  check('6.1 el servidor contestó (aunque sea 404) → ya no «fallando desde»', c[yo] && !c[yo].fallando_desde && c[yo].ultimo_ok && !c[yo].fallos, JSON.stringify(c[yo]) + out.slice(-300));
}

robin.close();
try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* nada */ }
const fallos = results.filter((x) => !x).length;
console.log(`\n${results.length - fallos}/${results.length} comprobaciones OK`);
process.exit(fallos ? 1 : 0);
