// ESCENARIO: las carpetas de expedientes de un despacho no son «C:\Users\x\Documentos\Casos».
// Son la raíz de una unidad mapeada (I:\), un recurso compartido (\\servidor\expedientes\), una
// carpeta de OneDrive bajo demanda, un montaje CIFS en Linux o una carpeta con tildes creada en
// otro Mac. Con cualquiera de ellas RobinSearch indexaba 0 documentos o los metaba en
// «_sin_expediente» sin decir nada.
//
// Esta prueba NO arranca el servidor: comprueba las funciones puras de rutas y de detección de red
// con las reglas de Windows SIMULADAS (path.win32), para que se ejecute igual en macOS y Linux, y
// además carga config.js de verdad sustituyendo node:path por path.win32 (lo que vería un Windows).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results=[]; const check=(n,c,d='')=>{results.push(c);console.log(`${c?'  OK  ':' FALLO'}  ${n}${d?` — ${d}`:''}`);};
const base=fs.mkdtempSync(path.join(os.tmpdir(),'rs-rutas-'));
// config.js lee el directorio de datos al importarse: nunca el del usuario de este equipo.
process.env.ROBIN_DATA_DIR=path.join(base,'datos');
delete process.env.ROBIN_FOLDERS; delete process.env.ROBIN_FOLDER; delete process.env.ROBIN_WATCHED_FOLDER;

const { crearRutas, extensionDe, tipoReal } = await import(pathToFileURL(path.join(REPO,'server/rutas.js')).href);
const net = await import(pathToFileURL(path.join(REPO,'server/net.js')).href);

// ─── 1. Windows: raíz de unidad y recurso UNC ────────────────────────────────────────────────
{
  const w = crearRutas({ path: path.win32, plataforma: 'win32' });
  // El fallo tal cual: Node deja la barra final y `raíz + sep` no casa con nada.
  check('(el fallo) con startsWith(raíz + sep) la raíz de unidad no contiene nada',
    !'I:\\Caso\\demanda.pdf'.startsWith(path.win32.resolve('I:\\') + path.win32.sep));
  check('un fichero cuelga de la raíz de unidad I:\\', w.dentroDe('I:\\Caso\\demanda.pdf','I:\\'));
  check('un fichero cuelga del recurso UNC \\\\srv\\exp\\', w.dentroDe('\\\\srv\\exp\\Caso\\demanda.pdf','\\\\srv\\exp\\'));
  check('y la raíz de sí misma', w.dentroDe('I:\\','I:\\') && w.dentroDe('\\\\srv\\exp','\\\\srv\\exp\\'));
  check('otra unidad u otro recurso NO', !w.dentroDe('J:\\Caso\\a.pdf','I:\\') && !w.dentroDe('\\\\srv\\exp2\\a.pdf','\\\\srv\\exp\\'));
  check('una carpeta hermana con el mismo prefijo NO («Caso» no contiene «Casos»)', !w.dentroDe('I:\\Casos\\a.pdf','I:\\Caso'));
  check('sin distinguir mayúsculas, como NTFS', w.dentroDe('i:\\EXPEDIENTES\\caso\\a.pdf','I:\\Expedientes'));
  check('«..» no escapa de la carpeta', !w.dentroDe('I:\\Expedientes\\..\\Otro\\a.pdf','I:\\Expedientes'));
  check('nombre lógico de la raíz de unidad = la letra', w.nombreBase('I:\\')==='I' && w.nombreBase('i:\\')==='I' && w.nombreBase('\\\\?\\C:\\')==='C', `${w.nombreBase('I:\\')}`);
  check('nombre lógico del recurso UNC = el nombre del recurso', w.nombreBase('\\\\srv\\exp\\')==='exp' && w.nombreBase('\\\\srv\\exp')==='exp');
  const roots=[{name:'I',path:'I:\\'},{name:'exp',path:'\\\\srv\\exp\\'}];
  const rl=w.rutaLogica(roots,'I:\\Pérez - Divorcio\\01 demanda.pdf');
  check('ruta lógica bajo I:\\', rl==='I/Pérez - Divorcio/01 demanda.pdf', rl);
  const rl2=w.rutaLogica(roots,'\\\\SRV\\EXP\\Acme\\anexos\\contrato.pdf');
  check('ruta lógica bajo UNC (con otra caja), conservando la escritura del fichero', rl2==='exp/Acme/anexos/contrato.pdf', rl2);
  const { expedienteForLogicalPath } = await import(pathToFileURL(path.join(REPO,'server/config.js')).href);
  check('y su expediente NO es _sin_expediente', expedienteForLogicalPath(rl,1)==='I/Pérez - Divorcio', expedienteForLogicalPath(rl,1));
  check('canonizar escribe la raíz como está configurada',
    w.canonizar([{name:'E',path:'Z:\\Expedientes'}],'z:\\expedientes\\Caso\\a.pdf')==='Z:\\Expedientes\\Caso\\a.pdf');
  check('raíz anidada: gana la más específica',
    w.raizDe([{name:'Z',path:'Z:\\'},{name:'Exp',path:'Z:\\Expedientes'}],'Z:\\Expedientes\\a.pdf')?.raiz.name==='Exp');
}

