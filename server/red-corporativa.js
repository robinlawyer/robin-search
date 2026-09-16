// Redes de despacho: certificados raíz propios y proxy.
//
// CERTIFICADOS. Muchos despachos (y sus antivirus: Kaspersky, ESET, Zscaler, un Fortinet) abren el
// tráfico HTTPS y lo vuelven a firmar con una autoridad propia que IT instala en el almacén del
// SISTEMA. Node no mira ese almacén: usa su lista interna de Mozilla. Resultado: el navegador y
// Outlook funcionan, y RobinSearch no puede iniciar sesión ni avisar de fallos
// («unable to get local issuer certificate»). Desde Node 22.19 / 24.5 existe
// tls.setDefaultCACertificates: se añaden los del sistema a los de siempre (nunca se quitan).
//
// PROXY. Node ≥ 22.21 / 24 solo respeta HTTPS_PROXY/HTTP_PROXY/NO_PROXY en fetch si arranca con
// NODE_USE_ENV_PROXY=1, y el agente de undici que lo hace (EnvHttpProxyAgent) NO se expone desde
// el propio Node: usarlo exigiría añadir la dependencia `undici`. No se hace; si hay proxy en el
// entorno y Node no lo va a usar, se deja dicho en el registro para que IT sepa qué pasa (y que
// puede lanzar Claude con NODE_USE_ENV_PROXY=1).

import tls from 'node:tls';

let _hecho = null;

export function usarCertificadosDelSistema() {
  if (_hecho) return _hecho;
  if (typeof tls.setDefaultCACertificates !== 'function' || typeof tls.getCACertificates !== 'function') {
    _hecho = { aplicado: false, motivo: 'node_sin_soporte' };
    return _hecho;
  }
  try {
    const defecto = tls.getCACertificates('default');
    const sistema = tls.getCACertificates('system');
    if (!sistema?.length) {
      _hecho = { aplicado: false, motivo: 'sin_certificados_de_sistema' };
      return _hecho;
    }
    const todos = [...new Set([...defecto, ...sistema])];
    tls.setDefaultCACertificates(todos);
    _hecho = { aplicado: true, sistema: sistema.length, total: todos.length };
  } catch (err) {
    // Un almacén del sistema ilegible no puede impedir arrancar: se sigue con los de Node.
    _hecho = { aplicado: false, motivo: String(err?.code || err?.message || err).slice(0, 80) };
  }
  return _hecho;
}

// ¿Hay un proxy en el entorno que fetch NO va a usar?
export function proxyIgnorado(env = process.env) {
  const hay = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some((k) => env[k]);
  return hay && env.NODE_USE_ENV_PROXY !== '1';
}

export default { usarCertificadosDelSistema, proxyIgnorado };
