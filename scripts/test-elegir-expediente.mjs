// Elegir el expediente con la ventana de carpetas y trabajar con VARIOS a la vez (propuesta de
// Juan, 1-oct-2026). Contra el servidor MCP real por stdio; la ventana se simula con
// ROBIN_DIALOGO_SIMULADO=@fichero (cada apertura lee lo que «elige» el abogado).
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const terminar=(p)=>p.exitCode!==null||p.signalCode!==null?Promise.resolve():new Promise(r=>{p.once('exit',r);p.kill();
  setTimeout(()=>{try{p.kill('SIGKILL');}catch{}},15000).unref();});
const borrar=(d)=>fs.rmSync(d,{recursive:true,force:true,maxRetries:10,retryDelay:300});
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-elegir-'));
const MADRE=path.join(base,'Expedientes');
const FUERA=path.join(base,'Otra carpeta');
const CASOS={
  'Pérez - Divorcio':{secreto:'SECRETO-PEREZ-8891',texto:'Demanda de divorcio, guarda y custodia y pensión de alimentos.'},
  'Pérez - Herencia':{secreto:'SECRETO-HERENCIA-5512',texto:'Aceptación de herencia, legítima y colación de donaciones.'},
  'Gómez - Despido':{secreto:'SECRETO-GOMEZ-2035',texto:'Despido improcedente, indemnización y salarios de tramitación.'},
};
for(const [caso,d] of Object.entries(CASOS)){
  fs.mkdirSync(path.join(MADRE,caso,'prueba'),{recursive:true});
  fs.writeFileSync(path.join(MADRE,caso,'escrito.txt'),`${d.texto} ${d.secreto}.`);
  fs.writeFileSync(path.join(MADRE,caso,'prueba','anexo.txt'),`Anexo probatorio del asunto. ${d.secreto}.`);
}
fs.mkdirSync(path.join(MADRE,'Caso vacío'),{recursive:true});
// Un fichero suelto en la madre la convierte en «expediente» por sí misma: es el caso en que
// fijarla por nombre juntaría a todos los clientes, y tiene que pedir confirmación.
fs.writeFileSync(path.join(MADRE,'suelto.txt'),'Nota suelta del despacho. SECRETO-SUELTO-0001.');
fs.mkdirSync(FUERA,{recursive:true});
fs.writeFileSync(path.join(FUERA,'nota.txt'),'Fuera de lo vigilado.');

const SIM=path.join(base,'dialogo.json');
const elige=(x)=>fs.writeFileSync(SIM,JSON.stringify(x));

const env={...process.env,ROBIN_TOKEN:'t',ROBIN_FOLDERS:MADRE,
  ROBIN_DATA_DIR:path.join(base,'datos'),ROBIN_VENTANA_VARIOS_EXPEDIENTES_MIN:'0',ROBIN_OCR:'false',ROBIN_LOG_LEVEL:'error',
  ROBIN_UPDATE_URL:'http://127.0.0.1:9/no',
  ROBIN_DIALOGO_SIMULADO:`@${SIM}`,ROBIN_ESPERA_DIALOGO_MS:'1500'};

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
const servido=(r)=>JSON.stringify(r.data?.fragmentos ?? r.data?.documentos ?? r.data ?? '');
const E=(caso)=>`Expedientes/${caso}`;

