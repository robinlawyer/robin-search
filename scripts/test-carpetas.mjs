// ESCENARIO (confidencialidad): el abogado vigila dos carpetas que se llaman igual —la del
// despacho A y la del despacho B, las dos «Expedientes»—. RobinSearch las distingue como
// «Expedientes» y «Expedientes-2». Un día quita la de A.
//
// Hasta la 1.4.7, al quitarla: B pasaba a llamarse «Expedientes», los documentos de A se quedaban
// en el índice (la limpieza de borrados solo miraba las carpetas configuradas) con su expediente
// «Expedientes/Caso», y buscar en «Expedientes/Caso» devolvía los documentos del cliente quitado.
//
// Aquí se reproduce tal cual —con la app escribiendo ajustes.json con Claude cerrado (solo rutas,
// sin nombres) y también en caliente por el canal de control— y se exige CERO fugas. Además:
//   · el nombre lógico de cada carpeta es estable y se guarda en ajustes.json;
//   · si cambia, los documentos se re-sellan con el nombre nuevo SIN volver a indexarlos;
//   · una carpeta configurada que no responde (unidad desconectada) NO pierde nada;
//   · la misma carpeta escrita con otra caja o forma Unicode no duplica documentos;
//   · carpetas enlazadas, bucles, enlaces rotos, placeholders de iCloud y «.pdf » con espacio.
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const terminar=(p)=>p.exitCode!==null||p.signalCode!==null?Promise.resolve():new Promise(r=>{p.once('exit',r);p.kill();
  setTimeout(()=>{try{p.kill('SIGKILL');}catch{}},15000).unref();});
const borrar=(d)=>fs.rmSync(d,{recursive:true,force:true,maxRetries:10,retryDelay:300});
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};
const espera=(ms)=>new Promise(r=>setTimeout(r,ms));

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-carpetas-'));
const DATOS=path.join(base,'datos');
const AJUSTES=path.join(DATOS,'ajustes.json');
fs.mkdirSync(DATOS,{recursive:true});
const A=path.join(base,'Despacho A','Expedientes');
const B=path.join(base,'Despacho B','Expedientes');
const C=path.join(base,'Despacho C','Expedientes');
const escribir=(f,t)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,t);};
// Mismo caso, mismo vocabulario: si el aislamiento fallara, la búsqueda los mezclaría.
const TEXTO='Demanda de reclamación de cantidad por incumplimiento del contrato de arrendamiento de local.';
escribir(path.join(A,'Caso','demanda.txt'),`${TEXTO} SECRETO-CLIENTE-A-7731.`);
escribir(path.join(B,'Caso','demanda.txt'),`${TEXTO} SECRETO-CLIENTE-B-2208.`);
escribir(path.join(C,'Caso','demanda.txt'),`${TEXTO} SECRETO-CLIENTE-C-5190.`);

const envBase={...process.env,ROBIN_TOKEN:'t',ROBIN_DATA_DIR:DATOS,ROBIN_OCR:'false',ROBIN_LOG_LEVEL:'error',
  ROBIN_UPDATE_URL:'http://127.0.0.1:9/no',ROBIN_OAUTH_ISSUER:'http://127.0.0.1:9'};
delete envBase.ROBIN_FOLDERS; delete envBase.ROBIN_FOLDER; delete envBase.ROBIN_WATCHED_FOLDER;

