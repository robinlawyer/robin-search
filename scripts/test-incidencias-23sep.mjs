// ESCENARIO (tres informes del panel del 22-sep-2026, tres equipos Windows 11 DISTINTOS, ya con
// la 1.8.4 puesta): los tres traen `claude_log: "sin_fichero"`. La carpeta de registros de Claude
// se lee sin problema, pero dentro no hay NINGÚN «mcp-server-*.log» cuyo nombre contenga
// «robinsearch» —el nombre lo pone la instalación, no nosotros—, así que seguimos sin poder
// distinguir una marca huérfana de un cierre de Claude y toda reapertura del servidor vuelve a
// quedar como caída INCIERTA.
//
// ARREGLO: el servidor deja una HUELLA por stderr al quedar listo («robin-search: servidor listo
// (vX)»), que Claude guarda en ese fichero, y el diagnóstico reconoce nuestro registro por lo que
// DICE y no por cómo se llame. Se lee la cola solo de los «mcp-server-*.log» y solo cuando ningún
// nombre casa: de un registro ajeno no sale nada del equipo.
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-23sep-'));
const carpeta = path.join(base, 'Expedientes');
const logsClaude = path.join(base, 'logs-claude');
fs.mkdirSync(carpeta, { recursive: true }); fs.mkdirSync(logsClaude, { recursive: true });
process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_FOLDER = carpeta;
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_OCR = 'false';
process.env.ROBIN_CLAUDE_LOGS_DIR = logsClaude;
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);

// `estadoLogClaude()` se calcula UNA vez por proceso (en producción, una ejecución = un estado),
// así que cada escenario carga el módulo de nuevo para que lo vuelva a mirar.
const frescoN = { n: 0 };
const fresco = () =>
  import(`${pathToFileURL(path.join(REPO, 'server/diagnostico.js')).href}?v=${++frescoN.n}`);
const { claudeLaCerro, HUELLA_PROPIA } = await fresco();
const estado = async () => (await fresco()).estadoLogClaude();

// El servidor escribe la huella por stderr al quedar listo: si deja de hacerlo, nada de esto vale.
const index = fs.readFileSync(path.join(REPO, 'server/index.js'), 'utf8');
check('el servidor deja su huella en stderr al quedar listo',
  /process\.stderr\.write\(`robin-search: servidor listo/.test(index));

// ── 1. Carpeta legible pero ningún nombre que case: antes «sin_fichero» ───────────────────
const ciclo = (nombre) => fs.writeFileSync(path.join(logsClaude, nombre), [
  '2026-09-22T15:05:00.000Z [x] [info] Initializing server...',
  `2026-09-22T15:05:02.000Z [x] [info] ${HUELLA_PROPIA} servidor listo (v1.8.5)`,
  '2026-09-22T15:09:00.000Z [x] [info] Shutting down server...',
].join('\n') + '\n');

fs.writeFileSync(path.join(logsClaude, 'mcp-server-filesystem.log'), 'Initializing server...\nnada nuestro\n');
check('sin ningún registro nuestro, sigue siendo «sin_fichero»', (await estado()) === 'sin_fichero');

// ── 2. El mismo registro, con un nombre que la instalación puso a su manera ───────────────
ciclo('mcp-server-Despacho.log');
check('se reconoce POR CONTENIDO aunque el nombre no diga nada',
  (await estado()) === 'leido_por_contenido');

// Y con él delante se vuelve a poder decidir: esa ejecución la cerró Claude, no se cayó.
check('con el registro recuperado, «lo cerró Claude» deja de ser incierto',
  claudeLaCerro({ inicio: '2026-09-22T15:05:00.000Z', t: '2026-09-22T15:08:55.000Z' }) === true);

// ── 3. El nombre, cuando casa, sigue mandando (no se le lee la cola a nadie) ──────────────
ciclo('mcp-server-RobinSearch.log');
check('si el nombre casa, se lee por nombre y no por contenido', (await estado()) === 'leido');

// ── 4. Un registro ajeno NUNCA se adopta ──────────────────────────────────────────────────
fs.rmSync(path.join(logsClaude, 'mcp-server-RobinSearch.log'));
fs.rmSync(path.join(logsClaude, 'mcp-server-Despacho.log'));
fs.writeFileSync(path.join(logsClaude, 'mcp-server-otro.log'),
  'Initializing server...\nalgo de otro servidor\nShutting down server...\n');
check('un «mcp-server-*.log» ajeno no se adopta', (await estado()) === 'sin_fichero');

// ── 5. Sin carpeta que mirar, se distingue de «la miré y no estaba» ───────────────────────
fs.rmSync(logsClaude, { recursive: true, force: true });
check('sin carpeta de registros, «sin_carpeta»', (await estado()) === 'sin_carpeta');

fs.rmSync(base, { recursive: true, force: true });
const fallos = results.filter((r) => !r).length;
console.log(`\n${results.length - fallos}/${results.length} comprobaciones OK`);
process.exit(fallos ? 1 : 0);
