// Ficha de estado por asunto (director de asunto, despacho agéntico fase 1; documento de Juan del
// 12-oct-2026). Contra el servidor MCP real por stdio: un asunto reúne varias carpetas, solo uno
// activo, la fase solo cambia con la decisión del abogado, las decisiones no se pueden reescribir
// y al volver se cuenta lo que ha cambiado desde la última sesión.
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const terminar=(p)=>p.exitCode!==null||p.signalCode!==null?Promise.resolve():new Promise(r=>{p.once('exit',r);p.kill();
  setTimeout(()=>{try{p.kill('SIGKILL');}catch{}},15000).unref();});
const borrar=(d)=>fs.rmSync(d,{recursive:true,force:true,maxRetries:10,retryDelay:300});
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-asuntos-'));
const MADRE=path.join(base,'Expedientes');
const CASOS={
  'Ruiz - Cliente':{secreto:'SECRETO-RUIZ-CLIENTE-1001',texto:'Contrato de obra de la nave y requerimiento previo.'},
  'Ruiz - Procedimiento':{secreto:'SECRETO-RUIZ-PROC-2002',texto:'Demanda de resolución del contrato de obra y daños.'},
  'Otro - Cliente':{secreto:'SECRETO-OTRO-3003',texto:'Despido disciplinario y conciliación.'},
};
for(const [caso,d] of Object.entries(CASOS)){
  fs.mkdirSync(path.join(MADRE,caso,'docs'),{recursive:true});
  fs.writeFileSync(path.join(MADRE,caso,'escrito.txt'),`${d.texto} ${d.secreto}.`);
  fs.writeFileSync(path.join(MADRE,caso,'docs','anexo.txt'),`Anexo del asunto. ${d.secreto}.`);
}
const DATOS=path.join(base,'datos');
// Una sola conversación que cambia de asunto: sin la ventana de la 1.12.6 (test-incidencias-27oct la prueba aparte).
const env={...process.env,ROBIN_TOKEN:'t',ROBIN_FOLDERS:MADRE,ROBIN_DATA_DIR:DATOS,ROBIN_VENTANA_VARIOS_EXPEDIENTES_MIN:'0',ROBIN_OCR:'false',
  ROBIN_LOG_LEVEL:'error',ROBIN_UPDATE_URL:'http://127.0.0.1:9/no'};

function arrancar(){
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
  return {c,rpc,call};
}
async function listo(s,n){
  await s.rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'t',version:'1'}});
  s.c.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  let est;
  for(let i=0;i<120;i++){est=(await s.call('estado_servidor')).data;
    if(est.estado==='activo'&&est.documentos_indexados>=n)break; await new Promise(r=>setTimeout(r,1500));}
  return est;
}
const F=(x)=>`Expedientes/${x}`;
const dormir=(ms)=>new Promise(r=>setTimeout(r,ms));

