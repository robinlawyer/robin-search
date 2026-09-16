// ESCENARIO: indexar deprisa sin cambiar NADA de lo que se encuentra ni dejar a Claude sin respuesta.
//
//   A. Los hilos de embedding arrancan y dan vectores IDÉNTICOS (bit a bit) a los del hilo
//      principal: los índices que ya tienen los despachos siguen valiendo sin reindexar.
//   B. Un hilo que muere a mitad de un lote (como una memoria agotada): el lote se repite en otro
//      hilo, el resultado es el mismo y el pool sigue en hilos.
//   C. Un texto que tumba el motor SIEMPRE: falla solo ese documento; lo demás sigue calculándose.
//   D. Si los hilos no arrancan, se vuelve al hilo principal (nunca peor que antes de los hilos).
//   E. Con un indexado en marcha, el servidor MCP contesta enseguida (antes: un lote de 16
//      fragmentos bloqueaba el proceso entero varios segundos), el progreso sale en
//      estado_servidor y al final se busca con normalidad.
//   F. Ficheros repetidos en expedientes distintos: el segundo reutiliza los vectores del primero,
//      pero es SU documento, con SU expediente: buscando en uno no sale la ruta del otro.
//
// Tiempos acotados con topes propios (no hay `timeout` en todos los sistemas).
import { spawn } from 'node:child_process';
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
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-velocidad-'));
const borrar = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });

