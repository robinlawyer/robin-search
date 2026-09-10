// ESCENARIO: el despacho de verdad. El abogado autoriza en el navegador, el servidor emite
// el código... y la vuelta a http://127.0.0.1:4782x/callback NUNCA llega. Es lo que le pasó
// al primer despacho real (10-sep-2026): 12 códigos emitidos y 0 canjeados en una hora,
// mientras ESA MISMA máquina canjeaba sin un fallo los del conector remoto. Lo rompe
// cualquier antivirus/EDR que vigile sockets locales, un proxy sin excepción para loopback,
// o un navegador embebido que no sepa navegar a 127.0.0.1.
//
// Aquí el callback loopback simplemente no se invoca JAMÁS: se prueba que el login termina
// igual, porque el cliente recoge el código por su conexión de SALIDA (POST /oauth/pickup),
// identificándose con el code_verifier de PKCE — que solo existe en su máquina.
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || path.resolve(new URL('..', import.meta.url).pathname);
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};
const b64url=(b)=>Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-bloqueado-'));
const MADRE=path.join(base,'Expedientes','Núñez - Despido');
fs.mkdirSync(MADRE,{recursive:true});
fs.writeFileSync(path.join(MADRE,'01 carta de despido.txt'),
  'Carta de despido disciplinario por incumplimiento reiterado. SECRETO-NUNEZ-3003.');

// --- Emisor OAuth de pega, CON recogida por sondeo y SIN redirect que funcione ---
let sondeos=0, canjes=0, ultimoVerifier=null, ultimoPickup=null;
let consentido=false;            // se pone a true cuando "el abogado pulsa Conectar"
const CODIGO='CODIGO_POR_SONDEO';
const issuer=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  const json=(o)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
  const ISS=`http://127.0.0.1:${issuer.address().port}`;
  if(u.pathname==='/.well-known/oauth-authorization-server') return json({
    issuer:ISS, authorization_endpoint:`${ISS}/oauth/authorize`, token_endpoint:`${ISS}/oauth/token`,
    registration_endpoint:`${ISS}/oauth/register`, userinfo_endpoint:`${ISS}/oauth/userinfo`,
    revocation_endpoint:`${ISS}/oauth/revoke`, robin_code_pickup_endpoint:`${ISS}/oauth/pickup`});
  let body='';req.on('data',d=>{body+=d;});req.on('end',()=>{
    if(u.pathname==='/oauth/register'){const b=JSON.parse(body||'{}');
      return json({client_id:'cli_pega_1',redirect_uris:b.redirect_uris});}
    if(u.pathname==='/oauth/pickup'){sondeos++;
      ultimoPickup=new URLSearchParams(body);
      if(!consentido) return json({status:'pending'});
      return json({status:'ready',code:CODIGO,state:null});}
    if(u.pathname==='/oauth/token'){canjes++;
      const p=new URLSearchParams(body);
      ultimoVerifier=p.get('code_verifier');
      if(p.get('code')!==CODIGO){res.writeHead(400);return res.end('{"error":"invalid_grant"}');}
      return json({access_token:'jat_pega',refresh_token:'rt_pega',expires_in:3600,scope:'mcp:tools'});}
    if(u.pathname==='/oauth/userinfo') return json({email:'ggarcia@gh-asesores.test'});
    res.writeHead(404);res.end();});
});
await new Promise(r=>issuer.listen(0,'127.0.0.1',r));
const ISSUER=`http://127.0.0.1:${issuer.address().port}`;

const env={...process.env, ROBIN_FOLDERS:path.dirname(MADRE),
  ROBIN_OAUTH_ISSUER:ISSUER, ROBIN_NO_BROWSER:'1',
  ROBIN_DATA_DIR:path.join(base,'datos'), ROBIN_OCR:'false', ROBIN_LOG_LEVEL:'error',
  ROBIN_UPDATE_URL:'http://127.0.0.1:9/no'};
delete env.ROBIN_TOKEN;   // sin atajo de licencia: queremos el login del abogado

const c=spawn('node',[path.join(REPO,'server/index.js')],{env,stdio:['pipe','pipe','pipe']});
let buf=''; const w=new Map(); let id=1; let se='';
c.stderr.on('data',d=>{se+=d.toString();});
c.stdout.on('data',(d)=>{buf+=d.toString();let i;
  while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!l)continue;
    let m;try{m=JSON.parse(l);}catch{continue;}const f=w.get(m.id);if(f){w.delete(m.id);f(m);}}});
const rpc=(method,params)=>new Promise((res,rej)=>{const i=id++;
  const t=setTimeout(()=>rej(new Error('timeout '+method)),60000);
  w.set(i,(m)=>{clearTimeout(t);res(m);});
  c.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});
