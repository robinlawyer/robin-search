// Autenticación con Robin Lawyer vía OAuth 2.1 + PKCE (el MISMO servidor OAuth que usa el
// conector remoto de Claude Desktop). El abogado no pega ningún token: la primera vez que
// usa una herramienta, se abre el navegador, inicia sesión en robinlawyer.ai y autoriza.
//
// Flujo (RFC 8252 — OAuth para apps nativas: loopback 127.0.0.1 + PKCE):
//   1. Dynamic Client Registration (una vez) → client_id público, se guarda en disco.
//   2. Se abre el navegador en /oauth/authorize?code_challenge=… (PKCE S256).
//   3. El usuario hace login + consent en Robin → redirect a http://127.0.0.1:<puerto>/callback?code=…
//   4. Se canjea el code en /oauth/token → access_token + refresh_token.
//   5. Los tokens se guardan en el dir de datos (fichero 0600), se refrescan solos.
//
// Sin sesión válida, las herramientas de búsqueda no devuelven resultados (el motor es local,
// pero el acceso es una función premium de la suscripción a Robin Lawyer).

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

import { escribirJson, leerJson } from '../persistencia.js';
import { config, ensureDataDirs } from '../config.js';
import { log } from '../logger.js';
import { fail } from '../tools/util.js';

const SCOPES = 'mcp:tools mcp:resources';
const CLIENT_NAME = 'RobinSearch (servidor local)';
const RESOURCE = config.oauthIssuer.replace(/\/+$/, '') + '/mcp';
// Puertos loopback candidatos: se registran los 5 en el DCR y en el login se usa el primero
// libre. El servidor OAuth exige coincidencia EXACTA de redirect_uri, por eso son fijos.
const REDIRECT_PORTS = [47820, 47821, 47822, 47823, 47824];
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

const redirectUri = (port) => `http://127.0.0.1:${port}/callback`;

// ---------- base64url + PKCE ---------- //
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function genVerifier() {
  return b64url(crypto.randomBytes(32)); // 43 chars, dentro del rango 43-128 de RFC 7636
}
function challengeFor(verifier) {
  return b64url(crypto.createHash('sha256').update(verifier).digest());
}

// ---------- persistencia del estado de sesión ---------- //
function loadAuth() {
  try {
    return leerJson(config.authStatePath, { bak: false }).valor;
  } catch {
    return null;
  }
}
function saveAuth(a) {
  ensureDataDirs();
  escribirJson(config.authStatePath, a, { indent: 2, mode: 0o600 });
  try {
    fs.chmodSync(config.authStatePath, 0o600);
  } catch {
    /* en Windows chmod es no-op */
  }
}
function clearTokens() {
  const a = loadAuth();
  if (!a) return;
  delete a.access_token;
  delete a.refresh_token;
  delete a.expires_at;
  delete a.user;
  saveAuth(a);
}

