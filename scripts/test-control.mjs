// ESCENARIO: la app de escritorio quiere enseñar lo que está pasando AHORA —
// «indexando 34 de 120» — y ofrecer un botón de reindexar.
//
// Eso no se puede leer del disco: el progreso vive en la memoria del proceso
// que arranca Claude Desktop. Por eso el servidor abre un canal de control.
//
// Y el canal es un SOCKET CON NOMBRE, no un puerto en 127.0.0.1: un puerto
// local es justo lo que bloquean los antivirus de despacho (10-sep-2026, 12
// códigos de login emitidos y 0 recogidos). Un socket de dominio UNIX no es
// tráfico de red y ningún cortafuegos lo ve.
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import crypto from 'node:crypto';

const REPO = process.env.REPO || path.resolve(new URL('..', import.meta.url).pathname);
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};
const espera=(ms)=>new Promise(r=>setTimeout(r,ms));

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-control-'));
const DATOS=path.join(base,'datos');
const MADRE=path.join(base,'Expedientes','Núñez - Despido');
fs.mkdirSync(MADRE,{recursive:true});
for(let i=1;i<=6;i++){
  fs.writeFileSync(path.join(MADRE,`0${i} documento.txt`),
    `Documento ${i} del expediente. Despido disciplinario y liquidación. SECRETO-${i}.`);
}

// Como en casa del abogado: la carpeta la dejó la APP en su fichero de ajustes,
// no una variable de entorno (el manifiesto ya no las pasa).
fs.mkdirSync(DATOS,{recursive:true});
fs.writeFileSync(path.join(DATOS,'ajustes.json'), JSON.stringify({carpetas:[path.dirname(MADRE)]},null,2));

const env={...process.env, ROBIN_DATA_DIR:DATOS,
  ROBIN_TOKEN:'ROBIN-PRUEBA-control', ROBIN_OCR:'false', ROBIN_LOG_LEVEL:'error',
  ROBIN_UPDATE_URL:'http://127.0.0.1:9/no', ROBIN_OAUTH_ISSUER:'http://127.0.0.1:9'};
const c=spawn('node',[path.join(REPO,'server/index.js')],{env,stdio:['pipe','pipe','pipe']});
let se=''; c.stderr.on('data',d=>{se+=d.toString();});
c.stdout.on('data',()=>{});

// La ruta del canal se calcula igual que en el servidor: si divergieran, la app
// buscaría en un sitio y el servidor escucharía en otro.
const huella=crypto.createHash('sha256').update(DATOS).digest('hex').slice(0,8);
const RUTA = process.platform==='win32' ? `\\\\.\\pipe\\robinsearch-${huella}`
                                        : path.join(os.tmpdir(), `robinsearch-${huella}.sock`);

function conectar(){
  return new Promise((res,rej)=>{
    const s=net.connect(RUTA);
    s.once('connect',()=>res(s));
    s.once('error',rej);
  });
}

async function conectarConEspera(intentos=60){
  for(let i=0;i<intentos;i++){
    try { return await conectar(); } catch { await espera(250); }
  }
  throw new Error('el canal de control nunca abrió');
}

function lector(socket){
  const mensajes=[]; let buf='';
  socket.setEncoding('utf8');
  socket.on('data',(t)=>{buf+=t;let i;
    while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);
      if(l){ try{ mensajes.push(JSON.parse(l)); }catch{ /* ignorar */ } }}});
  return mensajes;
}

