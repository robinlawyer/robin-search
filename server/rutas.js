// Comparar y componer rutas de las carpetas vigiladas de forma CORRECTA en los tres sistemas.
//
// Por qué existe: durante mucho tiempo se comprobaba «¿este fichero está dentro de la carpeta?»
// con `ruta.startsWith(carpeta + path.sep)`. Eso falla justo en las carpetas de despacho:
//   · Una raíz de unidad o un recurso UNC ya llevan la barra final (`I:\`, `\\srv\exp\`).
//     `carpeta + sep` da `I:\\` y NINGUNA ruta casa: todo caía en `_sin_expediente`, la
//     búsqueda devolvía 0 y los ficheros borrados no se retiraban nunca del índice.
//   · En Windows y macOS el disco no distingue mayúsculas ni (en macOS) la forma Unicode de
//     «é» (NFC/NFD). Una comparación exacta dejaba fuera rutas correctas y duplicaba
//     documentos al indexar la misma carpeta escrita de otra manera.
//
// Todo pasa por `path.relative`, que sabe de raíces de unidad, UNC y `..`. El módulo `path` y
// la plataforma se INYECTAN (`crearRutas({ path: path.win32, plataforma: 'win32' })`) para poder
// comprobar el comportamiento de Windows desde un Mac o un Linux.
//
// No importa config.js a propósito: lo usan config.js y net.js.

import fs from 'node:fs';
import nodePath from 'node:path';

