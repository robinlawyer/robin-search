// ESCENARIO (Juan, 8-oct-2026, caso Pedro): un abogado que solo abre Claude —nunca RobinDesktop—
// tiene que poder trabajar con RobinSearch durante meses sin que nada se rompa. Las siete pruebas
// que pidió Juan, contra un servidor de Robin de mentira que se porta como el de verdad (rotación de
// la llave, detección de reutilización con margen, caducidad deslizante, código de dispositivo y
// certificado de licencia firmado):
//
//   P1  equipo limpio, sin RobinDesktop: 30, 60 y 90 días (reloj adelantado) y sigue funcionando
//   P2  sesión caducada sin poder renovar: lo local y el correo siguen en la gracia y el chat avisa
//   P3  conectar con el código: funciona y el servidor ve el equipo correcto
//   P4  llave copiada y usada en otro equipo: se detecta la reutilización y se revoca la cadena
//   P5  dos instancias renovando a la vez: sin carrera, la sesión no se pierde
//   P6  corte de red a mitad de una renovación: al reintentar, la sesión sigue (margen)
//   P7  versión antigua soportada: sin cabecera de versión el servidor la deja renovar; por debajo
//       de la mínima se rechaza con un motivo claro y SIN borrar la sesión
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sin-desktop-'));
const DIA = 24 * 3600 * 1000;

// Reloj del proceso adelantable (lo usan RobinSearch y el servidor de mentira, que viven aquí).
const realNow = Date.now.bind(Date);
let desfase = 0;
Date.now = () => realNow() + desfase;

// ── el servidor de Robin de mentira ────────────────────────────────────────────────────────────
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubRaw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64url');
const b64u = (b) => Buffer.from(b).toString('base64url');
const firmar = (d) => { const c = b64u(JSON.stringify(d)); return `${c}.${b64u(crypto.sign(null, Buffer.from(c), privateKey))}`; };

