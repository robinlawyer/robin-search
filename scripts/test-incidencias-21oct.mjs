// ESCENARIO (informe del Mac de Eduardo, 21-oct-2026 20:01 UTC, macOS x64, 1.12.2): «caida_incierta
// · abriendo el índice», con un índice que había pasado de 9 MB a 2,4 GB (34.353 documentos,
// 646.754 fragmentos). Lo que había detrás, medido con un índice sintético de ese tamaño:
//
//   1. Abrir el índice NO revienta (catálogo de 3 MB + un listado de la carpeta: 0,3 s, ~100 MB),
//      pero el ajuste a las carpetas configuradas y el cotejo con el registro recorrían los 34.000
//      documentos DE UN TIRÓN: ~3 s sin atender a nadie. A las 19:29 Claude cerró de golpe una
//      docena de instancias; las que estaban en ese tramo no atendieron la señal a tiempo, Claude
//      las mató y su marca de «abriendo el índice» quedó huérfana → «caída».
//   2. La causa decía «2 caídas seguidas» y el informe «5»: la cifra del informe se leía DESPUÉS,
//      cuando otra instancia ya había sumado sus marcas. Y cinco marcas de la MISMA tanda contaban
//      como cinco caídas (con tres confirmadas se habría rehecho el índice entero).
//   3. «Sin registro de Claude» con `claude_log: leido`: el registro existía pero Claude no lo
//      escribía desde el 16-oct; además, existiendo ese, nunca se miraba mcp.log aunque fuera más
//      reciente.
//   4. Dos informes idénticos en el mismo segundo: dos instancias comprobaban «¿ya avisé?» antes
//      de que ninguna lo apuntara.
//   5. Los mismos 17 PDF rotos y un .docx se volvían a abrir (y a avisar) cada 15 minutos.
//   +  Cada búsqueda sobre ese índice releía del disco TODOS los vectores (~24 s): no cabían en el
//      tope de 768 MB y el recorrido echaba lo que la búsqueda siguiente iba a necesitar.
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
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
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-21oct-'));
// ANTES de importar nada del servidor: config.js fija la carpeta de datos al cargarse, y sin esto
// las comprobaciones de la sección 3 mirarían la instalación de verdad del equipo.
const datos3 = path.join(base, 'datos3');
const logsClaude = path.join(base, 'logs-claude');
fs.mkdirSync(path.join(datos3, 'logs'), { recursive: true });
fs.mkdirSync(logsClaude, { recursive: true });
process.env.ROBIN_DATA_DIR = datos3;
process.env.ROBIN_FOLDER = path.join(base, 'Despacho');
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_CLAUDE_LOGS_DIR = logsClaude;
process.env.ROBIN_DIAGNOSTICO_URL = 'off';
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const url = (p) => JSON.stringify(pathToFileURL(path.join(REPO, p)).href);

// Índice sintético en el formato por documento (store.js), con su registro y sus ficheros.
function indiceSintetico(datos, carpeta, docs, porDoc = 2) {
  const dir = path.join(datos, 'indice', 'docs');
  fs.mkdirSync(dir, { recursive: true });
  const vec = Buffer.alloc(porDoc * 384 * 4);
  crypto.randomFillSync(vec);
  const raiz = path.basename(carpeta);
  const reg = {};
  for (let d = 0; d < docs; d++) {
    const docId = crypto.createHash('sha1').update(`doc${d}`).digest('hex').slice(0, 16);
    const gen = crypto.randomBytes(6).toString('hex');
    const rel = `${raiz}/E${d % 40}/x${d}.txt`;
    const cab = { v: 1, docId, n: porDoc, dim: 384, gen, expediente: `${raiz}/E${d % 40}`, rutaRelativa: rel, fichero: `x${d}.txt`, raiz };
    const lineas = [JSON.stringify(cab)];
    for (let c = 0; c < porDoc; c++) lineas.push(JSON.stringify({ texto: `fragmento ${d}-${c}`, docId, chunkId: c, fichero: cab.fichero, rutaRelativa: rel, expediente: cab.expediente }));
    fs.writeFileSync(path.join(dir, `${docId}.${gen}.vec`), vec);
    fs.writeFileSync(path.join(dir, `${docId}.jsonl`), `${lineas.join('\n')}\n`);
    const abs = path.join(carpeta, `E${d % 40}`, `x${d}.txt`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `x${d}`);
    const st = fs.statSync(abs);
    reg[abs] = { docId, raiz, rutaRelativa: rel, size: st.size, mtimeMs: st.mtimeMs, indexedAt: new Date().toISOString(), numChunks: porDoc, numPages: 1, expediente: cab.expediente };
  }
  fs.writeFileSync(path.join(datos, 'files.json'), JSON.stringify(reg));
}

