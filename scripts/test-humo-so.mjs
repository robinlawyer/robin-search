// HUMO POR SISTEMA OPERATIVO: RobinSearch arrancado COMO LO ARRANCA CLAUDE, en cada SO.
//
// Por qué existe: el 16-sep-2026 un cliente en Windows vio la versión 0.0.0 y un aviso de
// actualización perpetuo. `new URL(import.meta.url).pathname` da «/C:/…» en Windows y ninguna
// prueba lo vio, porque todas corrían en macOS y desde la carpeta del repositorio.
//
// Qué hace, igual que Claude Desktop:
//   · lanza `node <paquete>/cli/index.js` (el entry_point del manifest) con el Node que se le
//     indique (process.execPath), desde un directorio de trabajo que NO es el del paquete, y
//     con el paquete en una ruta con espacios y tildes;
//   · sin ROBIN_FOLDERS: la carpeta sale del fichero de ajustes que deja la app, en el
//     directorio de datos POR DEFECTO de cada SO, bajo una carpeta personal con espacios y
//     tildes (HOME / USERPROFILE / APPDATA);
//   · habla MCP por stdio: initialize → tools/list → estado_servidor → herramientas;
//   · se cierra como lo cierra Claude: cerrando stdin (en Windows no hay SIGTERM).
//
// Expedientes con nombres de despacho de verdad:
//   · tildes en NFC (lo que teclea Windows) y en NFD (lo que dejaba un Mac con HFS+ en el NAS);
//   · una carpeta con «%» (delata cualquier decodeURI/pathname) y, fuera de Windows, con ESPACIO
//     FINAL (llega así desde un Mac o un NAS; Windows no deja ni crearla desde el Explorador);
//   · una ruta de más de 260 caracteres (MAX_PATH de Windows);
//   · un .txt, un PDF con texto (pdfjs) y una imagen escaneada (OCR con tesseract.js).
//
// Modos:
//   ROBIN_MCPB=<fichero> → descomprime ese .mcpb (el que se publica) en una ruta con espacios y
//                          tildes y lo prueba. La ruta se construye aquí, en JS, y no en el shell:
//                          Git Bash y cmd.exe estropean las tildes de los argumentos en Windows.
//   ROBIN_PAQUETE=<dir>  → prueba ese paquete ya descomprimido.
//   (sin variable)       → copia server/, cli/, package.json y manifest.json del repo a una ruta
//                          con espacios y tildes, y enlaza node_modules y models (junction en
//                          Windows: no necesita privilegios, a diferencia de un symlink).
//   ROBIN_REGISTROS_PRUEBAS=<dir> → si falla, deja ahí el registro del servidor.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (n, c, d = '') => {
  results.push(Boolean(c));
  console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = 60 * 1000;

// ───────────────────────── Escenario en disco ─────────────────────────
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-humo-'));
const borrar = (p) => {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (err) {
    console.log(`  (aviso) no se pudo borrar ${p}: ${err.code || err.message}`);
  }
};

