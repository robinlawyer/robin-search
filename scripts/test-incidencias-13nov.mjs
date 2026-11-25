// ESCENARIOS (13-nov-2026). Salen de los informes técnicos de un despacho en Windows con la
// carpeta de expedientes en OneDrive (RobinSearch 1.13.2, 32.000 documentos), revisados al
// contestar a Juan y Eduardo «¿cómo se comporta RobinSearch con OneDrive cuando los ficheros solo
// están en la nube?» (hilo «RobinSearch, un núcleo y varios despliegues», 12-nov):
//
//  1. Un documento que YA está en el disco pero con todo el contenido a ceros (copia que OneDrive
//     estropeó al sincronizar) entraba en bucle: revisar() lo daba por «ya descargado», el
//     indexador decía «vacío o sin descargar», se volvía a apuntar con la fecha de hoy… cada
//     quince minutos, siempre «pendiente de descarga» y sin explicar nunca qué le pasaba.
//  2. Word, Excel o PowerPoint protegidos con contraseña. Los .xls/.xlsx salían como «errores de
//     indexado» con aviso técnico en cada pasada, y un .docx protegido se «indexaba» VACÍO sin
//     aviso: el abogado creía que estaba en las búsquedas.
//  3. El vigilante contaba como fallo suyo cualquier documento ilegible recién guardado y dejaba
//     RobinSearch en error («El watcher no pudo procesar N cambio(s)»).
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
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-13nov-'));
const carpeta = path.join(base, 'Despacho');
fs.mkdirSync(path.join(carpeta, 'Exp 1'), { recursive: true });
process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_FOLDER = carpeta;
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_DIAGNOSTICO_URL = 'off';
process.env.ROBIN_NUBE_DIAS_MAX = '0'; // «un día» = ya
fs.mkdirSync(process.env.ROBIN_DATA_DIR, { recursive: true });
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const CFB = (await import('cfb')).default;

const nube = (await imp('server/indexer/nube.js')).default;
const { extractFile } = await imp('server/indexer/extract.js');
const { oleCifrado } = await imp('server/indexer/office-antiguo.js');

// ── Ficheros de prueba ─────────────────────────────────────────────────────────────────────
function ole(flujos) {
  const cfb = CFB.utils.cfb_new();
  for (const [nombre, contenido] of Object.entries(flujos)) CFB.utils.cfb_add(cfb, `/${nombre}`, contenido);
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }));
}
// Office 2007+ con contraseña: contenedor OLE con EncryptionInfo + EncryptedPackage.
const ooxmlCifrado = ole({ EncryptionInfo: Buffer.alloc(64, 1), EncryptedPackage: Buffer.alloc(4096, 7) });
// Word 97-2003 cifrado: cabecera FIB (0xA5EC) con el bit fEncrypted (0x0100).
const fib = Buffer.alloc(1024);
fib.writeUInt16LE(0xa5ec, 0);
fib.writeUInt16LE(0x0100, 0x0a);
const docCifrado = ole({ WordDocument: fib, '1Table': Buffer.alloc(512) });
const fibClaro = Buffer.from(fib);
fibClaro.writeUInt16LE(0x0000, 0x0a);
const docClaro = ole({ WordDocument: fibClaro, '0Table': Buffer.alloc(512) });

const f = (n) => path.join(carpeta, 'Exp 1', n);
fs.writeFileSync(f('Contrato (protegido).docx'), ooxmlCifrado);
fs.writeFileSync(f('Liquidación (protegida).xlsx'), ooxmlCifrado);
fs.writeFileSync(f('Liquidación antigua (protegida).xls'), ooxmlCifrado);
fs.writeFileSync(f('Escrito 2003 (protegido).doc'), docCifrado);
fs.writeFileSync(f('Presentación (protegida).pptx'), ooxmlCifrado);
const aCeros = f('Demanda (estropeada al sincronizar).pdf');
fs.writeFileSync(aCeros, Buffer.alloc(64 * 1024)); // en el disco, con bloques, todo ceros
const sano = f('Notas.txt');
fs.writeFileSync(sano, 'Notas del expediente: la vista es el 3 de diciembre.');

// ── 2. Office protegido ────────────────────────────────────────────────────────────────────
check('el detector reconoce el Office 2007+ cifrado', oleCifrado(ooxmlCifrado));
check('el detector reconoce el Word 97-2003 cifrado (bit fEncrypted)', oleCifrado(docCifrado));
check('un Word 97-2003 sin cifrar NO es «protegido»', !oleCifrado(docClaro));
for (const n of ['Contrato (protegido).docx', 'Liquidación (protegida).xlsx', 'Liquidación antigua (protegida).xls', 'Escrito 2003 (protegido).doc', 'Presentación (protegida).pptx']) {
  let code = null;
  let paginas = null;
  try {
    paginas = (await extractFile(f(n))).pages?.length ?? 0;
  } catch (err) {
    code = err.code;
  }
  check(`${n}: «protegido con contraseña», ni vacío ni error nuestro`, code === 'ROBIN_FICHERO_PROTEGIDO', code ?? `se leyó con ${paginas} página(s)`);
}

