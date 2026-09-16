// ESCENARIO: un despacho con MUCHOS documentos, y buena parte en la unidad de red. Nada de lo que
// hace RobinSearch puede dejar a Claude sin respuesta tanto rato que corte la llamada.
//
//   A. Una búsqueda sobre todo el índice suelta el proceso (antes: 15 s sin atender a nada con
//      5.000 documentos).
//   B. Un documento con miles de fragmentos se lee por líneas y entero.
//   C. Abrir un expediente en red con muchos ficheros responde en segundos: el re-escaneo sigue
//      en segundo plano y estado_servidor enseña el progreso (antes: la tool duraba horas).
//   D. indexar_carpeta con un indexado en marcha se ENCOLA en vez de lanzar otro encima.
//   E. El re-escaneo periódico no encola pasadas detrás de una que no ha terminado.
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
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-escala-'));

// ───────────────────────── A y B. Índice grande sintético ─────────────────────────
console.log('\nA. Búsqueda sobre un índice grande\n');
{
  const datos = path.join(base, 'datosA');
  const N = Number(process.env.ROBIN_PRUEBA_ESCALA_DOCS) || 1500;
  const storeUrl = JSON.stringify(pathToFileURL(path.join(REPO, 'server/search/store.js')).href);
  const env = { ...process.env, ROBIN_DATA_DIR: datos, ROBIN_LOG_LEVEL: 'error' };
  // 1) Se escribe el índice (proceso aparte).
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
const store = await import(${storeUrl});
await store.abrir({ migrar: false });
let semilla = 7;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
for (let d = 0; d < ${N}; d++) {
  const id = 'doc' + String(d).padStart(6, '0');
  const chunks = [];
  for (let c = 0; c < 4; c++) chunks.push({ chunkId: c, vector: Array.from({ length: 384 }, azar), metadata: { texto: 'fragmento ' + d + '-' + c, fichero: id + '.txt', rutaRelativa: 'E/Caso/' + id + '.txt', expediente: 'E/Caso' } });
  await store.reemplazarDoc(id, chunks);
}
// Un documento con MUCHOS fragmentos (B).
const grande = [];
for (let c = 0; c < 6000; c++) grande.push({ chunkId: c, vector: Array.from({ length: 384 }, azar), metadata: { texto: 'x'.repeat(1500) + ' fragmento ' + c, fichero: 'tomo.txt', rutaRelativa: 'E/Caso/tomo.txt', expediente: 'E/Caso' } });
await store.reemplazarDoc('tomo', grande);`,
    ],
    { env, stdio: 'inherit' },
  );
  // 2) Se busca en un proceso NUEVO (vectores fríos, leídos del disco) midiendo cuánto llega a
  //    estar el proceso sin atender a un temporizador.
  const out = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
const store = await import(${storeUrl});
await store.abrir({ migrar: false });
let maxRetraso = 0; let previo = Date.now();
const vigia = setInterval(() => { const a = Date.now(); maxRetraso = Math.max(maxRetraso, a - previo - 10); previo = a; }, 10);
const t0 = Date.now();
const q = Array.from({ length: 384 }, (_, i) => Math.sin(i));
const r = await store.query(q, 5);
const ms = Date.now() - t0;
await new Promise((r) => setTimeout(r, 50)); // que el vigía llegue a ver el último hueco
clearInterval(vigia);
const trozos = await store.getDocChunks('tomo');
console.log(JSON.stringify({ ms, maxRetraso, n: r.length, docs: store.resumen().documentos, tomo: trozos.length, ultimo: trozos[trozos.length - 1]?.chunkId }));`,
    ],
    { env },
  ).toString();
  const x = JSON.parse(out.trim().split('\n').pop());
  check('A.1 la búsqueda devuelve resultados sobre todo el índice', x.n === 5 && x.docs === N + 1, JSON.stringify(x));
  check('A.2 y suelta el proceso mientras tanto (máx. sin atender < 120 ms)', x.maxRetraso < 120, `búsqueda ${x.ms} ms, máx. sin atender ${x.maxRetraso} ms`);
  check('B.1 un documento de 6.000 fragmentos (≈9 MB de texto) se lee entero y en orden', x.tomo === 6000 && x.ultimo === 5999, `${x.tomo}`);
}

