// Autenticación con RobinLawyer.ai vía OAuth 2.1 + PKCE (el MISMO servidor OAuth que usa el
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
// Desde la 1.12.0 (Juan, 8-oct-2026, caso Pedro) lo que decide si RobinSearch se puede usar es el
// CERTIFICADO DE LICENCIA firmado que se guarda en este ordenador (auth/licencia.js), no la sesión:
// las herramientas son 100 % locales y siguen funcionando sin red mientras el certificado (o su
// gracia) valga. La sesión se mantiene viva sola —al arrancar y cada 24 h, por la conexión de
// salida, sin navegador ni puertos—, su llave de renovación vive en el llavero del sistema
// (auth/llavero-sesion.js) y se gasta bajo un cerrojo entre procesos (auth/cerrojo.js). Cuando de
// verdad hay que volver a autorizar, el chat da un CÓDIGO para robinlawyer.ai/conectar (RFC 8628),
// válido desde cualquier navegador, también el del móvil.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { escribirJson, leerJson } from '../persistencia.js';
import { config, ensureDataDirs, VERSION } from '../config.js';
import { log } from '../logger.js';
import { fail } from '../tools/util.js';
import * as licencia from './licencia.js';
import { conCerrojo } from './cerrojo.js';
import { guardarLlave, leerLlave, borrarLlave, motorSesion } from './llavero-sesion.js';

// Quién llama, en TODAS las peticiones a Robin: sin esto el servidor solo veía «node» y no podía
// decir qué versión tenía un abogado (caso Pedro) ni aplicar una versión mínima.
export function cabeceras(extra = {}) {
  const e = process.versions.electron ? `; electron ${process.versions.electron}` : '';
  return {
    'User-Agent': `RobinSearch/${VERSION} (node ${process.versions.node}; ${process.platform}${e})`,
    'X-RobinSearch-Version': VERSION,
    ...extra,
  };
}
const GRANT_DISPOSITIVO = 'urn:ietf:params:oauth:grant-type:device_code';

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
  if (a.refresh_en === 'llavero' && a.client_id) borrarLlave(a.client_id).catch(() => {});
  delete a.access_token;
  delete a.refresh_token;
  delete a.refresh_en;
  delete a.renovable;
  delete a.expires_at;
  delete a.user;
  saveAuth(a);
}

// ¿Hay llave de renovación (en el fichero o en el llavero)?
const tieneLlave = (a) => Boolean(a?.refresh_token || a?.refresh_en === 'llavero');

// Con un servidor de pruebas (127.0.0.1) nunca se toca el llavero real del abogado.
function usaLlavero() {
  if (process.env.ROBIN_SESION_LLAVERO) return process.env.ROBIN_SESION_LLAVERO !== 'fichero';
  return !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(config.oauthIssuer);
}

// La sesión con su llave de renovación, venga de donde venga.
async function conLlave(a) {
  if (!a || a.refresh_token || a.refresh_en !== 'llavero' || !a.client_id) return a;
  const r = await leerLlave(a.client_id);
  return r ? { ...a, refresh_token: r } : { ...a, _llave_ilegible: true };
}

// Guarda la sesión: la llave de renovación al llavero (si se puede), el resto a auth.json.
async function guardarSesion(a) {
  const { refresh_token, _llave_ilegible, ...resto } = a;
  void _llave_ilegible;
  if (refresh_token && usaLlavero() && (await guardarLlave(a.client_id, refresh_token))) {
    saveAuth({ ...resto, refresh_en: 'llavero', renovable: true });
    return;
  }
  const out = { ...resto, renovable: Boolean(refresh_token) };
  if (refresh_token) {
    out.refresh_token = refresh_token;
    out.refresh_en = 'fichero';
  } else delete out.refresh_en;
  saveAuth(out);
}

// Lo último que se sabe de la conexión con Robin, POR PROCESO (el que lanza Claude y el que lanza
// RobinDesktop no salen igual a internet: caso Pedro). Solo códigos técnicos.
const rutaConexion = () => path.join(config.dataDir, 'conexion.json');
export function claveProceso() {
  const motor = process.versions.electron ? `electron${process.versions.electron.split('.')[0]}` : `node${process.versions.node.split('.')[0]}`;
  return `${motor}:${path.basename(process.execPath).toLowerCase()}`;
}
export function leerConexion() {
  try {
    return JSON.parse(fs.readFileSync(rutaConexion(), 'utf8')) || {};
  } catch {
    return {};
  }
}
function apuntarConexion(ok, error = null) {
  try {
    ensureDataDirs();
    const c = leerConexion();
    const k = claveProceso();
    const p = c[k] || {};
    const ahora = new Date().toISOString();
    if (ok) {
      p.ultimo_ok = ahora;
    } else {
      p.ultimo_error = { ...(error || {}), en: ahora };
      if (!p.fallando_desde || (p.ultimo_ok && p.ultimo_ok > p.fallando_desde)) p.fallando_desde = ahora;
    }
    if (ok) delete p.fallando_desde;
    p.version = VERSION;
    c[k] = p;
    fs.writeFileSync(rutaConexion(), JSON.stringify(c, null, 2));
  } catch {
    /* sin disco: no es imprescindible */
  }
}

