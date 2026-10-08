// ESCENARIO: «¿qué ha cambiado?» SIN que el abogado lo pregunte (nota de mejora de Juan,
// 6-oct-2026). La primera consulta que lo vea trae lo nuevo, lo modificado y lo retirado que aún
// no se le ha contado al abogado, para que Claude se lo diga. Nunca se repite lo contado y nunca
// se pierde nada, aunque el chat nuevo se abra a los diez minutos del anterior (pregunta de Juan,
// 8-oct-2026: escenarios (a)-(d) al final). Sin barrido de revisión; sin mezclar expedientes.
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

// ═══ LA PREGUNTA DE JUAN (8-oct-2026): «¿qué pasa si abro un chat nuevo a los diez minutos de
// otro? ¿No me cuenta los cambios?». Claude Desktop arranca UN proceso de RobinSearch al abrirse y
// lo comparte entre todos los chats; el protocolo no dice cuándo empieza uno (initialize llega
// una vez por proceso y tools/call solo trae nombre y argumentos). Para el servidor, «chat nuevo a
// los 10 minutos» y «el mismo chat 10 minutos después» son lo mismo. Aquí la pausa es la de
// verdad (30 min): todo lo que sigue ocurre DENTRO de una misma sesión de consulta.
const P='Vega - Compraventa nave';
const DATOS2=path.join(base,'datos-juan');
const servidor2=()=>servidor({ROBIN_DATA_DIR:DATOS2,ROBIN_PAUSA_CONSULTA_MIN:'30'});
s=servidor2();
await s.rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'t',version:'1'}});
await listo(s.call);
// Chat 1: primera vez en la vida con este directorio de datos (línea base, no dice nada).
await s.call('establecer_expediente_activo',{expediente:P});
await s.call('buscar_documentos',{query:'plazo de entrega'});

// (a) Chat nuevo «a los 10 minutos», sin cambios en la carpeta: no dice nada.
const ja=await s.call('buscar_documentos',{expediente:P,query:'licencia'});
check('(a) chat nuevo sin cambios en la carpeta: no avisa de nada', !ja.data?.[C]);

// (b) Entre el chat 1 y el chat 2 (menos de 30 min) entran y cambian documentos.
fs.writeFileSync(path.join(CASO,'10 requerimiento notarial.txt'),
  'REQUERIMIENTO NOTARIAL DE ENTREGA. '+relleno('El comprador requiere la entrega de la nave en plazo.'));
fs.appendFileSync(path.join(CASO,'08 informe de tasacion.txt'),
  ' REVISION: el valor se corrige a la baja. '+relleno('Ajuste por el estado de la cubierta.'));
fs.rmSync(path.join(CASO,'09 nota simple.txt'));
await s.call('indexar_carpeta',{}); await listo(s.call);
const jb=await s.call('buscar_documentos',{expediente:P,query:'requerimiento'});
const kb=jb.data?.[C];
check('(b) chat nuevo a los 10 min con documentos nuevos: SÍ los cuenta', (kb?.nuevos||[]).some(x=>/requerimiento/.test(x.ruta_relativa)), nom(kb?.nuevos));
check('(b) y el modificado', (kb?.modificados||[]).some(x=>/tasacion/.test(x.ruta_relativa)), nom(kb?.modificados));
check('(b) y el retirado', (kb?.retirados||[]).some(x=>/nota simple/.test(x.ruta_relativa)), nom(kb?.retirados));
check('(b) no cuenta lo que no ha cambiado', !nom(kb?.modificados).includes('contrato') && !nom(kb?.nuevos).includes('contrato'));
const jb2=await s.call('obtener_documento',{ruta_relativa:'Expedientes/'+P+'/01 contrato de compraventa.txt'});
check('(b) lo contado no se repite en la siguiente llamada', !jb2.data?.[C]);

// (c) Durante el chat llega otro documento (un correo guardado, un escrito del contrario).
fs.writeFileSync(path.join(CASO,'11 contestacion del vendedor.txt'),
  'CONTESTACION DEL VENDEDOR AL REQUERIMIENTO. '+relleno('El vendedor alega fuerza mayor en la entrega.'));
