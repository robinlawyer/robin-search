// `robin-search correo …` — la ÚNICA puerta por la que entra la contraseña del buzón.
//
// Ni una herramienta MCP la recibe: lo que llega por una tool acaba en el contexto del modelo
// y de ahí en el historial de la conversación. La app de escritorio llama a este CLI y le
// escribe la contraseña por la ENTRADA ESTÁNDAR: así tampoco aparece en `ps` ni en el
// historial de la shell, que es lo que pasa con cualquier `--password=…`.
//
// Todo devuelve JSON por stdout (la app lo lee) y nunca imprime la contraseña.

import { detectar, dominioDe, capacidades, exigeOauth } from './autodeteccion.js';
import { comoEntrar, proveedor as buscarProveedor } from './proveedores.js';
import * as oauth from './oauth-correo.js';
import { leerCorreo, guardarCorreo, olvidarCorreo } from './ajustes.js';
import * as llavero from './llavero.js';
import * as carpetasMod from './carpetas.js';
import { probarCredenciales, explicar, credenciales } from './conexion.js';
import { comprobar as comprobarSmtp } from './smtp.js';
import { componer } from './redaccion.js';

const AYUDA = `robin-search correo — conectar el buzón del abogado (la contraseña NUNCA va en la orden).

  correo estado                     Qué cuenta hay conectada (sin contraseña).
  correo detectar --direccion=…     Averigua el servidor y cómo hay que entrar en él.
  correo entrar --direccion=…       Dice si esa cuenta va por contraseña o por su proveedor.
  correo proveedor --proveedor=microsoft|google [--direccion=…]
                                    Conecta con la cuenta del proveedor (abre el navegador).
                                    Es la ÚNICA forma con Microsoft 365 y Outlook.com.
  correo conectar --direccion=…     Conecta la cuenta. LA CONTRASEÑA SE LEE POR STDIN:
                                      printf '%s' 'la-contraseña' | robin-search correo conectar --direccion=…
                                    Opciones: --imap-host --imap-puerto --sin-tls
                                              --smtp-host --smtp-puerto --smtp-seguridad=starttls|tls|ninguna
                                              --carpeta-borradores --carpeta-enviados
  correo probar                     Comprueba entrada, borradores y envío contra el servidor.
  correo envio --permitir|--bloquear   Permite o bloquea que Robin envíe (de fábrica: bloqueado).
  correo olvidar                    Borra la cuenta y su contraseña del llavero.
`;

function banderas(argv) {
  const o = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, ...v] = a.slice(2).split('=');
      o[k] = v.length ? v.join('=') : true;
    } else o._.push(a);
  }
  return o;
}

function salida(objeto) {
  process.stdout.write(`${JSON.stringify(objeto, null, 2)}\n`);
  return objeto.ok === false ? 1 : 0;
}

// La contraseña, por stdin y sin dejar rastro. Se corta el salto de línea final que añade
// cualquier `echo`, pero NO los espacios: hay contraseñas que empiezan o acaban por espacio.
function leerStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let d = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (t) => { d += t; });
    process.stdin.on('end', () => resolve(d.replace(/\r?\n$/, '')));
    process.stdin.on('error', () => resolve(''));
  });
}

const entero = (v, pordefecto) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : pordefecto;
};

// Resumen de la cuenta SIN nada secreto: es lo que pinta la app.
async function estado() {
  const c = leerCorreo();
  return {
    ok: true,
    configurado: c.configurado,
    usuario: c.usuario,
    auth: c.auth,
    proveedor: c.proveedor,
    imap: c.imap,
    smtp: c.smtp,
    carpetas: c.carpetas,
    envioPermitido: c.envioPermitido,
    configuradoEl: c.configuradoEl,
    llavero: await llavero.respaldo(),
    aviso_llavero: await llavero.aviso(),
    clave_guardada: c.usuario
      ? Boolean(c.auth === 'oauth' ? await oauth.leerPermiso(c.usuario) : await llavero.leer(c.usuario))
      : false,
  };
}

