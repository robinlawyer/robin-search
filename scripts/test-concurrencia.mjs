// ESCENARIO: lo que pasa cuando dos instancias, el reloj o el disco no se portan bien.
//
//   A. Un reindexado que FALLA al leer el fichero no borra del índice la versión anterior (hasta
//      la 1.4.7 el documento desaparecía: se borraba antes de extraer).
//   B. Cerrojo de escritor robado a un dueño vivo (equipo en suspensión, proceso parado >2 min):
//      el primero se da cuenta por el token, pasa a solo buscar y no pisa a la otra; si la otra
//      desaparece, vuelve a tomar el relevo.
//   C. Cerrojo con fecha «del futuro» (reloj hacia atrás) y pid vivo: caduca igual.
//   D. Canal de control con el nombre ocupado: iniciarControl no se queda colgado.
//   E. Aviso técnico: dos procesos anotando a la vez en diagnostico.json no pierden cuentas.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// fileURLToPath y no `.pathname`: en Windows da «/C:/…» y en cualquier SO rompe con espacios o tildes.
const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (n, c, d = '') => {
  results.push(c);
  console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const conTope = (p, ms) => Promise.race([p, espera(ms).then(() => null)]);
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-concurrencia-'));

function servidor({ madre, datos, env = {} }) {
  const c = spawn(process.execPath, [path.join(REPO, 'server/index.js')], {
    env: {
      ...process.env,
      ROBIN_TOKEN: 't',
      ROBIN_FOLDERS: madre,
      ROBIN_DATA_DIR: datos,
      ROBIN_OCR: 'false',
      ROBIN_LOG_LEVEL: 'info',
      ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no',
      ROBIN_DIAGNOSTICO_URL: 'off',
      ROBIN_NO_BROWSER: '1',
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const w = new Map();
  let id = 1;
  c.stderr.on('data', () => {});
  c.stdin.on('error', () => {});
  c.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!l) continue;
      let m;
      try {
        m = JSON.parse(l);
      } catch {
        continue;
      }
      const f = w.get(m.id);
      if (f) {
        w.delete(m.id);
        f(m);
      }
    }
  });
  const salida = new Promise((r) => c.on('exit', (code, signal) => r({ code, signal })));
  const rpc = (method, params) =>
    new Promise((res, rej) => {
      const i = id++;
      const t = setTimeout(() => rej(new Error(`timeout ${method}`)), 180000);
      w.set(i, (m) => {
        clearTimeout(t);
        res(m);
      });
      c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`);
    });
  const call = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    const t = r.result?.content?.[0]?.text;
    let data = null;
    try {
      data = t ? JSON.parse(t) : null;
    } catch {
      data = null;
    }
    return { isError: Boolean(r.result?.isError), data, raw: t || '' };
  };
  return { proc: c, call, salida };
}

async function esperarFin(call, intentos = 120) {
  for (let i = 0; i < intentos; i++) {
    const e = await call('estado_servidor');
    if (e.data && e.data.estado !== 'indexando' && e.data.ultimo_indexado) return e.data;
    await espera(1000);
  }
  return (await call('estado_servidor')).data;
}

const leerLog = (datos) => {
  try {
    return fs.readFileSync(path.join(datos, 'logs', 'robin-search.log'), 'utf8');
  } catch {
    return '';
  }
};
async function esperarLog(datos, re, ms) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (re.test(leerLog(datos))) return true;
    await espera(300);
  }
  return re.test(leerLog(datos));
}
async function parar(s) {
  if (process.platform === 'win32') s.proc.stdin.end();
  else s.proc.kill('SIGTERM');
  const r = await conTope(s.salida, 10000);
  if (!r) {
    try {
      s.proc.kill('SIGKILL');
    } catch {
      /* ya murió */
    }
    await conTope(s.salida, 5000);
  }
}

// Un .docx mínimo pero válido (mammoth lo lee), generado aquí para no depender de ficheros.
async function docx(ruta, texto) {
  const AdmZip = (await import(pathToFileURL(path.join(REPO, 'node_modules', 'adm-zip', 'adm-zip.js')).href)).default;
  const z = new AdmZip();
  z.addFile(
    '[Content_Types].xml',
    Buffer.from(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
  );
  z.addFile(
    '_rels/.rels',
    Buffer.from(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
  );
  z.addFile(
    'word/document.xml',
    Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${texto}</w:t></w:r></w:p></w:body></w:document>`),
  );
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, z.toBuffer());
}

