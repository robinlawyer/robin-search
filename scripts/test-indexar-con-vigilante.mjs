// ESCENARIO (Juan, 12-nov-2026): pedir indexar_carpeta mientras el vigilante ya está indexando.
// Juan no pudo ejercerlo: con 80 ficheros pequeños el vigilante terminaba en segundos. Aquí se
// fuerza con una carga grande (N ficheros de ~12 KB, el vigilante tarda minutos) y se prueba en
// los dos casos reales: (A) la MISMA instancia de RobinSearch y (B) una SEGUNDA instancia sobre el
// mismo índice, que es la que arranca Claude además de la de RobinDesktop.
// Lo que se exige: ninguna de las dos peticiones da error, la respuesta dice que ya se está
// indexando o que queda en cola, y al final están TODOS los ficheros indexados.
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const N = Number(process.env.N || 400);
const terminar=(p)=>p.exitCode!==null||p.signalCode!==null?Promise.resolve():new Promise(r=>{p.once('exit',r);p.kill();
  setTimeout(()=>{try{p.kill('SIGKILL');}catch{}},15000).unref();});
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};
const espera=(ms)=>new Promise(r=>setTimeout(r,ms));
const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-carga-'));
const MADRE=path.join(base,'Expedientes'); const CASO=path.join(MADRE,'Carga');
fs.mkdirSync(CASO,{recursive:true});
fs.writeFileSync(path.join(CASO,'00 inicial.txt'),'Documento inicial del expediente de carga.');
const env={...process.env,ROBIN_TOKEN:'t',ROBIN_FOLDERS:MADRE,ROBIN_DATA_DIR:path.join(base,'datos'),
  ROBIN_OCR:'false',ROBIN_LOG_LEVEL:'error',ROBIN_UPDATE_URL:'http://127.0.0.1:9/no'};

function servidor(){
  const c=spawn(process.execPath,[path.join(REPO,'server/index.js')],{env,stdio:['pipe','pipe','pipe']});
  let buf=''; const w=new Map(); let id=1; c.stderr.on('data',()=>{});
  c.stdout.on('data',(d)=>{buf+=d.toString();let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!l)continue;
    let m;try{m=JSON.parse(l);}catch{continue;}const f=w.get(m.id);if(f){w.delete(m.id);f(m);}}});
  const rpc=(method,params)=>new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>rej(new Error('timeout '+method+' '+JSON.stringify(params?.name||''))),300000);
    w.set(i,(m)=>{clearTimeout(t);res(m);});c.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});
  const call=async(name,args={})=>{const t0=Date.now();const r=await rpc('tools/call',{name,arguments:args});if(process.env.TRAZA)console.error(`[traza] ${name} ${((Date.now()-t0)/1000).toFixed(1)} s`);const t=r.result?.content?.[0]?.text;
    let data;try{data=JSON.parse(t);}catch{data={texto:t};}return{isError:Boolean(r.result?.isError),data,raw:t||''};};
  const ini=async()=>{await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'prueba',version:'1'}});
    c.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');};
  return {c,call,ini};
}
const lote=(pref)=>{for(let i=0;i<N;i++) fs.writeFileSync(path.join(CASO,`${pref}${String(i).padStart(4,'0')}.txt`),
  (`Hecho ${i} del expediente: la empresa comunicó al trabajador la modificación de sus condiciones. `).repeat(120));};
const A=servidor(); let B=null;
try{
  await A.ini();
  for(let i=0;i<120;i++){const e=(await A.call('estado_servidor')).data; if(e.estado==='activo'&&e.documentos_indexados>=1)break; await espera(1000);}
  // (A) misma instancia
  lote('a'); await espera(4000);
  const ea=(await A.call('estado_servidor')).data;
  const ra=await A.call('indexar_carpeta',{});
  check('(A) misma instancia: el vigilante estaba indexando',ea.estado!=='activo'||Boolean(ea.indexando),String(ea.estado));
  check('(A) indexar_carpeta no da error',!ra.isError,ra.raw.slice(0,200));
  check('(A) dice que queda en cola o en curso',/cola|en curso|indexando|encolado/i.test(ra.raw),ra.raw.slice(0,160));
  // (B) segunda instancia sobre el mismo índice
  lote('b'); await espera(4000);
  B=servidor(); await B.ini();
  const rb=await B.call('indexar_carpeta',{});
  check('(B) segunda instancia: indexar_carpeta no da error',!rb.isError,rb.raw.slice(0,200));
  check('(B) dice que ya se están indexando',/ya se est[áa]n indexando|cola|en curso/i.test(rb.raw),rb.raw.slice(0,160));
  await terminar(B.c); B=null;
  let n=0; const t0=Date.now();
  while(Date.now()-t0<1800000){const e=(await A.call('estado_servidor')).data; n=e.documentos_indexados;
    if(n>=2*N+1&&e.estado==='activo')break; await espera(3000);}
  check('al final están todos indexados',n>=2*N+1,`${n} de ${2*N+1} en ${((Date.now()-t0)/1000).toFixed(0)} s`);
} catch(e){ check('sin excepciones',false,String(e)); }
finally { if(B) await terminar(B.c); await terminar(A.c); fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:300}); }
const fallos=results.filter((r)=>!r).length; console.log(`\n${results.length-fallos}/${results.length} comprobaciones`); process.exit(fallos?1:0);