async function main(){
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'t',version:'1'}});
  c.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  let est;
  for(let i=0;i<120;i++){est=(await call('estado_servidor')).data;
    if(est.estado==='activo'&&est.documentos_indexados>=7)break; await new Promise(r=>setTimeout(r,1500));}
  check('índice listo',est.documentos_indexados===7,`documentos=${est.documentos_indexados}`);

  const lista=(await rpc('tools/list',{})).result.tools.map(t=>t.name);
  check('elegir_expediente se publica',lista.includes('elegir_expediente'));

  // --- 1. La ventana: elegir la carpeta de un caso ---
  elige({rutas:[path.join(MADRE,'Pérez - Divorcio')]});
  let r=await call('elegir_expediente');
  check('elegir la carpeta de un caso la fija como expediente activo',
    !r.isError && r.data.expediente_activo===E('Pérez - Divorcio') && r.data.documentos_indexados===2, r.raw.slice(0,200));
  check('la respuesta pide pasar el expediente en cada llamada (conversaciones paralelas)',
    Boolean(r.data.aviso_conversaciones) && r.data.pasa_en_cada_llamada?.expediente===E('Pérez - Divorcio'));
  const b=await call('buscar_documentos',{query:'guarda y custodia',n_resultados:20});
  check('después, la búsqueda queda en ese caso',
    servido(b).includes('SECRETO-PEREZ-8891') && !servido(b).includes('SECRETO-HERENCIA-5512') && !servido(b).includes('SECRETO-GOMEZ-2035'));

  // --- 2. Una subcarpeta del caso fija el caso entero ---
  elige({rutas:[path.join(MADRE,'Gómez - Despido','prueba')]});
  r=await call('elegir_expediente');
  check('una subcarpeta del caso fija el caso entero y lo dice',
    !r.isError && r.data.expediente_activo===E('Gómez - Despido') && /subcarpeta/.test(r.data.nota_subcarpeta||''), r.raw.slice(0,200));

  // --- 3. Rechazos: la carpeta madre, algo de fuera, una carpeta sin indexar ---
  const antes=(await call('estado_servidor')).data.expediente_activo;
  elige({rutas:[MADRE]});
  r=await call('elegir_expediente');
  check('la carpeta de arriba NO se fija: se pregunta si son piezas de un asunto o clientes distintos',
    r.isError && r.data.rechazados?.[0]?.necesita_confirmacion===true && r.data.rechazados[0].contiene.length===4
    && (await call('estado_servidor')).data.expediente_activo===antes, r.raw.slice(0,200));
  elige({rutas:[FUERA]});
  r=await call('elegir_expediente');
  check('una carpeta que RobinSearch no vigila se rechaza',r.isError && /no vigila|No está dentro/.test(r.raw));
  check('…y no se filtra su ruta completa (solo el nombre)',!r.raw.includes(base));
  elige({rutas:[path.join(MADRE,'Caso vacío')]});
  r=await call('elegir_expediente');
  check('una carpeta sin documentos indexados se rechaza',r.isError && /indexad/.test(r.raw));
  check('los rechazos traen la lista de expedientes para elegir por número',
    Array.isArray(r.data.expedientes_disponibles) && r.data.expedientes_disponibles.length===4
    && !r.data.expedientes_disponibles.some(e=>e.expediente.includes('Caso vacío')));

  // --- 4. Cerrar la ventana / no poder abrirla ---
  elige({cancelar:true});
  r=await call('elegir_expediente');
  check('cerrar la ventana no cambia nada y ofrece la lista',!r.isError && r.data.cancelado===true && r.data.expedientes_disponibles.length===4);
  elige({error:'sin pantalla'});
  r=await call('elegir_expediente');
  check('si la ventana no se abre, error explícito con la lista',r.isError && r.data.expedientes_disponibles.length===4);

  // --- 5. El abogado tarda más de lo que Claude espera ---
  elige({rutas:[path.join(MADRE,'Pérez - Herencia')],tarda_ms:2500});
  r=await call('elegir_expediente');
  check('si tarda, contesta «pendiente» sin fijar nada',!r.isError && r.data.pendiente===true);
  elige({rutas:[path.join(MADRE,'Gómez - Despido')]}); // si abriese OTRA ventana, elegiría esto
  r=await call('elegir_expediente');
  check('la siguiente llamada recoge la MISMA elección (no abre otra ventana)… sin fijarla: pide confirmar',
    !r.isError && r.data.pendiente_de_confirmar===true && JSON.stringify(r.data.carpetas_elegidas).includes('Pérez - Herencia') && !JSON.stringify(r.data).includes('Gómez'), r.raw.slice(0,200));
  const cod=r.data.confirmar;
  let cf=await call('elegir_expediente',{confirmar:'000000000000'});
  check('un código de confirmación que no es el dado no fija nada',cf.isError && cf.data.motivo==='confirmacion_no_valida');
  cf=await call('elegir_expediente',{confirmar:cod});
  check('confirmar con el código fija EXACTAMENTE lo elegido',!cf.isError && cf.data.expediente_activo===E('Pérez - Herencia'), cf.raw.slice(0,600).replace(/\n/g," "));
  cf=await call('elegir_expediente',{confirmar:cod});
  check('el código sirve una sola vez',cf.isError && cf.data.motivo==='confirmacion_no_valida');
  // Confirmar SUMANDO a la selección de esta conversación (revisión de Codex, 25-nov).
  elige({rutas:[path.join(MADRE,'Pérez - Divorcio')],tarda_ms:2500});
  r=await call('elegir_expediente',{anadir:true,seleccion_actual:E('Pérez - Herencia')});
  elige({rutas:[path.join(MADRE,'Gómez - Despido')]});
  r=await call('elegir_expediente',{anadir:true,seleccion_actual:E('Pérez - Herencia')});
  cf=await call('elegir_expediente',{confirmar:r.data?.confirmar,anadir:true,seleccion_actual:E('Pérez - Herencia')});
  check('confirmar con "anadir" SUMA lo elegido a la selección',
    !cf.isError && JSON.stringify([...(cf.data.expediente_activo||[])].sort())===JSON.stringify([E("Pérez - Divorcio"),E("Pérez - Herencia")]), cf.raw.slice(0,600).replace(/\n/g," "));

  // Dos elecciones pendientes a la vez: el código de una no invalida el de la otra (Codex, 6.ª ronda).
  elige({rutas:[path.join(MADRE,'Pérez - Herencia')],tarda_ms:2500});
  await call('elegir_expediente');
  elige({rutas:[path.join(MADRE,'Gómez - Despido')]});
  const p1=await call('elegir_expediente');
  elige({rutas:[path.join(MADRE,'Pérez - Divorcio')],tarda_ms:2500});
  await call('elegir_expediente');
  elige({rutas:[path.join(MADRE,'Gómez - Despido')]});
  const p2=await call('elegir_expediente');
  cf=await call('elegir_expediente',{confirmar:p1.data?.confirmar});
  check('con dos elecciones pendientes, la primera sigue confirmándose con su código',
    p1.data?.confirmar && p2.data?.confirmar && p1.data.confirmar!==p2.data.confirmar && !cf.isError && cf.data.expediente_activo===E('Pérez - Herencia'), cf.raw.slice(0,200));

  // --- 6. Varias carpetas separadas en el mismo trabajo ---
  elige({rutas:[path.join(MADRE,'Pérez - Divorcio'),path.join(MADRE,'Pérez - Herencia')]});
  r=await call('elegir_expediente',{varias:true});
  const dos=[E('Pérez - Divorcio'),E('Pérez - Herencia')];
  check('elegir varias carpetas en la ventana fija las dos',
    !r.isError && JSON.stringify(r.data.expediente_activo)===JSON.stringify(dos) && r.data.documentos_indexados===4, r.raw.slice(0,300));
  const bv=await call('buscar_documentos',{query:'SECRETO',n_resultados:20});
  check('la búsqueda cubre las dos… y no la tercera',
    servido(bv).includes('SECRETO-PEREZ-8891') && servido(bv).includes('SECRETO-HERENCIA-5512') && !servido(bv).includes('SECRETO-GOMEZ-2035'));
  const bs=await call('buscar_documentos',{query:'anexo probatorio',subcarpeta:'prueba',n_resultados:20});
  check('«subcarpeta» se aplica dentro de cada una',
    bs.data.fragmentos.length===2 && bs.data.fragmentos.every(f=>/\/prueba\//.test(f.ruta_relativa)), JSON.stringify(bs.data.fragmentos?.map(f=>f.ruta_relativa)));
  const lv=await call('listar_documentos_indexados');
  check('listar devuelve los documentos de las dos',lv.data.total===4 && !servido(lv).includes('Gómez'));

  // Inventario de Gómez para intentar leerlo por id estando en las dos de Pérez.
  const g=await call('listar_documentos_indexados',{expediente:'Gómez - Despido'});
  let fugas=0;
  for(const d of g.data.documentos){
    const od=await call('obtener_documento',{doc_id:d.doc_id});
    if(od.raw.includes('SECRETO-GOMEZ-2035')) fugas++;
    const ix=await call('indice_documento',{doc_id:d.doc_id});
    if(ix.raw.includes('SECRETO-GOMEZ-2035')) fugas++;
  }
  check('con varias, un documento de un tercer caso sigue fuera de alcance',fugas===0,`fugas=${fugas}`);

  const an=await call('anotar',{doc_id:'x',hechos:[]});
  check('anotar con varias exige decir en cuál',an.isError && an.data.motivo==='varios_expedientes');
  const sp=await call('siguiente_por_revisar');
  check('el barrido con varias exige decir en cuál',sp.isError && sp.data.motivo==='varios_expedientes');
  const sp1=await call('siguiente_por_revisar',{expediente:'Pérez - Herencia'});
  check('…y funciona al indicarlo',!sp1.isError, sp1.raw.slice(0,160));

  // --- 7. Por nombre: lista, añadir, carpeta madre con confirmación ---
  r=await call('establecer_expediente_activo',{expediente:['perez-divorcio','Gómez - Despido']});
  check('establecer_expediente_activo admite una lista (nombres tolerantes)',
    !r.isError && Array.isArray(r.data.expediente_activo) && r.data.expediente_activo.length===2);
  r=await call('establecer_expediente_activo',{expediente:'Pérez - Herencia',anadir:true});
  check('"anadir" sin decir la selección de esta conversación no suma nada',r.isError && /seleccion_actual/.test(r.raw));
  r=await call('establecer_expediente_activo',{expediente:'Pérez - Herencia',anadir:true,seleccion_actual:['Gómez - Despido','perez-divorcio']});
  check('"anadir" con una selección que no es la activa no suma',r.isError);
  r=await call('establecer_expediente_activo',{expediente:'Pérez - Herencia',anadir:true,seleccion_actual:[E('Gómez - Despido'),E('Pérez - Divorcio')]});
  check('"anadir" con la selección de esta conversación suma sin quitar los anteriores',!r.isError && r.data.expediente_activo.length===3, r.raw.slice(0,200));
  r=await call('establecer_expediente_activo',{expediente:['Pérez - Divorcio','No existe']});
  check('si uno de la lista no existe, no se fija nada a medias',r.isError && (await call('estado_servidor')).data.expediente_activo.length===3);

  // --- 8. Lo de siempre sigue igual ---
  r=await call('establecer_expediente_activo',{expediente:'Gómez - Despido'});
  check('un solo expediente sigue devolviendo un texto, como antes',!r.isError && r.data.expediente_activo===E('Gómez - Despido'));
  const ex=await call('buscar_documentos',{query:'guarda y custodia',expediente:'Pérez - Divorcio',n_resultados:20});
  check('el parámetro explícito manda sobre el activo (lo que protege las conversaciones paralelas)',
    servido(ex).includes('SECRETO-PEREZ-8891') && !servido(ex).includes('SECRETO-GOMEZ-2035'));
  r=await call('establecer_expediente_activo',{limpiar:true});
  const sin=await call('buscar_documentos',{query:'x'});
  check('sin expediente sigue sin buscar en todos, y sugiere elegir_expediente',sin.isError && /elegir_expediente/.test(sin.raw));
}

main().catch(e=>{console.error(e);results.push(false);}).finally(async()=>{
  await terminar(c); borrar(base);
  const okN=results.filter(Boolean).length;
  console.log(`\n${okN}/${results.length} comprobaciones OK`);
  process.exit(okN===results.length?0:1);
});