await s.call('indexar_carpeta',{}); await listo(s.call);
const jc=await s.call('buscar_documentos',{expediente:P,query:'fuerza mayor'});
const kc=jc.data?.[C];
check('(c) lo que llega DURANTE el chat se cuenta en la siguiente consulta, una vez', (kc?.nuevos||[]).some(x=>/contestacion/.test(x.ruta_relativa)) && !(kc?.nuevos||[]).some(x=>/requerimiento/.test(x.ruta_relativa)), nom(kc?.nuevos));
check('(c) y se presenta como llegado mientras trabaja, no como «desde tu última consulta»', kc?.momento==='durante_la_sesion' && /mientras/i.test(kc?.aviso_al_abogado||''), kc?.momento);
// El abogado sigue retocando ese mismo documento: no se le repite en cada llamada.
fs.appendFileSync(path.join(CASO,'11 contestacion del vendedor.txt'),' Otrosí: se aporta certificado. '+relleno('Anexo.'));
await s.call('indexar_carpeta',{}); await listo(s.call);
const jc2=await s.call('buscar_documentos',{expediente:P,query:'certificado'});
check('(c) retocar un documento ya contado en esta sesión no se repite en cada llamada', !jc2.data?.[C], JSON.stringify(jc2.data?.[C]?.recuento||null));
// Pero otro documento distinto que cambia sí se cuenta.
fs.appendFileSync(path.join(CASO,'01 contrato de compraventa.txt'),' ADENDA: nueva fecha de entrega. '+relleno('Pacto de las partes.'));
await s.call('indexar_carpeta',{}); await listo(s.call);
const jc3=await s.call('buscar_documentos',{expediente:P,query:'adenda'});
check('(c) otro documento modificado durante la sesión sí se cuenta', (jc3.data?.[C]?.modificados||[]).some(x=>/contrato/.test(x.ruta_relativa)), nom(jc3.data?.[C]?.modificados));

// (d) Reinicio de Claude Desktop: lo contado no se repite; lo aplazado y lo nuevo, sí.
await terminar(s.proc);
s=servidor2();
await s.rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'t',version:'1'}});
await listo(s.call);
const jd=await s.call('buscar_documentos',{expediente:P,query:'entrega'});
const kd=jd.data?.[C];
check('(d) tras reiniciar: el documento retocado después de contarlo sale como modificado (nada se pierde)', (kd?.modificados||[]).some(x=>/contestacion/.test(x.ruta_relativa)), nom(kd?.modificados));
check('(d) y no repite nada de lo ya contado', !nom(kd?.nuevos).match(/requerimiento|contestacion/) && !nom(kd?.modificados).match(/tasacion|contrato/) && !nom(kd?.retirados).includes('nota simple'), JSON.stringify(kd?.recuento||null));
check('(d) al empezar sesión dice «desde tu última consulta»', kd?.momento==='inicio_de_sesion' && /última consulta/.test(kd?.aviso_al_abogado||''), kd?.momento);
const jd2=await s.call('buscar_documentos',{expediente:P,query:'entrega'});
check('(d) y una vez contado, calla', !jd2.data?.[C]);
await terminar(s.proc);
s=servidor2();
await s.rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'t',version:'1'}});
await listo(s.call);
const jd3=await s.call('buscar_documentos',{expediente:P,query:'entrega'});
check('(d) otro reinicio sin cambios: nada que contar', !jd3.data?.[C], JSON.stringify(jd3.data?.[C]?.recuento||null));
await terminar(s.proc);

// Un documento que falta en el índice pero sigue en el disco (se está reindexando, Word lo guarda
// en dos pasos) NO se da por retirado; si de verdad ya no está, sí. Y una foto de la 1.11.x (sin
// ruta absoluta) sigue funcionando como antes.
process.env.ROBIN_DATA_DIR=path.join(base,'datos-unidad'); process.env.ROBIN_FOLDERS=MADRE;
const { comparar } = await import(new URL('../server/consultas.js', import.meta.url).href);
const vivo=path.join(CASO,'01 contrato de compraventa.txt');
const foto={ d1:{r:'x/vivo.txt',a:vivo,s:1,m:1}, d2:{r:'x/borrado.txt',a:path.join(CASO,'no-existe.txt'),s:1,m:1}, d3:{r:'x/antiguo.txt',s:1,m:1} };
const u=comparar(foto,[]);
const ret=u.retirados.map(x=>x.ruta_relativa).join(',');
check('reindexándose (sigue en el disco): no se da por retirado', !ret.includes('vivo'), ret);
check('borrado de verdad: retirado', ret.includes('borrado'), ret);
check('foto antigua sin ruta absoluta: retirado como en la 1.11', ret.includes('antiguo'), ret);
borrar(base);
const fallos=results.filter(r=>!r).length;
console.log(`\n${results.length-fallos}/${results.length} comprobaciones OK`);
process.exit(fallos===0?0:1);
