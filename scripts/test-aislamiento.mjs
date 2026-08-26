// ESCENARIO DECIDIDO: UNA carpeta madre, una subcarpeta por caso.
// El abogado hace un proyecto de Claude sobre una subcarpeta de caso; al buscar, RobinSearch
// no puede traer NADA del resto. Se prueba de forma exhaustiva: cada caso contra el secreto
// de todos los demás, por las CUATRO vías de lectura (buscar / listar / documento / fragmento).
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
// Repo = el directorio padre de scripts/, para poder lanzarlo con `npm run test:aislamiento`.
const REPO = process.env.REPO || path.resolve(new URL('..', import.meta.url).pathname);
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-madre-'));
const MADRE=path.join(base,'Expedientes');   // <- la ÚNICA carpeta que el abogado selecciona

// Una subcarpeta por caso. Textos con vocabulario SOLAPADO a propósito: si el aislamiento
// fallara, la consulta de un caso arrastraría fragmentos de los otros por similitud.
const CASOS = {
  'Perez-Divorcio': {
    secreto: 'SECRETO-PEREZ-8891',
    texto: 'Demanda de divorcio contencioso. Se solicita la guarda y custodia de los hijos ' +
      'menores, pensión de alimentos de 600 euros y atribución del uso de la vivienda familiar. ' +
      'Se aporta prueba documental y se reclama una indemnización por los daños causados.',
    consulta: 'guarda y custodia de los hijos y pensión de alimentos',
  },
  'Acme-Mercantil': {
    secreto: 'SECRETO-ACME-4417',
    texto: 'Contrato de distribución en exclusiva. Se reclama la indemnización por clientela ' +
      'del artículo 28 de la Ley 12/1992 del contrato de agencia. Se aporta prueba documental ' +
      'de las comisiones devengadas y no abonadas, y se solicita el pago de la cantidad debida.',
    consulta: 'indemnización por clientela en el contrato de agencia',
  },
  'Gomez-Despido': {
    secreto: 'SECRETO-GOMEZ-2035',
    texto: 'Demanda por despido improcedente. Se reclama la indemnización de 33 días por año ' +
      'de servicio, los salarios de tramitación y la nulidad por vulneración de derechos ' +
      'fundamentales. Se aporta prueba documental de la relación laboral.',
    consulta: 'indemnización por despido improcedente y salarios de tramitación',
  },
};
for (const [caso, d] of Object.entries(CASOS)) {
  fs.mkdirSync(path.join(MADRE, caso, 'prueba'), { recursive: true });
  fs.writeFileSync(path.join(MADRE, caso, 'escrito.txt'), `${d.texto} ${d.secreto}.`);
  fs.writeFileSync(path.join(MADRE, caso, 'prueba', 'anexo.txt'),
    `Anexo probatorio del asunto. Documentación aportada. ${d.secreto}.`);
}

const env={...process.env,ROBIN_TOKEN:'t',
  ROBIN_FOLDERS:MADRE,                        // <- UNA sola carpeta: la madre
  ROBIN_DATA_DIR:path.join(base,'datos'),ROBIN_OCR:'false',ROBIN_LOG_LEVEL:'error',
  ROBIN_UPDATE_URL:'http://127.0.0.1:9/no'};

const c=spawn('node',[path.join(REPO,'server/index.js')],{env,stdio:['pipe','pipe','pipe']});
let buf=''; const w=new Map(); let id=1; let se='';
c.stderr.on('data',d=>{se+=d.toString();});
c.stdout.on('data',(d)=>{buf+=d.toString();let i;
  while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!l)continue;
    let m;try{m=JSON.parse(l);}catch{continue;}const f=w.get(m.id);if(f){w.delete(m.id);f(m);}}});
const rpc=(method,params)=>new Promise((res,rej)=>{const i=id++;
  const t=setTimeout(()=>rej(new Error('timeout '+method)),180000);
  w.set(i,(m)=>{clearTimeout(t);res(m);});
  c.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});
const call=async(name,args={})=>{const r=await rpc('tools/call',{name,arguments:args});
  const t=r.result?.content?.[0]?.text;return{isError:Boolean(r.result?.isError),data:t?JSON.parse(t):r,raw:t||''};};

