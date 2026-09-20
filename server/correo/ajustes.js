// Lo NO secreto de la cuenta de correo: servidor, puerto, usuario, seguridad, carpetas y si el
// envío está permitido. Vive en el mismo ajustes.json que las carpetas de expedientes, bajo la
// clave `correo`. La CONTRASEÑA no está aquí — está en el llavero del sistema (llavero.js).
//
// Se escribe con las mismas garantías que el resto del fichero (persistencia.js: temporal +
// fsync + renombrado + .bak) y sin tocar `carpetas`, que gobierna la app de escritorio.

import fs from 'node:fs';
import { config, rutaAjustes } from '../config.js';
import { escribirJson, leerJson, conCerrojoDeFichero } from '../persistencia.js';

export const POR_DEFECTO = {
  usuario: null,
  // Cómo se entra en el buzón: 'contrasena' (la de siempre) o 'oauth' (la cuenta del proveedor).
  // Microsoft ya no admite la primera; Google la admite a regañadientes, con contraseña de
  // aplicación. El secreto correspondiente vive en el llavero en los dos casos.
  auth: 'contrasena',
  proveedor: null,
  imap: { host: null, puerto: 993, tls: true },
  smtp: { host: null, puerto: 587, seguridad: 'starttls' },
  // Resueltas por SPECIAL-USE la primera vez y recordadas: en Dovecot son «INBOX.Drafts», no
  // «Drafts», y preguntarlo en cada llamada es un viaje de ida y vuelta de más.
  carpetas: { borradores: null, enviados: null },
  // EL ENVÍO VIENE DESACTIVADO DE FÁBRICA. Se enciende con un interruptor en la app, nunca
  // desde una herramienta MCP: que el modelo pueda redactar no significa que pueda mandar.
  envioPermitido: false,
  configuradoEl: null,
};

// `leerCorreo()` lo llaman estado_servidor y todas las herramientas de correo, y cada llamada
// leía ajustes.json del disco de forma SÍNCRONA. En medio de un indexado —con el disco a tope y
// el hilo principal ocupado— eso es latencia metida justo en la herramienta que más se consulta.
// Se recuerda un par de segundos; quien escribe invalida al momento, así que nadie ve nunca un
// ajuste viejo por haber pulsado un botón en la app.
let cache = null;
const CACHE_MS = 2000;

function olvidarCache() {
  cache = null;
}

function leerFichero() {
  if (cache && Date.now() - cache.el < CACHE_MS) return cache.valor;
  let valor = {};
  try {
    valor = leerJson(rutaAjustes(config.dataDir)).valor || {};
  } catch {
    valor = {};
  }
  cache = { valor, el: Date.now() };
  return valor;
}

const num = (v, porDefecto) => (Number.isInteger(v) && v > 0 && v < 65536 ? v : porDefecto);
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function leerCorreo() {
  const c = leerFichero().correo;
  if (!c || typeof c !== 'object') return { ...POR_DEFECTO, configurado: false };
  return {
    usuario: texto(c.usuario),
    auth: c.auth === 'oauth' ? 'oauth' : 'contrasena',
    proveedor: texto(c.proveedor),
    imap: {
      host: texto(c.imap?.host),
      puerto: num(c.imap?.puerto, 993),
      tls: c.imap?.tls !== false,
    },
    smtp: {
      host: texto(c.smtp?.host),
      puerto: num(c.smtp?.puerto, 587),
      // 'starttls' (587), 'tls' (465) o 'ninguna' (25, solo redes internas).
      seguridad: ['starttls', 'tls', 'ninguna'].includes(c.smtp?.seguridad) ? c.smtp.seguridad : 'starttls',
    },
    carpetas: {
      borradores: texto(c.carpetas?.borradores),
      enviados: texto(c.carpetas?.enviados),
    },
    envioPermitido: c.envioPermitido === true,
    configuradoEl: texto(c.configuradoEl),
    configurado: Boolean(texto(c.usuario) && texto(c.imap?.host)),
  };
}

// Mezcla parcial: se escribe SOLO lo que llega y se conserva el resto (lo mismo que hace
// guardarNombres() con las carpetas). Con cerrojo de fichero porque la app de escritorio y el
// servidor pueden guardar a la vez: sin él, el segundo pisaba lo del primero.
export function guardarCorreo(parcial) {
  const ruta = rutaAjustes(config.dataDir);
  fs.mkdirSync(config.dataDir, { recursive: true });
  return conCerrojoDeFichero(ruta, () => {
    const actual = leerFichero();
    const previo = actual.correo && typeof actual.correo === 'object' ? actual.correo : {};
    const correo = {
      ...POR_DEFECTO,
      ...previo,
      ...parcial,
      imap: { ...POR_DEFECTO.imap, ...(previo.imap || {}), ...(parcial.imap || {}) },
      smtp: { ...POR_DEFECTO.smtp, ...(previo.smtp || {}), ...(parcial.smtp || {}) },
      carpetas: { ...POR_DEFECTO.carpetas, ...(previo.carpetas || {}), ...(parcial.carpetas || {}) },
    };
    escribirJson(ruta, { ...actual, correo }, { bak: true, indent: 2 });
    olvidarCache();
    return leerCorreo();
  });
}

// Olvidar la cuenta entera (el botón «Desconectar» de la app). La contraseña la borra del
// llavero quien llama: aquí solo se quita lo que hay en el fichero.
export function olvidarCorreo() {
  const ruta = rutaAjustes(config.dataDir);
  return conCerrojoDeFichero(ruta, () => {
    const actual = leerFichero();
    delete actual.correo;
    escribirJson(ruta, actual, { bak: true, indent: 2 });
    olvidarCache();
    return leerCorreo();
  });
}

export { olvidarCache };

export default { leerCorreo, guardarCorreo, olvidarCorreo, olvidarCache, POR_DEFECTO };
