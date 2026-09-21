// ESCENARIO: el abogado deja un documento nuevo en su carpeta de expedientes — en SU disco, no
// en el servidor del despacho — y el vigilante del sistema se pierde el aviso. Pasa de verdad:
// carpetas sincronizadas por iCloud/Drive (el fichero aparece primero como marcador), un disco
// externo que se va y vuelve, el equipo suspendido, o una copia masiva que desborda la cola de
// FSEvents. Hasta la 1.8.0 nadie volvía a mirar: ese documento se quedaba fuera del índice para
// siempre y la búsqueda mentía por omisión (Eduardo, 21-sep-2026).
//
// Lo que se prueba: con el vigilante de eventos APAGADO (ROBIN_VIGILANTE=ninguno, que es la
// forma de simular «el aviso no llegó»), el repaso periódico de las carpetas locales acaba
// indexando el documento nuevo y retirando el borrado, sin que nadie pida nada.
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const terminar=(p)=>p.exitCode!==null||p.signalCode!==null?Promise.resolve():new Promise(r=>{p.once('exit',r);p.kill();
  setTimeout(()=>{try{p.kill('SIGKILL');}catch{}},15000).unref();});
const borrar=(d)=>fs.rmSync(d,{recursive:true,force:true,maxRetries:10,retryDelay:300});
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};
const espera=(ms)=>new Promise(r=>setTimeout(r,ms));

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-local-'));
const MADRE=path.join(base,'Expedientes');
const CASO=path.join(MADRE,'Peralta - Despido');
fs.mkdirSync(CASO,{recursive:true});
fs.writeFileSync(path.join(CASO,'01 demanda.txt'),
  'Demanda por despido improcedente contra la empresa. SECRETO-PERALTA-1001.');

const RESCAN_MS=3000;
const env={...process.env,ROBIN_TOKEN:'t',
  ROBIN_FOLDERS:MADRE,
  ROBIN_VIGILANTE:'ninguno',              // <- el aviso del sistema NO llega nunca
  ROBIN_RESCAN_LOCAL_MS:String(RESCAN_MS),
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
  const t=r.result?.content?.[0]?.text;return{isError:Boolean(r.result?.isError),data:t?JSON.parse(t):r,raw:t||''};};

try{
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'prueba',version:'1'}});
  c.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');

  let est;
  for(let i=0;i<120;i++){est=(await call('estado_servidor')).data;
    if(est.estado==='activo'&&est.documentos_indexados>=1)break; await espera(1000);}
  check('el documento de partida está indexado',est?.documentos_indexados>=1,JSON.stringify(est?.documentos_indexados));

  // Las búsquedas van por expediente: se abre el del caso antes de preguntar nada.
  await call('establecer_expediente_activo',{expediente:'Peralta - Despido'});

  // Documento NUEVO: nadie avisa, el vigilante está apagado.
  fs.writeFileSync(path.join(CASO,'02 papeleta conciliacion.txt'),
    'Papeleta de conciliación ante el SMAC previa a la demanda por despido. SECRETO-PERALTA-2002.');
  let hallado=false;
  for(let i=0;i<25 && !hallado;i++){ await espera(RESCAN_MS/2);
    hallado=(await call('buscar_documentos',{query:'papeleta de conciliación ante el SMAC'}))
      .raw.includes('SECRETO-PERALTA-2002'); }
  check('el documento nuevo aparece solo, por el repaso de la carpeta local',hallado);

  // Y lo borrado se retira, también sin evento.
  fs.rmSync(path.join(CASO,'02 papeleta conciliacion.txt'));
  let fuera=false;
  for(let i=0;i<25 && !fuera;i++){ await espera(RESCAN_MS/2);
    fuera=!(await call('listar_documentos_indexados')).raw.includes('papeleta'); }
  check('lo borrado se retira del índice en el mismo repaso',fuera);
} finally {
  await terminar(c);
  borrar(base);
}
const fallos=results.filter(x=>!x).length;
console.log(`\n${results.length-fallos}/${results.length} comprobaciones`);
process.exit(fallos?1:0);
