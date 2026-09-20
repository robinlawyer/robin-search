// Entrar en el buzón con la cuenta del proveedor (XOAUTH2), y no con una contraseña.
//
// Microsoft cerró la puerta de la contraseña en IMAP y SMTP: sus servidores anuncian
// LOGINDISABLED y solo aceptan XOAUTH2. Google la deja abierta a medias, con la contraseña de
// aplicación, que obliga al abogado a un paseo por la configuración de seguridad de Google.
// Este módulo hace lo que hacen Apple Mail y Thunderbird: abre el navegador, el abogado entra en
// SU proveedor, y lo que vuelve es un permiso revocable — no su contraseña.
//
// LO QUE ESTO MEJORA, ADEMÁS DE ABRIR MICROSOFT: aquí no hay contraseña que custodiar en ningún
// sitio. Lo que se guarda en el llavero es un permiso que el abogado puede retirar desde su
// cuenta de Microsoft o de Google cuando quiera, sin cambiar nada más.
//
// Flujo: OAuth 2.0 + PKCE con redirección a loopback (RFC 8252, «OAuth para aplicaciones
// nativas»), el mismo patrón que ya usa el login de Robin (server/auth/oauth.js).

import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

import { config } from '../config.js';
import { log } from '../logger.js';
import { browserCommand } from '../auth/oauth.js';
import { proveedor } from './proveedores.js';
import * as llavero from './llavero.js';

// Puertos fijos: Microsoft y Google exigen que la redirección esté declarada en el alta de la
// aplicación, y para loopback ignoran el puerto pero NO el resto de la dirección.
const PUERTOS = [47830, 47831, 47832, 47833, 47834];
const RUTA_VUELTA = '/correo';
const ESPERA_NAVEGADOR_MS = 5 * 60 * 1000;
// Un token de acceso dura una hora; se renueva dos minutos antes para que ninguna llamada se
// quede a medias por caducidad.
const MARGEN_RENOVACION_MS = 2 * 60 * 1000;

const vuelta = (puerto) => `http://localhost:${puerto}${RUTA_VUELTA}`;

// La dirección de redirección que hay que DECLARAR en el alta de la aplicación. El puerto lo
// ignoran los dos proveedores por ser loopback; la ruta, no.
export const REDIRECCION_DECLARADA = `http://localhost${RUTA_VUELTA}`;

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pkce() {
  const verificador = b64url(crypto.randomBytes(32));
  return { verificador, reto: b64url(crypto.createHash('sha256').update(verificador).digest()) };
}

function abrirNavegador(url) {
  if (config.noBrowser) {
    log.info('No abro el navegador para el correo (ROBIN_NO_BROWSER)');
    return;
  }
  try {
    const { cmd, args } = browserCommand(process.platform, url);
    const hijo = spawn(cmd, args, { stdio: 'ignore', detached: true });
    hijo.on('error', (e) => log.warn('No pude abrir el navegador', { err: String(e) }));
    hijo.unref();
  } catch (e) {
    log.warn('No pude abrir el navegador', { err: String(e) });
  }
}

