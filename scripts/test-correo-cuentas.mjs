// ESCENARIO (1.9.0): VARIAS cuentas de correo. Juan (26-sep-2026): «igual que en Expedientes
// se puede configurar más de una carpeta, que en Correo electrónico se pueda configurar también
// más de una cuenta». Lo que de verdad puede salir mal con dos buzones:
//   · Actualizar y perder la cuenta que ya estaba (el fichero de la 1.8.x guarda UNA a pelo).
//   · Conectar la segunda y pisar la contraseña de la primera (Windows y el respaldo de fichero
//     guardaban un único secreto).
//   · El mismo uid en los dos buzones: leer el 1 de la cuenta equivocada es servir el correo de
//     otra persona como si fuera el pedido. Con varias cuentas, lo que va por uid EXIGE la cuenta.
//   · El borrador o el envío desde la cuenta que no es.
//   · Un buzón caído no puede dejar sin resultados al otro.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-cuentas-'));
process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_TOKEN = 't';
process.env.ROBIN_CORREO_LLAVERO = 'fichero';
fs.mkdirSync(process.env.ROBIN_DATA_DIR, { recursive: true });

const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { BuzonFalso, levantar } = await imp('scripts/fixtures/imap-falso.mjs');
const ajustes = await imp('server/correo/ajustes.js');
const llavero = await imp('server/correo/llavero.js');
const conexion = await imp('server/correo/conexion.js');
const carpetas = await imp('server/correo/carpetas.js');
const buscarCorreos = (await imp('server/tools/buscar_correos.js')).default;
const leerCorreoTool = (await imp('server/tools/leer_correo.js')).default;
const leerAdjunto = (await imp('server/tools/leer_adjunto.js')).default;
const archivarCorreo = (await imp('server/tools/archivar_correo.js')).default;
const guardarBorrador = (await imp('server/tools/guardar_borrador.js')).default;
const enviarCorreo = (await imp('server/tools/enviar_correo.js')).default;
const estadoServidor = (await imp('server/tools/estado_servidor.js')).default;

const datos = (r) => r.structuredContent;
const A = 'juan@despacho.test';
const B = 'juan.personal@correo.test';
const CLAVE_A = 'clave del despacho';
const CLAVE_B = 'clave personal';
const rutaAjustes = path.join(process.env.ROBIN_DATA_DIR, 'ajustes.json');

// ─────────── 1. La cuenta de la 1.8.x sigue ahí después de actualizar ───────────
fs.writeFileSync(rutaAjustes, JSON.stringify({
  carpetas: ['/tmp/expedientes'],
  correo: { usuario: A, auth: 'contrasena', imap: { host: 'mail.despacho.test', puerto: 993, tls: true }, smtp: { host: 'mail.despacho.test', puerto: 587, seguridad: 'starttls' }, envioPermitido: true },
}));
ajustes.olvidarCache();
check('la cuenta guardada con el formato de antes se lee sin tocar nada', ajustes.leerCuentas().length === 1 && ajustes.leerCorreo().usuario === A);
check('y conserva su permiso de envío', ajustes.leerCorreo().envioPermitido === true);

ajustes.guardarCorreo({ usuario: B, imap: { host: 'imap.correo.test', puerto: 993, tls: true }, smtp: { host: 'smtp.correo.test', puerto: 465, seguridad: 'tls' } });
{
  const f = JSON.parse(fs.readFileSync(rutaAjustes, 'utf8'));
  check('conectar otra cuenta la AÑADE: quedan dos', ajustes.leerCuentas().map((c) => c.usuario).join(',') === `${A},${B}`);
  check('el fichero pasa a la forma de lista y no toca las carpetas de expedientes', Array.isArray(f.correo?.cuentas) && f.carpetas?.[0] === '/tmp/expedientes');
  check('la principal sigue siendo la primera, con sus ajustes', ajustes.leerCorreo().usuario === A && ajustes.leerCorreo().imap.host === 'mail.despacho.test');
  check('la nueva viene con el envío DESACTIVADO, aunque la otra lo tenga permitido', ajustes.leerCorreo(B).envioPermitido === false);
}
ajustes.guardarCorreo({ envioPermitido: false }, A);
ajustes.guardarCorreo({ envioPermitido: true }, B);
check('el permiso de envío es de cada cuenta', ajustes.leerCorreo(A).envioPermitido === false && ajustes.leerCorreo(B).envioPermitido === true);
ajustes.guardarCorreo({ usuario: 'JUAN@Despacho.test', smtp: { puerto: 25 } });
check('la misma dirección con otras mayúsculas NO crea una tercera cuenta', ajustes.leerCuentas().length === 2 && ajustes.leerCorreo(A).smtp.puerto === 25);
check('pedir una dirección que no está NO devuelve la principal', ajustes.leerCorreo('otra@nadie.test').configurado === false && ajustes.leerCorreo('otra@nadie.test').desconocida === true);

