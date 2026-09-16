// ESCENARIO: la promesa más básica al despacho — RobinSearch LEE sus documentos y jamás los
// modifica, mueve ni borra. Se monta una carpeta de expedientes con todo lo que se indexa
// (texto, PDF, imágenes para OCR, una imagen rota, zip y 7z —con miembros maliciosos que
// intentan salir de la carpeta—, correo, hoja de cálculo, subcarpetas), se fotografía TODO
// (lista de ficheros y carpetas, tamaño, fecha de modificación y huella sha-256, también de la
// carpeta que la contiene) y se hace de todo con ella: indexar, reindexar a la fuerza, buscar,
// quitar la carpeta de la configuración y volver a ponerla. Al final la fotografía tiene que ser
// idéntica bit a bit.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

// fileURLToPath y no `.pathname`: en Windows da «/C:/…» y en cualquier SO rompe con espacios o tildes.
const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const terminar=(p)=>p.exitCode!==null||p.signalCode!==null?Promise.resolve():new Promise(r=>{p.once('exit',r);p.kill();
  setTimeout(()=>{try{p.kill('SIGKILL');}catch{}},15000).unref();});
const borrar=(d)=>fs.rmSync(d,{recursive:true,force:true,maxRetries:10,retryDelay:300});
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};
const espera=(ms)=>new Promise(r=>setTimeout(r,ms));

const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-no-modifica-'));
const DESPACHO=path.join(base,'Despacho');            // lo que se fotografía (incluye la carpeta madre)
const MADRE=path.join(DESPACHO,'Expedientes');
const CASO=path.join(MADRE,'Núñez - Reclamación');
const DATOS=path.join(base,'datos');
const escribir=(f,t)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,t);};

// ── La carpeta del despacho ──
escribir(path.join(CASO,'01 demanda.txt'),'Demanda de reclamación de cantidad por incumplimiento del contrato de arrendamiento. '.repeat(40));
escribir(path.join(CASO,'Pruebas','acta notarial.md'),'# Acta\nComparecen las partes para dejar constancia del estado del local. '.repeat(30));
escribir(path.join(CASO,'Pruebas','cuentas.csv'),'fecha;concepto;importe\n2024-01-01;renta;1200\n2024-02-01;renta;1200\n');
escribir(path.join(CASO,'correo del cliente.eml'),
  'From: a@example.com\r\nTo: b@example.com\r\nSubject: Documentos\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nLe adjunto el contrato firmado y los recibos.\r\n');
{ // PDF con texto, escrito a mano
  const c='BT /F1 18 Tf 72 700 Td (Contrato de arrendamiento de local de negocio) Tj ET';
  const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${c.length} >>stream\n${c}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out='%PDF-1.4\n'; const offs=[];
  objs.forEach((o,i)=>{offs.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const x=Buffer.byteLength(out);
  out+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`+offs.map((o)=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+
    `trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  escribir(path.join(CASO,'02 contrato.pdf'),out);
}
escribir(path.join(CASO,'foto.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'));
{ // una imagen que el OCR no puede leer
  const cab=Buffer.alloc(54); cab.write('BM',0); cab.writeUInt32LE(243,2); cab.writeUInt32LE(54,10);
  cab.writeUInt32LE(40,14); cab.writeInt32LE(4000,18); cab.writeInt32LE(4000,22); cab.writeUInt16LE(1,26); cab.writeUInt16LE(24,28);
  escribir(path.join(CASO,'plano roto.bmp'),Buffer.concat([cab,Buffer.alloc(243-54)]));
}
{ // zip con miembros que intentan escribir FUERA (../ y ruta absoluta)
  const AdmZip=(await import(pathToFileURL(path.join(REPO,'node_modules','adm-zip','adm-zip.js')).href)).default;
  const z=new AdmZip();
  z.addFile('recibos/enero.txt',Buffer.from('Recibo de la renta de enero.'));
  z.addFile('../../fuera-zip.txt',Buffer.from('esto no puede aparecer fuera'));
  z.addFile('/abs-zip.txt',Buffer.from('ni esto'));
  z.writeZip(path.join(CASO,'recibos.zip'));
}
{ // 7z (se lee montando la carpeta del caso dentro de 7-Zip)
  const SevenZip=(await import(pathToFileURL(path.join(REPO,'node_modules','7z-wasm','7zz.umd.js')).href)).default;
  const src=path.join(base,'src7z');
  escribir(path.join(src,'auto.txt'),'Auto de admisión a trámite de la demanda.');
  const sz=await SevenZip({print:()=>{},printErr:()=>{}});
  sz.FS.mkdir('/w'); sz.FS.mount(sz.NODEFS,{root:base},'/w'); sz.FS.chdir('/w/src7z');
  sz.callMain(['a',`/w/${path.relative(base,path.join(CASO,'autos.7z')).split(path.sep).join('/')}`,'auto.txt']);
  borrar(src);
}

// ── Fotografía de la carpeta del despacho ──
function foto(dir){
  const r={};
  const recorrer=(d)=>{
    for(const e of fs.readdirSync(d,{withFileTypes:true})){
      const p=path.join(d,e.name); const rel=path.relative(dir,p); const st=fs.lstatSync(p);
      if(e.isDirectory()){ r[rel+path.sep]={tipo:'carpeta'}; recorrer(p); }
      else r[rel]={bytes:st.size,mtimeMs:st.mtimeMs,sha:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')};
    }
  };
  recorrer(dir);
  return r;
}
const antes=foto(DESPACHO);
const fueraAntes=fs.readdirSync(base).sort();
check('la carpeta de prueba tiene todos los tipos', Object.keys(antes).length>=12, `${Object.keys(antes).length} entradas`);

// ── Servidor ──
const AJUSTES=path.join(DATOS,'ajustes.json');
function arrancar(){
  const env={...process.env,ROBIN_TOKEN:'t',ROBIN_DATA_DIR:DATOS,ROBIN_LOG_LEVEL:'error',ROBIN_OCR:'true',
    ROBIN_UPDATE_URL:'http://127.0.0.1:9/no',ROBIN_OAUTH_ISSUER:'http://127.0.0.1:9'};
  delete env.ROBIN_FOLDERS; delete env.ROBIN_FOLDER; delete env.ROBIN_WATCHED_FOLDER;
  const c=spawn(process.execPath,[path.join(REPO,'server/index.js')],{env,stdio:['pipe','pipe','pipe']});
  let buf=''; const w=new Map(); let id=1; c.stderr.on('data',()=>{});
  c.stdout.on('data',(d)=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);
    if(!l)continue;let m;try{m=JSON.parse(l);}catch{continue;}const f=w.get(m.id);if(f){w.delete(m.id);f(m);}}});
  const rpc=(method,params)=>new Promise((res,rej)=>{const i=id++;const t=setTimeout(()=>rej(new Error('timeout '+method)),300000);
    w.set(i,(m)=>{clearTimeout(t);res(m);});c.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});
  const call=async(n,a={})=>{const r=await rpc('tools/call',{name:n,arguments:a});const t=r.result?.content?.[0]?.text;
    let d=null;try{d=JSON.parse(t);}catch{}return {isError:Boolean(r.result?.isError),data:d,raw:t||''};};
  return {c,rpc,call};
}
async function listo(call){
  for(let i=0;i<240;i++){const e=await call('estado_servidor');
    if(e.data?.ultimo_indexado&&e.data.estado!=='indexando')return e.data; await espera(1000);}
  return (await call('estado_servidor')).data;
}
const saludo={protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'t',version:'1'}};

