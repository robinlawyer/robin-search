// ESCENARIO (Juan, 23-sep-2026): RobinDesktop enseña licencias, guía, manual y
// catálogo DENTRO de la app, trayendo las páginas del área privada. Su panel
// tiene su propio almacén de cookies, como cualquier navegador, así que una
// sesión iniciada en el navegador del sistema no le sirve de nada: el abogado
// entraba y la app le seguía pidiendo entrar.
//
// La solución es que el login pase DENTRO de la app. Para eso hace falta una
// sola cosa de este lado: que `robin-search login` PUBLIQUE el enlace de
// autorización en cuanto lo tiene —no al final—, para que la app lo abra en una
// ventana suya, con la partición del panel. Con ROBIN_NO_BROWSER=1 no se abre
// nada aquí: manda quien lanzó el login.
//
// Lo que se ata:
//   · la línea `ROBIN_LOGIN_URL <url>` sale ANTES de que nadie complete nada;
//   · el enlace es el del flujo VIVO (su `state` es el que acepta el loopback);
//   · publicar antes no rompe el login: al volver el código, la sesión se guarda.
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

let canjes = 0;
const issuer = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const ISS = `http://127.0.0.1:${issuer.address().port}`;
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/.well-known/oauth-authorization-server') {
    return json({ issuer: ISS, authorization_endpoint: `${ISS}/oauth/authorize`, token_endpoint: `${ISS}/oauth/token`, registration_endpoint: `${ISS}/oauth/register`, userinfo_endpoint: `${ISS}/oauth/userinfo`, revocation_endpoint: `${ISS}/oauth/revoke` });
  }
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    if (u.pathname === '/oauth/register') { const b = JSON.parse(body || '{}'); return json({ client_id: 'cli_pega_app', redirect_uris: b.redirect_uris }); }
    if (u.pathname === '/oauth/token') { canjes++; return json({ access_token: 'jat_pega', refresh_token: 'rt_pega', expires_in: 3600, scope: 'mcp:tools' }); }
    if (u.pathname === '/oauth/userinfo') return json({ email: 'letrado@despacho.test' });
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => issuer.listen(0, '127.0.0.1', r));

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-login-app-'));
const datos = path.join(base, 'datos');
const env = {
  ...process.env,
  ROBIN_OAUTH_ISSUER: `http://127.0.0.1:${issuer.address().port}`,
  ROBIN_NO_BROWSER: '1',            // el navegador lo abre la APP, no el CLI
  ROBIN_DATA_DIR: datos,
  ROBIN_LOG_LEVEL: 'error',
};
delete env.ROBIN_TOKEN;

const t0 = Date.now();
const cli = spawn(process.execPath, [path.join(REPO, 'cli/index.js'), 'login', `--data-dir=${datos}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let salida = ''; let err = ''; let enlace = null; let msEnlace = null;
cli.stdout.on('data', (d) => {
  salida += d.toString();
  const m = /^ROBIN_LOGIN_URL\s+(\S+)$/m.exec(salida);
  if (m && !enlace) { enlace = m[1]; msEnlace = Date.now() - t0; }
});
cli.stderr.on('data', (d) => { err += d.toString(); });

for (let i = 0; i < 100 && !enlace; i++) await espera(100);
check('el login publica el enlace de autorización nada más tenerlo', Boolean(enlace), enlace ? `${msEnlace} ms` : salida.slice(-200));
check('y lo publica ANTES de que nadie haya completado nada', canjes === 0, `canjes=${canjes}`);

if (enlace) {
  const q = new URL(enlace).searchParams;
  const redirect = q.get('redirect_uri'); const state = q.get('state');
  check('el enlace es de este emisor, con PKCE S256 y su state',
    enlace.startsWith(env.ROBIN_OAUTH_ISSUER) && q.get('code_challenge_method') === 'S256' && Boolean(state));
  check('y vuelve al bucle local, que es lo que la ventana de la app tiene que dejar pasar',
    /^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(redirect || ''), redirect || '');

  // La app abriría el enlace en una ventana suya; aquí se simula la vuelta.
  const vuelta = await get(`${redirect}?code=CODIGO_BUENO&state=${encodeURIComponent(state)}`);
  check('la pantalla de vuelta es la de «conexión establecida»', vuelta.status === 200 && /Conexión establecida/i.test(vuelta.body));

  const fin = await new Promise((r) => { cli.on('exit', (c) => r(c)); setTimeout(() => r(null), 20000); });
  check('publicar el enlace antes NO rompe el login: termina bien', fin === 0, `salida=${fin} ${err.slice(-200)}`);
  const auth = JSON.parse(fs.readFileSync(path.join(datos, 'auth.json'), 'utf8'));
  check('la sesión queda guardada, con su usuario', Boolean(auth.access_token) && auth.user?.email === 'letrado@despacho.test', String(auth.user?.email));
  check('y el enlace se canjeó una sola vez', canjes === 1, `canjes=${canjes}`);
}

try { cli.kill(); } catch { /* ya murió */ }
issuer.close();
fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const fallos = results.filter((r) => !r).length;
console.log(`\n${results.length - fallos}/${results.length} comprobaciones OK`);
process.exit(fallos ? 1 : 0);
