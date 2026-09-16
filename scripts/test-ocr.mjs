// ESCENARIO: en una carpeta de despacho hay imágenes que el OCR no puede leer (un .bmp de 243
// bytes, una captura cortada). Antes, tesseract.js relanzaba ese fallo fuera de cualquier
// promesa y tumbaba RobinSearch entero; con miles de ficheros era una caída tras otra. Ahora
// falla solo ese fichero, el OCR sigue sirviendo, y un OCR colgado no para el indexado.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

// fileURLToPath y no `.pathname`: en Windows da «/C:/…» y en cualquier SO rompe con espacios o tildes.
const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};
const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-ocr-'));
const roto=path.join(base,'plano roto.bmp');
const cab=Buffer.alloc(54); cab.write('BM',0); cab.writeUInt32LE(243,2); cab.writeUInt32LE(54,10);
cab.writeUInt32LE(40,14); cab.writeInt32LE(4000,18); cab.writeInt32LE(4000,22); cab.writeUInt16LE(1,26); cab.writeUInt16LE(24,28);
fs.writeFileSync(roto,Buffer.concat([cab,Buffer.alloc(243-54)]));
const bueno=path.join(base,'pixel.png');
fs.writeFileSync(bueno,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'));

const guion=(extra)=>`
  const m=await import(${JSON.stringify(pathToFileURL(path.join(REPO,'server/indexer/ocr.js')).href)});
  const r=[];
  for (const f of ${JSON.stringify(extra)}) { try { await m.ocrImage(f); r.push('ok'); } catch (e) { r.push('rechazo:'+String(e.message).slice(0,40)); } }
  await m.terminateOcr();
  console.log(JSON.stringify(r));
`;
const lanzar=(archivos,env={})=>new Promise((res)=>{
  const c=spawn(process.execPath,['--input-type=module','-e',guion(archivos)],{env:{...process.env,ROBIN_DATA_DIR:path.join(base,'datos'),ROBIN_LOG_LEVEL:'error',...env},stdio:['ignore','pipe','pipe']});
  let out='',err='';c.stdout.on('data',(d)=>{out+=d;});c.stderr.on('data',(d)=>{err+=d;});
  const t=setTimeout(()=>c.kill('SIGKILL'),120000);
  c.on('exit',(code)=>{clearTimeout(t);let r=null;try{r=JSON.parse(out.trim().split('\n').pop());}catch{}res({code,r,err});});
});

const a=await lanzar([roto,bueno,roto,bueno]);
check('una imagen ilegible no tumba el proceso', a.code===0, `código ${a.code} ${a.err.slice(-160)}`);
check('solo falla ese fichero', a.r?.[0]?.startsWith('rechazo') && a.r?.[2]?.startsWith('rechazo'), JSON.stringify(a.r));
check('y el OCR sigue leyendo las siguientes', a.r?.[1]==='ok' && a.r?.[3]==='ok', JSON.stringify(a.r));
const b=await lanzar([bueno,bueno],{ROBIN_OCR_TOPE_MS:'1'});
check('un OCR sin respuesta falla por tiempo en vez de colgar el indexado', b.code===0 && b.r?.every((x)=>/sin respuesta/.test(x)), JSON.stringify(b.r));

fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:300});
const ok=results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok===results.length?0:1);
