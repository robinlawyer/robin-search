// ESCENARIOS (29-sep-2026):
//
//   A. gh-asesores (Windows, 45.000 documentos): abrir el índice tardaba de 4 a 8 minutos (una
//      apertura de fichero por documento, con el antivirus), y la instancia que solo busca releía
//      el catálogo entero, SÍNCRONO, cada vez que la otra escribía un documento. Ahora: catálogo
//      guardado + UN listado de la carpeta al abrir, y un diario de cambios para la lectora.
//   B. Mac de Eduardo: una RobinSearch 1.4.0 (índice vectra en index/index.json) arrancaba cada
//      noche a las 01:30 con `--silent` y desde Claude. El índice nuevo no se puede pisar (cepo),
//      el index.json que reaparece se aparta sin migrarlo y sus documentos se reindexan, y los
//      lanzadores de versiones antiguas —y SOLO esos— se desactivan con copia.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-antigua-'));
const url = (p) => pathToFileURL(path.join(REPO, p)).href;
const storeUrl = JSON.stringify(url('server/search/store.js'));
const baseEnv = { ...process.env, ROBIN_LOG_LEVEL: 'error', ROBIN_DIAGNOSTICO_URL: 'off', ROBIN_NO_TOCAR_VERSIONES_ANTIGUAS: '1' };

// Otro proceso con el store (la «otra instancia»).
function enOtroProceso(datos, codigo, extra = {}) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', `const store = await import(${storeUrl});\n${codigo}`], {
    env: { ...baseEnv, ROBIN_DATA_DIR: datos, ...extra },
  }).toString();
}
const vec = (i, dim = 8) => Array.from({ length: dim }, (_, k) => Math.sin(i + k));
const docIdDe = (i) => `d${String(i).padStart(6, '0')}`;

// ───────────────────────────── A. Catálogo ─────────────────────────────
console.log('\nA. Abrir el índice sin abrir cada documento\n');
const datosA = path.join(base, 'A');
const N = Number(process.env.ROBIN_PRUEBA_CATALOGO_DOCS) || 2000;
enOtroProceso(
  datosA,
  `await store.abrir({ migrar: true });
for (let d = 0; d < ${N}; d++) {
  const id = 'd' + String(d).padStart(6, '0');
  await store.reemplazarDoc(id, [0, 1].map((c) => ({ chunkId: c, vector: Array.from({ length: 8 }, (_, k) => Math.sin(d + c + k)), metadata: { texto: 'v1 ' + d + '-' + c, fichero: id + '.txt', rutaRelativa: 'E/' + id + '.txt', expediente: 'E', raiz: 'E' } })));
}
store.guardarCatalogoPendiente();`,
);
const catalogo = path.join(datosA, 'indice', 'catalogo.jsonl');
check('A.1 la escritora deja el catálogo guardado', fs.existsSync(catalogo) && fs.readFileSync(catalogo, 'utf8').endsWith('#fin\n'));

const abrirYContar = (migrar = false) =>
  JSON.parse(
    enOtroProceso(datosA, `const r = await store.abrir({ migrar: ${migrar} }); console.log(JSON.stringify({ docs: r.documentos, frag: r.fragmentos, ap: r.apertura }));`),
  );
let a = abrirYContar();
check('A.2 abrir con el catálogo guardado no abre NINGUNA cabecera', a.docs === N && a.frag === 2 * N && a.ap.cabecerasLeidas === 0 && a.ap.desdeCatalogo, JSON.stringify(a));

