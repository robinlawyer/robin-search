// ESCENARIO (Juan, 12-nov-2026): el abogado saca del expediente un documento por error o por
// confidencialidad. Un fichero borrado con rm salió del índice en uno o dos minutos; una carpeta
// con un PDF y dos imágenes borrada desde Finder siguió «indexada» varios minutos. ¿Puede una
// búsqueda devolverlo en ese intervalo?
//
// Lo que se prueba: con el vigilante APAGADO y el repaso de carpetas a una hora (= el índice NO se
// entera del borrado), nada borrado del disco se sirve: ni en buscar_documentos, ni por doc_id en
// obtener_documento / obtener_fragmento / indice_documento, ni en listar_documentos_indexados. Y lo
// que sigue en disco se sigue sirviendo.
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const terminar=(p)=>p.exitCode!==null||p.signalCode!==null?Promise.resolve():new Promise(r=>{p.once('exit',r);p.kill();
  setTimeout(()=>{try{p.kill('SIGKILL');}catch{}},15000).unref();});
const borrar=(d)=>fs.rmSync(d,{recursive:true,force:true,maxRetries:10,retryDelay:300});
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};
const espera=(ms)=>new Promise(r=>setTimeout(r,ms));

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-borrados-'));
const MADRE=path.join(base,'Expedientes');
const CASO=path.join(MADRE,'Ortega - Reclamación');
const SUB=path.join(CASO,'Confidencial');
const PAPELERA=path.join(base,'Papelera');
fs.mkdirSync(SUB,{recursive:true}); fs.mkdirSync(PAPELERA);
fs.writeFileSync(path.join(CASO,'01 demanda.txt'),'Demanda de reclamación de cantidad por obra impagada. SIGUE-ORTEGA-1.');
fs.writeFileSync(path.join(CASO,'02 burofax.txt'),'Burofax de requerimiento de pago de la obra a la constructora. BORRADO-RM-2.');
fs.writeFileSync(path.join(SUB,'informe pericial.txt'),'Informe pericial sobre los defectos de la obra y su valoración. CARPETA-FINDER-3.');
fs.writeFileSync(path.join(SUB,'nota interna.txt'),'Nota interna sobre la estrategia de la obra frente a la constructora. CARPETA-FINDER-4.');

const env={...process.env,ROBIN_TOKEN:'t',ROBIN_FOLDERS:MADRE,
  ROBIN_VIGILANTE:'ninguno',ROBIN_RESCAN_LOCAL_MS:String(3600000),   // el índice NO se entera
  ROBIN_DATA_DIR:path.join(base,'datos'),ROBIN_OCR:'false',ROBIN_LOG_LEVEL:'error',
  ROBIN_UPDATE_URL:'http://127.0.0.1:9/no'};
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
  const t=r.result?.content?.[0]?.text;let data=null;try{data=t?JSON.parse(t):r;}catch{data={texto:t};}
  return{isError:Boolean(r.result?.isError),data,raw:t||''};};

try{
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'prueba',version:'1'}});
  c.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  let est;
  for(let i=0;i<180;i++){est=(await call('estado_servidor')).data;
    if(est.estado==='activo'&&est.documentos_indexados>=4)break; await espera(1000);}
  check('los cuatro documentos están indexados',est?.documentos_indexados>=4,JSON.stringify(est?.documentos_indexados));
  await call('establecer_expediente_activo',{expediente:'Ortega - Reclamación'});

  const lista=(await call('listar_documentos_indexados')).data.documentos||[];
  const idDe=(t)=>lista.find((d)=>d.ruta_relativa.includes(t))?.doc_id;
  const idBurofax=idDe('burofax'), idPericial=idDe('pericial'), idDemanda=idDe('demanda');
  check('el registro da doc_id de cada uno',Boolean(idBurofax&&idPericial&&idDemanda));
  const antes=(await call('buscar_documentos',{query:'obra constructora',n_resultados:10})).raw;
  check('antes de borrar, la búsqueda los sirve',['BORRADO-RM-2','CARPETA-FINDER-3','SIGUE-ORTEGA-1'].every((s)=>antes.includes(s)));

  // rm de un fichero y la carpeta «a la Papelera» (Finder la MUEVE, no la borra).
  fs.rmSync(path.join(CASO,'02 burofax.txt'));
  fs.renameSync(SUB,path.join(PAPELERA,'Confidencial'));

  const desp=(await call('buscar_documentos',{query:'obra constructora',n_resultados:10})).raw;
  check('buscar_documentos no sirve el fichero borrado con rm',!desp.includes('BORRADO-RM-2'));
  check('buscar_documentos no sirve la carpeta movida a la Papelera',!desp.includes('CARPETA-FINDER-3')&&!desp.includes('CARPETA-FINDER-4'));
  check('buscar_documentos sigue sirviendo lo que está en disco',desp.includes('SIGUE-ORTEGA-1'));

  const od=await call('obtener_documento',{doc_id:idBurofax});
  check('obtener_documento por doc_id no lo sirve',od.isError&&!od.raw.includes('BORRADO-RM-2')&&od.raw.includes('retirado_del_disco'),od.raw.slice(0,120));
  const of=await call('obtener_fragmento',{doc_id:idPericial,chunk_id:0});
  check('obtener_fragmento no lo sirve',of.isError&&!of.raw.includes('CARPETA-FINDER-3'),of.raw.slice(0,120));
  const ix=await call('indice_documento',{doc_id:idPericial});
  check('indice_documento no lo sirve',ix.isError&&!ix.raw.includes('CARPETA-FINDER-3'),ix.raw.slice(0,120));
  const ls=(await call('listar_documentos_indexados')).raw;
  check('listar_documentos_indexados no los lista',!ls.includes('burofax')&&!ls.includes('pericial')&&ls.includes('demanda'));
  const ok=await call('obtener_documento',{doc_id:idDemanda});
  check('obtener_documento sigue sirviendo lo que está en disco',!ok.isError&&ok.raw.includes('SIGUE-ORTEGA-1'));
} catch(e){ check('sin excepciones',false,String(e)); }
finally { await terminar(c); borrar(base); }
const fallos=results.filter((r)=>!r).length;
console.log(`\n${results.length-fallos}/${results.length} comprobaciones`);
process.exit(fallos?1:0);
