// ESCENARIO (21-sep-2026, regla de Alonso): «si detectas el error, lo que hay que hacer es
// solucionarlo para que no dé ese error nunca más». Esta prueba cubre los documentos que hasta
// la 1.8.1 RobinSearch se limitaba a contar como fallidos, dejando al abogado sin ellos:
//   · Word y PowerPoint de antes de 2007 (.doc, .ppt): no se leían («Formato no soportado»).
//   · .doc guardado con extensión .docx y .docx guardado como .doc: cada uno se lee por lo que es.
//   · .docx/.odt con el ZIP truncado: se rescata su texto en vez de darlos por perdidos.
//   · PDF cifrado: se prueban las contraseñas del despacho (ROBIN_PDF_CLAVES).
//   · PDF con la estructura rota: se rehace con mupdf en vez de darlo por ilegible.
//   · .zip adjunto a un correo (asi llega el expediente de LexNet): se abre y se indexa.
//   · .txt y .csv de Windows o en UTF-16: se leen con su juego de caracteres, no como UTF-8.
//   · Documento que la nube no ha bajado: se apunta, se pide la descarga y se indexa al llegar.
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-nada-fuera-'));
process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_LOG_LEVEL = 'error';
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const fixture = (n) => path.join(REPO, 'scripts', 'fixtures', n);
const texto = (r) => (r?.pages || []).map((p) => p.text).join('\n');
const { extractFile } = await imp('server/indexer/extract.js');
const intenta = async (p) => { try { return { r: await extractFile(p) }; } catch (e) { return { e }; } };

// ── 1. Office anterior a 2007 ──────────────────────────────────────────────────────────────
let x = await intenta(fixture('escrito-97.doc'));
check('Word 97-2003 (.doc) se lee entero y con sus tildes',
  /embargo preventivo/.test(texto(x.r)) && /José Núñez Peña/.test(texto(x.r)), x.e ? String(x.e.message) : texto(x.r).slice(0, 60));
x = await intenta(fixture('presentacion-97.ppt'));
check('PowerPoint 97-2003 (.ppt) se lee', /junta general de socios/.test(texto(x.r)) && /reparto de dividendos/.test(texto(x.r)),
  x.e ? String(x.e.message) : texto(x.r).slice(0, 60));

const copia = (fix, nombre) => { const p = path.join(base, nombre); fs.copyFileSync(fixture(fix), p); return p; };
x = await intenta(copia('escrito-97.doc', 'renombrado.docx'));
check('un .doc guardado como .docx se lee como lo que es', /embargo preventivo/.test(texto(x.r)), x.e ? String(x.e.message) : '');

const { esExtensionSoportada } = await imp('server/config.js');
check('los .doc y .ppt del despacho entran en el indexado',
  esExtensionSoportada('/x/Pérez/demanda.doc') && esExtensionSoportada('/x/Pérez/vista.ppt'));

// ── 2. ZIP truncado: se rescata el texto ───────────────────────────────────────────────────
const AdmZip = (await import(pathToFileURL(path.join(REPO, 'node_modules/adm-zip/adm-zip.js')).href)).default;
const truncar = (buf, nombre) => {
  const i = buf.lastIndexOf(Buffer.from('PK\x01\x02', 'latin1'));   // fuera el directorio central
  const p = path.join(base, nombre);
  fs.writeFileSync(p, buf.subarray(0, i));
  return p;
};
const zDocx = new AdmZip();
zDocx.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types/>'));
zDocx.addFile('word/document.xml', Buffer.from('<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Escrito de oposición a la ejecución hipotecaria</w:t></w:r></w:p></w:body></w:document>'));
x = await intenta(truncar(zDocx.toBuffer(), 'cortado.docx'));
check('.docx con el ZIP truncado: se rescata su texto', /oposición a la ejecución/.test(texto(x.r)), x.e ? String(x.e.message) : texto(x.r).slice(0, 60));

const zOdt = new AdmZip();
zOdt.addFile('mimetype', Buffer.from('application/vnd.oasis.opendocument.text'));
zOdt.addFile('content.xml', Buffer.from('<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:text="t"><office:body><text:p>Convenio regulador de divorcio de mutuo acuerdo</text:p></office:body></office:document-content>'));
x = await intenta(truncar(zOdt.toBuffer(), 'cortado.odt'));
check('.odt con el ZIP truncado: se rescata su texto', /Convenio regulador/.test(texto(x.r)), x.e ? String(x.e.message) : texto(x.r).slice(0, 60));

fs.writeFileSync(path.join(base, 'basura.odt'), 'esto no es un zip ni de lejos'.repeat(20));
x = await intenta(path.join(base, 'basura.odt'));
check('y lo que no hay por dónde cogerlo sigue siendo error DEL FICHERO', x.e?.code === 'ROBIN_FICHERO_FORMATO', String(x.e?.code));

// ── 3. PDF protegido con contraseña ────────────────────────────────────────────────────────
x = await intenta(fixture('protegido.pdf'));
check('PDF cifrado sin contraseña configurada: se dice lo que pasa, no un fallo técnico',
  x.e?.code === 'ROBIN_FICHERO_PDF_PROTEGIDO', String(x.e?.code));
// El módulo lee las contraseñas al importarse: se prueba en un proceso aparte con el entorno puesto.
const { execFileSync } = await import('node:child_process');
const guion = `import('${pathToFileURL(path.join(REPO, 'server/indexer/extract.js')).href}')`
  + `.then(async (m) => { const r = await m.extractFile(${JSON.stringify(fixture('protegido.pdf'))});`
  + ` process.stdout.write(r.pages.map((p) => p.text).join(' ')); });`;
