// Rescate de un ZIP al que le falta el final.
//
// Un .docx, un .odt o un .pptx son un ZIP. Cuando la copia se cortó, el correo llegó a medias o
// la unidad de red falló al guardar, el fichero pierde el «directorio central» —el índice que va
// al FINAL— y cualquier lector se niega: «Can't find end of central directory», «No END header
// found». El documento, sin embargo, suele estar entero: en un ZIP cada fichero va precedido de
// su propia cabecera, y el directorio central es solo un resumen.
//
// Aquí se recorren esas cabeceras una a una y se descomprime lo que haya. Es lo que hace
// cualquier herramienta de recuperación, y para el abogado es la diferencia entre tener el
// escrito en las búsquedas o no tenerlo.
//
// Nada de esto abre la puerta a un ZIP malicioso: no se escribe en disco, se respetan topes de
// tamaño y de número de miembros, y solo se piden por nombre las partes con texto del documento.
import zlib from 'node:zlib';

const FIRMA_LOCAL = 0x04034b50;
const MAX_MIEMBROS = 512;
const MAX_BYTES = 128 * 1024 * 1024;

// Descomprime un miembro cuyo tamaño declarado no es de fiar (el ZIP está roto): se deja que
// zlib pare donde acabe el flujo y se admite lo que haya salido hasta ahí.
function inflarSinFin(buf) {
  try {
    return zlib.inflateRawSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: MAX_BYTES });
  } catch {
    return null;
  }
}

// Devuelve Map<nombre, Buffer> con lo que se haya podido rescatar. `quiero(nombre)` filtra:
// descomprimir las imágenes de un .docx de 40 MB no aporta nada al texto.
export function entradasRecuperadas(buf, quiero = () => true) {
  const out = new Map();
  let p = 0;
  let miembros = 0;
  let bytes = 0;
  while (p + 30 <= buf.length && miembros < MAX_MIEMBROS && bytes < MAX_BYTES) {
    if (buf.readUInt32LE(p) !== FIRMA_LOCAL) {
      // Salta a la siguiente cabecera: un ZIP roto puede tener basura por medio.
      const sig = buf.indexOf('PK\x03\x04', p + 1, 'latin1');
      if (sig < 0) break;
      p = sig;
      continue;
    }
    const banderas = buf.readUInt16LE(p + 6);
    const metodo = buf.readUInt16LE(p + 8);
    const comprimido = buf.readUInt32LE(p + 18);
    const largoNombre = buf.readUInt16LE(p + 26);
    const largoExtra = buf.readUInt16LE(p + 28);
    const inicioNombre = p + 30;
    const inicioDatos = inicioNombre + largoNombre + largoExtra;
    if (inicioDatos > buf.length) break;
    const nombre = buf.toString('utf8', inicioNombre, inicioNombre + largoNombre);
    // Con «descriptor de datos» (bit 3) el tamaño va DESPUÉS del contenido y aquí vale 0: se le
    // da a zlib lo que queda del fichero y él para solo al final del flujo comprimido.
    const conDescriptor = Boolean(banderas & 0x08) || comprimido === 0;
    const fin = conDescriptor ? buf.length : Math.min(inicioDatos + comprimido, buf.length);
    const datos = buf.subarray(inicioDatos, fin);

    if (!nombre.endsWith('/') && quiero(nombre)) {
      let contenido = null;
      if (metodo === 0) contenido = Buffer.from(datos);              // guardado sin comprimir
      else if (metodo === 8) contenido = inflarSinFin(datos);        // deflate, lo normal
      if (contenido && contenido.length) {
        out.set(nombre, contenido);
        bytes += contenido.length;
        miembros += 1;
      }
    }
    // Sin tamaño fiable no se puede saltar al siguiente: se busca la cabecera que venga.
    const sig = buf.indexOf('PK\x03\x04', conDescriptor ? inicioDatos + 1 : fin, 'latin1');
    if (sig < 0) break;
    p = sig;
  }
  return out;
}

export default { entradasRecuperadas };
