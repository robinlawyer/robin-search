// OCR local de PDFs escaneados (v1.0). 100% en el ordenador del abogado:
//   mupdf (WASM)  → rasteriza cada página del PDF a PNG
//   tesseract.js (WASM) → reconoce el texto de esa imagen
//
// Ninguna imagen ni texto del documento sale del ordenador, y desde la 1.3.4 tampoco hay
// descarga: el modelo de idioma (spa.traineddata, ≈3 MB) viaja EMPAQUETADO en `models/tesseract/`
// junto al de embedding. Antes se bajaba de un CDN la primera vez que alguien pasaba un PDF
// escaneado — una descarga más que podía fallar en casa del abogado, y con el mismo defecto:
// la promesa rechazada quedaba cacheada y el OCR ya no volvía a intentarlo en toda la sesión.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extensionDe } from '../rutas.js';
import { fileURLToPath } from 'node:url';
import { config, ensureDataDirs } from '../config.js';
import { log } from '../logger.js';
import { setLectura } from '../state.js';
import { tipoReal } from './tipo-real.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS_DIR = process.env.ROBIN_MODELS_DIR || path.join(PKG_ROOT, 'models');
const OCR_DIR = path.join(MODELS_DIR, 'tesseract');

let _workerPromise = null;
let _estado = { listo: false, origen: null, error: null };

// ── El motor que ha ABORTADO no se puede volver a usar ─────────────────────────────────────
//
// 6-nov-2026 (equipo Windows de un cliente, con Juan delante; antes, los mismos informes el 5-nov
// con la 1.11.4 y el 4-nov con la 1.12.2): RobinSearch moría una y otra vez indexando, cada vez
// con un documento distinto, y había que reiniciar Claude. En el registro, siempre lo mismo: una
// tanda de imágenes al OCR, un «RuntimeError: Aborted()» del motor, más imágenes al mismo motor
// y, pocos segundos después, el proceso muerto sin una sola línea más.
//
// Es el motor de tesseract (WASM, en un worker_threads que comparte proceso con todo lo demás).
// Cuando aborta —se queda sin memoria dentro del WASM— ese módulo queda MUERTO: Emscripten pone
// su ABORT y cualquier llamada posterior es a un runtime que ya no existe. Hasta aquí solo se
// tiraba el motor cuando no contestaba (tope de tiempo); tras un abort se seguía llamando al
// cadáver imagen tras imagen, y una de esas llamadas se lleva por delante el proceso entero.
//
// Ahora: un abort tira el motor (el siguiente documento arranca uno limpio), los trabajos van de
// uno en uno (nadie entra en el WASM mientras otro está dentro, ni lo cierra por debajo), y si
// aborta varias veces seguidas el OCR se para unos minutos en vez de insistir. Un documento sin
// OCR se reintenta; un proceso muerto se lleva el indexado entero y obliga a reiniciar Claude.
const RX_MOTOR_ROTO = /abort(ed)?\b|memory access out of bounds|out of memory|table index is out of bounds|null function or function signature mismatch|unreachable executed|RuntimeError/i;
const MUERTES_PARA_PAUSA = Number(process.env.ROBIN_OCR_MUERTES_PARA_PAUSA) || 3;
const PAUSA_MS = Number(process.env.ROBIN_OCR_PAUSA_MS) || 5 * 60 * 1000;
let _motorRoto = null; // causa del abort, mientras el motor no se haya tirado
let _muertesSeguidas = 0;
let _pausaHasta = 0;
let _enVuelo = 0;
let _pico = 0; // solo pruebas: cuántos trabajos han llegado a estar dentro del motor a la vez
// Solo pruebas automáticas: simula un motor que aborta en los N primeros trabajos (lo que hace
// el WASM de tesseract cuando se queda sin memoria), sin tener que agotar la del equipo.
let _pruebaAbortar = Number(process.env.ROBIN_PRUEBA_OCR_ABORTA || 0);

// ── Espacio en disco ───────────────────────────────────────────────────────────────────────
//
// 19-sep-2026 (Eduardo, Mac de 8 GB): en el mismo segundo en que empezaron 202 errores de
// lectura, el registro tenía antes un `ENOSPC: no space left on device` sobre un PDF. El OCR
// rasteriza CADA página a PNG y con un escaneado de 98 o 114 páginas eso son cientos de MB de
// temporales; con el disco justo, el propio OCR lo remata y arrastra todo lo demás.
//
// Así que se mira antes de empezar, y cada pocas páginas mientras dura.
const MB = 1024 * 1024;
const MINIMO_LIBRE_MB = Number(process.env.ROBIN_OCR_MINIMO_LIBRE_MB) || 800;
const CADA_N_PAGINAS = 10;

