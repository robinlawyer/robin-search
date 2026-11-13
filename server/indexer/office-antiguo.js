// Documentos de Office ANTERIORES a 2007 (formato binario OLE): .doc y .ppt.
//
// No son un capricho histórico: un despacho con veinte años de expedientes tiene miles. Hasta la
// 1.8.1 RobinSearch ni los miraba —«Formato no soportado: .doc»— y el abogado no lo sabía: esos
// documentos simplemente no aparecían en las búsquedas.
//
// Se leen aquí, sin binarios nativos ni convertidores externos: `cfb` (el mismo lector de ficheros
// compuestos OLE que trae SheetJS) para abrir los flujos, y el formato de cada aplicación a mano.
// Los .xls no pasan por aquí: SheetJS ya los lee.
import CFB from 'cfb';

// Windows-1252 no es latin1: en el tramo 0x80-0x9F están el euro, las comillas «inteligentes», el
// guion largo y los puntos suspensivos, que es justo lo que llena un escrito judicial.
const CP1252 = [
  '€', '\u0081', '‚', 'ƒ', '„', '…', '†', '‡',
  'ˆ', '‰', 'Š', '‹', 'Œ', '\u008d', 'Ž', '\u008f',
  '\u0090', '‘', '’', '“', '”', '•', '–', '—',
  '˜', '™', 'š', '›', 'œ', '\u009d', 'ž', 'Ÿ',
];

export function deCp1252(buf) {
  return buf.toString('latin1').replace(/[\u0080-\u009f]/g, (c) => CP1252[c.charCodeAt(0) - 0x80] ?? c);
}

