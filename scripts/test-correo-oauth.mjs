// ESCENARIO (1.8.0): el correo que NO admite contraseña. Microsoft 365 y Outlook.com anuncian
// LOGINDISABLED y solo aceptan XOAUTH2 (comprobado en vivo contra sus servidores el
// 20-sep-2026), así que con ellos no hay «pon tu contraseña» que valga: hay que entrar en la
// cuenta del proveedor y traerse un permiso revocable.
//
// Aquí se recorre ese camino ENTERO contra un proveedor OAuth de mentira y un servidor IMAP que
// habla XOAUTH2: conectar, guardar el permiso en el llavero, renovar el token cuando caduca,
// entrar en el buzón con él, y los dos finales malos que el abogado va a ver de verdad —
// permiso retirado desde su cuenta de Microsoft, y token caducado a mitad de una sesión.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import http from 'node:http';

const REPO = process.env.REPO || new URL('..', import.meta.url).pathname;
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-oauth-'));
process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_TOKEN = 't';
process.env.ROBIN_CORREO_LLAVERO = 'fichero';   // sin tocar el llavero de quien ejecuta esto
process.env.ROBIN_NO_BROWSER = '1';             // el «navegador» lo hacemos nosotros con fetch
process.env.ROBIN_CORREO_MS_CLIENT_ID = 'alta-de-prueba';
fs.mkdirSync(process.env.ROBIN_DATA_DIR, { recursive: true });

// ── Proveedor OAuth de mentira ──
const estado = { codigos: new Map(), refresh: new Map(), permisoRetirado: false, tokenVivo: 'token-1', renovaciones: 0 };
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (correo) => `x.${b64url({ email: correo })}.y`;

const oauthSrv = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/authorize') {
    // Lo que hace el navegador del abogado tras entrar en su cuenta: volver con el código.
    const vuelta = new URL(url.searchParams.get('redirect_uri'));
    const code = `codigo-${estado.codigos.size + 1}`;
    estado.codigos.set(code, { verificador: url.searchParams.get('code_challenge'), correo: url.searchParams.get('login_hint') || 'abogado@contoso.test' });
    vuelta.searchParams.set('code', code);
    vuelta.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { Location: vuelta.toString() }).end();
    return;
  }
  if (url.pathname === '/token') {
    let cuerpo = '';
    req.on('data', (d) => { cuerpo += d; });
    req.on('end', () => {
      const p = new URLSearchParams(cuerpo);
      const responder = (codigo, objeto) => {
        res.writeHead(codigo, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(objeto));
      };
      if (p.get('grant_type') === 'authorization_code') {
        const c = estado.codigos.get(p.get('code'));
        if (!c || !p.get('code_verifier')) return responder(400, { error: 'invalid_grant' });
        const refresh = `permiso-${estado.refresh.size + 1}`;
        estado.refresh.set(refresh, c.correo);
        return responder(200, { access_token: estado.tokenVivo, refresh_token: refresh, expires_in: 3600, id_token: idToken(c.correo), scope: 'mail' });
      }
      if (p.get('grant_type') === 'refresh_token') {
        estado.renovaciones += 1;
        // El abogado ha retirado el permiso desde su cuenta de Microsoft: esto es lo que
        // devuelven los dos proveedores, y hay que traducirlo a algo que se entienda.
        if (estado.permisoRetirado) return responder(400, { error: 'invalid_grant', error_description: 'The refresh token has expired or is invalid.' });
        if (!estado.refresh.has(p.get('refresh_token'))) return responder(400, { error: 'invalid_grant' });
        return responder(200, { access_token: estado.tokenVivo, expires_in: 3600, scope: 'mail' });
      }
      responder(400, { error: 'unsupported_grant_type' });
    });
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => oauthSrv.listen(0, '127.0.0.1', r));
process.env.ROBIN_CORREO_OAUTH_PRUEBA = `http://127.0.0.1:${oauthSrv.address().port}`;

const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { BuzonFalso, levantar } = await imp('scripts/fixtures/imap-falso.mjs');
const proveedores = await imp('server/correo/proveedores.js');
const oauth = await imp('server/correo/oauth-correo.js');
const ajustes = await imp('server/correo/ajustes.js');
const conexion = await imp('server/correo/conexion.js');
const carpetas = await imp('server/correo/carpetas.js');
const buscarCorreos = (await imp('server/tools/buscar_correos.js')).default;
const datos = (r) => r.structuredContent;

const CORREO = 'abogado@contoso.test';

// ── 1. La decisión de por dónde se entra ──
{
  const r = await proveedores.comoEntrar('alguien@outlook.com', { sondearServidor: false });
  check('una cuenta de Outlook.com se manda a OAuth, no al formulario de contraseña', r.via === 'oauth' && r.proveedor === 'microsoft', JSON.stringify(r));
}
{
  // Sin alta de aplicación para Google (no se ha puesto la variable): hay que DECIRLO, y ofrecer
  // la salida que sí existe en Gmail — la contraseña de aplicación.
  const r = await proveedores.comoEntrar('alguien@gmail.com', { sondearServidor: false });
  check('sin alta de aplicación se dice, no se finge', r.via === 'oauth_sin_alta' && r.alternativa === 'contrasena_de_aplicacion', JSON.stringify(r));
}