// EL CASO QUE MÁS DUELE al conectar: el servidor lo hemos adivinado nosotros, existe y contesta,
// pero no es el suyo — en el hosting compartido hay servidores que responden a cualquier dominio.
// El servidor dice «credenciales incorrectas» y, tal cual, mandaríamos al abogado a dudar de su
// contraseña, que es correcta. Si el servidor no lo escribió él, se le dicen las DOS
// posibilidades, con el nombre del que hemos probado, y se le lleva a los ajustes avanzados.
export function explicarAlConectar(err, { host, deducido }) {
  const fallo = explicar(err);
  if (fallo.motivo !== 'credenciales' || !deducido) return fallo;
  return {
    motivo: 'credenciales_o_servidor',
    mensaje: `He buscado tu servidor de correo y he probado con «${host}», pero ha rechazado la `
      + 'contraseña. Puede ser una de dos cosas: que la contraseña no sea esa, o que ese no sea tu '
      + 'servidor — lo he deducido del nombre de tu dominio, y no siempre se acierta. Si estás seguro de '
      + 'la contraseña, pídele a quien lleve la informática del despacho el servidor de entrada (IMAP) y '
      + 'el de salida (SMTP) y ponlos en Ajustes avanzados.',
  };
}

async function conectar(o) {
  const direccion = String(o.direccion || o.usuario || '').trim();
  if (!direccion || !dominioDe(direccion)) return salida({ ok: false, motivo: 'direccion', mensaje: 'Hace falta --direccion=tu@despacho.es' });
  // Antes de nada: ¿esta dirección admite siquiera contraseña? Con Microsoft, no — y dejar que
  // el abogado teclee tres veces la suya es la peor forma de contárselo.
  const entrada = await comoEntrar(direccion, { sondearServidor: false });
  if (entrada.via === 'oauth') {
    return salida({
      ok: false, motivo: 'usa_oauth', proveedor: entrada.proveedor,
      mensaje: `Esa cuenta es de ${buscarProveedor(entrada.proveedor).nombre}: se conecta entrando en tu propia cuenta, no con una contraseña.`,
    });
  }
  if (entrada.via === 'oauth_sin_alta' && entrada.proveedor === 'microsoft') {
    return salida({
      ok: false, motivo: 'sin_alta', proveedor: 'microsoft',
      mensaje: 'Esa cuenta es de Microsoft 365 u Outlook.com, que ya no aceptan contraseña en IMAP, y '
        + 'todavía no está disponible la conexión con la cuenta de Microsoft. Avísanos y te decimos en cuanto lo esté.',
    });
  }

  const clave = await leerStdin();
  if (!clave) return salida({ ok: false, motivo: 'sin_clave', mensaje: 'La contraseña se pasa por la entrada estándar, nunca como argumento.' });

  // Lo que no diga el abogado, se averigua; lo que diga él, manda.
  let imap = { host: o['imap-host'] || null, puerto: entero(o['imap-puerto'], 993), tls: o['sin-tls'] !== true };
  let smtp = {
    host: o['smtp-host'] || null,
    puerto: entero(o['smtp-puerto'], 587),
    seguridad: ['starttls', 'tls', 'ninguna'].includes(o['smtp-seguridad']) ? o['smtp-seguridad'] : 'starttls',
  };
  let deteccion = null;
  if (!imap.host || !smtp.host) {
    deteccion = await detectar(direccion);
    if (!imap.host && deteccion.imap) imap = { ...deteccion.imap };
    if (!smtp.host && deteccion.smtp) smtp = { ...deteccion.smtp };
  }
  if (!imap.host) {
    return salida({
      ok: false, motivo: 'sin_servidor', deteccion,
      mensaje: 'No se ha podido averiguar el servidor de correo de ese dominio. Pídeselo a quien lleve '
        + 'la informática del despacho y ponlo en Ajustes avanzados (suele ser mail.tu-dominio.es, puerto 993).',
    });
  }

  // Microsoft (365 y Outlook.com personal) anuncia LOGINDISABLED: ahí la contraseña no sirve,
  // haga lo que haga el abogado, y hay que decírselo ANTES de que pruebe tres contraseñas y
  // llame al despacho pensando que se ha equivocado.
  if (imap.tls) {
    const caps = await capacidades(imap.host, imap.puerto);
    if (exigeOauth(caps)) {
      return salida({
        ok: false, motivo: 'exige_oauth', imap, smtp, deteccion,
        mensaje: 'Ese servidor de correo (Microsoft 365 u Outlook.com) ya no admite conectarse con '
          + 'usuario y contraseña: exige iniciar sesión con la cuenta de Microsoft, y eso RobinSearch '
          + 'todavía no lo hace. No es culpa de tu contraseña ni de una contraseña de aplicación: '
          + 'Microsoft lo desactivó para todos y no se puede volver a activar. Avísanos y te decimos '
          + 'en cuanto esté disponible.',
      });
    }
  }

  // ¿El servidor lo ha puesto el abogado, o lo hemos deducido nosotros? Cambia por completo lo
  // que hay que decirle si falla.
  const servidorDeducido = !o['imap-host'];

  // Se comprueba ANTES de guardar nada: no se deja una cuenta configurada que no funciona.
  let cliente;
  try {
    cliente = await probarCredenciales({ ...imap, puerto: imap.puerto, usuario: direccion, clave });
  } catch (err) {
    return salida({ ok: false, ...explicarAlConectar(err, { host: imap.host, deducido: servidorDeducido }), imap, smtp, deteccion, servidor_deducido: servidorDeducido });
  }
  let inventario;
  try {
    inventario = await carpetasMod.inventario(cliente);
  } finally {
    try { await cliente.logout(); } catch { /* da igual */ }
  }

  const guardada = await llavero.guardar(direccion, clave);
  if (!guardada) {
    return salida({ ok: false, motivo: 'llavero', mensaje: 'La contraseña es correcta pero el llavero del sistema no la ha aceptado. Vuelve a intentarlo; si persiste, avisa a RobinLawyer.ai.' });
  }
  guardarCorreo({
    usuario: direccion,
    auth: 'contrasena',
    proveedor: null,
    imap,
    smtp,
    carpetas: {
      borradores: o['carpeta-borradores'] || inventario.carpetas.borradores || null,
      enviados: o['carpeta-enviados'] || inventario.carpetas.enviados || null,
    },
    configuradoEl: new Date().toISOString(),
  });
  carpetasMod.olvidarCache();
  return salida({ ok: true, ...(await estado()), deteccion, inventario });
}