// MB libres en el volumen de `dir`, o null si el sistema no lo dice (nunca frena por no saberlo).
export function espacioLibreMb(dir) {
  try {
    const st = fs.statfsSync(dir);
    return Math.round((Number(st.bavail) * Number(st.bsize)) / MB);
  } catch {
    return null;
  }
}

function errorDiscoLleno(libreMb) {
  return Object.assign(
    new Error(
      `No hay espacio suficiente en el disco para leer este PDF escaneado (${libreMb} MB libres, hacen ` +
        `falta al menos ${MINIMO_LIBRE_MB} MB). El OCR convierte cada página a imagen y necesita sitio. ` +
        'Libera espacio y vuelve a indexar.',
    ),
    { code: 'ROBIN_DISCO_LLENO' },
  );
}

// ¿Hay sitio para rasterizar? Se comprueba donde se escriben los temporales.
function comprobarEspacio() {
  const libre = espacioLibreMb(config.tesseractCache || config.dataDir || os.tmpdir());
  if (libre !== null && libre < MINIMO_LIBRE_MB) throw errorDiscoLleno(libre);
  return libre;
}

// ── Memoria ────────────────────────────────────────────────────────────────────────────────
//
// La caída más repetida del panel (16-19 sep-2026) es la misma en tres despachos distintos:
// el proceso muere LEYENDO UN PDF. Rasterizar una página a 300 ppp son decenas de MB de bitmap
// dentro del WASM, que no los devuelve hasta terminar el documento; con el equipo ya justo de
// memoria, esa página es la que remata el proceso y el PDF —sano— acaba en cuarentena.
//
// Así que con poca memoria libre no se cae: se baja la resolución, y si ni así, se deja el
// documento para más tarde en vez de morir. Un PDF sin OCR se puede reintentar; un proceso
// muerto se lleva por delante el indexado entero y asusta al abogado.
const MINIMO_LIBRE_RAM_MB = Number(process.env.ROBIN_OCR_MINIMO_RAM_MB) || 400;
const RAM_PARA_DPI_PLENO_MB = Number(process.env.ROBIN_OCR_RAM_DPI_MB) || 900;

function ramLibreMb() {
  return Math.round(os.freemem() / MB);
}

// En macOS `os.freemem()` solo cuenta páginas LIBRES (la memoria inactiva, que el sistema
// entrega en cuanto se pide, no cuenta): allí la cifra es engañosamente baja y no se frena por
// ella, igual que hace el pool de embedding.
function memoriaFiable() {
  return process.platform !== 'darwin';
}

function dpiSegunMemoria(dpi) {
  if (!memoriaFiable()) return dpi;
  const libre = ramLibreMb();
  if (libre >= RAM_PARA_DPI_PLENO_MB) return dpi;
  if (libre >= MINIMO_LIBRE_RAM_MB) {
    const bajo = Math.max(150, Math.round(dpi * 0.66));
    log.warn('Poca memoria libre: se rasteriza el PDF escaneado a menos resolución', { libre_mb: libre, dpi: bajo });
    return bajo;
  }
  return null; // ni eso: mejor dejarlo para más tarde que morir en el intento
}

// ¿Está el idioma empaquetado y con el tamaño que dice el manifiesto?
export function idiomaEmpaquetado(lang = config.ocrLang) {
  const fichero = path.join(OCR_DIR, `${lang}.traineddata`);
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, 'manifest.json'), 'utf8'));
  } catch {
    /* sin manifiesto: se comprueba solo la existencia */
  }
  let stat;
  try {
    stat = fs.statSync(fichero);
  } catch {
    return { ok: false, motivo: 'no_empaquetado', lang, dir: OCR_DIR };
  }
  const esperado = manifest?.ocr?.lang === lang ? manifest.ocr.bytes : null;
  if (esperado != null && stat.size !== esperado) {
    return { ok: false, motivo: 'incompleto', lang, esperado, real: stat.size };
  }
  return { ok: true, lang, dir: OCR_DIR };
}