const call=async(name,args={})=>{const r=await rpc('tools/call',{name,arguments:args});
  const t=r.result?.content?.[0]?.text;return{isError:Boolean(r.result?.isError),data:t?JSON.parse(t):r,raw:t||''};};
const get=(url)=>new Promise((res,rej)=>{http.get(url,(r)=>{let b='';r.on('data',d=>{b+=d;});
  r.on('end',()=>res({status:r.statusCode,body:b}));}).on('error',rej);});
const espera=(ms)=>new Promise(r=>setTimeout(r,ms));

async function main(){
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'t',version:'1'}});
  c.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');

  const r1=await call('buscar_documentos',{consulta:'despido'});
  const url1=(r1.raw.match(/https?:\/\/\S*oauth\/authorize\?\S+/)||[])[0];
  check('sin sesión se ofrece el enlace de login', Boolean(url1));
  if(!url1) throw new Error('sin enlace no se puede seguir');
  const q=new URL(url1).searchParams;
  const redirect=q.get('redirect_uri'), challenge=q.get('code_challenge');
  check('el enlace apunta al puerto loopback de siempre', /^http:\/\/127\.0\.0\.1:478\d\d\/callback$/.test(redirect), redirect);

  // El abogado aún no ha pulsado: el sondeo debe estar preguntando y recibiendo "pending"
  // sin dar el login por perdido.
  // Ventana amplia a propósito: el servidor está indexando el expediente a la vez y
  // el bucle de eventos se le va en el embebedor, así que los tics se retrasan.
  // Lo que se comprueba es que el sondeo REPITE, no cada cuánto exactamente.
  for(let i=0;i<150 && sondeos<2;i++) await espera(200);
  check('el cliente sondea la recogida repetidamente mientras espera', sondeos>=2, `sondeos=${sondeos}`);
  check('y todavía NO ha canjeado nada', canjes===0, `canjes=${canjes}`);

  // Se identifica con el verifier, no con el challenge (el challenge viaja en la URL).
  const vEnviado=ultimoPickup?.get('code_verifier')||'';
  check('el sondeo se identifica con el code_verifier de PKCE', vEnviado.length>=43, `${vEnviado.length} chars`);
  check('y NO manda el code_challenge, que no es secreto', !String(ultimoPickup).includes('code_challenge'));
  check('el verifier corresponde al challenge del enlace (S256)',
    b64url(crypto.createHash('sha256').update(vEnviado).digest())===challenge);
  check('el cliente se identifica también con su client_id', ultimoPickup?.get('client_id')==='cli_pega_1');

  // *** EL ANTIVIRUS: el callback loopback NO se invoca nunca. ***
  consentido=true;   // el abogado pulsa "Conectar" en el navegador

  for(let i=0;i<60 && canjes===0;i++) await espera(200);
  check('el login TERMINA aunque el callback local no llegue nunca', canjes===1, `canjes=${canjes}`);
  check('y se canjea con el verifier de PKCE', ultimoVerifier===vEnviado);

  let sesion=null;
  for(let i=0;i<40;i++){const e=await call('estado_servidor');sesion=e.data?.sesion;
    if(sesion?.autenticado) break; await espera(150);}
  check('estado_servidor da la sesión por iniciada', sesion?.autenticado===true, JSON.stringify(sesion));
  check('con el usuario que devolvió el emisor', sesion?.usuario==='ggarcia@gh-asesores.test', String(sesion?.usuario));

  const r2=await call('buscar_documentos',{consulta:'despido disciplinario'});
  check('la búsqueda que pedía login ahora responde', r2.data.requiere_login!==true && !/iniciar sesión/i.test(r2.raw));

  // El sondeo debe PARAR al entrar; si no, quedaría martilleando la API para siempre.
  const antes=sondeos; await espera(5000);
  check('el sondeo se detiene en cuanto hay sesión', sondeos===antes, `${antes} → ${sondeos}`);

  // Y el navegador rezagado que llega tarde no se encuentra un error de conexión.
  const tarde=await get(`${redirect}?code=${CODIGO}&state=cualquiera`);
  check('un navegador que llega tarde sigue recibiendo una página, no un error',
    tarde.status===200 && tarde.body.length>0, `HTTP ${tarde.status}`);

  const fallos=results.filter(r=>!r).length;
  console.log(`\n${results.length-fallos}/${results.length} comprobaciones OK`);
  if(fallos){console.log(se.slice(-2000));process.exitCode=1;}
  c.kill(); issuer.close(); fs.rmSync(base,{recursive:true,force:true});
}
main().catch(e=>{console.error('ERROR:',e);console.error(se.slice(-2000));
  try{c.kill();issuer.close();}catch{} process.exit(1);});
