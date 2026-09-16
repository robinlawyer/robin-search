// ESCENARIO: los fallos que dejaban RobinSearch caído para siempre, y sin que nadie lo supiera.
// 11-14 sep 2026: «Server disconnected» en cada arranque, y la única forma de saber por
// qué era pedirle que abriera el Terminal.
//
//   A. El índice antiguo (vectra: UN index.json con todo) pasa al formato por documento sin
//      cargarlo entero, también si está CORTADO, y todo se sigue encontrando.
//   B. Un fichero que tumba el proceso: el siguiente arranque lo sabe y avisa a Robin; a la
//      segunda caída con el mismo fichero lo aparta, indexa el resto y estado_servidor lo dice.
//   C. El aviso técnico NO lleva nada de los documentos: ni rutas, ni nombres, ni expedientes.
//   D. Salida ordenada (SIGTERM, stdin cerrado) ≠ caída: sin aviso y sin apartar nada.
//   E. Dos instancias a la vez: una escribe, la otra busca y toma el relevo si la primera muere.
//   F. Tamaño máximo por tipo de fichero.
//   G. Una promesa rechazada sin capturar ya no tumba el servidor, y se avisa.
//   H. Limpieza de textos: rutas con espacios, Windows, nombres sueltos, correo, DNI.
//   I. La carpeta configurada en Claude se recupera también con el id NUEVO de la extensión.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
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
const conTope = (p, ms) => Promise.race([p, espera(ms).then(() => null)]);

// Receptor de avisos técnicos (hace de api.robinlawyer.ai/robinsearch/diagnostico).
const recibidos = [];
const receptor = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    try {
      recibidos.push({ url: req.url, cuerpo: JSON.parse(b), bruto: b });
    } catch {
      recibidos.push({ url: req.url, cuerpo: null, bruto: b });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true,"id":"prueba"}');
  });
});
await new Promise((r) => receptor.listen(0, '127.0.0.1', r));
const URL_AVISOS = `http://127.0.0.1:${receptor.address().port}/robinsearch/diagnostico`;

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-robustez-'));
function nuevaMadre(nombre, ficheros) {
  const madre = path.join(base, nombre, 'Expedientes');
  for (const [rel, txt] of Object.entries(ficheros)) {
    const p = path.join(madre, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, txt);
  }
  return madre;
}

function servidor({ madre, datos, env = {} }) {
  const e = {
    ...process.env,
    ROBIN_TOKEN: 't',
    ROBIN_FOLDERS: madre,
    ROBIN_DATA_DIR: datos,
    ROBIN_OCR: 'false',
    ROBIN_LOG_LEVEL: 'info',
    ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no',
    ROBIN_DIAGNOSTICO_URL: URL_AVISOS,
    ROBIN_NO_BROWSER: '1',
    ...env,
  };
  if (madre === null) {
    delete e.ROBIN_FOLDERS;
    delete e.ROBIN_FOLDER;
  }
  const c = spawn(process.execPath, [path.join(REPO, 'server/index.js')], { env: e, stdio: ['pipe', 'pipe', 'pipe'] });
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
  return { proc: c, rpc, call, salida };
}

async function esperarFin(call, intentos = 120) {
  for (let i = 0; i < intentos; i++) {
    const e = await call('estado_servidor');
    if (e.data && e.data.estado !== 'indexando' && e.data.ultimo_indexado) return e.data;
    await espera(1000);
  }
  return (await call('estado_servidor')).data;
}

const leerLog = (datos) => {
  try {
    return fs.readFileSync(path.join(datos, 'logs', 'robin-search.log'), 'utf8');
  } catch {
    return '';
  }
};

// En Windows kill() es TerminateProcess: no hay manejador que ejecutar. Claude Desktop cierra el
// servidor cerrando su stdin, así que ahí se para igual que lo para Claude.
async function parar(s) {
  if (process.platform === 'win32') s.proc.stdin.end();
  else s.proc.kill('SIGTERM');
  return conTope(s.salida, 10000);
}

