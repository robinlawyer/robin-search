// ESCENARIOS (informes del panel del 24-sep al 1-oct-2026):
//
//   1. Mac de Eduardo, 1-oct: «se cortó sin cerrar cargando el modelo» de un proceso que NO
//      aparecía en el registro del servidor de Claude. Claude Desktop lanza el servidor por dos
//      caminos: el de los chats («Initializing server» en mcp-server-*.log) y el de las sesiones
//      de Cowork y Code (LocalMcpServerManager), que SOLO escribe en main.log, en hora local y al
//      segundo. Un proceso del segundo camino cerrado por Claude se daba por CAÍDA.
//   2. El proceso de SONDEO: al lanzar, Claude arranca uno, dictamina «Era probe verdict: legacy»
//      y lanza otro; el descartado no deja «Shutting down».
//   3. Windows (tres equipos) con `claude_log: sin_fichero`: si hay main.log con nuestro servidor,
//      se decide con él.
//   4. Un registro que Claude no toca desde antes de lanzar el proceso no puede contar cómo acabó.
//   5. Windows, 29 y 30-sep: «1 ficheros con error; causa principal: Page dictionary kid reference
//      points to wrong type of object.» Un PDF con una rama del árbol de páginas que no apunta a
//      una página: pdfjs lo abría, fallaba al pedir la página y el documento entero se perdía.
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
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-2oct-'));
const logsClaude = path.join(base, 'logs-claude');
const datos = path.join(base, 'datos');
fs.mkdirSync(logsClaude, { recursive: true });
fs.mkdirSync(path.join(datos, 'logs'), { recursive: true });
process.env.ROBIN_DATA_DIR = datos;
process.env.ROBIN_FOLDER = path.join(base, 'Expedientes');
fs.mkdirSync(process.env.ROBIN_FOLDER, { recursive: true });
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_OCR = 'false';
process.env.ROBIN_CLAUDE_LOGS_DIR = logsClaude;
const url = (p) => pathToFileURL(path.join(REPO, p)).href;
let n = 0;
const fresco = () => import(`${url('server/diagnostico.js')}?v=${++n}`);
const escribir = (nombre, lineas) => fs.writeFileSync(path.join(logsClaude, nombre), lineas.join('\n') + '\n');
const vaciar = () => {
  for (const f of fs.readdirSync(logsClaude)) fs.rmSync(path.join(logsClaude, f));
};
// main.log de Claude: hora LOCAL, al segundo, como la escribe Claude.
const dos = (x) => String(x).padStart(2, '0');
const local = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
};

const d0 = await fresco();

// ── 1. El camino de Cowork/Code (LocalMcpServerManager) ─────────────────────────────────────
console.log('\n1. Proceso lanzado por LocalMcpServerManager (solo en main.log)\n');
// Lo visto en un Mac con Claude 2.16120 (1-oct): al abrir la aplicación, LocalMcpServerManager
// lanza un servidor a las 16:40:49 y el de los chats otro a las 16:41:01.
const mainCowork = [
  `${local('2026-10-01T16:40:49.000Z')} [info] [LocalMcpServerManager] Connecting to RobinSearch`,
  `${local('2026-10-01T16:40:49.000Z')} [info] [LocalMcpServerManager] Using built-in Node.js for MCP server: RobinSearch`,
  `${local('2026-10-01T16:40:51.000Z')} [info] [UtilityProcess stderr] robin-search: servidor listo (v1.9.0)`,
  `${local('2026-10-01T16:40:52.000Z')} [info] [LocalMcpServerManager] Connected to RobinSearch (16 tools)`,
  `${local('2026-10-01T16:41:01.000Z')} [info] Launching MCP Server: RobinSearch`,
  `${local('2026-10-01T17:01:21.000Z')} [info] [LocalMcpServerManager] Closing RobinSearch`,
  `${local('2026-10-01T17:01:21.000Z')} [info] Shutting down MCP Server: RobinSearch`,
  `${local('2026-10-01T17:01:21.000Z')} [warn] [LocalMcpServerManager] RobinSearch disconnected`,
];
const servidor = [
  '2026-10-01T16:41:01.893Z [RobinSearch] [info] Initializing server... { metadata: undefined }',
  '2026-10-01T16:41:01.895Z [RobinSearch] [info] Using built-in Node.js for MCP server: RobinSearch { metadata: undefined }',
  '2026-10-01T16:41:06.152Z [RobinSearch] [info] Era probe verdict: legacy (sibling did not complete the exchange) { metadata: undefined }',
  '2026-10-01T16:41:06.438Z [RobinSearch] [info] Using built-in Node.js for MCP server: RobinSearch { metadata: undefined }',
  '2026-10-01T16:41:07.232Z [RobinSearch] [info] Server started and connected successfully { metadata: undefined }',
  '2026-10-01T17:01:21.709Z [RobinSearch] [info] Shutting down server... { metadata: undefined }',
  '2026-10-01T17:01:21.711Z [RobinSearch] [info] Server transport closed (intentional shutdown) { metadata: undefined }',
  '2026-10-01T17:01:21.748Z [RobinSearch] [info] Server transport closed { metadata: undefined }',
];
const proc = (iso) => ({ inicio: iso });
check('1.1 proceso de Cowork/Code cerrado por Claude: NO es caída',
  d0.claudeLaCerro(proc('2026-10-01T16:40:50.100Z'), [...servidor, ...mainCowork]) === true);
