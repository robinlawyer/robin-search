// Envío por SMTP. Lo único de todo el módulo de correo que sale del ordenador hacia fuera y que
// el destinatario ve, así que es también lo único con candado doble:
//   1. El envío viene DESACTIVADO de fábrica (ajustes.correo.envioPermitido = false). Se
//      enciende con un interruptor en la app de escritorio, nunca desde una herramienta MCP.
//   2. Aun encendido, la herramienta exige `confirmar: true` en cada llamada.
// Lo normal es que Robin redacte y deje el borrador; mandar un correo a un cliente o a la
// contraparte es un acto del abogado, no del modelo.

import nodemailer from 'nodemailer';
import { log } from '../logger.js';
import { leerCorreo } from './ajustes.js';
import * as llavero from './llavero.js';
import { explicar } from './conexion.js';

const CONEXION_MS = 20000;
const ENVIO_MS = 60000;

// `secure: true` es TLS desde el primer byte (465). En 587 se abre en claro y se sube a TLS con
// STARTTLS: `requireTLS` obliga a que suba — sin él, un servidor que no anuncie STARTTLS se
// tragaría la contraseña en claro sin decir nada.
export function opcionesTransporte(cfg, clave) {
  const seguridad = cfg.smtp.seguridad;
  return {
    host: cfg.smtp.host,
    port: cfg.smtp.puerto,
    secure: seguridad === 'tls',
    requireTLS: seguridad === 'starttls',
    auth: { user: cfg.usuario, pass: clave },
    connectionTimeout: CONEXION_MS,
    greetingTimeout: CONEXION_MS,
    socketTimeout: ENVIO_MS,
    // nodemailer registra por su cuenta si se le deja: en MCP, stdout es del JSON-RPC, y
    // además esos registros llevan destinatarios.
    logger: false,
    debug: false,
  };
}

async function transporte() {
  const cfg = leerCorreo();
  if (!cfg.configurado || !cfg.smtp.host) {
    throw Object.assign(new Error('No hay servidor de envío configurado. Ábrelo en la app de RobinSearch → Tu correo.'), { motivo: 'sin_cuenta' });
  }
  const clave = await llavero.leer(cfg.usuario);
  if (!clave) {
    throw Object.assign(new Error('La contraseña del correo no está en el llavero de este ordenador. Vuelve a conectar la cuenta en la app de RobinSearch.'), { motivo: 'sin_cuenta' });
  }
  return { transporte: nodemailer.createTransport(opcionesTransporte(cfg, clave)), cfg };
}

// Comprueba que el servidor de envío acepta las credenciales, sin mandar nada. Es lo que
// ejecuta el botón «Conectar» de la app.
export async function comprobar(cfgExplicita = null, claveExplicita = null) {
  let t;
  try {
    if (cfgExplicita) {
      t = nodemailer.createTransport(opcionesTransporte(cfgExplicita, claveExplicita));
    } else {
      ({ transporte: t } = await transporte());
    }
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, ...explicar(err) };
  } finally {
    try { t?.close(); } catch { /* nada */ }
  }
}

// Envía un mensaje ya compuesto en crudo. `sobre` fija quién manda y a quién va de verdad
// (el SMTP no mira las cabeceras): así el Cco no acaba visible en las cabeceras.
export async function enviarCrudo({ raw, de, destinatarios }) {
  const { transporte: t } = await transporte();
  try {
    const info = await t.sendMail({ envelope: { from: de, to: destinatarios }, raw });
    // Ni destinatarios ni asunto: solo que salió y cuántos aceptó el servidor.
    log.info('Correo enviado', { aceptados: info?.accepted?.length ?? null, rechazados: info?.rejected?.length ?? 0 });
    return { ok: true, aceptados: info?.accepted?.length ?? 0, rechazados: info?.rejected?.length ?? 0 };
  } finally {
    try { t.close(); } catch { /* nada */ }
  }
}

export default { enviarCrudo, comprobar, opcionesTransporte };
