// Los certificados del SISTEMA, además de los de Node. IMPORTAR AL PRINCIPIO (server/index.js y
// cli/index.js), antes de que nada abra una conexión.
//
// 🔴 8-oct-2026 (Pedro, juridico@asesoria-ibc.com, Windows): desde el 21-sep su RobinSearch no
// llegaba a api.robinlawyer.ai —ni una petición en el servidor— mientras Edge, Claude y
// RobinDesktop, en el mismo ordenador, entraban sin problema. Vivió 14 días de la sesión guardada
// y después el login no podía terminar: el navegador autorizaba, pero RobinSearch no podía recoger
// el código. Es lo que pasa con los antivirus que revisan HTTPS (ESET, Kaspersky, Avast,
// Bitdefender…) y con los proxies de despacho: ponen su propio certificado y lo dan de alta en
// Windows. Los navegadores y Electron usan el almacén de Windows y lo aceptan; Node solo confía
// en su lista propia, ve un certificado que no conoce y corta antes de mandar nada.
//
// Arreglo: se SUMAN los certificados del sistema (almacén de Windows, Llavero de macOS) a los de
// Node, como hace el navegador. Nunca se quita ninguno. Requiere tls.getCACertificates y
// tls.setDefaultCACertificates (Node 22.19 / 24.5); Claude Desktop trae Node 24 (Electron 44). Con
// un Node más viejo se queda como estaba. Probado en el Node de Electron 44.4.3 (BoringSSL):
// fetch y https usan los nuevos.
//
// ROBIN_SIN_CERTIFICADOS_SISTEMA=1 lo desactiva. ROBIN_PRUEBA_CA_SISTEMA=<pem> sustituye al
// almacén del sistema, SOLO para test-certificados.mjs (quien puede poner variables de entorno
// ya podía usar NODE_EXTRA_CA_CERTS, así que no abre nada nuevo).
import tls from 'node:tls';
import fs from 'node:fs';

function delSistema() {
  const prueba = process.env.ROBIN_PRUEBA_CA_SISTEMA;
  if (prueba) return [fs.readFileSync(prueba, 'utf8')];
  return tls.getCACertificates('system');
}

function aplicar() {
  if (process.env.ROBIN_SIN_CERTIFICADOS_SISTEMA === '1') return { aplicado: false, motivo: 'desactivado' };
  if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
    return { aplicado: false, motivo: 'node_sin_soporte' };
  }
  try {
    const sistema = delSistema() || [];
    if (!sistema.length) return { aplicado: false, motivo: 'sistema_vacio', sistema: 0 };
    const base = tls.getCACertificates('default');
    const todos = [...new Set([...base, ...sistema])];
    if (todos.length === base.length) return { aplicado: false, motivo: 'ya_incluidos', sistema: sistema.length };
    tls.setDefaultCACertificates(todos);
    return { aplicado: true, sistema: sistema.length, total: todos.length };
  } catch (e) {
    // Un almacén ilegible no puede impedir que RobinSearch arranque: se sigue con los de Node.
    return { aplicado: false, motivo: 'error', error: String(e?.message ?? e).slice(0, 200) };
  }
}

export const certificadosSistema = aplicar();
