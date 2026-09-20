// Quién hay detrás de una dirección de correo, y cómo se entra en su servidor.
//
// Hasta la 1.7.0 solo había un camino: usuario y contraseña. Eso deja fuera a Microsoft 365 y a
// Outlook.com, que anuncian LOGINDISABLED y solo aceptan XOAUTH2 (comprobado en vivo el
// 20-sep-2026), y deja a Gmail dependiendo de que el abogado sepa fabricarse una contraseña de
// aplicación. Aquí se decide, a partir de la dirección, qué camino toca — para que el abogado
// solo tenga que escribir su correo y pulsar un botón.
//
// La detección NO pregunta a ningún tercero sobre el dominio del despacho: mira los registros
// MX del propio dominio (que es su DNS) y, si hace falta, le pregunta a su propio servidor qué
// sabe hacer. Mismo criterio que la autodetección de servidores.

import dns from 'node:dns/promises';
import { dominioDe, capacidades, exigeOauth } from './autodeteccion.js';

// Los dos proveedores que exigen (o prefieren) OAuth. El `clientId` no viaja en el código: es
// nuestra alta de aplicación y se inyecta al empaquetar o por variable de entorno, para poder
// rotarla sin publicar una versión nueva de la extensión.
// Escotilla SOLO para las pruebas: apunta los dos proveedores a un servidor OAuth de mentira,
// para poder recorrer el flujo entero (incluida la renovación y el permiso retirado) sin altas
// de aplicación, sin navegador y sin red.
const BASE_PRUEBA = process.env.ROBIN_CORREO_OAUTH_PRUEBA || null;
const punto = (url, cual) => (BASE_PRUEBA ? `${BASE_PRUEBA}/${cual}` : url);

export const PROVEEDORES = {
  microsoft: {
    id: 'microsoft',
    nombre: 'Microsoft 365 / Outlook.com',
    // `common` = vale tanto para una cuenta de empresa (365) como para una personal (Outlook.com).
    get autorizacion() { return punto('https://login.microsoftonline.com/common/oauth2/v2.0/authorize', 'authorize'); },
    get token() { return punto('https://login.microsoftonline.com/common/oauth2/v2.0/token', 'token'); },
    // `offline_access` es lo que da el refresh token: sin él habría que volver a entrar cada hora.
    ambitos: [
      'offline_access',
      'openid',
      'email',
      'https://outlook.office.com/IMAP.AccessAsUser.All',
      'https://outlook.office.com/SMTP.Send',
    ].join(' '),
    // Nuestra alta de aplicación en Entra ID (21-sep-2026). NO es un secreto: en una aplicación
    // de escritorio el identificador de cliente es público por diseño —lo que protege el flujo es
    // PKCE, no esconder esto—, y por eso no hay ningún secreto de cliente en el registro.
    // La variable de entorno manda, para poder rotarlo sin publicar una versión nueva.
    clientId: () => process.env.ROBIN_CORREO_MS_CLIENT_ID || 'dfb9202d-bac5-44b1-a75b-303af95f93f3',

    imap: { host: 'outlook.office365.com', puerto: 993, tls: true },
    smtp: { host: 'smtp.office365.com', puerto: 587, seguridad: 'starttls' },
    // `select_account`: si el abogado ya tiene una sesión de Microsoft abierta, sin esto se
    // conecta ESA sin preguntar. Y es muy normal tener dos —la personal y la del despacho—:
    // conectar la equivocada sin que se entere es de las peores cosas que podría pasar aquí.
    extra: { prompt: 'select_account' },
  },
  google: {
    id: 'google',
    nombre: 'Gmail / Google Workspace',
    get autorizacion() { return punto('https://accounts.google.com/o/oauth2/v2/auth', 'authorize'); },
    get token() { return punto('https://oauth2.googleapis.com/token', 'token'); },
    // Google no trocea el correo por permisos: para IMAP y SMTP es este ámbito o ninguno.
    ambitos: 'https://mail.google.com/',
    clientId: () => process.env.ROBIN_CORREO_GOOGLE_CLIENT_ID || null,
    imap: { host: 'imap.gmail.com', puerto: 993, tls: true },
    smtp: { host: 'smtp.gmail.com', puerto: 587, seguridad: 'starttls' },
    // Sin `access_type=offline` Google no devuelve refresh token, y sin `prompt=consent` deja de
    // devolverlo a partir de la segunda vez: el abogado tendría que volver a entrar cada hora.
    extra: { access_type: 'offline', prompt: 'consent' },
  },
};

export function proveedor(id) {
  return PROVEEDORES[id] || null;
}

