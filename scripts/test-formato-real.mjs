// ESCENARIO (avisos técnicos del 16-sep, 1.6.0 en Mac con carpeta en la nube): 16 ficheros fallaban con
// mensajes que no decían nada, y un cierre pedido por Claude se contaba como caída.
//   · «~$Demanda.docx» que Word deja junto a un documento abierto → «Can't find end of central
//     directory». No son documentos: no se indexan.
//   · Foto de iPhone en HEIC llamada «.jpg» → «Error attempting to read image.». Se lee por contenido.
//   · RTF, HTML o PDF con extensión .docx → el lector equivocado. Se lee como lo que es.
//   · Vacío o sin descargar de la nube, Word binario antiguo como .docx → error CLARO, de fichero
//     (no dispara el aviso técnico: no hay nada que arreglar en RobinSearch).
//   · Claude pide el cierre y mata el proceso antes de atender SIGTERM → no es una caída.
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-formato-'));
process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_LOG_LEVEL = 'error';
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { tipoDeCabecera } = await imp('server/indexer/tipo-real.js');
const { esExtensionSoportada } = await imp('server/config.js');
const { extractFile } = await imp('server/indexer/extract.js');
const { terminateOcr } = await imp('server/indexer/ocr.js');
const { claudeLaCerro } = await imp('server/diagnostico.js');

// ── Tipo por cabecera ──
const heic = fs.readFileSync(path.join(REPO, 'scripts/fixtures/recurso-heic.heic'));
check('HEIC reconocido por contenido', tipoDeCabecera(heic) === 'heic', tipoDeCabecera(heic));
check('vacío y a ceros = vacio', tipoDeCabecera(Buffer.alloc(0)) === 'vacio' && tipoDeCabecera(Buffer.alloc(512)) === 'vacio');
check('zip / ole / pdf / rtf / html', tipoDeCabecera(Buffer.from('PK\x03\x04xx', 'latin1')) === 'zip'
  && tipoDeCabecera(Buffer.from('d0cf11e0a1b11ae1', 'hex')) === 'ole'
  && tipoDeCabecera(Buffer.from('%PDF-1.4\n')) === 'pdf'
  && tipoDeCabecera(Buffer.from('{\\rtf1\\ansi hola}')) === 'rtf'
  && tipoDeCabecera(Buffer.from('\uFEFF  <!DOCTYPE html><html>')) === 'html');
check('texto corriente no se confunde (ni «BM…»)', tipoDeCabecera(Buffer.from('BMW contra Pérez, demanda')) === null);

// ── Ficheros de bloqueo de Office ──
check('«~$Demanda.docx» no se indexa', !esExtensionSoportada('/x/Pérez/~$Demanda.docx') && !esExtensionSoportada('C:\\x\\~$hoja.xlsx'));
check('«Demanda.docx» sí', esExtensionSoportada('/x/Pérez/Demanda.docx'));

// ── Lectura por contenido ──
const escribir = (n, c) => { const p = path.join(base, n); fs.writeFileSync(p, c); return p; };
const texto = (r) => (r?.pages || []).map((p) => p.text).join('\n');
const intenta = async (p) => { try { return { r: await extractFile(p) }; } catch (e) { return { e }; } };