const S = {
  modo: 'ok', minima: null, tokens: new Map(), // refresh → {familia, revocado, rotadoA, rotadoEn, caduca}
  acceso: new Map(), familias: new Map(), devices: new Map(), rotaciones: 0, reusos: 0,
  equipo: null, cortarTrasRotar: false, licenciaHasta: null, renovable: true,
};
const ACCESO_MS = DIA; const REFRESH_MS = 90 * DIA; const MARGEN_MS = 60 * 1000;
function emitir(familia) {
  const access = `jat_${crypto.randomBytes(8).toString('hex')}`; const refresh = `jrt_${crypto.randomBytes(8).toString('hex')}`;
  S.acceso.set(access, { familia, caduca: Date.now() + ACCESO_MS });
  S.tokens.set(refresh, { familia, revocado: false, caduca: Date.now() + REFRESH_MS });
  return { access_token: access, refresh_token: refresh, expires_in: ACCESO_MS / 1000, token_type: 'Bearer' };
}
const familiaViva = (f) => S.familias.get(f) !== 'revocada';
const leerCuerpo = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => r(new URLSearchParams(b))); });
const json = (res, st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (S.modo === 'sin_red') { req.socket.destroy(); return; }
  const ver = req.headers['x-robinsearch-version'];
  const versionVieja = S.minima && ver && ver.localeCompare(S.minima, undefined, { numeric: true }) < 0;
  if (u.pathname === '/.well-known/oauth-authorization-server') {
    const b = `http://127.0.0.1:${srv.address().port}`;
    return json(res, 200, { issuer: b, authorization_endpoint: `${b}/oauth/authorize`, token_endpoint: `${b}/oauth/token`,
      registration_endpoint: `${b}/oauth/register`, userinfo_endpoint: `${b}/oauth/userinfo`, revocation_endpoint: `${b}/oauth/revoke`,
      device_authorization_endpoint: `${b}/oauth/device_authorization` });
  }
  if (u.pathname === '/oauth/register') return json(res, 201, { client_id: 'cli-rs', redirect_uris: ['http://127.0.0.1:47820/callback'] });
  if (u.pathname === '/oauth/userinfo') return json(res, 200, { email: 'abogado@example.com' });
  if (u.pathname === '/oauth/device_authorization') {
    const f = await leerCuerpo(req);
    if (versionVieja) return json(res, 426, { error: 'version_no_soportada', version_minima: S.minima });
    const dc = `dc-${crypto.randomBytes(4).toString('hex')}`;
    S.devices.set(dc, { estado: 'pendiente', equipo: f.get('equipo'), so: f.get('so'), sondeos: 0 });
    S.equipo = f.get('equipo');
    return json(res, 200, { device_code: dc, user_code: 'BCDF-GHJK', verification_uri: 'https://robinlawyer.ai/conectar',
      verification_uri_complete: 'https://robinlawyer.ai/conectar?codigo=BCDF-GHJK', expires_in: 600, interval: 1 });
  }
  if (u.pathname === '/oauth/token') {
    const f = await leerCuerpo(req);
    if (versionVieja) return json(res, 426, { error: 'version_no_soportada', version_minima: S.minima });
    const g = f.get('grant_type');
    if (g === 'urn:ietf:params:oauth:grant-type:device_code') {
      const d = S.devices.get(f.get('device_code'));
      if (!d) return json(res, 400, { error: 'expired_token' });
      d.sondeos += 1;
      if (d.estado === 'pendiente') { if (d.sondeos >= 2) d.estado = 'aprobado'; return json(res, 400, { error: 'authorization_pending' }); }
      S.devices.delete(f.get('device_code'));
      const fam = `fam-${crypto.randomBytes(3).toString('hex')}`; S.familias.set(fam, 'viva');
      return json(res, 200, emitir(fam));
    }
    if (g === 'refresh_token') {
      const rt = f.get('refresh_token'); const t = S.tokens.get(rt);
      if (!t || !familiaViva(t.familia)) return json(res, 400, { error: 'invalid_grant' });
      if (t.revocado) {
        // Dentro del margen, el mismo par nuevo (cortes de red, peticiones en paralelo).
        if (Date.now() - t.rotadoEn < MARGEN_MS && t.par) return json(res, 200, t.par);
        S.reusos += 1; S.familias.set(t.familia, 'revocada');
        return json(res, 400, { error: 'invalid_grant' });
      }
      if (t.caduca <= Date.now()) return json(res, 400, { error: 'invalid_grant' });
      const par = emitir(t.familia); S.rotaciones += 1;
      t.revocado = true; t.rotadoEn = Date.now(); t.par = par;
      if (S.cortarTrasRotar) { S.cortarTrasRotar = false; req.socket.destroy(); return; }
      return json(res, 200, par);
    }
    return json(res, 400, { error: 'unsupported_grant_type' });
  }
  if (u.pathname === '/api/v1/robinsearch/licencia') {
    const tok = (req.headers.authorization || '').replace('Bearer ', ''); const a = S.acceso.get(tok);
    if (!a || a.caduca <= Date.now() || !familiaViva(a.familia)) return json(res, 401, { error: 'token_caducado' });
    const ahora = new Date(Date.now());
    const datos = { v: 1, kid: 'test', sub: 'u1', email: 'abogado@example.com', plan: 'pro', estado: 'activa', uso: true,
      renovable: S.renovable, licencia_hasta: S.licenciaHasta, emitido: ahora.toISOString(),
      valido_hasta: new Date(Date.now() + 30 * DIA).toISOString(), gracia_dias: 30 };
    return json(res, 200, { certificado: firmar(datos), ...datos });
  }
  if (u.pathname.startsWith('/descargas/')) return json(res, 404, {});
  res.writeHead(404); res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const ISSUER = `http://127.0.0.1:${srv.address().port}`;

process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_OAUTH_ISSUER = ISSUER;
process.env.ROBIN_NO_BROWSER = '1';
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_SESION_LLAVERO = 'simulado';     // llavero de mentira: no se toca el del equipo
process.env.ROBIN_LICENCIA_CLAVE_PRUEBA = `test:${pubRaw}`;
process.env.ROBIN_DIAGNOSTICO_URL = '';
delete process.env.ROBIN_TOKEN;
fs.mkdirSync(process.env.ROBIN_DATA_DIR, { recursive: true });
const AUTH = path.join(process.env.ROBIN_DATA_DIR, 'auth.json');
const LLAVERO = path.join(process.env.ROBIN_DATA_DIR, 'llavero-simulado.json');

const oauth = await import(pathToFileURL(path.join(REPO, 'server/auth/oauth.js')).href);
const licencia = await import(pathToFileURL(path.join(REPO, 'server/auth/licencia.js')).href);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 15000) { const fin = realNow() + ms; while (realNow() < fin) { if (await cond()) return true; await esperar(100); } return false; }