async function main(){
  const s=await conectarConEspera();
  const msgs=lector(s);
  check('la app puede conectarse al canal de control', true, RUTA.replace(os.tmpdir(),'…'));

  // Esperar al MENSAJE, no al reloj: con la máquina cargada (esta suite corre
  // detrás de otras dos que indexan) 600 ms fijos daban un falso fallo.
  for(let i=0;i<60 && !msgs.length;i++) await espera(150);
  check('nada más conectar, el servidor manda su estado', msgs.length>0 && msgs[0].tipo==='estado',
    msgs[0]?JSON.stringify({estado:msgs[0].estado,carpetas:msgs[0].carpetas?.length}):'sin mensajes');
  check('y dice qué carpetas vigila', Array.isArray(msgs[0]?.carpetas) && msgs[0].carpetas.length===1);
  check('sin filtrar contenido de los documentos',
    !JSON.stringify(msgs[0]).includes('SECRETO'));

  if(process.platform!=='win32'){
    const modo=fs.statSync(RUTA).mode & 0o777;
    check('el socket es privado del usuario (0600)', modo===0o600, '0'+modo.toString(8));
  }

  // --- Reindexado a petición: es lo que hará el botón de la app ---
  const antes=msgs.length;
  s.write(JSON.stringify({cmd:'reindexar', force:true})+'\n');
  for(let i=0;i<80 && !msgs.some(m=>m.tipo==='fin-reindexado');i++) await espera(150);

  const respuesta=msgs.slice(antes).find(m=>m.tipo==='respuesta'&&m.cmd==='reindexar');
  check('el servidor acepta la orden de reindexar', respuesta?.ok===true);

  const conProgreso=msgs.filter(m=>m.tipo==='estado'&&m.progreso&&m.progreso.total>0);
  check('llega el progreso EN VIVO, que es lo que no se puede leer del disco',
    conProgreso.length>0, conProgreso.length?`${conProgreso.length} avisos, último ${conProgreso.at(-1).progreso.procesados}/${conProgreso.at(-1).progreso.total}`:'ninguno');
  check('el progreso identifica el fichero en curso',
    conProgreso.some(m=>typeof m.progreso.ficheroActual==='string'&&m.progreso.ficheroActual.length>0));

  const fin=msgs.find(m=>m.tipo==='fin-reindexado');
  check('y avisa cuando termina, con su resumen', fin?.ok===true && typeof fin.resumen?.indexados==='number',
    fin?`indexados=${fin.resumen?.indexados}`:'sin fin');

  // --- Una orden desconocida no puede tumbar el canal ---
  s.write(JSON.stringify({cmd:'haz_lo_que_quieras'})+'\n');
  await espera(400);
  s.write(JSON.stringify({cmd:'estado'})+'\n');
  await espera(600);
  check('una orden desconocida se rechaza sin cerrar el canal',
    msgs.some(m=>m.motivo==='orden_desconocida') && !s.destroyed);

  // --- Una segunda instancia no puede robar el canal ---
  const c2=spawn('node',[path.join(REPO,'server/index.js')],{env,stdio:'ignore'});
  await espera(3000);
  s.write(JSON.stringify({cmd:'estado'})+'\n');
  const antes2=msgs.length;
  await espera(800);
  check('con dos instancias vivas, el canal del primero sigue sirviendo',
    msgs.length>antes2, `${antes2} → ${msgs.length}`);
  c2.kill();

  // --- La carpeta la manda la APP, no la pantalla de configuracion de Claude ---
  // El abogado configura RobinSearch en la app de RobinSearch, en un sitio y no
  // en dos. Y se aplica EN CALIENTE: sin reiniciar Claude.
  const OTRA = path.join(base, 'Expedientes 2', 'Acme - Mercantil');
  fs.mkdirSync(OTRA, { recursive: true });
  for (let i = 1; i <= 3; i++) {
    fs.writeFileSync(path.join(OTRA, `0${i} contrato.txt`), `Contrato mercantil ${i}. OTRO-SECRETO-${i}.`);
  }
  const antesCfg = msgs.length;
  s.write(JSON.stringify({ cmd: 'configurar', carpetas: [path.dirname(MADRE), path.dirname(OTRA)] }) + '\n');
  for (let i = 0; i < 100 && !msgs.slice(antesCfg).some(m => m.tipo === 'respuesta' && m.cmd === 'configurar'); i++) await espera(150);
  const rc = msgs.slice(antesCfg).find(m => m.tipo === 'respuesta' && m.cmd === 'configurar');
  check('el servidor acepta las carpetas que manda la app', rc?.ok === true, JSON.stringify(rc?.carpetas?.length));
  check('y las guarda en SU fichero de ajustes, no en los de Claude',
    fs.existsSync(path.join(DATOS, 'ajustes.json')));
  const guardado = JSON.parse(fs.readFileSync(path.join(DATOS, 'ajustes.json'), 'utf8'));
  check('con las dos carpetas dentro', (guardado.carpetas || []).length === 2, JSON.stringify(guardado.carpetas?.length));

  for (let i = 0; i < 100 && !msgs.slice(antesCfg).some(m => m.tipo === 'fin-reindexado'); i++) await espera(150);
  const est = msgs.filter(m => m.tipo === 'estado').at(-1);
  check('las aplica EN CALIENTE, sin reiniciar Claude', (est?.carpetas || []).length === 2,
    `${est?.carpetas?.length} carpetas vigiladas`);
  const finCfg = msgs.slice(antesCfg).filter(m => m.tipo === 'fin-reindexado').at(-1);
  check('y se indexa lo nuevo sin que nadie lo pida', finCfg?.ok === true && finCfg.resumen?.indexados >= 3,
    `indexados=${finCfg?.resumen?.indexados}`);

  // --- Al cerrar el servidor, el socket no queda huérfano bloqueando el siguiente arranque ---
  c.kill();
  await espera(1500);
  const c3=spawn('node',[path.join(REPO,'server/index.js')],{env,stdio:'ignore'});
  let reconectado=false;
  for(let i=0;i<40 && !reconectado;i++){
    try { const s3=await conectar(); s3.destroy(); reconectado=true; } catch { await espera(250); }
  }
  check('tras reiniciar el servidor, la app vuelve a conectar', reconectado);

  if (reconectado) {
    const s4 = await conectar();
    const m4 = lector(s4);
    for (let i = 0; i < 40 && !m4.length; i++) await espera(150);
    check('y arranca con las carpetas del fichero de ajustes, sin variables de entorno',
      (m4[0]?.carpetas || []).length === 2, `${m4[0]?.carpetas?.length} carpetas`);
    try { s4.destroy(); } catch { /* nada */ }
  }
  c3.kill();

  // --- Despliegue de IT: si el entorno fija las carpetas, no se finge ---
  const cIT=spawn('node',[path.join(REPO,'server/index.js')],
    {env:{...env, ROBIN_FOLDERS:path.dirname(MADRE), ROBIN_DATA_DIR:path.join(base,'datos-it')},stdio:'ignore'});
  const huellaIT=crypto.createHash('sha256').update(path.join(base,'datos-it')).digest('hex').slice(0,8);
  const rutaIT=process.platform==='win32'?`\\\\.\\pipe\\robinsearch-${huellaIT}`
                                        :path.join(os.tmpdir(),`robinsearch-${huellaIT}.sock`);
  let sIT=null;
  for(let i=0;i<60 && !sIT;i++){
    try { sIT=await new Promise((res,rej)=>{const x=net.connect(rutaIT);x.once('connect',()=>res(x));x.once('error',rej);}); }
    catch { await espera(250); }
  }
  if(sIT){
    const mIT=lector(sIT);
    sIT.write(JSON.stringify({cmd:'configurar',carpetas:[path.dirname(OTRA)]})+'\n');
    for(let i=0;i<60 && !mIT.some(m=>m.cmd==='configurar');i++) await espera(150);
    const rIT=mIT.find(m=>m.cmd==='configurar');
    check('si las carpetas las fija el entorno (despliegue de IT), se DICE en vez de fingir',
      rIT?.ok===false && rIT.motivo==='fijadas_por_entorno', JSON.stringify(rIT?.motivo));
    try{sIT.destroy();}catch{}
  } else {
    check('si las carpetas las fija el entorno, se DICE en vez de fingir', false, 'no se pudo conectar');
  }
  cIT.kill();

  const fallos=results.filter(r=>!r).length;
  console.log(`\n${results.length-fallos}/${results.length} comprobaciones OK`);
  if(fallos){console.log(se.slice(-1500));process.exitCode=1;}
  try{s.destroy();}catch{}
  fs.rmSync(base,{recursive:true,force:true});
}
main().catch(e=>{console.error('ERROR:',e);console.error(se.slice(-1500));
  try{c.kill();}catch{} process.exit(1);});
