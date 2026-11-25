// Dos carpetas cuyo nombre solo se distingue por un espacio final («Ruiz» y «Ruiz »): son dos
// clientes. La selección guarda el id EXACTO del catálogo; recortarlo servía el otro (revisión de
// Codex, 25-nov, 7.ª ronda de la fusión de la ficha del asunto).
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const terminar=(p)=>p.exitCode!==null||p.signalCode!==null?Promise.resolve():new Promise(r=>{p.once('exit',r);p.kill();
  setTimeout(()=>{try{p.kill('SIGKILL');}catch{}},15000).unref();});
const borrar=(d)=>fs.rmSync(d,{recursive:true,force:true,maxRetries:10,retryDelay:300});
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-espacio-'));
const MADRE=path.join(base,'Expedientes');
for(const [caso,secreto] of [['Ruiz','SECRETO-SIN-ESPACIO-1111'],['Ruiz ','SECRETO-CON-ESPACIO-2222']]){
  fs.mkdirSync(path.join(MADRE,caso),{recursive:true});
  fs.writeFileSync(path.join(MADRE,caso,'escrito.txt'),`Escrito de demanda del cliente. ${secreto}.`);
}
const SIM=path.join(base,'dialogo.json');
const elige=(x)=>fs.writeFileSync(SIM,JSON.stringify(x));
const env={...process.env,ROBIN_TOKEN:'t',ROBIN_FOLDERS:MADRE,
  ROBIN_DATA_DIR:path.join(base,'datos'),ROBIN_VENTANA_VARIOS_EXPEDIENTES_MIN:'0',ROBIN_OCR:'false',ROBIN_LOG_LEVEL:'error',
  ROBIN_UPDATE_URL:'http://127.0.0.1:9/no',ROBIN_DIALOGO_SIMULADO:`@${SIM}`,ROBIN_ESPERA_DIALOGO_MS:'1500'};
const c=spawn(process.execPath,[path.join(REPO,'server/index.js')],{env,stdio:['pipe','pipe','pipe']});
let buf=''; const w=new Map(); let id=1;
c.stderr.on('data',()=>{});
c.stdout.on('data',(d)=>{buf+=d.toString();let i;
  while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!l)continue;
    let m;try{m=JSON.parse(l);}catch{continue;}const f=w.get(m.id);if(f){w.delete(m.id);f(m);}}});
const rpc=(method,params)=>new Promise((res,rej)=>{const i=id++;
  const t=setTimeout(()=>rej(new Error('timeout '+method)),180000);
  w.set(i,(m)=>{clearTimeout(t);res(m);});
  c.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});
const call=async(name,args={})=>{const r=await rpc('tools/call',{name,arguments:args});
  const t=r.result?.content?.[0]?.text;let d=null;try{d=JSON.parse(t);}catch{}return{isError:Boolean(r.result?.isError),data:d,raw:t||''};};

async function main(){
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'t',version:'1'}});
  c.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  let est;
  for(let i=0;i<120;i++){est=(await call('estado_servidor')).data;
    if(est?.estado==='activo'&&est.documentos_indexados>=2)break; await new Promise(r=>setTimeout(r,1500));}
  check('índice listo con los dos clientes',est.documentos_indexados===2,`documentos=${est?.documentos_indexados}`);

  elige({rutas:[path.join(MADRE,'Ruiz ')]});
  let r=await call('elegir_expediente');
  check('elegir «Ruiz » fija EXACTAMENTE ese id',!r.isError && r.data.expediente_activo==='Expedientes/Ruiz ', r.raw.slice(0,200));
  let b=await call('buscar_documentos',{query:'escrito de demanda',n_resultados:10});
  check('la búsqueda sin expediente sirve «Ruiz » y no «Ruiz»',
    b.raw.includes('SECRETO-CON-ESPACIO-2222') && !b.raw.includes('SECRETO-SIN-ESPACIO-1111'), b.raw.slice(0,200));

  // Confirmación de una elección heredada: el código guarda el id exacto.
  elige({rutas:[path.join(MADRE,'Ruiz ')],tarda_ms:2500});
  await call('elegir_expediente');
  elige({rutas:[path.join(MADRE,'Ruiz')]});
  r=await call('elegir_expediente');
  const cf=await call('elegir_expediente',{confirmar:r.data?.confirmar});
  check('confirmar fija «Ruiz » y no «Ruiz»',!cf.isError && cf.data.expediente_activo==='Expedientes/Ruiz ', cf.raw.slice(0,200));

  const ex=await call('buscar_documentos',{query:'escrito de demanda',expediente:'Expedientes/Ruiz',n_resultados:10});
  check('indicando «Expedientes/Ruiz» explícito se sirve ese y no «Ruiz »',
    ex.raw.includes('SECRETO-SIN-ESPACIO-1111') && !ex.raw.includes('SECRETO-CON-ESPACIO-2222'));
  const ex2=await call('buscar_documentos',{query:'escrito de demanda',expediente:'Expedientes/Ruiz ',n_resultados:10});
  check('y «Expedientes/Ruiz » explícito, el suyo',
    ex2.raw.includes('SECRETO-CON-ESPACIO-2222') && !ex2.raw.includes('SECRETO-SIN-ESPACIO-1111'));

  const blanco=await call('buscar_documentos',{query:'escrito de demanda',expediente:'   ',n_resultados:10});
  check('un "expediente" en blanco da error y no usa el activo', blanco.isError && !/SECRETO-/.test(blanco.raw));
  const vacio=await call('buscar_documentos',{query:'escrito de demanda',expediente:'',n_resultados:10});
  check('y "expediente": "" tampoco', vacio.isError && !/SECRETO-/.test(vacio.raw));

  // Si «Ruiz » desaparece, el activo NO pasa a «Ruiz».
  fs.rmSync(path.join(MADRE,'Ruiz '),{recursive:true,force:true});
  for(let i=0;i<60;i++){const e=(await call('estado_servidor')).data; if(e?.documentos_indexados===1&&e.estado!=='indexando')break; await new Promise(r=>setTimeout(r,1000));}
  b=await call('buscar_documentos',{query:'escrito de demanda',n_resultados:10});
  check('desaparecido «Ruiz », la búsqueda sin expediente no sirve «Ruiz»',
    b.isError && !b.raw.includes('SECRETO-SIN-ESPACIO-1111'), b.raw.slice(0,200));
  const rec=await call('buscar_documentos',{query:'escrito de demanda',expediente:'Expedientes/Ruiz ',n_resultados:10});
  check('y el id que dio el servidor («Expedientes/Ruiz ») no se resuelve a «Ruiz»',
    rec.isError && !rec.raw.includes('SECRETO-SIN-ESPACIO-1111'), rec.raw.slice(0,200));
}

