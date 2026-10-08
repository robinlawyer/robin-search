// ESCENARIO (Pedro, 8-oct-2026): un antivirus que revisa HTTPS —o el proxy del despacho— pone su
// propio certificado y lo da de alta en Windows. El navegador entra; RobinSearch, con la lista de
// Node, no. Su sesión caducó, vivió 14 días de lo guardado y luego pedía autorizar enlaces que no
// podían terminar nunca.
//
// Aquí el «antivirus» es un servidor de Robin falso por HTTPS con un certificado que Node no
// conoce, y el «almacén de Windows» es ROBIN_PRUEBA_CA_SISTEMA. Cada caso corre en un proceso
// aparte: los certificados por defecto son de todo el proceso.
import { spawn } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const FIX = path.join(REPO, 'scripts', 'fixtures', 'antivirus');
const CA = path.join(FIX, 'certificado.pem');
const DIA = 24 * 3600 * 1000;
const rol = process.argv[2];

// ---------------------------------------------------------------- procesos hijo
if (rol) {
  const salida = (o) => { process.stdout.write('RESULTADO ' + JSON.stringify(o) + '\n'); process.exit(0); };
  const url = process.env.URL_PRUEBA;
  if (rol === 'fetch-sin-modulo' || rol === 'fetch-con-modulo') {
    let estado = null;
    if (rol === 'fetch-con-modulo') {
      estado = (await import(pathToFileURL(path.join(REPO, 'server/certificados-sistema.js')).href)).certificadosSistema;
    }
    const tls = await import('node:tls');
    let f, h;
    try { const r = await fetch(url + 'ping'); f = await r.text(); } catch (e) { f = 'ERROR ' + (e.cause?.code || e.message); }
    h = await new Promise((res) => https.get(url + 'ping', (r) => res(r.statusCode)).on('error', (e) => res('ERROR ' + e.code)));
    salida({ estado, fetch: f, https: h, por_defecto: tls.getCACertificates('default').length, de_node: tls.getCACertificates('bundled').length });
  }
  if (rol === 'login') {
    // El arranque real: primero los certificados (como cli/index.js), luego la sesión.
    await import(pathToFileURL(path.join(REPO, 'server/certificados-sistema.js')).href);
    const { ensureAuthorized, authPromptResult } = await import(pathToFileURL(path.join(REPO, 'server/auth/oauth.js')).href);
    const r = await ensureAuthorized();
    const texto = r.ok ? null : authPromptResult(r.loginUrl, r).content?.[0]?.text;
    const guardada = JSON.parse(fs.readFileSync(path.join(process.env.ROBIN_DATA_DIR, 'auth.json'), 'utf8'));
    salida({ ok: r.ok, mode: r.mode, sin_conexion: !!r.sin_conexion, causa: r.error_red?.codigo || null, loginUrl: r.loginUrl ?? null, texto, access: guardada.access_token });
  }
  process.exit(2);
}

// ---------------------------------------------------------------- orquestador
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-certificados-'));

let renovaciones = 0;
const srv = https.createServer({ key: fs.readFileSync(path.join(FIX, 'clave.pem')), cert: fs.readFileSync(CA) }, (req, res) => {
  if (req.url.startsWith('/oauth/token')) {
    renovaciones += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: 'nuevo', refresh_token: 'llave-2', expires_in: 86400 }));
    return;
  }
  if (req.url === '/ping') { res.end('pong'); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL_PRUEBA = `https://127.0.0.1:${srv.address().port}/`;

function hijo(rolHijo, envExtra = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, URL_PRUEBA, ROBIN_LOG_LEVEL: 'error', ...envExtra };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), rolHijo], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('exit', () => {
      const linea = out.split('\n').find((l) => l.startsWith('RESULTADO '));
      resolve(linea ? JSON.parse(linea.slice(10)) : { fallo: (err || out).slice(-400) });
    });
  });
}

// 1. Sin el arreglo, Node no confía en el certificado del «antivirus» (lo que le pasaba a Pedro).
let r = await hijo('fetch-sin-modulo', { ROBIN_PRUEBA_CA_SISTEMA: CA });
check('sin el arreglo, fetch falla con el certificado del antivirus', /^ERROR .*(SELF_SIGNED|ISSUER|VERIFY)/.test(r.fetch), r.fetch);

// 2. Con el certificado en el «almacén del sistema», fetch y https entran.
r = await hijo('fetch-con-modulo', { ROBIN_PRUEBA_CA_SISTEMA: CA });
check('el arreglo se aplica', r.estado?.aplicado === true, JSON.stringify(r.estado));
check('fetch entra', r.fetch === 'pong', r.fetch);
check('https entra', r.https === 200, String(r.https));
check('no se pierde ningún certificado de Node (solo se suman)', r.por_defecto === r.de_node + 1, `${r.por_defecto} = ${r.de_node} + 1`);

// 3. Se puede desactivar.
r = await hijo('fetch-con-modulo', { ROBIN_PRUEBA_CA_SISTEMA: CA, ROBIN_SIN_CERTIFICADOS_SISTEMA: '1' });
check('ROBIN_SIN_CERTIFICADOS_SISTEMA=1 lo desactiva', r.estado?.motivo === 'desactivado' && /^ERROR/.test(r.fetch), JSON.stringify(r.estado));

// 4. Con el almacén REAL de este equipo no rompe nada (y no confía en el antivirus de mentira).
r = await hijo('fetch-con-modulo', { ROBIN_PRUEBA_CA_SISTEMA: undefined });
check('con el almacén real del sistema arranca sin error', r.estado && r.estado.motivo !== 'error', JSON.stringify(r.estado));
check('y un certificado que el sistema no conoce sigue sin valer', /^ERROR/.test(r.fetch), r.fetch);

// 5. El caso de Pedro entero: sesión caducada hace 15 días sin poder renovar.
const sesion = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ client_id: 'c', access_token: 'viejo', refresh_token: 'llave-1', expires_at: Date.now() - 15 * DIA, user: { email: 'abogado@example.com' } }));
  return { ROBIN_DATA_DIR: dir, ROBIN_OAUTH_ISSUER: URL_PRUEBA.replace(/\/$/, ''), ROBIN_NO_BROWSER: '1', ROBIN_TOKEN: undefined };
};
renovaciones = 0;
r = await hijo('login', { ...sesion(path.join(base, 'sin')), ROBIN_PRUEBA_CA_SISTEMA: undefined });
check('15 días sin poder conectar → NO da un enlace de login', !r.ok && r.sin_conexion && r.loginUrl === null, JSON.stringify({ ok: r.ok, sin_conexion: r.sin_conexion, loginUrl: r.loginUrl, fallo: r.fallo }));
check('dice la causa: el certificado', /certificado/.test(r.texto || '') && /(SELF_SIGNED|ISSUER|VERIFY)/.test(r.causa || ''), r.causa);
check('y que no hace falta volver a iniciar sesión', /NO hace falta volver a iniciar sesión/.test(r.texto || ''));
check('el servidor no recibió nada (como en producción)', renovaciones === 0, String(renovaciones));

r = await hijo('login', { ...sesion(path.join(base, 'con')), ROBIN_PRUEBA_CA_SISTEMA: CA });
check('con el arreglo, la misma sesión se renueva sola, sin entrar', r.ok && r.mode === 'oauth' && r.access === 'nuevo', JSON.stringify({ ok: r.ok, mode: r.mode, access: r.access, fallo: r.fallo }));
check('el servidor recibió la renovación', renovaciones === 1, String(renovaciones));

srv.close();
fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok === results.length ? 0 : 1);
