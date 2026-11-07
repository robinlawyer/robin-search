// SUPERVISOR (1.13.0, 7-nov-2026). Lo que se comprueba es la promesa que le hacemos al abogado:
// pase lo que pase dentro del motor (un WASM que revienta leyendo un PDF, una herramienta que
// tumba el hilo), Claude NO ve morir a RobinSearch, las peticiones se contestan, el indexado
// termina con todo lo legible dentro y el documento culpable queda apartado; al cerrar Claude no
// queda nada colgando. Y el motor descargado: se elige el más nuevo verificado, y uno que no
// arranca se aparta solo y se vuelve al de la extensión.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(Boolean(c)); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-supervisor-'));
const escribir = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const SUP = pathToFileURL(path.join(REPO, 'server/supervisor.js')).href;
const { elegirMotor, recogerHiloMuerto } = await import(SUP);

function entorno(datos, carpeta, extra = {}) {
  const env = { ...process.env, ROBIN_TOKEN: 't', ROBIN_DATA_DIR: datos, ROBIN_OCR: 'false', ROBIN_LOG_LEVEL: 'info',
    ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no', ROBIN_OAUTH_ISSUER: 'http://127.0.0.1:9', ROBIN_DIAGNOSTICO_URL: 'off',
    ROBIN_SUPERVISOR_ESPERAS_MS: '200,200,400', ...extra };
  delete env.ROBIN_FOLDER; delete env.ROBIN_WATCHED_FOLDER; delete env.ROBIN_SIN_SUPERVISOR;
  env.ROBIN_FOLDERS = carpeta;
  return env;
}