let salida = '';
try {
  salida = execFileSync(process.execPath, ['--input-type=module', '-e', guion], {
    env: { ...process.env, ROBIN_PDF_CLAVES: 'la-que-no-es;expediente2026', ROBIN_LOG_LEVEL: 'error' },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch (err) { salida = `FALLO: ${err?.message}`; }
check('con la contraseña del despacho en ROBIN_PDF_CLAVES, el PDF se indexa',
  /Notificacion cifrada del juzgado/.test(salida), salida.slice(0, 80));

x = await intenta(fixture('sin-tabla.pdf'));
check('PDF copiado a medias (sin tabla de objetos): se rehace y se lee',
  /medidas cautelares inaudita parte/.test(texto(x.r)), x.e ? `${x.e.code} ${x.e.message}` : texto(x.r).slice(0, 60));
const cortado = path.join(base, 'nada.pdf');
fs.writeFileSync(cortado, '%PDF-1.4\nesto no es un PDF de verdad, está cortado\n');
x = await intenta(cortado);
check('y uno que no tiene nada dentro sigue siendo un fichero dañado', x.e?.code === 'ROBIN_FICHERO_PDF_ROTO', String(x.e?.code));

// ── 3b. El expediente que llega en un .zip adjunto al correo (LexNet) ────────────────
const zLex = new AdmZip();
zLex.addFile('auto.txt', Buffer.from('Auto de despacho de ejecución por importe de 34.000 euros'));
const rutaZip = path.join(base, 'expediente.zip');
fs.writeFileSync(rutaZip, zLex.toBuffer());
const correoConZip = [
  'From: lexnet@justicia.es', 'To: despacho@ejemplo.es', 'Subject: Notificacion de auto',
  'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="Z"', '',
  '--Z', 'Content-Type: text/plain; charset="utf-8"', '', 'Se adjunta el expediente.', '',
  '--Z', 'Content-Type: application/zip; name="expediente.zip"',
  'Content-Disposition: attachment; filename="expediente.zip"',
  'Content-Transfer-Encoding: base64', '',
  fs.readFileSync(rutaZip).toString('base64').replace(/(.{76})/g, '$1\r\n'), '', '--Z--', ''].join('\r\n');
const rutaCorreo = path.join(base, 'notificacion-lexnet.eml');
fs.writeFileSync(rutaCorreo, correoConZip);
x = await intenta(rutaCorreo);
check('el .zip adjunto a un correo se abre y su contenido se indexa',
  /despacho de ejecución por importe/.test(texto(x.r)), x.e ? String(x.e.message) : texto(x.r).slice(0, 120));

// ── 3c. Textos antiguos de Windows ───────────────────────────────────────────
const enCp1252 = path.join(base, 'nota-1998.txt');
fs.writeFileSync(enCp1252, Buffer.from('Ejecución hipotecaria del señor Núñez — 12 % de interés', 'latin1'));
x = await intenta(enCp1252);
check('un .txt hecho en Windows se lee con sus tildes (antes: «Ã³»)',
  /Ejecución hipotecaria del señor Núñez/.test(texto(x.r)), x.e ? String(x.e.message) : texto(x.r));
const enUtf16 = path.join(base, 'nota-utf16.txt');
fs.writeFileSync(enUtf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Diligencia de embargo de la cuenta corriente', 'utf16le')]));
x = await intenta(enUtf16);
check('y uno guardado en UTF-16 también', /Diligencia de embargo/.test(texto(x.r)), x.e ? String(x.e.message) : texto(x.r));

// ── 4. Lo que la nube no ha bajado se pide y se reintenta ──────────────────────────────────
const nube = (await imp('server/indexer/nube.js')).default;
nube._limpiarParaPrueba?.();
const enLaNube = path.join(base, 'sentencia.pdf');
fs.writeFileSync(enLaNube, '');                                  // a cero bytes, como lo deja OneDrive
nube.apuntar(enLaNube, 'vacio');
check('un documento sin descargar se apunta, no se pierde', nube.cuantos() === 1);
check('y no se da por listo mientras no tenga contenido', nube.estadoEnDisco(enLaNube) === 'no');
let r = await nube.revisar({ forzar: true });
check('se pide su descarga y se deja para más tarde', r.pendientes === 1 && r.listos === 0, JSON.stringify(r));
// La lista sobrevive a apagar el ordenador.
nube._limpiarParaPrueba?.();
check('...y si se borrara la lista, no quedaría nada colgando', nube.cuantos() === 0);
nube.apuntar(enLaNube, 'vacio');
fs.writeFileSync(enLaNube, '%PDF-1.4 ya ha bajado');             // la nube lo ha traído
const indexados = [];
r = await nube.revisar({ forzar: true, indexar: async (ruta) => indexados.push(ruta) });
check('en cuanto llega, se indexa y deja de estar pendiente',
  r.listos === 1 && nube.cuantos() === 0 && indexados.length === 1, JSON.stringify(r));
fs.rmSync(enLaNube, { force: true });
nube.apuntar(enLaNube, 'vacio');
r = await nube.revisar({ forzar: true });
check('un documento que se borra deja de estar pendiente', nube.cuantos() === 0, JSON.stringify(r));
nube.parar();

console.log(`\n${results.filter(Boolean).length}/${results.length} comprobaciones OK`);
fs.rmSync(base, { recursive: true, force: true });
process.exit(results.every(Boolean) ? 0 : 1);