// ─── 2. macOS: caja y NFC/NFD; Linux: exacto ─────────────────────────────────────────────────
{
  const m = crearRutas({ path: path.posix, plataforma: 'darwin' });
  const nfd='Pe\u0301rez', nfc='P\u00e9rez';
  check('macOS: la carpeta en NFD está dentro de la configurada en NFC y con otra caja',
    m.dentroDe(`/Users/x/Expedientes/${nfd}/a.pdf`,`/users/x/expedientes/${nfc}`));
  check('filtro de subcarpeta sin caja ni forma Unicode',
    m.bajoPrefijoLogico(`Expedientes/${nfd}/Prueba/a.pdf`,`expedientes/${nfc.toLowerCase()}/prueba`));
  check('y no confunde «Pérez» con «Pérez - Divorcio»', !m.bajoPrefijoLogico(`Expedientes/${nfc} - Divorcio/a.pdf`,`Expedientes/${nfc}`));
  const l = crearRutas({ path: path.posix, plataforma: 'linux' });
  check('Linux distingue mayúsculas (dos carpetas distintas en ext4)', !l.dentroDe('/home/a/exp/x.pdf','/home/a/Exp'));
  check('Linux: una «\\» es parte del nombre, no un separador', l.rutaLogica([{name:'E',path:'/e'}],'/e/a\\b.pdf')==='E/a\\b.pdf');
  check('extensión con espacio final: «demanda.pdf » es un PDF', extensionDe('demanda.pdf ')==='.pdf' && extensionDe('ACTA.PDF')==='.pdf');
}

// ─── 3. OneDrive/SharePoint bajo demanda: libuv marca la entrada como enlace ─────────────────
{
  const d=path.join(base,'nube'); fs.mkdirSync(path.join(d,'Caso'),{recursive:true});
  fs.writeFileSync(path.join(d,'demanda.pdf'),'x');
  const comoWindows=(name)=>({name,isFile:()=>false,isDirectory:()=>false,isSymbolicLink:()=>true});
  check('un fichero con «reparse point» (visto como enlace) se reconoce como fichero',
    tipoReal(path.join(d,'demanda.pdf'),comoWindows('demanda.pdf'))==='fichero');
  check('y una carpeta (junction de OneDrive) como carpeta',
    tipoReal(path.join(d,'Caso'),comoWindows('Caso'))==='carpeta');
  const cuenta={no_descargados:0,enlaces_inaccesibles:0,bucles_evitados:0};
  check('un enlace que no lleva a nada se cuenta, no se calla',
    tipoReal(path.join(d,'no-existe'),comoWindows('no-existe'),cuenta)===null && cuenta.enlaces_inaccesibles===1);
}

// ─── 4. Linux y Mac: montajes de red ─────────────────────────────────────────────────────────
{
  const linux=[
    'sysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)',
    '/dev/nvme0n1p2 on / type ext4 (rw,relatime)',
    '//srv-despacho/expedientes on /mnt/expedientes type cifs (rw,relatime,vers=3.1.1,cache=strict)',
    'nas:/export/casos on /mnt/casos type nfs4 (rw,relatime,vers=4.2)',
    'abogado@srv:/datos on /home/abogado/remoto type fuse.sshfs (rw,nosuid,nodev,relatime)',
    'gvfsd-fuse on /run/user/1000/gvfs type fuse.gvfsd-fuse (rw,nosuid,nodev,relatime)',
    'portal on /run/user/1000/doc type fuse.portal (rw,nosuid,nodev,relatime)',
    '//nas/Casos Viejos on /mnt/Casos Viejos type smb3 (rw)',
  ].join('\n');
  const ml=net.parsearMount(linux);
  check('Linux: `mount` con «type cifs/nfs4/fuse.sshfs/smb3» se reconoce como red',
    ['/mnt/expedientes','/mnt/casos','/home/abogado/remoto','/run/user/1000/gvfs','/mnt/Casos Viejos'].every(x=>ml.includes(x)), JSON.stringify(ml));
  check('Linux: los discos locales y el portal de Flatpak NO', !ml.includes('/') && !ml.includes('/sys') && !ml.includes('/run/user/1000/doc'));
  const mac=net.parsearMount([
    '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
    '//usuario@srv-despacho/Expedientes on /Volumes/Expedientes (smbfs, nodev, nosuid, mounted by usuario)',
    'srv:/casos on /Volumes/casos (nfs, nodev, nosuid)',
  ].join('\n'));
  check('macOS: el formato de siempre sigue funcionando', mac.length===2 && mac.includes('/Volumes/Expedientes') && mac.includes('/Volumes/casos'), JSON.stringify(mac));
  const info=net.parsearMountinfo([
    '22 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw',
    '98 22 0:51 / /mnt/Casos\\040del\\040despacho rw,relatime shared:50 - cifs //srv/casos rw,vers=3.1.1',
    '99 22 0:52 / /media/nas rw,relatime shared:51 - 9p nas rw',
  ].join('\n'));
  check('/proc/self/mountinfo: tipo tras « - » y espacios escapados (\\040)',
    info.length===2 && info.includes('/mnt/Casos del despacho') && info.includes('/media/nas'), JSON.stringify(info));
  check('GVFS de GNOME (smb://) se reconoce por su ruta', net.esRutaGvfs('/run/user/1000/gvfs/smb-share:server=srv,share=exp/Caso') && !net.esRutaGvfs('/run/user/1000/doc'));
}

