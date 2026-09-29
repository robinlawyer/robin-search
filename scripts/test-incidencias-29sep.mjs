// ESCENARIOS (informes del panel del 23 al 29-sep-2026):
//
//   1. Juan, macOS, 1.9.0, registro de Claude LEÍDO y aun así «caída previa abriendo el índice».
//      Claude cerró el proceso a los 0,3 s de nacer y lo relanzó 23 ms después: el «Initializing
//      server» del relanzamiento caía dentro del segundo de tolerancia DESPUÉS del arranque, se
//      tomaba por el del proceso muerto y, sin cierre detrás, el cierre ordenado pasaba por caída.
//   2. Tres Windows con `claude_log: sin_fichero`. La huella por stderr de la 1.8.5 no podía casar
//      nunca: con el Node de Claude, stderr va a main.log. Se reconoce ahora la ETIQUETA con la
//      que Claude firma nuestras líneas y, si no hay fichero propio, el registro común mcp.log;
//      y el informe dice qué se vio al buscarlo.
//   3. Dos «caídas» abriendo el índice que eran Claude actualizando la extensión (1.8.5→1.8.6 y
//      1.8.6→1.9.0): la marca LATE y, si la versión que murió no es esta y esta se instaló justo
//      cuando aquella dejó de latir, no es una caída. El latido lleva la memoria del proceso.
//   4. Al tomar el relevo, el canal de control se abría otra vez sobre sí mismo (EADDRINUSE).
//   5. Mac de Eduardo: una 1.4.0 viva reescribe el índice antiguo; un ENOENT a mitad del paso
//      BORRABA el índice entero. Ahora se sigue con el actual y se avisa de la versión antigua.
//   6. Quitar restos al abrir obligaba a releer el catálogo ENTERO de forma síncrona (minutos en
//      Windows con 40.000 documentos, sin renovar el cerrojo de escritor).
//   7. OCR: la imagen suelta no miraba la memoria, y la falta de memoria dentro de un .zip o de un
//      correo dejaba el contenedor indexado sin ese miembro para siempre.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (n, c, d = '') => {
  results.push(c);
  console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-29sep-'));
const carpeta = path.join(base, 'Expedientes');
const logsClaude = path.join(base, 'logs-claude');
const datos = path.join(base, 'datos');
fs.mkdirSync(carpeta, { recursive: true });
fs.mkdirSync(logsClaude, { recursive: true });
fs.mkdirSync(datos, { recursive: true });
process.env.ROBIN_DATA_DIR = datos;
process.env.ROBIN_FOLDER = carpeta;
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_OCR = 'false';
process.env.ROBIN_CLAUDE_LOGS_DIR = logsClaude;
process.env.ROBIN_LATIDO_MS = '150';
const url = (p) => pathToFileURL(path.join(REPO, p)).href;
let n = 0;
const fresco = () => import(`${url('server/diagnostico.js')}?v=${++n}`);

// ── 1. El «Initializing» del RELANZAMIENTO no es el del proceso muerto ───────────────────────
console.log('\n1. Registro de Claude de Juan (29-sep 08:09)\n');
const { claudeLaCerro } = await fresco();
const juan = [
  '2026-09-29T08:07:32.270Z [RobinSearch] [info] Initializing server... { metadata: undefined }',
  '2026-09-29T08:07:45.838Z [RobinSearch] [info] Shutting down server... { metadata: undefined }',
  '2026-09-29T08:07:45.839Z [RobinSearch] [info] Server transport closed (intentional shutdown) { metadata: undefined }',
  '2026-09-29T08:07:46.093Z [RobinSearch] [info] Server transport closed { metadata: undefined }',
  '2026-09-29T08:09:29.974Z [RobinSearch] [info] Initializing server... { metadata: undefined }',
  '2026-09-29T08:09:31.586Z [RobinSearch] [info] Shutting down server... { metadata: undefined }',
  '2026-09-29T08:09:31.586Z [RobinSearch] [info] Server transport closed (intentional shutdown) { metadata: undefined }',
  '2026-09-29T08:09:31.609Z [RobinSearch] [info] Server transport closed { metadata: undefined }',
  '2026-09-29T08:09:31.609Z [RobinSearch] [info] Initializing server... { metadata: undefined }',
];
check('1.1 proceso nacido a las 08:09:31.3 y cerrado por Claude a las 31.586: NO es caída',
  claudeLaCerro({ inicio: '2026-09-29T08:09:31.300Z' }, juan) === true);
check('1.2 el proceso relanzado (nacido 08:09:32.7) no hereda aquel cierre',
  claudeLaCerro({ inicio: '2026-09-29T08:09:32.700Z' }, juan) === false);
