// Conexión IMAP con el servidor del abogado. Una sola por proceso, reutilizada, con reconexión
// y con topes de tiempo en todo — la red de un despacho es la de `net.js`: VPN que se cae,
// proxy que acepta la conexión y no contesta, portátil que se lleva a un juzgado sin cobertura.
//
// TRES COSAS QUE NO SON NEGOCIABLES AQUÍ:
//  1. `logger: false`. Por defecto ImapFlow escribe con pino A STDOUT, que en MCP es el canal
//     EXCLUSIVO del JSON-RPC: bastaría para que Claude dijera «Invalid JSON-RPC message» y se
//     cayera la extensión entera. Y además esos registros llevan remitentes y asuntos, que es
//     justo lo que no puede aparecer en ningún log nuestro.
//  2. Ninguna operación se queda esperando para siempre: sin conexión se falla rápido y con un
//     mensaje que el abogado entienda, nunca colgando la conversación.
//  3. La contraseña se pide al llavero en el momento de conectar y no se guarda en ningún
//     objeto que pueda acabar serializado.

import { ImapFlow } from 'imapflow';
import { log } from '../logger.js';
import { leerCorreo } from './ajustes.js';
import * as llavero from './llavero.js';
import { tokenDeAcceso } from './oauth-correo.js';
import { SIN_CUENTA, SIN_SECRETO } from './avisos.js';

const CONEXION_MS = 15000;   // abrir el socket
const SALUDO_MS = 15000;     // que el servidor se presente
const OPERACION_MS = 60000;  // una búsqueda en un buzón grande puede tardar

// Una conexión POR CUENTA (26-sep-2026, varias cuentas): cada buzón tiene su cliente, su
// conexión en curso y su propia fila de órdenes. Buscar en la del despacho no espera a que
// termine un FETCH lento en la personal.
const puestos = new Map();   // dirección en minúsculas → { cliente, conectando, cola }

function puestoDe(usuario) {
  const k = String(usuario || '').trim().toLowerCase();
  if (!puestos.has(k)) puestos.set(k, { cliente: null, conectando: null, cola: Promise.resolve() });
  return puestos.get(k);
}

// Un fallo del que no se vuelve: la conexión se tira y la siguiente llamada abre otra.
function esFatal(err) {
  const c = err?.code || '';
  return ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNABORTED', 'NoConnection', 'ClosedAfterConnectTLS'].includes(c)
    || /connection|closed|not connected|socket/i.test(String(err?.message || ''));
}

// Traduce el fallo técnico a algo que el abogado pueda leer, SIN inventarse la causa.
export function explicar(err) {
  const code = err?.code || err?.serverResponseCode || '';
  const msg = String(err?.message || err || '');
  if (code === 'AUTHENTICATIONFAILED' || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication fail/i.test(msg)) {
    return {
      motivo: 'credenciales',
      mensaje: 'El servidor de correo ha rechazado las credenciales. Si la cuenta es de Microsoft 365 '
        + 'o de Outlook.com, la contraseña no sirve para IMAP y hay que conectarla con la propia '
        + 'cuenta de Microsoft; en Gmail hace falta una contraseña de aplicación. Vuelve a conectar '
        + 'la cuenta desde RobinDesktop → Correo electrónico.',
    };
  }
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return { motivo: 'sin_conexion', mensaje: 'No se encuentra el servidor de correo. Comprueba que este ordenador tiene conexión y que el nombre del servidor es correcto (RobinDesktop → Correo electrónico → Ajustes avanzados).' };
  }
  if (code === 'ECONNREFUSED') {
    return { motivo: 'puerto', mensaje: 'El servidor de correo rechaza la conexión en ese puerto. Revísalo en RobinDesktop → Correo electrónico → Ajustes avanzados.' };
  }
  if (['ETIMEDOUT', 'ECONNABORTED'].includes(code) || /tiempo agotado|timed? ?out/i.test(msg)) {
    return { motivo: 'tiempo', mensaje: 'El servidor de correo no responde. Puede ser la conexión, la VPN del despacho o el propio servidor.' };
  }
  if (/certificate|self.signed|CERT_|unable to verify/i.test(msg) || String(code).startsWith('ERR_TLS')) {
    return { motivo: 'certificado', mensaje: 'El certificado del servidor de correo no se puede validar. Si es el servidor interno del despacho, habla con vuestro informático: RobinSearch no acepta certificados sin validar.' };
  }
  return { motivo: 'error', mensaje: `No se ha podido hablar con el servidor de correo (${code || 'error'}).` };
}

export class SinCuenta extends Error {
  constructor() {
    super('Todavía no hay ninguna cuenta de correo conectada. Ábrela en RobinDesktop → Correo electrónico. '
      + 'La contraseña se guarda en el llavero de este ordenador; RobinSearch nunca la pide por el chat.');
    this.motivo = 'sin_cuenta';
  }
}

// Se ha pedido una cuenta por su dirección y no es ninguna de las conectadas. NUNCA se cae en la
// principal: sería leer o escribir en el buzón de otra persona.
export class CuentaDesconocida extends Error {
  constructor(pedida, conectadas = []) {
    super(`La cuenta «${pedida}» no está conectada en este ordenador.`
      + (conectadas.length ? ` Las conectadas son: ${conectadas.join(', ')}.` : ' No hay ninguna conectada.'));
    this.motivo = 'cuenta_desconocida';
    this.cuentas = conectadas;
  }
}

// La configuración de la cuenta pedida (o de la principal), o el error que toca.
export function cuentaPedida(cuenta = null) {
  const cfg = leerCorreo(cuenta || null);
  if (cuenta && cfg.desconocida) throw new CuentaDesconocida(cuenta, cfg.cuentas || []);
  if (!cfg.configurado) throw new SinCuenta();
  return cfg;
}