// Servidor MCP por stdio, con esperas con tope.
function arrancar(env=envBase){
  const c=spawn(process.execPath,[path.join(REPO,'server/index.js')],{env,stdio:['pipe','pipe','pipe']});
  let buf=''; const w=new Map(); let id=1; const s={c,se:''};
  c.stderr.on('data',d=>{s.se+=d.toString();});
  c.stdout.on('data',(d)=>{buf+=d.toString();let i;
    while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!l)continue;
      let m;try{m=JSON.parse(l);}catch{continue;}const f=w.get(m.id);if(f){w.delete(m.id);f(m);}}});
  s.rpc=(method,params)=>new Promise((res,rej)=>{const i=id++;
    const t=setTimeout(()=>rej(new Error('timeout '+method)),180000);
    w.set(i,(m)=>{clearTimeout(t);res(m);});
    c.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});
  s.call=async(name,args={})=>{const r=await s.rpc('tools/call',{name,arguments:args});
    const t=r.result?.content?.[0]?.text;let data=r;try{data=t?JSON.parse(t):r;}catch{/* texto */}
    return{isError:Boolean(r.result?.isError),data,raw:t||''};};
  s.iniciar=async(docs)=>{
    await s.rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'t',version:'1'}});
    c.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    let est;
    for(let i=0;i<150;i++){est=(await s.call('estado_servidor')).data;
      if(est.estado!=='indexando'&&est.ultimo_indexado&&(docs===undefined||est.documentos_indexados===docs))break;
      await espera(800);}
    return est;
  };
  return s;
}

// Todo lo que el servidor puede devolver de cada expediente conocido, por las vías de lectura.
async function todoLoVisible(s){
  const est=(await s.call('estado_servidor')).data;
  let texto=JSON.stringify(est);
  for(const exp of est.expedientes_detectados||[]){
    texto+=(await s.call('buscar_documentos',{query:'reclamación de cantidad arrendamiento',expediente:exp,n_resultados:20})).raw;
    const l=await s.call('listar_documentos_indexados',{expediente:exp});
    texto+=l.raw;
    for(const d of l.data.documentos||[]) texto+=(await s.call('obtener_documento',{doc_id:d.doc_id,expediente:exp})).raw;
  }
  return {est,texto};
}
const leerAjustes=()=>JSON.parse(fs.readFileSync(AJUSTES,'utf8'));