// Convierte el índice nuevo en uno de vectra (lo que tiene en disco quien viene de ≤1.4.4).
function aVectra(datos) {
  const docs = path.join(datos, 'indice', 'docs');
  const items = [];
  for (const f of fs.readdirSync(docs).filter((n) => n.endsWith('.jsonl'))) {
    const lineas = fs.readFileSync(path.join(docs, f), 'utf8').split('\n').filter(Boolean);
    const cab = JSON.parse(lineas[0]);
    const b = fs.readFileSync(path.join(docs, `${cab.docId}.${cab.gen}.vec`));
    const v = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    lineas.slice(1).forEach((l, j) => {
      const m = JSON.parse(l);
      items.push({ id: `${cab.docId}::${m.chunkId}`, metadata: m, vector: Array.from(v.subarray(j * cab.dim, (j + 1) * cab.dim)), norm: 1 });
    });
  }
  fs.rmSync(path.join(datos, 'indice'), { recursive: true, force: true });
  fs.mkdirSync(path.join(datos, 'index'), { recursive: true });
  fs.writeFileSync(path.join(datos, 'index', 'index.json'), JSON.stringify({ version: 1, metadata_config: {}, items }));
  return items.length;
}

// ───────────────────────── A. Índice antiguo → formato por documento ─────────────────────────
console.log('\nA. El índice de vectra (un solo index.json) pasa al formato por documento\n');
const madreA = nuevaMadre('A', {
  'Pérez - Divorcio/01 demanda.txt': 'Demanda de divorcio contencioso con solicitud de custodia compartida de los hijos menores.',
  'Pérez - Divorcio/02 convenio.txt': 'Propuesta de convenio regulador: pensión de alimentos y atribución del uso de la vivienda familiar.',
  'Lledó - Concurso/01 informe.txt': 'Informe de la administración concursal sobre la masa activa y el pasivo de la concursada.',
});
const datosA = path.join(base, 'datosA');
let s = servidor({ madre: madreA, datos: datosA });
let e = await esperarFin(s.call);
check('A.0 indexa los 3 documentos en el formato nuevo', e?.documentos_indexados === 3 && fs.existsSync(path.join(datosA, 'indice', 'docs')), `docs=${e?.documentos_indexados}`);
const fragmentosA = e?.fragmentos_totales;
await parar(s);

const nItems = aVectra(datosA);
s = servidor({ madre: madreA, datos: datosA });
e = await esperarFin(s.call);
let b = await s.call('buscar_documentos', { query: 'pensión de alimentos y vivienda', expediente: 'Expedientes/Pérez - Divorcio' });
check('A.1 tras migrar un index.json de vectra, busca igual', b.data?.fragmentos?.[0]?.fichero === '02 convenio.txt', `items=${nItems} primero=${b.data?.fragmentos?.[0]?.fichero}`);
check('A.2 el índice viejo se borra y los contadores cuadran', !fs.existsSync(path.join(datosA, 'index')) && e?.fragmentos_totales === fragmentosA);
check('A.3 la migración queda en el registro', /Índice pasado al formato por documento/.test(leerLog(datosA)));
await parar(s);

aVectra(datosA);
const idx = path.join(datosA, 'index', 'index.json');
fs.truncateSync(idx, Math.floor(fs.statSync(idx).size * 0.6));
s = servidor({ madre: madreA, datos: datosA });
e = await esperarFin(s.call);
b = await s.call('buscar_documentos', { query: 'administración concursal masa activa', expediente: 'Expedientes/Lledó - Concurso' });
const b2 = await s.call('buscar_documentos', { query: 'custodia compartida', expediente: 'Expedientes/Pérez - Divorcio' });
check(
  'A.4 index.json CORTADO: se aprovecha lo completo y lo cortado se reindexa desde el original',
  e?.documentos_indexados === 3 && e?.fragmentos_totales === fragmentosA && b.data?.fragmentos?.[0]?.fichero === '01 informe.txt' && b2.data?.fragmentos?.[0]?.fichero === '01 demanda.txt',
  `docs=${e?.documentos_indexados} frag=${e?.fragmentos_totales}/${fragmentosA}`,
);
check('A.5 antes (1.4.0) esto dejaba TODOS los ficheros fallando; ahora sin errores', (e?.ultimo_indexado?.errores ?? 1) === 0);
await parar(s);

