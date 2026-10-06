// ESCENARIO: «¿qué ha cambiado?» SIN que el abogado lo pregunte (nota de mejora de Juan,
// 6-oct-2026). En la primera consulta sobre un expediente tras una pausa, la respuesta trae lo
// nuevo, lo modificado y lo retirado desde la consulta anterior, para que Claude se lo diga.
// Una vez por sesión de consulta; sin barrido de revisión; sin mezclar otros expedientes.
//
// (Arnés copiado de test-cambios-expediente.mjs.)
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

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-consulta-'));
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
    ROBIN_VENTANA_REVISION:'3',ROBIN_PAUSA_CONSULTA_MIN:'0.02',ROBIN_UPDATE_URL:'http://127.0.0.1:9/no',...extra};
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


const C='cambios_desde_tu_ultima_consulta';
let s=servidor();
await s.rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'t',version:'1'}});
await listo(s.call);

// ── 0. Primera vez en la vida: no hay con qué comparar, no dice nada ──
const a0=await s.call('establecer_expediente_activo',{expediente:'Vega - Compraventa nave'});
check('la primera consulta de la vida no avisa de nada', !a0.isError && !a0.data?.[C], Object.keys(a0.data||{}).join(','));
const a1=await s.call('buscar_documentos',{query:'plazo de entrega'});
check('ni las siguientes de la misma sesión', !a1.data?.[C]);

// ── 1. Pausa sin cambios: no molesta ──
await espera(1500);
const b0=await s.call('buscar_documentos',{query:'licencia'});
check('tras una pausa SIN cambios, no avisa', !b0.data?.[C]);

// ── 2. Entre una sesión y otra, el expediente se mueve ──
await espera(1500);
fs.writeFileSync(path.join(CASO,'08 informe de tasacion.txt'),
  'INFORME DE TASACION DE LA NAVE. '+relleno('Valoración por el método de comparación.'));
fs.appendFileSync(path.join(CASO,'03 correo del arquitecto.txt'),
  ' ADDENDA: la licencia se concedió con condiciones. '+relleno('Condiciones del ayuntamiento.'));
fs.rmSync(path.join(CASO,'05 acta de la junta.txt'));
fs.writeFileSync(path.join(OTRO,'02 recurso.txt'),'SECRETO-RUIZ recurso. '+relleno('Motivos del recurso.'));
await s.call('indexar_carpeta',{});
await listo(s.call);
await espera(1500);

const c0=await s.call('buscar_documentos',{query:'tasación de la nave'});
const k=c0.data?.[C];
const nom=(l)=>(l||[]).map(x=>x.ruta_relativa).join(' | ');
check('la primera consulta tras la pausa trae los cambios', Boolean(k), JSON.stringify(k?.recuento));
check('el documento NUEVO', (k?.nuevos||[]).some(x=>/tasacion/.test(x.ruta_relativa)), nom(k?.nuevos));
check('el MODIFICADO', (k?.modificados||[]).some(x=>/arquitecto/.test(x.ruta_relativa)), nom(k?.modificados));
check('el RETIRADO', (k?.retirados||[]).some(x=>/acta de la junta/.test(x.ruta_relativa)), nom(k?.retirados));
check('no da por cambiado lo que no cambió',
  !nom(k?.nuevos).includes('contrato') && !nom(k?.modificados).includes('contrato'));
check('no mezcla el expediente de otro cliente', !c0.raw.includes('SECRETO-RUIZ') && !/recurso\.txt/.test(JSON.stringify(k||{})));
check('le dice a Claude que se lo cuente al abogado antes de contestar', /ANTES de contestar/.test(k?.aviso_al_abogado||''));
check('y la respuesta de la herramienta sigue entera', Array.isArray(c0.data?.resultados||c0.data?.hits||c0.data?.fragmentos) || Object.keys(c0.data||{}).length>2, Object.keys(c0.data||{}).join(','));

// ── 3. Una sola vez por sesión ──
const c1=await s.call('obtener_documento',{ruta_relativa:'Expedientes/Vega - Compraventa nave/01 contrato de compraventa.txt'});
check('la segunda consulta de la misma sesión ya no lo repite', !c1.data?.[C]);

// ── 4. Sobrevive a reiniciar el servidor (cerrar Claude y abrirlo) ──
await terminar(s.proc);
fs.writeFileSync(path.join(CASO,'09 nota simple.txt'),'NOTA SIMPLE DEL REGISTRO. '+relleno('Titularidad y cargas de la finca.'));
s=servidor();
await s.rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'t',version:'1'}});
await listo(s.call);
const d0=await s.call('buscar_documentos',{expediente:'Vega - Compraventa nave',query:'cargas'});
check('tras reiniciar, la primera consulta trae lo llegado mientras tanto',
  (d0.data?.[C]?.nuevos||[]).some(x=>/nota simple/.test(x.ruta_relativa)) && !(d0.data?.[C]?.nuevos||[]).some(x=>/tasacion/.test(x.ruta_relativa)),
  nom(d0.data?.[C]?.nuevos));

// ── 5. Otro expediente lleva su propia cuenta ──
const e0=await s.call('buscar_documentos',{expediente:'Ruiz - Laboral',query:'recurso'});
check('el primer contacto con otro expediente no hereda nada', !e0.data?.[C] && !e0.raw.includes('tasacion'));

// ── 6. La foto vive en el directorio de datos, no en la carpeta del cliente ──
check('la foto se guarda fuera del expediente', fs.existsSync(path.join(base,'datos','consultas.json'))
  && !fs.readdirSync(CASO).some(f=>/consultas/.test(f)));

await terminar(s.proc);
borrar(base);
const fallos=results.filter(r=>!r).length;
console.log(`\n${results.length-fallos}/${results.length} comprobaciones OK`);
process.exit(fallos===0?0:1);