fs.mkdirSync(DATOS,{recursive:true});
fs.writeFileSync(AJUSTES,JSON.stringify({carpetas:[MADRE]}));
let s=arrancar();
await s.rpc('initialize',saludo);
const e1=await listo(s.call);
check('indexa la carpeta', (e1?.documentos_indexados??0)>=5, `${e1?.documentos_indexados} documentos`);
await s.call('indexar_carpeta',{force:true});
await listo(s.call);
await s.call('establecer_expediente_activo',{expediente:'Núñez - Reclamación'});
const b=await s.call('buscar_documentos',{query:'contrato de arrendamiento'});
check('busca', !b.isError, b.raw.slice(0,80));
await terminar(s.c);

// quitar la carpeta de la configuración (retira del índice) y volver a ponerla
fs.writeFileSync(AJUSTES,JSON.stringify({carpetas:[]}));
s=arrancar(); await s.rpc('initialize',saludo); await espera(6000); await terminar(s.c);
fs.writeFileSync(AJUSTES,JSON.stringify({carpetas:[MADRE]}));
s=arrancar(); await s.rpc('initialize',saludo); await listo(s.call); await terminar(s.c);

// ── Comparación ──
const despues=foto(DESPACHO);
const cambios=[];
for(const k of new Set([...Object.keys(antes),...Object.keys(despues)])){
  if(JSON.stringify(antes[k])!==JSON.stringify(despues[k])) cambios.push(`${k}: ${antes[k]?'':'(nuevo) '}${despues[k]?'':'(desaparecido)'}`);
}
check('ningún fichero ni carpeta del despacho se ha creado, borrado, movido ni modificado (contenido, tamaño y fecha)', cambios.length===0, cambios.slice(0,5).join(' | '));
check('los miembros maliciosos del zip no han escrito fuera', !fs.existsSync(path.join(base,'fuera-zip.txt')) && !fs.existsSync(path.join(DESPACHO,'fuera-zip.txt')) && !fs.existsSync('/abs-zip.txt'));
const fueraDespues=fs.readdirSync(base).sort();
check('junto a la carpeta del despacho solo aparece la carpeta de datos de RobinSearch', JSON.stringify(fueraDespues.filter((n)=>n!=='datos'))===JSON.stringify(fueraAntes.filter((n)=>n!=='datos')), JSON.stringify(fueraDespues));

borrar(base);
const ok=results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok===results.length?0:1);