// Un Claude de mentira: lanza el servidor, saluda y le hace ping cada 50 ms.
function lanzar(datos, carpeta, extra = {}) {
  const env = {
    ...process.env, ROBIN_DATA_DIR: datos, ROBIN_FOLDERS: carpeta, ROBIN_TOKEN: 't', ROBIN_OCR: 'false',
    ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no', ROBIN_DIAGNOSTICO_URL: 'off', ROBIN_NO_TOCAR_VERSIONES_ANTIGUAS: '1', ...extra,
  };
  const h = spawn(process.execPath, [path.join(REPO, 'server/index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let id = 0;
  const pend = new Map();
  h.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(l);
        pend.get(m.id)?.(m);
        pend.delete(m.id);
      } catch {
        /* no es JSON-RPC */
      }
    }
  });
  h.stderr.on('data', () => {});
  const pedir = (method, params = {}) =>
    new Promise((r) => {
      const k = ++id;
      pend.set(k, r);
      try {
        h.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: k, method, params })}\n`);
      } catch {
        r(null);
      }
    });
  const salida = new Promise((r) => h.on('exit', (code, signal) => r({ code, signal, t: Date.now() })));
  return { h, pedir, salida };
}
const fasesEnCurso = (datos) =>
  fs
    .readdirSync(datos)
    .filter((n) => /^en_curso-\d+\.json$/.test(n))
    .map((n) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(datos, n), 'utf8')).fase;
      } catch {
        return '?';
      }
    });

// ── 1. Abrir un índice grande no deja a la instancia sorda (ni a la orden de cerrarse) ──────────
console.log('\n1. Abriendo un índice grande, la instancia sigue contestando y se cierra cuando Claude se lo pide\n');
{
  const N = Number(process.env.ROBIN_PRUEBA_21OCT_DOCS) || 15000;
  const datos = path.join(base, 'datos1');
  const carpeta = path.join(base, 'Despacho');
  indiceSintetico(datos, carpeta, N);
  // 1.ª vez: hace el catálogo (como el equipo real, que lo tenía).
  {
    const c = lanzar(datos, carpeta);
    await c.pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } });
    c.h.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    for (let i = 0; i < 600 && !fs.existsSync(path.join(datos, 'indice', 'catalogo.jsonl')); i++) await espera(100);
    while (fasesEnCurso(datos).includes('cargando_indice')) await espera(100);
    c.h.stdin.end();
    await c.salida;
  }
  // 2.ª vez: ping cada 50 ms mientras abre el índice.
  const c = lanzar(datos, carpeta);
  await c.pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } });
  c.h.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  let enFase = false;
  let visto = false;
  let peor = 0;
  for (let i = 0; i < 1200; i++) {
    enFase = fasesEnCurso(datos).includes('cargando_indice');
    if (enFase) visto = true;
    if (visto && !enFase) break;
    const t = Date.now();
    await c.pedir('ping');
    if (visto) peor = Math.max(peor, Date.now() - t);
    await espera(50);
  }
  check('1.1 se ve la fase «abriendo el índice»', visto);
  check(`1.2 mientras abre el índice (${N} documentos) contesta en menos de medio segundo`, peor < 500, `peor ping ${peor} ms`);
  c.h.stdin.end();
  await c.salida;

  // 3.ª vez: Claude la cierra (SIGINT) en plena apertura y mata lo que no sale en 1 s.
  const d = lanzar(datos, carpeta);
  await d.pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } });
  d.h.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  for (let i = 0; i < 400 && !fasesEnCurso(datos).includes('cargando_indice'); i++) await espera(10);
  // En el tramo de recorrer los documentos (pasado el catálogo): ahí es donde se quedaba sorda.
  await espera(250);
  const t0 = Date.now();
  d.h.kill('SIGINT');
  const r = await Promise.race([d.salida, espera(1000).then(() => null)]);
  if (!r) d.h.kill('SIGKILL');
  await d.salida;
  check('1.3 la orden de cerrarse llega y se atiende en plena apertura (sin que haya que matarla)', Boolean(r) && r.code === 0, r ? `${r.t - t0} ms` : 'muerta a la fuerza');
  check('1.4 y no queda marca huérfana que el siguiente arranque tome por caída', fasesEnCurso(datos).length === 0, fasesEnCurso(datos).join(','));
}

// ── 2. Buscar en un índice que no cabe en memoria no relee TODO en cada búsqueda ───────────────
console.log('\n2. Una búsqueda sobre un índice mayor que el tope de memoria no echa lo que la siguiente necesita\n');
{
  const datos = path.join(base, 'datos2');
  const DOCS = 300;
  const prog = `