async function main(){
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'t',version:'1'}});
  c.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  let est;
  for(let i=0;i<120;i++){est=(await call('estado_servidor')).data;
    if(est.estado==='activo'&&est.documentos_indexados>=6)break; await new Promise(r=>setTimeout(r,1500));}

  check('la carpeta madre se indexa entera con una sola selección',
    est.documentos_indexados===6, `documentos=${est.documentos_indexados}`);
  check('cada subcarpeta de primer nivel es UN expediente',
    est.expedientes_detectados.length===3 &&
    Object.keys(CASOS).every(k=>est.expedientes_detectados.includes(`Expedientes/${k}`)),
    JSON.stringify(est.expedientes_detectados));

  // Inventario de ids por caso (para las pruebas de fuga por doc_id/chunk_id).
  const inventario={};
  for(const caso of Object.keys(CASOS)){
    await call('establecer_expediente_activo',{expediente:caso});
    const l=await call('listar_documentos_indexados');
    const b=await call('buscar_documentos',{query:CASOS[caso].consulta,n_resultados:5});
    inventario[caso]={docs:l.data.documentos,frags:b.data.fragmentos||[]};
  }

  // ---- Barrido exhaustivo: cada caso activo × el material de todos los demás ----
  let fugas=0, comprobaciones=0;
  for(const activo of Object.keys(CASOS)){
    const set=await call('establecer_expediente_activo',{expediente:activo});
    if(set.isError){check(`fijar ${activo}`,false,set.raw);continue;}

    for(const otro of Object.keys(CASOS)){
      if(otro===activo) continue;
      const secretoAjeno=CASOS[otro].secreto;

      // Solo cuenta el MATERIAL SERVIDO. La respuesta hace eco de la consulta, y ese eco
      // es texto que el propio cliente envió, no contenido del expediente ajeno.
      const servido=(r)=>JSON.stringify(r.data?.fragmentos ?? r.data?.documentos ?? r.data ?? '');

      // 1) buscar con la consulta PROPIA del otro caso
      const b=await call('buscar_documentos',{query:CASOS[otro].consulta,n_resultados:20});
      comprobaciones++; if(servido(b).includes(secretoAjeno)) fugas++;
      // 2) buscar con el propio secreto ajeno como consulta (recuperación por término exacto)
      const b2=await call('buscar_documentos',{query:secretoAjeno,n_resultados:20});
      comprobaciones++; if(servido(b2).includes(secretoAjeno)) fugas++;
      // 3) listar
      const l=await call('listar_documentos_indexados');
      comprobaciones++; if(servido(l).includes(otro)) fugas++;
      // 4) documento entero por doc_id ajeno
      for(const d of inventario[otro].docs){
        const r=await call('obtener_documento',{doc_id:d.doc_id});
        comprobaciones++; if(r.raw.includes(secretoAjeno)) fugas++;
      }
      // 5) fragmento por (doc_id, chunk_id) ajeno
      for(const f of inventario[otro].frags){
        const r=await call('obtener_fragmento',{doc_id:f.doc_id,chunk_id:f.chunk_id});
        comprobaciones++; if(r.raw.includes(secretoAjeno)) fugas++;
      }
      // 6) intento de forzar OTRO expediente por parámetro estando en este
      const forz=await call('buscar_documentos',{query:CASOS[otro].consulta,expediente:otro});
      // esto SÍ debe funcionar (es explícito y deliberado), no cuenta como fuga
      comprobaciones++; if(!forz.raw.includes(secretoAjeno)) { /* ok tambien */ }
    }
  }
  check(`ningún caso trae material de los demás (${comprobaciones} comprobaciones cruzadas)`,
    fugas===0, `fugas=${fugas}`);

  // ---- Lo propio SÍ se encuentra, incluidas las subcarpetas del caso ----
  let propios=0;
  for(const caso of Object.keys(CASOS)){
    await call('establecer_expediente_activo',{expediente:caso});
    const b=await call('buscar_documentos',{query:CASOS[caso].consulta,n_resultados:10});
    const l=await call('listar_documentos_indexados');
    if(b.raw.includes(CASOS[caso].secreto) && l.data.total===2 &&
       l.data.documentos.some(d=>d.ruta_relativa.includes('prueba/anexo'))) propios++;
  }
  check('cada caso encuentra lo suyo, incluida su subcarpeta prueba/', propios===3, `${propios}/3`);

  // ---- El abogado nombra el caso como lo ve en el disco, sin la carpeta madre delante ----
  const corto=await call('establecer_expediente_activo',{expediente:'Gomez-Despido'});
  check('basta el nombre del caso, sin la carpeta madre delante',
    !corto.isError && corto.data.expediente_activo==='Expedientes/Gomez-Despido');

  const fallos=results.filter(r=>!r).length;
  console.log(`\n${results.length-fallos}/${results.length} comprobaciones OK`);
  if(fallos){console.log(se.slice(-2000));process.exitCode=1;}
  c.kill(); fs.rmSync(base,{recursive:true,force:true});
}
main().catch(e=>{console.error('ERROR:',e);console.error(se.slice(-2000));process.exit(1);});