// ---------- discovery ---------- //
let _disc = null;
async function discover() {
  if (_disc && !(_disc._convencionHasta < Date.now())) return _disc;
  const issuer = config.oauthIssuer.replace(/\/+$/, '');
  try {
    // Con límite: un proxy de despacho que acepta la conexión y no contesta dejaba colgada
    // cualquier herramienta hasta 5 minutos.
    const r = await fetch(`${issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      _disc = await r.json();
      return _disc;
    }
  } catch {
    /* sin red o respuesta que no es JSON: usamos los endpoints por convención */
  }
  // Los de convención valen 5 minutos: sin red no se espera en cada herramienta, y en cuanto
  // vuelva se usa lo que publique el servidor.
  _disc = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    _convencionHasta: Date.now() + 5 * 60 * 1000,
  };
  return _disc;
}

// ---------- Dynamic Client Registration (una vez) ---------- //
async function ensureClient() {
  let a = loadAuth() || {};
  if (a.client_id && Array.isArray(a.redirect_uris) && a.redirect_uris.length) return a;
  const disc = await discover();
  const redirect_uris = REDIRECT_PORTS.map(redirectUri);
  const r = await fetch(disc.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      scope: SCOPES,
    }),
  });
  if (!r.ok) throw new Error(`registro OAuth falló (HTTP ${r.status})`);
  const data = await r.json();
  a = { ...a, client_id: data.client_id, redirect_uris: data.redirect_uris || redirect_uris };
  saveAuth(a);
  log.info('Cliente OAuth registrado', { client_id: a.client_id });
  return a;
}

// ---------- tokens ---------- //
function normalizeTokens(t, prev = {}) {
  return {
    access_token: t.access_token,
    // el servidor rota el refresh; si no viniera, conservamos el anterior.
    refresh_token: t.refresh_token || prev.refresh_token,
    scope: t.scope || prev.scope,
    expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000,
  };
}

async function exchangeCode(disc, clientId, code, redirect, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirect,
    client_id: clientId,
    code_verifier: verifier,
    resource: RESOURCE,
  });
  const r = await fetch(disc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`canje del código falló (HTTP ${r.status})`);
  return normalizeTokens(await r.json());
}

// Recogida del código por la conexión de SALIDA, en paralelo al callback
// loopback. Motivo: el salto del navegador a 127.0.0.1 lo rompe cualquier
// antivirus/EDR que vigile sockets locales, un proxy sin excepción para
// loopback, o un navegador embebido que no sepa ir a loopback. Medido en el
// primer despacho real: 12 códigos emitidos y 0 recogidos, mientras la salida
// HTTPS de esa misma máquina funcionaba sin un fallo.
//
// Nos identificamos con el code_verifier de PKCE, que solo existe aquí: el
// code_challenge viaja en la URL de autorización (y se imprime en el chat),
// así que no serviría como credencial.
const PICKUP_INTERVAL_MS = 2000;
// Cada consulta de sondeo con su propio límite. Sin él, una conexión que se
// queda colgada —un proxy de despacho que retiene la petición sin contestar—
// paraba el sondeo hasta 5 minutos (el límite por defecto de las cabeceras en
// Node), justo en las redes para las que existe este camino.
const PICKUP_REQUEST_TIMEOUT_MS = Number(process.env.ROBIN_PICKUP_TIMEOUT_MS) || 10000;

function programar(fn, ms) {
  const t = setTimeout(fn, ms);
  if (t.unref) t.unref(); // nunca debe impedir que el proceso MCP cierre
  return t;
}

export function pickupCode(url, clientId, verifier, deadlineMs, signal, { timeoutMs = PICKUP_REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let parado = false;
    const parar = () => {
      parado = true;
      clearTimeout(timer);
    };
    if (signal) signal.addEventListener('abort', parar, { once: true });

    let timer = null;
    const tick = async () => {
      if (parado) return;
      if (Date.now() > deadlineMs) {
        parar();
        reject(new Error('pickup_timeout'));
        return;
      }
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: clientId, code_verifier: verifier }).toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (r.ok) {
          const d = await r.json();
          if (d && d.status === 'ready' && d.code) {
            parar();
            log.info('Código de autorización recogido por la conexión de salida');
            resolve(d.code);
            return;
          }
        }
        // 4xx/5xx o "pending": se reintenta. Un backend antiguo sin este
        // endpoint devuelve 404 y el sondeo simplemente nunca acierta, así
        // que el flujo se comporta exactamente como antes.
      } catch {
        /* sin red momentáneamente: se reintenta */
      }
      if (!parado) timer = programar(tick, PICKUP_INTERVAL_MS);
    };
    timer = programar(tick, PICKUP_INTERVAL_MS);
  });
}

// Una sola renovación a la vez en el proceso: dos herramientas a la vez con el token caducado
// gastaban el mismo refresh_token dos veces y la segunda lo daba por revocado.
let _renovando = null;
function refresh(a) {
  if (!_renovando) _renovando = renovar(a).finally(() => { _renovando = null; });
  return _renovando;
}

async function renovar(a) {
  if (!a?.refresh_token) return null;
  const disc = await discover();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: a.refresh_token,
    client_id: a.client_id,
  });
  let r;
  try {
    r = await fetch(disc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return null; // sin red: no invalidamos la sesión, reintentaremos luego
  }
  if (!r.ok) {
    // Solo un rechazo EXPLÍCITO del refresh cierra la sesión. Un 502 durante un despliegue o un
    // 429 dejaban a todos los abogados sin sesión.
    let error = null;
    try {
      error = (await r.json())?.error ?? null;
    } catch {
      error = null;
    }
    if ((r.status === 400 || r.status === 401) && (error === 'invalid_grant' || error === null)) {
      // La otra instancia pudo rotar el refresh_token un instante antes: si en disco ya hay otro,
      // es la sesión buena y no se borra.
      const actual = loadAuth();
      if (actual?.refresh_token && actual.refresh_token !== a.refresh_token) return actual.access_token ? actual : null;
      clearTokens(); // refresh revocado/expirado → hay que volver a iniciar sesión
    }
    return null;
  }
  let datos;
  try {
    datos = await r.json();
  } catch {
    return null; // un portal cautivo o proxy devolviendo HTML: no es un rechazo
  }
  const merged = { ...a, ...normalizeTokens(datos, a) };
  saveAuth(merged);
  return merged;
}

async function whoami(access) {
  if (!access) return null;
  const disc = await discover();
  try {
    // Con límite: el login espera a esta respuesta para guardar la sesión de
    // una vez, y una red de despacho que se la traga no puede dejarlo colgado.
    const r = await fetch(disc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${access}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Bearer válido SIN disparar login (para el chequeo de updates y el estado). Refresca si toca.
export async function getBearerQuiet() {
  if (config.robinToken) return config.robinToken; // modo IT/headless: token pre-provisionado
  const a = loadAuth();
  if (!a?.access_token) return null;
  if (a.expires_at && a.expires_at > Date.now() + 30_000) return a.access_token;
  const r = await refresh(a);
  return r?.access_token || null;
}

// ---------- navegador + loopback ---------- //
// Orden para abrir el navegador, por plataforma. Exportado para poder probarlo:
// en Windows NO se puede pasar por el shell. `cmd /c start "" <url>` parece
// funcionar y no funciona: Node solo entrecomilla un argumento si contiene
// espacios, así que cmd.exe parte la URL en el primer `&` y el navegador
// recibe solo `?response_type=code` → 422 en el servidor (visto en producción
// el 10-sep-2026 con un abogado en prueba, que no pudo entrar en 40 minutos).
// rundll32 recibe la URL como un único argumento, sin shell que la parta.
export function browserCommand(platform, url) {
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  if (platform === 'win32') return { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  return { cmd: 'xdg-open', args: [url] };
}

function openBrowser(url) {
  // Escotilla para pruebas y para despliegue headless de IT: no abrir nada.
  if (config.noBrowser) {
    log.info('No abro el navegador (ROBIN_NO_BROWSER)', { url });
    return;
  }
  try {
    const { cmd, args } = browserCommand(process.platform, url);
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', (e) => log.warn('No pude abrir el navegador', { err: String(e) }));
    child.unref();
  } catch (e) {
    log.warn('No pude abrir el navegador', { err: String(e) });
  }
}

// Página que ve el abogado en el navegador al terminar el login OAuth. Mismo
// patrón que el resto de mensajes de sistema de RobinLawyer.ai: caja blanca
// centrada con el logotipo DENTRO, arriba. El logo se sirve desde la web (el
// abogado acaba de autenticarse online, así que hay conexión); si fallara, se
// oculta sin romper el diseño.
function htmlPage(titulo, mensaje) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo} — RobinLawyer.ai</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111110;background:#f9f9f8;
    background-image:radial-gradient(ellipse 50% 40% at 85% 15%,rgba(108,92,242,.10),transparent 60%),
      radial-gradient(ellipse 45% 35% at 12% 88%,rgba(108,92,242,.08),transparent 60%);
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;-webkit-font-smoothing:antialiased}
  .card{position:relative;background:#fff;border:1px solid #e2e2df;border-radius:18px;
    box-shadow:0 20px 60px rgba(17,17,16,.08);max-width:460px;width:100%;
    padding:clamp(2rem,5vw,2.6rem) clamp(1.6rem,5vw,2.4rem);text-align:center}
  .card::before{content:"";position:absolute;top:0;left:24px;right:24px;height:3px;
    background:linear-gradient(90deg,transparent,#6c5cf2 30%,#8a7df5 70%,transparent);border-radius:0 0 3px 3px}
  .logo{display:flex;justify-content:center;margin:0 0 1.5rem}
  .logo img{height:44px;width:auto;display:block}
  h1{font-size:1.35rem;font-weight:700;letter-spacing:-.02em;margin:0 0 .5rem;line-height:1.25}
  p{color:#555;font-size:.95rem;line-height:1.55;margin:0}
</style></head><body>
  <div class="card">
    <div class="logo"><img src="https://robinlawyer.ai/assets/robin-logo.png?v=20260722" alt="RobinLawyer.ai" onerror="this.style.display='none'"></div>
    <h1>${titulo}</h1>
    <p>${mensaje}</p>
  </div>
</body></html>`;
}

// Escucha en el primer puerto loopback libre de los registrados.
function listenOnAny(ports) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (i >= ports.length) {
        reject(new Error('no hay ningún puerto loopback libre (47820-47824)'));
        return;
      }
      const port = ports[i++];
      const server = http.createServer();
      server.once('error', () => {
        try {
          server.close();
        } catch {
          /* noop */
        }
        tryNext();
      });
      server.listen(port, '127.0.0.1', () => {
        server.removeAllListeners('error');
        resolve({ server, port });
      });
    };
    tryNext();
  });
}