check('1.3 una caída de verdad (transport closed sin «Shutting down») sigue siendo caída',
  claudeLaCerro({ inicio: '2026-09-29T07:48:02.000Z' }, [
    '2026-09-29T07:47:58.012Z [RobinSearch] [info] Initializing server...',
    '2026-09-29T07:48:28.814Z [RobinSearch] [info] Server transport closed',
  ]) === false);
check('1.4 con el reloj medio segundo por delante (ningún «Initializing» antes), vale el de justo después',
  claudeLaCerro({ inicio: '2026-09-29T09:00:00.000Z' }, [
    '2026-09-29T09:00:00.400Z [RobinSearch] [info] Initializing server...',
    '2026-09-29T09:00:05.000Z [RobinSearch] [info] Shutting down server...',
  ]) === true);

// ── 2. Dónde está el registro de Claude ───────────────────────────────────────────────────
console.log('\n2. El registro de Claude por su contenido y en mcp.log\n');
const escribir = (nombre, lineas) => fs.writeFileSync(path.join(logsClaude, nombre), lineas.join('\n') + '\n');
escribir('main.log', ['2026-09-29 10:00:00 [info] [UtilityProcess stderr] robin-search: servidor listo (v1.9.0)']);
escribir('mcp-server-filesystem.log', ['2026-09-29T10:00:00.000Z [filesystem] [info] Initializing server...']);
let d = await fresco();
check('2.1 sin nada nuestro (solo main.log y otro servidor): sin_fichero', d.estadoLogClaude() === 'sin_fichero');
const det = d.detalleLogClaude();
check('2.2 el detalle cuenta lo visto, sin nombres', det?.carpetas_legibles === 1 && det.logs_mcp_server === 1 && det.main_log === true && det.mcp_log === false && Number.isFinite(det.reciente_min),
  JSON.stringify(det));
check('2.3 el detalle solo lleva números y sí/no (viaja en el registro)', Object.values(det).every((v) => v === null || typeof v === 'number' || typeof v === 'boolean'));

// El registro común: nuestras líneas con su etiqueta, mezcladas con las de otro servidor.
escribir('mcp.log', [
  '2026-09-29T10:00:00.000Z [info] [RobinSearch] Initializing server...',
  '2026-09-29T10:00:03.000Z [info] [filesystem] Shutting down server...',
  '2026-09-29T10:00:05.000Z [info] [RobinSearch] Server transport closed',
  '2026-09-29T11:00:00.000Z [info] [RobinSearch] Initializing server...',
  '2026-09-29T11:00:09.000Z [info] [RobinSearch] Shutting down server...',
]);
d = await fresco();
check('2.4 sin fichero propio, se lee el común mcp.log', d.estadoLogClaude() === 'leido_mcp_log');
check('2.5 del común solo cuentan NUESTRAS líneas: el cierre de otro servidor no tapa una caída',
  d.claudeLaCerro({ inicio: '2026-09-29T10:00:01.000Z' }) === false);
check('2.6 y un cierre nuestro se reconoce', d.claudeLaCerro({ inicio: '2026-09-29T11:00:01.000Z' }) === true);

escribir('mcp-server-Despacho.log', [
  '2026-09-29T12:00:00.000Z [Despacho RobinSearch] [info] Initializing server...',
  '2026-09-29T12:00:09.000Z [Despacho RobinSearch] [info] Shutting down server...',
]);
d = await fresco();
check('2.7 un mcp-server-*.log con otro nombre se reconoce por la etiqueta de sus líneas', d.estadoLogClaude() === 'leido_por_contenido');
check('2.8 las líneas de un registro ajeno no se adoptan por decir «robin» suelto',
  d.lineaEsNuestra('2026-09-29T12:00:00.000Z [robin] [info] Initializing server...') === false &&
  d.lineaEsNuestra('2026-09-29T12:00:00.000Z [Robin Search] [info] x') === true);
for (const f of fs.readdirSync(logsClaude)) fs.rmSync(path.join(logsClaude, f));

// ── 3. Latido y cierre por actualización ─────────────────────────────────────────────────
console.log('\n3. La marca late, y la actualización no es una caída\n');
d = await fresco();
d.marcarFase('cargando_indice');
const marcaPropia = () => JSON.parse(fs.readFileSync(path.join(datos, `en_curso-${process.pid}.json`), 'utf8'));
const m0 = marcaPropia();
await espera(450);
const m1 = marcaPropia();
check('3.1 la marca lleva hora de latido y memoria del proceso', Boolean(m0.latido) && Number.isFinite(m0.rss_mb) && Number.isFinite(m0.libre_mb));
check('3.2 y se renueva sola mientras dura la fase', Date.parse(m1.latido) > Date.parse(m0.latido) && m1.fase === 'cargando_indice');
d.finFase();
await espera(300);
check('3.3 al cerrar la fase no queda marca ni latido', !fs.existsSync(path.join(datos, `en_curso-${process.pid}.json`)));