// ─────────── 2. Dos contraseñas en el llavero, sin pisarse ───────────
fs.writeFileSync(llavero.rutasDeRespaldo().fichero, JSON.stringify({ cuenta: A, clave: 'la de antes' }));
check('la contraseña guardada con el formato de antes se sigue leyendo', (await llavero.leer(A)) === 'la de antes');
await llavero.guardar(A, CLAVE_A);
await llavero.guardar(B, CLAVE_B);
check('guardar la segunda NO pisa la primera', (await llavero.leer(A)) === CLAVE_A && (await llavero.leer(B)) === CLAVE_B);
await llavero.borrar(B);
check('borrar una deja la otra', (await llavero.leer(A)) === CLAVE_A && (await llavero.leer(B)) === null);
await llavero.guardar(B, CLAVE_B);
{
  const winDe = llavero.rutasDeRespaldo().winDe;
  check('en Windows cada cuenta tiene su propio fichero cifrado', winDe(A) !== winDe(B) && winDe(A) === winDe('Juan@DESPACHO.test') && !winDe(A).includes('despacho'));
}

// ─────────── 3. Dos buzones de verdad (de mentira), con el MISMO uid ───────────
const buzonA = new BuzonFalso({ usuario: A, clave: CLAVE_A });
const buzonB = new BuzonFalso({ usuario: B, clave: CLAVE_B });
const uidA = buzonA.anadir('INBOX', { de: 'juzgado@justicia.test', para: A, asunto: 'Señalamiento de vista', fecha: new Date('2026-09-20T09:00:00Z'), cuerpo: 'Se señala la vista para el 3 de octubre.' });
const uidB = buzonB.anadir('INBOX', { de: 'banco@banco.test', para: B, asunto: 'Extracto de septiembre', fecha: new Date('2026-09-22T09:00:00Z'), cuerpo: 'Su extracto personal del mes.' });
buzonB.anadir('INBOX', { de: 'juzgado@justicia.test', para: B, asunto: 'Copia del señalamiento', fecha: new Date('2026-09-19T09:00:00Z'), cuerpo: 'Copia.' });
const sa = await levantar(buzonA);
const sb = await levantar(buzonB);
ajustes.guardarCorreo({ usuario: A, imap: { host: '127.0.0.1', puerto: sa.puerto, tls: false }, carpetas: { borradores: null, enviados: null } });
ajustes.guardarCorreo({ usuario: B, imap: { host: '127.0.0.1', puerto: sb.puerto, tls: false }, carpetas: { borradores: null, enviados: null } });
check('los dos buzones tienen un correo con el mismo uid', uidA === uidB);

{
  const r = datos(await buscarCorreos.handler({}));
  const cuentas = new Set((r.correos || []).map((c) => c.cuenta));
  check('buscar sin decir cuenta busca en LAS DOS', cuentas.has(A) && cuentas.has(B) && r.correos.length === 3, JSON.stringify(r.error || r.correos?.map((c) => c.cuenta)));
  check('y cada correo dice de qué cuenta es', r.correos.every((c) => c.cuenta === A || c.cuenta === B));
  check('juntos, del más reciente al más antiguo', r.correos[0].asunto === 'Extracto de septiembre' && r.correos[2].asunto === 'Copia del señalamiento');
  check('y se dice cómo leer uno (con su cuenta)', /cuenta/.test(r.nota || ''));
}
{
  const r = datos(await buscarCorreos.handler({ remitente: 'juzgado' }));
  check('los filtros valen en todas las cuentas', r.correos?.length === 2 && new Set(r.correos.map((c) => c.cuenta)).size === 2);
}
{
  const r = datos(await buscarCorreos.handler({ cuenta: B }));
  check('con «cuenta», solo en esa', r.correos?.length === 2 && r.correos.every((c) => c.cuenta === B));
}
{
  const r = datos(await leerCorreoTool.handler({ uid: uidA }));
  check('leer por uid SIN cuenta, con dos conectadas: se pide la cuenta, no se adivina', r.motivo === 'falta_cuenta' && r.cuentas?.length === 2, JSON.stringify(r));
}
{
  const ra = datos(await leerCorreoTool.handler({ uid: uidA, cuenta: A }));
  const rb = datos(await leerCorreoTool.handler({ uid: uidB, cuenta: B }));
  check('el mismo uid en cada cuenta es SU correo', /3 de octubre/.test(ra.cuerpo || '') && /extracto personal/.test(rb.cuerpo || ''), JSON.stringify(ra.error || rb.error || ''));
}
{
  const r = datos(await leerCorreoTool.handler({ uid: uidA, cuenta: 'otra@nadie.test' }));
  check('una cuenta que no está conectada: error, y se dicen las que hay', r.motivo === 'cuenta_desconocida' && r.cuentas?.includes(A));
}
{
  const r1 = datos(await leerAdjunto.handler({ uid: uidA }));
  const r2 = datos(await archivarCorreo.handler({ uid: uidA, expediente: 'X' }));
  check('leer un adjunto y archivar también exigen la cuenta', r1.motivo === 'falta_cuenta' && r2.motivo === 'falta_cuenta', `${r1.motivo} / ${r2.motivo}`);
}
{
  const r = datos(await guardarBorrador.handler({ para: ['cliente@cliente.test'], asunto: 'Prueba', cuerpo: 'Hola.' }));
  const enA = buzonA.carpetas.get('INBOX.Drafts').mensajes.length;
  const enB = buzonB.carpetas.get('INBOX.Drafts').mensajes.length;
  check('un borrador nuevo sin decir cuenta va a la PRINCIPAL, y lo dice', r.guardado && r.cuenta === A && enA === 1 && enB === 0, JSON.stringify(r.error || r.cuenta));
}
{
  const r = datos(await guardarBorrador.handler({ cuenta: B, para: ['x@y.test'], cuerpo: 'Desde la personal.' }));
  check('con «cuenta», en los Borradores de ESA cuenta', r.guardado && r.cuenta === B && buzonB.carpetas.get('INBOX.Drafts').mensajes.length === 1, JSON.stringify(r.error || ''));
}
{
  const r = datos(await guardarBorrador.handler({ en_respuesta_a: uidA, cuerpo: 'Recibido.' }));
  check('responder a un uid sin decir cuenta: se pide la cuenta', r.motivo === 'falta_cuenta');
}
{
  const r = datos(await enviarCorreo.handler({ para: ['x@y.test'], cuerpo: 'Hola', confirmar: true }));
  check('ENVIAR con dos cuentas exige decir desde cuál', r.motivo === 'falta_cuenta', r.motivo);
  const r2 = datos(await enviarCorreo.handler({ cuenta: A, para: ['x@y.test'], cuerpo: 'Hola', confirmar: true }));
  check('y el envío se permite o no POR CUENTA (A lo tiene bloqueado)', r2.motivo === 'envio_no_permitido', r2.motivo);
}
{
  const e = datos(await estadoServidor.handler({}));
  check('estado_servidor lista las dos cuentas y avisa de cómo usarlas', e.correo?.cuentas?.length === 2 && /2 cuentas/.test(e.aviso_cuentas_correo || ''));
}

