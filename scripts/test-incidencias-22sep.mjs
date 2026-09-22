// ESCENARIO (tres informes del panel el 22-sep-2026, mismo despacho, Windows 11, 1.8.3, 39.386
// documentos, en diez minutos):
//   · Dos «caída previa» —una leyendo un .xlsx de 20 KB— y una «1 fichero con error: EPERM …
//     rename». En ese equipo NO se pudo leer el registro de Claude, y sin él toda reapertura del
//     servidor por parte de Claude pasaba por CAÍDA: aviso técnico a hola@, el documento sano
//     apartado como sospechoso y, a la tercera, 39.386 documentos reindexados.
//   · El EPERM no era del documento del abogado: era el renombrado atómico de un fichero NUESTRO
//     (el índice), con el antivirus o la otra ventana de Claude teniéndolo abierto un momento.
//   · «Fallo en el re-escaneo de carpeta de red» cada 85 s cuando la causa era que el índice lo
//     tenía la otra instancia (y encima la carpeta era local).
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-22sep-'));
const carpeta = path.join(base, 'Expedientes');
const logsClaude = path.join(base, 'logs-claude');
fs.mkdirSync(carpeta, { recursive: true }); fs.mkdirSync(logsClaude, { recursive: true });
process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_FOLDER = carpeta;
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_OCR = 'false';
process.env.ROBIN_CLAUDE_LOGS_DIR = logsClaude;
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);

// ── 1. El registro de Claude se reconoce se llame como se llame ────────────────────────────
//
// El nombre lo pone Claude con el de la extensión instalada, y hasta la 1.8.3 se probaban DOS
// nombres exactos. En el equipo del 22-sep no coincidió ninguno.
const { esLogNuestro, claudeLaCerro } = await imp('server/diagnostico.js');
for (const n of ['mcp-server-RobinSearch.log', 'mcp-server-Robin Search.log', 'mcp-server-robin-search.log', 'mcp-server-robinsearch.log', 'mcp-server-Robin_Search.log']) {
  check(`«${n}» es nuestro`, esLogNuestro(n) === true);
}
for (const n of ['mcp-server-filesystem.log', 'main.log', 'mcp.log', 'mcp-server-RobinSearch.log.old', 'robinsearch.log']) {
  check(`«${n}» no es nuestro`, esLogNuestro(n) === false);
}

// ── 2. Sin registro de Claude: «no se sabe», nunca «se cayó» ───────────────────────────────
const marca = { inicio: '2026-09-22T08:39:00.000Z', t: '2026-09-22T08:42:55.000Z' };
check('sin ningún registro de Claude → null (no se sabe)', claudeLaCerro(marca) === null);

// Con el registro delante, se vuelve a decidir: lo cerró Claude para reabrirlo.
fs.writeFileSync(path.join(logsClaude, 'mcp-server-robin-search.log'), [
  '2026-09-22T08:39:00.000Z [robin-search] [info] Initializing server...',
  '2026-09-22T08:42:55.000Z [robin-search] [info] Shutting down server...',
  '2026-09-22T08:42:55.100Z [robin-search] [info] Server transport closed',
].join('\n'));
check('con el registro encontrado, el cierre de Claude deja de ser caída', claudeLaCerro(marca) === true);
fs.writeFileSync(path.join(logsClaude, 'mcp-server-robin-search.log'), [
  '2026-09-22T08:39:00.000Z [robin-search] [info] Initializing server...',
  '2026-09-22T08:42:55.000Z [robin-search] [info] Server transport closed',
].join('\n'));
check('y una muerte de verdad sigue siendo caída', claudeLaCerro(marca) === false);

// ── 3. Una caída INCIERTA no rehace el índice ──────────────────────────────────────────────
//
// Era la reacción cara: tres «caídas» seguidas al abrir el índice y se reindexan 39.386
// documentos. Con la de hoy, que ni siquiera se sabe si fue caída, no.
const diag = await imp('server/diagnostico.js');
const { VERSION } = await imp('server/config.js');
const rutaEstado = path.join(process.env.ROBIN_DATA_DIR, 'diagnostico.json');
fs.mkdirSync(path.dirname(rutaEstado), { recursive: true });
const ponerCaidas = (caidas) => fs.writeFileSync(rutaEstado, JSON.stringify({
  caidasSeguidas: caidas.length,
  caidas: caidas.map((c, i) => ({ fase: 'cargando_indice', t: `2026-09-22T08:0${i}:00.000Z`, version: VERSION, ...c })),
}));
const FASES = ['cargando_indice', 'migrando_indice'];
ponerCaidas([{ incierta: true }, { incierta: true }, { incierta: true }]);
check('tres caídas INCIERTAS no cuentan para rehacer el índice', diag.caidasSeguidasEn(FASES) === 0);
ponerCaidas([{ incierta: false }, { incierta: false }]);
check('dos caídas confirmadas siguen contando', diag.caidasSeguidasEn(FASES) === 2);
ponerCaidas([{ incierta: true }, { incierta: false }]);
check('la confirmada cuenta aunque venga detrás de una incierta', diag.caidasSeguidasEn(FASES) === 1);
fs.rmSync(rutaEstado, { force: true });