// Cuando el código lo trae el sondeo, el servidor loopback se deja escuchando
// un rato más: si el navegador acaba llegando (tarde, o por otro camino), ve la
// pantalla de "conexión establecida" en vez de un error de conexión. Y si no
// llega nunca, se cierra solo y libera el puerto.
const GRACIA_CIERRE_MS = 60 * 1000;

function cerrarConGracia(server, codeP, ms = GRACIA_CIERRE_MS) {
  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    try {
      server.close();
    } catch {
      /* noop */
    }
  };
  // Si el callback llega (o vence), awaitCallback ya cierra: esto es el tope.
  codeP.then(cerrar, cerrar);
  const t = setTimeout(cerrar, ms);
  if (t.unref) t.unref();
}

function awaitCallback(server, port, expectedState) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        server.close();
      } catch {
        /* noop */
      }
      reject(new Error('login_timeout'));
    }, CALLBACK_TIMEOUT_MS);
    if (timer.unref) timer.unref();

    server.on('request', (req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      if (!u.pathname.startsWith('/callback')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const err = u.searchParams.get('error');
      const gotState = u.searchParams.get('state');
      const code = u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      const finish = (page, cb) => {
        res.end(page);
        clearTimeout(timer);
        try {
          server.close();
        } catch {
          /* noop */
        }
        cb();
      };
      if (err) {
        finish(htmlPage('Sesión no completada', 'Puedes cerrar esta pestaña e intentarlo de nuevo.'), () =>
          reject(new Error(`authorize_error:${err}`)),
        );
        return;
      }
      if (!code || gotState !== expectedState) {
        // Enlace de un intento anterior. Antes esto abortaba el flujo VIVO
        // (cerraba el servidor y rechazaba con state_mismatch), así que cada
        // reintento con un enlace viejo quemaba el intento bueno y el abogado
        // no podía entrar nunca. Ahora se lo explicamos y seguimos escuchando.
        res.end(
          htmlPage(
            'Este enlace ya no es válido',
            'Corresponde a un intento anterior. Vuelve a Claude, pídele otra vez la búsqueda y abre el enlace NUEVO que te dé.',
          ),
        );
        return;
      }
      finish(
        htmlPage(
          '✓ Conexión establecida con RobinLawyer.ai',
          'Infraestructura de dirección jurídica vinculada correctamente. Ya puedes cerrar esta pestaña de forma segura y regresar a Claude para trabajar sobre tus expedientes.',
        ),
        () => resolve(code),
      );
    });
  });
}