check('1.2 antes (sin main.log) el mismo proceso pasaba por caída: no hay lanzamiento que case',
  d0.claudeLaCerro(proc('2026-10-01T16:40:50.100Z'), servidor) === false);
check('1.3 el proceso del chat sigue decidiéndose con su registro',
  d0.claudeLaCerro(proc('2026-10-01T16:41:06.600Z'), [...servidor, ...mainCowork]) === true);
const coworkMuerto = [
  `${local('2026-10-01T09:00:00.000Z')} [info] [LocalMcpServerManager] Connecting to RobinSearch`,
  `${local('2026-10-01T09:10:00.000Z')} [warn] [LocalMcpServerManager] RobinSearch disconnected`,
];
check('1.4 un proceso de Cowork/Code que murió solo («disconnected» sin «Closing») sigue siendo caída',
  d0.claudeLaCerro(proc('2026-10-01T09:00:01.500Z'), coworkMuerto) === false);
check('1.5 el cierre de OTRO canal no tapa la caída (chat cierra, el de Cowork muere después)',
  d0.claudeLaCerro(proc('2026-10-01T09:00:01.500Z'), [
    ...coworkMuerto,
    '2026-10-01T08:59:58.000Z [RobinSearch] [info] Initializing server...',
    '2026-10-01T09:05:00.000Z [RobinSearch] [info] Shutting down server...',
  ]) === false);
check('1.6 «connected after closeAll; reaping» es un cierre de Claude',
  d0.claudeLaCerro(proc('2026-10-01T10:00:01.200Z'), [
    `${local('2026-10-01T10:00:00.000Z')} [info] [LocalMcpServerManager] Connecting to RobinSearch`,
    `${local('2026-10-01T10:00:06.000Z')} [warn] [LocalMcpServerManager] RobinSearch connected after closeAll; reaping`,
  ]) === true);
check('1.7 lo de otro servidor en main.log no cuenta',
  d0.eventoDeLinea(`${local('2026-10-01T10:00:00.000Z')} [info] [LocalMcpServerManager] Closing filesystem`, { soloNuestras: true }) === null &&
  d0.eventoDeLinea(`${local('2026-10-01T10:00:00.000Z')} [info] [LocalMcpServerManager] Closing Robin Search`, { soloNuestras: true })?.tipo === 'cierre');
check('1.8 la hora de main.log es LOCAL',
  d0.horaDeLinea(`${local('2026-10-01T16:40:49.000Z')} [info] x`)?.t === Date.parse('2026-10-01T16:40:49.000Z'));

// ── 2. El proceso de sondeo ─────────────────────────────────────────────────────────────────
console.log('\n2. El proceso de sondeo que Claude descarta\n');
check('2.1 nacido entre el lanzamiento y el veredicto: lo descartó Claude, no es caída',
  d0.claudeLaCerro(proc('2026-10-01T16:41:02.300Z'), servidor) === true);
const relanzadoMuerto = [
  '2026-10-01T12:00:00.000Z [RobinSearch] [info] Initializing server...',
  '2026-10-01T12:00:04.000Z [RobinSearch] [info] Era probe verdict: legacy (sibling did not complete the exchange)',
  '2026-10-01T12:30:00.000Z [RobinSearch] [info] Server transport closed',
];
check('2.2 el relanzado tras el veredicto no hereda ese descarte: si muere solo, es caída',
  d0.claudeLaCerro(proc('2026-10-01T12:00:04.500Z'), relanzadoMuerto) === false);

// ── 3. Solo main.log (Windows sin registro del servidor) ────────────────────────────────────
console.log('\n3. Sin registro del servidor, con main.log\n');
vaciar();
escribir('main.log', mainCowork);
let d = await fresco();
check('3.1 se lee main.log', d.estadoLogClaude() === 'leido_main_log', d.estadoLogClaude());
check('3.2 el detalle lo dice (solo sí/no)', d.detalleLogClaude()?.main_log_nuestro === true);
check('3.3 con main.log solo se decide el proceso del chat (Launching … Shutting down MCP Server)',
  d.claudeLaCerro(proc('2026-10-01T16:41:01.500Z')) === true);