// Estado del OCR para `estado_servidor` (no fuerza la inicialización).
//
// El motor arranca PEREZOSO, con el primer documento escaneado: `listo: false` antes de eso se
// leía como un fallo. `estado` lo distingue: 'sin_usar' (aún no hizo falta), 'listo' o 'error'.
// `listo` se mantiene por compatibilidad.
export function estadoOcr() {
  if (!config.ocrEnabled) return { activo: false, estado: 'desactivado', motivo: 'desactivado (ROBIN_OCR=false)' };
  const emp = idiomaEmpaquetado();
  const enPausa = Date.now() < _pausaHasta;
  const estado = enPausa ? 'en_pausa' : _estado.error ? 'error' : _estado.listo ? 'listo' : 'sin_usar';
  return {
    activo: true,
    estado,
    ...(enPausa
      ? {
          pausa_segundos: Math.round((_pausaHasta - Date.now()) / 1000),
          nota_pausa:
            'El motor de OCR ha fallado varias veces seguidas (suele ser falta de memoria en el equipo): ' +
            'se para unos minutos y lo reintenta solo. Los documentos escaneados afectados se vuelven a ' +
            'intentar; el resto se sigue indexando con normalidad.',
        }
      : {}),
    ...(estado === 'sin_usar' ? { nota: 'Se pone en marcha con el primer documento escaneado; no es un fallo.' } : {}),
    idioma: config.ocrLang,
    listo: _estado.listo,
    origen: _estado.origen,
    empaquetado: emp.ok,
    ...(emp.ok ? {} : { idioma_empaquetado: emp }),
    ...(_estado.error ? { error: _estado.error } : {}),
    ...(() => {
      const libre = espacioLibreMb(config.tesseractCache || config.dataDir);
      if (libre === null || libre >= MINIMO_LIBRE_MB) return {};
      return {
        espacio_libre_mb: libre,
        aviso_disco:
          `Quedan ${libre} MB libres en el disco. El OCR de PDFs escaneados convierte cada página a ` +
          'imagen y necesita sitio: mientras no haya espacio, esos PDFs no se podrán leer (el resto de ' +
          'documentos sí). Hace falta liberar espacio en el disco.',
      };
    })(),
  };
}

async function arrancarWorker() {
  ensureDataDirs();
  fs.mkdirSync(config.tesseractCache, { recursive: true });
  const { createWorker } = await import('tesseract.js');

  const emp = idiomaEmpaquetado();
  // errorHandler OBLIGATORIO: sin él, tesseract.js relanza el fallo de un trabajo DESDE el
  // manejador de mensajes del worker (createWorker.js), fuera de cualquier promesa. Una sola
  // imagen que no puede leer («Error attempting to read image.», p. ej. un .bmp roto de 243
  // bytes) era una excepción sin capturar que tumbaba RobinSearch entero. Con él, el rechazo
  // llega a `recognize` y solo falla ese fichero.
  const opciones = {
    cachePath: config.tesseractCache,
    errorHandler: (err) => {
      const txt = String(err?.message ?? err).slice(0, 200);
      // Un abort NO es «esta imagen no se puede leer»: es el motor entero caído. Se anota aquí
      // porque tesseract.js avisa por este camino antes de que el rechazo llegue a `recognize`.
      if (RX_MOTOR_ROTO.test(txt)) _motorRoto = txt;
      log.warn('OCR: el motor no pudo leer una imagen', { err: txt, motor_roto: Boolean(_motorRoto) });
    },
  };
  if (emp.ok) {
    // Ruta local (no URL) → tesseract.js lo lee del disco. Guardamos el fichero sin
    // comprimir, así que `gzip:false`.
    opciones.langPath = OCR_DIR;
    opciones.gzip = false;
    _estado.origen = 'empaquetado';
  } else {
    _estado.origen = 'descarga';
    log.warn('Idioma de OCR NO empaquetado: se intentará descargar', emp);
  }

  log.info('Inicializando OCR (tesseract.js)', { lang: config.ocrLang, origen: _estado.origen });
  const worker = await createWorker(config.ocrLang, 1, opciones);
  log.info('OCR listo', { origen: _estado.origen });
  return worker;
}

async function getWorker() {
  if (_workerPromise) return _workerPromise;
  const intento = arrancarWorker();
  _workerPromise = intento;
  try {
    const worker = await intento;
    _estado = { ..._estado, listo: true, error: null };
    return worker;
  } catch (err) {
    // Igual que en el motor de embedding: no dejar cacheado el rechazo.
    if (_workerPromise === intento) _workerPromise = null;
    _estado = { ..._estado, listo: false, error: String(err?.message ?? err) };
    throw err;
  }
}

