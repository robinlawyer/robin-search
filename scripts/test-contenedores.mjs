// ESCENARIO: un expediente comprimido (LexNet, Justizia.eus, o lo que mande la otra parte) que es
// una BOMBA: un zip de pocos MB con 1 GB de ceros dentro. Hasta la 1.4.7 zip, rar y 7z se
// descomprimían enteros en memoria ANTES de mirar los límites: agotaba la memoria y tumbaba
// RobinSearch, y con él lo demás del contenedor.
//
//   A. Zip bomba (1 GiB de ceros con cabecera honesta + 64 MB con cabecera que MIENTE + un
//      documento normal): se aparta rápido, sin disparar la memoria, y el documento normal se lee.
//   B. 7z: se lee miembro a miembro, respeta los límites por tipo y no deja process.exitCode.
//   C. RAR (escrito a mano, RAR5 sin compresión): se lee, respeta límites y un nombre con «../» no
//      escribe fuera del temporal.
//   D. Contenedores dañados: no revientan, devuelven vacío.
//
// Los ficheros se GENERAN aquí, por streaming: nada de 1 GB en disco ni en memoria.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

// fileURLToPath y no `.pathname`: en Windows da «/C:/…» y en cualquier SO rompe con espacios o tildes.
const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (n, c, d = '') => {
  results.push(c);
  console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`);
};
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-contenedores-'));
const tmpHijo = path.join(base, 'tmp');
fs.mkdirSync(tmpHijo, { recursive: true });

// CRC32 propio (zlib.crc32 solo existe desde Node 22.2).
const TABLA = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf, prev = 0) {
  let c = ~prev;
  for (let i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// Zip escrito por streaming. `declarar` = tamaño descomprimido que se ANUNCIA (para mentir).
async function generarZip(ruta, miembros) {
  const fd = fs.openSync(ruta, 'w');
  let pos = 0;
  const w = (b) => {
    fs.writeSync(fd, b, 0, b.length, pos);
    pos += b.length;
  };
  const central = [];
  for (const { nombre, trozos, declarar } of miembros) {
    const nom = Buffer.from(nombre, 'utf8');
    const local = pos;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0808, 6); // tamaños en el descriptor final + nombre UTF-8
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(nom.length, 26);
    w(lh);
    w(nom);
    const inicio = pos;
    let size = 0;
    let c = 0;
    const def = zlib.createDeflateRaw({ level: 1 });
    def.on('data', (d) => w(d));
    const fin = new Promise((r) => def.on('end', r));
    for (const t of trozos()) {
      size += t.length;
      // El CRC de 1 GB de ceros en JS puro tardaría: solo se calcula en los pequeños.
      if (size < 16 * 1024 * 1024) c = crc32(t, c);
      if (!def.write(t)) await new Promise((r) => def.once('drain', r));
    }
    def.end();
    await fin;
    const packed = pos - inicio;
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0);
    dd.writeUInt32LE(c, 4);
    dd.writeUInt32LE(packed, 8);
    dd.writeUInt32LE(size >>> 0, 12);
    w(dd);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0808, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(c, 16);
    ch.writeUInt32LE(packed, 20);
    ch.writeUInt32LE((declarar ?? size) >>> 0, 24);
    ch.writeUInt16LE(nom.length, 28);
    ch.writeUInt32LE(local, 42);
    central.push(Buffer.concat([ch, nom]));
  }
  const cdOff = pos;
  for (const b of central) w(b);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(central.length, 8);
  e.writeUInt16LE(central.length, 10);
  e.writeUInt32LE(pos - cdOff, 12);
  e.writeUInt32LE(cdOff, 16);
  w(e);
  fs.closeSync(fd);
  return pos;
}
const MB = Buffer.alloc(1024 * 1024);
const ceros = (mb) =>
  function* () {
    for (let i = 0; i < mb; i++) yield MB;
  };
const texto = (t) =>
  function* () {
    yield Buffer.from(t);
  };

// RAR5 mínimo sin compresión, escrito a mano (no hay con qué crear un .rar en la prueba).
const vint = (n) => {
  const o = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n) b |= 128;
    o.push(b);
  } while (n);
  return Buffer.from(o);
};
function bloqueRar(campos, datos = Buffer.alloc(0)) {
  const cuerpo = Buffer.concat(campos);
  const cab = Buffer.concat([vint(cuerpo.length), cuerpo]);
  const c = Buffer.alloc(4);
  c.writeUInt32LE(crc32(cab));
  return Buffer.concat([c, cab, datos]);
}
function generarRar(miembros) {
  const partes = [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]), bloqueRar([vint(1), vint(0), vint(0)])];
  for (const { nombre, datos } of miembros) {
    const nom = Buffer.from(nombre, 'utf8');
    const dc = Buffer.alloc(4);
    dc.writeUInt32LE(crc32(datos));
    partes.push(bloqueRar([vint(2), vint(0x0002), vint(datos.length), vint(0x0004), vint(datos.length), vint(0x20), dc, vint(0), vint(0), vint(nom.length), nom], datos));
  }
  partes.push(bloqueRar([vint(5), vint(0), vint(0)]));
  return Buffer.concat(partes);
}

// Extrae en un proceso aparte para medir SU memoria máxima (resourceUsage().maxRSS, en KB, igual
// en Windows, Linux y macOS) y su código de salida.
function extraer(fichero, env = {}) {
  const prog = `
const { extractFile } = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'server/indexer/extract.js')).href)});
const t0 = Date.now();
let r = null, error = null;
try { r = await extractFile(${JSON.stringify(fichero)}); } catch (e) { error = String(e?.message ?? e); }
console.log(JSON.stringify({ r, error, ms: Date.now() - t0, maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024), exitCode: process.exitCode ?? 0 }));`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', prog], {
    env: { ...process.env, ROBIN_DATA_DIR: path.join(base, 'datos'), ROBIN_LOG_LEVEL: 'error', ROBIN_OCR: 'false', TMPDIR: tmpHijo, TMP: tmpHijo, TEMP: tmpHijo, ...env },
    maxBuffer: 16 * 1024 * 1024,
  }).toString();
  return JSON.parse(out.trim().split('\n').pop());
}
const textoDe = (x) => (x?.r?.pages || []).map((p) => p.text).join('\n');

// ───────────────────────── A. Zip bomba ─────────────────────────
console.log('\nA. Zip bomba\n');
{
  const zip = path.join(base, 'Expediente remitido.zip');
  const t0 = Date.now();
  const bytes = await generarZip(zip, [
    { nombre: 'escritura.txt', trozos: texto('Escritura de compraventa con subrogación de hipoteca.') },
    { nombre: 'bomba.txt', trozos: ceros(1024) },
    { nombre: 'mentira.txt', trozos: ceros(64), declarar: 2048 },
    { nombre: 'anexo.txt', trozos: texto('Anexo con la nota simple registral.') },
  ]);
  console.log(`  (zip de ${(bytes / 1048576).toFixed(1)} MB con 1,09 GB dentro, generado en ${Date.now() - t0} ms)`);
  const x = extraer(zip);
  check('A.1 los documentos normales se leen', /subrogación de hipoteca/.test(textoDe(x)) && /nota simple/.test(textoDe(x)), x.error || textoDe(x).slice(0, 60));
  check('A.2 la bomba y la cabecera que miente NO se descomprimen', !/bomba|mentira/.test(textoDe(x)));
  check('A.3 rápido (< 10 s)', x.ms < 10000, `${x.ms} ms`);
  check('A.4 sin disparar la memoria (máx. < 300 MB; antes > 1 GB)', x.maxRssMb < 300, `${x.maxRssMb} MB`);
  check('A.5 no quedan temporales', fs.readdirSync(tmpHijo).length === 0, fs.readdirSync(tmpHijo).join(','));
}

// ───────────────────────── B. 7z ─────────────────────────
console.log('\nB. 7z miembro a miembro\n');
{
  const SevenZip = (await import(pathToFileURL(path.join(REPO, 'node_modules', '7z-wasm', '7zz.umd.js')).href)).default;
  const src = path.join(base, 'src7z');
  fs.mkdirSync(path.join(src, 'Pieza [1]'), { recursive: true });
  fs.writeFileSync(path.join(src, 'demanda.txt'), 'Demanda de juicio ordinario por incumplimiento contractual.');
  fs.writeFileSync(path.join(src, 'Pieza [1]', 'auto.txt'), 'Auto de admisión a trámite.');
  fs.writeFileSync(path.join(src, 'ceros.txt'), Buffer.alloc(3 * 1024 * 1024));
  const sz = await SevenZip({ print: () => {}, printErr: () => {} });
  sz.FS.mkdir('/w');
  sz.FS.mount(sz.NODEFS, { root: base }, '/w');
  sz.FS.chdir('/w/src7z');
  sz.callMain(['a', '/w/expediente.7z', 'demanda.txt', 'Pieza [1]', 'ceros.txt']);
  const x = extraer(path.join(base, 'expediente.7z'), { ROBIN_MAX_MB: '1' });
  check('B.1 lee los miembros (también en subcarpetas con corchetes)', /incumplimiento contractual/.test(textoDe(x)) && /admisión a trámite/.test(textoDe(x)), x.error || textoDe(x).slice(0, 80));
  check('B.2 respeta el límite por tipo ANTES de extraer', !/ceros\.txt/.test(textoDe(x)));
  fs.writeFileSync(path.join(base, 'roto.7z'), Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), Buffer.alloc(200, 7)]));
  const y = extraer(path.join(base, 'roto.7z'));
  check('B.3 un 7z dañado no revienta ni deja process.exitCode', !y.error && (y.r?.pages?.length ?? 0) === 0 && y.exitCode === 0, JSON.stringify({ error: y.error, exitCode: y.exitCode }));
}

// ───────────────────────── C. RAR ─────────────────────────
console.log('\nC. RAR\n');
{
  const rar = path.join(base, 'expediente.rar');
  fs.writeFileSync(
    rar,
    generarRar([
      { nombre: 'acta.txt', datos: Buffer.from('Acta de la junta general de accionistas.') },
      { nombre: '../fuera-del-temporal.txt', datos: Buffer.from('Nombre con subida de carpeta.') },
      { nombre: 'grande.txt', datos: Buffer.alloc(3 * 1024 * 1024) },
    ]),
  );
  const x = extraer(rar, { ROBIN_MAX_MB: '1' });
  check('C.1 lee los miembros', /junta general/.test(textoDe(x)) && /subida de carpeta/.test(textoDe(x)), x.error || textoDe(x).slice(0, 80));
  check('C.2 respeta el límite por tipo ANTES de extraer', !/grande\.txt/.test(textoDe(x)));
  check('C.3 un nombre con «../» no escribe fuera del temporal, y no quedan restos', !fs.existsSync(path.join(base, 'fuera-del-temporal.txt')) && fs.readdirSync(tmpHijo).length === 0, fs.readdirSync(tmpHijo).join(','));
}

// ───────────────────────── D. Dañados ─────────────────────────
console.log('\nD. Contenedores dañados\n');
for (const [nombre, datos] of [
  ['cortado.zip', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100, 1)])],
  ['basura.rar', Buffer.from('Rar!\x1a\x07\x01\x00 esto no sigue')],
]) {
  const f = path.join(base, nombre);
  fs.writeFileSync(f, datos);
  const x = extraer(f);
  check(`D. ${nombre}: vacío, sin excepción`, !x.error && (x.r?.pages?.length ?? 0) === 0, JSON.stringify({ error: x.error }));
}

fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok === results.length ? 0 : 1);
