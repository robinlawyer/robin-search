// Validación del módulo de correo CONTRA UN SERVIDOR DE VERDAD.
//
// No entra en `npm test` a propósito: necesita credenciales y red, y las pruebas automáticas no
// pueden depender de ninguna de las dos. Esto es lo que se ejecuta UNA vez contra una cuenta
// nuestra —nunca contra el buzón de un cliente, que lleva correspondencia real— antes de dar el
// correo por bueno en un despacho.
//
//   ROBIN_CORREO_USUARIO=pruebas@robinlawyer.ai \
//   ROBIN_CORREO_HOST=mail.robinlawyer.ai \
//   node scripts/probar-correo-en-vivo.mjs        ← la contraseña se pide por stdin
//
// Opcionales: ROBIN_CORREO_PUERTO (993) · ROBIN_CORREO_SMTP_HOST · ROBIN_CORREO_SMTP_PUERTO (587)
//             ROBIN_CORREO_SMTP_SEGURIDAD (starttls|tls) · ROBIN_CORREO_ENVIAR=1 (manda un correo
//             de verdad a la propia cuenta; sin esto solo se comprueba que el servidor lo acepta)
import { pathToFileURL } from 'node:url';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || new URL('..', import.meta.url).pathname;
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-correo-vivo-'));
process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_TOKEN = 't';
fs.mkdirSync(process.env.ROBIN_DATA_DIR, { recursive: true });

const USUARIO = process.env.ROBIN_CORREO_USUARIO;
if (!USUARIO) {
  console.error('Falta ROBIN_CORREO_USUARIO. Lee la cabecera de este fichero.');
  process.exit(2);
}
const clave = await new Promise((r) => {
  if (process.stdin.isTTY) process.stderr.write(`Contraseña de ${USUARIO} (no se ve, no se guarda): `);
  let d = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (t) => { d += t; });
  process.stdin.on('end', () => r(d.replace(/\r?\n$/, '')));
});
if (!clave) { console.error('Sin contraseña no hay prueba.'); process.exit(2); }

const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const ajustes = await imp('server/correo/ajustes.js');
const llavero = await imp('server/correo/llavero.js');
const carpetas = await imp('server/correo/carpetas.js');
const conexion = await imp('server/correo/conexion.js');
const autodeteccion = await imp('server/correo/autodeteccion.js');
const smtp = await imp('server/correo/smtp.js');
const buscarCorreos = (await imp('server/tools/buscar_correos.js')).default;
const leerCorreoTool = (await imp('server/tools/leer_correo.js')).default;
const guardarBorrador = (await imp('server/tools/guardar_borrador.js')).default;
const enviarCorreo = (await imp('server/tools/enviar_correo.js')).default;
const datos = (r) => r.structuredContent;

// ── 0. ¿Este servidor admite contraseña? ──
const caps = await autodeteccion.capacidades(process.env.ROBIN_CORREO_HOST || autodeteccion.dominioDe(USUARIO), Number(process.env.ROBIN_CORREO_PUERTO || 993));
check('el servidor admite entrar con contraseña (sin LOGINDISABLED)', !autodeteccion.exigeOauth(caps), (caps || []).join(' ').slice(0, 120));

// ── 1. Autodetección contra el dominio real ──
const det = await autodeteccion.detectar(USUARIO);
check('la autodetección encuentra el servidor de entrada', Boolean(det.imap), JSON.stringify(det.imap) + ` (vía ${det.via?.imap})`);
check('y el de salida', Boolean(det.smtp), JSON.stringify(det.smtp) + ` (vía ${det.via?.smtp})`);

await llavero.guardar(USUARIO, clave);
ajustes.guardarCorreo({
  usuario: USUARIO,
  imap: {
    host: process.env.ROBIN_CORREO_HOST || det.imap?.host,
    puerto: Number(process.env.ROBIN_CORREO_PUERTO || det.imap?.puerto || 993),
    tls: true,
  },
  smtp: {
    host: process.env.ROBIN_CORREO_SMTP_HOST || det.smtp?.host || process.env.ROBIN_CORREO_HOST,
    puerto: Number(process.env.ROBIN_CORREO_SMTP_PUERTO || det.smtp?.puerto || 587),
    seguridad: process.env.ROBIN_CORREO_SMTP_SEGURIDAD || det.smtp?.seguridad || 'starttls',
  },
  carpetas: { borradores: null, enviados: null },
  configuradoEl: new Date().toISOString(),
});

