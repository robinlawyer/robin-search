// ESCENARIO (panel de fallos 16-19 sep-2026 y correo de Eduardo y Juan del 19/20-sep, expediente
// real de 1.150 ficheros en un Mac de 8 GB con iCloud):
//   · ~90 «eliminado» en 24 ms tras un episodio de ENOSPC/ETIMEDOUT, y el expediente se quedó en
//     43 documentos de 1.150. El vigilante daba por BORRADO todo fichero que no pudiera mirar.
//   · 202 ficheros con ETIMEDOUT: ficheros de iCloud que están en la carpeta pero no en el disco.
//   · 4 ficheros con ENOENT: desaparecieron entre el recorrido y la lectura. No son un fallo.
//   · «1 hilo de los 4 previstos» sin explicación en pantalla (el motivo solo iba al registro).
//   · La «caída previa» llegaba al panel y al correo con un guion por causa.
//   · Una carpeta heredada que ya no existe fallaba en CADA intento, para siempre.
//   · Un «Robin Search» 1.0.0 huérfano corriendo junto al 1.6.1 instalado.
//   · 56 PDFs con «Invalid PDF structure» tratados como fallo nuestro.
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-incid-'));
const carpeta = path.join(base, 'Expedientes');
fs.mkdirSync(carpeta, { recursive: true });
process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_FOLDER = carpeta;
process.env.ROBIN_LOG_LEVEL = 'error';
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);

// ── 1. El vigilante no da por borrado lo que no ha podido mirar ────────────────────────────
const { existeEnDisco } = await imp('server/watcher/watcher.js');
const vivo = path.join(carpeta, 'demanda.txt');
fs.writeFileSync(vivo, 'Demanda de juicio ordinario');
check('fichero que está → true', existeEnDisco(vivo) === true);
check('fichero que no está → false', existeEnDisco(path.join(carpeta, 'no-existe.txt')) === false);
// ENOTDIR: pedir un fichero «dentro de» un fichero. Es un no-existe de verdad.
check('ruta imposible (ENOTDIR) → false', existeEnDisco(path.join(vivo, 'dentro.txt')) === false);

// ── 1b. De extremo a extremo: un episodio de disco/nube NO vacía el expediente ─────────────
//
// Es LA regresión a evitar: el 19-sep, 90 «eliminado» en 24 ms dejaron 43 documentos de 1.150.
// Aquí se indexan 40 ficheros, se le cuelan al vigilante 40 borrados de golpe sobre ficheros que
// siguen en disco (justo lo que pasó), y se comprueba que el índice NO se vacía.
{
  const { indexFolder } = await imp('server/indexer/indexer.js');
  const registry = await imp('server/indexer/registry.js');
  const store = await imp('server/search/store.js');
  const escritor = await imp('server/escritor.js');
  const watcher = await imp('server/watcher/watcher.js');
  const masivo = path.join(carpeta, 'Pleito grande');
  fs.mkdirSync(masivo, { recursive: true });
  const ficheros = [];
  for (let i = 0; i < 40; i++) {
    const f = path.join(masivo, `escrito-${i}.txt`);
    fs.writeFileSync(f, `Escrito número ${i} del procedimiento ordinario, con alegaciones sobre la cláusula suelo.`);
    ficheros.push(f);
  }
  escritor.adquirir();
  await store.abrir({ migrar: true });
  const antes = await indexFolder({ force: false });
  check('se indexan los 40 escritos', antes.indexados >= 40, `indexados: ${antes.indexados}`);
  const docsAntes = registry.stats().documentos;

  // El vigilante recibe 40 «se ha borrado» de golpe. Los ficheros siguen ahí.
  for (const f of ficheros) watcher._encolarParaPrueba(f, 'remove');
  await watcher._drenarParaPrueba();
  const docsDespues = registry.stats().documentos;
  check('un borrado masivo FALSO no vacía el expediente', docsDespues === docsAntes,
    `${docsAntes} documentos antes, ${docsDespues} después`);

  // Y un borrado de VERDAD sí se atiende: el índice tiene que seguir siendo fiel al disco.
  fs.rmSync(ficheros[0], { force: true });
  watcher._encolarParaPrueba(ficheros[0], 'remove');
  await watcher._drenarParaPrueba();
  check('un borrado de verdad sí retira el documento', registry.stats().documentos === docsAntes - 1,
    `${registry.stats().documentos} de ${docsAntes}`);
  escritor.soltar();
}