// ---------- discovery ---------- //
let _disc = null;
async function discover() {
  if (_disc && !(_disc._convencionHasta < Date.now())) return _disc;
  const issuer = config.oauthIssuer.replace(/\/+$/, '');
  try {
    // Con límite: un proxy de despacho que acepta la conexión y no contesta dejaba colgada
    // cualquier herramienta hasta 5 minutos.
    const r = await fetch(`${issuer}/.well-known/oauth-authorization-server`, { headers: cabeceras(), signal: AbortSignal.timeout(8000) });
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
    headers: cabeceras({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token', GRANT_DISPOSITIVO],
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
    headers: cabeceras({ 'Content-Type': 'application/x-www-form-urlencoded' }),
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
          headers: cabeceras({ 'Content-Type': 'application/x-www-form-urlencoded' }),
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
// Y entre PROCESOS, un cerrojo de fichero (auth/cerrojo.js): con rotación, dos instancias con la
// misma llave a la vez era la forma más rápida de quedarse sin sesión.
let _renovando = null;
function refresh(a) {
  if (!_renovando) _renovando = conCerrojo('sesion', () => renovar(a)).finally(() => { _renovando = null; });
  return _renovando;
}

// Sin conexión (portátil de vacaciones, AVE, red caída, servidor de Robin sin responder) la sesión
// no se puede renovar, pero buscar en los expedientes es 100 % local: se permite durante
// DIAS_SIN_CONEXION desde que caducó el último token válido. Al volver la conexión se renueva sola
// (la llave de renovación dura 90 días y se alarga con cada uso) y nadie tiene que volver a entrar.
// Solo un rechazo explícito del servidor (sesión revocada o caducada) exige iniciar sesión.
export const DIAS_SIN_CONEXION = Number(process.env.ROBIN_DIAS_SIN_CONEXION) || 14;
let _ultimaRenovacion = null; // 'ok' | 'sin_conexion' | 'rechazada'
// Por qué no se pudo hablar con Robin la última vez (código técnico, nunca contenido): lo que
// distingue un antivirus que revisa HTTPS (certificado) de un corte de red o de un servidor caído.
let _ultimoErrorRed = null;
export function ultimoErrorRed() {
  return _ultimoErrorRed;
}
function apuntarErrorRed(e) {
  const c = e?.cause;
  _ultimoErrorRed = {
    codigo: String(c?.code || e?.code || e?.name || 'desconocido').slice(0, 60),
    detalle: String(c?.message || e?.message || '').slice(0, 160),
    en: new Date().toISOString(),
  };
  apuntarConexion(false, { codigo: _ultimoErrorRed.codigo, detalle: _ultimoErrorRed.detalle });
}
// La versión mínima que exige el servidor, si esta ya no llega (HTTP 426).
let _versionMinima = null;
export function versionMinimaExigida() {
  return _versionMinima;
}
const ERRORES_CERTIFICADO = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_UNTRUSTED', 'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_SIGNATURE_FAILURE',
]);

async function renovar(a) {
  const r = await intentarRenovar(a);
  if (r) {
    _ultimaRenovacion = 'ok';
    apuntarConexion(true);
  } else if (_ultimaRenovacion !== 'rechazada' && _ultimaRenovacion !== 'version') _ultimaRenovacion = 'sin_conexion';
  return r;
}

// ¿Otra instancia acaba de renovar? (Claude Desktop y Claude Code, la sonda que Claude arranca y
// mata, el CLI de RobinDesktop.) Bajo el cerrojo se mira el disco: si hay una llave de acceso
// distinta y vigente, es la buena y no se gasta nada.
function renovadaPorOtra(a) {
  const disco = loadAuth();
  if (disco?.access_token && disco.access_token !== a?.access_token && (disco.expires_at || 0) > Date.now() + 60_000) return disco;
  // Hasta la 1.11 la llave de renovación iba en el fichero: si la del disco ya no es la nuestra, es
  // que otra (quizá una versión anterior) rotó.
  if (disco?.refresh_token && a?.refresh_token && disco.refresh_token !== a.refresh_token) return { ...disco, _rotada: true };
  return null;
}

async function intentarRenovar(aEntrada) {
  _ultimaRenovacion = null;
  const otra = renovadaPorOtra(aEntrada);
  if (otra && !otra._rotada) return otra;
  // Siempre con la llave que hay AHORA (disco y llavero), no con la que se leyó hace diez minutos.
  const a = await conLlave(otra || loadAuth() || aEntrada);
  if (!a?.refresh_token) {
    if (a?._llave_ilegible) _ultimoErrorRed = { codigo: 'LLAVERO_ILEGIBLE', detalle: motorSesion(), en: new Date().toISOString() };
    return null;
  }
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
      headers: cabeceras({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body,
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    apuntarErrorRed(e);
    return null; // sin red: no invalidamos la sesión, reintentaremos luego
  }
  if (r.status === 426) {
    try { _versionMinima = (await r.json())?.version_minima || 'desconocida'; } catch { _versionMinima = 'desconocida'; }
    _ultimaRenovacion = 'version';
    return null; // la sesión no se borra: con la versión nueva se renueva sin volver a entrar
  }
  if (!r.ok) {
    if (r.status >= 500 || r.status === 429) _ultimoErrorRed = { codigo: `HTTP_${r.status}`, detalle: '', en: new Date().toISOString() };
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
      let actual = loadAuth();
      if (actual?.access_token && actual.access_token !== a.access_token && (actual.expires_at || 0) > Date.now()) return actual;
      if (actual?.refresh_token && actual.refresh_token !== a.refresh_token) return actual.access_token ? actual : null;
      // Y pudo rotarlo un instante DESPUÉS de mirar (las dos instancias salieron con la misma
      // llave y esta perdió la carrera): se espera un poco y se vuelve a mirar antes de cerrarle
      // la sesión a nadie. Cerrarla de más es lo que le pasó a Eduardo el 19-sep-2026 —de
      // autenticado a no autenticado sin tocar nada, con dos instancias compitiendo.
      await new Promise((res) => setTimeout(res, 1500));
      actual = loadAuth();
      if (actual?.access_token && actual.access_token !== a.access_token && (actual.expires_at || 0) > Date.now()) return actual;
      if (actual?.refresh_token && actual.refresh_token !== a.refresh_token) return actual.access_token ? actual : null;
      _ultimaRenovacion = 'rechazada';
      clearTokens(); // refresh revocado/expirado → hay que volver a iniciar sesión
      // Rechazo EXPLÍCITO (equipo desconectado desde /devices, llave reutilizada, tope de 12 meses):
      // el certificado de licencia de este equipo deja de valer en el acto.
      licencia.borrar();
      log.warn('El servidor rechazó la llave de renovación: hay que volver a conectar', { error });
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
  await guardarSesion(merged);
  return merged;
}

async function whoami(access) {
  if (!access) return null;
  const disc = await discover();
  try {
    // Con límite: el login espera a esta respuesta para guardar la sesión de
    // una vez, y una red de despacho que se la traga no puede dejarlo colgado.
    const r = await fetch(disc.userinfo_endpoint, {
      headers: cabeceras({ Authorization: `Bearer ${access}` }),
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
// Lo que se espera a la vuelta local, cuando el código llegó antes por el sondeo.
const ESPERA_WEB_MS = 4000;

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

// `alWeb`: el secreto de un solo uso que el servidor añade a ESTA vuelta
// (`robin_web`) para que RobinDesktop deje también la sesión de la web dentro
// de su panel (Juan, 6-oct-2026). Solo llega por aquí —nunca por /oauth/pickup—,
// así que solo lo ve este ordenador.
function awaitCallback(server, port, expectedState, alWeb = () => {}) {
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
            'Corresponde a un intento anterior. Vuelve a pedir el inicio de sesión donde lo empezaste —RobinDesktop o Claude— y abre el enlace NUEVO que te dé.',
          ),
        );
        return;
      }
      finish(
        htmlPage(
          '✓ Conexión establecida con RobinLawyer.ai',
          // 🔴 21-sep-2026 (Juan): esta pantalla daba por hecho que se venía de Claude
          // («…y regresar a Claude para trabajar sobre tus expedientes»). La sesión se
          // inicia también desde RobinDesktop, así que se dice lo único que es cierto en
          // los dos casos: que ya se puede cerrar la pestaña.
          'Infraestructura de dirección jurídica vinculada correctamente. Ya puedes cerrar esta pestaña de forma segura.',
        ),
        () => {
          const web = u.searchParams.get('robin_web');
          if (web) alWeb(web);
          resolve(code);
        },
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
    let alWeb = () => {};
    const webP = new Promise((r) => { alWeb = r; });
    const codeP = awaitCallback(server, port, state, (w) => alWeb(w));
    const pickupUrl =
      disc.robin_code_pickup_endpoint ||
      (disc.issuer || config.oauthIssuer).replace(/\/+$/, '') + '/oauth/pickup';
    const pickP = pickupCode(pickupUrl, a.client_id, verifier, Date.now() + CALLBACK_TIMEOUT_MS, abort.signal);
    // Si algo falla ANTES de llegar a Promise.any (abrir el navegador), estas dos promesas
    // rechazarían minutos después sin nadie que las recoja: eso tumba el proceso.
    codeP.catch(() => {});
    pickP.catch(() => {});
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
    await guardarSesion(merged);
    _ultimaRenovacion = 'ok';
    apuntarConexion(true);
    await renovarCertificado(tokens.access_token);
    log.info('Sesión de RobinLawyer.ai iniciada', { usuario: user?.email || null });
    // RobinDesktop (ROBIN_WEB_HANDOFF=1) quiere además el secreto de la web. Si
    // ganó el sondeo, la vuelta local del navegador puede llegar un instante
    // después: se la espera un poco. NO se guarda en auth.json (es de un solo
    // uso y no le sirve a nadie más).
    let web = null;
    if (process.env.ROBIN_WEB_HANDOFF === '1') {
      web = await Promise.race([webP, new Promise((r) => { const t = setTimeout(() => r(null), ESPERA_WEB_MS); if (t.unref) t.unref(); })]);
    }
    return { ok: true, user, web };
  })()
    .catch((err) => {
      log.error('Fallo iniciando sesión en RobinLawyer.ai', { err: String(err) });
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

// ---------- certificado de licencia ---------- //
// Lo pide al iniciar sesión, en cada renovación y como mucho una vez al día. Un servidor sin
// certificados (antiguo, o sin clave) devuelve 404/503: se sigue como hasta la 1.11.
export async function renovarCertificado(bearer) {
  if (!bearer) return null;
  const url = `${config.oauthIssuer.replace(/\/+$/, '')}/api/v1/robinsearch/licencia`;
  try {
    const r = await fetch(url, { headers: cabeceras({ Authorization: `Bearer ${bearer}` }), signal: AbortSignal.timeout(8000) });
    if (r.status === 426) {
      try { _versionMinima = (await r.json())?.version_minima || 'desconocida'; } catch { _versionMinima = 'desconocida'; }
      return null;
    }
    if (!r.ok) return null;
    const d = await r.json();
    const datos = licencia.guardar(d?.certificado);
    if (datos) log.info('Certificado de licencia renovado', { estado: datos.estado, valido_hasta: datos.valido_hasta });
    return datos;
  } catch (e) {
    apuntarErrorRed(e);
    return null;
  }
}

// ---------- mantener la sesión viva sin RobinDesktop ---------- //
// Juan, 8-oct-2026: «un abogado que solo abre Claude, sin abrir nunca RobinDesktop, debe poder
// trabajar con RobinSearch durante meses». Al arrancar y cada 24 h: si a la llave de acceso le quedan
// menos de 12 h, se renueva (por la conexión de salida, sin navegador ni puertos); y si toca, se
// renueva el certificado. Sin red no pasa nada: se reintenta en la siguiente vuelta.
const MARGEN_RENOVAR_MS = 12 * 3600 * 1000;
let _manteniendo = null;
export function mantenerSesion() {
  if (config.robinToken) return Promise.resolve(null);
  if (!_manteniendo) {
    _manteniendo = (async () => {
      const a = loadAuth();
      if (!a?.access_token && !tieneLlave(a)) return null;
      let bearer = a.access_token && (a.expires_at || 0) > Date.now() + MARGEN_RENOVAR_MS ? a.access_token : null;
      if (!bearer && tieneLlave(a)) bearer = (await refresh(a))?.access_token || null;
      if (bearer && licencia.tocaRenovar()) await renovarCertificado(bearer);
      if (bearer) avisarSiOtroProcesoNoConecta();
      // Y de paso, si hay versión nueva (para avisar en el chat aunque Claude lleve días abierto).
      import('../update.js').then((m) => m.checkForUpdate()).catch(() => {});
      return bearer;
    })()
      .catch((e) => {
        log.warn('No se pudo mantener la sesión', { err: String(e?.message ?? e) });
        return null;
      })
      .finally(() => { _manteniendo = null; });
  }
  return _manteniendo;
}

let _mantenimiento = null;
export function iniciarMantenimiento({ primeraMs = 10_000, cadaMs = 24 * 3600 * 1000 } = {}) {
  if (_mantenimiento || config.robinToken) return;
  // 10 s: la sonda que Claude arranca y mata enseguida no llega a gastar la llave.
  const t1 = setTimeout(() => { mantenerSesion(); }, primeraMs);
  const t2 = setInterval(() => { mantenerSesion(); }, cadaMs);
  t1.unref?.();
  t2.unref?.();
  _mantenimiento = { t1, t2 };
}
export function pararMantenimiento() {
  if (!_mantenimiento) return;
  clearTimeout(_mantenimiento.t1);
  clearInterval(_mantenimiento.t2);
  _mantenimiento = null;
}

// Caso Pedro: el RobinSearch que lanza Claude no salía a internet desde su despacho y el que lanza
// RobinDesktop sí. Cuando ESTE proceso conecta y otro lleva más de un día sin poder, se manda un aviso
// técnico (solo códigos de error y versiones) para saber la causa sin tener que adivinarla.
const UN_DIA = 24 * 3600 * 1000;
let _avisadoOtro = false;
function avisarSiOtroProcesoNoConecta() {
  if (_avisadoOtro) return;
  const c = leerConexion();
  const yo = claveProceso();
  for (const [k, p] of Object.entries(c)) {
    if (k === yo || !p?.fallando_desde) continue;
    const desde = Date.parse(p.fallando_desde);
    if (!Number.isFinite(desde) || Date.now() - desde < UN_DIA) continue;
    if (Date.now() - Date.parse(p.ultimo_error?.en || 0) > 3 * UN_DIA) continue;
    _avisadoOtro = true;
    const causa = `el proceso ${k} (v${p.version || '?'}) no conecta desde ${p.fallando_desde}: ${p.ultimo_error?.codigo || '?'} ${p.ultimo_error?.detalle || ''}; este proceso (${yo}) sí conecta`;
    import('../diagnostico.js')
      .then((d) => d.informar('sin_conexion_otro_proceso', { fase: 'sesion', causa }))
      .catch(() => {});
    return;
  }
}

// ---------- código de dispositivo (RFC 8628) ---------- //
// La recuperación cuando todo falla (Juan, 8-oct-2026): el chat da un código para
// robinlawyer.ai/conectar, válido desde cualquier navegador (también el del móvil). RobinSearch
// sondea el servidor por su propia conexión y en cuanto el abogado lo aprueba queda conectado:
// sin puerto local, sin redirecciones y sin «dile a Claude que has terminado».
let _disp = null;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Lo que reconoce el abogado en la pantalla de /conectar: «macOS 15», «Windows 11», no la versión del
// núcleo (os.release() en un Mac da «24.6.0», que es Darwin).
export function nombreSO(plataforma = process.platform, release = os.release()) {
  const [mayor, , build] = String(release).split('.').map((n) => parseInt(n, 10));
  if (plataforma === 'darwin') return mayor >= 20 ? `macOS ${mayor - 9}` : `macOS (Darwin ${release})`;
  if (plataforma === 'win32') return mayor === 10 && build >= 22000 ? 'Windows 11' : mayor === 10 ? 'Windows 10' : `Windows ${release}`;
  if (plataforma === 'linux') return `Linux ${release}`.slice(0, 80);
  return `${plataforma} ${release}`.slice(0, 80);
}

function dispositivoPublico(d) {
  if (!d) return null;
  return {
    user_code: d.user_code,
    verification_uri: d.verification_uri,
    verification_uri_complete: d.verification_uri_complete,
    caduca_en_s: Math.max(0, Math.round((d.expira - Date.now()) / 1000)),
    estado: d.terminado || 'esperando',
  };
}

export function estadoDispositivo() {
  return dispositivoPublico(_disp);
}

export function cancelarDispositivo() {
  if (_disp && !_disp.terminado) _disp.terminado = 'cancelado';
}

// Devuelve { user_code, verification_uri, … } , { sin_conexion: true } o null (servidor sin el flujo).
export async function iniciarDispositivo({ abrir = true, forzar = false } = {}) {
  if (_disp && !_disp.terminado && _disp.expira > Date.now() + 30_000 && !forzar) return dispositivoPublico(_disp);
  if (_disp && !_disp.terminado) _disp.terminado = 'sustituido';
  const disc = await discover();
  if (!disc.device_authorization_endpoint) return null;
  let a;
  try {
    a = await ensureClient();
  } catch (e) {
    apuntarErrorRed(e);
    return { sin_conexion: true };
  }
  let r;
  try {
    r = await fetch(disc.device_authorization_endpoint, {
      method: 'POST',
      headers: cabeceras({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ client_id: a.client_id, scope: SCOPES, equipo: os.hostname().slice(0, 80), so: nombreSO() }).toString(),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    apuntarErrorRed(e);
    return { sin_conexion: true };
  }
  if (r.status === 426) {
    try { _versionMinima = (await r.json())?.version_minima || 'desconocida'; } catch { _versionMinima = 'desconocida'; }
    return { version_no_soportada: true };
  }
  if (!r.ok) return null;
  let d;
  try {
    d = await r.json();
  } catch {
    return null;
  }
  if (!d?.device_code || !d?.user_code) return null;
  const disp = {
    device_code: d.device_code,
    user_code: d.user_code,
    verification_uri: d.verification_uri,
    verification_uri_complete: d.verification_uri_complete || null,
    expira: Date.now() + (Number(d.expires_in) || 600) * 1000,
    intervalo: Math.max(1, Number(d.interval) || 5),
    terminado: null,
  };
  _disp = disp;
  disp.promesa = sondearDispositivo(disc, a, disp);
  disp.promesa.catch(() => {});
  if (abrir) openBrowser(disp.verification_uri_complete || disp.verification_uri);
  log.info('Código de conexión pedido', { caduca_en_s: Math.round((disp.expira - Date.now()) / 1000) });
  return dispositivoPublico(disp);
}

async function sondearDispositivo(disc, a, disp) {
  let intervalo = disp.intervalo;
  while (!disp.terminado && Date.now() < disp.expira) {
    await dormir(intervalo * 1000);
    if (disp.terminado) break;
    let r;
    try {
      r = await fetch(disc.token_endpoint, {
        method: 'POST',
        headers: cabeceras({ 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: new URLSearchParams({ grant_type: GRANT_DISPOSITIVO, device_code: disp.device_code, client_id: a.client_id }).toString(),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      apuntarErrorRed(e);
      continue;
    }
    let j = {};
    try { j = await r.json(); } catch { j = {}; }
    if (r.ok && j.access_token) {
      const tokens = normalizeTokens(j);
      const user = await whoami(tokens.access_token);
      const merged = { ...(loadAuth() || {}), client_id: a.client_id, redirect_uris: a.redirect_uris, ...tokens, updated_at: Date.now() };
      if (user) merged.user = user;
      else delete merged.user;
      await guardarSesion(merged);
      _ultimaRenovacion = 'ok';
      apuntarConexion(true);
      await renovarCertificado(tokens.access_token);
      disp.terminado = 'conectado';
      log.info('RobinSearch conectado con el código', { usuario: user?.email || null });
      return disp.terminado;
    }
    if (j.error === 'authorization_pending') continue;
    if (j.error === 'slow_down') {
      intervalo += 5;
      continue;
    }
    disp.terminado = j.error === 'access_denied' ? 'denegado' : j.error === 'expired_token' ? 'caducado' : 'error';
    return disp.terminado;
  }
  if (!disp.terminado) disp.terminado = 'caducado';
  return disp.terminado;
}

// Gate para las herramientas. Desde la 1.12.0 decide el CERTIFICADO DE LICENCIA guardado en este
// ordenador, sin red. Devuelve { ok:true, mode } o { ok:false, … } con lo necesario para decirle al
// abogado qué hacer (código de conexión, sin derecho de uso, sin conexión, enlace de login).
function okLicencia(der) {
  return { ok: true, mode: der.modo, licencia: der, user: loadAuth()?.user || null };
}

export async function ensureAuthorized() {
  if (config.robinToken) return { ok: true, bearer: config.robinToken, mode: 'token' };
  const der = licencia.derechoDeUso();
  if (der.ok) {
    mantenerSesion(); // en segundo plano: renueva lo que toque sin hacer esperar a la herramienta
    return okLicencia(der);
  }
  const bearer = await getBearerQuiet();
  if (bearer) {
    if (licencia.tocaRenovar() || !der.ok) await renovarCertificado(bearer);
    const d2 = licencia.derechoDeUso();
    if (d2.ok) return okLicencia(d2);
    if (d2.motivo === 'sin_derecho') return { ok: false, sin_derecho: true, estado: d2.estado };
    // Servidor sin certificados (o que no ha podido darlo ahora): como hasta la 1.11.
    const a = loadAuth();
    return { ok: true, bearer, mode: 'oauth', user: a?.user || null };
  }
  if (der.motivo === 'sin_derecho' && _ultimaRenovacion !== 'rechazada') {
    return { ok: false, sin_derecho: true, estado: der.estado };
  }
  const a = loadAuth();
  const hasta = (a?.expires_at || 0) + DIAS_SIN_CONEXION * 24 * 3600 * 1000;
  if (_ultimaRenovacion === 'sin_conexion' && a?.access_token && tieneLlave(a) && Date.now() < hasta) {
    log.info('Sin conexión con Robin: se sigue con la sesión guardada', { hasta: new Date(hasta).toISOString() });
    return { ok: true, bearer: a.access_token, mode: 'sin_conexion', user: a.user || null, sin_conexion_hasta: new Date(hasta).toISOString() };
  }
  // 🔴 8-oct-2026 (Pedro): pasados los 14 días SIN HABER PODIDO HABLAR con Robin, abrir el login
  // no arregla nada —el navegador autoriza, pero este programa tampoco llega para recoger el
  // código— y el abogado se pasa la mañana autorizando enlaces. La sesión no está rechazada (eso
  // sería 'rechazada'): en cuanto haya conexión se renueva sola. Se dice eso, con la causa.
  if (_versionMinima && _ultimaRenovacion === 'version') return { ok: false, version_no_soportada: true, version_minima: _versionMinima };
  if (_ultimaRenovacion === 'sin_conexion' && tieneLlave(a)) {
    log.warn('Sin conexión con Robin pasado el margen: no se abre el login', { causa: _ultimoErrorRed?.codigo || null });
    return { ok: false, loginUrl: null, sin_conexion: true, error_red: _ultimoErrorRed };
  }
  if (_versionMinima) return { ok: false, version_no_soportada: true, version_minima: _versionMinima };
  // Hay que (re)conectar: con el código de dispositivo si el servidor lo ofrece.
  const disp = await iniciarDispositivo();
  if (disp?.user_code) return { ok: false, dispositivo: disp };
  if (disp?.sin_conexion) return { ok: false, loginUrl: null, sin_conexion: true, error_red: _ultimoErrorRed };
  if (disp?.version_no_soportada) return { ok: false, version_no_soportada: true, version_minima: _versionMinima };
  startLogin(); // servidor sin código de dispositivo: el enlace de siempre
  const loginUrl = await awaitAuthorizeUrl();
  return { ok: false, loginUrl };
}

// Texto del código de conexión, el mismo en las herramientas y en reconectar_robinsearch.
export function textoDispositivo(d) {
  const url = (d.verification_uri || 'https://robinlawyer.ai/conectar').replace(/^https?:\/\//, '');
  const min = Math.max(1, Math.round((d.caduca_en_s || 600) / 60));
  return `Para conectar RobinSearch, abre ${url} en cualquier navegador (también vale el del móvil) ` +
    `e introduce el código ${d.user_code}. Comprueba que el equipo que aparece es el tuyo. ` +
    `En cuanto lo apruebes, RobinSearch se conecta solo: no hace falta que me digas nada, ` +
    `basta con repetir la petición. El código caduca en ${min} minutos.`;
}

const TEXTO_SIN_DERECHO = {
  prueba_terminada: 'Tu periodo de prueba de RobinLawyer.ai ha terminado, así que RobinSearch ya no está disponible en este ordenador. Puedes contratar tu plan en robinlawyer.ai/pricing; en cuanto esté activo, RobinSearch vuelve a funcionar solo.',
  caducada: 'Tu licencia de RobinLawyer.ai ha caducado, así que RobinSearch ya no está disponible en este ordenador. Puedes renovarla en robinlawyer.ai/pricing; en cuanto esté activa, RobinSearch vuelve a funcionar solo.',
  sin_licencia: 'Tu cuenta de RobinLawyer.ai no tiene ninguna licencia activa, así que RobinSearch no está disponible. Puedes activarla en robinlawyer.ai/pricing.',
  cuenta_bloqueada: 'Tu cuenta de RobinLawyer.ai está pendiente de activación, así que RobinSearch todavía no está disponible. Escríbenos a hola@robinlawyer.ai si crees que es un error.',
};

function causaLegible(err) {
  const c = err?.codigo || '';
  if (ERRORES_CERTIFICADO.has(c)) {
    return 'la conexión segura lleva un certificado que RobinSearch no reconoce; suele ponerlo el antivirus o el proxy del despacho al revisar las conexiones';
  }
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'el ordenador no encuentra la dirección de RobinLawyer.ai';
  if (c.startsWith('HTTP_5') || c === 'HTTP_429') return 'el servidor de RobinLawyer.ai no responde ahora mismo';
  if (c) return 'la conexión se corta antes de llegar a RobinLawyer.ai; suele ser el antivirus, el cortafuegos o un proxy';
  return 'la conexión no llega a RobinLawyer.ai';
}

// Respuesta MCP amable cuando falta sesión.
export function authPromptResult(loginUrl, auth = null) {
  if (auth?.dispositivo?.user_code) {
    return fail(textoDispositivo(auth.dispositivo) + ' (Muéstrale al abogado el código y la dirección tal cual.)', {
      requiere_login: true,
      codigo: auth.dispositivo.user_code,
      url: auth.dispositivo.verification_uri,
      caduca_en_s: auth.dispositivo.caduca_en_s,
    });
  }
  if (auth?.sin_derecho) {
    return fail(TEXTO_SIN_DERECHO[auth.estado] || TEXTO_SIN_DERECHO.sin_licencia, { requiere_login: false, sin_derecho: true, estado: auth.estado || null });
  }
  if (auth?.version_no_soportada) {
    return fail(
      `Esta versión de RobinSearch (${VERSION}) ya no puede conectar con RobinLawyer.ai: la mínima es la ${auth.version_minima}. ` +
        'Actualízala desde RobinDesktop o descárgala en robinlawyer.ai/descargas; la sesión se conserva y no hace falta volver a entrar.',
      { requiere_login: false, version_no_soportada: true, version_minima: auth.version_minima || null },
    );
  }
  if (auth?.sin_conexion) {
    return fail(
      'RobinSearch no consigue conectar con RobinLawyer.ai desde este ordenador (' + causaLegible(auth.error_red) + '). ' +
        'NO hace falta volver a iniciar sesión: la sesión sigue siendo válida y se renovará sola en cuanto ' +
        'RobinSearch pueda conectar, así que abrir enlaces de autorización no sirve. ' +
        (/^HTTP_/.test(auth.error_red?.codigo || '') ? '' : 'El navegador sí entra porque usa otra vía. ') +
        'Actualiza RobinSearch a la última versión desde RobinDesktop y vuelve a ' +
        'intentarlo; si sigue igual, escribe a hola@robinlawyer.ai.',
      { requiere_login: false, sin_conexion: true, causa: auth.error_red?.codigo || null },
    );
  }
  const enlace = loginUrl
    ? ` Si no se abrió sola, abre este enlace: ${loginUrl}`
    : ' Si no se abrió sola, vuelve a pedírmelo en unos segundos y te doy el enlace.';
  return fail(
    'Necesitas iniciar sesión en RobinLawyer.ai para buscar en tus expedientes. He abierto una ' +
      'pestaña en tu navegador para que inicies sesión con tu cuenta de Robin.' +
      enlace +
      ' Cuando termines, repite la búsqueda.',
    { requiere_login: true },
  );
}

// Estado de sesión para estado_servidor (silencioso, sin disparar login).
export async function authStatus() {
  if (config.robinToken) return { autenticado: true, modo: 'token', usuario: null };
  const der = licencia.derechoDeUso();
  const a = loadAuth();
  const llave = a?.refresh_en || (a?.refresh_token ? 'fichero' : null);
  const lic = der.datos
    ? { estado: der.datos.estado, plan: der.datos.plan, uso: der.ok, modo: der.ok ? der.modo : der.motivo, hasta: der.hasta || der.datos.valido_hasta, dias_restantes: der.dias_restantes ?? null }
    : null;
  const disp = estadoDispositivo();
  const conexion = leerConexion()[claveProceso()] || null;
  if (der.ok) {
    return { autenticado: true, modo: der.modo, usuario: a?.user?.email || der.datos?.email || null, licencia: lic, llave_renovacion: llave, conexion, codigo_conexion: disp?.estado === 'esperando' ? disp : null };
  }
  const bearer = await getBearerQuiet();
  if (!bearer) return { autenticado: false, modo: null, usuario: null, licencia: lic, llave_renovacion: llave, conexion, codigo_conexion: disp?.estado === 'esperando' ? disp : null };
  return { autenticado: true, modo: 'oauth', usuario: a?.user?.email || a?.user?.name || null, licencia: lic, llave_renovacion: llave, conexion };
}

// Aviso para el chat cuando la licencia de este equipo está a punto de vencer (≤ 5 días o ya en la
// gracia sin conexión). null = nada que decir.
export function avisoSesion() {
  if (config.robinToken) return null;
  if (_versionMinima) {
    return `Esta versión de RobinSearch (${VERSION}) ya no puede renovar su conexión con RobinLawyer.ai: la mínima es la ${_versionMinima}. ` +
      'Sigue funcionando con la licencia guardada mientras valga, pero hay que actualizarla desde RobinDesktop o en robinlawyer.ai/descargas ' +
      '(la sesión se conserva). Díselo al abogado.';
  }
  const der = licencia.derechoDeUso();
  if (!der.ok) return null;
  if (der.modo !== 'gracia' && (der.dias_restantes ?? 99) > 5) return null;
  const dias = der.dias_restantes ?? 0;
  const cuando = dias <= 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`;
  const causa = _ultimoErrorRed ? ` (${causaLegible(_ultimoErrorRed)})` : '';
  if (der.modo === 'gracia') {
    return `RobinSearch lleva días sin poder conectar con RobinLawyer.ai desde este ordenador${causa}; ` +
      `sigue funcionando con la licencia guardada, pero vence ${cuando}. Para renovarla basta abrir RobinDesktop un momento ` +
      'o escribir «reconectar RobinSearch». Díselo al abogado.';
  }
  if (der.datos?.renovable === false && der.datos?.licencia_hasta) {
    return `El periodo de prueba de RobinLawyer.ai de este abogado termina ${cuando}; después RobinSearch dejará de estar disponible hasta que contrate su plan (robinlawyer.ai/pricing).`;
  }
  return `La licencia de RobinSearch de este ordenador vence ${cuando} y no se ha podido renovar todavía${causa}. ` +
    'Para renovarla basta abrir RobinDesktop un momento o escribir «reconectar RobinSearch». Díselo al abogado.';
}

// Login interactivo bloqueante para el CLI (`robin-search login`). Imprime a stdout.
export async function loginInteractive() {
  process.stdout.write('Abriendo el navegador para iniciar sesión en RobinLawyer.ai…\n');
  const res = startLogin();
  // 🔴 23-sep-2026: el enlace de autorización se publica AQUÍ, en cuanto existe,
  // y no al final. RobinDesktop lanza este mismo `login` con ROBIN_NO_BROWSER=1 y
  // abre el enlace en una ventana SUYA, para que la sesión quede iniciada también
  // dentro de la app (su panel embebido tiene su propio almacén de cookies, como
  // cualquier navegador; sin esto, licencias, guía, manual y catálogo pedían
  // entrar otra vez aunque el abogado acabara de hacerlo). Una línea de máquina,
  // fácil de leer desde fuera; la de siempre se sigue imprimiendo para quien lo
  // use a mano.
  const enlace = await awaitAuthorizeUrl();
  if (enlace) process.stdout.write(`ROBIN_LOGIN_URL ${enlace}\n`);
  const hecho = await res;
  if (_lastAuthorizeUrl) process.stdout.write(`Si no se abrió, entra aquí:\n  ${_lastAuthorizeUrl}\n`);
  if (hecho.ok) {
    // Una línea de máquina para RobinDesktop, solo si la pidió: un secreto no
    // se imprime en la terminal de quien lanza el login a mano.
    if (hecho.web && process.env.ROBIN_WEB_HANDOFF === '1') process.stdout.write(`ROBIN_WEB_HANDOFF ${hecho.web}\n`);
    const a = loadAuth();
    process.stdout.write(`✓ Sesión iniciada como ${a?.user?.email || a?.user?.name || 'usuario de Robin'}.\n`);
    return true;
  }
  process.stderr.write(`✗ No se pudo iniciar sesión: ${hecho.error || 'error desconocido'}\n`);
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
        headers: cabeceras({ 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: new URLSearchParams({ token: a.access_token, client_id: a.client_id }),
      });
    } catch {
      /* si falla la revocación remota, borramos igual las credenciales locales */
    }
  }
  clearTokens();
  licencia.borrar();
  return true;
}

export default { ensureAuthorized, authPromptResult, authStatus, getBearerQuiet, loginInteractive, logout, mantenerSesion, iniciarMantenimiento, iniciarDispositivo, avisoSesion };