// La prueba de fuego: entrar, mirar la bandeja, crear un borrador de verdad y borrarlo, y
// comprobar el envío sin mandar nada. Es lo que ejecuta el botón «Conectar» de la app.
async function probar() {
  const cfg = leerCorreo();
  if (!cfg.configurado) return salida({ ok: false, motivo: 'sin_cuenta', mensaje: 'No hay ninguna cuenta conectada.' });
  // El secreto puede ser una contraseña del llavero o un token de acceso del proveedor.
  let secreto;
  try {
    secreto = await credenciales(cfg);
  } catch (err) {
    return salida({ ok: false, motivo: err?.motivo || 'sin_clave', mensaje: err?.message || 'No hay con qué entrar en el buzón.' });
  }

  const pasos = { entrada: null, carpetas: null, borrador: null, envio: null };
  let cliente;
  try {
    cliente = await probarCredenciales({ ...cfg.imap, usuario: cfg.usuario, clave: secreto.pass, accessToken: secreto.accessToken });
    pasos.entrada = { ok: true };
  } catch (err) {
    pasos.entrada = { ok: false, ...explicar(err) };
    return salida({ ok: false, pasos });
  }
  try {
    const inv = await carpetasMod.inventario(cliente);
    pasos.carpetas = { ok: Boolean(inv.carpetas.borradores), ...inv };

    const cerrojo = await cliente.getMailboxLock('INBOX', { readOnly: true });
    try {
      pasos.entrada.mensajes = cliente.mailbox?.exists ?? null;
    } finally {
      cerrojo.release();
    }

    if (inv.carpetas.borradores) {
      // Un borrador de verdad, con su marca \Draft, y se borra acto seguido. Comprobar que se
      // puede escribir es la mitad del valor de esta función: un buzón de solo lectura o una
      // cuota llena solo se descubren al intentarlo.
      const { raw } = await componer({
        de: cfg.usuario,
        para: cfg.usuario,
        asunto: 'RobinSearch — prueba de conexión (se borra sola)',
        cuerpo: 'Este borrador lo ha creado RobinSearch para comprobar que puede dejarte los suyos. Si lo estás leyendo, es que no se ha podido borrar: puedes eliminarlo sin más.',
      });
      const r = await cliente.append(inv.carpetas.borradores, raw, ['\\Draft'], new Date());
      pasos.borrador = { ok: true, carpeta: inv.carpetas.borradores, uid: r?.uid ?? null, borrado: false };
      if (r?.uid) {
        const c2 = await cliente.getMailboxLock(inv.carpetas.borradores);
        try {
          await cliente.messageFlagsAdd(String(r.uid), ['\\Deleted'], { uid: true });
          // EXPUNGE solo del nuestro (UID EXPUNGE) si el servidor lo admite; si no, el borrador
          // queda marcado y desaparece cuando el programa de correo del abogado limpie.
          try { await cliente.messageDelete(String(r.uid), { uid: true }); } catch { /* queda marcado */ }
          pasos.borrador.borrado = true;
        } catch {
          pasos.borrador.borrado = false;
        } finally {
          c2.release();
        }
      }
    } else {
      pasos.borrador = { ok: false, motivo: 'sin_carpeta_borradores', mensaje: 'El servidor no dice cuál es su carpeta de Borradores. Ponla a mano en Ajustes avanzados.' };
    }
  } finally {
    try { await cliente.logout(); } catch { /* nada */ }
  }

  pasos.envio = cfg.smtp.host
    ? await comprobarSmtp(cfg, secreto.accessToken ? { accessToken: secreto.accessToken } : secreto.pass)
    : { ok: false, motivo: 'sin_servidor', mensaje: 'No hay servidor de envío configurado.' };

  const ok = pasos.entrada.ok && pasos.borrador?.ok === true;
  return salida({ ok, pasos, estado: await estado() });
}