// Una página o imagen tarda segundos. Si el worker muere (memoria del WASM) o se queda colgado,
// tesseract.js no rechaza nunca y el indexado entero esperaba para siempre. Pasado el tope se
// descarta ese worker (el siguiente fichero arranca uno nuevo) y solo falla este.
const TOPE_RECONOCER_MS = Number(process.env.ROBIN_OCR_TOPE_MS) || 180_000;

// Un trabajo cada vez. El motor es UNO (un solo worker de tesseract) y entrar en su WASM desde
// dos sitios a la vez —la imagen de un correo mientras se rasteriza la página de un escaneado—
// o cerrarlo mientras otro está dentro es exactamente lo que lo hace abortar. Todo lo que toca
// el motor (reconocer, tirarlo, soltarlo por memoria, apagarlo) pasa por esta cola.
let _cola = Promise.resolve();
function enSerie(fn) {
  const turno = _cola.then(fn, fn);
  _cola = turno.then(
    () => undefined,
    () => undefined,
  );
  return turno;
}

// Tira el motor: el siguiente documento arranca uno limpio (medio segundo). Solo desde la cola.
async function tirarMotor(motivo, { fallo = true } = {}) {
  const promesa = _workerPromise;
  _workerPromise = null;
  _motorRoto = null;
  // Soltarlo a propósito (cierre, o para devolver memoria) NO es un fallo del OCR: si se anotara
  // como error, `estado_servidor` diría «OCR: error» con el motor simplemente descansando.
  _estado = { ..._estado, listo: false, error: fallo ? motivo : null };
  if (!promesa) return;
  log[fallo ? 'warn' : 'info']('OCR: se tira el motor y el siguiente documento arranca uno limpio', { motivo: String(motivo).slice(0, 200) });
  try {
    const w = await promesa;
    await w.terminate();
  } catch {
    /* el motor ya estaba muerto: es justo lo que se quería */
  }
}

function errorOcrEnPausa() {
  const seg = Math.max(1, Math.round((_pausaHasta - Date.now()) / 1000));
  return Object.assign(
    new Error(
      `El motor de OCR ha fallado ${MUERTES_PARA_PAUSA} veces seguidas (el equipo se está quedando sin memoria): ` +
        `se para ${seg} s y después se reintenta solo. El resto de documentos se sigue indexando.`,
    ),
    { code: 'ROBIN_OCR_EN_PAUSA' },
  );
}

async function reconocer(input) {
  return enSerie(async () => {
    if (_motorRoto) await tirarMotor(`el motor abortó: ${_motorRoto}`);
    if (Date.now() < _pausaHasta) throw errorOcrEnPausa();
    const worker = await getWorker();
    let tope;
    _enVuelo += 1;
    if (_enVuelo > _pico) _pico = _enVuelo;
    try {
      if (_pruebaAbortar > 0) {
        _pruebaAbortar -= 1;
        throw new Error('RuntimeError: Aborted(). Build with -sASSERTIONS for more info.');
      }
      const r = await Promise.race([
        worker.recognize(input),
        new Promise((_, rechazar) => {
          tope = setTimeout(() => rechazar(new Error(`OCR sin respuesta en ${TOPE_RECONOCER_MS / 1000} s`)), TOPE_RECONOCER_MS);
        }),
      ]);
      if (_motorRoto) await tirarMotor(`el motor abortó: ${_motorRoto}`);
      else _muertesSeguidas = 0;
      return r;
    } catch (err) {
      const txt = String(err?.message ?? err);
      // Colgado o abortado: en los dos casos el motor se tira. Insistir sobre un motor abortado
      // es lo que tumbaba el proceso (6-nov-2026).
      if (/sin respuesta/.test(txt) || RX_MOTOR_ROTO.test(txt) || _motorRoto) {
        _muertesSeguidas += 1;
        await tirarMotor(txt.slice(0, 200));
        if (_muertesSeguidas >= MUERTES_PARA_PAUSA) {
          _pausaHasta = Date.now() + PAUSA_MS;
          _muertesSeguidas = 0;
          log.error('OCR en pausa: el motor ha caído varias veces seguidas; se reintenta más tarde', {
            muertes: MUERTES_PARA_PAUSA,
            pausa_s: Math.round(PAUSA_MS / 1000),
            libre_mb: ramLibreMb(),
          });
        }
      }
      throw err;
    } finally {
      _enVuelo -= 1;
      clearTimeout(tope);
    }
  });
}

