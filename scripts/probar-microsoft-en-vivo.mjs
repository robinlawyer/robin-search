// Prueba REAL contra Microsoft: entrar con la cuenta, y con el token entrar en el buzón.
//
// No toca la configuración del abogado: usa un directorio de datos propio y el respaldo de
// fichero, y lo borra todo al terminar. Lo que se comprueba es lo único que importa antes de
// prometerle esto a un despacho: que Microsoft emite el permiso con los ámbitos de correo, y que
// su servidor IMAP —el que anuncia LOGINDISABLED— acepta ese token.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';

const REPO = process.env.REPO || new URL('..', import.meta.url).pathname;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-ms-vivo-'));
process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_CORREO_LLAVERO = 'fichero';
fs.mkdirSync(process.env.ROBIN_DATA_DIR, { recursive: true });

const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const oauth = await imp('server/correo/oauth-correo.js');
const { PROVEEDORES } = await imp('server/correo/proveedores.js');
const { probarCredenciales } = await imp('server/correo/conexion.js');
const carpetas = await imp('server/correo/carpetas.js');
const { componer } = await imp('server/correo/redaccion.js');
const { comprobar: comprobarSmtp } = await imp('server/correo/smtp.js');

console.log('\n  Se va a abrir el navegador. Entra con la cuenta de Microsoft que quieras probar.\n');

let sesion;
try {
  sesion = await oauth.conectar('microsoft', {
    // La dirección ENTERA: el navegador no siempre se abre solo (un proceso lanzado en segundo
    // plano no siempre puede), y sin la URL completa el abogado se queda mirando una pantalla
    // que no llega. También se intenta abrir desde aquí, por si acaso.
    alAbrir: (url) => {
      console.log(`\n  PEGA ESTA DIRECCIÓN EN TU NAVEGADOR:\n\n${url}\n`);
      try { spawn('open', [url], { stdio: 'ignore', detached: true }).unref(); } catch { /* da igual */ }
    },
    esperaMs: 8 * 60 * 1000,
  });
  check('Microsoft emite el permiso', true, `cuenta: ${sesion.direccion}`);
  console.log(`        ámbitos concedidos: ${sesion.ambitos}`);
} catch (err) {
  check('Microsoft emite el permiso', false, `${err?.motivo || ''}: ${err?.message || err}`);
  console.log(`\n${results.filter(Boolean).length}/${results.length} comprobaciones OK`);
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(1);
}

const token = await oauth.tokenDeAcceso(sesion.direccion);
check('hay token de acceso', Boolean(token), `${String(token).length} caracteres`);

const p = PROVEEDORES.microsoft;
let cliente;
try {
  cliente = await probarCredenciales({ ...p.imap, usuario: sesion.direccion, accessToken: token });
  check('el servidor IMAP de Microsoft acepta el token (XOAUTH2)', true, p.imap.host);
} catch (err) {
  // La respuesta LITERAL del servidor: «Command failed» no distingue «token malo» de «esta
  // identidad no tiene buzón aquí», que es lo que pasa con una cuenta de Microsoft cuyo correo
  // está en otro sitio.
  check('el servidor IMAP de Microsoft acepta el token (XOAUTH2)', false,
    `${err?.code || ''} ${err?.responseText || err?.response || err?.message || err}`.trim());
}

if (cliente) {
  try {
    const inv = await carpetas.inventario(cliente);
    console.log(`\n  ── Carpetas de ese buzón ──\n  separador «${inv.delimitador}» · ${inv.total} carpetas`);
    for (const c of inv.conSpecialUse) console.log(`  ${String(c.especial).padEnd(10)} → ${c.ruta}`);
    check('declara su carpeta de Borradores por SPECIAL-USE', inv.especiales.borradores === 'special-use', inv.carpetas.borradores || 'ninguna');

    const cerrojo = await cliente.getMailboxLock('INBOX', { readOnly: true });
    const cuantos = cliente.mailbox?.exists ?? null;
    cerrojo.release();
    check('se ve la bandeja de entrada', cuantos !== null, `${cuantos} correos`);

    if (inv.carpetas.borradores) {
      const { raw } = await componer({
        de: sesion.direccion, para: sesion.direccion,
        asunto: 'RobinSearch — prueba de conexión (se borra sola)',
        cuerpo: 'Prueba de que RobinSearch puede dejar borradores en esta cuenta. Se borra sola.',
      });
      const r = await cliente.append(inv.carpetas.borradores, raw, ['\\Draft'], new Date());
      check('se puede dejar un borrador', Boolean(r), `uid ${r?.uid ?? '?'} en «${inv.carpetas.borradores}»`);
      if (r?.uid) {
        const c2 = await cliente.getMailboxLock(inv.carpetas.borradores);
        try {
          await cliente.messageDelete(String(r.uid), { uid: true });
          check('y se borra al terminar', true);
        } catch {
          check('y se borra al terminar', false, 'ha quedado el borrador de prueba: bórralo a mano');
        } finally { c2.release(); }
      }
    }
  } catch (err) {
    check('trabajar con el buzón', false, String(err?.message || err));
  } finally {
    try { await cliente.logout(); } catch { /* nada */ }
  }
}

const envio = await comprobarSmtp({ usuario: sesion.direccion, smtp: p.smtp, auth: 'oauth' }, { accessToken: token });
check('el servidor de salida (SMTP) acepta el token', envio.ok, envio.mensaje || '');

fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok === results.length ? 0 : 1);