{
  // iCloud, Yahoo y AOL aceptan contraseña, pero no la de la cuenta. Decirlo ANTES es la
  // diferencia entre «ya está» y un abogado convencido de que esto no va con su correo.
  const r = await proveedores.comoEntrar('letrado@icloud.com', { sondearServidor: false });
  check('iCloud: se avisa de que hace falta contraseña de aplicación, y de dónde se saca',
    r.via === 'contrasena' && r.alternativa === 'contrasena_de_aplicacion' && /apple\.com/.test(r.donde || ''), r.servicio);
}
{
  const r = await proveedores.comoEntrar('letrado@yahoo.es', { sondearServidor: false });
  check('Yahoo, igual', r.alternativa === 'contrasena_de_aplicacion' && r.servicio === 'Yahoo');
}

// ── 2. Conectar: el navegador va y vuelve ──
let sesion;
{
  sesion = await oauth.conectar('microsoft', {
    direccion: CORREO,
    // Esto es el navegador del abogado. `redirect: 'follow'` sigue la vuelta a 127.0.0.1.
    alAbrir: (url) => { fetch(url, { redirect: 'follow' }).catch(() => {}); },
  });
  check('la cuenta queda conectada con su proveedor', sesion.direccion === CORREO && sesion.proveedor === 'microsoft', JSON.stringify(sesion));
  const permiso = await oauth.leerPermiso(CORREO);
  check('y el permiso se guarda en el llavero, no en ajustes', Boolean(permiso?.refresh_token));
}
{
  const t = await oauth.tokenDeAcceso(CORREO);
  check('hay token de acceso sin volver a pedir nada', t === 'token-1');
  const antes = estado.renovaciones;
  await oauth.tokenDeAcceso(CORREO);
  check('y no se renueva en cada llamada (vale una hora)', estado.renovaciones === antes);
}

// ── 3. Entrar en el buzón con XOAUTH2 ──
const buzon = new BuzonFalso({ usuario: CORREO, clave: null, token: 'token-1', soloOauth: true });
buzon.anadir('INBOX', { de: 'cliente@contoso.test', para: CORREO, asunto: 'Contrato marco', cuerpo: 'Le adjunto el borrador.' });
const { servidor, puerto } = await levantar(buzon);
ajustes.guardarCorreo({
  usuario: CORREO, auth: 'oauth', proveedor: 'microsoft',
  imap: { host: '127.0.0.1', puerto, tls: false },
  smtp: { host: '127.0.0.1', puerto: 1, seguridad: 'starttls' },
  carpetas: { borradores: null, enviados: null },
  configuradoEl: new Date().toISOString(),
});
{
  // Lo secreto (el permiso y el token) vive en el llavero; ajustes.json guarda solo el «cómo».
  const enDisco = fs.readFileSync(path.join(process.env.ROBIN_DATA_DIR, 'ajustes.json'), 'utf8');
  const permiso = await oauth.leerPermiso(CORREO);
  check('ni el permiso ni el token aparecen en ajustes.json', !enDisco.includes(permiso.refresh_token) && !enDisco.includes('token-1') && enDisco.includes('"auth": "oauth"'));
}
{
  const r = datos(await buscarCorreos.handler({ remitente: 'cliente' }));
  check('se entra en un servidor que NO acepta contraseña, con el token', r.correos?.length === 1, r.error || '');
  check('y el correo se lee igual que en cualquier otro buzón', r.correos?.[0]?.asunto === 'Contrato marco');
}

// ── 4. El token caduca a mitad de la sesión ──
{
  await conexion.cerrar();
  oauth.olvidarEnMemoria(CORREO);
  estado.tokenVivo = 'token-2';   // el proveedor emite otro
  buzon.token = 'token-2';        // y el servidor de correo solo acepta el nuevo
  const antes = estado.renovaciones;
  const r = datos(await buscarCorreos.handler({ remitente: 'cliente' }));
  check('el token se renueva solo y el abogado no se entera', r.correos?.length === 1 && estado.renovaciones > antes, r.error || `renovaciones: ${estado.renovaciones}`);
}

// ── 5. El token ya no vale y el proveedor tampoco lo renueva ──
{
  await conexion.cerrar();
  oauth.olvidarEnMemoria(CORREO);
  estado.permisoRetirado = true;  // el abogado lo ha retirado desde su cuenta de Microsoft
  const r = datos(await buscarCorreos.handler({}));
  check('permiso retirado: se dice claro y se manda a reconectar, no «contraseña incorrecta»',
    /permiso|volver a conectar|reconect/i.test(r.error || ''), `${r.motivo}: ${(r.error || '').slice(0, 90)}`);
  estado.permisoRetirado = false;
}

// ── 6. Token rechazado por el servidor de correo (reto SASL) ──
{
  await conexion.cerrar();
  oauth.olvidarEnMemoria(CORREO);
  buzon.token = 'otro-token-que-no-es';   // el proveedor da uno, el buzón espera otro
  const r = datos(await buscarCorreos.handler({}));
  check('token rechazado por el buzón: mensaje entendible y sin colgarse', Boolean(r.error) && r.motivo === 'credenciales', `${r.motivo}`);
  buzon.token = 'token-2';
}

// ── 7. Desconectar: el permiso desaparece del ordenador ──
{
  await conexion.cerrar();
  await oauth.olvidarPermiso(CORREO);
  oauth.olvidarEnMemoria(CORREO);
  check('al desconectar, el permiso ya no está', (await oauth.leerPermiso(CORREO)) === null);
  const r = datos(await buscarCorreos.handler({}));
  check('y sin permiso se pide reconectar, no se inventa nada', Boolean(r.error), r.motivo);
}

await conexion.cerrar();
carpetas.olvidarCache();
servidor.close();
oauthSrv.close();
fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok === results.length ? 0 : 1);