// Conectar entrando en la cuenta del propio proveedor (Microsoft, Google). Aquí no hay
// contraseña que escribir ni que guardar: lo que vuelve es un permiso revocable.
async function conectarProveedor(o) {
  const id = String(o.proveedor || '').toLowerCase();
  const p = buscarProveedor(id);
  if (!p) return salida({ ok: false, motivo: 'proveedor', mensaje: 'Indica --proveedor=microsoft o --proveedor=google.' });

  let sesion;
  try {
    sesion = await oauth.conectar(id, {
      direccion: String(o.direccion || '').trim() || null,
      // La URL se imprime por stderr: si el navegador no se abre solo (un servidor, una sesión
      // remota), el abogado la tiene a la vista.
      alAbrir: (url) => process.stderr.write(`Abre esta dirección para entrar en tu cuenta:\n${url}\n`),
    });
  } catch (err) {
    return salida({ ok: false, motivo: err?.motivo || 'oauth', mensaje: err?.message || 'No se ha podido conectar con tu proveedor.' });
  }

  guardarCorreo({
    usuario: sesion.direccion,
    auth: 'oauth',
    proveedor: id,
    imap: { ...p.imap },
    smtp: { ...p.smtp },
    carpetas: { borradores: null, enviados: null },
    configuradoEl: new Date().toISOString(),
  });
  carpetasMod.olvidarCache();
  return salida({ ok: true, ...(await estado()) });
}

async function envio(o) {
  if (!o.permitir && !o.bloquear) return salida({ ok: false, mensaje: 'Usa --permitir o --bloquear.' });
  guardarCorreo({ envioPermitido: Boolean(o.permitir) });
  return salida({ ok: true, ...(await estado()) });
}

async function olvidar() {
  const c = leerCorreo();
  if (c.usuario) {
    await llavero.borrar(c.usuario);
    await oauth.olvidarPermiso(c.usuario);
    oauth.olvidarEnMemoria(c.usuario);
  }
  olvidarCorreo();
  carpetasMod.olvidarCache();
  return salida({ ok: true, ...(await estado()) });
}

export async function ejecutar(argv) {
  const [sub, ...resto] = argv;
  const o = banderas(resto);
  switch (sub) {
    case 'estado': return salida(await estado());
    case 'detectar': {
      const d = await detectar(String(o.direccion || o.usuario || ''));
      return salida({ ok: !d.error, ...d });
    }
    case 'entrar': {
      const r = await comoEntrar(String(o.direccion || o.usuario || ''));
      const p = r.proveedor ? buscarProveedor(r.proveedor) : null;
      return salida({ ok: true, ...r, nombre_proveedor: p ? p.nombre : null });
    }
    case 'proveedor': return conectarProveedor(o);
    case 'conectar':
    case 'configurar': return conectar(o);
    case 'probar': return probar();
    case 'envio': return envio(o);
    case 'olvidar': return olvidar();
    default:
      process.stdout.write(AYUDA);
      return sub ? 2 : 0;
  }
}

export default { ejecutar };