// Cambios que el catálogo guardado no conoce (escritos sin guardarlo): se ven con el listado.
try { enOtroProceso(
  datosA,
  `await store.abrir({ migrar: false });
await store.reemplazarDoc('d000005', [{ chunkId: 0, vector: Array.from({ length: 8 }, () => 1), metadata: { texto: 'v2 cinco', fichero: 'd000005.txt', rutaRelativa: 'E/d000005.txt', expediente: 'E', raiz: 'E' } }]);
await store.deleteByDoc('d000007');
await store.reemplazarDoc('nuevo1', [{ chunkId: 0, vector: Array.from({ length: 8 }, () => 1), metadata: { texto: 'nuevo', fichero: 'n.txt', rutaRelativa: 'E/n.txt', expediente: 'E', raiz: 'E' } }]);
process.kill(process.pid, 'SIGKILL'); // un corte: el catálogo guardado se queda VIEJO`,
  { ROBIN_CATALOGO_GUARDAR_MS: '600000' },
); } catch { /* muerto a propósito */ }
const r2 = JSON.parse(
  enOtroProceso(
    datosA,
    `const r = await store.abrir({ migrar: false });
const c5 = await store.getDocChunks('d000005');
console.log(JSON.stringify({ docs: r.documentos, ap: r.apertura, c5: c5.map((m) => m.texto), d7: store.cabecera('d000007'), n1: Boolean(store.cabecera('nuevo1')) }));`,
  ),
);
check('A.3 lo reescrito, lo borrado y lo nuevo se ven, abriendo solo esas cabeceras',
  r2.docs === N && r2.c5[0] === 'v2 cinco' && r2.d7 === null && r2.n1 && r2.ap.cabecerasLeidas >= 1 && r2.ap.cabecerasLeidas <= 2, JSON.stringify({ docs: r2.docs, leidas: r2.ap.cabecerasLeidas }));

// Un catálogo de otra época (cortado, o de antes de estos cambios) no engaña.
const viejoTexto = fs.readFileSync(catalogo, 'utf8');
fs.writeFileSync(catalogo, viejoTexto.slice(0, Math.floor(viejoTexto.length / 2)));
a = abrirYContar();
check('A.4 un catálogo CORTADO se descarta entero y se reconstruye abriendo cabeceras', a.docs === N && !a.ap.desdeCatalogo && a.ap.cabecerasLeidas === N, JSON.stringify(a.ap));
const lineas = viejoTexto.split('\n');
const i5 = lineas.findIndex((l) => l.startsWith('["d000009"'));
lineas[i5] = lineas[i5].replace(/"[0-9a-f]{12}"/, '"000000000000"'); // generación que ya no existe
fs.writeFileSync(catalogo, lineas.join('\n'));
const r4 = JSON.parse(enOtroProceso(datosA, `const r = await store.abrir({ migrar: false }); const c = await store.getDocChunks('d000009'); console.log(JSON.stringify({ ap: r.apertura, t: c.map((m) => m.texto) }));`));
check('A.5 una generación del catálogo que no casa con el disco se relee (nunca se sirve mezclada)', r4.t[0] === 'v1 9-0' && r4.ap.cabecerasLeidas >= 1, JSON.stringify(r4));

// La lectora al día por el DIARIO, sin releer el catálogo.
console.log('\nA bis. La instancia que solo busca, mientras la otra escribe\n');
process.env.ROBIN_DATA_DIR = datosA;
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_CATALOGO_COMPLETA_MS = '1500';
const store = await import(url('server/search/store.js'));
await store.abrir({ migrar: false });
const antes = store.estadisticasCatalogo();
let maxRetraso = 0;
let previo = Date.now();
const vigia = setInterval(() => {
  const ahora = Date.now();
  maxRetraso = Math.max(maxRetraso, ahora - previo - 10);
  previo = ahora;
}, 10);
enOtroProceso(
  datosA,
  `await store.abrir({ migrar: false });
for (const id of ['d000100', 'd000101', 'd000102']) await store.reemplazarDoc(id, [{ chunkId: 0, vector: Array.from({ length: 8 }, () => 2), metadata: { texto: 'v3 ' + id, fichero: id + '.txt', rutaRelativa: 'E/' + id + '.txt', expediente: 'E', raiz: 'E' } }]);
await store.deleteByDoc('d000103');`,
);
previo = Date.now();
maxRetraso = 0;
const leido = await store.getDocChunks('d000101');
const tras = store.estadisticasCatalogo();
check('A.6 la lectora ve lo que escribe la otra instancia', leido[0]?.texto === 'v3 d000101' && store.cabecera('d000103') === null);
check('A.7 y se pone al día por el diario: 4 cabeceras releídas, ningún listado completo',
  tras.incrementales > antes.incrementales && tras.completas === antes.completas && tras.cabecerasReleidas - antes.cabecerasReleidas === 4,
  JSON.stringify({ antes, tras }));
