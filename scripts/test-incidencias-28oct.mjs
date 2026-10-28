// ESCENARIOS (28-oct-2026, correo de Eduardo «Re: RobinSearch, un núcleo y varios despliegues»:
// «confirmar cómo se comporta RobinSearch con OneDrive cuando los ficheros solo están en la nube»):
//
//  1. Mac con OneDrive, Google Drive o Dropbox (~/Library/CloudStorage). El documento «solo en la
//     nube» se detectaba bien (0 bloques), pero la descarga se pedía SOLO con `brctl`, que es de
//     iCloud y con esas carpetas contesta «Path is outside of any CloudDocs app library». No bajaba
//     nunca, y al día se daba por «documento vacío».
//  2. Windows con OneDrive bajo demanda. El extractor lee en síncrono: leer un marcador obliga a
//     OneDrive a bajarlo y RobinSearch no contestaba a Claude mientras tanto. Y con OneDrive
//     cerrado, en pausa o sin conexión el error llega como UNKNOWN: «error de indexado», con aviso
//     técnico, y sin reintento.
//  3. Hasta veinte lecturas de descarga a la vez: cada una ocupa uno de los cuatro hilos de disco
//     de Node durante minutos.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-28oct-'));
process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_NUBE_DIAS_MAX = '0'; // «un día» = ya, para probar la regla del vacío
fs.mkdirSync(process.env.ROBIN_DATA_DIR, { recursive: true });
const nube = (await import('../server/indexer/nube.js')).default;
const { esMarcadorDeNube, necesitaTraerse, claseDeError } = await import('../server/indexer/indexer.js');

// ── 1. Qué es un marcador, en cada sistema ───────────────────────────────────────────────────
const marcador = { size: 2_500_000, blocks: 0 };
const local = { size: 2_500_000, blocks: 4888 };
const diminuto = { size: 300, blocks: 0 }; // NTFS lo guarda dentro de la tabla de ficheros
check('Mac: un PDF de OneDrive sin bloques es un marcador (no se abre)', esMarcadorDeNube(marcador, 'darwin') && nube.sinBloques(marcador, 'darwin'));
check('Windows: el mismo marcador no se salta a ciegas, se trae antes de leerlo', !esMarcadorDeNube(marcador, 'win32') && necesitaTraerse(marcador, 'win32'));
check('Windows: un fichero ya en disco no se trae', !necesitaTraerse(local, 'win32') && !nube.sinBloques(local, 'win32'));
check('Windows: un fichero diminuto (dentro de la tabla de NTFS) no se da por «en la nube»', !nube.sinBloques(diminuto, 'win32'));
check('Mac/Linux: nada cambia para un fichero en disco', !esMarcadorDeNube(local, 'darwin') && !necesitaTraerse(marcador, 'darwin'));

// ── 2. Errores de OneDrive en Windows ────────────────────────────────────────────────────────
check('Windows: UNKNOWN al leer es «la nube no lo entrega», no un error de indexado', claseDeError({ code: 'UNKNOWN' }, 'win32') === 'nube');
check('Mac: UNKNOWN sigue siendo un error a explicar', claseDeError({ code: 'UNKNOWN' }, 'darwin') === null);
check('un fichero bloqueado por Word no se confunde con la nube', !nube.esErrorDeNube({ code: 'EBUSY' }) && !nube.esErrorDeNube({ code: 'EACCES' }));

// ── 3. Traer antes de leer, sin bloquear y con cupo ──────────────────────────────────────────
const normal = path.join(base, 'escrito.pdf');
fs.writeFileSync(normal, Buffer.alloc(3 * 1024 * 1024 + 17, 7));
let r = await nube.traer(normal, { plazoMs: 5000 });
check('un fichero que ya está se trae entero y sigue el camino normal', r.estado === 'ok', r.estado);
r = await nube.traer(path.join(base, 'no-existe.pdf'), { plazoMs: 5000 });
check('uno que ha desaparecido no se toma por «en la nube»', r.estado === 'otro' && r.code === 'ENOENT', JSON.stringify(r));