check('3.4 y el de Cowork/Code', d.claudeLaCerro(proc('2026-10-01T16:40:50.100Z')) === true);
// Lo que viaja en el informe: los lanzamientos y cierres de main.log, con la hora en UTC.
const reg = d.registroSaneado().filter((l) => l.level === 'claude');
check('3.5 el informe lleva las líneas de main.log de nuestro servidor', reg.some((l) => /\[main\].*LocalMcpServerManager\] Closing RobinSearch/.test(l.msg) && l.t === '2026-10-01T17:01:21.000Z'),
  JSON.stringify(reg.slice(0, 3)));
check('3.6 y nada más de main.log (ni el stderr del servidor)', reg.every((l) => !/servidor listo|UtilityProcess/.test(l.msg)));
vaciar();
escribir('main.log', [`${local('2026-10-01T10:00:00.000Z')} [info] [UtilityProcess stderr] robin-search: servidor listo (v1.9.0)`]);
d = await fresco();
check('3.7 un main.log sin lanzamientos ni cierres nuestros no basta: sin_fichero', d.estadoLogClaude() === 'sin_fichero');
check('3.8 … y sin registro, «no se sabe»', d.claudeLaCerro(proc('2026-10-01T10:00:01.000Z')) === null);

// ── 4. Registro viejo ───────────────────────────────────────────────────────────────────────
console.log('\n4. Un registro que Claude ya no escribe\n');
vaciar();
escribir('mcp-server-RobinSearch.log', ['2026-09-10T10:00:00.000Z [RobinSearch] [info] Initializing server...']);
const viejo = new Date('2026-09-10T10:00:05.000Z');
fs.utimesSync(path.join(logsClaude, 'mcp-server-RobinSearch.log'), viejo, viejo);
d = await fresco();
check('4.1 un registro sin tocar desde antes de lanzar el proceso: «no se sabe», no «caída»',
  d.claudeLaCerro(proc('2026-10-01T10:00:01.000Z')) === null);
fs.utimesSync(path.join(logsClaude, 'mcp-server-RobinSearch.log'), new Date(), new Date());
check('4.2 si Claude sí lo escribe y no menciona el arranque, sigue siendo caída (lo lanzó otro)',
  d.claudeLaCerro(proc('2026-10-01T10:00:01.000Z')) === false);

// ── 5. PDF con el árbol de páginas roto ─────────────────────────────────────────────────────
console.log('\n5. PDF con una rama del árbol de páginas que no es una página\n');
// PDF mínimo: `textos` son las páginas; en la posición `rotoEn` se mete un hijo que apunta a un
// entero (lo que pdfjs llama «wrong type of object»).
function pdfConHijoRoto(textos, rotoEn) {
  const objs = [];
  const add = (x) => objs.push(x);
  add(null); add(null); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (let i = 0; i <= textos.length; i++) {
    if (i === rotoEn) { add('42'); kids.push(objs.length); }
    if (i === textos.length) break;
    const st = `BT /F1 12 Tf 72 720 Td (${textos[i]}) Tj ET`;
    add(`<< /Length ${st.length} >>\nstream\n${st}\nendstream`);
    const c = objs.length;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${c} 0 R >>`);
    kids.push(objs.length);
  }
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const off = [];
  objs.forEach((o, i) => { off.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const { extractPdf } = await import(url('server/indexer/extract.js'));
const textos = ['Demanda de juicio ordinario primera pagina', 'Hechos segunda pagina del escrito', 'Suplico tercera pagina final'];
const leer = async (buf) => {
  const f = path.join(base, `roto-${++n}.pdf`);
  fs.writeFileSync(f, buf);
  try {
    return await extractPdf(f, { maxPages: 50 });
  } catch (err) {
    return { error: err };
  }
};
for (const [k, rotoEn] of [0, 1, 3].entries()) {
  const r = await leer(pdfConHijoRoto(textos, rotoEn));
  const todo = (r.pages || []).map((p) => p.text).join(' | ');
  check(`5.${k + 1} la rama rota en la posición ${rotoEn} no se lleva el documento: salen las tres páginas`,
    !r.error && textos.every((t) => todo.includes(t)), r.error ? String(r.error.message) : todo);
}
const soloRoto = await leer(pdfConHijoRoto([], 0));
check('5.4 un PDF sin ninguna página legible sigue siendo error DEL FICHERO (no aviso técnico)',
  soloRoto.error?.code === 'ROBIN_FICHERO_PDF_ROTO', String(soloRoto.error?.code || JSON.stringify(soloRoto)));

fs.rmSync(base, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} ${ok === results.length ? 'OK' : 'CON FALLOS'}`);
process.exit(ok === results.length ? 0 : 1);