// ── 1. Contenido a ceros ───────────────────────────────────────────────────────────────────
nube._limpiarParaPrueba();
const enDisco = nube.estadoEnDisco(aCeros);
check('el fichero a ceros está en el disco (no es un marcador de la nube)', enDisco === 'si', enDisco);
nube.apuntar(aCeros, 'vacio');
nube.apuntar(sano, 'sin_descargar');
let indexados = [];
const r1 = await nube.revisar({ forzar: true, indexar: async (r) => { indexados.push(path.basename(r)); } });
check('el que ya tiene contenido se indexa', indexados.includes('Notas.txt'), JSON.stringify(indexados));
check('el que está a ceros NO se da por «ya descargado» (era el bucle)', !indexados.includes(path.basename(aCeros)), JSON.stringify(r1));
check('pasado el margen, se da por dañado y se deja de insistir', r1.a_ceros === 1 && nube.dadoPorVacio(aCeros), JSON.stringify(r1));
check('no vuelve a la lista aunque el recorrido lo encuentre otra vez', nube.apuntar(aCeros, 'vacio') === null && nube.cuantos() === 0);

// Con margen (el día real): mientras tanto se cuenta APARTE, nunca como «bajando de la nube».
nube._limpiarParaPrueba();
process.env.ROBIN_NUBE_DIAS_MAX = '1';
const nube2 = (await import(`${pathToFileURL(path.join(REPO, 'server/indexer/nube.js')).href}?margen`)).default;
nube2._limpiarParaPrueba();
nube2.apuntar(aCeros, 'vacio');
indexados = [];
const r2 = await nube2.revisar({ forzar: true, indexar: async (r) => { indexados.push(r); } });
check('dentro del día: sigue apuntado, sin indexar', indexados.length === 0 && r2.pendientes === 1, JSON.stringify(r2));
check('dentro del día: NO cuenta como «pendiente de descarga» (sería falso)', nube2.cuantos() === 0 && nube2.cuantosACeros() === 1,
  `cuantos=${nube2.cuantos()} a_ceros=${nube2.cuantosACeros()}`);
const antes = nube2.lista()[0];
nube2.apuntar(aCeros, 'vacio');
check('volver a encontrarlo no reinicia su fecha (era lo que lo hacía eterno)', nube2.lista().length === 1 && nube2.lista()[0].desde === antes.desde);
const r3 = await nube2.revisar({ forzar: true, indexar: async (r) => { indexados.push(r); } });
check('y en la siguiente pasada tampoco se indexa', indexados.length === 0 && r3.pendientes === 1, JSON.stringify(r3));
nube2._limpiarParaPrueba();

// ── 3. El recorrido y el vigilante ─────────────────────────────────────────────────────────
process.env.ROBIN_NUBE_DIAS_MAX = '0';
nube._limpiarParaPrueba();
const { indexFolder } = await imp('server/indexer/indexer.js');
fs.rmSync(sano); // sin documentos que vectorizar: la prueba no necesita el modelo
const res = await indexFolder(carpeta);
const ni = res?.no_indexables || {};
check('recorrido: los 5 Office protegidos van a «protegidos»', ni.protegidos === 5, JSON.stringify(ni));
check('recorrido: ningún «error de indexado» (nada que mande aviso técnico)', (res?.errores ?? 0) === 0, `errores=${res?.errores}`);
check('recorrido: el de ceros, como «sin descargar» solo el primer día', (ni.no_descargados ?? 0) + (ni.vacios ?? 0) === 1, JSON.stringify(ni));
await nube.revisar({ forzar: true });
const res2 = await indexFolder(carpeta);
const ni2 = res2?.no_indexables || {};
check('2.ª pasada: el de ceros ya es «vacío o a ceros», no «en la nube»', ni2.vacios === 1 && !ni2.no_descargados, JSON.stringify(ni2));
check('2.ª pasada: los protegidos se recuerdan (no se reabren) y siguen contados', ni2.protegidos === 5, JSON.stringify(ni2));

const fuente = fs.readFileSync(path.join(REPO, 'server/watcher/watcher.js'), 'utf8');
check('vigilante: lo que es del documento (ROBIN_FICHERO_*) no cuenta como fallo suyo', /startsWith\('ROBIN_FICHERO_'\)[\s\S]{0,400}continue;[\s\S]{0,60}fallos \+= 1/.test(fuente));

const est = fs.readFileSync(path.join(REPO, 'server/tools/estado_servidor.js'), 'utf8');
check('estado_servidor explica los vacíos/a ceros con el «Historial de versiones»', est.includes('ni.vacios') && est.includes('Historial de versiones'));
check('estado_servidor ya no dice solo «PDF(s) protegidos»', !est.includes('PDF(s) protegidos') && est.includes('PDF, Word o Excel'));

fs.rmSync(base, { recursive: true, force: true });
const fallos = results.filter((c) => !c).length;
console.log(`\n${results.length - fallos}/${results.length} OK`);
process.exit(fallos ? 1 : 0);