const store = await import(${url('server/search/store.js')});
await store.abrir({ migrar: false });
const q = Array.from({ length: 384 }, (_, i) => Math.sin(i));
const lect = [];
for (let i = 0; i < 3; i++) { const a = store.estadisticasCatalogo().lecturasVectores; await store.query(q, 5); lect.push(store.estadisticasCatalogo().lecturasVectores - a); }
console.log(JSON.stringify({ lect, v: store.estadisticasCatalogo().vectores }));`;
  indiceSintetico(datos, path.join(base, 'Otro'), DOCS, 4);
  const out = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', prog], {
      env: { ...process.env, ROBIN_DATA_DIR: datos, ROBIN_LOG_LEVEL: 'error', ROBIN_MAX_VECTORES_MB: '1' },
    }).toString(),
  );
  check('2.1 la primera búsqueda lee todos los documentos', out.lect[0] === DOCS, JSON.stringify(out.lect));
  check('2.2 la segunda solo relee lo que no cabe (antes, todo otra vez)', out.lect[1] < DOCS / 2, JSON.stringify(out.lect));
  check('2.3 y lo guardado no pasa del tope', out.v.bytes <= out.v.tope, JSON.stringify(out.v));
  const { TOPE_VECTORES_BYTES } = await imp('server/search/store.js');
  const gb = os.totalmem() / 1073741824;
  check('2.4 sin tope fijado, el tope crece con la memoria del equipo (5 %, entre 768 MB y 1,5 GB)',
    TOPE_VECTORES_BYTES >= 768 * 1048576 && TOPE_VECTORES_BYTES <= 1536 * 1048576 && (gb < 15 || TOPE_VECTORES_BYTES > 768 * 1048576),
    `${Math.round(TOPE_VECTORES_BYTES / 1048576)} MB con ${gb.toFixed(0)} GB`);
}

// ── 3. Registro de Claude, tandas y cifras coherentes ──────────────────────────────────────────
console.log('\n3. El diagnóstico dice lo que de verdad pasó\n');
const diag = await imp('server/diagnostico.js');
const { causaDeCaida } = await imp('server/bootstrap.js');
const ahora = Date.now();
const iso = (ms) => new Date(ms).toISOString();
{
  // 3.a El registro con nuestro nombre existe pero Claude no lo escribe desde hace 5 días.
  const propio = path.join(logsClaude, 'mcp-server-RobinSearch.log');
  fs.writeFileSync(propio, `${iso(ahora - 5 * 86400e3)} [RobinSearch] [info] Initializing server... { metadata: undefined }\n`);
  fs.utimesSync(propio, new Date(ahora - 5 * 86400e3), new Date(ahora - 5 * 86400e3));
  const marca = { inicio: iso(ahora - 60e3), t: iso(ahora - 55e3), latido: iso(ahora - 30e3), fase: 'cargando_indice' };
  check('3.1 registro desfasado → «no se sabe» (null), no «se cayó»', diag.claudeLaCerro(marca) === null);
  check('3.2 y el informe lo dice: claude_log «desfasado», no «leido»', diag.estadoLogClaude() === 'desfasado', diag.estadoLogClaude());
  const c = causaDeCaida({ incierta: true, sinRegistro: 'desfasado', caidasSeguidas: 1 }, 'cargando_indice');
  check('3.3 la causa no dice «sin registro» cuando el registro existe', /desfasado/.test(c) && !/sin registro/.test(c), c);
  const det = diag.detalleLogClaude();
  check('3.4 el detalle lleva la antigüedad del registro (en minutos, sin rutas)', det.nuestro_min >= 5 * 1440 - 1 && !JSON.stringify(det).includes(logsClaude), JSON.stringify(det));

  // 3.b Con mcp.log MÁS RECIENTE y hablando de nuestro servidor, manda mcp.log.
  fs.writeFileSync(path.join(logsClaude, 'mcp.log'), [
    `${iso(ahora - 61e3)} [info] [RobinSearch] Initializing server... { metadata: undefined }`,
    `${iso(ahora - 20e3)} [info] [RobinSearch] Shutting down server... { metadata: undefined }`,
    `${iso(ahora - 20e3)} [info] [RobinSearch] Server transport closed (intentional shutdown) { metadata: undefined }`,
  ].join('\n') + '\n');
  check('3.5 si mcp.log es más reciente que el registro con nuestro nombre, se lee mcp.log y se sabe que lo cerró Claude', diag.claudeLaCerro(marca) === true);
  check('3.6 claude_log lo cuenta', diag.estadoLogClaude() === 'leido_mcp_log', diag.estadoLogClaude());
  fs.rmSync(path.join(logsClaude, 'mcp.log'));
}
{
  // 3.c Claude cerró a la vez una tanda de instancias: en NUESTRO registro, «Cierre ordenado» de
  // las demás en los segundos en que la marca dejó de latir.
  const latido = ahora - 30 * 60e3;
  const lineas = [
    JSON.stringify({ t: iso(latido - 900), level: 'info', msg: 'Esta instancia toma el relevo del índice' }),
    JSON.stringify({ t: iso(latido + 2000), level: 'info', msg: 'Cierre ordenado de RobinSearch', data: { motivo: 'SIGINT' } }),
  ];
  const marca = { latido: iso(latido), fase: 'cargando_indice' };
  check('3.7 marca que deja de latir mientras se cierran las demás → la cerró Claude', diag.cerradaEnTanda(marca, lineas) === true);
  check('3.8 un cierre ajeno de otra hora no la explica', diag.cerradaEnTanda({ latido: iso(latido + 10 * 60e3) }, lineas) === false);
  check('3.9 sin latido no se presume nada', diag.cerradaEnTanda({ fase: 'cargando_indice' }, lineas) === false);
  // De extremo a extremo: marca huérfana + cierres en el registro propio → no es una caída.
  fs.writeFileSync(path.join(datos3, 'logs', 'robin-search.log'), `${lineas.join('\n')}\n`);
  fs.writeFileSync(path.join(datos3, 'en_curso-3999901.json'), JSON.stringify({ pid: 3999901, fase: 'cargando_indice', t: iso(latido - 3000), inicio: iso(latido - 4000), version: '1.12.2', latido: iso(latido) }));
  check('3.10 y revisarCaidaAnterior no la cuenta ni la avisa', diag.revisarCaidaAnterior() === null);
  fs.writeFileSync(path.join(datos3, 'logs', 'robin-search.log'), '');
}
{
  // 3.d Cinco marcas de la misma tanda (sin registro que lo aclare): UN suceso, no cinco caídas.
  fs.rmSync(path.join(logsClaude, 'mcp-server-RobinSearch.log'));
  const latido = ahora - 31 * 60e3;
  for (let i = 0; i < 5; i++) {
    const pid = 3999910 + i;
    fs.writeFileSync(path.join(datos3, `en_curso-${pid}.json`), JSON.stringify({ pid, fase: 'cargando_indice', t: iso(latido - 5000), inicio: iso(latido - 6000 - i), version: '1.12.2', latido: iso(latido + i * 4000) }));
  }
  const r = diag.revisarCaidaAnterior();
  check('3.11 cinco marcas de la misma tanda cuentan como UNA caída', r?.caidasSeguidas === 1 && r?.marcas === 5, JSON.stringify({ c: r?.caidasSeguidas, m: r?.marcas }));
  check('3.12 y son inciertas: no cuentan para rehacer el índice', r?.incierta === true && diag.caidasSeguidasEn(['cargando_indice', 'migrando_indice']) === 0);
  // La otra instancia, que arrancó a la vez, reclama marcas de la MISMA tanda: no suma otra.
  fs.writeFileSync(path.join(datos3, 'en_curso-3999920.json'), JSON.stringify({ pid: 3999920, fase: 'cargando_indice', t: iso(latido - 5000), inicio: iso(latido - 7000), version: '1.12.2', latido: iso(latido + 1000) }));
  const r2 = diag.revisarCaidaAnterior();
  check('3.13 la otra instancia, con marcas de esa misma tanda, no suma otra caída', r2?.caidasSeguidas === 1, `caidasSeguidas=${r2?.caidasSeguidas}`);
  // 3.e La cifra del informe es la de quien informa (la de la causa), aunque el estado ya diga otra.
  const est = JSON.parse(fs.readFileSync(path.join(datos3, 'diagnostico.json'), 'utf8'));
  est.caidasSeguidas = 5;
  fs.writeFileSync(path.join(datos3, 'diagnostico.json'), JSON.stringify(est));
  const { informe } = diag.construirInforme('caida_incierta', { fase: 'cargando_indice', causa: causaDeCaida({ incierta: true, caidasSeguidas: 2 }, 'cargando_indice'), caidasSeguidas: 2 });
  check('3.14 «caídas seguidas» del informe = la de la causa', informe.caidas_seguidas === 2 && /2 caídas seguidas/.test(informe.causa), `${informe.caidas_seguidas} · ${informe.causa}`);
  check('3.15 el informe dice quién lanzó el proceso (solo la categoría)', /^[a-z_]+$/.test(informe.sistema.lanzador || ''), informe.sistema.lanzador);
}
{
  // 3.f Categorías de lanzador: nunca la ruta.
  const casos = [
    ['/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper', '', 'claude_desktop'],
    ['/Applications/Claude.app/Contents/MacOS/Claude', '', 'claude_desktop'],
    ['C:\\Users\\Ana López\\AppData\\Local\\AnthropicClaude\\app-1.0.0\\claude.exe', '', 'claude_desktop'],
    ['/Users/ana/.local/bin/claude', '', 'claude_code'],
    ['node', 'node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js', 'claude_code'],
    ['node', 'node server/index.js', 'node'],
    ['/bin/zsh', 'zsh -c "Claude.app"', 'terminal'],
    ['/Applications/RobinDesktop.app/Contents/MacOS/RobinDesktop', '', 'robindesktop'],
    ['', '', 'desconocido'],
  ];
  check('3.16 el lanzador se reconoce por el ejecutable, no por los argumentos', casos.every(([e, a, c]) => diag.categoriaLanzador(e, a) === c),
    casos.map(([e, a]) => diag.categoriaLanzador(e, a)).join(','));
}

// ── 4. Dos instancias avisando de lo mismo a la vez: un solo informe ───────────────────────────
console.log('\n4. Dos instancias que arrancan a la vez mandan UN informe, no dos\n');
{
  const llegados = [];
  let fallar = false;
  const robin = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (fallar) {
        res.writeHead(503);
        res.end('');
        return;
      }
      llegados.push(JSON.parse(b));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"id":"x"}');
    });
  });
  await new Promise((r) => robin.listen(0, '127.0.0.1', r));
  const URL_AVISOS = `http://127.0.0.1:${robin.address().port}/robinsearch/diagnostico`;
  const datos = path.join(base, 'datos4');
  fs.mkdirSync(datos, { recursive: true });
  const prog = `
const d = await import(${url('server/diagnostico.js')});
const r = await d.informar('caida_incierta', { fase: 'cargando_indice', causa: 'prueba de dos instancias' });
console.log(JSON.stringify(r));`;
  const hijo = () =>
    new Promise((r) => {
      const c = spawn(process.execPath, ['--input-type=module', '-e', prog], {
        env: { ...process.env, ROBIN_DATA_DIR: datos, ROBIN_DIAGNOSTICO_URL: URL_AVISOS, ROBIN_LOG_LEVEL: 'error', ROBIN_TOKEN: '' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let o = '';
      c.stdout.on('data', (x) => (o += x));
      c.on('exit', () => r(o));
    });
  await Promise.all([hijo(), hijo(), hijo()]);
  check('4.1 tres instancias a la vez → un solo informe', llegados.length === 1, `llegados=${llegados.length}`);
  // Si el envío falla, la reserva se suelta: el siguiente intento avisa.
  const datosB = path.join(base, 'datos4b');
  fs.mkdirSync(datosB, { recursive: true });
  const progB = prog.replace('prueba de dos instancias', 'prueba de envío fallido');
  // Con spawn y no execFileSync: este mismo proceso es el «servidor de Robin» y tiene que poder contestar.
  const una = () =>
    new Promise((r) => {
      const c = spawn(process.execPath, ['--input-type=module', '-e', progB], {
        env: { ...process.env, ROBIN_DATA_DIR: datosB, ROBIN_DIAGNOSTICO_URL: URL_AVISOS, ROBIN_LOG_LEVEL: 'error', ROBIN_TOKEN: '' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let o = '';
      c.stdout.on('data', (x) => (o += x));
      c.on('exit', () => r(o));
    });
  fallar = true;
  const r1 = JSON.parse(await una());
  fallar = false;
  const r2 = JSON.parse(await una());
  check('4.2 un envío fallido no cuenta como avisado: el siguiente intento llega', !r1.enviado && r2.enviado === true, `${JSON.stringify(r1)} · ${JSON.stringify(r2)}`);
  robin.close();
}

// ── 5. Un PDF roto no se vuelve a abrir (ni a avisar) en cada pasada ───────────────────────────
console.log('\n5. Lo que no se puede leer se recuerda: no se reabre cada 15 minutos\n');
{
  const datos = path.join(base, 'datos5');
  const carpeta = path.join(base, 'Despacho5');
  fs.mkdirSync(path.join(carpeta, 'Caso'), { recursive: true });
  const roto = path.join(carpeta, 'Caso', 'escaneo.pdf');
  fs.writeFileSync(roto, Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(4000)]));
  fs.writeFileSync(path.join(carpeta, 'Caso', 'plantilla.docx'), 'esto no es un docx de verdad, solo texto suelto de 162 bytes '.repeat(2));
  const prog = `
const fs = await import('node:fs');
const { indexFolder } = await import(${url('server/indexer/indexer.js')});
const il = await import(${url('server/indexer/ilegibles.js')});
const log = ${JSON.stringify(path.join(datos, 'logs', 'robin-search.log'))};
const avisos = () => { try { return fs.readFileSync(log, 'utf8').split('\\n').filter((l) => l.includes('Documento que no se ha podido leer')).length; } catch { return 0; } };
const out = [];
for (let i = 0; i < 2; i++) { const a = avisos(); const r = await indexFolder({}); out.push({ danados: r.no_indexables?.danados ?? 0, recordados: r.ilegibles_recordados ?? 0, avisos: avisos() - a, errores: r.errores }); }
il.guardarYa();
fs.appendFileSync(${JSON.stringify(roto)}, 'cambiado');
{ const a = avisos(); const r = await indexFolder({}); out.push({ danados: r.no_indexables?.danados ?? 0, recordados: r.ilegibles_recordados ?? 0, avisos: avisos() - a }); }
il.guardarYa();
console.log(JSON.stringify(out));
process.exit(0);`;
  const out = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', prog], {
      env: { ...process.env, ROBIN_DATA_DIR: datos, ROBIN_FOLDER: carpeta, ROBIN_LOG_LEVEL: 'warn', ROBIN_OCR: 'false', ROBIN_DIAGNOSTICO_URL: 'off' },
    })
      .toString()
      .trim()
      .split('\n')
      .pop(),
  );
  check('5.1 1.ª pasada: los dos se intentan, se cuentan como dañados y se avisa una vez de cada uno', out[0].danados === 2 && out[0].avisos === 2 && out[0].recordados === 0, JSON.stringify(out[0]));
  check('5.2 2.ª pasada: se siguen contando, pero ni se reabren ni se repite el aviso', out[1].danados === 2 && out[1].recordados === 2 && out[1].avisos === 0, JSON.stringify(out[1]));
  check('5.3 si el fichero CAMBIA, se vuelve a intentar', out[2].avisos === 1 && out[2].recordados === 1, JSON.stringify(out[2]));
  const guardado = JSON.parse(fs.readFileSync(path.join(datos, 'ilegibles.json'), 'utf8'));
  check('5.4 lo recordado es solo local: código, tamaño, fecha y versión', Object.values(guardado).every((e) => /^ROBIN_FICHERO_/.test(e.code) && Number.isFinite(e.bytes) && e.version));
  const il = await imp('server/indexer/ilegibles.js');
  check('5.5 un PDF protegido NO se recuerda (puede llegar su contraseña)', il.seRecuerda('ROBIN_FICHERO_PDF_PROTEGIDO') === false && il.seRecuerda('ROBIN_FICHERO_PDF_ROTO') === true);
}

fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
const okN = results.filter(Boolean).length;
console.log(`\n${okN}/${results.length} comprobaciones OK`);
process.exit(okN === results.length ? 0 : 1);