let x = await intenta(escribir('rtf.docx', '{\\rtf1\\ansi Auto de embargo preventivo}'));
check('RTF con extensión .docx se lee', /embargo preventivo/.test(texto(x.r)), x.e ? String(x.e.message) : '');
x = await intenta(escribir('web.docx', '<html><body><p>Providencia de admisión</p></body></html>'));
check('HTML con extensión .docx se lee', /Providencia de admisi/.test(texto(x.r)), x.e ? String(x.e.message) : '');
const pdf = ['%PDF-1.4', '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj', '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
  '4 0 obj<</Length 60>>stream\nBT /F1 14 Tf 20 100 Td (Sentencia firme de apelacion) Tj ET\nendstream endobj',
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj', 'trailer<</Root 1 0 R>>', '%%EOF'].join('\n');
x = await intenta(escribir('pdf.docx', pdf));
check('PDF con extensión .docx se lee', /Sentencia firme/.test(texto(x.r)), x.e ? String(x.e.message) : '');
x = await intenta(escribir('vacio.docx', ''));
check('vacío → error de fichero claro', x.e?.code === 'ROBIN_FICHERO_VACIO', String(x.e?.code));
x = await intenta(escribir('nube.pdf', Buffer.alloc(4096)));
check('a ceros (sin descargar de la nube) → error de fichero claro', x.e?.code === 'ROBIN_FICHERO_VACIO', String(x.e?.code));
x = await intenta(escribir('antiguo.docx', Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(600, 1)])));
check('Word binario antiguo como .docx → error de fichero claro', x.e?.code === 'ROBIN_FICHERO_FORMATO', String(x.e?.code));
// ── Avisos del 18 y 21-sep (1.6.1/1.8.0): lo que NO es un fallo de RobinSearch ──
x = await intenta(escribir('presentacion.pptx', Buffer.from('no soy un zip, soy basura'.repeat(20))));
check('.pptx que no es un ZIP → error de fichero, no aviso técnico', x.e?.code === 'ROBIN_FICHERO_FORMATO', String(x.e?.code ?? texto(x.r)));
x = await intenta(escribir('escrito.odt', Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(400, 7)])));
check('.odt con el ZIP truncado → error de fichero, no aviso técnico', x.e?.code === 'ROBIN_FICHERO_FORMATO', String(x.e?.code ?? texto(x.r)));
x = await intenta(escribir('word.docx', ['MIME-Version: 1.0', 'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable', '', '<html><body><p>Dilig=\r\nencia de ordenaci=C3=B3n</p></body></html>'].join('\r\n')));
check('«página web de un solo archivo» guardada como .docx se lee', /Diligencia de ordenación/.test(texto(x.r)), x.e ? String(x.e.message) : texto(x.r));
x = await intenta(escribir('exportado.docx', '<!-- saved from url=(0014)about:internet -->\n<meta charset="utf-8"><p>Decreto de admisión</p>'));
check('HTML de Word que no empieza por <html> se lee', /Decreto de admisi/.test(texto(x.r)), x.e ? String(x.e.message) : texto(x.r));

// ── Aviso del 21-sep: un adjunto ilegible no puede tumbar el correo entero ──
const correo = [
  'From: juzgado@ejemplo.es', 'To: despacho@ejemplo.es', 'Subject: Notificacion',
  'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="X"', '',
  '--X', 'Content-Type: text/plain; charset="utf-8"', '', 'Se acompana diligencia de embargo.', '',
  '--X', 'Content-Type: text/css; name="firma.css"', 'Content-Disposition: attachment; filename="firma.css"', '',
  'body { color: #000; }', '',
  '--X', 'Content-Type: application/msword; name="escrito.doc"', 'Content-Disposition: attachment; filename="escrito.doc"', '',
  'contenido binario', '',
  '--X', 'Content-Type: text/plain; name="anexo.txt"', 'Content-Disposition: attachment; filename="anexo.txt"', '',
  'Anexo: tasacion de costas', '', '--X--', ''].join('\r\n');
x = await intenta(escribir('notificacion.eml', correo));
check('adjunto .css/.doc no tumba el correo: cuerpo y adjunto legible se indexan',
  !x.e && /diligencia de embargo/i.test(texto(x.r)) && /tasacion de costas/i.test(texto(x.r)),
  x.e ? String(x.e.message) : texto(x.r).slice(0, 120));
check('y el correo deja constancia de los adjuntos que no se leen', /firma\.css/.test(texto(x.r)), texto(x.r).slice(0, 200));