// Profundidad 0: cada raíz es un expediente y su id no lleva «/». Retirada «Cliente-Ana», su id no
// puede pasar por parecido a «Cliente Ana», que es otro cliente (revisión de Codex, 11.ª ronda).
async function profundidadCero(){
  const raiz=fs.mkdtempSync(path.join(os.tmpdir(),'rs-prof0-'));
  const A=path.join(raiz,'Cliente-Ana'), B=path.join(raiz,'Cliente Ana');
  fs.mkdirSync(A); fs.mkdirSync(B);
  const codigo=`
    const fs=await import('node:fs');
    const ex=await import(${JSON.stringify(new URL('../server/expedientes.js',import.meta.url).href)});
    const antes=ex.nombresConocidos();
    const r1=ex.resolver('Cliente-Ana');
    const {config}=await import(${JSON.stringify(new URL('../server/config.js',import.meta.url).href)});
    config.roots=config.roots.filter((r)=>r.name!=='Cliente-Ana'); // retirada de la configuración
    const despues=ex.nombresConocidos();
    const r2=ex.resolver('Cliente-Ana');
    const r3=ex.resolver('cliente ana');
    console.log(JSON.stringify({antes,despues,r1:r1.expediente??r1.motivo,r2:r2.expediente??r2.motivo,r3:r3.expediente??r3.motivo}));`;
  const out=await new Promise((res)=>{const p=spawn(process.execPath,['--input-type=module','-e',codigo],{env:{...process.env,
    ROBIN_TOKEN:'t',ROBIN_FOLDERS:JSON.stringify([A,B]),ROBIN_EXPEDIENTE_DEPTH:'0',ROBIN_DATA_DIR:path.join(raiz,'datos'),
    ROBIN_LOG_LEVEL:'error',ROBIN_UPDATE_URL:'http://127.0.0.1:9/no',QUITAR:A},stdio:['ignore','pipe','pipe']});
    let o='';p.stdout.on('data',d=>o+=d);p.on('exit',()=>res(o));});
  borrar(raiz);
  let d={};try{d=JSON.parse(out.trim().split('\n').pop());}catch{}
  check('profundidad 0: las dos raíces son expedientes distintos', (d.antes||[]).length===2, out.slice(0,200));
  check('retirada «Cliente-Ana», su id NO pasa a «Cliente Ana»', d.r1==='Cliente-Ana' && JSON.stringify(d.despues)==='["Cliente Ana"]' && d.r2!=='Cliente Ana', JSON.stringify(d));
  check('y lo escrito a mano sigue encontrando «Cliente Ana»', d.r3==='Cliente Ana', JSON.stringify(d));
}

main().then(profundidadCero).catch(e=>{console.error(e);results.push(false);}).finally(async()=>{
  await terminar(c); borrar(base);
  const okN=results.filter(Boolean).length;
  console.log(`\n${okN}/${results.length} comprobaciones OK`);
  process.exit(okN===results.length?0:1);
});
