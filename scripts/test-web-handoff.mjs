// ESCENARIO (Juan, 6-oct-2026): en RobinDesktop pulsó «Iniciar sesión» en
// «Licencias y facturación», el login acabó en Safari —entra con Google, y
// Google no deja iniciar sesión dentro de una app de escritorio— y el panel de
// la app siguió pidiendo entrar: la cookie de la web se quedó en Safari.
//
// El servidor añade ahora a la vuelta al puerto local un secreto de un solo uso
// (`robin_web`) con el que RobinDesktop pide la sesión de la web para su panel.
// De este lado hace falta una cosa: recogerlo de esa vuelta y dárselo a la app.
//
// Lo que se ata:
//   · con ROBIN_WEB_HANDOFF=1 (lo pone RobinDesktop) sale `ROBIN_WEB_HANDOFF <secreto>`;
//   · sin esa variable NO se imprime: un secreto no va a la terminal de quien
//     lanza el login a mano;
//   · el secreto NO se guarda en auth.json;
//   · si el código llegó antes por el sondeo (/oauth/pickup), se espera a la
//     vuelta local un momento y el secreto llega igual.
//
// Contra un emisor OAuth de pega en 127.0.0.1: sin red y sin navegador.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res, rej) => { http.get(url, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej); });

const SECRETO = 'Secreto_de_un_solo_uso_0123456789abcdefABCDEF';

// El emisor: `pickupListo` decide si /oauth/pickup entrega ya el código.
let pickupListo = false;
const issuer = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const ISS = `http://127.0.0.1:${issuer.address().port}`;
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/.well-known/oauth-authorization-server') {
    return json({ issuer: ISS, authorization_endpoint: `${ISS}/oauth/authorize`, token_endpoint: `${ISS}/oauth/token`, registration_endpoint: `${ISS}/oauth/register`, userinfo_endpoint: `${ISS}/oauth/userinfo`, revocation_endpoint: `${ISS}/oauth/revoke`, robin_code_pickup_endpoint: `${ISS}/oauth/pickup` });
  }
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    if (u.pathname === '/oauth/register') { const b = JSON.parse(body || '{}'); return json({ client_id: 'cli_pega_web', redirect_uris: b.redirect_uris }); }
    if (u.pathname === '/oauth/pickup') return json(pickupListo ? { status: 'ready', code: 'CODIGO_SONDEO' } : { status: 'pending' });
    if (u.pathname === '/oauth/token') return json({ access_token: 'jat_pega', refresh_token: 'rt_pega', expires_in: 3600, scope: 'mcp:tools' });
    if (u.pathname === '/oauth/userinfo') return json({ email: 'letrado@despacho.test' });
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => issuer.listen(0, '127.0.0.1', r));

async function login({ pideWeb, sondeoGana }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-web-handoff-'));
  const datos = path.join(base, 'datos');
  const env = {
    ...process.env,
    ROBIN_OAUTH_ISSUER: `http://127.0.0.1:${issuer.address().port}`,
    ROBIN_NO_BROWSER: '1',
    ROBIN_DATA_DIR: datos,
    ROBIN_LOG_LEVEL: 'error',
  };
  delete env.ROBIN_TOKEN;
  if (pideWeb) env.ROBIN_WEB_HANDOFF = '1'; else delete env.ROBIN_WEB_HANDOFF;
  pickupListo = false;

  const cli = spawn(process.execPath, [path.join(REPO, 'cli/index.js'), 'login', `--data-dir=${datos}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = ''; let enlace = null;
  cli.stdout.on('data', (d) => {
    salida += d.toString();
    const m = /^ROBIN_LOGIN_URL\s+(\S+)$/m.exec(salida);
    if (m && !enlace) enlace = m[1];
  });
  for (let i = 0; i < 100 && !enlace; i++) await espera(100);
  if (!enlace) { try { cli.kill(); } catch { /* */ } return { salida, auth: null, fin: null }; }
  const q = new URL(enlace).searchParams;
  const vuelta = `${q.get('redirect_uri')}?code=CODIGO_BUENO&state=${encodeURIComponent(q.get('state'))}&robin_web=${SECRETO}`;
  if (sondeoGana) {
    // El servidor deja el código para el sondeo ANTES de contestar al
    // navegador: el sondeo puede ganar y la vuelta local llega después.
    pickupListo = true;
    await espera(2600);
    await get(vuelta).catch(() => null);
  } else {
    await get(vuelta);
  }
  const fin = await new Promise((r) => { cli.on('exit', (c) => r(c)); setTimeout(() => r(null), 20000); });
  let auth = null;
  try { auth = fs.readFileSync(path.join(datos, 'auth.json'), 'utf8'); } catch { /* sin sesión */ }
  try { cli.kill(); } catch { /* ya murió */ }
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  return { salida, auth, fin };
}

{
  const r = await login({ pideWeb: true, sondeoGana: false });
  check('con ROBIN_WEB_HANDOFF=1 el login termina bien', r.fin === 0, `salida=${r.fin}`);
  check('y publica el secreto de la vuelta local para la app', new RegExp(`^ROBIN_WEB_HANDOFF ${SECRETO}$`, 'm').test(r.salida), r.salida.slice(-200));
  check('el secreto NO se guarda en auth.json', Boolean(r.auth) && !r.auth.includes(SECRETO));
}
{
  const r = await login({ pideWeb: false, sondeoGana: false });
  check('sin la variable (login a mano) el login termina bien', r.fin === 0, `salida=${r.fin}`);
  check('y el secreto NO se imprime en la terminal', !r.salida.includes(SECRETO) && !/ROBIN_WEB_HANDOFF/.test(r.salida));
}
{
  const r = await login({ pideWeb: true, sondeoGana: true });
  check('si gana el sondeo, el login termina bien', r.fin === 0, `salida=${r.fin}`);
  check('y el secreto llega igual: se espera a la vuelta local', new RegExp(`^ROBIN_WEB_HANDOFF ${SECRETO}$`, 'm').test(r.salida), r.salida.slice(-200));
}

issuer.close();
const fallos = results.filter((r) => !r).length;
console.log(`\n${results.length - fallos}/${results.length} comprobaciones OK`);
process.exit(fallos ? 1 : 0);
