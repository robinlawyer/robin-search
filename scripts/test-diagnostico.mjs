// ESCENARIO: el indexado falla en TODOS los ficheros (motor de embedding caído). Es el modo
// de fallo real del 8-sep: "0 documentos indexados, 680 errores" sobre una carpeta con
// documentos perfectamente legibles — y `estado_servidor` contestando "activo", sin una sola
// pista de por qué. La causa vivía únicamente en un fichero de log local.
//
// Lo que se prueba:
//   1. Un indexado con errores deja el servidor en 'error', no en 'activo'.
//   2. El error del arranque (motor que no carga) NO lo borra el indexado que viene después.
//   3. Las causas se devuelven AGRUPADAS, con recuento y fichero de ejemplo.
//   4. `estado_servidor` publica motor de embedding y resumen del último indexado.
//   5. `indexar_carpeta({ path })` no revienta con ReferenceError (faltaba `import path`).
//   6. Con el motor sano, todo lo anterior vuelve a verde y el modelo sale del paquete.
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

// fileURLToPath y no `.pathname`: en Windows da «/C:/…» y en cualquier SO rompe con espacios o tildes.
const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
// Parar un servidor y ESPERAR a que muera: en Windows no hay SIGTERM (kill = TerminateProcess)
// y en Mac/Linux la señal no se atiende hasta que el bucle de eventos queda libre (WASM síncrono).
// Borrar su carpeta antes de que muera da EBUSY/EPERM en Windows.
const terminar=(p)=>p.exitCode!==null||p.signalCode!==null?Promise.resolve():new Promise(r=>{p.once('exit',r);p.kill();
  setTimeout(()=>{try{p.kill('SIGKILL');}catch{}},15000).unref();});
const borrar=(d)=>fs.rmSync(d,{recursive:true,force:true,maxRetries:10,retryDelay:300});
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-diag-'));
const MADRE=path.join(base,'Expedientes');
const CASO=path.join(MADRE,'Lledo - Concurso');
const OTRO=path.join(MADRE,'Pereira - Contencioso');
fs.mkdirSync(CASO,{recursive:true}); fs.mkdirSync(OTRO,{recursive:true});
fs.writeFileSync(path.join(CASO,'01 informe.txt'),'Informe de la administración concursal sobre la masa activa.');
fs.writeFileSync(path.join(CASO,'02 convenio.txt'),'Propuesta de convenio con quita y espera para los acreedores ordinarios.');
fs.writeFileSync(path.join(OTRO,'01 recurso.txt'),'Recurso contencioso-administrativo por desviación de poder.');

function servidor(extraEnv){
  const env={...process.env,ROBIN_TOKEN:'t',ROBIN_FOLDERS:MADRE,
    ROBIN_DATA_DIR:path.join(base,'datos-'+Math.abs(hash(JSON.stringify(extraEnv)))),
    ROBIN_OCR:'false',ROBIN_LOG_LEVEL:'error',ROBIN_UPDATE_URL:'http://127.0.0.1:9/no',...extraEnv};
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
    const t=r.result?.content?.[0]?.text;
    let data=null; try{data=t?JSON.parse(t):null;}catch{data=null;}
    return{isError:Boolean(r.result?.isError),data,raw:t||''};};
  return {proc:c,rpc,call};
}
function hash(s){let h=0;for(const ch of s)h=(h*31+ch.charCodeAt(0))|0;return h;}
const espera=(ms)=>new Promise(r=>setTimeout(r,ms));
async function esperarFin(call,intentos=90){
  for(let i=0;i<intentos;i++){
    const e=await call('estado_servidor');
    if(e.data && e.data.estado!=='indexando' && e.data.ultimo_indexado) return e.data;
    await espera(1000);
  }
  return (await call('estado_servidor')).data;
}

// ───────────────────────── A. Motor de embedding caído ─────────────────────────
console.log('\nA. El motor de embedding no carga (todos los ficheros fallan)\n');
const vacio=path.join(base,'sin-modelo'); fs.mkdirSync(vacio,{recursive:true});
const roto=servidor({ROBIN_EMBED_MODEL:'Xenova/robin-modelo-inexistente',ROBIN_MODELS_DIR:vacio});
await roto.rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'test',version:'1'}});
{
  const est=await esperarFin(roto.call);
  check('el servidor NO se declara "activo" con el indexado roto', est.estado==='error', `estado=${est.estado}`);
  check('publica ultimo_error con la causa', Boolean(est.ultimo_error), String(est.ultimo_error).slice(0,70));
  check('publica motor_embedding y lo marca no cargado',
    est.motor_embedding && est.motor_embedding.cargado===false && Boolean(est.motor_embedding.error),
    est.motor_embedding?String(est.motor_embedding.error).slice(0,50):'ausente');
  check('publica ultimo_indexado con los 3 ficheros en error',
    est.ultimo_indexado?.errores===3, `errores=${est.ultimo_indexado?.errores}`);
  const causas=est.ultimo_indexado?.errores_por_causa||[];
  check('agrupa las causas en UNA sola', causas.length===1, `${causas.length} causa(s)`);
  check('la causa lleva recuento y fichero de ejemplo',
    causas[0]?.ficheros===3 && Boolean(causas[0]?.ejemplo), JSON.stringify(causas[0]||{}).slice(0,90));
  check('avisa de que el indexado falló', Boolean(est.aviso_indexado));

  const idx=await roto.call('indexar_carpeta',{forzar:true});
  check('indexar_carpeta devuelve las causas, no solo el número',
    Array.isArray(idx.data?.errores_por_causa) && idx.data.errores_por_causa.length>0);
  check('indexar_carpeta dice que han fallado TODOS y remite a estado_servidor',
    /TODOS/.test(idx.data?.aviso||'') && /motor_embedding/.test(idx.data?.aviso||''),
    String(idx.data?.aviso||'').slice(0,80));
}
await terminar(roto.proc);