// ─── 5. config.js REAL con las reglas de Windows (node:path → path.win32) ───────────────────
// Así lo reprodujo la auditoría: un gancho de carga que sustituye node:path. Se ejecuta en un
// proceso aparte para no contaminar este.
{
  const ganchos=`export async function resolve(spec, ctx, next) {
    if ((spec === 'node:path' || spec === 'path') && !String(ctx.parentURL || '').startsWith('data:')) {
      const src = 'import p from "node:path"; const w = p.win32; export default w; export const { resolve, join, relative, basename, dirname, extname, isAbsolute, sep, delimiter, parse, format, normalize, toNamespacedPath } = w; export const posix = p.posix; export const win32 = p.win32;';
      return { url: 'data:text/javascript,' + encodeURIComponent(src), shortCircuit: true };
    }
    return next(spec, ctx);
  }`;
  const hijo=path.join(base,'win32.mjs');
  fs.writeFileSync(hijo,`import { register } from 'node:module';
    register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(ganchos)}));
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const cfg = await import(${JSON.stringify(pathToFileURL(path.join(REPO,'server/config.js')).href)});
    const out = {
      roots: cfg.config.roots.map((r) => ({ name: r.name, path: r.path })),
      raiz: cfg.rootForPath('I:\\\\Pérez - Divorcio\\\\demanda.pdf')?.name ?? null,
      logica: cfg.logicalPath('I:\\\\Pérez - Divorcio\\\\demanda.pdf'),
      expediente: cfg.expedienteForPath('I:\\\\Pérez - Divorcio\\\\demanda.pdf'),
      uncExpediente: cfg.expedienteForPath('\\\\\\\\SRV-DESPACHO\\\\Expedientes\\\\Acme\\\\anexo.pdf'),
      fuera: cfg.rootForPath('J:\\\\otro.pdf'),
    };
    process.stdout.write(JSON.stringify(out));`);
  const r=await new Promise((res)=>{
    const c=spawn(process.execPath,[hijo],{env:{...process.env,
      ROBIN_FOLDERS:'I:\\;\\\\srv-despacho\\expedientes\\', ROBIN_DATA_DIR:'C:\\RobinDatos', APPDATA:'C:\\AppData'},
      stdio:['ignore','pipe','pipe'], cwd:base});
    let o='',e=''; c.stdout.on('data',d=>o+=d); c.stderr.on('data',d=>e+=d);
    const t=setTimeout(()=>c.kill('SIGKILL'),30000);
    c.on('exit',()=>{clearTimeout(t);res({o,e});});
  });
  let d=null; try{ d=JSON.parse(r.o); }catch{ /* abajo */ }
  check('config.js (Windows simulado) nombra «I» a la raíz de unidad y «expedientes» al recurso',
    d && d.roots[0]?.name==='I' && d.roots[1]?.name==='expedientes', d?JSON.stringify(d.roots):r.e.slice(-400));
  check('y el documento de I:\\ tiene raíz y expediente (no _sin_expediente)',
    d && d.raiz==='I' && d.logica==='I/Pérez - Divorcio/demanda.pdf' && d.expediente==='I/Pérez - Divorcio', d?JSON.stringify(d):'');
  check('y el del recurso UNC, escrito con otra caja, también',
    d && d.uncExpediente==='expedientes/Acme', d?.uncExpediente);
  check('lo de otra unidad no es de ninguna carpeta', d && d.fuera===null);
}

const fallos=results.filter(r=>!r).length;
console.log(`\n${results.length-fallos}/${results.length} comprobaciones OK`);
if(fallos) process.exitCode=1;
fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:300});