// ───────────────────────── C, D, E. Servidor con carpeta de red grande ─────────────────────────
function servidor(env) {
  const c = spawn(process.execPath, [path.join(REPO, 'server/index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
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

console.log('\nC. Abrir un expediente en red con muchos ficheros\n');
{
  const madre = path.join(base, 'Unidad Z', 'Expedientes');
  const caso = path.join(madre, 'Caso Grande');
  fs.mkdirSync(caso, { recursive: true });
  fs.writeFileSync(path.join(caso, '000 inicio.txt'), 'Escrito inicial del procedimiento.');
  const datos = path.join(base, 'datosC');
  const s = servidor({
    ...process.env,
    ROBIN_TOKEN: 't',
    ROBIN_FOLDERS: madre,
    ROBIN_NETWORK_PATHS: madre,
    ROBIN_RESCAN_MS: '0',
    ROBIN_ESPERA_REESCANEO_MS: '500',
    ROBIN_DATA_DIR: datos,
    ROBIN_OCR: 'false',
    ROBIN_LOG_LEVEL: 'info',
    ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no',
    ROBIN_DIAGNOSTICO_URL: 'off',
  });
  for (let i = 0; i < 120; i++) {
    const e = await s.call('estado_servidor');
    if (e.data?.ultimo_indexado && e.data.estado !== 'indexando') break;
    await espera(1000);
  }
  // Un compañero deja 120 escritos nuevos en el expediente desde su equipo.
  const NUEVOS = 120;
  for (let i = 1; i <= NUEVOS; i++) {
    fs.writeFileSync(path.join(caso, `${String(i).padStart(3, '0')} escrito.txt`), `Escrito número ${i} del procedimiento sobre la liquidación de la sociedad de gananciales, con alegaciones y petición de prueba pericial contable.`);
  }
  const t0 = Date.now();
  const fijar = await s.call('establecer_expediente_activo', { expediente: 'Caso Grande' });
  const msFijar = Date.now() - t0;
  check('C.1 responde en segundos aunque el re-escaneo no haya terminado', !fijar.isError && msFijar < 8000 && fijar.data?.actualizandose === true, `${msFijar} ms, ${fijar.raw.slice(0, 90)}`);
  const e1 = (await s.call('estado_servidor')).data;
  check('C.2 estado_servidor enseña el progreso mientras tanto', e1?.estado === 'indexando' && Number.isFinite(e1?.progreso?.total), JSON.stringify(e1?.progreso || {}).slice(0, 100));

  console.log('\nD. indexar_carpeta con un indexado en marcha\n');
  const idx = await s.call('indexar_carpeta', { expediente: 'Caso Grande' });
  check('D.1 se encola en vez de lanzar un segundo indexado encima', idx.data?.encolado === true, idx.raw.slice(0, 90));
  let fin = null;
  for (let i = 0; i < 240; i++) {
    const e = (await s.call('estado_servidor')).data;
    if (e?.documentos_indexados === NUEVOS + 1 && e.estado !== 'indexando') {
      fin = e;
      break;
    }
    await espera(1000);
  }
  check('C.3 y al terminar están todos', fin?.documentos_indexados === NUEVOS + 1, `docs=${fin?.documentos_indexados}`);
  await espera(2000);
  const log = fs.readFileSync(path.join(datos, 'logs', 'robin-search.log'), 'utf8');
  check('D.2 lo encolado se ejecutó después, no a la vez', /Indexado en cola \(indexar_carpeta\) completado/.test(log));
  s.proc.kill('SIGTERM');
  if (process.platform === 'win32') s.proc.stdin.end();
  await Promise.race([s.salida, espera(10000)]);
}

console.log('\nE. El re-escaneo periódico no se amontona\n');
{
  const madre = path.join(base, 'Unidad Y', 'Expedientes');
  const caso = path.join(madre, 'Caso');
  fs.mkdirSync(caso, { recursive: true });
  fs.writeFileSync(path.join(caso, 'inicio.txt'), 'Demanda ejecutiva.');
  const datos = path.join(base, 'datosE');
  const s = servidor({
    ...process.env,
    ROBIN_TOKEN: 't',
    ROBIN_FOLDERS: madre,
    ROBIN_NETWORK_PATHS: madre,
    ROBIN_RESCAN_MS: '200',
    ROBIN_DATA_DIR: datos,
    ROBIN_OCR: 'false',
    ROBIN_LOG_LEVEL: 'info',
    ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no',
    ROBIN_DIAGNOSTICO_URL: 'off',
  });
  for (let i = 0; i < 120; i++) {
    const e = await s.call('estado_servidor');
    if (e.data?.ultimo_indexado && e.data.estado !== 'indexando') break;
    await espera(1000);
  }
  // Llegan 80 ficheros: la siguiente pasada tarda varios segundos, y mientras tanto el
  // temporizador de 200 ms salta decenas de veces.
  for (let i = 0; i < 80; i++) fs.writeFileSync(path.join(caso, `${i} nota.txt`), `Nota ${i} sobre la ejecución hipotecaria y la tasación del inmueble.`);
  for (let i = 0; i < 180; i++) {
    const e = await s.call('estado_servidor');
    if (e.data?.documentos_indexados === 81 && e.data.estado !== 'indexando') break;
    await espera(1000);
  }
  await espera(4000);
  s.proc.kill('SIGTERM');
  if (process.platform === 'win32') s.proc.stdin.end();
  await Promise.race([s.salida, espera(10000)]);
  // Pasadas terminadas por segundo: con el temporizador a 200 ms salen como mucho ~5 por segundo.
  // Si se encolaran, al acabar la pasada larga saldría de golpe una por cada disparo atrasado.
  const tiempos = fs
    .readFileSync(path.join(datos, 'logs', 'robin-search.log'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('"msg":"Indexado completado"'))
    .map((l) => Date.parse(JSON.parse(l).t));
  let maxPorSegundo = 0;
  for (let i = 0, j = 0; i < tiempos.length; i++) {
    while (tiempos[i] - tiempos[j] >= 1000) j += 1;
    maxPorSegundo = Math.max(maxPorSegundo, i - j + 1);
  }
  check('E.1 tras una pasada larga no se vacía una cola de pasadas atrasadas', tiempos.length > 3 && maxPorSegundo <= 8, `máx. ${maxPorSegundo} pasadas en 1 s (de ${tiempos.length})`);
}

fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const okN = results.filter(Boolean).length;
console.log(`\n${okN}/${results.length} comprobaciones OK`);
process.exit(okN === results.length ? 0 : 1);