x = await intenta(escribir('foto iphone.jpg', heic));
check('foto HEIC llamada .jpg pasa por OCR', /RECURSO/i.test(texto(x.r)), x.e ? String(x.e.message) : JSON.stringify(x.r));
await terminateOcr();

// ── ¿Caída o cierre de Claude? (registro real de Claude, 16-sep) ──
const juan = [
  '2026-09-16T17:35:30.190Z [RobinSearch] [info] Initializing server... { metadata: undefined }',
  '2026-09-16T18:35:12.752Z [RobinSearch] [info] Shutting down server... { metadata: undefined }',
  '2026-09-16T18:35:12.753Z [RobinSearch] [info] Server transport closed (intentional shutdown) { metadata: undefined }',
  '2026-09-16T18:35:12.846Z [RobinSearch] [info] Server transport closed { metadata: undefined }',
  '2026-09-16T18:35:13.630Z [RobinSearch] [info] Initializing server... { metadata: undefined }',
];
check('cierre pedido por Claude no es caída', claudeLaCerro({ inicio: '2026-09-16T17:35:31.000Z', t: '2026-09-16T18:35:10.000Z' }, juan) === true);
const caida = [
  '2026-09-16T17:35:30.190Z [RobinSearch] [info] Initializing server... { metadata: undefined }',
  '2026-09-16T18:35:12.846Z [RobinSearch] [info] Server transport closed { metadata: undefined }',
  "2026-09-16T18:35:12.846Z [RobinSearch] [error] Server disconnected. { context: 'connection', stack: undefined }",
  '2026-09-16T18:40:00.000Z [RobinSearch] [info] Shutting down server... { metadata: undefined }',
];
check('muerte del proceso sí es caída', claudeLaCerro({ inicio: '2026-09-16T17:35:31.000Z', t: '2026-09-16T18:35:10.000Z' }, caida) === false);
const reinicio = [...juan, '2026-09-16T18:36:00.000Z [RobinSearch] [info] Server transport closed { metadata: undefined }'];
check('caída de la instancia que arrancó DESPUÉS del cierre sí es caída', claudeLaCerro({ inicio: '2026-09-16T18:35:14.000Z', t: '2026-09-16T18:35:50.000Z' }, reinicio) === false);
check('registro de Claude vacío (no menciona ese arranque): caída', claudeLaCerro({ inicio: '2026-09-16T17:35:31.000Z' }, []) === false);
check('proceso no lanzado por Claude (app, CLI, prueba): caída aunque Claude cerrase otro', claudeLaCerro({ inicio: '2026-09-16T18:00:00.000Z', t: '2026-09-16T18:35:10.000Z' }, juan) === false);
check('marca antigua sin arranque: caída', claudeLaCerro({ t: '2026-09-16T18:35:10.000Z' }, juan) === false);
// 21-sep: Claude escribe estas líneas desde varios sitios y en el mismo milisegundo salen del
// revés; leídas en bruto, el cierre ordenado pasaba por muerte del proceso.
const desordenado = [
  '2026-09-21T07:47:24.040Z [RobinSearch] [info] Initializing server... { metadata: undefined }',
  '2026-09-21T07:47:29.029Z [RobinSearch] [info] Server transport closed { metadata: undefined }',
  '2026-09-21T07:47:29.025Z [RobinSearch] [info] Shutting down server... { metadata: undefined }',
  '2026-09-21T07:47:29.030Z [RobinSearch] [info] Initializing server... { metadata: undefined }',
];
check('cierre de Claude con las líneas desordenadas tampoco es caída', claudeLaCerro({ inicio: '2026-09-21T07:47:24.500Z', t: '2026-09-21T07:47:28.000Z' }, desordenado) === true);

fs.rmSync(base, { recursive: true, force: true });
const ok = results.every(Boolean);
console.log(`\n${results.filter(Boolean).length}/${results.length} ${ok ? 'OK' : 'CON FALLOS'}`);
process.exit(ok ? 0 : 1);