// 1. El paquete, en una ruta con espacios y tildes.
let PAQUETE = process.env.ROBIN_PAQUETE ? path.resolve(process.env.ROBIN_PAQUETE) : null;
if (!PAQUETE && process.env.ROBIN_MCPB) {
  const { createRequire } = await import('node:module');
  const AdmZip = createRequire(path.join(REPO, 'package.json'))('adm-zip');
  PAQUETE = path.join(base, 'Claude Extensions', 'local.mcpb.robinlawyer.ai.robin-search (Ñandú)');
  new AdmZip(path.resolve(process.env.ROBIN_MCPB)).extractAllTo(PAQUETE, true);
} else if (!PAQUETE) {
  PAQUETE = path.join(base, 'Extensiones de Claude', 'Robin Búsqueda – Ñandú (prueba)');
  fs.mkdirSync(PAQUETE, { recursive: true });
  for (const d of ['server', 'cli']) fs.cpSync(path.join(REPO, d), path.join(PAQUETE, d), { recursive: true });
  for (const f of ['package.json', 'manifest.json']) fs.copyFileSync(path.join(REPO, f), path.join(PAQUETE, f));
  for (const d of ['node_modules', 'models']) {
    fs.symlinkSync(path.join(REPO, d), path.join(PAQUETE, d), process.platform === 'win32' ? 'junction' : 'dir');
  }
}
const pkg = JSON.parse(fs.readFileSync(path.join(PAQUETE, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(PAQUETE, 'manifest.json'), 'utf8'));
console.log(`\nPaquete: ${PAQUETE}\nNode ${process.version} (${process.platform}-${process.arch})\n`);

// Versión mínima de Node: pdfjs-dist pide 20. Paquete y manifest lo dicen, y con un Node más
// antiguo el arranque lo explica y sale (se simula cambiando la versión que ve el proceso).
{
  const pide = (x) => Number(String(x || '').replace(/[^\d.]/g, '').split('.')[0]);
  check('package.json y manifest piden Node ≥ 20 (lo que exige pdfjs-dist)',
    pide(pkg.engines?.node) >= 20 && pide(manifest.compatibility?.runtimes?.node) >= 20,
    `${pkg.engines?.node} / ${manifest.compatibility?.runtimes?.node}`);
  const viejo = await new Promise((res) => {
    const prog = `Object.defineProperty(process.versions, 'node', { value: '18.20.0' }); await import(${JSON.stringify(pathToFileURL(path.join(PAQUETE, 'cli', 'index.js')).href)});`;
    const c = spawn(process.execPath, ['--input-type=module', '-e', prog], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), 30000);
    c.on('exit', (code) => { clearTimeout(t); res({ code, err }); });
  });
  check('con Node 18 el arranque dice qué pasa y sale', viejo.code === 1 && /necesita Node 20/.test(viejo.err), viejo.err.trim().slice(0, 100));
}

// 2. Carpeta personal con espacios y tildes, y su directorio de datos por defecto.
const CASA = path.join(base, 'Usuarios', "Inés O'Neill Peña");
const APPDATA = path.join(CASA, 'AppData', 'Roaming');
const DATOS =
  process.platform === 'darwin'
    ? path.join(CASA, 'Library', 'Application Support', 'RobinLawyer', 'robin-search')
    : process.platform === 'win32'
      ? path.join(APPDATA, 'RobinLawyer', 'robin-search')
      : path.join(CASA, '.local', 'share', 'robin-lawyer', 'robin-search');

// 3. Expedientes.
const MADRE = path.join(base, 'Despacho', 'Expedientes Ñ 2026');
const CASO_NFC = 'Núñez Ibáñez - Despido'.normalize('NFC');
const CASO_NFD = 'Peña Muñoz - Arrendamiento'.normalize('NFD');
const CASO_ESPACIO = process.platform === 'win32' ? 'Acta de conciliación 50%' : 'Acta de conciliación 50% ';
const CASO_LARGO = 'Núñez - Concurso';

const escribir = (rel, contenido) => {
  const p = path.join(MADRE, ...rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contenido);
  return p;
};

escribir([CASO_NFC, '01 carta de despido.txt'],
  'Carta de despido disciplinario por transgresión de la buena fe contractual. CLAVE-NFC-7311.');

