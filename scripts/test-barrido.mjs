// ESCENARIO: due diligence sobre un expediente que NO cabe en el contexto del modelo.
//
// La promesa del barrido es doble, y las dos mitades se prueban aquí:
//   · COBERTURA — cada ventana del expediente se sirve exactamente una vez, sin saltos ni
//     repeticiones, el progreso es medible, y lo que NO se ha podido leer (un escaneado sin
//     texto) se declara en voz alta en vez de desaparecer.
//   · HALLAZGO — la contradicción entre dos documentos aparece en la vista cruzada SIN que
//     nadie la haya sospechado ni preguntado por ella. Es lo que la búsqueda semántica no
//     puede hacer: encuentra lo que se parece a la pregunta, no lo que no se te ocurrió.
//
// Además: el barrido se reanuda tras cerrar el servidor (el estado vive en disco, no en la
// conversación) y se invalida solo si un documento cambia en disco.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || path.resolve(new URL('..', import.meta.url).pathname);
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-barrido-'));
const MADRE=path.join(base,'Expedientes');
const CASO=path.join(MADRE,'Vega - Compraventa nave');
const OTRO=path.join(MADRE,'Ruiz - Laboral');
fs.mkdirSync(CASO,{recursive:true}); fs.mkdirSync(OTRO,{recursive:true});

const relleno=(t)=>`${t} `.repeat(120);
// LA CONTRADICCIÓN: el contrato dice una fecha de entrega y el acta posterior dice otra.
// Están en documentos distintos y nadie va a preguntar por ellas.
fs.writeFileSync(path.join(CASO,'01 contrato de compraventa.txt'),
  'CONTRATO DE COMPRAVENTA DE NAVE INDUSTRIAL. '+relleno('Estipulaciones generales de la compraventa entre las partes.')+
  ' ESTIPULACION CUARTA: el plazo de entrega de la nave es el 30 de junio de 2024. '+relleno('Obligaciones de saneamiento y evicción.'));
fs.writeFileSync(path.join(CASO,'05 acta de la junta.txt'),
  'ACTA DE LA REUNION DE SEGUIMIENTO. '+relleno('Los comparecientes revisan el estado de la operación.')+
  ' Las partes hacen constar que el plazo de entrega de la nave es el 15 de septiembre de 2024. '+relleno('Sin más asuntos se levanta la sesión.'));
fs.writeFileSync(path.join(CASO,'03 correo del arquitecto.txt'),
  'Correo del arquitecto sobre la licencia de primera ocupación. '+relleno('Estado de la tramitación municipal del expediente de obra.'));
// Un "escaneado" sin texto legible: tiene que salir declarado como zona ciega.
fs.writeFileSync(path.join(CASO,'07 plano escaneado.png'), Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'));
// Otro cliente: su material no puede aparecer NUNCA en este barrido.
fs.writeFileSync(path.join(OTRO,'01 demanda.txt'),'SECRETO-RUIZ: demanda por despido improcedente. '+relleno('Hechos de la relación laboral.'));

function servidor(extra={}){
  const env={...process.env,ROBIN_TOKEN:'t',ROBIN_FOLDERS:MADRE,
    ROBIN_DATA_DIR:path.join(base,'datos'),ROBIN_OCR:'false',ROBIN_LOG_LEVEL:'error',
    ROBIN_VENTANA_REVISION:'3',ROBIN_UPDATE_URL:'http://127.0.0.1:9/no',...extra};
  const c=spawn('node',[path.join(REPO,'server/index.js')],{env,stdio:['pipe','pipe','pipe']});
  let buf='';const w=new Map();let id=1;c.stderr.on('data',()=>{});
  c.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);
    if(!l)continue;let m;try{m=JSON.parse(l)}catch{continue}const f=w.get(m.id);if(f){w.delete(m.id);f(m)}}});
  const rpc=(method,params)=>new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>rej(new Error('timeout '+method)),300000);
    w.set(i,m=>{clearTimeout(t);res(m)});c.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n')});
  const call=async(n,a={})=>{const r=await rpc('tools/call',{name:n,arguments:a});const t=r.result?.content?.[0]?.text;
    let d=null;try{d=JSON.parse(t)}catch{}return{isError:Boolean(r.result?.isError),data:d,raw:t||''}};
  return {proc:c,rpc,call};
}
const espera=(ms)=>new Promise(r=>setTimeout(r,ms));
async function listo(call){for(let i=0;i<180;i++){const e=await call('estado_servidor');
  if(e.data?.ultimo_indexado&&e.data.estado!=='indexando')return e.data;await espera(1000);}
  return (await call('estado_servidor')).data;}

