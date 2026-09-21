// Archivar correspondencia EN EL EXPEDIENTE.
//
// POR QUÉ. Guardar el adjunto no basta si el correo que lo traía —quién lo mandó, cuándo y qué
// decía— no queda en ninguna parte del caso. Y hay una razón más práctica que documental: si el
// correo no es un FICHERO dentro de la carpeta, buscar_documentos no lo alcanza y el abogado
// tiene que acordarse de buscarlo aparte, en vivo contra el buzón. Para un producto que promete
// «todo el expediente en un mismo sitio», dejar la correspondencia fuera del índice es un hueco
// (Juan Maza, 21-sep-2026).
//
// EN .eml, Y NO EN UN RESUMEN. El .eml conserva las cabeceras originales completas, que es lo que
// pesa como prueba; se abre con doble clic en cualquier cliente de correo; y RobinSearch ya sabe
// leerlo — incluido el texto de los adjuntos que lleva dentro, de forma recursiva (extract.js).
//
// TRES REGLAS QUE NO SE TOCAN:
//  1. NUNCA se pisa un fichero del abogado. Si el nombre está cogido, se escribe al lado con un
//     « (2)». RobinSearch lee los documentos del despacho y no modifica ninguno; archivar añade,
//     jamás sustituye.
//  2. NUNCA se escribe fuera de la carpeta del expediente elegido. El nombre del fichero lo
//     pone un tercero (el remitente): un adjunto llamado «../../otro cliente/x.pdf» se queda en
//     su nombre a secas.
//  3. NADA se archiva sin que el abogado lo confirme, con el remitente y el expediente destino
//     en la misma frase: el error que hay que poder ver ANTES es meter la correspondencia de un
//     cliente en el expediente de otro.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import * as registry from '../indexer/registry.js';
import * as expedientes from '../expedientes.js';

// La subcarpeta del expediente donde vive la correspondencia del caso.
export const CARPETA_COMUNICACIONES = 'Comunicaciones';