// ── P3 (y arranque de P1): equipo limpio, conectar con el código ───────────────────────────────
let r = await oauth.ensureAuthorized();
check('P3 equipo limpio: la herramienta da un CÓDIGO para robinlawyer.ai/conectar, no un enlace local',
  !r.ok && r.dispositivo?.user_code === 'BCDF-GHJK' && /conectar/.test(r.dispositivo.verification_uri), JSON.stringify(r.dispositivo || r));
const texto = JSON.parse(oauth.authPromptResult(null, r).content[0].text).error;
check('P3 el chat dice dónde y qué código, y que no hace falta avisar a Claude', /robinlawyer\.ai\/conectar/.test(texto) && /BCDF-GHJK/.test(texto) && /no hace falta que me digas nada/.test(texto));
check('P3 el servidor ve el nombre real del equipo', S.equipo === os.hostname().slice(0, 80), S.equipo);
await hasta(() => oauth.estadoDispositivo()?.estado === 'conectado');
check('P3 aprobado el código, RobinSearch queda conectado solo (sondeo por su conexión)', oauth.estadoDispositivo()?.estado === 'conectado');
const a0 = JSON.parse(fs.readFileSync(AUTH, 'utf8'));
check('la llave de renovación va al LLAVERO, no a auth.json', !a0.refresh_token && a0.refresh_en === 'llavero' && Object.keys(JSON.parse(fs.readFileSync(LLAVERO, 'utf8'))).length === 1);
check('y hay certificado de licencia firmado y verificable', licencia.derechoDeUso().ok && licencia.derechoDeUso().modo === 'licencia');
r = await oauth.ensureAuthorized();
check('la herramienta funciona', r.ok && r.mode === 'licencia');

// ── P1: 30, 60 y 90 días abriendo solo Claude (cada semana) ────────────────────────────────────
const rotAntes = S.rotaciones;
for (let dia = 7; dia <= 91; dia += 7) {
  desfase = dia * DIA;
  const bm = await oauth.mantenerSesion();     // lo que hace RobinSearch al arrancar Claude y cada 24 h
  r = await oauth.ensureAuthorized();
  await oauth.mantenerSesion(); // la que la herramienta deja en segundo plano termina en este «día»
  void bm;
  if ([28, 63, 91].includes(dia)) check(`P1 día ${dia} sin abrir RobinDesktop: sigue funcionando`, r.ok && r.mode === 'licencia', JSON.stringify({ ok: r.ok, mode: r.mode }));
}
check('P1 la sesión se ha renovado sola por el camino (rotación, sin navegador)', S.rotaciones - rotAntes >= 12, `${S.rotaciones - rotAntes} renovaciones`);
check('P1 sin reutilizaciones detectadas', S.reusos === 0);

// ── P2: sin poder renovar, la gracia ───────────────────────────────────────────────────────────
S.modo = 'sin_red';
desfase += 40 * DIA;  // certificado de 30 días vencido hace 10: en la gracia
r = await oauth.ensureAuthorized();
check('P2 sin red y con el certificado vencido: sigue en la gracia', r.ok && r.mode === 'gracia', JSON.stringify({ ok: r.ok, mode: r.mode }));
const correo = await import(pathToFileURL(path.join(REPO, 'server/tools/buscar_correos.js')).href);
const rc = await correo.handler({ consulta: 'burofax' });
const sc = rc.structuredContent || {};
check('P2 el correo NO pide iniciar sesión (sin cuenta conectada dice eso, no «inicia sesión»)', !sc.requiere_login && !sc.sin_conexion, (sc.error || '').slice(0, 90));
const aviso = oauth.avisoSesion();
check('P2 el chat avisa de que vence y de la acción exacta', /vence/.test(aviso || '') && /reconectar RobinSearch/.test(aviso || ''), (aviso || '').slice(0, 120));
desfase += 25 * DIA;  // pasada la gracia
r = await oauth.ensureAuthorized();
check('P2 pasada la gracia, no busca y dice que no conecta (sin enlaces que no pueden terminar)', !r.ok && r.sin_conexion === true, JSON.stringify({ ok: r.ok, sin: r.sin_conexion }));
S.modo = 'ok';
r = await oauth.ensureAuthorized();
check('P2 en cuanto vuelve la red se renueva solo, sin volver a entrar', r.ok && r.mode === 'licencia', JSON.stringify({ ok: r.ok, mode: r.mode }));