const { VERSION } = await import(url('server/config.js'));
const instalada = Date.parse('2026-09-29T08:41:05.000Z');
check('3.4 versión anterior que dejó de latir al instalarse esta: la cerró Claude',
  d.cerradaPorActualizacion({ version: '1.8.6', latido: '2026-09-29T08:41:02.000Z' }, instalada) === true);
check('3.5 misma versión: no se deduce nada', d.cerradaPorActualizacion({ version: VERSION, latido: '2026-09-29T08:41:02.000Z' }, instalada) === false);
check('3.6 dejó de latir mucho antes de la actualización (caída y luego actualizar a mano): no',
  d.cerradaPorActualizacion({ version: '1.8.6', latido: '2026-09-29T08:20:00.000Z' }, instalada) === false);
check('3.7 marca sin latido (versiones anteriores): no se sabe cuándo murió, no se deduce',
  d.cerradaPorActualizacion({ version: '1.8.6', t: '2026-09-29T08:41:02.000Z' }, instalada) === false);
const dm = d.datosDeMarca({ version: '1.8.6', latido: new Date(Date.now() - 4000).toISOString(), rss_mb: 5321, libre_mb: 410 });
check('3.8 el registro dice cuánto hacía que no latía y con cuánta memoria', dm.con_latido === true && dm.rss_mb === 5321 && dm.libre_mb === 410 && dm.version === '1.8.6' && Number.isFinite(dm.sin_latir_s));

// De extremo a extremo: marca de un proceso MUERTO de otra versión que dejó de latir justo cuando
// se instaló esta (la fecha de instalación es la de la carpeta de la extensión: aquí, el repo).
const pidMuerto = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout.trim();
const instaladaAqui = d.instalacionMs();
check('3.9a se sabe cuándo se instaló esta versión', Number.isFinite(instaladaAqui));
fs.writeFileSync(path.join(datos, `en_curso-${pidMuerto}.json`), JSON.stringify({
  pid: Number(pidMuerto), fase: 'cargando_indice', t: new Date(instaladaAqui - 100_000).toISOString(),
  inicio: new Date(instaladaAqui - 120_000).toISOString(), version: '0.0.1-vieja', latido: new Date(instaladaAqui - 2000).toISOString(),
}));
d = await fresco();
check('3.9 sin registro de Claude, la marca de la versión recién sustituida NO es una caída', d.revisarCaidaAnterior() === null);
fs.writeFileSync(path.join(datos, `en_curso-${pidMuerto}.json`), JSON.stringify({
  pid: Number(pidMuerto), fase: 'cargando_indice', t: new Date().toISOString(),
  inicio: new Date(Date.now() - 120_000).toISOString(), version: VERSION, latido: new Date().toISOString(),
}));
const c = d.revisarCaidaAnterior();
check('3.10 la misma marca con ESTA versión sigue siendo incierta (se avisa, no se esconde)', c?.fase === 'cargando_indice' && c.incierta === true);

// ── 4. El canal de control, al tomar el relevo, no se abre sobre sí mismo ────────────────
console.log('\n4. Canal de control idempotente\n');
const control = await import(url('server/control.js'));
const { log } = await import(url('server/logger.js'));
const avisos = [];
const warnOriginal = log.warn;
log.warn = (msg, extra) => { avisos.push(msg); return warnOriginal(msg, extra); };
const r1 = await control.iniciarControl();
const r2 = await control.iniciarControl();
const conecta = await new Promise((res) => {
  const s = net.connect(r1);
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});
check('4.1 abrirlo dos veces devuelve el mismo canal, sin avisos', Boolean(r1) && r1 === r2 && !avisos.some((a) => /canal de control/i.test(a)), JSON.stringify(avisos));
check('4.2 y el canal sigue atendiendo', conecta);
control.detenerControl();
log.warn = warnOriginal;

// ── 5 y 6. Abrir el índice ──────────────────────────────────────────────────────────────
console.log('\n5. El índice antiguo que desaparece o vuelve\n');
const store = await import(url('server/search/store.js'));
const vectra = (docs) => {
  const items = [];
  for (const [docId, texto] of docs) items.push({ id: `${docId}::0`, vector: [0.1, 0.2, 0.3, 0.4], metadata: { docId, chunkId: 0, text: texto, rutaRelativa: `Expedientes/${docId}.txt` } });
  fs.mkdirSync(path.join(datos, 'index'), { recursive: true });
  fs.writeFileSync(path.join(datos, 'index', 'index.json'), JSON.stringify({ version: 1, metadata_config: {}, items }));
};
vectra([['aaa', 'uno'], ['bbb', 'dos']]);
let r = await store.abrir({ migrar: true });
check('5.1 primer paso del índice antiguo: no es repetido', r.migracion && r.migracion.repetida === false && r.documentos === 2);
vectra([['ccc', 'tres']]);
r = await store.abrir({ migrar: true });
check('5.2 el índice antiguo REAPARECE: se pasa y se marca como versión antigua viva', r.migracion?.repetida === true && r.documentos === 3);