// ───────────────────────── A. Reindexado que falla ─────────────────────────
console.log('\nA. Un reindexado que falla no borra la versión anterior\n');
const madreA = path.join(base, 'A', 'Expedientes');
const contrato = path.join(madreA, 'Caso Local', 'contrato.docx');
await docx(contrato, 'Contrato de arrendamiento de local de negocio con opción de compra');
fs.writeFileSync(path.join(madreA, 'Caso Local', 'nota.txt'), 'Nota sobre la fianza.');
const datosA = path.join(base, 'datosA');
let s = servidor({ madre: madreA, datos: datosA });
let e = await esperarFin(s.call);
check('A.0 indexa los 2 documentos', e?.documentos_indexados === 2, `docs=${e?.documentos_indexados}`);
const buscar = () => s.call('buscar_documentos', { query: 'arrendamiento de local con opción de compra', expediente: 'Expedientes/Caso Local' });
let b = await buscar();
check('A.1 el contrato se encuentra', b.data?.fragmentos?.[0]?.fichero === 'contrato.docx', b.raw.slice(0, 80));
// Se estropea el fichero (a medio guardar, o Word lo tiene a medias) y se reindexa a mano.
fs.writeFileSync(contrato, 'esto ya no es un docx');
const futuro = new Date(Date.now() + 5000);
fs.utimesSync(contrato, futuro, futuro);
const idx = await s.call('indexar_carpeta', { forzar: true });
check('A.2 el reindexado da el error del fichero', idx.data?.errores === 1, `errores=${idx.data?.errores}`);
b = await buscar();
check('A.3 y la versión anterior SIGUE en el índice (antes desaparecía)', b.data?.fragmentos?.[0]?.fichero === 'contrato.docx', b.raw.slice(0, 80));
await docx(contrato, 'Contrato de compraventa de maquinaria industrial');
const futuro2 = new Date(Date.now() + 10000);
fs.utimesSync(contrato, futuro2, futuro2);
await s.call('indexar_carpeta', {});
const b2 = await s.call('buscar_documentos', { query: 'compraventa de maquinaria industrial', expediente: 'Expedientes/Caso Local' });
const frag = b2.data?.fragmentos?.find((f) => f.fichero === 'contrato.docx');
check('A.4 arreglado el fichero, el documento se SUSTITUYE (sin restos del texto viejo)', Boolean(frag) && /maquinaria/.test(frag.texto || JSON.stringify(frag)) && !/arrendamiento/.test(JSON.stringify(b2.data)), JSON.stringify(frag || {}).slice(0, 90));
e = (await s.call('estado_servidor')).data;
check('A.5 el índice sigue con 2 documentos', e?.documentos_indexados === 2 && e?.fragmentos_totales === 2, `docs=${e?.documentos_indexados} frag=${e?.fragmentos_totales}`);
await parar(s);

// ───────────────────────── B. Cerrojo robado a un dueño vivo ─────────────────────────
console.log('\nB. Otra instancia se queda con el cerrojo mientras la primera estaba parada\n');
const madreB = path.join(base, 'B', 'Expedientes');
fs.mkdirSync(path.join(madreB, 'Caso'), { recursive: true });
fs.writeFileSync(path.join(madreB, 'Caso', 'a.txt'), 'Demanda de desahucio por falta de pago.');
const datosB = path.join(base, 'datosB');
s = servidor({ madre: madreB, datos: datosB, env: { ROBIN_ESCRITOR_RENUEVO_MS: '500' } });
await esperarFin(s.call);
const lock = path.join(datosB, 'escritor.lock');
const propio = JSON.parse(fs.readFileSync(lock, 'utf8'));
check('B.0 el cerrojo lleva token', typeof propio.token === 'string' && propio.token.length >= 16);
// «La otra instancia»: este mismo proceso de prueba (pid vivo) con otro token.
fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'token-de-la-otra-instancia' }));
check('B.1 la primera se da cuenta y pasa a solo buscar', await esperarLog(datosB, /esta pasa a solo buscar/, 10000));
await espera(1500);
check('B.2 y no vuelve a escribir el cerrojo encima de la otra', JSON.parse(fs.readFileSync(lock, 'utf8')).token === 'token-de-la-otra-instancia');
fs.writeFileSync(path.join(madreB, 'Caso', 'b.txt'), 'Escrito nuevo que NO debe indexar quien ya no escribe.');
await espera(4000);
const eB = (await s.call('estado_servidor')).data;
check('B.3 no indexa lo nuevo (lo haría encima de la otra)', eB?.documentos_indexados === 1, `docs=${eB?.documentos_indexados}`);
check('B.4 y sigue atendiendo búsquedas', (await s.call('buscar_documentos', { query: 'desahucio', expediente: 'Expedientes/Caso' })).data?.fragmentos?.length > 0);
// La otra instancia desaparece: vuelve a tomar el relevo.
fs.rmSync(lock, { force: true });
check('B.5 si la otra suelta el cerrojo, vuelve a tomar el relevo', await esperarLog(datosB, /toma el relevo del índice/, 20000));
let eB2 = null;
for (let i = 0; i < 30; i++) {
  eB2 = (await s.call('estado_servidor')).data;
  if (eB2?.documentos_indexados === 2 && eB2.estado !== 'indexando') break;
  await espera(1000);
}
check('B.6 y entonces indexa lo pendiente', eB2?.documentos_indexados === 2, `docs=${eB2?.documentos_indexados}`);
await parar(s);

