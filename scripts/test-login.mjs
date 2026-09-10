// ESCENARIO: el abogado instala RobinSearch y tiene que iniciar sesión en Robin Lawyer.
// El login abre el navegador y espera la vuelta en un puerto loopback (127.0.0.1:4782x).
//
// El 10-sep-2026 un abogado en prueba (Windows, red de despacho) NO pudo entrar en más de
// 40 minutos: 9 códigos de autorización emitidos y NINGUNO canjeado. Tres defectos, cada uno
// suficiente por sí solo para dejarle fuera para siempre — y los tres invisibles desde el
// servidor, porque el handshake muere en su ordenador:
//
//   1. `cmd /c start "" <url>` parte la URL en el primer `&` (Node solo entrecomilla los
//      argumentos con espacios), así que el navegador recibía `?response_type=code` a secas.
//   2. ensureAuthorized() devolvía el enlace en el MISMO tick en que lanzaba el login: null
//      la primera vez, y el enlace del flujo ANTERIOR las siguientes.
//   3. y ese enlace viejo, al llegar con un `state` que no era el del flujo vivo, ABORTABA el
//      flujo bueno («Error de seguridad») — de modo que cada reintento quemaba el intento útil.
//
// Se prueba contra un emisor OAuth de pega en 127.0.0.1: sin red y sin navegador.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || path.resolve(new URL('..', import.meta.url).pathname);
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};

// --- 1. La orden de abrir el navegador: pura, sin lanzar nada ---
const { browserCommand } = await import(new URL('../server/auth/oauth.js', import.meta.url));
{
  const url='https://api.robinlawyer.ai/oauth/authorize?response_type=code&client_id=abc&state=xyz';
  const win=browserCommand('win32',url);
  check('en Windows la URL NO pasa por el shell (nada de cmd/start)',
    win.cmd!=='cmd' && !win.args.includes('start'), `${win.cmd} ${win.args[0]}`);
  check('y viaja como UN solo argumento, con sus `&` intactos',
    win.args.filter(a=>a.includes('&')).length===1 && win.args.includes(url));
  check('en Mac y Linux se mantiene el camino de siempre',
    browserCommand('darwin',url).cmd==='open' && browserCommand('linux',url).cmd==='xdg-open');
}

// --- Emisor OAuth de pega ---
const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-login-'));
const MADRE=path.join(base,'Expedientes',"Núñez - Despido");
fs.mkdirSync(MADRE,{recursive:true});
fs.writeFileSync(path.join(MADRE,'01 carta de despido.txt'),
  'Carta de despido disciplinario por incumplimiento reiterado. SECRETO-NUNEZ-3003.');

let registros=0, canjes=0, ultimoVerifier=null;
const issuer=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  const json=(o)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
  const ISS=`http://127.0.0.1:${issuer.address().port}`;
  if(u.pathname==='/.well-known/oauth-authorization-server') return json({
    issuer:ISS, authorization_endpoint:`${ISS}/oauth/authorize`, token_endpoint:`${ISS}/oauth/token`,
    registration_endpoint:`${ISS}/oauth/register`, userinfo_endpoint:`${ISS}/oauth/userinfo`,
    revocation_endpoint:`${ISS}/oauth/revoke`});
  let body='';req.on('data',d=>{body+=d;});req.on('end',()=>{
    if(u.pathname==='/oauth/register'){registros++;
      const b=JSON.parse(body||'{}');
      return json({client_id:'cli_pega_1',redirect_uris:b.redirect_uris});}
    if(u.pathname==='/oauth/token'){canjes++;
      ultimoVerifier=new URLSearchParams(body).get('code_verifier');
      return json({access_token:'jat_pega',refresh_token:'rt_pega',expires_in:3600,scope:'mcp:tools'});}
    if(u.pathname==='/oauth/userinfo') return json({email:'gonzalo@despacho.test'});
    res.writeHead(404);res.end();});
});
await new Promise(r=>issuer.listen(0,'127.0.0.1',r));
const ISSUER=`http://127.0.0.1:${issuer.address().port}`;