async function main(){
  // ─── 1. Dos carpetas con el mismo nombre (ajustes.json de la app, formato de siempre) ───────
  fs.writeFileSync(AJUSTES,JSON.stringify({carpetas:[A,B]},null,2));
  let s=arrancar();
  let est=await s.iniciar(2);
  check('dos carpetas «Expedientes»: se distinguen como Expedientes y Expedientes-2',
    est.documentos_indexados===2 && est.expedientes_detectados.includes('Expedientes/Caso') && est.expedientes_detectados.includes('Expedientes-2/Caso'),
    JSON.stringify(est.expedientes_detectados));
  let aj=leerAjustes();
  check('ajustes.json guarda el nombre de cada carpeta y sigue teniendo «carpetas» como lista de rutas (lo que lee la app)',
    aj.carpetas.every(x=>typeof x==='string') && aj.carpetas.length===2 && aj.nombres?.[B]==='Expedientes-2' && aj.nombres?.[A]==='Expedientes',
    JSON.stringify(aj.nombres));
  await terminar(s.c);

  // ─── 2. Se quita A con Claude cerrado: la app reescribe ajustes.json SOLO con rutas ─────────
  fs.writeFileSync(AJUSTES,JSON.stringify({carpetas:[B]},null,2));
  s=arrancar();
  est=await s.iniciar();
  let v=await todoLoVisible(s);
  check('NINGUNA vía de lectura devuelve nada del cliente quitado', !v.texto.includes('SECRETO-CLIENTE-A'),
    v.texto.includes('SECRETO-CLIENTE-A')?'FUGA':`${v.est.expedientes_detectados.length} expedientes revisados`);
  check('sus documentos han salido del índice y del registro', v.est.documentos_indexados===1, `documentos=${v.est.documentos_indexados}`);
  check('B conserva su nombre (Expedientes-2), aunque la app borró los nombres del fichero',
    JSON.stringify(v.est.expedientes_detectados)===JSON.stringify(['Expedientes-2/Caso']), JSON.stringify(v.est.expedientes_detectados));
  const quitado=await s.call('buscar_documentos',{query:'reclamación de cantidad',expediente:'Expedientes/Caso'});
  check('«Expedientes/Caso» (el del cliente quitado) no devuelve nada', !quitado.raw.includes('SECRETO') , quitado.isError?'error: no existe':quitado.raw.slice(0,120));
  check('y lo de B sigue encontrándose', v.texto.includes('SECRETO-CLIENTE-B'));
  await terminar(s.c);

  // ─── 3. Cambia el nombre lógico de B: se re-sella, no se reindexa ────────────────────────────
  fs.writeFileSync(AJUSTES,JSON.stringify({carpetas:[{ruta:B,nombre:'Despacho-B'}]},null,2));
  s=arrancar();
  est=await s.iniciar(1);
  const b=await s.call('buscar_documentos',{query:'reclamación de cantidad arrendamiento',expediente:'Despacho-B/Caso'});
  const f=b.data.fragmentos?.[0];
  check('con el nombre nuevo se encuentra, y el índice ya lo archiva así',
    b.raw.includes('SECRETO-CLIENTE-B') && f?.expediente==='Despacho-B/Caso' && f?.ruta_relativa==='Despacho-B/Caso/demanda.txt',
    JSON.stringify({expediente:f?.expediente,ruta:f?.ruta_relativa}));
  check('sin volver a indexar el documento (se re-sella, no se recalculan vectores)',
    est.ultimo_indexado?.indexados===0 && est.ultimo_indexado?.sinCambios===1, JSON.stringify({indexados:est.ultimo_indexado?.indexados,sinCambios:est.ultimo_indexado?.sinCambios}));
  check('el nombre viejo ya no existe', !(await s.call('buscar_documentos',{query:'x',expediente:'Expedientes-2/Caso'})).raw.includes('SECRETO'));
  check('ajustes.json acepta {ruta, nombre} y deja «carpetas» como rutas para la app',
    (()=>{const a=leerAjustes();return a.nombres?.[B]==='Despacho-B';})(), JSON.stringify(leerAjustes()));
  await terminar(s.c);

  // ─── 4. La unidad de B no responde (carpeta desaparecida), pero SIGUE configurada ───────────
  const Bfuera=path.join(base,'Despacho B','Expedientes (desconectada)');
  fs.renameSync(B,Bfuera);
  s=arrancar();
  est=await s.iniciar();
  check('una carpeta configurada que no responde NO pierde sus documentos',
    est.documentos_indexados===1 && est.expedientes_detectados.includes('Despacho-B/Caso'),
    `documentos=${est.documentos_indexados}`);
  await terminar(s.c);
  fs.renameSync(Bfuera,B);

  // ─── 5. En caliente, por el canal de control (Claude abierto): quitar B y añadir C ──────────
  s=arrancar();
  est=await s.iniciar(1);
  const huella=crypto.createHash('sha256').update(DATOS).digest('hex').slice(0,8);
  const RUTA=process.platform==='win32'?`\\\\.\\pipe\\robinsearch-${huella}`:path.join('/tmp',`robinsearch-${huella}.sock`);
  let sock=null;
  for(let i=0;i<120&&!sock;i++){ try{ sock=await new Promise((res,rej)=>{const x=net.connect(RUTA);x.once('connect',()=>res(x));x.once('error',rej);}); }catch{ await espera(250);} }
  if(!sock){ check('el canal de control abre', false); }
  else {
    const msgs=[]; let buf=''; sock.setEncoding('utf8');
    sock.on('data',(t)=>{buf+=t;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(l){try{msgs.push(JSON.parse(l));}catch{}}}});
    // Como la app: primero escribe el fichero (solo rutas) y luego manda la orden.
    fs.writeFileSync(AJUSTES,JSON.stringify({carpetas:[C]},null,2));
    sock.write(JSON.stringify({cmd:'configurar',carpetas:[C]})+'\n');
    for(let i=0;i<800&&!msgs.some(m=>m.tipo==='fin-reindexado');i++) await espera(150);
    const r=msgs.find(m=>m.cmd==='configurar');
    check('la app cambia las carpetas en caliente', r?.ok===true && msgs.some(m=>m.tipo==='fin-reindexado'&&m.ok), JSON.stringify(r));
    v=await todoLoVisible(s);
    check('C hereda el nombre «Expedientes» y NO se ve nada de A ni de B',
      v.est.expedientes_detectados.join()==='Expedientes/Caso' && v.texto.includes('SECRETO-CLIENTE-C')
      && !v.texto.includes('SECRETO-CLIENTE-A') && !v.texto.includes('SECRETO-CLIENTE-B'),
      JSON.stringify({exp:v.est.expedientes_detectados,docs:v.est.documentos_indexados}));
    const a=leerAjustes();
    check('ajustes.json: «carpetas» sigue siendo la lista de rutas de la app, con el nombre al lado',
      JSON.stringify(a.carpetas)===JSON.stringify([C]) && a.nombres?.[C]==='Expedientes', JSON.stringify(a));
    try{sock.destroy();}catch{}
  }
  await terminar(s.c);

  // ─── 6. La misma carpeta escrita de otra forma, enlaces, bucles, nube y «.pdf » ─────────────
  const D2=path.join(base,'datos-2');
  const MADRE=path.join(base,'Casos');
  const NFD='Pérez - Divorcio', NFC='Pérez - Divorcio';
  escribir(path.join(MADRE,NFD,'escrito.txt'),'Escrito de medidas provisionales y guarda y custodia. SECRETO-PEREZ-1.');
  escribir(path.join(base,'Fuera','Anexos','anexo.txt'),'Anexo de la carpeta enlazada. SECRETO-ENLACE-2.');
  const winJ=process.platform==='win32'?'junction':'dir';
  let enlaces=true;
  try{
    fs.symlinkSync(path.join(base,'Fuera','Anexos'),path.join(MADRE,NFD,'Anexos'),winJ);   // carpeta enlazada (OneDrive/junction)
    fs.symlinkSync(MADRE,path.join(MADRE,NFD,'Bucle'),winJ);                               // bucle hacia arriba
    fs.mkdirSync(path.join(base,'se-borra'));
    fs.symlinkSync(path.join(base,'se-borra'),path.join(MADRE,'Roto'),winJ);               // enlace roto
    fs.rmSync(path.join(base,'se-borra'),{recursive:true});
  }catch(err){ enlaces=false; console.log(`  (omitido) este sistema no deja crear enlaces: ${err.code}`); }
  escribir(path.join(MADRE,NFD,'.Recurso.pdf.icloud'),'placeholder');
  const conEspacio=process.platform!=='win32'; // Windows no admite nombres con espacio final
  if(conEspacio) escribir(path.join(MADRE,NFD,'nota.txt '),'Nota interna con espacio al final del nombre. SECRETO-ESPACIO-3.');
  // Configurada con OTRA caja (en Windows/macOS es la misma carpeta).
  const sinCaja=process.platform==='win32'||process.platform==='darwin';
  const configurada=sinCaja?path.join(base,'CASOS'):MADRE;
  s=arrancar({...envBase,ROBIN_DATA_DIR:D2,ROBIN_FOLDERS:configurada});
  const esperados=1+(enlaces?1:0)+(conEspacio?1:0);
  est=await s.iniciar(esperados);
  check('carpeta enlazada y «nota.txt » (espacio final) se indexan; el bucle no se recorre dos veces',
    est.documentos_indexados===esperados, `documentos=${est.documentos_indexados} de ${esperados}`);
  const ni=est.no_indexables||{};
  check('el placeholder de iCloud se cuenta como «no descargado», sin nombres',
    ni.no_descargados===1 && !JSON.stringify(ni).includes('Recurso'), JSON.stringify(ni));
  if(enlaces) check('el enlace roto y el bucle se cuentan', ni.enlaces_inaccesibles>=1 && ni.bucles_evitados>=1, JSON.stringify(ni));
  if(sinCaja){
    check('la carpeta configurada con otra caja se escribe como está en disco',
      est.carpetas_vigiladas?.[0]?.ruta===MADRE || est.carpetas_vigiladas?.[0]?.ruta?.endsWith(`${path.sep}Casos`), est.carpetas_vigiladas?.[0]?.ruta);
    const otraForma=path.join(configurada,NFC.toUpperCase());
    const r=await s.call('indexar_carpeta',{path:otraForma});
    const est2=(await s.call('estado_servidor')).data;
    check('indexar_carpeta con otra caja y otra forma Unicode NO duplica documentos',
      !r.isError && est2.documentos_indexados===esperados, `documentos=${est2.documentos_indexados} ${r.isError?r.raw.slice(0,200):''}`);
  }
  const exp=est.expedientes_detectados.find(e=>e.normalize('NFC')===`Casos/${NFC}`);
  const sub=await s.call('buscar_documentos',{query:'anexo de la carpeta enlazada',expediente:exp,subcarpeta:'anexos'});
  if(enlaces) check('filtro de subcarpeta sin distinguir mayúsculas', sub.raw.includes('SECRETO-ENLACE-2'), sub.raw.includes('SECRETO-ENLACE-2')?'':sub.raw.slice(0,160));
  const lista=await s.call('listar_documentos_indexados',{expediente:NFC.toLowerCase(),subcarpeta:''});
  check('el expediente en NFD se abre escrito en NFC', !lista.isError && lista.data.total===esperados, `total=${lista.data.total}`);
  await terminar(s.c);

  // ─── 7. Vigilante: fichero nuevo, carpeta renombrada y carpeta borrada con Claude abierto ────
  // En Windows chokidar 3 dejaba un descriptor abierto por subcarpeta y RENOMBRAR la carpeta de un
  // caso fallaba (EPERM). Ahora hay un único vigilante recursivo del sistema por carpeta.
  const W=path.join(base,'Vigilada');
  escribir(path.join(W,'Caso','inicial.txt'),'Documento inicial del caso vigilado. SECRETO-VIG-1.');
  s=arrancar({...envBase,ROBIN_DATA_DIR:path.join(base,'datos-3'),ROBIN_FOLDERS:W});
  est=await s.iniciar(1);
  const hasta=async(fn,ms=40000)=>{const t0=Date.now();while(Date.now()-t0<ms){if(await fn())return true;await espera(700);}return false;};
  const rutasIndexadas=async()=>{const e=(await s.call('estado_servidor')).data;let r=[];
    for(const x of e.expedientes_detectados||[]){const l=await s.call('listar_documentos_indexados',{expediente:x});r=r.concat((l.data.documentos||[]).map(d=>d.ruta_relativa));}
    return r;};
  escribir(path.join(W,'Caso','nuevo.txt'),'Escrito nuevo que deja el abogado con Claude abierto. SECRETO-VIG-2.');
  check('un fichero nuevo entra solo en el índice',
    await hasta(async()=>(await rutasIndexadas()).includes('Vigilada/Caso/nuevo.txt')));
  let renombrada=true;
  try{ fs.renameSync(path.join(W,'Caso'),path.join(W,'Caso renombrado')); }
  catch(err){ renombrada=false; check('la carpeta de un caso se puede renombrar con RobinSearch vigilándola', false, err.code); }
  if(renombrada){
    check('la carpeta de un caso se puede renombrar con RobinSearch vigilándola', true);
    check('y el índice sigue al nombre nuevo (fuera las rutas viejas, dentro las nuevas)',
      await hasta(async()=>{const r=await rutasIndexadas();
        return r.length===2 && r.includes('Vigilada/Caso renombrado/inicial.txt') && r.includes('Vigilada/Caso renombrado/nuevo.txt');}),
      JSON.stringify(await rutasIndexadas()));
    fs.rmSync(path.join(W,'Caso renombrado'),{recursive:true,force:true});
    check('al borrar la carpeta, sus documentos salen del índice',
      await hasta(async()=>(await rutasIndexadas()).length===0), JSON.stringify(await rutasIndexadas()));
  }
  await terminar(s.c);

  const fallos=results.filter(r=>!r).length;
  console.log(`\n${results.length-fallos}/${results.length} comprobaciones OK`);
  if(fallos){console.log(s.se.slice(-2000));process.exitCode=1;}
  borrar(base);
}
main().catch(e=>{console.error('ERROR:',e);process.exit(1);});