// ── 2. Lo que de verdad dice este Dovecot: el LIST (SPECIAL-USE) entero ──
await conexion.conImap(async (cliente) => {
  const inv = await carpetas.inventario(cliente);
  console.log('\n  ── LIST (SPECIAL-USE) del servidor ──');
  console.log(`  separador: «${inv.delimitador}» · ${inv.total} carpetas`);
  for (const c of inv.conSpecialUse) console.log(`  ${c.especial.padEnd(10)} → ${c.ruta}`);
  console.log(`  borradores: ${inv.carpetas.borradores} (${inv.especiales.borradores})`);
  console.log(`  enviados:   ${inv.carpetas.enviados} (${inv.especiales.enviados})\n`);
  check('el servidor declara su carpeta de Borradores por SPECIAL-USE', inv.especiales.borradores === 'special-use', inv.carpetas.borradores || 'ninguna');
  check('y la de Enviados', inv.especiales.enviados === 'special-use', inv.carpetas.enviados || 'ninguna');
});

// ── 3. Mandarse correos a uno mismo para tener con qué trabajar ──
const marca = `RS-${Date.now()}`;
ajustes.guardarCorreo({ envioPermitido: true });
const primero = datos(await enviarCorreo.handler({
  para: [USUARIO], asunto: `Prueba ${marca} · acentos ñ á é`, confirmar: true,
  cuerpo: `Estimado letrado:\n\nEste es el correo de prueba ${marca}. Le comunicamos un incremento del 8%.\n\nAtentamente,\nRobinSearch`,
}));
check('envío por SMTP aceptado por el servidor', primero.enviado === true, primero.error || `aceptados ${primero.aceptados_por_el_servidor}`);
check('y con copia en Enviados', primero.copia_en_enviados === true, primero.nota);
ajustes.guardarCorreo({ envioPermitido: false });

// El servidor tarda un poco en entregárselo a sí mismo.
let encontrado = null;
for (let i = 0; i < 20 && !encontrado; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const r = datos(await buscarCorreos.handler({ asunto: marca, limite: 5 }));
  encontrado = r.correos?.[0] || null;
}
check('el correo enviado aparece en la bandeja de entrada', Boolean(encontrado), encontrado ? `uid ${encontrado.uid}` : 'no llegó en 30 s');

if (encontrado) {
  const leido = datos(await leerCorreoTool.handler({ uid: encontrado.uid }));
  check('se lee entero y con los acentos intactos', /incremento del 8%/.test(leido.cuerpo || '') && /ñ á é/.test(leido.asunto || ''), leido.asunto);
  check('y llega envuelto como contenido de un tercero', /NO FIABLE/.test(leido.cuerpo || ''));

  // ── 4. LA PIEZA: el borrador enhebrado, en la carpeta de verdad ──
  const b = datos(await guardarBorrador.handler({
    en_respuesta_a: encontrado.uid,
    cuerpo: `No aceptamos el incremento. (Borrador de prueba ${marca}.)`,
  }));
  check('el borrador se guarda en la carpeta REAL de borradores', b.guardado === true, b.carpeta || b.error);
  check('y va enhebrado en la conversación', b.en_hilo === true, `in-reply-to: ${b.in_reply_to}`);
  console.log(`\n  👉 COMPROBACIÓN MANUAL: abre ${USUARIO} en Apple Mail y en Outlook y mira que el`);
  console.log(`     borrador «${b.asunto}» aparece DENTRO del hilo, no suelto.\n`);
}

// ── 5. Contraseña mal, contra el servidor de verdad ──
await conexion.cerrar();
await llavero.guardar(USUARIO, `${clave}-mal`);
{
  const r = datos(await buscarCorreos.handler({}));
  check('contraseña incorrecta contra el servidor real: mensaje claro', r.motivo === 'credenciales', r.motivo);
}
await conexion.cerrar();

await llavero.borrar(USUARIO);
fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok === results.length ? 0 : 1);