// ── 2. Marcador de la nube: se detecta ANTES de leerlo ─────────────────────────────────────
const { esMarcadorDeNube, claseDeError } = await imp('server/indexer/indexer.js');
check('fichero con tamaño y sin bloques = marcador de la nube',
  process.platform === 'win32' ? true : esMarcadorDeNube({ size: 240_000, blocks: 0 }) === true);
const stReal = fs.statSync(vivo);
check('un fichero de verdad NO es marcador', esMarcadorDeNube(stReal) === false);
check('un fichero vacío tampoco (es vacío, no de la nube)', esMarcadorDeNube({ size: 0, blocks: 0 }) === false);

// ── 3. Clasificación de errores: nube, disco y desaparecidos ───────────────────────────────
check('ETIMEDOUT = nube', claseDeError({ code: 'ETIMEDOUT' }) === 'nube');
check('ENOSPC = disco', claseDeError({ code: 'ENOSPC' }) === 'disco');
check('ENOENT = desaparecido', claseDeError({ code: 'ENOENT' }) === 'desaparecido');
check('un fallo de verdad sigue siendo un fallo', claseDeError({ code: 'ERR_RARO' }) === null
  && claseDeError(new Error('el motor de embedding falló')) === null);

// ── 4. La causa de la caída previa deja de ser un guion ────────────────────────────────────
const { causaDeCaida } = await imp('server/bootstrap.js');
const c1 = causaDeCaida({ fase: 'indexando', ext: '.pdf', bytes: 2_977_886, caidasSeguidas: 2, version: '1.6.1' }, 'indexando');
check('caída indexando un PDF: dice fase, fichero, tamaño y racha',
  /se cortó sin cerrar/.test(c1) && /\.pdf/.test(c1) && /2,8 MB/.test(c1) && /2 caídas seguidas/.test(c1), c1);
const c2 = causaDeCaida({ fase: 'cargando_indice', caidasSeguidas: 1 }, 'cargando_indice');
check('caída abriendo el índice: se entiende sin leer código', /abriendo el índice/.test(c2), c2);
check('si ya había causa (excepción), se respeta',
  causaDeCaida({ causa: 'Reached heap limit Allocation failed' }, 'indexando') === 'Reached heap limit Allocation failed');
check('la causa NO lleva nombres ni rutas',
  !/[\\/]/.test(c1.replace(/[^\x20-\x7e áéíóúñÁÉÍÓÚÑ]/g, '')) && !/demanda|expediente/i.test(c1), c1);

// ── 5. Carpeta configurada que ya no existe: se aparta, no falla en cada intento ────────────
const ausentes = await imp('server/carpetas-ausentes.js');
const { config, recargarCarpetas } = await imp('server/config.js');
check('la carpeta que existe NO se aparta', (ausentes.revisar({ forzar: true }), !ausentes.estaAusente(carpeta)));
const fantasma = path.join(base, 'Expediente que ya no está');
fs.mkdirSync(fantasma);
process.env.ROBIN_FOLDERS = JSON.stringify([carpeta, fantasma]);
recargarCarpetas();
ausentes._limpiarParaPrueba();
check('con las dos carpetas presentes, ninguna se aparta',
  (ausentes.revisar({ forzar: true }), ausentes.lista().length === 0), JSON.stringify(ausentes.lista()));