// Un FIFO sin escritor se queda esperando como un fichero que OneDrive está bajando.
const fifos = ['a', 'b', 'c'].map((n) => path.join(base, `bajando-${n}.pdf`));
for (const f of fifos) execFileSync('mkfifo', [f]);
const t0 = Date.now();
const [ra, rb] = await Promise.all([nube.traer(fifos[0], { plazoMs: 400 }), nube.traer(fifos[1], { plazoMs: 400 })]);
const espera = Date.now() - t0;
check('lo que sigue bajando vuelve como «tarde» al cumplirse el plazo, sin colgar', ra.estado === 'tarde' && rb.estado === 'tarde' && espera < 3000, `${espera} ms`);
check('el event loop no se ha bloqueado mientras tanto', espera >= 380);
check('mientras bajan, el cupo está ocupado (2)', nube.descargasEnCurso() === 2, String(nube.descargasEnCurso()));
const t1 = Date.now();
const rc = await nube.traer(fifos[2], { plazoMs: 5000 });
check('un tercero no espera: «tarde» al instante y a la cola', rc.estado === 'tarde' && Date.now() - t1 < 200);
// Termina la «descarga»: un escritor abre y cierra cada FIFO (fin de fichero para el lector).
for (const f of fifos.slice(0, 2)) spawn('sh', ['-c', `: > "${f}"`]);
for (let i = 0; i < 50 && nube.descargasEnCurso() > 0; i += 1) await new Promise((res) => setTimeout(res, 100));
check('al acabar la descarga, el cupo se devuelve', nube.descargasEnCurso() === 0, String(nube.descargasEnCurso()));

// ── 4. Uno con tamaño que sigue sin bajar NO es un documento vacío ───────────────────────────
nube._limpiarParaPrueba();
// Fichero disperso: tiene tamaño y 0 bloques en disco, como un marcador de la nube.
const enLaNube = path.join(base, 'Demanda (solo en la nube).pdf');
fs.closeSync(fs.openSync(enLaNube, 'w'));
fs.truncateSync(enLaNube, 900_000);
const vacio = path.join(base, 'vacio.pdf');
fs.writeFileSync(vacio, '');
const dispersoDeVerdad = fs.statSync(enLaNube).blocks === 0;
nube.apuntar(enLaNube, 'sin_descargar');
nube.apuntar(vacio, 'vacio');
const rev = await nube.revisar({ forzar: true });
const pend = nube.lista().map((e) => path.basename(e.ruta));
if (dispersoDeVerdad) {
  check('el PDF con tamaño y sin bajar sigue pendiente pasado el día (no «vacío»)', pend.includes(path.basename(enLaNube)), JSON.stringify(rev));
} else {
  console.log('  ----  (este disco no deja ficheros dispersos: se salta la comprobación del marcador)');
}
check('el de cero bytes sí se da por vacío, como antes', !pend.includes('vacio.pdf') && rev.vacios >= 1, JSON.stringify(rev));
nube._limpiarParaPrueba();

// ── 5. En vivo (solo Mac con iCloud): un documento «solo en la nube» FUERA de iCloud Drive ────
// Se llega a él por un enlace desde otra carpeta, como llegaría RobinSearch a ~/Library/CloudStorage:
// ahí `brctl` no sirve y la descarga tiene que salir de la lectura.
const ICLOUD = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
let enVivo = null;
if (process.platform === 'darwin' && process.env.ROBIN_PRUEBA_NUBE_EN_VIVO === '1' && fs.existsSync(ICLOUD)) {
  const pila = [ICLOUD];
  while (pila.length && !enVivo) {
    const d = pila.pop();
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && !e.name.startsWith('.')) pila.push(p);
      else if (e.isFile()) {
        try {
          const st = fs.statSync(p);
          if (st.size > 1000 && st.size < 2_000_000 && st.blocks === 0) { enVivo = p; break; }
        } catch { /* nada */ }
      }
    }
  }
}
if (enVivo) {
  const enlace = path.join(base, 'CloudStorage-simulado', path.basename(enVivo));
  fs.mkdirSync(path.dirname(enlace), { recursive: true });
  fs.symlinkSync(enVivo, enlace);
  check('en vivo: el documento está en la nube (0 bloques)', nube.estadoEnDisco(enlace) === 'no');
  nube.apuntar(enlace, 'sin_descargar');
  await nube.revisar({ forzar: true });
  let bajado = false;
  for (let i = 0; i < 60 && !bajado; i += 1) {
    await new Promise((res) => setTimeout(res, 1000));
    bajado = nube.estadoEnDisco(enlace) === 'si';
  }
  check('en vivo: RobinSearch lo baja leyéndolo, sin brctl', bajado);
  const r2 = await nube.revisar({ forzar: true });
  check('en vivo: y en la pasada siguiente sale como listo para indexar', r2.listos === 1, JSON.stringify(r2));
  nube._limpiarParaPrueba();
} else {
  console.log('  ----  prueba en vivo no ejecutada (ROBIN_PRUEBA_NUBE_EN_VIVO=1 en un Mac con iCloud y algún fichero solo en la nube)');
}

fs.rmSync(base, { recursive: true, force: true });
const fallos = results.filter((x) => !x).length;
console.log(`\n${results.length - fallos}/${results.length} OK`);
process.exit(fallos ? 1 : 0);