export class FalloDeCorreo extends Error {
  constructor(err) {
    const { motivo, mensaje } = explicar(err);
    super(mensaje);
    this.motivo = motivo;
    this.code = err?.code || null;
  }
}

// Con qué se entra: la contraseña del llavero, o un token de acceso del proveedor (XOAUTH2).
// Lo segundo es lo ÚNICO que admiten Microsoft 365 y Outlook.com.
export async function credenciales(cfg) {
  if (cfg.auth === 'oauth') {
    return { user: cfg.usuario, accessToken: await tokenDeAcceso(cfg.usuario) };
  }
  const clave = await llavero.leer(cfg.usuario);
  if (!clave) throw new SinCuenta(SIN_SECRETO);
  return { user: cfg.usuario, pass: clave };
}

async function abrir(cfg, puesto) {
  const c = new ImapFlow({
    host: cfg.imap.host,
    port: cfg.imap.puerto,
    secure: cfg.imap.tls,
    auth: await credenciales(cfg),
    logger: false,      // ver la cabecera de este fichero: stdout es del JSON-RPC
    emitLogs: false,
    connectionTimeout: CONEXION_MS,
    greetingTimeout: SALUDO_MS,
    socketTimeout: OPERACION_MS,
    clientInfo: { name: 'RobinSearch', vendor: 'RobinLawyer.ai' },
  });
  // ImapFlow emite 'error' por su cuenta; sin oyente, un corte de red tumbaría el proceso.
  c.on('error', (err) => {
    log.warn('Conexión de correo caída', { code: err?.code || null });
    if (puesto.cliente === c) puesto.cliente = null;
  });
  c.on('close', () => { if (puesto.cliente === c) puesto.cliente = null; });
  // De qué cuenta es esta conexión: lo lee carpetas.resolver() para no mezclar los Borradores
  // de un buzón con los de otro.
  c.robinCuenta = cfg.usuario;
  await c.connect();
  return c;
}

async function conectar(cfg, puesto) {
  if (puesto.cliente?.usable) return puesto.cliente;
  if (!puesto.conectando) {
    puesto.conectando = abrir(cfg, puesto)
      .then((c) => { puesto.cliente = c; return c; })
      .catch((err) => { puesto.cliente = null; throw err; })
      .finally(() => { puesto.conectando = null; });
  }
  return puesto.conectando;
}

// Todas las operaciones van en fila: IMAP atiende una orden por conexión, y dos herramientas
// llamadas a la vez (Claude las encadena) se pisaban a mitad de un FETCH.
// Fallos que YA vienen explicados desde el módulo de OAuth: no hay que traducirlos otra vez, y
// convertirlos en «no se ha podido hablar con el servidor» perdería lo único útil que dicen —
// que hay que volver a conectar la cuenta.
const MOTIVOS_PROPIOS = new Set(['permiso_retirado', 'sin_permiso', 'sin_alta', 'token', 'sin_cuenta', 'cuenta_desconocida']);

// `fn(cliente, cfg)`: `cfg` es la cuenta sobre la que se está trabajando, para quien necesite su
// dirección o sus carpetas. `cuenta` es la dirección pedida; sin ella, la principal.
export async function conImap(fn, cuenta = null) {
  const cfg = cuentaPedida(cuenta);
  const puesto = puestoDe(cfg.usuario);
  const turno = puesto.cola.then(async () => {
    try {
      return await fn(await conectar(cfg, puesto), cfg);
    } catch (err) {
      if (err instanceof SinCuenta || MOTIVOS_PROPIOS.has(err?.motivo)) throw err;
      if (esFatal(err)) {
        // Una sola reconexión: si el servidor cerró por inactividad, el abogado no tiene por qué
        // enterarse. Si vuelve a fallar, se dice.
        try { puesto.cliente?.close(); } catch { /* ya cerrada */ }
        puesto.cliente = null;
        try {
          return await fn(await conectar(cfg, puesto), cfg);
        } catch (err2) {
          if (err2 instanceof SinCuenta || MOTIVOS_PROPIOS.has(err2?.motivo)) throw err2;
          throw new FalloDeCorreo(err2);
        }
      }
      throw new FalloDeCorreo(err);
    }
  });
  // La cola sigue aunque este turno falle.
  puesto.cola = turno.then(() => undefined, () => undefined);
  return turno;
}

// Cierra la conexión de una cuenta (al desconectarla) o las de todas.
export async function cerrar(cuenta = null) {
  const claves = cuenta ? [String(cuenta).trim().toLowerCase()] : [...puestos.keys()];
  for (const k of claves) {
    const p = puestos.get(k);
    if (!p) continue;
    const c = p.cliente;
    p.cliente = null;
    if (!c) continue;
    try { await c.logout(); } catch { try { c.close(); } catch { /* nada */ } }
  }
}

// Para la app: comprobar unas credenciales SIN tocar la conexión en uso ni guardar nada.
export async function probarCredenciales({ host, puerto, tls = true, usuario, clave = null, accessToken = null }) {
  const c = new ImapFlow({
    host, port: puerto, secure: tls,
    auth: accessToken ? { user: usuario, accessToken } : { user: usuario, pass: clave },
    logger: false,
    emitLogs: false,
    connectionTimeout: CONEXION_MS,
    greetingTimeout: SALUDO_MS,
    socketTimeout: OPERACION_MS,
  });
  c.on('error', () => { /* lo cuenta el await de abajo */ });
  await c.connect();
  return c;
}

export default { conImap, cerrar, explicar, probarCredenciales, cuentaPedida, SinCuenta, CuentaDesconocida, FalloDeCorreo };
