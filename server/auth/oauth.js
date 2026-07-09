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

import { config, ensureDataDirs } from '../config.js';
import { log } from '../logger.js';
import { fail } from '../tools/util.js';

const SCOPES = 'mcp:tools mcp:resources';
const CLIENT_NAME = 'Robin Search (servidor local)';
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
    return JSON.parse(fs.readFileSync(config.authStatePath, 'utf8'));
  } catch {
    return null;
  }
}
function saveAuth(a) {
  ensureDataDirs();
  const tmp = config.authStatePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(a, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, config.authStatePath);
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
  if (_disc) return _disc;
  const issuer = config.oauthIssuer.replace(/\/+$/, '');
  try {
    const r = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
    if (r.ok) {
      _disc = await r.json();
      return _disc;
    }
  } catch {
    /* sin red: usamos los endpoints por convención */
  }
  _disc = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
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

async function refresh(a) {
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
    });
  } catch {
    return null; // sin red: no invalidamos la sesión, reintentaremos luego
  }
  if (!r.ok) {
    clearTokens(); // refresh revocado/expirado → hay que volver a iniciar sesión
    return null;
  }
  const merged = { ...a, ...normalizeTokens(await r.json(), a) };
  saveAuth(merged);
  return merged;
}

async function whoami(access) {
  if (!access) return null;
  const disc = await discover();
  try {
    const r = await fetch(disc.userinfo_endpoint, { headers: { Authorization: `Bearer ${access}` } });
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
function openBrowser(url) {
  try {
    let cmd, args;
    if (process.platform === 'darwin') {
      cmd = 'open';
      args = [url];
    } else if (process.platform === 'win32') {
      cmd = 'cmd';
      args = ['/c', 'start', '', url];
    } else {
      cmd = 'xdg-open';
      args = [url];
    }
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', (e) => log.warn('No pude abrir el navegador', { err: String(e) }));
    child.unref();
  } catch (e) {
    log.warn('No pude abrir el navegador', { err: String(e) });
  }
}

function htmlPage(titulo, mensaje) {
  return `<!doctype html><meta charset="utf-8"><title>${titulo}</title>
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:18vh auto;text-align:center;color:#1a1a1a">
<h1 style="font-size:1.4rem">${titulo}</h1><p style="color:#555">${mensaje}</p></div>`;
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
        finish(htmlPage('Error de seguridad', 'La respuesta no coincide con la petición. Cierra esta pestaña e inténtalo de nuevo.'), () =>
          reject(new Error('state_mismatch')),
        );
        return;
      }
      finish(
        htmlPage('✓ Sesión iniciada en Robin Lawyer', 'Ya puedes volver a Claude y seguir trabajando. Esta pestaña se puede cerrar.'),
        () => resolve(code),
      );
    });
  });
}

// ---------- flujo de login (idempotente) ---------- //
let _loginPromise = null;
let _lastAuthorizeUrl = null;

function startLogin() {
  if (_loginPromise) return _loginPromise;
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
    log.info('Esperando inicio de sesión en el navegador', { puerto: port });
    const codeP = awaitCallback(server, port, state);
    openBrowser(authorizeUrl);
    const code = await codeP;
    const tokens = await exchangeCode(disc, a.client_id, code, redirect, verifier);
    const merged = { ...(loadAuth() || {}), ...tokens, updated_at: Date.now() };
    saveAuth(merged);
    const user = await whoami(tokens.access_token);
    if (user) {
      merged.user = user;
      saveAuth(merged);
    }
    log.info('Sesión de Robin Lawyer iniciada', { usuario: user?.email || null });
    return { ok: true, user };
  })()
    .catch((err) => {
      log.error('Fallo iniciando sesión en Robin Lawyer', { err: String(err) });
      return { ok: false, error: String(err?.message ?? err) };
    })
    .finally(() => {
      _loginPromise = null;
    });
  return _loginPromise;
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
  return { ok: false, loginUrl: _lastAuthorizeUrl };
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