let s=servidor();
await s.rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'t',version:'1'}});
const est0=await listo(s.call);
check('el expediente se ha indexado', est0.documentos_indexados>=3, `${est0.documentos_indexados} documentos`);
await s.call('establecer_expediente_activo',{expediente:'Vega - Compraventa nave'});

// ── 1. La síntesis se niega si no hay barrido ──
const pronto=await s.call('obtener_anotaciones');
check('sin barrido, la síntesis se niega en vez de inventar',
  pronto.isError && /no se ha empezado/.test(pronto.raw), pronto.raw.slice(0,60));

// ── 2. El bucle completo: leer → anotar → siguiente ──
const primera=await s.call('siguiente_por_revisar');
const TOTAL=primera.data?.ventanas_totales;
check('el plan del barrido cuenta las ventanas del expediente', TOTAL>0, `${TOTAL} ventanas`);
check('la primera ventana trae su texto y su documento',
  Boolean(primera.data?.texto) && Boolean(primera.data?.doc_id), (primera.data?.ruta_relativa||'').slice(-40));

const servidas=[]; let v=primera; let vueltas=0;
while(v.data && !v.data.completado && v.data.doc_id && vueltas<200){
  vueltas++;
  const clave=`${v.data.ruta_relativa}#${v.data.desde_fragmento}`;
  servidas.push(clave);
  // Se extraen los hechos que de verdad se ven en el texto de ESTA ventana.
  const afirmaciones=[];
  for(const m of v.data.texto.matchAll(/plazo de entrega de la nave es el ([^.]+)/g)){
    afirmaciones.push({afirmacion:`plazo de entrega: ${m[1].trim()}`,pagina:1});
  }
  await s.call('anotar',{doc_id:v.data.doc_id,desde_fragmento:v.data.desde_fragmento,
    resumen:`Ventana ${v.data.desde_fragmento} de ${v.data.ruta_relativa}`,
    ...(afirmaciones.length?{afirmaciones}:{})});
  v=await s.call('siguiente_por_revisar');
}
check('el barrido termina y se declara completo', v.data?.completado===true, `${vueltas} vueltas`);
check('cada ventana se sirvió UNA sola vez (sin repetir)', new Set(servidas).size===servidas.length,
  `${servidas.length} servidas, ${new Set(servidas).size} distintas`);
check('se sirvieron TODAS las ventanas del plan (sin saltos)', servidas.length===TOTAL, `${servidas.length}/${TOTAL}`);

// ── 3. Lo que no se ha podido leer se declara ──
check('el escaneado sin texto se declara como zona ciega, no desaparece',
  (v.data?.no_revisables||[]).some(d=>/plano escaneado/.test(d.ruta_relativa)),
  JSON.stringify(v.data?.no_revisables||[]).slice(0,80));
check('y el aviso lo dice en el mismo sitio donde se anuncia el 100%',
  /NO se han\s+podido leer|no se han podido leer/i.test(v.data?.aviso||''), (v.data?.aviso||'').slice(0,60));