// El index.json existe al mirar y desaparece al abrirlo (otra instancia lo acaba de pasar).
vectra([['ddd', 'cuatro']]);
const crsOriginal = fs.createReadStream;
fs.createReadStream = (p, o) => crsOriginal(String(p).endsWith('index.json') ? `${p}.desaparecido` : p, o);
let err = null;
try {
  r = await store.abrir({ migrar: true });
} catch (e) {
  err = e;
}
fs.createReadStream = crsOriginal;
check('5.3 ENOENT a mitad del paso: el índice se abre igual, sin error', !err && r?.migracion?.desaparecido === true && r.documentos === 3, String(err?.message ?? ''));
const boot = fs.readFileSync(path.join(REPO, 'server/bootstrap.js'), 'utf8');
check('5.4 y abrirIndice trata ENOENT como pasajero (nunca borra el índice por él)', /const PASAJEROS = new Set\(\[[^\]]*'ENOENT'/.test(boot));
fs.rmSync(path.join(datos, 'index'), { recursive: true, force: true });

console.log('\n6. Quitar restos al abrir no obliga a releer el catálogo entero\n');
const docsDir = path.join(datos, 'indice', 'docs');
const resto = path.join(docsDir, 'zzz.99.vec');
fs.writeFileSync(resto, Buffer.alloc(16));
const viejo = new Date(Date.now() - 3600_000);
fs.utimesSync(resto, viejo, viejo);
await store.abrir({ migrar: true });
check('6.1 el resto viejo se ha quitado', !fs.existsSync(resto));
const rdsOriginal = fs.readdirSync;
let listados = 0;
fs.readdirSync = (p, o) => {
  if (path.resolve(String(p)) === path.resolve(docsDir)) listados += 1;
  return rdsOriginal(p, o);
};
store.cabecera('aaa');
store.docIds();
fs.readdirSync = rdsOriginal;
check('6.2 la primera consulta tras abrir no vuelve a listar la carpeta de documentos', listados === 0, `listados=${listados}`);

// ── 7. OCR y memoria ─────────────────────────────────────────────────────────────────────
console.log('\n7. OCR con poca memoria\n');
const ocr = fs.readFileSync(path.join(REPO, 'server/indexer/ocr.js'), 'utf8');
const extract = fs.readFileSync(path.join(REPO, 'server/indexer/extract.js'), 'utf8');
const cuerpoOcrImage = ocr.slice(ocr.indexOf('export async function ocrImage'), ocr.indexOf('function errorSinMemoria'));
check('7.1 la imagen suelta mira la memoria antes del OCR, como el PDF', /MINIMO_LIBRE_RAM_MB\) throw errorSinMemoria\(\)/.test(cuerpoOcrImage));
check('7.2 con poca memoria se cierra el motor de OCR al acabar cada documento (PDF e imagen)',
  (ocr.match(/await soltarMotorSiFaltaMemoria\(\)/g) || []).length >= 2);
const reLanza = /if \(err\?\.code === 'ROBIN_DISCO_LLENO' \|\| err\?\.code === 'ROBIN_FICHERO_SIN_MEMORIA'\) throw err;/g;
check('7.3 la falta de memoria sube desde la imagen, el miembro del contenedor, el contenedor y el adjunto',
  (extract.match(reLanza) || []).length >= 5, `veces=${(extract.match(reLanza) || []).length}`);
if (process.platform !== 'darwin') {
  process.env.ROBIN_OCR_MINIMO_RAM_MB = String(10 * 1024 * 1024);
  const o = await import(`${url('server/indexer/ocr.js')}?v=mem`);
  const png = path.join(base, 'x.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  let e2 = null;
  try {
    await o.ocrImage(png);
  } catch (e) {
    e2 = e;
  }
  check('7.4 (Windows/Linux) sin memoria, la imagen da ROBIN_FICHERO_SIN_MEMORIA y se reintenta', e2?.code === 'ROBIN_FICHERO_SIN_MEMORIA', String(e2?.code));
}

fs.rmSync(base, { recursive: true, force: true });
const fallos = results.filter((x) => !x).length;
console.log(`\n${results.length - fallos}/${results.length} comprobaciones OK`);
process.exit(fallos ? 1 : 0);