// PDF con texto y PNG «escaneado», generados con mupdf (WASM, ya va en el paquete).
const mupdf = await import(pathToFileURL(path.join(PAQUETE, 'node_modules', 'mupdf', 'dist', 'mupdf.js')).href);
function pdfConTexto(lineas) {
  const doc = new mupdf.PDFDocument();
  const fuente = doc.addSimpleFont(new mupdf.Font('Helvetica'));
  const recursos = doc.addObject({ Font: { F1: fuente } });
  const cuerpo = lineas.map((l, i) => `BT /F1 24 Tf 40 ${150 - i * 40} Td (${l}) Tj ET`).join('\n');
  doc.insertPage(-1, doc.addPage([0, 0, 700, 200], 0, recursos, cuerpo));
  return doc;
}
const pdf = pdfConTexto(['CONTRATO DE ARRENDAMIENTO DE LOCAL', 'RENTA MENSUAL CLAVE-PDF-4417']);
escribir([CASO_NFD, 'contrato arrendamiento.pdf'], pdf.saveToBuffer('compress').asUint8Array());
const escaneo = pdfConTexto(['ESCANEADO FIANZA DEPOSITADA', 'EN EL INSTITUTO DE LA VIVIENDA']);
const pix = escaneo.loadPage(0).toPixmap(mupdf.Matrix.scale(3, 3), mupdf.ColorSpace.DeviceGray, false);
escribir([CASO_NFD, 'justificante fianza escaneado.png'], pix.asPNG());

escribir([CASO_ESPACIO, 'acta de conciliación.txt'],
  'Acta de conciliación ante el servicio de mediación, arbitraje y conciliación: sin avenencia. CLAVE-ESPACIO-5120.');

const tramos = [CASO_LARGO];
while (path.join(MADRE, ...tramos).length < 300) {
  tramos.push(`Pieza separada de calificación del concurso ${tramos.length} (documentación)`);
}
const LARGO = escribir([...tramos, 'informe de la administración concursal.txt'],
  'Informe de la administración concursal sobre la masa activa y el inventario de bienes. CLAVE-LARGA-2035.');

const hayNfd = fs.readdirSync(MADRE).some((n) => n === CASO_NFD && n !== n.normalize('NFC'));
console.log(`Ruta más larga: ${LARGO.length} caracteres; carpeta NFD conservada en disco: ${hayNfd}\n`);

// La carpeta la elige la APP (ajustes.json), no una variable de entorno.
fs.mkdirSync(DATOS, { recursive: true });
fs.writeFileSync(path.join(DATOS, 'ajustes.json'), JSON.stringify({ carpetas: [MADRE] }, null, 2));

// ───────────────────────── Servidor, como lo lanza Claude ─────────────────────────
const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (/^ROBIN_/.test(k) && k !== 'ROBIN_REGISTROS_PRUEBAS') delete env[k];
}
delete env.XDG_DATA_HOME;
Object.assign(env, {
  HOME: CASA,
  USERPROFILE: CASA,
  APPDATA,
  LOCALAPPDATA: path.join(CASA, 'AppData', 'Local'),
  ROBIN_TOKEN: 'ROBIN-PRUEBA-humo', // sin login por navegador
  ROBIN_NO_BROWSER: '1',
  ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no',
  ROBIN_OAUTH_ISSUER: 'http://127.0.0.1:9',
  ROBIN_DIAGNOSTICO_URL: 'off',
});