// ── P6: corte de red a mitad de la renovación ──────────────────────────────────────────────────
desfase += 2 * DIA; // la llave de acceso, vencida
S.cortarTrasRotar = true;
const b6 = await oauth.mantenerSesion();
check('P6 el corte se nota (esa vuelta no renueva)', !b6);
const b6b = await oauth.mantenerSesion();
check('P6 al reintentar, la sesión sigue gracias al margen (mismo par nuevo)', Boolean(b6b) && S.reusos === 0);
r = await oauth.ensureAuthorized();
check('P6 y la herramienta funciona', r.ok);

// ── P5: dos instancias renovando a la vez (procesos de verdad) ─────────────────────────────────
desfase += 2 * DIA;
const rotP5 = S.rotaciones;
const hijo = () => new Promise((res) => {
  const p = spawn(process.execPath, ['--input-type=module', '-e', `
    const real=Date.now.bind(Date); Date.now=()=>real()+${desfase};
    const m = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'server/auth/oauth.js')).href)});
    const b = await m.mantenerSesion(); process.stdout.write(b ? 'ok' : 'nada'); process.exit(0);`],
  { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.on('close', () => res(out.trim()));
});
const [h1, h2] = await Promise.all([hijo(), hijo()]);
check('P5 las dos instancias terminan con sesión', h1 === 'ok' && h2 === 'ok', `${h1}/${h2}`);
check('P5 se gasta la llave UNA vez (cerrojo entre procesos) y sin reutilización', S.rotaciones - rotP5 === 1 && S.reusos === 0, `${S.rotaciones - rotP5} rotaciones, ${S.reusos} reusos`);

// ── P4: la llave copiada a otro equipo ─────────────────────────────────────────────────────────
const a4 = JSON.parse(fs.readFileSync(AUTH, 'utf8'));
const robada = JSON.parse(fs.readFileSync(LLAVERO, 'utf8'))[a4.client_id];
const resLadron = await fetch(`${ISSUER}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: robada, client_id: a4.client_id }) });
const ladron = await resLadron.json();
check('P4 (el que copió la llave consigue renovar una vez)', Boolean(ladron.refresh_token));
desfase += 2 * DIA; // pasa el margen: el abogado renueva con la llave que ya gastó el otro
await oauth.mantenerSesion();
check('P4 el servidor detecta la reutilización', S.reusos === 1);
const ladron2 = await (await fetch(`${ISSUER}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: ladron.refresh_token, client_id: a4.client_id }) })).json();
check('P4 y revoca TODA la cadena: la llave del otro equipo ya no sirve', ladron2.error === 'invalid_grant');
check('P4 este equipo deja de usar RobinSearch en el acto (certificado borrado)', !licencia.derechoDeUso().ok);
r = await oauth.ensureAuthorized();
check('P4 y se ofrece reconectar con un código nuevo', !r.ok && Boolean(r.dispositivo?.user_code));
await hasta(() => oauth.estadoDispositivo()?.estado === 'conectado');
r = await oauth.ensureAuthorized();
check('P4 con el código aprobado vuelve a funcionar', r.ok);

