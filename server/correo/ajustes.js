// Lo NO secreto de las cuentas de correo: servidor, puerto, usuario, seguridad, carpetas y si el
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
// Las direcciones se comparan sin mayúsculas: «Juan@Despacho.es» y «juan@despacho.es» son
// el mismo buzón, y tratarlas como dos dejaría una cuenta repetida con dos contraseñas.
const misma = (a, b) => Boolean(a && b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// ── VARIAS CUENTAS (Juan, 26-sep-2026) ──────────────────────────────────────────────────────
// «Igual que en Expedientes se puede configurar más de una carpeta, que en Correo electrónico se
// pueda configurar también más de una cuenta.» En el fichero, `correo.cuentas` es la lista; la
// PRIMERA es la principal: la que se usa cuando una herramienta no dice cuál.
//
// Hasta la 1.8.x el fichero guardaba UNA cuenta a pelo (`correo.usuario`, `correo.imap`…). Se
// sigue leyendo tal cual —nadie tiene que volver a conectar su correo al actualizar— y se pasa
// a la forma de lista la primera vez que se escribe.
function crudas() {
  const c = leerFichero().correo;
  if (!c || typeof c !== 'object') return [];
  if (Array.isArray(c.cuentas)) return c.cuentas.filter((x) => x && typeof x === 'object');
  return [c];
}

function normalizar(c) {
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

// Todas las cuentas conectadas, la principal primero.
export function leerCuentas() {
  return crudas().map(normalizar).filter((c) => c.configurado);
}

// Una cuenta: la pedida por su dirección o, sin pedir ninguna, la principal. Una dirección que
// no está conectada NO cae en la principal: devolvería el buzón de otra persona.
export function leerCorreo(cuenta = null) {
  const todas = crudas().map(normalizar);
  const conectadas = todas.filter((c) => c.configurado);
  const direcciones = conectadas.map((c) => c.usuario);
  if (cuenta) {
    const c = todas.find((x) => misma(x.usuario, cuenta));
    if (!c) return { ...POR_DEFECTO, configurado: false, desconocida: true, cuentas: direcciones };
    return { ...c, cuentas: direcciones };
  }
  const principal = conectadas[0] || todas[0];
  if (!principal) return { ...POR_DEFECTO, configurado: false, cuentas: [] };
  return { ...principal, cuentas: direcciones };
}

function escribirCuentas(actual, lista) {
  const correo = { cuentas: lista };
  escribirJson(rutaAjustes(config.dataDir), { ...actual, correo }, { bak: true, indent: 2 });
  olvidarCache();
}

// Mezcla parcial en UNA cuenta: se escribe SOLO lo que llega y se conserva el resto. ¿Cuál?
// La de `parcial.usuario` si viene (y si no existe, se AÑADE: es conectar otra); si no, la de
// `cuenta`; si no, la principal. Con cerrojo de fichero porque la app de escritorio y el
// servidor pueden guardar a la vez: sin él, el segundo pisaba lo del primero.
export function guardarCorreo(parcial, cuenta = null) {
  const ruta = rutaAjustes(config.dataDir);
  fs.mkdirSync(config.dataDir, { recursive: true });
  return conCerrojoDeFichero(ruta, () => {
    olvidarCache();
    const actual = leerFichero();
    const lista = crudas().map((c) => ({ ...c }));
    const quien = texto(parcial?.usuario) || texto(cuenta);
    // Sin decir cuál, la principal: la primera CONECTADA, la misma que devuelve leerCorreo().
    let i = quien ? lista.findIndex((c) => misma(c.usuario, quien))
      : Math.max(0, lista.findIndex((c) => normalizar(c).configurado));
    // Un hueco sin dirección (la forma vieja a medio rellenar) se aprovecha en vez de dejarlo.
    if (i < 0 && quien) i = lista.findIndex((c) => !texto(c.usuario));
    if (i < 0 || i >= lista.length) { lista.push({}); i = lista.length - 1; }
    const previo = lista[i];
    lista[i] = {
      ...POR_DEFECTO,
      ...previo,
      ...parcial,
      imap: { ...POR_DEFECTO.imap, ...(previo.imap || {}), ...(parcial.imap || {}) },
      smtp: { ...POR_DEFECTO.smtp, ...(previo.smtp || {}), ...(parcial.smtp || {}) },
      carpetas: { ...POR_DEFECTO.carpetas, ...(previo.carpetas || {}), ...(parcial.carpetas || {}) },
    };
    escribirCuentas(actual, lista);
    return leerCorreo(lista[i].usuario || null);
  });
}

// Olvidar una cuenta (el «Desconectar» de su fila en la app), o todas si no se dice cuál. La
// contraseña la borra del llavero quien llama: aquí solo se quita lo que hay en el fichero.
export function olvidarCorreo(cuenta = null) {
  const ruta = rutaAjustes(config.dataDir);
  return conCerrojoDeFichero(ruta, () => {
    olvidarCache();
    const actual = leerFichero();
    if (!cuenta) {
      delete actual.correo;
      escribirJson(ruta, actual, { bak: true, indent: 2 });
      olvidarCache();
      return leerCorreo();
    }
    const lista = crudas().filter((c) => !misma(c.usuario, cuenta));
    if (lista.length) escribirCuentas(actual, lista);
    else {
      delete actual.correo;
      escribirJson(ruta, actual, { bak: true, indent: 2 });
      olvidarCache();
    }
    return leerCorreo();
  });
}

export { olvidarCache };

export default { leerCorreo, leerCuentas, guardarCorreo, olvidarCorreo, olvidarCache, POR_DEFECTO };