// ───────────────────────── B. Un fichero que tumba el proceso ─────────────────────────
console.log('\nB. Un fichero que tumba el proceso (como un OOM al leerlo)\n');
const madreB = nuevaMadre('B', {
  'García SL - Reclamación/01 contrato.txt': 'Contrato de suministro de material eléctrico con cláusula penal por retraso.',
  'García SL - Reclamación/02 veneno.txt': 'Este fichero hace de uno que revienta el lector.',
  'García SL - Reclamación/03 burofax.txt': 'Burofax de requerimiento de pago de las facturas vencidas.',
});
const datosB = path.join(base, 'datosB');
const envB = { ROBIN_PRUEBA_CAER_EN: '02 veneno.txt' };
let antes = recibidos.length;
s = servidor({ madre: madreB, datos: datosB, env: envB });
let fin = await conTope(s.salida, 120000);
check('B.1 el proceso muere al leer el fichero', Boolean(fin) && (fin.signal === 'SIGKILL' || fin.code !== 0), JSON.stringify(fin));
check('B.2 una marca en disco dice qué estaba leyendo', fs.readdirSync(datosB).some((n) => /^en_curso-\d+\.json$/.test(n)));

s = servidor({ madre: madreB, datos: datosB, env: envB });
fin = await conTope(s.salida, 120000);
const avisoB = recibidos.slice(antes).find((r) => r.cuerpo?.motivo === 'caida_previa');
check('B.3 el siguiente arranque avisa SOLO a Robin de la caída', Boolean(avisoB));
check(
  'B.4 el aviso dice fase, tipo y tamaño del fichero, versión y sistema',
  avisoB?.cuerpo?.fase === 'indexando' && avisoB.cuerpo.fichero?.ext === '.txt' && avisoB.cuerpo.fichero.bytes > 0 &&
    avisoB.cuerpo.version && avisoB.cuerpo.sistema?.plataforma && avisoB.cuerpo.esquema === 1,
  JSON.stringify({ fase: avisoB?.cuerpo?.fase, fichero: avisoB?.cuerpo?.fichero }),
);
check('B.5 lleva el final del registro (para ver el error)', Array.isArray(avisoB?.cuerpo?.registro) && avisoB.cuerpo.registro.length > 3);
check('B.6 una sola caída no basta para apartar (se reintenta: pudo ser Claude cerrando)', Boolean(fin) && (fin.signal === 'SIGKILL' || fin.code !== 0));

s = servidor({ madre: madreB, datos: datosB, env: envB });
e = await esperarFin(s.call);
check('B.7 a la 2.ª caída con el mismo fichero queda apartado y el resto se indexa', e?.documentos_indexados === 2 && e?.ficheros_apartados?.length === 1, `docs=${e?.documentos_indexados}`);
check('B.8 estado_servidor explica qué fichero y por qué', /cayera/.test(e?.ficheros_apartados?.[0]?.motivo || '') && /02 veneno\.txt$/.test(e?.ficheros_apartados?.[0]?.ruta || '') && Boolean(e?.aviso_apartados));
check('B.9 y dice que Robin ya está avisado (el abogado no tiene que hacer nada)', /ya se lo ha comunicado/.test(e?.aviso_tecnico || ''));
check('B.10 el mismo fallo no se avisa dos veces', recibidos.slice(antes).filter((r) => r.cuerpo?.motivo === 'caida_previa').length === 1);
await parar(s);

// ───────────────────────── C. Nada de los documentos sale del ordenador ─────────────────────────
console.log('\nC. El aviso técnico no lleva nada de los documentos\n');
const todo = recibidos.map((r) => r.bruto).join('\n');
const prohibidos = [
  // Las rutas de Windows viajan con la barra invertida DUPLICADA dentro del JSON.
  base, os.homedir(), JSON.stringify(base).slice(1, -1), JSON.stringify(os.homedir()).slice(1, -1),
  os.userInfo().username, 'Pérez', 'Divorcio', 'García', 'Reclamación', 'veneno',
  'contrato', 'burofax', 'Lledó', 'Concurso', 'Expedientes', 'custodia', 'suministro',
];
for (const p of prohibidos) check(`C. ningún aviso contiene «${p.length > 40 ? `…${p.slice(-30)}` : p}»`, !todo.includes(p));
check('C. y sí contiene lo técnico', recibidos.length > 0 && recibidos.every((r) => r.cuerpo?.version && r.cuerpo?.motivo));

