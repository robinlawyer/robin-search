// Qué es un fichero POR SU CONTENIDO, no por su extensión.
//
// La extensión miente más de lo que parece en un despacho: fotos de iPhone en HEIC guardadas como
// «.jpg», «Word» exportados por una aplicación que en realidad son RTF o HTML, PDF renombrados,
// ficheros de una carpeta en la nube que aún no se han descargado (vacíos o a ceros). Con la
// extensión como única pista, el lector equivocado fallaba con mensajes que no decían nada
// («Error attempting to read image.», «Can't find end of central directory»): 16 ficheros en el
// aviso técnico del 16-sep (1.6.0, Mac con carpeta en la nube).
//
// Solo se miran los primeros bytes. Nada sale del ordenador.

import fs from 'node:fs';

const CABECERA = 512;

const HEIC = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
const AVIF = new Set(['avif', 'avis']);

function empiezaPor(buf, firma, desde = 0) {
  if (buf.length < desde + firma.length) return false;
  for (let i = 0; i < firma.length; i++) if (buf[desde + i] !== firma[i]) return false;
  return true;
}

// Marcas ISO-BMFF («ftyp»): la principal y las compatibles. Un AVIF puede declarar «mif1» como
// principal y «avif» entre las compatibles, así que AVIF se mira antes que HEIC.
function marcasFtyp(buf) {
  if (buf.length < 12 || buf.toString('latin1', 4, 8) !== 'ftyp') return null;
  const tam = Math.min(buf.readUInt32BE(0), buf.length);
  const marcas = [buf.toString('latin1', 8, 12)];
  for (let i = 16; i + 4 <= tam; i += 4) marcas.push(buf.toString('latin1', i, i + 4));
  return marcas;
}

// Devuelve 'vacio' | 'pdf' | 'zip' | 'ole' | 'rtf' | 'html' | 'mhtml' | 'heic' | 'avif' | 'imagen' |
// 'rar' | '7z' | null (texto u otra cosa que no se reconoce: se deja al lector de la extensión).
export function tipoDeCabecera(buf) {
  if (!buf || buf.length === 0 || buf.every((b) => b === 0)) return 'vacio';
  const marcas = marcasFtyp(buf);
  if (marcas) {
    if (marcas.some((m) => AVIF.has(m))) return 'avif';
    if (marcas.some((m) => HEIC.has(m))) return 'heic';
    return null;
  }
  if (empiezaPor(buf, [0x50, 0x4b, 0x03, 0x04]) || empiezaPor(buf, [0x50, 0x4b, 0x05, 0x06])) return 'zip';
  if (empiezaPor(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  if (empiezaPor(buf, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return 'rar';
  if (empiezaPor(buf, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  if (empiezaPor(buf, [0xff, 0xd8, 0xff])
    || empiezaPor(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    || empiezaPor(buf, [0x47, 0x49, 0x46, 0x38])
    || (empiezaPor(buf, [0x42, 0x4d]) && [12, 40, 52, 56, 64, 108, 124].includes(buf[14]))
    || empiezaPor(buf, [0x49, 0x49, 0x2a, 0x00])
    || empiezaPor(buf, [0x4d, 0x4d, 0x00, 0x2a])
    || (empiezaPor(buf, [0x52, 0x49, 0x46, 0x46]) && buf.toString('latin1', 8, 12) === 'WEBP')) {
    return 'imagen';
  }
  // Texto: se salta el BOM y los blancos del principio.
  let s = buf.toString('latin1', 0, Math.min(buf.length, CABECERA));
  s = s.replace(/^﻿|^\xEF\xBB\xBF/, '').replace(/^\s+/, '');
  // %PDF puede ir tras basura inicial (lo admite el estándar dentro de los primeros 1024 bytes).
  if (s.startsWith('%PDF-') || buf.indexOf('%PDF-', 0, 'latin1') >= 0) return 'pdf';
  if (s.startsWith('{\\rtf')) return 'rtf';
  // «Página web de un solo archivo» de Word/Outlook: MIME con el HTML dentro (a menudo guardada
  // con extensión .doc o .docx). Antes caía en el lector de ZIP y moría sin decir nada.
  if (/^(mime-version:|content-type:\s*(multipart\/related|text\/html))/i.test(s)) return 'mhtml';
  // Los HTML que exporta Word empiezan por un comentario, un <?xml o un <meta, no por <html.
  const sinComentarios = s.replace(/^(?:<!--[\s\S]*?-->|<\?xml[^>]*\?>|\s)+/i, '');
  if (/^(<!doctype html|<html|<head|<body|<meta\s|<table[\s>])/i.test(sinComentarios)) return 'html';
  return null;
}

// 'ilegible' y no null: no es lo mismo «he mirado y no lo reconozco» (null) que «no he podido
// mirar» (el antivirus lo tiene abierto, la unidad de red se cayó). Quien decida por el contenido
// no puede sacar conclusiones de lo segundo; quien lo lea después dará el error de verdad.
export function tipoReal(ruta) {
  let fd;
  try {
    fd = fs.openSync(ruta, 'r');
    const buf = Buffer.alloc(CABECERA);
    const n = fs.readSync(fd, buf, 0, CABECERA, 0);
    return tipoDeCabecera(buf.subarray(0, n));
  } catch {
    return 'ilegible';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* nada */
      }
    }
  }
}