// ── P7: versiones ──────────────────────────────────────────────────────────────────────────────
const sinVersion = await fetch(`${ISSUER}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'node' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: JSON.parse(fs.readFileSync(LLAVERO, 'utf8'))[a4.client_id], client_id: a4.client_id }) });
check('P7 una versión antigua (sin cabecera de versión, «node») renueva sin actualizar', sinVersion.status === 200);
// lo que devolvió hay que dejarlo en su sitio: es la sesión de este equipo
const parV = await sinVersion.json();
fs.writeFileSync(LLAVERO, JSON.stringify({ [a4.client_id]: parV.refresh_token }));
const aV = JSON.parse(fs.readFileSync(AUTH, 'utf8')); aV.access_token = parV.access_token; aV.expires_at = Date.now() - 1000; fs.writeFileSync(AUTH, JSON.stringify(aV));
S.minima = '9.0.0';
const b7 = await oauth.mantenerSesion();
check('P7 por debajo de la versión mínima, el servidor rechaza…', !b7 && oauth.versionMinimaExigida() === '9.0.0');
check('P7 …sin borrar la sesión (con la versión nueva renueva sin volver a entrar)', JSON.parse(fs.readFileSync(AUTH, 'utf8')).refresh_en === 'llavero');
r = await oauth.ensureAuthorized();
check('P7 mientras tanto lo local sigue con el certificado y el chat dice qué versión hace falta', r.ok && /9\.0\.0/.test(oauth.avisoSesion() || ''), (oauth.avisoSesion() || '').slice(0, 100));
desfase += 61 * DIA;
r = await oauth.ensureAuthorized();
check('P7 pasada la gracia, dice que hay que actualizar, no «inicia sesión»', !r.ok && (r.version_no_soportada === true || /9\.0\.0/.test(JSON.stringify(oauth.authPromptResult(null, r)))), JSON.stringify(r).slice(0, 120));
S.minima = null;

// ── la demo terminada no tiene gracia ──────────────────────────────────────────────────────────
const dLic = { uso: true, renovable: false, licencia_hasta: new Date(Date.now() + 3 * DIA).toISOString(), emitido: new Date(Date.now()).toISOString(), valido_hasta: new Date(Date.now() + 3 * DIA).toISOString(), gracia_dias: 30, kid: 'test', v: 1 };
fs.writeFileSync(path.join(process.env.ROBIN_DATA_DIR, 'licencia.json'), JSON.stringify({ certificado: firmar(dLic), recibido: new Date(Date.now()).toISOString() }));
check('una demo vale hasta su último día…', licencia.derechoDeUso(Date.now() + 2 * DIA).ok);
check('…y no tiene gracia después', !licencia.derechoDeUso(Date.now() + 4 * DIA).ok);
const falso = firmar(dLic).replace(/\.[^.]+$/, '.' + b64u(crypto.randomBytes(64)));
check('un certificado con la firma alterada no vale', licencia.verificar(falso) === null);

// ── caso Pedro: el proceso de Claude no conecta y el de RobinDesktop sí → aviso técnico con la causa ──
S.minima = null; S.modo = 'ok';
const CONEX = path.join(process.env.ROBIN_DATA_DIR, 'conexion.json');
const hace2d = new Date(Date.now() - 2 * DIA).toISOString();
fs.writeFileSync(CONEX, JSON.stringify({ 'node24:claude.exe': { fallando_desde: hace2d, ultimo_error: { codigo: 'ECONNRESET', detalle: 'socket hang up', en: new Date(Date.now() - 3600e3).toISOString() }, version: '1.12.0' } }));
const st = await import(pathToFileURL(path.join(REPO, 'server/state.js')).href);
const aP = JSON.parse(fs.readFileSync(AUTH, 'utf8')); aP.expires_at = Date.now() - 1000; fs.writeFileSync(AUTH, JSON.stringify(aP));
await oauth.mantenerSesion();
await hasta(() => st.state.ultimoInforme?.motivo === 'sin_conexion_otro_proceso', 5000);
check('cuando este proceso conecta y otro lleva días sin poder, se manda el aviso técnico con su error', st.state.ultimoInforme?.motivo === 'sin_conexion_otro_proceso', JSON.stringify(st.state.ultimoInforme || {}).slice(0, 100));
const conex = JSON.parse(fs.readFileSync(CONEX, 'utf8'));
check('y cada proceso deja su propio rastro de conexión', Boolean(conex[oauth.claveProceso()]?.ultimo_ok) && Boolean(conex['node24:claude.exe']));

check('el sistema se dice como lo reconoce el abogado', oauth.nombreSO('darwin', '24.6.0') === 'macOS 15' && oauth.nombreSO('win32', '10.0.22631') === 'Windows 11' && oauth.nombreSO('win32', '10.0.19045') === 'Windows 10');

oauth.cancelarDispositivo();
oauth.pararMantenimiento();
srv.close();
fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok === results.length ? 0 : 1);