// ─────────── 4. Una cuenta caída no deja sin resultados a la otra ───────────
await conexion.cerrar();
sb.servidor.close();
await new Promise((r) => setTimeout(r, 100));
{
  const r = datos(await buscarCorreos.handler({}));
  check('con un buzón caído, busca en el otro y dice cuál ha fallado', r.correos?.length === 1 && r.correos[0].cuenta === A && r.fallos?.[0]?.cuenta === B, JSON.stringify(r.error || r.fallos));
}
await conexion.cerrar();
sa.servidor.close();
carpetas.olvidarCache();

// ─────────── 5. El CLI que usa RobinDesktop ───────────
const cli = (args, entrada = '') => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'cli', 'index.js'), 'correo', ...args], {
    input: entrada, env: { ...process.env }, encoding: 'utf8', timeout: 60000,
  });
  try { return JSON.parse(r.stdout); } catch { return { crudo: r.stdout, err: r.stderr }; }
};
{
  const e = cli(['estado']);
  check('«correo estado» devuelve la lista de cuentas', e.cuentas?.length === 2 && e.cuentas.every((c) => c.clave_guardada === true) && e.varias_cuentas === true, JSON.stringify(e).slice(0, 200));
  check('y los campos sueltos de antes son los de la principal (una app vieja sigue viendo algo cierto)', e.usuario === A && e.configurado === true);
}
{
  const r = cli(['envio', '--permitir', `--cuenta=${A}`]);
  check('«correo envio --cuenta» cambia solo esa cuenta', r.ok && r.cuentas.find((c) => c.usuario === A).envioPermitido === true && r.cuentas.find((c) => c.usuario === B).envioPermitido === true);
  const mal = cli(['envio', '--bloquear', '--cuenta=otra@nadie.test']);
  ajustes.olvidarCache();   // lo ha escrito OTRO proceso: la memoria de 2 s de este no lo sabe
  check('con una cuenta que no está, error: no se toca la principal', mal.ok === false && mal.motivo === 'cuenta_desconocida' && ajustes.leerCorreo(A).envioPermitido === true);
}
{
  const r = cli(['olvidar', `--cuenta=${B}`]);
  ajustes.olvidarCache();
  check('«correo olvidar --cuenta» desconecta SOLO esa', r.ok && r.cuentas?.length === 1 && r.cuentas[0].usuario === A);
  check('y borra su contraseña, no la de la otra', (await llavero.leer(B)) === null && (await llavero.leer(A)) === CLAVE_A);
}
{
  const r = cli(['olvidar']);
  check('«correo olvidar» sin cuenta las desconecta todas', r.ok && (r.cuentas || []).length === 0 && (await llavero.leer(A)) === null);
}

const bien = results.filter(Boolean).length;
console.log(`\n${bien}/${results.length} comprobaciones OK`);
fs.rmSync(base, { recursive: true, force: true });
process.exit(bien === results.length ? 0 : 1);
