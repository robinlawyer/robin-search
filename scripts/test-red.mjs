// ESCENARIO: los expedientes NO están en el ordenador del abogado, sino en el servidor del
// despacho (unidad Z:\ en Windows, montaje SMB en Mac). Ahí el sistema operativo NO avisa de
// forma fiable cuando un compañero deja un escrito nuevo en el expediente desde su equipo.
//
// Lo que se prueba es justo eso: que el documento nuevo aparece SOLO, sin que el abogado
// tenga que pedir nada, por las dos vías previstas — al abrir el expediente y por re-escaneo
// periódico — y que una unidad caída se dice como tal en vez de devolver "0 documentos".
//
// La carpeta de red se simula con ROBIN_NETWORK_PATHS (la misma escotilla que sirve para
// forzar el modo red en un Windows donde la detección automática falle).
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || path.resolve(new URL('..', import.meta.url).pathname);
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};
const espera=(ms)=>new Promise(r=>setTimeout(r,ms));

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-red-'));
const MADRE=path.join(base,'Expedientes');           // "Z:\Expedientes" del despacho
const CASO=path.join(MADRE,'Pereira-Contencioso');
const OTRO=path.join(MADRE,'Vidal, S.L. - Mercantil'); // coma en el nombre: caso real del bug
fs.mkdirSync(CASO,{recursive:true}); fs.mkdirSync(OTRO,{recursive:true});
fs.writeFileSync(path.join(CASO,'01 recurso.txt'),
  'Recurso contencioso-administrativo contra la resolución del tribunal de contratación. '+
  'Se alega desviación de poder y falta de motivación. SECRETO-PEREIRA-1001.');
fs.writeFileSync(path.join(OTRO,'01 contrato.txt'),
  'Contrato de distribución en exclusiva y reclamación de comisiones. SECRETO-VIDAL-2002.');