// ───────────────────────── D. Salida ordenada ≠ caída ─────────────────────────
console.log('\nD. Salida ordenada (Claude cierra) no es una caída\n');
antes = recibidos.length;
s = servidor({ madre: madreA, datos: datosA });
await esperarFin(s.call);
fin = await parar(s);
check(`D.1 ${process.platform === 'win32' ? 'stdin cerrado' : 'SIGTERM'}: sale con código 0`, fin?.code === 0, JSON.stringify(fin));
check('D.2 no deja marca de fase ni cerrojo', !fs.readdirSync(datosA).some((n) => /^en_curso-/.test(n)) && !fs.existsSync(path.join(datosA, 'escritor.lock')));
s = servidor({ madre: madreA, datos: datosA });
await esperarFin(s.call);
check('D.3 el siguiente arranque no lo toma por caída (ningún aviso)', recibidos.length === antes);
s.proc.stdin.end();
fin = await conTope(s.salida, 8000);
check('D.4 al cerrar stdin (Claude se cierra) el proceso termina solo, sin quedar huérfano', fin?.code === 0, JSON.stringify(fin));

// ───────────────────────── E. Dos instancias a la vez ─────────────────────────
console.log('\nE. Dos instancias sobre el mismo índice (Claude arranca dos)\n');
const madreE = nuevaMadre('E', {
  'Caso Uno/a.txt': 'Recurso de apelación contra la sentencia de instancia por error en la valoración de la prueba.',
  'Caso Uno/b.txt': 'Escrito de oposición al recurso de apelación.',
  'Caso Dos/c.txt': 'Demanda de desahucio por falta de pago de la renta.',
});
const datosE = path.join(base, 'datosE');
const s1 = servidor({ madre: madreE, datos: datosE });
const s2 = servidor({ madre: madreE, datos: datosE });
let listo = null;
for (let i = 0; i < 120 && !listo; i++) {
  for (const x of [s1, s2]) {
    const r = await x.call('estado_servidor');
    if (r.data?.ultimo_indexado && r.data.estado !== 'indexando') listo = x;
  }
  if (!listo) await espera(1000);
}
const logE = leerLog(datosE);
check('E.1 solo una indexa; la otra lo sabe y no se pisan', Boolean(listo) && (logE.match(/Otra instancia de RobinSearch tiene el índice/g) || []).length === 1);
const lector = listo === s1 ? s2 : s1;
const bl = await lector.call('buscar_documentos', { query: 'desahucio falta de pago', expediente: 'Expedientes/Caso Dos' });
check('E.2 la que no indexa busca sobre lo que indexó la otra', bl.data?.fragmentos?.[0]?.fichero === 'c.txt');
listo.proc.kill('SIGKILL');
await listo.salida;
let relevo = false;
for (let i = 0; i < 20 && !relevo; i++) {
  await espera(1000);
  relevo = /toma el relevo del índice/.test(leerLog(datosE));
}
check('E.3 si la que indexa muere, la otra toma el relevo', relevo);
await parar(lector);

// ───────────────────────── F. Tamaño máximo ─────────────────────────
console.log('\nF. Tamaño máximo por tipo\n');
const madreF = nuevaMadre('F', { 'Caso/pequeno.txt': 'Nota breve del expediente.', 'Caso/enorme.txt': 'x '.repeat(4000) });
const datosF = path.join(base, 'datosF');
s = servidor({ madre: madreF, datos: datosF, env: { ROBIN_MAX_MB: '0.001' } });
e = await esperarFin(s.call);
check('F.1 el que pasa del tope se aparta, se dice, y el resto se indexa', e?.documentos_indexados === 1 && e?.ficheros_apartados?.some((a) => /grande/.test(a.motivo)), JSON.stringify(e?.ficheros_apartados));
await parar(s);