// ---------- flujo de login (idempotente) ---------- //
let _loginPromise = null;
let _lastAuthorizeUrl = null;
// Promesa que se resuelve con el enlace del flujo VIVO en cuanto está
// construido. Sin ella, ensureAuthorized() devolvía `_lastAuthorizeUrl` en el
// mismo tick en que lanza startLogin(): null la primera vez y el enlace del
// flujo ANTERIOR las siguientes — cuyo `state` rechaza el servidor loopback en
// curso, de modo que el login no podía completarse nunca.
let _authorizeUrlPromise = null;
let _publishAuthorizeUrl = null;

function startLogin() {
  if (_loginPromise) return _loginPromise;
  _authorizeUrlPromise = new Promise((resolve) => {
    _publishAuthorizeUrl = resolve;
  });
  _loginPromise = (async () => {
    const disc = await discover();
    const a = await ensureClient();
    const { server, port } = await listenOnAny(a.redirect_uris.map((u) => Number(new URL(u).port)));
    const redirect = redirectUri(port);
    const verifier = genVerifier();
    const state = b64url(crypto.randomBytes(16));
    const authorizeUrl =
      disc.authorization_endpoint +
      '?' +
      new URLSearchParams({
        response_type: 'code',
        client_id: a.client_id,
        redirect_uri: redirect,
        code_challenge: challengeFor(verifier),
        code_challenge_method: 'S256',
        scope: SCOPES,
        state,
        resource: RESOURCE,
      }).toString();
    _lastAuthorizeUrl = authorizeUrl;
    if (_publishAuthorizeUrl) _publishAuthorizeUrl(authorizeUrl);
    log.info('Esperando inicio de sesión en el navegador', { puerto: port });
    // Dos caminos a la vez para el mismo código: el callback loopback de
    // siempre (rápido cuando la red del despacho lo permite) y la recogida por
    // nuestra conexión de salida (funciona aunque el loopback esté cortado).
    // Vale el primero que llegue; si uno falla, el login NO se cae mientras el
    // otro siga vivo.
    const abort = new AbortController();
    const codeP = awaitCallback(server, port, state);
    const pickupUrl =
      disc.robin_code_pickup_endpoint ||
      (disc.issuer || config.oauthIssuer).replace(/\/+$/, '') + '/oauth/pickup';
    const pickP = pickupCode(pickupUrl, a.client_id, verifier, Date.now() + CALLBACK_TIMEOUT_MS, abort.signal);
    openBrowser(authorizeUrl);
    let code;
    try {
      code = await Promise.any([codeP, pickP]);
    } catch (agg) {
      // Promise.any solo rechaza si fallan LOS DOS caminos.
      const causas = (agg && agg.errors) || [];
      throw new Error(causas.map((e) => String(e?.message ?? e)).join(' / ') || 'login_timeout');
    }
    abort.abort(); // detiene el sondeo si ganó el callback
    // Si ganó el sondeo, el servidor loopback sigue escuchando un rato: así,
    // cuando el navegador consiga llegar (o no), no se queda con un error de
    // conexión en la cara.
    cerrarConGracia(server, codeP);
    const tokens = await exchangeCode(disc, a.client_id, code, redirect, verifier);
    // Quién es ANTES de guardar, y una sola escritura. Antes se guardaba la
    // sesión sin usuario, se preguntaba por la red y se volvía a guardar: en
    // ese hueco, quien leyera la sesión la veía «iniciada, sin usuario», y la
    // app de escritorio pintaba «Sesión iniciada con clave de licencia», que
    // es falso. Con red lenta, segundos delante del abogado. (Lo destapó la
    // batería de pruebas corriendo en Linux, más lento que el Mac.)
    const user = await whoami(tokens.access_token);
    const merged = { ...(loadAuth() || {}), ...tokens, updated_at: Date.now() };
    // Y si no se sabe quién es, no se hereda el usuario de una sesión anterior:
    // tras entrar con otra cuenta, enseñaría el correo equivocado.
    if (user) merged.user = user;
    else delete merged.user;
    saveAuth(merged);
    log.info('Sesión de Robin Lawyer iniciada', { usuario: user?.email || null });
    return { ok: true, user };
  })()
    .catch((err) => {
      log.error('Fallo iniciando sesión en Robin Lawyer', { err: String(err) });
      return { ok: false, error: String(err?.message ?? err) };
    })
    .finally(() => {
      _loginPromise = null;
      // Si el flujo murió antes de construir el enlace, desbloqueamos a quien
      // lo esté esperando en vez de dejarlo colgado.
      if (_publishAuthorizeUrl) _publishAuthorizeUrl(_lastAuthorizeUrl);
    });
  return _loginPromise;
}