// Nombres que Windows no admite como fichero, con o sin extensión.
const RESERVADOS_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Un nombre de fichero seguro EN CUALQUIER SISTEMA a partir de texto que ha escrito un tercero.
// Se quitan los separadores (que sacarían el fichero de la carpeta), los caracteres que Windows
// prohíbe, los de control, y los puntos y espacios finales (Windows los come en silencio y dos
// ficheros distintos pasarían a ser el mismo).
export function nombreSeguro(texto, { max = 120, porDefecto = 'sin asunto' } = {}) {
  let n = String(texto ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (n === '.' || n === '..') n = '';
  // Los separadores ya se han vuelto «-»: «../../x.pdf» llegaría aquí como «..-..-x.pdf». Se
  // limpia la maleza del principio para que el fichero se llame como lo que es.
  n = n.replace(/^[-. ]+/, '').replace(/-{2,}/g, '-').trim();
  if (n.length > max) n = `${n.slice(0, max).trim()}…`;
  n = n.replace(/[. ]+$/g, '');
  if (RESERVADOS_WINDOWS.test(n)) n = `_${n}`;
  return n || porDefecto;
}

const dosCifras = (x) => String(x).padStart(2, '0');

// Nombre del .eml: fecha delante para que la carpeta se ordene sola por orden cronológico, que
// es como se lee un expediente, y después remitente y asunto para reconocerlo de un vistazo.
export function nombreParaCorreo({ fecha, de, asunto }) {
  const d = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date();
  const sello = `${d.getFullYear()}-${dosCifras(d.getMonth() + 1)}-${dosCifras(d.getDate())} `
    + `${dosCifras(d.getHours())}${dosCifras(d.getMinutes())}`;
  const quien = nombreSeguro(de || '', { max: 48, porDefecto: 'remitente desconocido' });
  const tema = nombreSeguro(asunto || '', { max: 70, porDefecto: 'sin asunto' });
  return `${sello} - ${quien} - ${tema}.eml`;
}

// Un nombre libre en `dir`, sin pisar nada: «burofax.pdf» -> «burofax (2).pdf».
export function sinPisar(dir, nombre) {
  const ext = path.extname(nombre);
  const tronco = nombre.slice(0, nombre.length - ext.length) || 'documento';
  let candidato = nombre;
  for (let i = 2; fs.existsSync(path.join(dir, candidato)); i += 1) {
    candidato = `${tronco} (${i})${ext}`;
    if (i > 500) {
      candidato = `${tronco} (${crypto.randomBytes(4).toString('hex')})${ext}`;
      break;
    }
  }
  return candidato;
}

export function huellaContenido(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// La huella del registro es «sha256delcontenido:ajustes»; para saber si el CONTENIDO ya está
// guardado solo interesa la primera mitad.
const contenidoDe = (huella) => String(huella || '').split(':')[0];

// Recorrido acotado de la carpeta del expediente. No se hashea nada que no pese exactamente lo
// mismo: en un expediente de miles de ficheros, comparar tamaños es gratis y hashear no.
function buscarPorTamanyoYHuella(dir, bytes, sha, { tope = 8000 } = {}) {
  const pendientes = [dir];
  let vistos = 0;
  while (pendientes.length) {
    const actual = pendientes.shift();
    let entradas = [];
    try {
      entradas = fs.readdirSync(actual, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const en of entradas) {
      if (vistos > tope) return null;
      if (en.name.startsWith('.')) continue;
      const abs = path.join(actual, en.name);
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        pendientes.push(abs);
        continue;
      }
      if (!st.isFile()) continue;
      vistos += 1;
      if (st.size !== bytes) continue;
      try {
        if (huellaContenido(fs.readFileSync(abs)) === sha) return abs;
      } catch { /* ilegible: no es una copia que podamos afirmar */ }
    }
  }
  return null;
}

// ¿Este contenido EXACTO ya está en el expediente, aunque el fichero se llame de otra forma?
// «escrito.pdf» y «factura.pdf» se repiten muchísimo entre remitentes distintos, y el nombre no
// dice nada; el contenido sí. Se mira primero el índice (instantáneo) y después el disco, que
// alcanza también lo que se copió hace un minuto y todavía no está indexado.
export function yaGuardado(sha, { expediente, carpeta, bytes } = {}) {
  for (const [abs, e] of registry.entries()) {
    if (!e?.huella || contenidoDe(e.huella) !== sha) continue;
    if (!expedientes.enAmbito(e.expediente, expediente)) continue;
    if (fs.existsSync(abs)) return { ruta: abs, donde: 'indice', rutaRelativa: e.rutaRelativa || null };
  }
  if (carpeta && Number.isFinite(bytes)) {
    const abs = buscarPorTamanyoYHuella(carpeta, bytes, sha);
    if (abs) return { ruta: abs, donde: 'disco', rutaRelativa: null };
  }
  return null;
}

// Escribe el fichero dentro de la carpeta destino sin pisar nada y devuelve su ruta absoluta.
// Comprueba, después de resolver el nombre, que sigue cayendo DENTRO de la carpeta: lo que llega
// de fuera no decide dónde se escribe.
export function escribirSinPisar(carpetaDestino, nombre, contenido) {
  fs.mkdirSync(carpetaDestino, { recursive: true });
  const seguro = path.basename(nombreSeguro(nombre, { max: 150, porDefecto: 'adjunto' }));
  const libre = sinPisar(carpetaDestino, seguro);
  const destino = path.join(carpetaDestino, libre);
  if (path.dirname(path.resolve(destino)) !== path.resolve(carpetaDestino)) {
    throw new Error('El nombre del fichero no es válido para escribirlo en el expediente.');
  }
  // 'wx': si entre la comprobación y la escritura alguien creó ese fichero, se falla en vez de
  // pisarlo. La promesa de no tocar los documentos del abogado no admite una carrera.
  fs.writeFileSync(destino, contenido, { flag: 'wx' });
  return destino;
}

export default {
  CARPETA_COMUNICACIONES,
  nombreSeguro,
  nombreParaCorreo,
  sinPisar,
  huellaContenido,
  yaGuardado,
  escribirSinPisar,
};