// Dominios de consumo, que no tienen MX que mirar con criterio.
const DIRECTOS = {
  microsoft: /^(outlook\.(com|es)|hotmail\.(com|es|co\.uk)|live\.(com|es)|msn\.com)$/i,
  google: /^(gmail\.com|googlemail\.com)$/i,
};

// Proveedores que SÍ aceptan contraseña por IMAP, pero no la de la cuenta: exigen una
// «contraseña de aplicación» que el abogado tiene que fabricarse. Si no se le dice, escribe la
// suya, el servidor la rechaza y la conclusión a la que llega es que RobinSearch no funciona.
const CONTRASENA_DE_APLICACION = {
  apple: { re: /^(icloud\.com|me\.com|mac\.com)$/i, nombre: 'iCloud', donde: 'account.apple.com → Iniciar sesión y seguridad → Contraseñas de apps' },
  yahoo: { re: /^(yahoo\.[a-z.]+|ymail\.com|rocketmail\.com)$/i, nombre: 'Yahoo', donde: 'la seguridad de tu cuenta de Yahoo → Generar contraseña de aplicación' },
  aol: { re: /^aol\.com$/i, nombre: 'AOL', donde: 'la seguridad de tu cuenta de AOL → Generar contraseña de aplicación' },
};

export function exigeContrasenaDeAplicacion(dominio) {
  const k = Object.keys(CONTRASENA_DE_APLICACION).find((x) => CONTRASENA_DE_APLICACION[x].re.test(dominio));
  return k ? { id: k, ...CONTRASENA_DE_APLICACION[k] } : null;
}

// Por dónde entrega el correo ESE dominio. Es el dato honesto: un despacho con dominio propio
// alojado en Microsoft tiene MX en «…mail.protection.outlook.com», y uno en Google, en
// «aspmx.l.google.com». Mirarlo evita el «pruebe su contraseña» que no va a funcionar nunca.
export async function porMx(dominio) {
  try {
    const mx = await dns.resolveMx(dominio);
    const nombres = mx.map((m) => String(m.exchange).toLowerCase()).join(' ');
    if (/\.outlook\.com|\.protection\.outlook\.com|\.office365\.com/.test(nombres)) return 'microsoft';
    if (/aspmx.*\.google\.com|\.googlemail\.com|\.google\.com$/.test(nombres)) return 'google';
    return null;
  } catch {
    return null;
  }
}

// Devuelve cómo hay que entrar en el buzón de esta dirección:
//   { via: 'oauth',      proveedor, razon }   → botón «Continuar con …»
//   { via: 'contrasena', proveedor: null }    → el formulario de siempre
//   { via: 'oauth_sin_alta', proveedor }      → es OAuth, pero no tenemos alta de aplicación:
//                                               hay que decirlo, no fingir que se puede
export async function comoEntrar(direccion, { sondearServidor = true } = {}) {
  const dominio = dominioDe(direccion);
  if (!dominio) return { via: 'contrasena', proveedor: null, razon: 'direccion_invalida' };

  const appPass = exigeContrasenaDeAplicacion(dominio);
  if (appPass) {
    return {
      via: 'contrasena', proveedor: null, razon: 'dominio_conocido',
      alternativa: 'contrasena_de_aplicacion', servicio: appPass.nombre, donde: appPass.donde,
    };
  }

  let id = Object.keys(DIRECTOS).find((k) => DIRECTOS[k].test(dominio)) || null;
  let razon = id ? 'dominio_conocido' : null;
  if (!id) {
    id = await porMx(dominio);
    if (id) razon = 'registros_mx';
  }

  // Un servidor que anuncia LOGINDISABLED no acepta contraseña, sea de quien sea. Si además no
  // sabemos de quién es, no se puede hacer nada por el abogado más que decírselo con claridad.
  if (!id && sondearServidor) {
    const caps = await capacidades(`mail.${dominio}`, 993).catch(() => null);
    if (exigeOauth(caps)) return { via: 'oauth_desconocido', proveedor: null, razon: 'logindisabled' };
  }

  if (!id) return { via: 'contrasena', proveedor: null, razon: 'sin_proveedor_conocido' };
  const p = PROVEEDORES[id];
  // Gmail admite contraseña de aplicación, así que sin alta de aplicación aún queda salida; en
  // Microsoft no queda ninguna, y hay que decirlo tal cual.
  if (!p.clientId()) {
    return { via: 'oauth_sin_alta', proveedor: id, razon, alternativa: id === 'google' ? 'contrasena_de_aplicacion' : null };
  }
  return { via: 'oauth', proveedor: id, razon };
}

export default { PROVEEDORES, proveedor, comoEntrar, porMx, exigeContrasenaDeAplicacion };