const env={...process.env, ROBIN_FOLDERS:path.dirname(MADRE),
  ROBIN_OAUTH_ISSUER:ISSUER, ROBIN_NO_BROWSER:'1',
  ROBIN_DATA_DIR:path.join(base,'datos'), ROBIN_OCR:'false', ROBIN_LOG_LEVEL:'error',
  ROBIN_UPDATE_URL:'http://127.0.0.1:9/no'};
delete env.ROBIN_TOKEN;   // sin atajo: queremos el login por navegador

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

  // --- 2. El PRIMER intento ya trae el enlace (antes venía null) ---
  const r1=await call('buscar_documentos',{consulta:'despido'});
  check('sin sesión, la búsqueda pide iniciar sesión en vez de fallar en seco',
    r1.data.requiere_login===true || /iniciar sesión/i.test(r1.raw));
  const url1=(r1.raw.match(/https?:\/\/\S*oauth\/authorize\?\S+/)||[])[0];
  check('y en la PRIMERA llamada ya da el enlace (antes venía vacío)',
    Boolean(url1), url1?url1.slice(0,58)+'…':'sin enlace');
  if(!url1) throw new Error('sin enlace no se puede seguir');
  check('el cliente OAuth se registró una sola vez', registros===1, `registros=${registros}`);

  const q=new URL(url1).searchParams;
  const redirect=q.get('redirect_uri'), state=q.get('state');
  check('el enlace lleva PKCE S256 y su state', Boolean(q.get('code_challenge'))
    && q.get('code_challenge_method')==='S256' && Boolean(state));

  // --- 3. Un enlace viejo (state de otro flujo) NO puede matar al flujo vivo ---
  const malo=await get(`${redirect}?code=CODIGO_VIEJO&state=state_de_otro_intento`);
  check('un enlace de un intento anterior se explica en vez de dar «Error de seguridad»',
    malo.status===200 && /ya no es válido/i.test(malo.body) && !/Error de seguridad/i.test(malo.body));
  check('y NO se ha canjeado ese código ajeno', canjes===0, `canjes=${canjes}`);

  // El flujo bueno sigue escuchando: es lo que antes se perdía.
  const bueno=await get(`${redirect}?code=CODIGO_BUENO&state=${encodeURIComponent(state)}`);
  check('el flujo vivo sigue en pie y acepta el enlace correcto',
    bueno.status===200 && /Conexión establecida/i.test(bueno.body));

  for(let i=0;i<40 && canjes===0;i++) await espera(100);
  check('el código se canjea contra el emisor', canjes===1, `canjes=${canjes}`);
  check('y se canjea con el verifier de PKCE', Boolean(ultimoVerifier));

  // --- 4. Sesión iniciada de verdad: la tool ya no pide login ---
  let sesion=null;
  for(let i=0;i<40;i++){const e=await call('estado_servidor');sesion=e.data?.sesion;
    if(sesion?.autenticado) break; await espera(100);}
  check('estado_servidor da la sesión por iniciada', sesion?.autenticado===true, JSON.stringify(sesion));
  check('y con el usuario que devolvió el emisor', sesion?.usuario==='gonzalo@despacho.test', String(sesion?.usuario));

  const r2=await call('buscar_documentos',{consulta:'despido disciplinario'});
  check('la misma búsqueda que antes pedía login ahora responde',
    r2.data.requiere_login!==true && !/iniciar sesión/i.test(r2.raw));

  const fallos=results.filter(r=>!r).length;
  console.log(`\n${results.length-fallos}/${results.length} comprobaciones OK`);
  if(fallos){console.log(se.slice(-2000));process.exitCode=1;}
  c.kill(); issuer.close(); fs.rmSync(base,{recursive:true,force:true});
}
main().catch(e=>{console.error('ERROR:',e);console.error(se.slice(-2000));
  try{c.kill();issuer.close();}catch{} process.exit(1);});