// «Claude»: lanza cli/index.js como lo lanza Claude y habla MCP por stdio.
function claude(env) {
  const c = spawn(process.execPath, [path.join(REPO, 'cli/index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const w = new Map(); let id = 1; const s = { c, se: '', noJson: 0 };
  c.stderr.on('data', (d) => { s.se += d.toString(); });
  c.stdout.on('data', (d) => { buf += d.toString(); let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue;
      let m; try { m = JSON.parse(l); } catch { s.noJson += 1; continue; } const f = w.get(m.id); if (f) { w.delete(m.id); f(m); } } });
  s.rpc = (method, params, tope = 120000) => new Promise((res, rej) => { const i = id++;
    const t = setTimeout(() => rej(new Error(`timeout ${method}`)), tope);
    w.set(i, (m) => { clearTimeout(t); res(m); });
    c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`); });
  s.call = async (name, args = {}) => { const r = await s.rpc('tools/call', { name, arguments: args });
    const t = r.result?.content?.[0]?.text; let data = r; try { data = t ? JSON.parse(t) : r; } catch { /* texto */ }
    return { isError: Boolean(r.result?.isError), data, raw: t || '', r }; };
  s.iniciar = async () => {
    const ini = await s.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } });
    c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    s.tools = await s.rpc('tools/list', {});
    return ini;
  };
  s.esperarIndexado = async (docs, tope = 240) => { let est;
    for (let i = 0; i < tope; i++) { est = (await s.call('estado_servidor')).data;
      if (est?.estado !== 'indexando' && est?.ultimo_indexado && (docs === undefined || est.documentos_indexados >= docs)) break;
      await espera(500); }
    return est; };
  s.cerrar = () => new Promise((r) => { if (c.exitCode !== null) return r({ code: c.exitCode, ms: 0 }); const t0 = Date.now();
    const k = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* */ } }, 20000);
    c.once('exit', (code, sig) => { clearTimeout(k); r({ code, sig, ms: Date.now() - t0 }); }); c.stdin.end(); });
  return s;
}
const marcas = (datos) => { try { return fs.readdirSync(datos).filter((n) => n.startsWith('en_curso-')); } catch { return []; } };

// ─── 1. Funciona igual que antes a través del supervisor ──────────────────────────────────────
{
  const datos = path.join(base, 'd1'); const carpeta = path.join(base, 'exp1');
  escribir(path.join(carpeta, 'Caso A', 'demanda.txt'), 'Demanda de reclamación de cantidad por arrendamiento de local.');
  escribir(path.join(carpeta, 'Caso A', 'contestacion.txt'), 'Contestación a la demanda: se opone la excepción de pago.');
  const s = claude(entorno(datos, carpeta));
  const ini = await s.iniciar();
  check('el saludo MCP llega a Claude a través del supervisor', ini.result?.serverInfo?.name === 'robin-search', JSON.stringify(ini.result?.serverInfo));
  check('tools/list devuelve las herramientas', (s.tools.result?.tools || []).length > 10, String(s.tools.result?.tools?.length));
  const est = await s.esperarIndexado(2);
  check('indexa los documentos', est?.documentos_indexados === 2, `docs=${est?.documentos_indexados}`);
  const b = await s.call('buscar_documentos', { query: 'excepción de pago', expediente: 'Caso A' });
  check('busca', !b.isError && b.raw.includes('contestacion'), b.raw.slice(0, 120));
  check('a Claude no le llega nada que no sea JSON-RPC', s.noJson === 0, String(s.noJson));
  const f = await s.cerrar();
  check('al cerrar Claude (stdin) el proceso sale limpio y pronto', f.code === 0 && f.ms < 10000, JSON.stringify(f));
  check('y no deja marca de fase (no cuenta como caída)', marcas(datos).length === 0, marcas(datos).join(','));
}

// ─── 2. El hilo muere en mitad de una herramienta: Claude recibe su respuesta igual ───────────
{
  const datos = path.join(base, 'd2'); const carpeta = path.join(base, 'exp2');
  escribir(path.join(carpeta, 'Caso B', 'escrito.txt'), 'Recurso de apelación contra la sentencia de instancia.');
  const bandera = path.join(base, 'tumbar-una-vez');
  fs.writeFileSync(bandera, '1');
  const s = claude(entorno(datos, carpeta, { ROBIN_PRUEBA_TUMBAR_UNA_VEZ: bandera, ROBIN_PRUEBA_TUMBAR_HERRAMIENTA: 'listar_documentos_indexados' }));
  await s.iniciar();
  await s.esperarIndexado(1);
  const pid = s.c.pid;
  const r = await s.call('listar_documentos_indexados', { expediente: 'Caso B' });
  check('la herramienta que tumbó el hilo se repite en el hilo nuevo y contesta bien', !r.isError && r.raw.includes('escrito'), r.raw.slice(0, 160));
  check('el hilo murió de verdad (la bandera se gastó)', !fs.existsSync(bandera));
  check('el proceso que ve Claude es el mismo: no hubo «RobinSearch dejó de ejecutarse»', s.c.exitCode === null && s.c.pid === pid);
  const est = (await s.call('estado_servidor')).data;
  check('el servidor repuesto sigue con su índice', est?.documentos_indexados === 1, `docs=${est?.documentos_indexados}`);
  const b = await s.call('buscar_documentos', { query: 'recurso de apelación', expediente: 'Caso B' });
  check('y busca', !b.isError && b.raw.includes('escrito'), b.raw.slice(0, 120));
  const log = fs.readFileSync(path.join(datos, 'logs', 'robin-search.log'), 'utf8');
  check('la caída queda registrada (se repone, no se calla)', log.includes('se repone solo'));
  check('y el hilo nuevo la cuenta como caída (marca del hilo muerto)', log.includes('El hilo del servidor murió y el supervisor lo repuso'));
  await s.cerrar();
}

// ─── 3. Un documento que revienta el motor al leerlo (WASM «memory access out of bounds») ─────
{
  const datos = path.join(base, 'd3'); const carpeta = path.join(base, 'exp3');
  escribir(path.join(carpeta, 'Caso C', 'bueno1.txt'), 'Informe pericial sobre los daños del inmueble.');
  escribir(path.join(carpeta, 'Caso C', 'bomba.txt'), 'Este documento tumba el motor.');
  escribir(path.join(carpeta, 'Caso C', 'bueno2.txt'), 'Acta de conciliación sin avenencia.');
  const s = claude(entorno(datos, carpeta, { ROBIN_PRUEBA_EXCEPCION_EN: 'bomba.txt' }));
  await s.iniciar();
  let est;
  for (let i = 0; i < 240; i++) {
    const r = await s.call('estado_servidor');
    est = r.data;
    if (est?.documentos_indexados >= 2 && est?.estado !== 'indexando' && est?.ultimo_indexado) break;
    await espera(500);
  }
  check('Claude sigue con RobinSearch vivo aunque el motor revienta', s.c.exitCode === null);
  check('todo lo legible queda indexado', est?.documentos_indexados === 2, `docs=${est?.documentos_indexados} estado=${est?.estado}`);
  const log = fs.readFileSync(path.join(datos, 'logs', 'robin-search.log'), 'utf8');
  const caidas = (log.match(/se repone solo/g) || []).length;
  check('el documento culpable se reintenta una vez y después se aparta (2 caídas, no infinitas)', caidas >= 1 && caidas <= 3, `caídas=${caidas}`);
  await espera(1500);
  const otra = (log.match(/se repone solo/g) || []).length;
  check('y no sigue cayéndose', (fs.readFileSync(path.join(datos, 'logs', 'robin-search.log'), 'utf8').match(/se repone solo/g) || []).length === otra);
  await s.cerrar();
}

// ─── 4. El motor descargado: se elige el más nuevo verificado; uno roto se aparta solo ────────
{
  const datos = path.join(base, 'd4');
  const motor = (v, { contrato = 1, ficha = true, entrada = 'export {};' } = {}) => {
    const r = path.join(datos, 'motor', v);
    escribir(path.join(r, 'package.json'), JSON.stringify({ version: v, robinSupervisor: contrato }));
    escribir(path.join(r, 'server', 'index.js'), entrada);
    if (ficha) escribir(path.join(r, 'robin-motor.json'), JSON.stringify({ version: v, sha256: 'x'.repeat(64) }));
    return r;
  };
  motor('90.0.0'); motor('95.0.0', { ficha: false }); motor('96.0.0', { contrato: 0 }); motor('0.0.1');
  let e = elegirMotor({ dataDir: datos, raizIncluida: REPO });
  check('elige el descargado más nuevo que está terminado y entiende este supervisor', e.version === '90.0.0' && e.descargado, `${e.version}`);
  fs.writeFileSync(path.join(datos, 'motor', 'descartados.json'), JSON.stringify({ versiones: ['90.0.0'] }));
  e = elegirMotor({ dataDir: datos, raizIncluida: REPO });
  check('uno descartado no se vuelve a usar: se queda el de la extensión', !e.descargado && e.raiz === REPO, `${e.version}`);
  fs.rmSync(path.join(datos, 'motor', 'descartados.json'));

  // Uno que revienta al arrancar: Claude recibe su saludo igual (del de la extensión).
  motor('99.0.0', { entrada: "throw new Error('motor roto (prueba)');" });
  const carpeta = path.join(base, 'exp4');
  escribir(path.join(carpeta, 'Caso D', 'nota.txt'), 'Nota interna del expediente.');
  const s = claude(entorno(datos, carpeta));
  const ini = await s.iniciar();
  check('con un motor descargado roto, Claude recibe el saludo igual', ini.result?.serverInfo?.name === 'robin-search', JSON.stringify(ini.error || ini.result?.serverInfo));
  const d = JSON.parse(fs.readFileSync(path.join(datos, 'motor', 'descartados.json'), 'utf8'));
  check('y el motor roto queda descartado', d.versiones.includes('99.0.0'), JSON.stringify(d));
  const est = await s.esperarIndexado(1);
  check('el de la extensión indexa', est?.documentos_indexados === 1, `docs=${est?.documentos_indexados}`);
  await s.cerrar();
}

// ─── 5. Recoger lo que deja un hilo muerto (marca y cerrojos con el pid vivo) ─────────────────
{
  const datos = path.join(base, 'd5'); fs.mkdirSync(datos, { recursive: true });
  fs.writeFileSync(path.join(datos, `en_curso-${process.pid}.json`), JSON.stringify({ pid: process.pid, fase: 'indexando', ext: '.pdf' }));
  fs.writeFileSync(path.join(datos, 'escritor.lock'), JSON.stringify({ pid: process.pid, token: 'x' }));
  fs.writeFileSync(path.join(datos, 'sesion.lock'), String(process.pid));
  fs.writeFileSync(path.join(datos, 'ajeno.lock'), JSON.stringify({ pid: 1, token: 'y' }));
  const r = recogerHiloMuerto({ dataDir: datos, generacion: 3, codigo: 1, error: 'x' });
  const ns = fs.readdirSync(datos).sort();
  check('la marca pasa a ser de hilo muerto (con la causa)', ns.includes(`en_curso-${process.pid}-h3.json`) && !ns.includes(`en_curso-${process.pid}.json`) &&
    JSON.parse(fs.readFileSync(path.join(datos, `en_curso-${process.pid}-h3.json`), 'utf8')).muerte_hilo?.codigo === 1, ns.join(','));
  check('se sueltan los cerrojos del hilo muerto y solo esos', r.cerrojos === 2 && ns.includes('ajeno.lock') && !ns.includes('escritor.lock'), ns.join(','));
}

// ─── 6. La pasada de una vez (--silent, RobinDesktop con Claude cerrado) termina aunque reviente ─
{
  const datos = path.join(base, 'd6'); const carpeta = path.join(base, 'exp6');
  escribir(path.join(carpeta, 'Caso E', 'a.txt'), 'Escrito de alegaciones.');
  escribir(path.join(carpeta, 'Caso E', 'bomba.txt'), 'Tumba el motor.');
  escribir(path.join(carpeta, 'Caso E', 'b.txt'), 'Diligencia de ordenación.');
  const env = entorno(datos, carpeta, { ROBIN_PRUEBA_EXCEPCION_EN: 'bomba.txt' });
  const r = await new Promise((res) => {
    const c = spawn(process.execPath, [path.join(REPO, 'cli/index.js'), '--silent'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', () => {});
    const t = setTimeout(() => c.kill('SIGKILL'), 240000);
    c.on('exit', (code) => { clearTimeout(t); res({ code, out }); });
  });
  check('la pasada termina bien aunque un documento tumbe el motor', r.code === 0 && r.out.includes('Indexado completado'), `código ${r.code}`);
  const reg = JSON.parse(fs.readFileSync(path.join(datos, 'files.json'), 'utf8'));
  const n = Object.keys(reg.files || reg).length;
  check('con los documentos legibles dentro', n >= 2, `registro=${n}`);
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} OK`);
fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 });
process.exit(ok === results.length ? 0 : 1);