function pagina(titulo, mensaje) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo} — RobinLawyer.ai</title>
<style>*{box-sizing:border-box;margin:0;padding:0}html,body{height:100%}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111110;background:#f9f9f8;
display:flex;align-items:center;justify-content:center;padding:2rem}
.card{background:#fff;border:1px solid #e2e2df;border-radius:18px;box-shadow:0 20px 60px rgba(17,17,16,.08);
max-width:460px;width:100%;padding:2.4rem;text-align:center}
h1{font-size:1.3rem;font-weight:700;letter-spacing:-.02em;margin:0 0 .5rem}
p{color:#555;font-size:.95rem;line-height:1.55}</style></head>
<body><div class="card"><h1>${titulo}</h1><p>${mensaje}</p></div></body></html>`;
}

function escuchar(puertos) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const siguiente = () => {
      if (i >= puertos.length) return reject(new Error(`no hay ningún puerto libre (${puertos[0]}-${puertos[puertos.length - 1]})`));
      const puerto = puertos[i++];
      const servidor = http.createServer();
      servidor.once('error', () => { try { servidor.close(); } catch { /* nada */ } siguiente(); });
      servidor.listen(puerto, '127.0.0.1', () => {
        servidor.removeAllListeners('error');
        resolve({ servidor, puerto });
      });
    };
    siguiente();
  });
}

// Espera a que el navegador vuelva con el código. Devuelve { code } o lanza.
function esperarCodigo(servidor, estado, esperaMs = ESPERA_NAVEGADOR_MS) {
  return new Promise((resolve, reject) => {
    const tope = setTimeout(() => {
      fin();
      reject(Object.assign(new Error('Se ha agotado el tiempo esperando al navegador.'), { motivo: 'tiempo' }));
    }, esperaMs);
    const fin = () => { clearTimeout(tope); try { servidor.close(); } catch { /* nada */ } };

    servidor.on('request', (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith(RUTA_VUELTA)) {
        res.writeHead(404).end();
        return;
      }
      const responder = (titulo, mensaje) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pagina(titulo, mensaje));
      };
      // El `state` es lo que impide que otra página del navegador nos cuele un código suyo.
      if (url.searchParams.get('state') !== estado) {
        responder('Algo no cuadra', 'Esta respuesta no corresponde a la conexión que se estaba haciendo. Vuelve a intentarlo desde la app de RobinSearch.');
        return;
      }
      const error = url.searchParams.get('error');
      if (error) {
        responder('No se ha conectado', 'Has cancelado, o tu organización no permite esta conexión. Puedes cerrar esta pestaña.');
        fin();
        reject(Object.assign(new Error(url.searchParams.get('error_description') || error), { motivo: 'rechazado', error }));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        responder('Falta algo', 'La respuesta ha llegado incompleta. Vuelve a intentarlo desde la app de RobinSearch.');
        return;
      }
      responder('Correo conectado', 'Ya puedes cerrar esta pestaña y volver a RobinSearch.');
      fin();
      resolve({ code });
    });
  });
}

async function pedirTokens(p, cuerpo) {
  const r = await fetch(p.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(cuerpo),
    signal: AbortSignal.timeout(20000),
  });
  const texto = await r.text();
  let datos = {};
  try { datos = JSON.parse(texto); } catch { /* respuesta que no es JSON */ }
  if (!r.ok) {
    // `invalid_grant` es lo que devuelven los dos cuando el permiso ya no vale: lo ha retirado el
    // abogado desde su cuenta, ha caducado (Google caduca los de una aplicación en pruebas a los
    // siete días) o su organización lo ha revocado. Se dice en castellano y con la salida, porque
    // el texto del proveedor viene en inglés y no dice qué hacer.
    const retirado = datos.error === 'invalid_grant';
    const e = new Error(retirado
      ? 'Tu proveedor ya no acepta el permiso que dio RobinSearch para leer tu correo: puede que lo '
        + 'hayas retirado desde tu cuenta, o que haya caducado. Vuelve a conectar la cuenta en la app '
        + 'de RobinSearch → Tu correo.'
      : (datos.error_description || datos.error || `el proveedor ha respondido HTTP ${r.status}`));
    e.motivo = retirado ? 'permiso_retirado' : 'token';
    e.error = datos.error || null;
    throw e;
  }
  return datos;
}

// Dónde vive el permiso. Es un secreto: al llavero, como la contraseña. Y con su propia cuenta,
// para que conectar por OAuth no pise una contraseña guardada antes (ni al revés).
const cuentaLlavero = (direccion) => `oauth:${direccion}`;

async function guardarPermiso(direccion, proveedorId, tokens) {
  const guardado = {
    proveedor: proveedorId,
    refresh_token: tokens.refresh_token || null,
    ambitos: tokens.scope || null,
    desde: new Date().toISOString(),
  };
  await llavero.guardar(cuentaLlavero(direccion), JSON.stringify(guardado));
  return guardado;
}

export async function leerPermiso(direccion) {
  const crudo = await llavero.leer(cuentaLlavero(direccion));
  if (!crudo) return null;
  try {
    const v = JSON.parse(crudo);
    return v && v.refresh_token ? v : null;
  } catch {
    return null;
  }
}

export async function olvidarPermiso(direccion) {
  return llavero.borrar(cuentaLlavero(direccion));
}

// Tokens de acceso vivos, SOLO en memoria: duran una hora y no hay ninguna razón para que
// toquen el disco.
const enMemoria = new Map();

// El token con el que se entra en IMAP y SMTP. Se renueva solo con el permiso guardado.
export async function tokenDeAcceso(direccion, { forzar = false } = {}) {
  const vivo = enMemoria.get(direccion);
  if (!forzar && vivo && vivo.caducaEn - MARGEN_RENOVACION_MS > Date.now()) return vivo.access_token;

  const permiso = await leerPermiso(direccion);
  if (!permiso) {
    throw Object.assign(new Error('Esta cuenta está conectada con la de tu proveedor, pero el permiso ya no está en este ordenador. Vuelve a conectarla en la app de RobinSearch.'), { motivo: 'sin_permiso' });
  }
  const p = proveedor(permiso.proveedor);
  const clientId = p?.clientId();
  if (!p || !clientId) {
    throw Object.assign(new Error('Falta la configuración de la aplicación para ese proveedor. Avisa a RobinLawyer.ai.'), { motivo: 'sin_alta' });
  }
  const datos = await pedirTokens(p, {
    grant_type: 'refresh_token',
    refresh_token: permiso.refresh_token,
    client_id: clientId,
    scope: p.ambitos,
  });
  // Google no rota el refresh token y no lo devuelve; Microsoft sí. Se conserva el que valga.
  if (datos.refresh_token && datos.refresh_token !== permiso.refresh_token) {
    await guardarPermiso(direccion, permiso.proveedor, { ...datos, scope: datos.scope || permiso.ambitos });
  }
  const caducaEn = Date.now() + (Number(datos.expires_in) || 3600) * 1000;
  enMemoria.set(direccion, { access_token: datos.access_token, caducaEn });
  log.info('Permiso de correo renovado', { proveedor: permiso.proveedor });
  return datos.access_token;
}

export function olvidarEnMemoria(direccion) {
  if (direccion) enMemoria.delete(direccion); else enMemoria.clear();
}

// Conecta una cuenta: abre el navegador, espera la vuelta y guarda el permiso.
// `alAbrir` recibe la URL, por si quien llama quiere enseñarla (terminal, app).
export async function conectar(proveedorId, { direccion = null, alAbrir = null, esperaMs = ESPERA_NAVEGADOR_MS } = {}) {
  const p = proveedor(proveedorId);
  if (!p) throw Object.assign(new Error(`Proveedor desconocido: ${proveedorId}`), { motivo: 'proveedor' });
  const clientId = p.clientId();
  if (!clientId) {
    throw Object.assign(new Error(`Todavía no hay alta de aplicación para ${p.nombre}. Avisa a RobinLawyer.ai: sin ella, ni este ni ningún otro programa puede conectarse a esas cuentas.`), { motivo: 'sin_alta' });
  }

  const { servidor, puerto } = await escuchar(PUERTOS);
  const { verificador, reto } = pkce();
  const estado = b64url(crypto.randomBytes(16));
  const url = new URL(p.autorizacion);
  for (const [k, v] of Object.entries({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: vuelta(puerto),
    scope: p.ambitos,
    state: estado,
    code_challenge: reto,
    code_challenge_method: 'S256',
    // Con la dirección delante, el proveedor no le pregunta al abogado cuál es su cuenta.
    ...(direccion ? { login_hint: direccion } : {}),
    ...p.extra,
  })) url.searchParams.set(k, v);

  const espera = esperarCodigo(servidor, estado, esperaMs);
  if (alAbrir) alAbrir(url.toString());
  abrirNavegador(url.toString());

  const { code } = await espera;
  const tokens = await pedirTokens(p, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: vuelta(puerto),
    client_id: clientId,
    code_verifier: verificador,
  });
  if (!tokens.refresh_token) {
    throw Object.assign(new Error('El proveedor no ha devuelto un permiso duradero, así que habría que volver a entrar cada hora. Vuelve a intentarlo; si sigue igual, avisa a RobinLawyer.ai.'), { motivo: 'sin_refresh' });
  }
  // La dirección real la dice el proveedor cuando la pedimos (Microsoft, en el id_token);
  // si no, la que escribió el abogado.
  const correo = direccionDelIdToken(tokens.id_token) || direccion;
  await guardarPermiso(correo, proveedorId, tokens);
  enMemoria.set(correo, { access_token: tokens.access_token, caducaEn: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 });
  log.info('Cuenta de correo conectada con su proveedor', { proveedor: proveedorId });
  return { direccion: correo, proveedor: proveedorId, ambitos: tokens.scope || p.ambitos };
}

// El id_token viene firmado, pero aquí no se usa como prueba de nada: solo para saber qué
// dirección eligió el abogado en la pantalla del proveedor. Quien manda es el servidor de
// correo, que aceptará o no el token de acceso.
export function direccionDelIdToken(idToken) {
  try {
    const carga = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    const v = carga.email || carga.preferred_username || carga.upn || null;
    return v && /@/.test(v) ? String(v).toLowerCase() : null;
  } catch {
    return null;
  }
}

export default { conectar, tokenDeAcceso, leerPermiso, olvidarPermiso, olvidarEnMemoria, REDIRECCION_DECLARADA, direccionDelIdToken };