const r5 = await store.query(vec(1), 3);
check('A.8 buscar sigue funcionando sobre la foto refrescada', r5.length === 3);

// Una escritora SIN diario (una versión anterior): la lectora la ve con el listado completo, a su hora.
const docsDir = path.join(datosA, 'indice', 'docs');
const cab200 = store.cabecera('d000200');
const lineas200 = fs.readFileSync(path.join(docsDir, 'd000200.jsonl'), 'utf8').split('\n');
fs.rmSync(path.join(docsDir, 'd000200.jsonl'));
store.resumen(); // pide el refresco y contesta con lo que hay, sin bloquear
check('A.9 las consultas síncronas no se quedan esperando a releer', store.cabecera('d000201') !== null);
let desaparecido = false;
for (let i = 0; i < 40 && !desaparecido; i++) {
  await espera(100);
  await store.getChunk('d000201', 0);
  desaparecido = store.cabecera('d000200') === null;
}
check('A.10 un cambio SIN anotar en el diario se ve igual (listado completo en segundo plano, con tope de frecuencia)', desaparecido && store.estadisticasCatalogo().completas > tras.completas);
fs.writeFileSync(path.join(docsDir, 'd000200.jsonl'), lineas200.join('\n'));
clearInterval(vigia);
check('A.11 ningún refresco ha parado el proceso más de 250 ms', maxRetraso < 250, `max=${maxRetraso} ms`);
void cab200;

// ───────────────────────────── B. Versión antigua ─────────────────────────────
console.log('\nB. Una versión anterior a la 1.4.5 que sigue viva\n');
const datosB = path.join(base, 'B');
const carpetaB = path.join(base, 'ExpB');
fs.mkdirSync(carpetaB, { recursive: true });
const vectraJson = (docs) => {
  const items = docs.map(([docId, texto]) => ({ id: `${docId}::0`, vector: vec(3), metadata: { docId, chunkId: 0, texto, rutaRelativa: `ExpB/${docId}.txt` } }));
  fs.rmSync(path.join(datosB, 'index', 'index.json'), { recursive: true, force: true });
  fs.mkdirSync(path.join(datosB, 'index'), { recursive: true });
  fs.writeFileSync(path.join(datosB, 'index', 'index.json'), JSON.stringify({ version: 1, metadata_config: {}, items }));
};
vectraJson([['aaa1', 'uno'], ['ccc1', 'viejo']]);
let rb = JSON.parse(enOtroProceso(datosB, `const r = await store.abrir({ migrar: true }); console.log(JSON.stringify({ docs: r.documentos, m: r.migracion }));`));
const idx = path.join(datosB, 'index', 'index.json');
check('B.1 el primer paso migra y deja el CEPO: index/index.json es una carpeta', rb.docs === 2 && rb.m?.repetida === false && fs.statSync(idx).isDirectory());
// Lo que hace vectra 0.9.0 (1.0-1.4.4): isIndexCreated = fs.access, loadIndex = readFile,
// endUpdate = writeFile. Con el cepo: «creado», pero ni se lee ni se escribe.
let accede = true;
try {
  fs.accessSync(idx);
} catch {
  accede = false;
}
const codigo = (fn) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e.code;
  }
};
check('B.2 una versión antigua da el índice por creado pero no puede leerlo ni escribirlo (EISDIR)',
  accede && codigo(() => fs.readFileSync(idx)) === 'EISDIR' && codigo(() => fs.writeFileSync(idx, '{}')) === 'EISDIR');