fs.rmSync(fantasma, { recursive: true, force: true });
ausentes.revisar({ forzar: true });
check('la carpeta que desaparece se aparta', ausentes.estaAusente(fantasma) && !ausentes.estaAusente(carpeta));
check('y las presentes siguen trabajando', ausentes.presentes(config.watchedFolders).includes(carpeta)
  && !ausentes.presentes(config.watchedFolders).includes(fantasma));
fs.mkdirSync(fantasma);
ausentes.revisar({ forzar: true });
check('si vuelve, se vuelve a vigilar sola', !ausentes.estaAusente(fantasma));

// ── 6. El motivo de ir con menos hilos llega a la pantalla ─────────────────────────────────
const pool = (await imp('server/embedder/pool.js')).default;
const est = pool.estado();
check('el estado del pool declara los hilos y el objetivo',
  Object.hasOwn(est, 'hilos') && Object.hasOwn(est, 'hilos_objetivo'), JSON.stringify(est));

// ── 7. Un PDF roto es fallo DEL FICHERO, no nuestro ────────────────────────────────────────
const { extractFile } = await imp('server/indexer/extract.js');
const roto = path.join(base, 'escrito-roto.pdf');
fs.writeFileSync(roto, '%PDF-1.4\nesto no es un PDF de verdad, está cortado\n');
let err = null;
try { await extractFile(roto); } catch (e) { err = e; }
check('PDF dañado → ROBIN_FICHERO_* (no dispara aviso técnico)',
  Boolean(err) && String(err.code || '').startsWith('ROBIN_FICHERO_'), String(err && (err.code || err.message)).slice(0, 80));

// ── 7b. Aviso del 21-sep: las caídas de la versión ANTERIOR no rehacen el índice ───────────
//
// Un despacho con 37.910 documentos llegó a la 1.8.0 arrastrando dos caídas de la 1.6.1: a una
// sola de que RobinSearch diera el índice por irrecuperable y volviera a indexarlo entero, por un
// fallo que la versión nueva podía haber arreglado. La cuenta es POR VERSIÓN.
const diag = await imp('server/diagnostico.js');
const { VERSION } = await imp('server/config.js');
const rutaEstado = path.join(process.env.ROBIN_DATA_DIR, 'diagnostico.json');
fs.mkdirSync(path.dirname(rutaEstado), { recursive: true });
const ponerCaidas = (versiones) => fs.writeFileSync(rutaEstado, JSON.stringify({
  caidasSeguidas: versiones.length,
  caidas: versiones.map((v, i) => ({ fase: 'cargando_indice', t: `2026-09-21T08:0${i}:00.000Z`, version: v })),
}));
ponerCaidas(['1.6.1', '1.6.1']);
check('caídas de una versión anterior no cuentan para rehacer el índice',
  diag.caidasSeguidasEn(['cargando_indice', 'migrando_indice']) === 0);
ponerCaidas([VERSION, VERSION]);
check('caídas de ESTA versión sí cuentan',
  diag.caidasSeguidasEn(['cargando_indice', 'migrando_indice']) === 2);
ponerCaidas(['1.6.1', VERSION]);
check('tras actualizar, la cuenta empieza de cero y la caída nueva suma',
  diag.caidasSeguidasEn(['cargando_indice', 'migrando_indice']) === 1);
fs.rmSync(rutaEstado, { force: true });

// ── 8. El OCR sabe cuánto espacio queda ────────────────────────────────────────────────────
const { espacioLibreMb } = await imp('server/indexer/ocr.js');
const libre = espacioLibreMb(base);
check('se puede medir el espacio libre del disco', libre === null || (Number.isFinite(libre) && libre >= 0), `${libre} MB`);

console.log(`\n${results.filter(Boolean).length}/${results.length} comprobaciones OK`);
fs.rmSync(base, { recursive: true, force: true });
process.exit(results.every(Boolean) ? 0 : 1);