export function crearRutas({ path: p = nodePath, plataforma = process.platform } = {}) {
  const sinCaja = plataforma === 'win32' || plataforma === 'darwin';
  // macOS (APFS/HFS+) no distingue NFC de NFD: «Pérez» son el mismo nombre escrito de dos
  // formas. NTFS y ext4 SÍ las distinguen (serían dos ficheros), así que ahí no se normaliza.
  const sinFormaUnicode = plataforma === 'darwin';

  // Clave con la que se comparan dos rutas del disco en esta plataforma.
  function claveRuta(s) {
    let t = String(s ?? '');
    if (sinFormaUnicode) t = t.normalize('NFC');
    return sinCaja ? t.toLowerCase() : t;
  }

  // Clave para nombres LÓGICOS (expediente, subcarpeta que escribe Claude). Aquí la forma Unicode
  // nunca separa dos casos distintos: Claude escribe en NFC y el disco puede estar en NFD.
  function claveNombre(s) {
    const t = String(s ?? '').normalize('NFC');
    return sinCaja ? t.toLowerCase() : t;
  }

  // Ruta relativa de `hijo` respecto a `raiz` calculada sobre las claves, o null si no está dentro.
  function relativaClave(hijo, raiz) {
    const rel = p.relative(claveRuta(p.resolve(String(raiz))), claveRuta(p.resolve(String(hijo))));
    if (rel === '') return '';
    if (rel === '..' || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return null;
    return rel;
  }

  // ¿`hijo` está dentro de `raiz` (o es ella misma, salvo `estricto`)?
  function dentroDe(hijo, raiz, { estricto = false } = {}) {
    if (!hijo || !raiz) return false;
    const rel = relativaClave(hijo, raiz);
    if (rel === null) return false;
    return rel === '' ? !estricto : true;
  }

  // La parte de `hijo` por debajo de `raiz`, CON la escritura del propio `hijo` (no la de la
  // clave en minúsculas). '' si es la raíz, null si no está dentro.
  function relativaDentro(hijo, raiz) {
    const rel = relativaClave(hijo, raiz);
    if (rel === null || rel === '') return rel;
    const n = rel.split(p.sep).filter(Boolean).length;
    // En Windows '/' también separa; en macOS/Linux una '\\' es parte legítima del nombre.
    const segs = p.resolve(String(hijo)).split(plataforma === 'win32' ? /[\\/]+/ : p.sep).filter(Boolean);
    return segs.slice(-n).join(p.sep);
  }

  // Nombre visible de una carpeta vigilada. `path.basename('I:\\')` es '' y antes se usaba la
  // ruta entera como nombre («I:\»), con barra y dos puntos dentro del id del expediente.
  function nombreBase(ruta) {
    const abs = p.resolve(String(ruta));
    const base = p.basename(abs);
    if (plataforma === 'win32') {
      const letra = (base || abs).match(/^(?:[\\/]{2}[?.][\\/])?([A-Za-z]):[\\/]*$/);
      if (letra) return letra[1].toUpperCase();
      if (base) return base;
      const unc = abs.match(/^[\\/]{2}(?:[?.][\\/]UNC[\\/])?[^\\/]+[\\/]+([^\\/]+)[\\/]*$/i);
      if (unc) return unc[1];
    }
    return base || 'raiz';
  }

  // Raíz configurada a la que pertenece una ruta (la más específica si hay anidamiento).
  // Se acepta también la forma REAL de la raíz (`real`, sin enlaces), que es la que a veces
  // devuelven el sistema o los vigilantes.
  function raizDe(roots, abs) {
    let mejor = null;
    for (const r of roots || []) {
      for (const base of r.real && r.real !== r.path ? [r.path, r.real] : [r.path]) {
        const rel = relativaClave(abs, base);
        if (rel === null) continue;
        const prof = claveRuta(p.resolve(r.path)).length;
        if (!mejor || prof > mejor.prof) mejor = { raiz: r, base, prof };
        break;
      }
    }
    return mejor;
  }

  // La misma ruta escrita con la raíz TAL Y COMO está configurada: `z:\expedientes\caso\x.pdf`
  // con la raíz `Z:\Expedientes` pasa a `Z:\Expedientes\caso\x.pdf`. Si se da `realpath`, la
  // parte de debajo también se escribe como está en disco (caja y forma Unicode), siempre que
  // sea el MISMO camino (no se siguen enlaces a otra parte). Sin raíz, la ruta resuelta.
  function canonizar(roots, abs, { realpath = null } = {}) {
    const h = p.resolve(String(abs));
    const m = raizDe(roots, h);
    if (!m) return h;
    let tail = relativaDentro(h, m.base);
    if (realpath && tail) {
      // Se sube hasta el primer antecesor que exista (un fichero recién borrado no tiene
      // realpath, pero su carpeta sí) y se vuelve a bajar con lo que falte.
      const partes = tail.split(p.sep);
      for (let k = partes.length; k > 0; k--) {
        let real;
        try {
          real = realpath(p.join(m.base, ...partes.slice(0, k)));
        } catch {
          continue;
        }
        const baseReal = m.raiz.real || m.raiz.path;
        const t2 = relativaDentro(real, baseReal) ?? relativaDentro(real, m.raiz.path);
        const propuesto = t2 === null ? null : [t2, ...partes.slice(k)].filter(Boolean).join(p.sep);
        if (propuesto !== null && claveRuta(propuesto) === claveRuta(tail)) tail = propuesto;
        break;
      }
    }
    return tail ? p.join(m.raiz.path, tail) : m.raiz.path;
  }

  // `nombreRaíz/ruta/relativa` (separador '/'), o null si no cuelga de ninguna raíz.
  function rutaLogica(roots, abs) {
    const m = raizDe(roots, abs);
    if (!m) return null;
    const rel = relativaDentro(abs, m.base);
    return rel ? `${m.raiz.name}/${rel.split(p.sep).join('/')}` : m.raiz.name;
  }

  // ¿La ruta lógica `ruta` es `prefijo` o cuelga de él? Filtros de subcarpeta de las tools.
  function bajoPrefijoLogico(ruta, prefijo) {
    if (!prefijo) return true;
    const norm = (s) => claveNombre(String(s ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''));
    const r = norm(ruta);
    const f = norm(prefijo);
    return r === f || r.startsWith(`${f}/`);
  }

  return {
    path: p,
    plataforma,
    sinCaja,
    claveRuta,
    claveNombre,
    dentroDe,
    relativaDentro,
    nombreBase,
    raizDe,
    canonizar,
    rutaLogica,
    bajoPrefijoLogico,
  };
}

// Extensión de un fichero para decidir si se indexa: en minúsculas y SIN espacios. Un
// «demanda.pdf » (espacio final, habitual en ficheros que vienen de un Mac o de un recurso de
// red) se ignoraba en silencio.
export function extensionDe(ruta, p = nodePath) {
  return p.extname(String(ruta ?? '').trimEnd()).trim().toLowerCase();
}

// Nombre lógico válido para una carpeta: sin separadores ni nada que rompa el id del expediente.
export function nombreValido(n) {
  return typeof n === 'string' && n.trim() === n && n.length > 0 && n.length <= 255
    && !/[\\/]/.test(n) && n !== '.' && n !== '..';
}

// Tipo REAL de una entrada. En Windows libuv marca como enlace TODA entrada con «reparse point»:
// los ficheros de OneDrive/SharePoint/Dropbox bajo demanda y las junctions. Para esas
// `isFile()` e `isDirectory()` dan false y se saltaban todas. Se pregunta al disco (stat sigue
// el enlace y no descarga el fichero).
export function tipoReal(full, entry, cuenta = null) {
  if (entry.isDirectory()) return 'carpeta';
  if (entry.isFile()) return 'fichero';
  if (!entry.isSymbolicLink() && typeof entry.isFIFO === 'function'
    && (entry.isFIFO() || entry.isSocket() || entry.isCharacterDevice() || entry.isBlockDevice())) {
    return null;
  }
  try {
    const st = fs.statSync(full);
    if (st.isDirectory()) return 'carpeta';
    if (st.isFile()) return 'fichero';
    return null;
  } catch {
    // Enlace roto, junction a una unidad que no está, o fichero en la nube sin proveedor activo.
    if (cuenta) cuenta.enlaces_inaccesibles += 1;
    return null;
  }
}

export const rutas = crearRutas();

export default rutas;