// ───────────────────────── B. Motor sano ─────────────────────────
console.log('\nB. Motor sano: el modelo sale del paquete y el indexado va limpio\n');
const sano=servidor({});
await sano.rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'test',version:'1'}});
{
  const est=await esperarFin(sano.call);
  check('el modelo va EMPAQUETADO (sin descarga en casa del abogado)',
    est.motor_embedding?.empaquetado===true && est.motor_embedding?.origen==='empaquetado',
    JSON.stringify(est.motor_embedding||{}).slice(0,110));
  check('indexado sin errores', est.ultimo_indexado?.errores===0, JSON.stringify(est.ultimo_indexado||{}).slice(0,90));
  check('vuelve a "activo" y sin ultimo_error', est.estado==='activo' && !est.ultimo_error, `estado=${est.estado}`);
  check('los 3 documentos están indexados', est.documentos_indexados===3, `${est.documentos_indexados}`);

  // Regresión del ReferenceError: `path` no estaba importado en indexar_carpeta.js, así que
  // acotar la reindexación a una subcarpeta —el paso natural de diagnóstico— siempre fallaba.
  const sub=await sano.call('indexar_carpeta',{path:CASO,forzar:true});
  check('indexar_carpeta({path}) NO revienta (import path)',
    !sub.isError && !/path is not defined/.test(sub.raw), sub.raw.slice(0,70));
  check('indexar_carpeta({path}) acota a esa subcarpeta',
    Array.isArray(sub.data?.carpetas) && sub.data.carpetas.length===1 && sub.data.carpetas[0]===CASO);
  check('indexar_carpeta({path}) reindexa solo sus 2 ficheros', sub.data?.indexados===2, `${sub.data?.indexados}`);

  const fuera=await sano.call('indexar_carpeta',{path:path.join(base,'fuera-de-ambito')});
  check('una ruta fuera de ámbito se rechaza con mensaje, no con excepción',
    fuera.isError && /fuera de las carpetas/.test(fuera.raw) && !/is not defined/.test(fuera.raw),
    fuera.raw.slice(0,70));
}
await terminar(sano.proc);

// ───────── C. Da igual qué nivel se elija en el diálogo de instalación ─────────
// El abogado elige "la carpeta" al instalar y no tiene por qué acertar el nivel. Si elegía la
// carpeta del CASO, sus subcarpetas pasaban a ser expedientes propios y una búsqueda sobre el
// caso devolvía SOLO los sueltos de la raíz — sin error, sin aviso. Misma carpeta, misma
// pregunta, respuesta distinta según el nivel elegido: eso es lo que se prueba aquí.
console.log('\nC. El nivel elegido al instalar no puede cambiar el resultado\n');
const CASO2=path.join(base,'Un caso suelto');
fs.mkdirSync(path.join(CASO2,'01 Demanda'),{recursive:true});
fs.mkdirSync(path.join(CASO2,'02 Prueba'),{recursive:true});
fs.writeFileSync(path.join(CASO2,'nota.txt'),'Nota de encargo del cliente.');
fs.writeFileSync(path.join(CASO2,'01 Demanda','demanda.txt'),'Demanda de reclamación de cantidad contra Acme SL.');
fs.writeFileSync(path.join(CASO2,'02 Prueba','contrato.txt'),'Contrato de obra y certificaciones de obra ejecutada.');
// Caso HERMANO cuyo nombre empieza igual: la comparación tiene que ser por SEGMENTOS.
const HERMANO=path.join(base,'Un caso suelto - Pieza separada');
fs.mkdirSync(HERMANO,{recursive:true});
fs.writeFileSync(path.join(HERMANO,'pieza.txt'),'SECRETO-DE-OTRO-CLIENTE: pieza separada de medidas cautelares.');

for (const [etiqueta,carpeta] of [['carpeta del CASO',CASO2],['carpeta MADRE',base]]) {
  const s2=servidor({ROBIN_FOLDERS:carpeta,ROBIN_DATA_DIR:path.join(base,'d-'+Math.abs(hash(carpeta)))});
  await s2.rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'t',version:'1'}});
  await esperarFin(s2.call);
  const fijar=await s2.call('establecer_expediente_activo',{expediente:'Un caso suelto'});
  check(`[${etiqueta}] se puede fijar el caso`, !fijar.isError, fijar.raw.slice(0,60));
  check(`[${etiqueta}] anuncia sus 3 documentos, no solo los sueltos`,
    fijar.data?.documentos_indexados===3, `${fijar.data?.documentos_indexados}`);
  const b=await s2.call('buscar_documentos',{query:'certificaciones de obra ejecutada',n_resultados:5});
  const ficheros=(b.data?.fragmentos||[]).map((f)=>f.fichero).sort();
  check(`[${etiqueta}] la búsqueda alcanza las subcarpetas del caso`,
    ficheros.length===3, ficheros.join(', '));
  check(`[${etiqueta}] y NO alcanza el caso hermano de nombre parecido`,
    !ficheros.includes('pieza.txt') && !b.raw.includes('SECRETO-DE-OTRO-CLIENTE'));
  const lista=await s2.call('listar_documentos_indexados',{});
  check(`[${etiqueta}] listar_documentos_indexados ve los mismos 3`, lista.data?.total===3, `${lista.data?.total}`);
  await terminar(s2.proc);
}

borrar(base);
const fallos=results.filter((r)=>!r).length;
console.log(`\n${results.length-fallos}/${results.length} comprobaciones OK`);
process.exit(fallos===0?0:1);