// ───────────────────────── C. Cerrojo con fecha del futuro ─────────────────────────
console.log('\nC. Cerrojo con fecha del futuro (reloj hacia atrás) y pid vivo\n');
const datosC = path.join(base, 'datosC');
fs.mkdirSync(datosC, { recursive: true });
const lockC = path.join(datosC, 'escritor.lock');
fs.writeFileSync(lockC, JSON.stringify({ pid: process.pid, token: 'reloj-adelantado' }));
const manana = new Date(Date.now() + 24 * 3600 * 1000);
fs.utimesSync(lockC, manana, manana);
s = servidor({ madre: madreB, datos: datosC, env: { ROBIN_ESCRITOR_CADUCIDAD_MS: '4000' } });
check('C.1 al arrancar respeta el cerrojo (pid vivo)', await esperarLog(datosC, /Otra instancia de RobinSearch tiene el índice/, 30000));
check('C.2 pero caduca aunque su fecha sea del futuro (antes: bloqueado para siempre)', await esperarLog(datosC, /toma el relevo del índice/, 30000));
await parar(s);

// ───────────────────────── D. Canal de control con el nombre ocupado ─────────────────────────
console.log('\nD. Canal de control con el nombre ocupado\n');
if (process.platform === 'win32') {
  check('D.1 (solo en Mac/Linux: en Windows la tubería no deja un fichero que ocupar)', true);
} else {
  const datosD = path.join(base, 'datosD');
  const prog = `
const c = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'server/control.js')).href)});
const fs = await import('node:fs');
const ruta = c.rutaCanal();
fs.rmSync(ruta, { recursive: true, force: true });
fs.mkdirSync(ruta);
fs.writeFileSync(ruta + '/ocupado', 'x'); // un directorio NO vacío: ni se borra ni se puede escuchar
const t = setTimeout(() => { console.log('COLGADO'); process.exit(3); }, 8000);
const r = await c.iniciarControl();
clearTimeout(t);
fs.rmSync(ruta, { recursive: true, force: true });
console.log(r === null ? 'NULL' : 'RUTA');
process.exit(0);`;
  let out = '';
  try {
    out = execFileSync(process.execPath, ['--input-type=module', '-e', prog], {
      env: { ...process.env, ROBIN_DATA_DIR: datosD, ROBIN_FOLDERS: madreB, ROBIN_LOG_LEVEL: 'error' },
    }).toString();
  } catch (err) {
    out = String(err.stdout || err.message);
  }
  check('D.1 iniciarControl responde (null) en vez de quedarse colgado', /NULL/.test(out), out.trim());
}

// ───────────────────────── E. diagnostico.json con dos procesos ─────────────────────────
console.log('\nE. Dos procesos anotando caídas a la vez no pierden cuentas\n');
{
  const datosE = path.join(base, 'datosE');
  fs.mkdirSync(datosE, { recursive: true });
  const N = 40;
  // Cada hijo deja N marcas de caída de pids inexistentes y las reclama: el total contado tiene
  // que ser exactamente 2N.
  const prog = (desde) => `
const fs = await import('node:fs'); const path = await import('node:path');
const d = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'server/diagnostico.js')).href)});
const dir = ${JSON.stringify(datosE)};
for (let i = 0; i < ${N}; i++) {
  const pid = ${desde} + i;
  fs.writeFileSync(path.join(dir, 'en_curso-' + pid + '.json'), JSON.stringify({ pid, fase: 'indexando', t: new Date().toISOString() }));
  d.revisarCaidaAnterior();
}`;
  const hijo = (desde) =>
    new Promise((r) => {
      const c = spawn(process.execPath, ['--input-type=module', '-e', prog(desde)], {
        env: { ...process.env, ROBIN_DATA_DIR: datosE, ROBIN_FOLDERS: madreB, ROBIN_LOG_LEVEL: 'error' },
        stdio: 'ignore',
      });
      c.on('exit', r);
    });
  // pids muy altos: no existen en ningún sistema.
  await Promise.all([hijo(3_900_000), hijo(3_950_000)]);
  const est = JSON.parse(fs.readFileSync(path.join(datosE, 'diagnostico.json'), 'utf8'));
  check('E.1 se cuentan TODAS las caídas (sin cerrojo se perdían al pisarse)', est.caidasSeguidas === 2 * N, `caidasSeguidas=${est.caidasSeguidas}`);
  check('E.2 y no quedan temporales ni cerrojos', !fs.readdirSync(datosE).some((n) => n.endsWith('.tmp') || n.endsWith('.lock')));
}

fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const okN = results.filter(Boolean).length;
console.log(`\n${okN}/${results.length} comprobaciones OK`);
process.exit(okN === results.length ? 0 : 1);