// ── 4. LA PRUEBA DE FUEGO: la contradicción aparece sin que nadie pregunte ──
const cruce=await s.call('obtener_anotaciones',{agrupar_por:'afirmaciones'});
const filas=cruce.data?.filas||[];
const junio=filas.find(f=>/30 de junio de 2024/.test(f.afirmacion||''));
const septiembre=filas.find(f=>/15 de septiembre de 2024/.test(f.afirmacion||''));
check('la vista cruzada trae las dos fechas de entrega contradictorias',
  Boolean(junio)&&Boolean(septiembre), filas.map(f=>f.afirmacion).join(' | ').slice(0,110));
check('y cada una dice de qué documento sale (se puede citar)',
  /contrato/.test(junio?.documento||'') && /acta/.test(septiembre?.documento||''),
  `${junio?.documento} vs ${septiembre?.documento}`);
check('la síntesis declara cobertura del 100%', cruce.data?.cobertura==='100%' && cruce.data?.barrido_completo===true,
  `${cruce.data?.cobertura}`);
const FILAS_ANTES=filas.length;
check('y sigue avisando de la zona ciega del escaneado', /zona ciega/.test(cruce.data?.aviso||''));

// ── 5. Aislamiento: el otro cliente no entra ──
check('ninguna ficha trae material del otro expediente', !cruce.raw.includes('SECRETO-RUIZ'));
const lista=await s.call('obtener_anotaciones',{limite:200});
check('tampoco al listar las fichas', !lista.raw.includes('SECRETO-RUIZ'));

// ── 6. Se reanuda tras cerrar el servidor ──
s.proc.kill(); await espera(600);
s=servidor();
await s.rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'t',version:'1'}});
await listo(s.call);
await s.call('establecer_expediente_activo',{expediente:'Vega - Compraventa nave'});
const tras=await s.call('siguiente_por_revisar');
check('el barrido sobrevive a cerrar Claude (estado en disco)', tras.data?.completado===true,
  `revisadas=${tras.data?.ventanas_revisadas}/${tras.data?.ventanas_totales}`);

// ── 7. Un documento que cambia vuelve a estar pendiente ──
fs.appendFileSync(path.join(CASO,'03 correo del arquitecto.txt'),
  ' ADDENDA POSTERIOR: la licencia se concedió con condiciones. '+relleno('Condiciones impuestas por el ayuntamiento.'));
await s.call('indexar_carpeta',{});
const tras2=await s.call('siguiente_por_revisar');
check('un documento modificado vuelve a estar pendiente de revisar',
  tras2.data?.completado===false && /correo del arquitecto/.test(tras2.data?.ruta_relativa||''),
  `${tras2.data?.ruta_relativa} — cobertura ${tras2.data?.cobertura}`);
check('y la síntesis avisa de que el barrido dejó de estar completo',
  /BARRIDO ESTÁ INCOMPLETO/.test((await s.call('obtener_anotaciones')).raw));
// Las fichas de los documentos INTACTOS no se tocan: solo se invalida lo que cambió en disco.
const cruce2=(await s.call('obtener_anotaciones',{agrupar_por:'afirmaciones'})).data?.filas||[];
check('pero conserva intactas las fichas de los documentos que no cambiaron',
  cruce2.length===FILAS_ANTES
  && cruce2.some(f=>/30 de junio de 2024/.test(f.afirmacion||''))
  && cruce2.some(f=>/15 de septiembre de 2024/.test(f.afirmacion||'')),
  `${cruce2.length} filas (antes ${FILAS_ANTES})`);

// ── 8. No se puede anotar una ventana de otro expediente ──
const ajeno=await s.call('anotar',{doc_id:'0000000000000000',desde_fragmento:0,resumen:'x'});
check('anotar rechaza un doc_id que no es de este expediente', ajeno.isError && /No hay ninguna ventana/.test(ajeno.raw));

s.proc.kill();
fs.rmSync(base,{recursive:true,force:true});
const fallos=results.filter(r=>!r).length;
console.log(`\n${results.length-fallos}/${results.length} comprobaciones OK`);
process.exit(fallos===0?0:1);