// ── 4. Un EPERM sobre un fichero NUESTRO no es un error del documento ──────────────────────
const { esIndiceOcupado } = await imp('server/indexer/indexer.js');
const { config } = await imp('server/config.js');
const nuestro = path.join(config.dataDir, 'docs', 'abc.meta.jsonl');
const suyo = path.join(carpeta, 'demanda.pdf');
check('EPERM renombrando un fichero del índice → es nuestro',
  esIndiceOcupado(Object.assign(new Error('EPERM'), { code: 'EPERM', path: `${nuestro}.tmp`, dest: nuestro })) === true);
check('EBUSY sobre un fichero del índice → es nuestro',
  esIndiceOcupado(Object.assign(new Error('EBUSY'), { code: 'EBUSY', path: nuestro })) === true);
check('EPERM sobre el documento del abogado → NO es nuestro (ahí sí hay algo que decirle)',
  esIndiceOcupado(Object.assign(new Error('EPERM'), { code: 'EPERM', path: suyo })) === false);
check('otro error dentro del índice (no es «ocupado») no se disfraza',
  esIndiceOcupado(Object.assign(new Error('ENOENT'), { code: 'ENOENT', path: nuestro })) === false);
check('un error sin ruta no se da por nuestro',
  esIndiceOcupado(Object.assign(new Error('EPERM'), { code: 'EPERM' })) === false);

// ── 5. De extremo a extremo: el índice ocupado no deja el documento fuera ──────────────────
//
// Con la carpeta del índice cerrada a cal y canto, el guardado falla con EACCES/EPERM sobre un
// fichero NUESTRO. Antes: «1 fichero con error» (y su aviso técnico) culpando a un .xlsx sano.
// Ahora: ni un error, se cuenta como reintentable, y la pasada siguiente lo mete de verdad.
if (process.platform !== 'win32' && process.getuid?.() !== 0) {
  const { indexFolder } = await imp('server/indexer/indexer.js');
  fs.writeFileSync(path.join(carpeta, 'informe.txt'), 'Informe pericial sobre la masa activa del concurso.');
  const { dirIndice } = await imp('server/search/store.js');
  const dirDocs = path.join(dirIndice(), 'docs');
  fs.mkdirSync(dirDocs, { recursive: true });
  fs.chmodSync(dirDocs, 0o500);
  let r1 = null;
  try {
    r1 = await indexFolder({ force: true });
  } finally {
    fs.chmodSync(dirDocs, 0o700);
  }
  check('con el índice ocupado NO se cuenta como error del documento', r1?.errores === 0, `errores=${r1?.errores}`);
  check('el documento queda como reintentable', (r1?.no_indexables?.reintentables || 0) >= 1, JSON.stringify(r1?.no_indexables));
  const r2 = await indexFolder({ force: false });
  check('la pasada siguiente sí lo indexa (no se pierde)', r2?.indexados >= 1, `indexados=${r2?.indexados}`);
} else {
  check('(omitido en este sistema) prueba de índice ocupado', true);
}

// ── 6. Una carpeta con ficheros sin bajar de la nube se cuenta como carpeta de nube ────────
//
// El informe del 22-sep decía «72 ficheros sin descargar de la nube» y «carpetas en la nube: 0»
// a la vez: OneDrive con las carpetas redirigidas no deja rastro ni en la ruta ni en el entorno.
{
  const nube = (await imp('server/indexer/nube.js')).default;
  const { carpetasResumenParaPruebas } = await imp('server/diagnostico.js');
  check('sin pendientes, la carpeta local no es de la nube', carpetasResumenParaPruebas().nube === 0);
  nube.apuntar(path.join(carpeta, 'escritura de contestación.docx'), 'sin_descargar');
  check('con un fichero pendiente de bajar, la carpeta SÍ se cuenta como de la nube',
    carpetasResumenParaPruebas().nube === 1, JSON.stringify(carpetasResumenParaPruebas()));
  nube._limpiarParaPrueba();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} comprobaciones OK`);
fs.rmSync(base, { recursive: true, force: true });
process.exit(results.every(Boolean) ? 0 : 1);