async function main(){
  let s=arrancar();
  let est=await listo(s,6);
  check('índice listo',est.documentos_indexados===6,`documentos=${est.documentos_indexados}`);
  const tools=(await s.rpc('tools/list',{})).result.tools.map(t=>t.name);
  check('ficha_asunto se publica',tools.includes('ficha_asunto'));

  let r=await s.call('ficha_asunto',{accion:'listar'});
  check('sin asuntos, la lista sale vacía y sin activo',!r.isError&&r.data.asuntos.length===0&&r.data.activo===null);

  r=await s.call('ficha_asunto',{accion:'crear',nombre:'Ruiz — obra de la nave',carpetas_expediente:['Ruiz - Cliente','Inexistente']});
  check('una carpeta que no existe impide crear el asunto (no se crea a medias)',r.isError&&/Inexistente/.test(r.raw));
  r=await s.call('ficha_asunto',{accion:'listar'});
  check('y no queda nada creado',r.data.asuntos.length===0);

  r=await s.call('ficha_asunto',{accion:'crear',nombre:'Ruiz — obra de la nave',carpetas_expediente:['Ruiz - Cliente','Ruiz - Procedimiento'],orden:'civil'});
  const id=r.data.asunto?.asunto_id;
  check('crear: un asunto con DOS carpetas independientes',!r.isError&&r.data.asunto.carpetas_expediente.length===2,JSON.stringify(r.data.asunto?.carpetas_expediente));
  check('nace en fase 1 (Expediente) con su puerta',r.data.asunto.fase_director.numero===1&&/objetivo/i.test(r.data.asunto.puerta_pendiente));
  check('y queda activo con esas dos carpetas como selección',r.data.asunto.activo===true&&Array.isArray(r.data.seleccion?.expediente_activo)&&r.data.seleccion.expediente_activo.length===2);
  check('la apertura queda como primera decisión',r.data.asunto.decisiones.length===1&&r.data.asunto.decisiones[0].fase===0);
  check('trae el siguiente paso del director',/objetivo/i.test(r.data.siguiente_paso||''));

  // Búsqueda: cubre las dos carpetas del asunto y nunca la del otro cliente.
  const b=await s.call('buscar_documentos',{query:'contrato de obra y anexo del asunto',n_resultados:10});
  const txt=JSON.stringify(b.data);
  check('la búsqueda responde',!b.isError,b.raw.slice(0,120));
  check('buscar cubre las dos carpetas del asunto',txt.includes('SECRETO-RUIZ-CLIENTE-1001')&&txt.includes('SECRETO-RUIZ-PROC-2002'));
  check('y nunca la del otro cliente',!txt.includes('SECRETO-OTRO-3003'));

  // La fase no se toca con actualizar.
  r=await s.call('ficha_asunto',{accion:'actualizar',fase_director:3});
  check('actualizar no cambia la fase',r.isError&&/resolver_puerta/.test(r.raw));
  r=await s.call('ficha_asunto',{accion:'actualizar',objetivo_cliente:'Resolver el contrato y cobrar los daños',posicion:'demandante',
    hito_procesal:{descripcion:'Todavía no hay procedimiento',fecha:null}});
  check('actualizar guarda objetivo, posición e hito',!r.isError&&r.data.asunto.posicion==='demandante'&&r.data.asunto.objetivo_cliente.startsWith('Resolver'));
  r=await s.call('ficha_asunto',{accion:'actualizar',posicion:'cualquiera'});
  check('una posición fuera de la lista se rechaza',r.isError);

  // Plazos: sin cálculo no son firmes.
  r=await s.call('ficha_asunto',{accion:'actualizar',plazos:[{fecha:'2026-11-03',tipo:'contestación',herramienta:'calculo_plazos'},{fecha:'2026-12-01',tipo:'prescripción'}]});
  const pl=r.data.asunto?.plazos||[];
  check('un plazo calculado es firme y el que no, no',pl[0]?.firme===true&&pl[1]?.firme===false&&/no firme/i.test(pl[1]?.aviso||''));

  // Resolver la puerta exige la decisión del abogado.
  r=await s.call('ficha_asunto',{accion:'resolver_puerta',fase_siguiente:2});
  check('resolver una puerta sin decisión se rechaza',r.isError&&/decision/i.test(r.raw));
  r=await s.call('ficha_asunto',{accion:'resolver_puerta',fase_siguiente:2,decision:'1. Sí, son esos los datos',prompts_abogado:1,correccion:false});
  check('con la decisión pasa a la fase 2 y queda registrada',!r.isError&&r.data.asunto.fase_director.numero===2&&r.data.decision_registrada.decision==='1. Sí, son esos los datos');
  check('y guarda la medida de prompts del abogado',r.data.decision_registrada.prompts_abogado===1&&r.data.asunto.metricas.prompts_abogado===1);
  check('la decisión anota de qué fase y puerta venía',r.data.decision_registrada.fase===1&&/objetivo/i.test(r.data.decision_registrada.puerta));

  // Escritos: validar exige decisión.
  r=await s.call('ficha_asunto',{accion:'actualizar',escritos:[{titulo:'Demanda de resolución',estado:'validado'}]});
  check('un escrito no pasa a validado sin la decisión del abogado',r.isError&&/decisi/i.test(r.raw));
  r=await s.call('ficha_asunto',{accion:'actualizar',escritos:[{titulo:'Demanda de resolución',estado:'borrador',ruta:'escritos/demanda-v1.docx'}]});
  check('como borrador, sí',!r.isError&&r.data.asunto.escritos[0].estado==='borrador');
  r=await s.call('ficha_asunto',{accion:'actualizar',escritos:[{titulo:'Demanda de resolución',estado:'validado',version:2}],decision:'Validado, adelante'});
  check('con decisión pasa a validado y se registra',!r.isError&&r.data.asunto.escritos[0].estado==='validado'&&r.data.asunto.decisiones.at(-1).decision==='Validado, adelante');
  check('y conserva la ruta del borrador',r.data.asunto.escritos[0].ruta==='escritos/demanda-v1.docx');

  // anotar_decision no cambia la fase.
  const antes=r.data.asunto.fase_director.numero;
  r=await s.call('ficha_asunto',{accion:'anotar_decision',decision:'Vamos por juicio ordinario',puerta:'¿Por qué vía procesal vamos?'});
  check('anotar_decision registra sin cambiar de fase',!r.isError);
  r=await s.call('ficha_asunto',{accion:'leer'});
  check('…y la fase sigue igual',r.data.asunto.fase_director.numero===antes);
  const nDec=r.data.asunto.decisiones.length;

  // Reabrir un paso (paso 8): queda como cambio detectado.
  r=await s.call('ficha_asunto',{accion:'resolver_puerta',fase_siguiente:1,decision:'Sí, reábrelo',motivo_reapertura:'Nueva carpeta del procedimiento'});
  check('una fase menor reabre y deja constancia del paso reabierto',!r.isError&&r.data.asunto.cambios_detectados.at(-1).paso_reabierto===1);

  // Espejo legible.
  const esp=path.join(DATOS,'asuntos',id);
  const dec=fs.existsSync(path.join(esp,'decisiones.md'))?fs.readFileSync(path.join(esp,'decisiones.md'),'utf8'):'';
  check('decisiones.md se puede leer sin Claude y trae las decisiones',dec.includes('Vamos por juicio ordinario')&&dec.includes('1. Sí, son esos los datos'));
  check('ficha.md trae las dos carpetas',fs.readFileSync(path.join(esp,'ficha.md'),'utf8').includes('Ruiz - Procedimiento'));
  const json=fs.readFileSync(path.join(DATOS,'asuntos.json'),'utf8');
  check('la ficha no copia el contenido de los documentos',!json.includes('SECRETO-RUIZ'));

  // Un segundo asunto: solo uno activo.
  r=await s.call('ficha_asunto',{accion:'crear',nombre:'Otro — despido',carpetas_expediente:'Otro - Cliente',orden:'laboral'});
  const id2=r.data.asunto?.asunto_id;
  r=await s.call('ficha_asunto',{accion:'listar'});
  check('solo un asunto activo a la vez',r.data.asuntos.filter(a=>a.activo).length===1&&r.data.activo===id2);
  const b2r=await s.call('buscar_documentos',{query:'contrato de obra',n_resultados:10});const b2=JSON.stringify(b2r.data);
  check('activar otro asunto deja fuera las carpetas del anterior',!b2r.isError&&b2.includes('SECRETO-OTRO')&&!b2.includes('SECRETO-RUIZ'));

  // Cerrar exige decisión y limpia la selección.
  r=await s.call('ficha_asunto',{accion:'cerrar',asunto_id:id2});
  check('cerrar sin decisión se rechaza',r.isError);
  r=await s.call('ficha_asunto',{accion:'cerrar',asunto_id:id2,decision:'Cerrado, acuerdo firmado'});
  check('cerrar con decisión',!r.isError&&r.data.asunto.estado==='cerrado');
  const b3=await s.call('buscar_documentos',{query:'despido'});
  check('y deja la sesión sin expediente activo',b3.isError&&/expediente/i.test(b3.raw));
  r=await s.call('ficha_asunto',{accion:'listar'});
  check('el cerrado no sale en la lista por defecto',!r.data.asuntos.some(a=>a.asunto_id===id2));

  // Reiniciar Claude: no queda nada activo, pero la ficha sigue.
  await terminar(s.c);
  // Mientras tanto llega un documento nuevo a una carpeta del asunto y otro cambia.
  fs.writeFileSync(path.join(MADRE,'Ruiz - Procedimiento','auto-admision.txt'),'Auto de admisión a trámite. SECRETO-RUIZ-AUTO-4004.');
  await dormir(1100);
  fs.appendFileSync(path.join(MADRE,'Ruiz - Cliente','escrito.txt'),' Adenda con nueva fecha de entrega.');
  s=arrancar();
  est=await listo(s,7);
  r=await s.call('ficha_asunto',{accion:'listar'});
  check('tras reiniciar no hay asunto activo («no se queda pegado»)',r.data.activo===null);
  check('pero el asunto sigue, el más reciente primero, con su fase y su puerta',r.data.asuntos[0]?.asunto_id===id&&r.data.asuntos[0].fase_director.numero===1);
  r=await s.call('ficha_asunto',{accion:'leer',asunto_id:id});
  check('las decisiones siguen todas (solo se añaden)',r.data.asunto.decisiones.length===nDec+1);
  r=await s.call('ficha_asunto',{accion:'activar',asunto_id:id});
  const cam=r.data.cambios_desde_ultima_sesion||[];
  const todo=JSON.stringify(cam);
  check('al volver cuenta lo NUEVO desde la última sesión',todo.includes('auto-admision.txt'),todo.slice(0,300));
  check('y lo MODIFICADO',cam.some(x=>(x.modificados||[]).some(m=>m.includes('escrito.txt'))));
  check('y lo deja anotado en cambios_detectados',r.data.asunto.cambios_detectados.some(x=>/1 nuevos/.test(x.cambio)));
  r=await s.call('ficha_asunto',{accion:'activar',asunto_id:id});
  check('una segunda apertura ya no repite los mismos cambios',(r.data.cambios_desde_ultima_sesion||[]).length===0);

  // Una carpeta del asunto desaparece: activar no busca en «lo que quede».
  fs.renameSync(path.join(MADRE,'Ruiz - Cliente'),path.join(MADRE,'Ruiz - Cliente (archivado)'));
  let rr;
  for(let i=0;i<40;i++){rr=await s.call('ficha_asunto',{accion:'activar',asunto_id:id});if(rr.isError)break;await dormir(1000);}
  check('si una carpeta del asunto ya no existe, activar lo dice y no abre a medias',rr.isError&&/carpeta/i.test(rr.raw),rr.raw.slice(0,160));

  await terminar(s.c);
}

try{await main();}catch(e){console.log(' FALLO  excepción',e?.stack||e);results.push(false);}
borrar(base);
const okN=results.filter(Boolean).length;
console.log(`\n${okN}/${results.length} comprobaciones OK`);
process.exit(okN===results.length?0:1);