// Registro con ccc1 indexado con el mismo nº de fragmentos: el cotejo solo no lo reindexaría.
const absCcc = path.join(carpetaB, 'ccc1.txt');
const absAaa = path.join(carpetaB, 'aaa1.txt');
fs.writeFileSync(absCcc, 'nuevo contenido');
fs.writeFileSync(absAaa, 'uno');
const entrada = (docId, abs) => ({ docId, raiz: 'ExpB', rutaRelativa: `ExpB/${path.basename(abs)}`, expediente: 'ExpB', size: fs.statSync(abs).size, mtimeMs: fs.statSync(abs).mtimeMs, numChunks: 1, sinOcr: false });
fs.writeFileSync(path.join(datosB, 'files.json'), JSON.stringify({ [absCcc]: entrada('ccc1', absCcc), [absAaa]: entrada('aaa1', absAaa) }));
vectraJson([['ccc1', 'lo que indexó la 1.4.0']]); // reaparece (cepo quitado)
const salida = execFileSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `const { bootstrap } = await import(${JSON.stringify(url('server/bootstrap.js'))});
const registry = await import(${JSON.stringify(url('server/indexer/registry.js'))});
const store = await import(${storeUrl});
await bootstrap({ initialIndex: false, watch: false, warmModel: false });
console.log(JSON.stringify({ docs: store.resumen().documentos, ccc: registry.get(${JSON.stringify(absCcc)}), aaa: Boolean(registry.get(${JSON.stringify(absAaa)})), texto: (await store.getDocChunks('ccc1'))[0]?.texto }));
process.exit(0);`,
  ],
  { env: { ...baseEnv, ROBIN_DATA_DIR: datosB, ROBIN_FOLDER: carpetaB, ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no', ROBIN_OAUTH_ISSUER: 'http://127.0.0.1:9', ROBIN_OCR: 'false' } },
).toString();
rb = JSON.parse(salida.trim().split('\n').pop());
// Lo de ccc1 que había en el índice actual es el contenido de ANTES: sin entrada en el registro
// queda huérfano y sale hasta que el indexado lo vuelva a leer del original.
check('B.3 el index.json que reaparece NO se migra: ni su contenido entra, ni se sirve el de antes', rb.texto === undefined && rb.docs === 1, JSON.stringify(rb));
check('B.4 y sus documentos salen del registro para reindexarse DESDE EL ORIGINAL', rb.ccc === null && rb.aaa === true);
check('B.5 se aparta (una copia) y el cepo vuelve a su sitio', fs.statSync(idx).isDirectory() && fs.existsSync(path.join(datosB, 'index', 'apartado-por-version-antigua.json')));

// ── Lanzadores ──
console.log('\nC. Lanzadores de versiones antiguas: solo los nuestros y solo los antiguos\n');
const va = await import(url('server/version-antigua.js'));
const home = path.join(base, 'home');
const dataC = path.join(base, 'datosC');
const instalar = (dir, version, { manifest = false, author = 'RobinLawyer.ai' } = {}) => {
  fs.mkdirSync(path.join(dir, 'cli'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'cli', 'index.js'), '// cli');
  if (manifest) fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'robin-search', version, author: { name: author } }));
  else fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@robinlawyer/robin-search', version }));
};
const vieja = path.join(home, 'robin-search-1.4.0');
const nueva = path.join(home, 'robin-search-1.9.1');
const ajena = path.join(home, 'robinhood-bot');
instalar(vieja, '1.4.0');
instalar(nueva, '1.9.1');
fs.mkdirSync(ajena, { recursive: true });
fs.writeFileSync(path.join(ajena, 'package.json'), JSON.stringify({ name: 'robinhood-bot', version: '1.0.0' }));
fs.writeFileSync(path.join(ajena, 'index.js'), '');
const plist = (label, args) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args
    .map((x) => `<string>${x.replace(/&/g, '&amp;')}</string>`)
    .join('')}</array><key>StartCalendarInterval</key><dict><key>Hour</key><integer>1</integer><key>Minute</key><integer>30</integer></dict></dict></plist>\n`;
const LA = path.join(home, 'Library', 'LaunchAgents');
fs.mkdirSync(LA, { recursive: true });
fs.writeFileSync(path.join(LA, 'com.despacho.robin.plist'), plist('com.despacho.robin', ['/usr/local/bin/node', `${vieja}/cli/index.js`, '--silent', '--folder=/Users/x/Expedientes']));
fs.writeFileSync(path.join(LA, 'com.despacho.robin-nueva.plist'), plist('com.despacho.robin-nueva', ['/usr/local/bin/node', `${nueva}/cli/index.js`, '--silent']));
fs.writeFileSync(path.join(LA, 'com.despacho.robinhood.plist'), plist('com.despacho.robinhood', ['/usr/local/bin/node', `${ajena}/index.js`]));
fs.writeFileSync(path.join(LA, 'com.despacho.shell.plist'), plist('com.despacho.shell', ['/bin/sh', '-c', `cd ${vieja} && node cli/index.js index`]));
// Claude: extensión vieja con otro id, la actual, y una homónima de otro autor.
const claude = path.join(home, 'Library', 'Application Support', 'Claude');
instalar(path.join(claude, 'Claude Extensions', 'local.mcpb.robin-lawyer.robin-search'), '1.4.0', { manifest: true, author: 'Robin Lawyer' });
instalar(path.join(claude, 'Claude Extensions', 'local.mcpb.robinlawyer.ai.robin-search'), '1.9.1', { manifest: true });
instalar(path.join(claude, 'Claude Extensions', 'local.mcpb.otro.robin-search'), '1.0.0', { manifest: true, author: 'Otro' });
fs.mkdirSync(path.join(claude, 'Claude Extensions Settings'), { recursive: true });
fs.writeFileSync(path.join(claude, 'Claude Extensions Settings', 'local.mcpb.robin-lawyer.robin-search.json'), JSON.stringify({ isEnabled: true, userConfig: { robin_folders: [] } }));
fs.writeFileSync(
  path.join(claude, 'claude_desktop_config.json'),
  JSON.stringify({ mcpServers: { 'robin-search': { command: 'node', args: [`${vieja}/cli/index.js`] }, otro: { command: 'npx', args: ['otro-mcp'] } }, preferencias: { x: 1 } }),
);
fs.writeFileSync(
  path.join(home, '.claude.json'),
  JSON.stringify({ numStartups: 7, mcpServers: { robin: { command: 'npx', args: ['-y', '@robinlawyer/robin-search@1.3.1'] } }, projects: { '/p': { mcpServers: { robin: { command: 'node', args: [`${nueva}/cli/index.js`] } } } } }),
);
const CRON = [
  '0 * * * * /usr/bin/python3 /Users/x/otra-cosa.py',
  `30 1 * * * /usr/local/bin/node ${vieja}/cli/index.js --silent --folder=/Users/x/Expedientes`,
  `45 1 * * * /usr/local/bin/node ${nueva}/cli/index.js --silent`,
  '',
].join('\n');
let cronEscrito = null;
const llamadas = [];
const ejecutar = async (cmd, args, o = {}) => {
  llamadas.push([cmd, ...args].join(' '));
  if (cmd === 'crontab' && args[0] === '-l') return { code: 0, stdout: cronEscrito ?? CRON };
  if (cmd === 'crontab' && args[0] === '-') {
    cronEscrito = o.input;
    return { code: 0, stdout: '' };
  }
  return { code: 0, stdout: '' };
};
const res = await va.neutralizarVersionesAntiguas({ home, plataforma: 'darwin', ejecutar, dataDir: dataC, env: {} });
const tipos = res.desactivados.map((d) => `${d.tipo}:${d.version}`).sort();
check('C.1 se desactivan exactamente los lanzadores de versiones antiguas',
  JSON.stringify(tipos) === JSON.stringify(['cron:1.4.0', 'extension_claude:1.4.0', 'launchd:1.4.0', 'launchd:1.4.0', 'mcp_claude_code:1.3.1', 'mcp_claude_desktop:1.4.0']) && res.fallos.length === 0,
  JSON.stringify({ tipos, fallos: res.fallos }));
check('C.2 launchd: la tarea vieja se descarga y su .plist sale de LaunchAgents (con copia); la nueva y la ajena siguen',
  !fs.existsSync(path.join(LA, 'com.despacho.robin.plist')) && !fs.existsSync(path.join(LA, 'com.despacho.shell.plist')) &&
    fs.existsSync(path.join(LA, 'com.despacho.robin-nueva.plist')) && fs.existsSync(path.join(LA, 'com.despacho.robinhood.plist')) &&
    llamadas.some((l) => l.startsWith('launchctl bootout') && l.includes('com.despacho.robin.plist')) &&
    fs.readdirSync(path.join(dataC, 'version-antigua')).some((n) => n.startsWith('com.despacho.robin.plist.')));
const cronTrasPrimera = cronEscrito;
const cronL = (cronEscrito || '').split('\n');
check('C.3 crontab: solo la línea de la 1.4.0 queda comentada; las demás, intactas',
  cronL[0] === '0 * * * * /usr/bin/python3 /Users/x/otra-cosa.py' && cronL[1].startsWith('# [desactivado por RobinSearch') && cronL[1].endsWith(CRON.split('\n')[1]) && cronL[2] === CRON.split('\n')[2] && cronTrasPrimera.endsWith('\n'));
const aj = (id) => JSON.parse(fs.readFileSync(path.join(claude, 'Claude Extensions Settings', `${id}.json`), 'utf8'));
check('C.4 Claude: la extensión vieja se APAGA (su interruptor), conservando sus ajustes; la actual y la de otro autor no se tocan',
  aj('local.mcpb.robin-lawyer.robin-search').isEnabled === false && Array.isArray(aj('local.mcpb.robin-lawyer.robin-search').userConfig?.robin_folders) &&
    !fs.existsSync(path.join(claude, 'Claude Extensions Settings', 'local.mcpb.robinlawyer.ai.robin-search.json')) &&
    !fs.existsSync(path.join(claude, 'Claude Extensions Settings', 'local.mcpb.otro.robin-search.json')));
const cd = JSON.parse(fs.readFileSync(path.join(claude, 'claude_desktop_config.json'), 'utf8'));
const cc = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
check('C.5 configuración MCP: se retira la entrada de la copia vieja (y la de npx con versión vieja); lo demás queda igual',
  !cd.mcpServers['robin-search'] && cd.mcpServers.otro && cd.preferencias?.x === 1 && !cc.mcpServers.robin && cc.numStartups === 7 && cc.projects['/p'].mcpServers.robin);
const res2 = await va.neutralizarVersionesAntiguas({ home, plataforma: 'darwin', ejecutar, dataDir: dataC, env: {} });
check('C.6 una segunda pasada no encuentra nada que hacer', res2.desactivados.length === 0 && res2.fallos.length === 0, JSON.stringify(res2.desactivados));

// Windows: Programador de tareas.
const psSalida = JSON.stringify([
  { n: 'RobinSearch nocturno', p: '\\', e: 'node.exe', a: `"${vieja}/cli/index.js" --silent`, w: null },
  { n: 'Robin nueva', p: '\\Despacho\\', e: 'node.exe', a: `"${nueva}/cli/index.js" --silent`, w: null },
  { n: 'Robinhood', p: '\\', e: 'node.exe', a: `${ajena}/index.js`, w: null },
]);
const ps = [];
const resW = await va.neutralizarVersionesAntiguas({
  home: path.join(base, 'homeW'),
  plataforma: 'win32',
  dataDir: dataC,
  env: {},
  ejecutar: async (cmd, args) => {
    ps.push(args.join(' '));
    return { code: 0, stdout: args.join(' ').includes('Get-ScheduledTask') ? psSalida : '' };
  },
});
check('C.7 Windows: solo la tarea de la versión vieja se deshabilita',
  resW.desactivados.length === 1 && resW.desactivados[0].tipo === 'tarea_windows' && ps.filter((x) => x.includes('Disable-ScheduledTask')).length === 1 &&
    ps.some((x) => x.includes("Disable-ScheduledTask -TaskName 'RobinSearch nocturno' -TaskPath '\\'")), JSON.stringify(ps));
check('C.8 versiones: 1.4.4 antigua, 1.4.5 y 1.10.0 no', va.esAntigua('1.4.4') && !va.esAntigua('1.4.5') && !va.esAntigua('1.10.0') && !va.esAntigua(null));

const boot = fs.readFileSync(path.join(REPO, 'server/bootstrap.js'), 'utf8');
check('C.9 el arranque lo hace solo en la instancia que escribe, en segundo plano, y lo avisa',
  /if \(escribo\) programarRevisionVersionesAntiguas\(\)/.test(boot) && /version_antigua_desactivada/.test(boot) && /t\.unref\?\.\(\)/.test(boot));

fs.rmSync(base, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok === results.length ? 0 : 1);