// Espera, con tope, a que el flujo en curso publique su enlace de login. El
// tope existe para no dejar la llamada MCP colgada si la red va mal: en ese
// caso devolvemos lo último que tengamos (o null, y la tool le dice al abogado
// que lo pida otra vez en unos segundos).
function awaitAuthorizeUrl(timeoutMs = 6000) {
  if (!_authorizeUrlPromise) return Promise.resolve(_lastAuthorizeUrl);
  const pending = _authorizeUrlPromise;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v || null);
    };
    const t = setTimeout(() => finish(_lastAuthorizeUrl), timeoutMs);
    if (t.unref) t.unref();
    pending.then(
      (u) => {
        clearTimeout(t);
        finish(u);
      },
      () => {
        clearTimeout(t);
        finish(_lastAuthorizeUrl);
      },
    );
  });
}

// Gate para las herramientas: devuelve { ok, bearer } o { ok:false, loginUrl } y dispara el
// login en segundo plano si no hay sesión.
export async function ensureAuthorized() {
  if (config.robinToken) return { ok: true, bearer: config.robinToken, mode: 'token' };
  const bearer = await getBearerQuiet();
  if (bearer) {
    const a = loadAuth();
    return { ok: true, bearer, mode: 'oauth', user: a?.user || null };
  }
  startLogin(); // no bloquea la llamada MCP; el usuario completa el login en el navegador
  const loginUrl = await awaitAuthorizeUrl();
  return { ok: false, loginUrl };
}