// Ejecuta un guion ESM en un proceso aparte (el pool es único por proceso) y devuelve la última
// línea JSON que escriba. Con tope: un proceso colgado no cuelga la prueba.
function guion(codigo, env = {}, topeMs = 240000) {
  return new Promise((resolve) => {
    const hijo = spawn(process.execPath, ['--input-type=module', '-e', codigo], {
      env: { ...process.env, ROBIN_DATA_DIR: path.join(base, 'datos-guion'), ROBIN_LOG_LEVEL: 'error', ROBIN_DIAGNOSTICO_URL: 'off', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    hijo.stdout.on('data', (d) => (out += d));
    hijo.stderr.on('data', (d) => (err += d));
    const tope = setTimeout(() => hijo.kill('SIGKILL'), topeMs);
    hijo.on('exit', (code, signal) => {
      clearTimeout(tope);
      const linea = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
      let datos = null;
      try {
        datos = linea ? JSON.parse(linea) : null;
      } catch {
        datos = null;
      }
      resolve({ code, signal, datos, err: err.slice(-2000) });
    });
  });
}

const EMB = JSON.stringify(pathToFileURL(path.join(REPO, 'server/embedder/embedder.js')).href);
// Textos cortos (rápido en CI) y más de 16, para que haya varios lotes calculándose a la vez.
const CALCULO = `
import crypto from 'node:crypto';
const e = await import(${EMB});
const frases = Array.from({ length: 22 }, (_, i) => 'Escrito ' + i + ': la parte actora reclama el pago de ' + (i * 137) + ' euros más intereses.');
await e.warmup();
const v = await e.embedPassages(frases);
const q = await e.embedQuery('reclamación de cantidad');
const h = crypto.createHash('sha256');
for (const x of v) h.update(Buffer.from(x.buffer, x.byteOffset, x.byteLength));
h.update(Buffer.from(q.buffer, q.byteOffset, q.byteLength));
let veneno = null;
if (process.env.PROBAR_VENENO) {
  try { await e.embedPassages(['VENENO en este texto']); veneno = 'calculado'; } catch (err) { veneno = err.code || String(err); }
  const w = await e.embedPassages(frases.slice(0, 3));
  veneno += '|despues:' + w.length;
}
console.log(JSON.stringify({ hash: h.digest('hex'), n: v.length, dim: v[0].length, calculo: e.estadoMotor().calculo, veneno }));
process.exit(0);
`;

// ───────────────────────── A–D. Pool de hilos ─────────────────────────
console.log('\nA–D. Hilos de embedding\n');
const principal = await guion(CALCULO, { ROBIN_EMBED_HILOS: '0' });
const hilos = await guion(CALCULO, { ROBIN_EMBED_HILOS: '2' });
check('A. hilo principal calcula (referencia)', principal.datos?.n === 22 && principal.datos?.dim === 384, principal.datos ? JSON.stringify(principal.datos.calculo) : principal.err);
check('A. los hilos arrancan', hilos.datos?.calculo?.modo === 'hilos' && hilos.datos.calculo.hilos >= 1, JSON.stringify(hilos.datos?.calculo ?? hilos.err));
check('A. vectores idénticos bit a bit con y sin hilos', Boolean(principal.datos?.hash) && hilos.datos?.hash === principal.datos.hash);

const marcaMuerte = path.join(base, 'murio-un-hilo');
const caida = await guion(CALCULO, { ROBIN_EMBED_HILOS: '2', ROBIN_PRUEBA_HILO_MUERE_UNA_VEZ: marcaMuerte });
check('B. un hilo murió a mitad de un lote', fs.existsSync(marcaMuerte) && (caida.datos?.calculo?.hilos_caidos ?? 0) >= 1, JSON.stringify(caida.datos?.calculo ?? caida.err));
check('B. su lote se repitió y el resultado es el mismo', caida.datos?.hash === principal.datos?.hash);
check('B. el pool sigue en hilos tras reponer el hilo', caida.datos?.calculo?.modo === 'hilos');

const veneno = await guion(CALCULO, { ROBIN_EMBED_HILOS: '1', ROBIN_PRUEBA_HILO_MUERE_CON: 'VENENO', PROBAR_VENENO: '1' });
check('C. el texto que tumba el motor falla solo él', /^ROBIN_EMBEDDING_CAIDO\|despues:3$/.test(veneno.datos?.veneno ?? ''), veneno.datos?.veneno ?? veneno.err);
check('C. lo demás se calculó igual', veneno.datos?.hash === principal.datos?.hash);

const sinHilos = await guion(CALCULO, { ROBIN_EMBED_HILOS: '2', ROBIN_PRUEBA_HILO_NO_CARGA: '1' });
check('D. si los hilos no cargan, se calcula en el hilo principal', sinHilos.datos?.calculo?.modo === 'hilo_principal', JSON.stringify(sinHilos.datos?.calculo ?? sinHilos.err));
check('D. y con los mismos vectores', sinHilos.datos?.hash === principal.datos?.hash);

// ───────────────────────── E y F. Servidor MCP indexando ─────────────────────────
console.log('\nE–F. Servidor indexando\n');
const MADRE = path.join(base, 'Expedientes');
const PARRAFO =
  'La parte actora reclama el pago de la cantidad adeudada más los intereses legales devengados. ' +
  'El demandado se opone alegando la prescripción de la acción y la falta de legitimación pasiva. ' +
  'Consta acreditado mediante la prueba documental aportada que el contrato fue resuelto por impago. ';
// Documentos de 16+ fragmentos (lotes enteros de 512 tokens: lo que antes bloqueaba el proceso).
for (let i = 0; i < 4; i++) {
  const caso = path.join(MADRE, `Caso-${i}`);
  fs.mkdirSync(caso, { recursive: true });
  fs.writeFileSync(path.join(caso, `demanda-${i}.txt`), `Asunto ${i}. ${PARRAFO.repeat(140)}`);
}
// El mismo anexo en dos expedientes.
const ANEXO = 'Burofax con certificación de texto y acuse de recibo remitido al arrendatario requiriendo el pago de las rentas.';
fs.mkdirSync(path.join(MADRE, 'Caso-A'), { recursive: true });
fs.mkdirSync(path.join(MADRE, 'Caso-B', 'adjuntos'), { recursive: true });
fs.writeFileSync(path.join(MADRE, 'Caso-A', 'burofax.txt'), ANEXO);
fs.copyFileSync(path.join(MADRE, 'Caso-A', 'burofax.txt'), path.join(MADRE, 'Caso-B', 'adjuntos', 'burofax-copia.txt'));

const datos = path.join(base, 'datos');
const srv = spawn(process.execPath, [path.join(REPO, 'server/index.js')], {
  env: {
    ...process.env,
    ROBIN_TOKEN: 't',
    ROBIN_FOLDERS: MADRE,
    ROBIN_DATA_DIR: datos,
    ROBIN_OCR: 'false',
    ROBIN_LOG_LEVEL: 'info',
    ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no',
    ROBIN_DIAGNOSTICO_URL: 'off',
    ROBIN_NO_BROWSER: '1',
    ROBIN_EMBED_HILOS: process.env.ROBIN_EMBED_HILOS || '2',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '';
const pendientes = new Map();
let id = 1;
srv.stderr.on('data', () => {});
srv.stdin.on('error', () => {});
srv.stdout.on('data', (d) => {
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
    const f = pendientes.get(m.id);
    if (f) {
      pendientes.delete(m.id);
      f(m);
    }
  }
});
const salida = new Promise((r) => srv.on('exit', r));
const rpc = (method, params, topeMs = 120000) =>
  new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => {
      pendientes.delete(i);
      rej(new Error(`tope ${method}`));
    }, topeMs);
    pendientes.set(i, (m) => {
      clearTimeout(t);
      res(m);
    });
    srv.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`);
  });
const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const t = r.result?.content?.[0]?.text;
  let d = null;
  try {
    d = t ? JSON.parse(t) : null;
  } catch {
    d = null;
  }
  return { isError: Boolean(r.result?.isError), data: d, raw: t || '' };
};

try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  srv.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  // Mientras indexa: cada respuesta de estado_servidor se cronometra.
  const fin = Date.now() + 15 * 60 * 1000;
  let vistoIndexando = 0;
  let peorMs = 0;
  let calculo = null;
  let progresoVisto = false;
  let est = null;
  while (Date.now() < fin) {
    const t0 = Date.now();
    est = (await call('estado_servidor')).data;
    const ms = Date.now() - t0;
    if (est?.estado === 'indexando') {
      vistoIndexando += 1;
      peorMs = Math.max(peorMs, ms);
      if (est.progreso?.total > 0) progresoVisto = true;
      if (est.motor_embedding?.calculo?.modo) calculo = est.motor_embedding.calculo;
    }
    if (est?.estado !== 'indexando' && est?.ultimo_indexado && est.documentos_indexados >= 6) break;
    await espera(200);
  }
  check('E. se ha consultado el estado durante el indexado', vistoIndexando >= 3, `consultas=${vistoIndexando}`);
  // Umbral holgado para CI: sin hilos, un lote de 16 fragmentos de 512 tokens tiene el proceso
  // parado entre 2 s (equipo rápido) y 25 s (portátil lento) cada vez.
  check('E. el servidor contesta rápido mientras indexa', vistoIndexando >= 3 && peorMs < 1500, `peor respuesta=${peorMs} ms`);
  check('E. el progreso sale en estado_servidor', progresoVisto);
  check('E. el cálculo va en hilos', calculo?.modo === 'hilos', JSON.stringify(calculo));
  const ult = est?.ultimo_indexado;
  check('E. indexado completo y sin errores', est?.documentos_indexados === 6 && ult?.errores === 0, `docs=${est?.documentos_indexados} errores=${ult?.errores}`);

  const b = await call('buscar_documentos', { query: 'prescripción de la acción', expediente: 'Caso-2', n_resultados: 3 });
  check('E. la búsqueda funciona tras el indexado', (b.data?.fragmentos?.length ?? 0) > 0, b.raw.slice(0, 200));

  check('F. el anexo repetido reutilizó los vectores', (ult?.reutilizados ?? 0) >= 1, `reutilizados=${ult?.reutilizados}`);
  const enA = await call('buscar_documentos', { query: 'burofax acuse de recibo', expediente: 'Caso-A', n_resultados: 10 });
  const enB = await call('buscar_documentos', { query: 'burofax acuse de recibo', expediente: 'Caso-B', n_resultados: 10 });
  const rutasA = (enA.data?.fragmentos ?? []).map((f) => f.ruta_relativa);
  const rutasB = (enB.data?.fragmentos ?? []).map((f) => f.ruta_relativa);
  check('F. en Caso-A solo sale lo de Caso-A', rutasA.length > 0 && rutasA.every((r) => r.startsWith('Expedientes/Caso-A/')), JSON.stringify(rutasA));
  check('F. en Caso-B solo sale lo de Caso-B (la copia)', rutasB.length > 0 && rutasB.every((r) => r.startsWith('Expedientes/Caso-B/')), JSON.stringify(rutasB));
  const idA = enA.data?.fragmentos?.[0]?.doc_id;
  const idB = enB.data?.fragmentos?.[0]?.doc_id;
  check('F. cada copia es su propio documento', Boolean(idA && idB && idA !== idB));
  check('F. mismo contenido, misma puntuación', enA.data?.fragmentos?.[0]?.score === enB.data?.fragmentos?.[0]?.score);
} catch (err) {
  check('servidor MCP', false, String(err?.message ?? err));
} finally {
  if (process.platform === 'win32') srv.stdin.end();
  else srv.kill('SIGTERM');
  const r = await Promise.race([salida, espera(15000).then(() => null)]);
  if (r === null) {
    try {
      srv.kill('SIGKILL');
    } catch {
      /* ya murió */
    }
    await Promise.race([salida, espera(5000)]);
  }
}

borrar(base);
const fallos = results.filter((r) => !r).length;
console.log(`\n${results.length - fallos}/${results.length} comprobaciones OK`);
process.exit(fallos ? 1 : 0);