// ───────────────────────── G. Promesa rechazada sin capturar ─────────────────────────
console.log('\nG. Una promesa rechazada sin capturar\n');
antes = recibidos.length;
s = servidor({ madre: madreF, datos: path.join(base, 'datosG'), env: { ROBIN_PRUEBA_RECHAZO: '1' } });
await espera(3000);
const vivo = await conTope(s.call('estado_servidor'), 20000);
check('G.1 el servidor sigue vivo (en Node ≥15 esto lo tumbaba)', Boolean(vivo?.data?.version));
let avG = null;
for (let i = 0; i < 10 && !avG; i++) {
  avG = recibidos.slice(antes).find((r) => r.cuerpo?.motivo === 'excepcion');
  if (!avG) await espera(500);
}
check('G.2 y se avisa a Robin', Boolean(avG));
check('G.3 con la causa limpia de rutas y nombres', Boolean(avG) && !/Pérez|Divorcio|\/Users\/prueba|demanda/.test(avG.bruto), avG?.cuerpo?.causa);
await parar(s);

// ───────────────────────── H. Limpieza de textos ─────────────────────────
console.log('\nH. Limpieza de textos\n');
const casos = [
  ["ENOENT: no such file or directory, open '/Users/prueba/Expedientes/Pérez - Divorcio/demanda firmada.pdf'", ['Pérez', 'Divorcio', 'demanda', 'prueba']],
  ['EACCES: permission denied, scandir C:\\Users\\Ana\\Clientes\\García SL\\escrito.docx', ['Ana', 'García', 'escrito']],
  ['falló al leer Contrato arras Gómez.pdf dentro del comprimido', ['Gómez', 'arras']],
  ['aviso para juan.maza@robinlawyer.ai con DNI 12345678Z y NIE X1234567L', ['juan.maza', '12345678Z', 'X1234567L']],
  ['Error: ruta \\\\servidor-despacho\\Expedientes\\Martínez\\acta.pdf no accesible', ['Martínez', 'servidor-despacho', 'acta']],
];
const guardados = [
  'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
  'RangeError: Cannot create a string longer than 0x1fffffe8 characters',
];
const prog = `
import { limpiarTexto } from ${JSON.stringify(pathToFileURL(path.join(REPO, 'server/diagnostico.js')).href)};
const e = JSON.parse(process.env.CASOS);
console.log(JSON.stringify(e.map((c) => limpiarTexto(c))));`;
const salidaH = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', prog], {
    env: { ...process.env, CASOS: JSON.stringify([...casos.map((c) => c[0]), ...guardados]), ROBIN_DATA_DIR: path.join(base, 'datosH'), ROBIN_FOLDERS: madreA, ROBIN_LOG_LEVEL: 'error' },
  }).toString(),
);
casos.forEach(([, fuera], i) => {
  const r = salidaH[i];
  check(`H.${i + 1} ${fuera.join(', ')} → fuera`, fuera.every((x) => !r.includes(x)), r);
});
guardados.forEach((g, i) => check(`H.${casos.length + i + 1} lo técnico se conserva`, salidaH[casos.length + i] === g, salidaH[casos.length + i]));

// ───────────────────────── I. Carpeta configurada en Claude (id nuevo) ─────────────────────────
console.log('\nI. Quien actualiza sin la app no pierde su carpeta\n');
const casa = path.join(base, 'casa');
const dirAjustes =
  process.platform === 'darwin'
    ? path.join(casa, 'Library', 'Application Support', 'Claude', 'Claude Extensions Settings')
    : process.platform === 'win32'
      ? path.join(casa, 'AppData', 'Roaming', 'Claude', 'Claude Extensions Settings')
      : path.join(casa, '.config', 'Claude', 'Claude Extensions Settings');
fs.mkdirSync(dirAjustes, { recursive: true });
fs.writeFileSync(path.join(dirAjustes, 'local.mcpb.robinlawyer.ai.robin-search.json'), JSON.stringify({ isEnabled: true, userConfig: { robin_folders: [madreF] } }));
s = servidor({ madre: null, datos: path.join(base, 'datosI'), env: { HOME: casa, USERPROFILE: casa, APPDATA: path.join(casa, 'AppData', 'Roaming') } });
e = await esperarFin(s.call);
check('I.1 la carpeta de local.mcpb.robinlawyer.ai.robin-search se recupera', Boolean(e?.carpetas_vigiladas?.some((c) => c.ruta === madreF)), JSON.stringify(e?.carpetas_vigiladas?.map((c) => c.ruta)));
await parar(s);

receptor.close();
fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok === results.length ? 0 : 1);