// Respuesta MCP amable cuando falta sesión.
export function authPromptResult(loginUrl) {
  const enlace = loginUrl
    ? ` Si no se abrió sola, abre este enlace: ${loginUrl}`
    : ' Si no se abrió sola, vuelve a pedírmelo en unos segundos y te doy el enlace.';
  return fail(
    'Necesitas iniciar sesión en Robin Lawyer para buscar en tus expedientes. He abierto una ' +
      'pestaña en tu navegador para que inicies sesión con tu cuenta de Robin.' +
      enlace +
      ' Cuando termines, repite la búsqueda.',
    { requiere_login: true },
  );
}

// Estado de sesión para estado_servidor (silencioso, sin disparar login).
export async function authStatus() {
  if (config.robinToken) return { autenticado: true, modo: 'token', usuario: null };
  const bearer = await getBearerQuiet();
  if (!bearer) return { autenticado: false, modo: null, usuario: null };
  const a = loadAuth();
  return { autenticado: true, modo: 'oauth', usuario: a?.user?.email || a?.user?.name || null };
}

// Login interactivo bloqueante para el CLI (`robin-search login`). Imprime a stdout.
export async function loginInteractive() {
  process.stdout.write('Abriendo el navegador para iniciar sesión en Robin Lawyer…\n');
  const res = await startLogin();
  if (_lastAuthorizeUrl) process.stdout.write(`Si no se abrió, entra aquí:\n  ${_lastAuthorizeUrl}\n`);
  if (res.ok) {
    const a = loadAuth();
    process.stdout.write(`✓ Sesión iniciada como ${a?.user?.email || a?.user?.name || 'usuario de Robin'}.\n`);
    return true;
  }
  process.stderr.write(`✗ No se pudo iniciar sesión: ${res.error || 'error desconocido'}\n`);
  return false;
}

// Cierra la sesión: revoca el token en el servidor y borra las credenciales locales.
export async function logout() {
  const a = loadAuth();
  if (a?.access_token) {
    try {
      const disc = await discover();
      await fetch(disc.revocation_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: a.access_token, client_id: a.client_id }),
      });
    } catch {
      /* si falla la revocación remota, borramos igual las credenciales locales */
    }
  }
  clearTokens();
  return true;
}

export default { ensureAuthorized, authPromptResult, authStatus, getBearerQuiet, loginInteractive, logout };
