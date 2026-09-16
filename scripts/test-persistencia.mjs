// ESCENARIO: los ficheros de estado (registro, anotaciones, apartados, ajustes, sesión) sufren lo
// que sufren en un despacho: un apagón a mitad de escritura, el antivirus con el fichero abierto,
// dos instancias de RobinSearch guardando a la vez. Ninguno de esos casos puede tomar un fichero
// dañado por vacío (y escribir encima), ni perder cambios que se dieron por guardados.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

// fileURLToPath y no `.pathname`: en Windows da «/C:/…» y en cualquier SO rompe con espacios o tildes.
const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const P = await import(pathToFileURL(path.join(REPO, 'server/persistencia.js')).href);
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};
const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-persistencia-'));

console.log('\nA. Leer un fichero de estado nunca confunde «dañado» con «vacío»\n');
const f=path.join(base,'estado.json');
check('A.1 sin fichero: no_existe', P.leerJson(f).estado==='no_existe');
P.escribirJson(f,{v:1},{bak:true});
P.escribirJson(f,{v:2},{bak:true});
check('A.2 escribe y lee', P.leerJson(f).valor?.v===2);
check('A.3 deja copia de la versión anterior', JSON.parse(fs.readFileSync(`${f}.bak`,'utf8')).v===1);
check('A.4 no quedan temporales', !fs.readdirSync(base).some((n)=>n.endsWith('.tmp')));
fs.writeFileSync(f,'{"v":3,"cort');
const r5=P.leerJson(f);
check('A.5 cortado a mitad → se recupera de la copia', r5.estado==='ok' && r5.recuperado && r5.valor.v===1, JSON.stringify(r5));
check('A.6 y el dañado se aparta intacto, no se borra', fs.readdirSync(base).some((n)=>n.startsWith('estado.json.corrupto-')));
const g=path.join(base,'sin-copia.json');
fs.writeFileSync(g,'');
check('A.7 vacío y sin copia → «corrupto», no «vacío»', P.leerJson(g).estado==='corrupto');
const h=path.join(base,'forma.json');
fs.writeFileSync(h,'null');
check('A.8 JSON válido con otra forma (null) → no se usa', P.leerJson(h).estado==='corrupto');

console.log('\nB. Dos procesos guardando a la vez no pierden cambios\n');
const contador=path.join(base,'contador.json');
P.escribirJson(contador,{n:0});
const hijo=`
  const P=await import(${JSON.stringify(pathToFileURL(path.join(REPO,'server/persistencia.js')).href)});
  const f=${JSON.stringify(contador)};
  for(let i=0;i<150;i++) P.conCerrojoDeFichero(f,()=>{const v=P.leerJson(f).valor;v.n+=1;P.escribirJson(f,v,{bak:true});});
`;
const lanzar=()=>new Promise((res)=>{const c=spawn(process.execPath,['--input-type=module','-e',hijo],{stdio:['ignore','ignore','pipe']});
  let err='';c.stderr.on('data',(d)=>{err+=d;});c.on('exit',(code)=>res({code,err}));});
const fines=await Promise.all([lanzar(),lanzar(),lanzar()]);
check('B.1 los tres procesos terminan sin error', fines.every((x)=>x.code===0), fines.map((x)=>x.err.slice(0,120)).join(' | '));
const n=P.leerJson(contador).valor?.n;
check('B.2 ni un cambio perdido (3 × 150 = 450)', n===450, `n=${n}`);
check('B.3 no queda el cerrojo', !fs.existsSync(`${contador}.lock`));
fs.writeFileSync(`${contador}.lock`,'');
fs.utimesSync(`${contador}.lock`,new Date(Date.now()-60000),new Date(Date.now()-60000));
let tomado=false;
try{P.conCerrojoDeFichero(contador,()=>{tomado=true;},{esperaMaxMs:3000});}catch{}
check('B.4 un cerrojo abandonado por un proceso muerto no bloquea para siempre', tomado);

fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:300});
const ok=results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok===results.length?0:1);
