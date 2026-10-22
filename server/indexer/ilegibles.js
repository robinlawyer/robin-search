// Documentos que NO se han podido leer (PDF roto que ni mupdf rehace, un .docx que no es lo que
// dice ser…), RECORDADOS para no volver a abrirlos en cada pasada.
//
// Hasta la 1.12.3 no quedaban en ningún sitio: no entraban en el registro (no se indexaron), así
// que cada re-escaneo los daba por nuevos, los volvía a abrir entero, pasaba por pdfjs y por la
// reparación de mupdf, fallaba igual y dejaba el mismo aviso en el registro. En el Mac de Eduardo
// (21-oct-2026), los mismos 17 PDF y un .docx cada 15 minutos, todo el día: trabajo tirado y un
// registro lleno de ruido que tapaba lo que importa.
//
// Ahora se apuntan con su tamaño y su fecha, y la versión de RobinSearch que lo intentó. Se
// vuelven a intentar en cuanto CAMBIAN (el abogado los sustituye), con una versión nueva (puede
// traer el arreglo) o pasada una semana. Mientras tanto se siguen CONTANDO como dañados en cada
// pasada (estado_servidor los explica igual), sin abrirlos ni repetir el aviso.
//
// Este fichero vive en el ordenador del abogado y guarda rutas locales: NUNCA se envía.
import fs from 'node:fs';
import path from 'node:path';
import { config, VERSION } from '../config.js';
import { escribirJson, leerJson } from '../persistencia.js';

const REINTENTAR_TRAS_MS = 7 * 24 * 3600 * 1000;
const MAX_ENTRADAS = 20000;
// Qué se recuerda. No: el PDF protegido (puede llegar la contraseña en ROBIN_PDF_CLAVES), el
// vacío o sin descargar (lo lleva nube.js) ni la falta de memoria (es del momento, no del fichero).
const NO_SE_RECUERDA = new Set(['ROBIN_FICHERO_PDF_PROTEGIDO', 'ROBIN_FICHERO_VACIO', 'ROBIN_FICHERO_SIN_MEMORIA']);

const ruta = () => path.join(config.dataDir, 'ilegibles.json');
let _cache = null;
let _mtime = -1;

function mtimeActual() {
  try {
    return fs.statSync(ruta()).mtimeMs;
  } catch {
    return 0;
  }
}

// Se relee si lo ha cambiado la otra instancia.
function cargar() {
  const m = mtimeActual();
  if (_cache && m === _mtime) return _cache;
  try {
    const r = leerJson(ruta());
    _cache = r.estado === 'ok' && r.valor && typeof r.valor === 'object' ? r.valor : _cache || {};
  } catch {
    _cache ??= {};
  }
  _mtime = m;
  return _cache;
}

let _tGuardar = null;
function guardar() {
  // Agrupado: en la primera pasada pueden fallar decenas de golpe.
  if (_tGuardar) return;
  _tGuardar = setTimeout(guardarYa, 500);
  _tGuardar.unref?.();
}

export function guardarYa() {
  if (_tGuardar) clearTimeout(_tGuardar);
  _tGuardar = null;
  if (!_cache) return;
  try {
    const entradas = Object.entries(_cache);
    if (entradas.length > MAX_ENTRADAS) {
      entradas.sort((a, b) => String(b[1].desde).localeCompare(String(a[1].desde)));
      _cache = Object.fromEntries(entradas.slice(0, MAX_ENTRADAS));
    }
    fs.mkdirSync(config.dataDir, { recursive: true });
    escribirJson(ruta(), _cache);
    _mtime = mtimeActual();
  } catch {
    /* sin disco solo se pierde el recuerdo: el fichero se volverá a intentar */
  }
}

export const seRecuerda = (code) => String(code || '').startsWith('ROBIN_FICHERO_') && !NO_SE_RECUERDA.has(String(code));

// El fichero `abs` (con este `stat`) no se ha podido leer por `code`.
export function anotar(abs, stat, code) {
  if (!seRecuerda(code)) return;
  let st = stat;
  try {
    if (!st || !Number.isFinite(st.size) || !Number.isFinite(st.mtimeMs)) st = fs.statSync(abs);
  } catch {
    return;
  }
  const reg = cargar();
  const previa = reg[abs];
  reg[abs] = {
    code: String(code),
    bytes: st.size,
    mtimeMs: st.mtimeMs,
    version: VERSION,
    desde: previa && previa.bytes === st.size && previa.mtimeMs === st.mtimeMs ? previa.desde : new Date().toISOString(),
    intentado: new Date().toISOString(),
  };
  guardar();
}

// ¿Se sabe ya que este fichero, tal como está, no se puede leer? Devuelve el código o null.
export function recordado(abs, stat, ahora = Date.now()) {
  const reg = cargar();
  const e = reg[abs];
  if (!e) return null;
  const vigente =
    stat &&
    e.bytes === stat.size &&
    e.mtimeMs === stat.mtimeMs &&
    e.version === VERSION &&
    ahora - Date.parse(e.intentado || e.desde || 0) < REINTENTAR_TRAS_MS;
  if (!vigente) {
    delete reg[abs];
    guardar();
    return null;
  }
  return e.code;
}

// Se ha leído bien (o ya no está): fuera de la lista.
export function olvidar(abs) {
  const reg = cargar();
  if (reg[abs]) {
    delete reg[abs];
    guardar();
  }
}

export function cuantos() {
  return Object.keys(cargar()).length;
}

// Solo para pruebas.
export function _olvidarCache() {
  _cache = null;
  _mtime = -1;
}

export default { anotar, recordado, olvidar, seRecuerda, cuantos, guardarYa };
