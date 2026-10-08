// El DERECHO DE USO de RobinSearch, comprobado EN ESTE ORDENADOR (Juan, 8-oct-2026, caso Pedro).
//
// Hasta la 1.11 las herramientas exigían una sesión viva con RobinLawyer.ai aunque ninguna la usa
// para nada: buscar en los expedientes, el índice, las anotaciones y el correo son 100 % locales. Un
// RobinSearch que no podía salir a internet (el de Pedro, desde la red de su despacho) se quedaba sin
// nada a los 14 días, correo incluido.
//
// Ahora el servidor firma un CERTIFICADO DE LICENCIA (Ed25519) con de quién es, qué plan tiene, si da
// derecho de uso y hasta cuándo vale (30 días desde que se emite; o el fin de la demo, si llega antes).
// Se guarda en `licencia.json` y se comprueba sin red con la clave pública que va aquí dentro: nadie
// puede fabricarlo ni alargarlo. Si caduca porque no se ha podido renovar (sin red), hay 30 días más
// de gracia — salvo que la licencia misma haya terminado (una demo no tiene gracia).
//
// Esto no envía nada nuevo al servidor: solo cambia cuándo se comprueba la licencia.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDirs } from '../config.js';
import { log } from '../logger.js';

// kid → clave pública Ed25519 (32 bytes, base64url). Para rotar la clave: se añade la nueva aquí,
// se publica esta versión, y solo después el servidor firma con ella.
export const CLAVES_PUBLICAS = {
  rs1: 'UxSVS_nv8wMh3RlzhjCWKKbu9hv2XJR4zh2u-TJXzmE',
};

const DIA = 24 * 3600 * 1000;
const ruta = () => path.join(config.dataDir, 'licencia.json');

const b64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function clavePublica(kid) {
  const extra = process.env.ROBIN_LICENCIA_CLAVE_PRUEBA; // solo pruebas: "kid:clave"
  if (extra && extra.split(':')[0] === kid) return extra.split(':')[1];
  return CLAVES_PUBLICAS[kid] || null;
}

function aClaveNode(raw32b64u) {
  // SPKI DER de Ed25519 = prefijo fijo de 12 bytes + los 32 de la clave.
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), b64u(raw32b64u)]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

// Devuelve los datos si la firma es buena; null si no.
export function verificar(certificado) {
  try {
    const [cuerpo, firma] = String(certificado || '').split('.');
    if (!cuerpo || !firma) return null;
    const datos = JSON.parse(b64u(cuerpo).toString('utf8'));
    const pub = clavePublica(datos?.kid);
    if (!pub) return null;
    const ok = crypto.verify(null, Buffer.from(cuerpo, 'ascii'), aClaveNode(pub), b64u(firma));
    return ok ? datos : null;
  } catch {
    return null;
  }
}

export function leer() {
  try {
    const g = JSON.parse(fs.readFileSync(ruta(), 'utf8'));
    const datos = verificar(g?.certificado);
    return datos ? { certificado: g.certificado, datos, recibido: g.recibido || null } : null;
  } catch {
    return null;
  }
}

export function guardar(certificado) {
  const datos = verificar(certificado);
  if (!datos) {
    log.warn('El servidor devolvió un certificado de licencia que no se puede verificar');
    return null;
  }
  ensureDataDirs();
  fs.writeFileSync(ruta(), JSON.stringify({ certificado, recibido: new Date(Date.now()).toISOString() }), { mode: 0o600 });
  return datos;
}

export function borrar() {
  try { fs.rmSync(ruta(), { force: true }); } catch { /* ya no está */ }
}

// ¿Puede usarse RobinSearch AHORA, sin preguntar a nadie?
//   { ok, modo: 'licencia'|'gracia', hasta, dias_restantes, datos }  o
//   { ok:false, motivo: 'sin_certificado'|'sin_derecho'|'caducado', datos? }
export function derechoDeUso(ahora = Date.now()) {
  const c = leer();
  if (!c) return { ok: false, motivo: 'sin_certificado' };
  const d = c.datos;
  // El certificado vale para la cuenta con que se emitió: si el abogado entra con otra, se renueva.
  if (!d.uso) return { ok: false, motivo: 'sin_derecho', estado: d.estado, datos: d };
  const valido = Date.parse(d.valido_hasta);
  const licenciaHasta = d.licencia_hasta ? Date.parse(d.licencia_hasta) : null;
  if (!Number.isFinite(valido)) return { ok: false, motivo: 'sin_certificado' };
  // Un reloj atrasado más de un día respecto a la emisión: no se le da crédito al reloj.
  const emitido = Date.parse(d.emitido);
  if (Number.isFinite(emitido) && ahora < emitido - DIA) return { ok: false, motivo: 'reloj', datos: d };
  if (ahora < valido) {
    return { ok: true, modo: 'licencia', hasta: new Date(valido).toISOString(), dias_restantes: Math.floor((valido - ahora) / DIA), datos: d };
  }
  // Gracia: solo si la licencia sigue (de pago que se renueva sola, o con fecha posterior).
  const conGracia = d.renovable || licenciaHasta === null || licenciaHasta > valido;
  if (conGracia) {
    let fin = valido + (Number(d.gracia_dias) || 0) * DIA;
    if (licenciaHasta !== null && !d.renovable) fin = Math.min(fin, licenciaHasta);
    if (ahora < fin) {
      return { ok: true, modo: 'gracia', hasta: new Date(fin).toISOString(), dias_restantes: Math.floor((fin - ahora) / DIA), datos: d };
    }
  }
  return { ok: false, motivo: 'caducado', estado: d.estado, datos: d };
}

// ¿Toca pedir otro? (más de 24 h desde el último, o ya en gracia, o sin certificado)
export function tocaRenovar(ahora = Date.now()) {
  const c = leer();
  if (!c) return true;
  const recibido = c.recibido ? Date.parse(c.recibido) : 0;
  return ahora - recibido > DIA || ahora > Date.parse(c.datos.valido_hasta) - 7 * DIA;
}

export default { verificar, leer, guardar, borrar, derechoDeUso, tocaRenovar, CLAVES_PUBLICAS };