export async function terminateOcr() {
  await enSerie(() => tirarMotor('cierre', { fallo: false }));
}

// Solo pruebas: el estado interno del motor (si está tirado, en pausa o con cuántas caídas).
export function _estadoMotorParaPruebas() {
  return { motor: Boolean(_workerPromise), roto: _motorRoto, muertes: _muertesSeguidas, pausa_ms: Math.max(0, _pausaHasta - Date.now()), pico: _pico };
}

// OCR de una imagen suelta (foto de siniestro, escaneo, pantallazo). Reutiliza el mismo
// worker de tesseract.js (WASM) que el OCR de PDF: nada sale del ordenador.
// Los .heic/.heif (fotos de iPhone) se convierten antes a un bitmap PNG con heic-convert
// (libheif en WASM), porque tesseract no lee HEIC directamente.
// Devuelve [{ page: 1, text }] (una imagen = una "página") o [] si no hay texto legible.
export async function ocrImage(filePath) {
  comprobarEspacio();
  // La misma barrera de memoria que el PDF escaneado. Hasta la 1.9.0 la imagen suelta (y la de
  // dentro de un .zip) iba al motor de OCR sin mirar nada: en dos equipos Windows de 16 GB el
  // proceso murió en plena tanda de fotos con 400-700 MB libres (23 y 28-sep-2026).
  if (memoriaFiable() && ramLibreMb() < MINIMO_LIBRE_RAM_MB) throw errorSinMemoria();
  const ext = extensionDe(filePath);
  let input;
  // Por contenido, no solo por extensión: una foto de iPhone en HEIC llamada «.jpg» es corriente
  // y tesseract la rechazaba con «Error attempting to read image.».
  if (ext === '.heic' || ext === '.heif' || tipoReal(filePath) === 'heic') {
    const heicConvert = (await import('heic-convert')).default;
    const buffer = fs.readFileSync(filePath);
    // A PNG sin pérdida para no degradar el OCR de un documento fotografiado.
    input = Buffer.from(await heicConvert({ buffer, format: 'PNG' }));
  } else {
    input = fs.readFileSync(filePath);
  }
  let text;
  try {
    ({
      data: { text },
    } = await reconocer(input));
  } finally {
    input = null;
    await soltarMotorSiFaltaMemoria();
  }
  const clean = (text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return clean ? [{ page: 1, text: clean }] : [];
}

function errorSinMemoria() {
  return Object.assign(
    new Error(
      `No hay memoria suficiente para el OCR de este documento (${ramLibreMb()} MB libres). Se ` +
        'reintentará solo cuando el equipo tenga más memoria; cerrar alguna aplicación pesada ayuda.',
    ),
    { code: 'ROBIN_FICHERO_SIN_MEMORIA' },
  );
}

// La memoria de un motor WASM crece con la imagen más grande que ha leído y NO se devuelve nunca
// mientras el motor viva: tras una foto de 48 Mpx el trabajador de OCR se queda con ella para
// siempre, sumada a la del modelo de embedding. Con el equipo justo de memoria, se cierra el
// motor al acabar cada documento y el siguiente arranca uno limpio (medio segundo).
async function soltarMotorSiFaltaMemoria() {
  if (!memoriaFiable() || !_workerPromise) return;
  const libre = ramLibreMb();
  if (libre >= RAM_PARA_DPI_PLENO_MB) return;
  log.info('Poca memoria libre: se cierra el motor de OCR para devolverla', { libre_mb: libre });
  await terminateOcr();
}

// Rasteriza y aplica OCR a un PDF escaneado. Devuelve [{ page, text }] igual que el
// extractor normal, para que el resto del pipeline no note la diferencia.
export async function ocrPdf(filePath, { maxPages, dpi = config.ocrDpi } = {}) {
  // Con el motor en pausa no se rasteriza nada: el documento se deja para la pasada siguiente.
  if (Date.now() < _pausaHasta) throw errorOcrEnPausa();
  const mupdf = await import('mupdf');
  const buf = fs.readFileSync(filePath);
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  const pages = [];
  try {
    const total = doc.countPages();
    const limit = Math.min(total, maxPages ?? config.ocrMaxPages, config.ocrMaxPages);
    if (total > limit) log.warn('PDF escaneado con más páginas que el tope de OCR: se lee hasta el tope', { paginas: total, tope: limit });

    await getWorker(); // si el OCR no arranca, falla el fichero antes de rasterizar nada
    comprobarEspacio(); // ni una página si no hay sitio para los temporales
    const dpiReal = dpiSegunMemoria(dpi);
    if (dpiReal === null) throw errorSinMemoria();
    const scale = mupdf.Matrix.scale(dpiReal / 72, dpiReal / 72);
    const inicio = Date.now();
    // El panel dice por qué página va y cuánto le queda A ESTE documento (state.js, setLectura).
    // Lo que queda sale del ritmo medido en sus propias páginas, sin pasar del tope de tiempo.
    const fichero = path.basename(filePath);
    const avanzar = (hechas) => {
      const ms = Date.now() - inicio;
      const restoTope = Math.max(0, config.ocrMaxMsPorDocumento - ms);
      const eta = hechas > 0 ? Math.min((ms / hechas) * (limit - hechas), restoTope) : null;
      setLectura({ tipo: 'ocr', fichero, pagina: Math.min(hechas + 1, limit), paginas: limit, eta_segundos: eta === null ? null : Math.round(eta / 1000) });
    };
    avanzar(0);

    for (let i = 0; i < limit; i++) {
      if (i > 0) avanzar(i);
      if (Date.now() - inicio > config.ocrMaxMsPorDocumento) {
        log.warn('OCR: tope de tiempo por documento alcanzado; se indexa lo leído', { paginas_leidas: i, paginas: total });
        break;
      }
      // Un escaneado de 100 páginas puede llenar el disco a mitad: se vuelve a mirar cada poco y
      // se para con lo leído en vez de dejar el equipo sin espacio.
      if (i > 0 && i % CADA_N_PAGINAS === 0) {
        const libre = espacioLibreMb(config.tesseractCache || config.dataDir);
        if (libre !== null && libre < MINIMO_LIBRE_MB) {
          log.error('OCR parado: se está quedando sin espacio en disco; se indexa lo leído', { paginas_leidas: i, libre_mb: libre });
          break;
        }
        // Y la memoria: un escaneado de 100 páginas la va comiendo página a página. Parar con
        // lo leído es mucho mejor que que el sistema mate el proceso a mitad.
        if (memoriaFiable() && ramLibreMb() < MINIMO_LIBRE_RAM_MB) {
          log.error('OCR parado: se está quedando sin memoria; se indexa lo leído', { paginas_leidas: i, libre_mb: ramLibreMb() });
          break;
        }
      }
      let page;
      let pix;
      try {
        page = doc.loadPage(i);
        // Rasterizar es síncrono (WASM): con el proceso ocupado página tras página, Claude no
        // recibía respuesta y lo daba por muerto. Se suelta el proceso antes de cada página.
        await new Promise((r) => setImmediate(r));
        pix = page.toPixmap(scale, mupdf.ColorSpace.DeviceRGB, false, true);
        const png = pix.asPNG();
        pix.destroy?.();
        pix = null;
        const {
          data: { text },
        } = await reconocer(Buffer.from(png));
        const clean = (text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (clean) pages.push({ page: i + 1, text: clean });
      } catch (err) {
        // El motor en pausa, el equipo sin memoria o el disco lleno no son «esta página no se
        // lee»: suben para que el documento entero se reintente más tarde, en vez de quedar
        // marcado como escaneado sin texto legible (6-nov-2026).
        if (err?.code === 'ROBIN_OCR_EN_PAUSA' || err?.code === 'ROBIN_FICHERO_SIN_MEMORIA' || err?.code === 'ROBIN_DISCO_LLENO') throw err;
        log.warn('OCR falló en una página', { page: i + 1, err: String(err) });
      } finally {
        pix?.destroy?.();
        page?.destroy?.();
      }
    }
  } finally {
    setLectura(null);
    // Sin esto, cada PDF escaneado dejaba su documento entero reservado en la memoria del WASM.
    doc.destroy?.();
    await soltarMotorSiFaltaMemoria();
  }
  return pages;
}

export default { ocrPdf, ocrImage, terminateOcr, estadoOcr, idiomaEmpaquetado, espacioLibreMb };
