// ESCENARIO: el abogado se lleva el portátil de vacaciones, al AVE o a una sala sin red, o el
// servidor de Robin no responde un rato. Buscar en sus expedientes es 100 % local, así que no puede
// pedirle iniciar sesión durante 14 días. Al volver la conexión la sesión se renueva sola (nadie
// vuelve a entrar). Y un rechazo EXPLÍCITO del servidor (sesión revocada) sí exige entrar.
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

// fileURLToPath y no `.pathname`: en Windows da «/C:/…» y en cualquier SO rompe con espacios o tildes.
const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};
const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-sin-conexion-'));
const DIA=24*3600*1000;

// Servidor de Robin de mentira: `modo` decide qué contesta al renovar.
let modo='sin_red'; let renovaciones=0;
const srv=http.createServer((req,res)=>{
  if(req.url.startsWith('/oauth/token')){
    renovaciones+=1;
    if(modo==='sin_red'){ req.socket.destroy(); return; }
    if(modo==='caido'){ res.writeHead(503,{'Content-Type':'text/html'}); res.end('<html>mantenimiento</html>'); return; }
    if(modo==='revocada'){ res.writeHead(400,{'Content-Type':'application/json'}); res.end('{"error":"invalid_grant"}'); return; }
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({access_token:'nuevo',refresh_token:'llave-2',expires_in:86400}));
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r)=>srv.listen(0,'127.0.0.1',r));
process.env.ROBIN_DATA_DIR=path.join(base,'datos');
process.env.ROBIN_OAUTH_ISSUER=`http://127.0.0.1:${srv.address().port}`;
process.env.ROBIN_NO_BROWSER='1';
process.env.ROBIN_LOG_LEVEL='error';
delete process.env.ROBIN_TOKEN;
fs.mkdirSync(process.env.ROBIN_DATA_DIR,{recursive:true});
const AUTH=path.join(process.env.ROBIN_DATA_DIR,'auth.json');
const sesion=(caducoHaceMs)=>fs.writeFileSync(AUTH,JSON.stringify({client_id:'c',access_token:'viejo',refresh_token:'llave-1',
  expires_at:Date.now()-caducoHaceMs,user:{email:'abogado@example.com'}}));
const { ensureAuthorized } = await import(pathToFileURL(path.join(REPO,'server/auth/oauth.js')).href);

sesion(1*DIA); modo='sin_red';
let r=await ensureAuthorized();
check('sin red, con la sesión caducada ayer → sigue buscando', r.ok && r.mode==='sin_conexion', JSON.stringify({ok:r.ok,mode:r.mode}));
check('y dice hasta cuándo (14 días desde que caducó)', Math.abs(new Date(r.sin_conexion_hasta).getTime()-(Date.now()-DIA+14*DIA))<60000, r.sin_conexion_hasta);

sesion(13*DIA); modo='sin_red';
r=await ensureAuthorized();
check('13 días sin conexión (vacaciones) → sigue buscando', r.ok && r.mode==='sin_conexion');

sesion(15*DIA); modo='sin_red';
r=await ensureAuthorized();
check('15 días sin conexión → pide iniciar sesión', !r.ok);

sesion(2*DIA); modo='caido';
r=await ensureAuthorized();
check('servidor de Robin caído (503) → sigue buscando', r.ok && r.mode==='sin_conexion');

sesion(10*DIA); modo='ok';
r=await ensureAuthorized();
const guardada=JSON.parse(fs.readFileSync(AUTH,'utf8'));
check('al volver la conexión la sesión se renueva sola, sin volver a entrar', r.ok && r.mode==='oauth' && guardada.access_token==='nuevo' && guardada.refresh_token==='llave-2');

sesion(1*DIA); modo='revocada';
r=await ensureAuthorized();
const tras=JSON.parse(fs.readFileSync(AUTH,'utf8'));
check('sesión revocada por el servidor (rechazo explícito) → pide iniciar sesión', !r.ok && !tras.access_token && !tras.refresh_token);

srv.close();
fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:300});
const ok=results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok===results.length?0:1);
