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

const CONEXION_MS = 15000;   // abrir el socket
const SALUDO_MS = 15000;     // que el servidor se presente
const OPERACION_MS = 60000;  // una búsqueda en un buzón grande puede tardar

let cliente = null;
let conectando = null;
let cola = Promise.resolve();

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
      mensaje: 'El servidor de correo ha rechazado el usuario o la contraseña. Si la cuenta es de '
        + 'Gmail o de Microsoft 365, la contraseña normal no sirve para IMAP: hace falta una '
        + 'contraseña de aplicación. Vuelve a conectar la cuenta desde la app de RobinSearch.',
    };
  }
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return { motivo: 'sin_conexion', mensaje: 'No se encuentra el servidor de correo. Comprueba que este ordenador tiene conexión y que el nombre del servidor es correcto (app de RobinSearch → Tu correo → Ajustes avanzados).' };
  }
  if (code === 'ECONNREFUSED') {
    return { motivo: 'puerto', mensaje: 'El servidor de correo rechaza la conexión en ese puerto. Revísalo en la app de RobinSearch → Tu correo → Ajustes avanzados.' };
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
    super('Todavía no hay ninguna cuenta de correo conectada. Ábrela en la app de RobinSearch → Tu correo. '
      + 'La contraseña se guarda en el llavero de este ordenador; RobinSearch nunca la pide por el chat.');
    this.motivo = 'sin_cuenta';
  }
}

export class FalloDeCorreo extends Error {
  constructor(err) {
    const { motivo, mensaje } = explicar(err);
    super(mensaje);
    this.motivo = motivo;
    this.code = err?.code || null;
  }
}

async function abrir() {
  const cfg = leerCorreo();
  if (!cfg.configurado) throw new SinCuenta();
  const clave = await llavero.leer(cfg.usuario);
  if (!clave) {
    const e = new SinCuenta();
    e.message = 'La cuenta de correo está configurada pero su contraseña no está en el llavero de este '
      + 'ordenador. Vuelve a conectarla en la app de RobinSearch → Tu correo.';
    throw e;
  }
  const c = new ImapFlow({
    host: cfg.imap.host,
    port: cfg.imap.puerto,
    secure: cfg.imap.tls,
    auth: { user: cfg.usuario, pass: clave },
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
    if (cliente === c) cliente = null;
  });
  c.on('close', () => { if (cliente === c) cliente = null; });
  await c.connect();
  return c;
}

async function conectar() {
  if (cliente?.usable) return cliente;
  if (!conectando) {
    conectando = abrir()
      .then((c) => { cliente = c; return c; })
      .catch((err) => { cliente = null; throw err; })
      .finally(() => { conectando = null; });
  }
  return conectando;
}

// Todas las operaciones van en fila: IMAP atiende una orden por conexión, y dos herramientas
// llamadas a la vez (Claude las encadena) se pisaban a mitad de un FETCH.
export function conImap(fn) {
  const turno = cola.then(async () => {
    try {
      return await fn(await conectar());
    } catch (err) {
      if (err instanceof SinCuenta) throw err;
      if (esFatal(err)) {
        // Una sola reconexión: si el servidor cerró por inactividad, el abogado no tiene por qué
        // enterarse. Si vuelve a fallar, se dice.
        try { cliente?.close(); } catch { /* ya cerrada */ }
        cliente = null;
        try {
          return await fn(await conectar());
        } catch (err2) {
          throw new FalloDeCorreo(err2);
        }
      }
      throw new FalloDeCorreo(err);
    }
  });
  // La cola sigue aunque este turno falle.
  cola = turno.then(() => undefined, () => undefined);
  return turno;
}

export async function cerrar() {
  const c = cliente;
  cliente = null;
  if (!c) return;
  try { await c.logout(); } catch { try { c.close(); } catch { /* nada */ } }
}

// Para la app: comprobar unas credenciales SIN tocar la conexión en uso ni guardar nada.
export async function probarCredenciales({ host, puerto, tls = true, usuario, clave }) {
  const c = new ImapFlow({
    host, port: puerto, secure: tls,
    auth: { user: usuario, pass: clave },
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

export default { conImap, cerrar, explicar, probarCredenciales, SinCuenta, FalloDeCorreo };