const entrada = manifest.server.mcp_config.args[0].replace('${__dirname}', PAQUETE);
const c = spawn(process.execPath, [entrada], { cwd: base, env, stdio: ['pipe', 'pipe', 'pipe'] });
const salida = new Promise((r) => c.on('exit', (code, signal) => r({ code, signal })));
let se = '';
let basura = 0;
c.stderr.on('data', (d) => { se = (se + d.toString()).slice(-20000); });
let buf = '';
const w = new Map();
let id = 1;
c.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!l) continue;
    let m;
    try { m = JSON.parse(l); } catch { basura += 1; continue; }
    const f = w.get(m.id);
    if (f) { w.delete(m.id); f(m); }
  }
});
const rpc = (method, params, ms = 5 * MIN) => new Promise((res, rej) => {
  const i = id++;
  const t = setTimeout(() => { w.delete(i); rej(new Error(`timeout ${method}`)); }, ms);
  w.set(i, (m) => { clearTimeout(t); res(m); });
  c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`);
});
const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const t = r.result?.content?.[0]?.text;
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = null; }
  return { isError: Boolean(r.result?.isError), data, raw: t || JSON.stringify(r.error || '') };
};

async function main() {
  // ── Protocolo ──
  const t0 = Date.now();
  const ini = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '0.1.0' } }, 2 * MIN);
  c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  check('initialize responde', Boolean(ini.result?.serverInfo), `${Date.now() - t0} ms`);
  check('serverInfo.version es la del paquete, no 0.0.0',
    ini.result?.serverInfo?.version === pkg.version && pkg.version !== '0.0.0', `${ini.result?.serverInfo?.version} vs ${pkg.version}`);

  const lista = await rpc('tools/list', {});
  const nombres = (lista.result?.tools || []).map((t) => t.name).sort();
  const esperadas = manifest.tools.map((t) => t.name).sort();
  check('tools/list publica exactamente las herramientas del manifest',
    JSON.stringify(nombres) === JSON.stringify(esperadas), nombres.join(', '));

  // ── Estado y versión ──
  let est = (await call('estado_servidor')).data;
  check('estado_servidor dice la versión del paquete (el fallo de Windows del 16-sep)',
    est?.version === pkg.version && est?.version === manifest.version && est?.version !== '0.0.0',
    `servidor ${est?.version} · package.json ${pkg.version} · manifest ${manifest.version}`);
  check('y NO se inventa una actualización', !est?.actualizacion_disponible, String(est?.actualizacion_disponible));
  check('la carpeta sale del fichero de ajustes, en el directorio de datos por defecto del SO',
    est?.carpetas_vigiladas?.length === 1 && est.carpetas_vigiladas[0].ruta === MADRE && est.carpetas_vigiladas[0].accesible === true,
    JSON.stringify(est?.carpetas_vigiladas?.map((x) => x.ruta)));

  // ── Indexado completo (modelo + pdfjs + OCR) ──
  const tIdx = Date.now();
  for (let i = 0; i < 600; i++) {
    est = (await call('estado_servidor')).data;
    if (est?.ultimo_indexado && est.estado !== 'indexando') break;
    await espera(1000);
  }
  console.log(`  (indexado en ${Math.round((Date.now() - tIdx) / 1000)} s)`);
  check('motor de embedding cargado DESDE EL PAQUETE',
    est?.motor_embedding?.cargado === true && est.motor_embedding.empaquetado === true && est.motor_embedding.origen === 'empaquetado',
    JSON.stringify(est?.motor_embedding).slice(0, 160));
  check('OCR activo, con el idioma empaquetado y listo tras leer el escaneado',
    est?.ocr?.activo === true && est.ocr.empaquetado === true && est.ocr.listo === true && !est.ocr.error,
    JSON.stringify(est?.ocr).slice(0, 160));
  check('indexado sin errores y servidor activo',
    est?.estado === 'activo' && est?.ultimo_indexado?.errores === 0 && !est?.ultimo_error,
    `estado=${est?.estado} errores=${est?.ultimo_indexado?.errores} ${JSON.stringify(est?.ultimo_indexado?.errores_por_causa || '').slice(0, 160)}`);
  check('los 5 documentos están indexados (txt, pdf, png con OCR, carpeta con %, ruta larga)',
    est?.documentos_indexados === 5 && [].concat(est?.ficheros_sin_ocr ?? []).length === 0,
    `documentos=${est?.documentos_indexados} sin_ocr=${JSON.stringify(est?.ficheros_sin_ocr)}`);
  check('se detectan los 4 expedientes', est?.expedientes_detectados?.length === 4, JSON.stringify(est?.expedientes_detectados));

  // ── Búsqueda en cada expediente, nombrándolo como lo teclearía el abogado (NFC) ──
  const casos = [
    ['tildes NFC', CASO_NFC, 'carta de despido disciplinario por transgresión de la buena fe', 'CLAVE-NFC-7311'],
    ['carpeta en NFD, pedida en NFC, PDF con texto', 'Peña Muñoz - Arrendamiento'.normalize('NFC'), 'renta mensual del contrato de arrendamiento', 'CLAVE-PDF-4417'],
    ['imagen escaneada leída con OCR', 'Peña Muñoz - Arrendamiento'.normalize('NFC'), 'justificante de la fianza depositada en el instituto de la vivienda', /FIANZA/i],
    [process.platform === 'win32' ? 'carpeta con %' : 'carpeta con % y espacio final', CASO_ESPACIO.trim(), 'acta de conciliación sin avenencia', 'CLAVE-ESPACIO-5120'],
    [`ruta de ${LARGO.length} caracteres`, CASO_LARGO, 'informe de la administración concursal sobre la masa activa', 'CLAVE-LARGA-2035'],
  ];
  for (const [etiqueta, nombre, consulta, clave] of casos) {
    const fijar = await call('establecer_expediente_activo', { expediente: nombre });
    check(`[${etiqueta}] se puede fijar el expediente`, !fijar.isError && Boolean(fijar.data?.expediente_activo), fijar.raw.slice(0, 120));
    const b = await call('buscar_documentos', { query: consulta, n_resultados: 5 });
    const textos = (b.data?.fragmentos || []).map((f) => f.texto || '').join(' | ');
    const halla = clave instanceof RegExp ? clave.test(textos) : textos.includes(clave);
    check(`[${etiqueta}] la búsqueda encuentra el documento`, !b.isError && halla,
      b.isError ? b.raw.slice(0, 120) : (b.data?.fragmentos || []).map((f) => f.fichero).join(', '));
  }

  // ── Canal de control de la app (socket UNIX / tubería con nombre de Windows) ──
  const huella = crypto.createHash('sha256').update(DATOS).digest('hex').slice(0, 8);
  const canal = process.platform === 'win32' ? `\\\\.\\pipe\\robinsearch-${huella}` : path.join('/tmp', `robinsearch-${huella}.sock`);
  let retrato = null;
  for (let i = 0; i < 120 && !retrato; i++) {
    retrato = await new Promise((res) => {
      const s = net.connect(canal);
      let b2 = '';
      const fin = (v) => { try { s.destroy(); } catch { /* nada */ } res(v); };
      s.setEncoding('utf8');
      s.once('error', () => fin(null));
      s.on('data', (t) => {
        b2 += t;
        const k = b2.indexOf('\n');
        if (k >= 0) { try { fin(JSON.parse(b2.slice(0, k))); } catch { fin(null); } }
      });
      setTimeout(() => fin(null), 30000).unref();
    });
    if (!retrato) await espera(500);
  }
  check('la app puede leer el estado por el canal de control', retrato?.tipo === 'estado' && retrato.version === pkg.version,
    `${canal} → ${retrato ? `versión ${retrato.version}` : 'sin respuesta'}`);

  check('stdout lleva solo JSON-RPC (nada de avisos de librerías)', basura === 0, `${basura} líneas ajenas`);

  // ── Cierre como lo hace Claude: cierra stdin ──
  c.stdin.end();
  const fin = await Promise.race([salida, espera(30000).then(() => null)]);
  check('al cerrar stdin el servidor termina solo y con código 0', fin?.code === 0, JSON.stringify(fin));
  check('y suelta el índice (sin cerrojo huérfano)', !fs.existsSync(path.join(DATOS, 'escritor.lock')));
}

let fatal = null;
try {
  await main();
} catch (err) {
  fatal = err;
  console.error('ERROR:', err);
}
if (c.exitCode === null && c.signalCode === null) {
  c.kill();
  await Promise.race([salida, espera(15000)]);
}
const fallos = results.filter((r) => !r).length;
console.log(`\n${results.length - fallos}/${results.length} comprobaciones OK`);
if (fallos || fatal) {
  console.log(se.slice(-3000));
  if (process.env.ROBIN_REGISTROS_PRUEBAS) {
    try {
      const dst = path.join(process.env.ROBIN_REGISTROS_PRUEBAS, `humo-so-${process.platform}-node${process.versions.node}.log`);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(DATOS, 'logs', 'robin-search.log'), dst);
    } catch { /* sin registro */ }
  }
}
borrar(base);
process.exit(fallos || fatal ? 1 : 0);