const RESCAN_MS=4000;
const env={...process.env,ROBIN_TOKEN:'t',
  ROBIN_FOLDERS:MADRE,
  ROBIN_NETWORK_PATHS:MADRE,          // <- trata la carpeta madre como unidad de red
  ROBIN_RESCAN_MS:String(RESCAN_MS),
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

// --- Detección de unidad de red (el camino de Windows, que aquí no se puede ejecutar) ---
const { parsearNetUse, parsearMount } = await import(new URL('../server/net.js', import.meta.url));
const NET_USE_ES = [
  'Se recordarán las conexiones nuevas.','',
  'Estado       Local     Remoto                    Red','',
  '-------------------------------------------------------------------------------',
  'Correcto     Z:        \\\\SRV-DESPACHO\\Expedientes  Microsoft Windows Network',
  'Desconectado Y:        \\\\NAS01\\Comun               Microsoft Windows Network',
  'El comando se ha completado correctamente.',''].join('\r\n');
{
  const letras=parsearNetUse(NET_USE_ES);
  check('se detectan las unidades de red de un `net use` en español',
    letras.has('Z') && letras.has('Y') && letras.size===2, JSON.stringify([...letras]));
  check('un `net use` sin unidades mapeadas no inventa ninguna',
    parsearNetUse('No hay entradas en la lista.').size===0);
  const mp=parsearMount([
    '/dev/disk3s1s1 on / (apfs, sealed, local, read-only)',
    '//alonso@srv-despacho/Expedientes on /Volumes/Expedientes (smbfs, nodev, nosuid)',
  ].join('\n'));
  check('en Mac se detecta el montaje SMB del despacho y no el disco local',
    mp.length===1 && mp[0]==='/Volumes/Expedientes', JSON.stringify(mp));
}

async function main(){
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'t',version:'1'}});
  c.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');

  let est;
  for(let i=0;i<120;i++){est=(await call('estado_servidor')).data;
    if(est.estado==='activo'&&est.documentos_indexados>=2)break; await espera(1000);}

  // 1) La carpeta con coma en el nombre NO se parte en dos (era el bug de ROBIN_FOLDERS).
  check('la carpeta del cliente con coma en el nombre se indexa entera',
    est.documentos_indexados===2 &&
    est.expedientes_detectados.includes('Expedientes/Vidal, S.L. - Mercantil'),
    JSON.stringify(est.expedientes_detectados));

  // 2) El abogado ve que su expediente está en el servidor y cómo se mantiene al día.
  const raiz=est.carpetas_vigiladas[0];
  check('estado_servidor declara la carpeta como de RED y accesible',
    raiz.ubicacion==='red' && raiz.accesible===true && /re-escaneo/.test(raiz.actualizacion||''),
    JSON.stringify(raiz));

  // 3) NÚCLEO: un compañero deja un escrito nuevo en el expediente desde su equipo.
  //    El abogado abre el asunto y tiene que estar ahí, sin pedir nada.
  fs.writeFileSync(path.join(CASO,'36 demanda.txt'),
    'Demanda rectora del procedimiento ordinario. Se solicita la nulidad de la adjudicación '+
    'y la indemnización de los daños. SECRETO-DEMANDA-3003.');
  const abrir=await call('establecer_expediente_activo',{expediente:'Pereira-Contencioso'});
  check('al abrir el expediente entra solo el documento que dejó un compañero',
    !abrir.isError && abrir.data.ubicacion==='red' &&
    abrir.data.actualizado_desde_disco?.documentos_nuevos_o_modificados>=1,
    JSON.stringify(abrir.data.actualizado_desde_disco));
  const b1=await call('buscar_documentos',{query:'nulidad de la adjudicación e indemnización'});
  check('y se puede buscar en él inmediatamente', b1.raw.includes('SECRETO-DEMANDA-3003'));

  // 4) Con el expediente YA abierto, otro compañero añade un anexo. Sin tocar nada, el
  //    re-escaneo periódico tiene que traerlo.
  fs.writeFileSync(path.join(CASO,'37 anexo.txt'),
    'Anexo con la resolución del tribunal administrativo de contratación. SECRETO-ANEXO-4004.');
  let hallado=false;
  for(let i=0;i<20 && !hallado;i++){ await espera(RESCAN_MS/2);
    hallado=(await call('buscar_documentos',{query:'resolución del tribunal administrativo de contratación'}))
      .raw.includes('SECRETO-ANEXO-4004'); }
  check('sin abrir nada, el re-escaneo periódico trae el anexo posterior', hallado);

  // 5) Un escrito que se retira del expediente deja de aparecer en las búsquedas.
  fs.rmSync(path.join(CASO,'37 anexo.txt'));
  let fuera=false;
  for(let i=0;i<20 && !fuera;i++){ await espera(RESCAN_MS/2);
    fuera=!(await call('listar_documentos_indexados')).raw.includes('37 anexo'); }
  check('lo que se retira del expediente sale también del índice', fuera);

  // 6) La unidad de red se cae. Eso NO es "el expediente está vacío": hay que decirlo.
  fs.chmodSync(CASO,0o000);
  try{
    const r=await call('indexar_carpeta');
    const seQueja = Boolean(r.data.subcarpetas_ilegibles||r.data.carpetas_inaccesibles) && Boolean(r.data.aviso);
    check('una carpeta de red ilegible se reporta como tal, no como "0 documentos"', seQueja,
      JSON.stringify(r.data.subcarpetas_ilegibles||r.data.carpetas_inaccesibles||r.data).slice(0,200));
    // Y sobre todo: NO se borra del índice lo que no se ha podido leer.
    const l=await call('listar_documentos_indexados');
    check('con la unidad caída NO se vacía el índice del expediente',
      l.data.total>=2, `documentos=${l.data.total}`);
  } finally { fs.chmodSync(CASO,0o755); }

  const fallos=results.filter(r=>!r).length;
  console.log(`\n${results.length-fallos}/${results.length} comprobaciones OK`);
  if(fallos){console.log(se.slice(-2000));process.exitCode=1;}
  c.kill(); fs.rmSync(base,{recursive:true,force:true});
}
main().catch(e=>{console.error('ERROR:',e);console.error(se.slice(-2000));process.exit(1);});
