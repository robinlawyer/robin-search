// ESCENARIO: data room VIVO (P6, 1-oct-2026). Tras un barrido completo llegan documentos nuevos,
// se sustituye uno y se retira otro: cambios_expediente tiene que decir exactamente cuáles, y
// siguiente_por_revisar servir solo lo nuevo y lo cambiado.
//
// (Arnés copiado de test-barrido.mjs.) ESCENARIO original: due diligence sobre un expediente que NO cabe en el contexto del modelo.
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

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-delta-'));
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
  const c=spawn(process.execPath,[path.join(REPO,'server/index.js')],{env,stdio:['pipe','pipe','pipe']});
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
await listo(s.call);
await s.call('establecer_expediente_activo',{expediente:'Vega - Compraventa nave'});

// ── 0. Sin barrido: todo es nuevo y lo dice ──
const d0=await s.call('cambios_expediente');
check('sin barrido, el delta lo dice y da todo por nuevo',
  d0.data && d0.data.recuento.nuevos>=3 && /aún no tiene barrido/.test(d0.data.siguiente_paso||''),
  JSON.stringify(d0.data?.recuento));

// ── 1. Barrido completo ──
let v=await s.call('siguiente_por_revisar'); let vueltas=0;
while(v.data && !v.data.completado && v.data.doc_id && vueltas<200){vueltas++;
  await s.call('anotar',{doc_id:v.data.doc_id,desde_fragmento:v.data.desde_fragmento,resumen:'ok'});
  v=await s.call('siguiente_por_revisar');}
check('el barrido inicial termina', v.data?.completado===true, `${vueltas} vueltas`);
const d1=await s.call('cambios_expediente');
check('recién terminado, no hay cambios (salvo la zona ciega ya conocida)',
  d1.data && d1.data.recuento.nuevos===0 && d1.data.recuento.modificados===0 && d1.data.recuento.retirados===0
  && Boolean(d1.data.ultima_revision_completa), JSON.stringify(d1.data?.recuento));

// ── 2. El data room se mueve ──
await espera(1100); // los sellos de tiempo tienen que ser posteriores al barrido
fs.writeFileSync(path.join(CASO,'08 informe de tasacion.txt'),
  'INFORME DE TASACION DE LA NAVE. '+relleno('Valoración por el método de comparación.'));
fs.appendFileSync(path.join(CASO,'03 correo del arquitecto.txt'),
  ' ADDENDA: la licencia se concedió con condiciones. '+relleno('Condiciones del ayuntamiento.'));
fs.rmSync(path.join(CASO,'05 acta de la junta.txt'));
fs.writeFileSync(path.join(OTRO,'02 recurso.txt'),'SECRETO-RUIZ recurso. '+relleno('Motivos del recurso.'));
await s.call('indexar_carpeta',{});
await listo(s.call);

const d2=await s.call('cambios_expediente');
const nom=(l)=>(l||[]).map(x=>x.ruta_relativa).join(' | ');
check('ve el documento NUEVO', (d2.data?.nuevos||[]).some(x=>/tasacion/.test(x.ruta_relativa)), nom(d2.data?.nuevos));
check('ve el documento MODIFICADO, con la fecha de su revisión anterior',
  (d2.data?.modificados||[]).some(x=>/arquitecto/.test(x.ruta_relativa) && x.revisado_en), nom(d2.data?.modificados));
check('ve el documento RETIRADO que ya estaba revisado',
  (d2.data?.retirados||[]).some(x=>/acta de la junta/.test(x.ruta_relativa)), nom(d2.data?.retirados));
check('no da por cambiado lo que no cambió',
  !(d2.data?.modificados||[]).some(x=>/contrato/.test(x.ruta_relativa)) && !(d2.data?.nuevos||[]).some(x=>/contrato/.test(x.ruta_relativa)));
check('y no mezcla el expediente de otro cliente', !d2.raw.includes('SECRETO-RUIZ') && !/recurso\.txt/.test(d2.raw));
check('el siguiente paso manda a revisar solo el delta', /siguiente_por_revisar/.test(d2.data?.siguiente_paso||''));

// ── 3. El barrido sirve SOLO el delta ──
const servidas=[]; v=await s.call('siguiente_por_revisar'); vueltas=0;
while(v.data && !v.data.completado && v.data.doc_id && vueltas<200){vueltas++; servidas.push(v.data.ruta_relativa);
  await s.call('anotar',{doc_id:v.data.doc_id,desde_fragmento:v.data.desde_fragmento,resumen:'delta'});
  v=await s.call('siguiente_por_revisar');}
check('el barrido solo sirve lo nuevo y lo cambiado',
  servidas.length>0 && servidas.every(r=>/tasacion|arquitecto/.test(r)), [...new Set(servidas)].join(' | '));
const d3=await s.call('cambios_expediente');
check('al terminar el delta, el expediente vuelve a estar al día',
  d3.data?.recuento.nuevos===0 && d3.data?.recuento.modificados===0 && d3.data?.recuento.a_medias===0,
  JSON.stringify(d3.data?.recuento));

// ── 4. Con "desde" ──
const d4=await s.call('cambios_expediente',{desde:'2000-01-01'});
check('con desde, la referencia es esa fecha', d4.data?.referencia==='2000-01-01');
const d5=await s.call('cambios_expediente',{desde:'no-es-fecha'});
check('una fecha no válida se rechaza', d5.isError && /no es una fecha/.test(d5.raw));

await terminar(s.proc);
borrar(base);
const fallos=results.filter(r=>!r).length;
console.log(`\n${results.length-fallos}/${results.length} comprobaciones OK`);
process.exit(fallos===0?0:1);