// Los códigos que Word y PowerPoint usan como marcas (fin de celda, de fila, salto de página, los
// delimitadores de campo) no son texto: se convierten en separadores o se quitan.
function limpiar(s) {
  return s
    .replace(/\r/g, '\n')
    .replace(/[\u0007\u000b\u000c\u000e]/g, '\n')
    .replace(/[\u0000-\u0006\u0008\u0010-\u001f]/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

function flujo(cfb, nombre) {
  const e = CFB.find(cfb, nombre);
  return e && e.content ? Buffer.from(e.content) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Word 97-2003 (.doc)
// ─────────────────────────────────────────────────────────────────────────────
//
// El texto NO está seguido en el fichero: la «tabla de trozos» (piece table) dice de qué partes
// del flujo WordDocument se compone y en qué orden, y cada trozo puede estar en Windows-1252
// (1 byte) o en UTF-16 (2). Sin esa tabla, un documento editado varias veces sale con los
// párrafos descolocados y con la basura de las ediciones anteriores por medio.
const FIB_IDENT = 0xa5ec;

// Fin de la cabecera (FIB): la parte fija, y luego tres bloques con su tamaño declarado delante.
function offsetsFib(doc) {
  let p = 32;
  const csw = doc.readUInt16LE(p); p += 2 + csw * 2;            // FibRgW97
  const cslw = doc.readUInt16LE(p); p += 2;                     // FibRgLw97
  const rgLw = p;
  p += cslw * 4;
  const cbRgFcLcb = doc.readUInt16LE(p); p += 2;                // FibRgFcLcb97
  return { rgLw, rgFcLcb: p, cbRgFcLcb };
}

// ¿Es un documento de Office protegido con contraseña? (13-nov-2026, informes técnicos de un
// despacho en Windows con la carpeta en OneDrive.)
//   · Word, Excel o PowerPoint de 2007 en adelante con contraseña de apertura: el .docx/.xlsx/.pptx
//     deja de ser un ZIP y pasa a ser un contenedor OLE con el contenido cifrado en el flujo
//     «EncryptedPackage». Hasta la 1.13.2 un .docx así se leía como un .doc antiguo, no salía
//     texto y se «indexaba» vacío SIN AVISO: el abogado creía que estaba en las búsquedas.
//   · Word 97-2003 cifrado: bit fEncrypted (0x0100) de la cabecera del flujo WordDocument.
//   · PowerPoint 97-2003 cifrado: flujo «EncryptedSummary».
// (El Excel 97-2003 cifrado lo reconoce el propio lector de hojas: «File is password-protected».)
export function oleCifrado(buf) {
  let cfb;
  try {
    cfb = CFB.read(buf, { type: 'buffer' });
  } catch {
    return false;
  }
  if (CFB.find(cfb, 'EncryptedPackage') || CFB.find(cfb, 'EncryptedSummary')) return true;
  const doc = flujo(cfb, 'WordDocument');
  return Boolean(doc && doc.length >= 12 && doc.readUInt16LE(0) === FIB_IDENT && (doc.readUInt16LE(0x0a) & 0x0100));
}

export function textoDeDoc(buf) {
  const cfb = CFB.read(buf, { type: 'buffer' });
  const doc = flujo(cfb, 'WordDocument');
  if (!doc || doc.length < 68 || doc.readUInt16LE(0) !== FIB_IDENT) return null;
  // Bit 9 de la cabecera: en cuál de los dos flujos de tabla está la tabla de trozos.
  const tabla = flujo(cfb, (doc.readUInt16LE(0x0a) & 0x0200) ? '1Table' : '0Table');
  if (!tabla) return null;

  const { rgLw, rgFcLcb, cbRgFcLcb } = offsetsFib(doc);
  const ccpText = doc.readInt32LE(rgLw + 3 * 4);                // caracteres del cuerpo
  // fcClx/lcbClx: la pareja 34 de FibRgFcLcb97 (0x01A2 en la disposición clásica).
  if (cbRgFcLcb < 34 * 2) return null;
  const fcClx = doc.readInt32LE(rgFcLcb + 33 * 8);
  const lcbClx = doc.readInt32LE(rgFcLcb + 33 * 8 + 4);
  if (fcClx <= 0 || lcbClx <= 0 || fcClx + lcbClx > tabla.length) return null;

  // El CLX son propiedades de formato (clase 1, que se saltan) y al final la tabla (clase 2).
  let p = fcClx;
  const fin = fcClx + lcbClx;
  let pcdt = -1;
  while (p < fin) {
    const clase = tabla[p];
    if (clase === 1) p += 3 + tabla.readUInt16LE(p + 1);
    else if (clase === 2) { pcdt = p + 1; break; }
    else break;
  }
  if (pcdt < 0 || pcdt + 4 > fin) return null;

  const lcbPlcfpcd = tabla.readInt32LE(pcdt);
  const plc = pcdt + 4;
  const n = Math.floor((lcbPlcfpcd - 4) / 12);                  // (n+1) posiciones de 4 B + n trozos de 8 B
  if (n <= 0 || plc + lcbPlcfpcd > tabla.length) return null;

  const cps = [];
  for (let i = 0; i <= n; i++) cps.push(tabla.readInt32LE(plc + i * 4));
  const pcds = plc + (n + 1) * 4;

  let texto = '';
  for (let i = 0; i < n; i++) {
    const inicio = cps[i];
    if (inicio >= ccpText) break;                               // notas y cabeceras van detrás del cuerpo
    const caracteres = Math.min(cps[i + 1], ccpText) - inicio;
    if (caracteres <= 0) continue;
    const bruto = tabla.readUInt32LE(pcds + i * 8 + 2);
    const cp1252 = Boolean(bruto & 0x40000000);
    const off = cp1252 ? (bruto & ~0x40000000) / 2 : bruto;
    if (off < 0 || off >= doc.length) continue;
    texto += cp1252
      ? deCp1252(doc.subarray(off, off + caracteres))
      : doc.subarray(off, off + caracteres * 2).toString('utf16le');
  }
  const salida = limpiar(texto).trim();
  return salida || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PowerPoint 97-2003 (.ppt)
// ─────────────────────────────────────────────────────────────────────────────
//
// Aquí el texto sí va en átomos sueltos dentro del flujo «PowerPoint Document»: se recorren las
// cabeceras de registro (8 bytes), se entra en los contenedores y se recogen los de texto en
// orden de aparición.
const PPT_TEXTBYTES = 0x0fa8;   // Windows-1252
const PPT_TEXTCHARS = 0x0fa0;   // UTF-16
const PPT_CSTRING = 0x0fba;     // títulos y notas, UTF-16

export function textoDePpt(buf) {
  const cfb = CFB.read(buf, { type: 'buffer' });
  const ppt = flujo(cfb, 'PowerPoint Document');
  if (!ppt) return null;
  const trozos = [];
  const recorrer = (ini, fin, hondura) => {
    let p = ini;
    while (p + 8 <= fin) {
      const version = ppt.readUInt16LE(p) & 0x000f;
      const tipo = ppt.readUInt16LE(p + 2);
      const largo = ppt.readUInt32LE(p + 4);
      const cuerpo = p + 8;
      if (cuerpo + largo > fin) break;
      if (version === 0x0f && hondura < 12) recorrer(cuerpo, cuerpo + largo, hondura + 1);
      else if (tipo === PPT_TEXTBYTES) trozos.push(deCp1252(ppt.subarray(cuerpo, cuerpo + largo)));
      else if (tipo === PPT_TEXTCHARS || tipo === PPT_CSTRING) {
        trozos.push(ppt.subarray(cuerpo, cuerpo + largo).toString('utf16le'));
      }
      p = cuerpo + largo;
    }
  };
  recorrer(0, ppt.length, 0);
  const salida = limpiar(trozos.join('\n')).trim();
  return salida || null;
}

export default { textoDeDoc, textoDePpt };
