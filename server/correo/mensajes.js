// Lo común a leer y a listar correos: encontrar el trozo de texto dentro del MIME, decodificarlo
// con su juego de caracteres, describir los adjuntos y traducir los filtros de búsqueda.

import { htmlATexto } from './contenido.js';

// Tope al leer un correo ENTERO. Un escrito con el expediente escaneado adjunto puede pesar 20,
// 30 o 60 MB; traérselo entero para leer cuatro párrafos es tirar la tarde del abogado por el
// enlace del despacho. Por encima de esto se baja SOLO la parte de texto.
export const TOPE_ENTERO_BYTES = 2 * 1024 * 1024;

// Recorre el árbol MIME y devuelve la parte de texto que hay que enseñar. Se prefiere
// text/plain; si el correo solo trae HTML (media web y casi todo Outlook), se coge el HTML y se
// convierte. Las partes marcadas como adjunto no son el cuerpo, aunque sean texto: un .txt
// adjunto no es lo que escribió el remitente.
export function parteDeTexto(nodo) {
  if (!nodo) return null;
  const candidatos = [];
  const recorrer = (n) => {
    if (!n) return;
    const tipo = String(n.type || '').toLowerCase();
    const disposicion = String(n.disposition || '').toLowerCase();
    if (tipo.startsWith('text/') && disposicion !== 'attachment') {
      candidatos.push({ id: n.part || 'TEXT', tipo, charset: n.parameters?.charset || null, tamano: n.size || 0 });
    }
    for (const hijo of n.childNodes || []) recorrer(hijo);
  };
  recorrer(nodo);
  return candidatos.find((c) => c.tipo === 'text/plain') || candidatos.find((c) => c.tipo === 'text/html') || null;
}

// Bytes → texto con el juego de caracteres que declare el correo. Los correos de despacho
// españoles siguen llegando en ISO-8859-1/15 desde gestores antiguos: leerlos como UTF-8 llena
// el texto de «Â» y de rombos, y una cláusula con «cesión» se vuelve ilegible.
export function decodificar(buffer, charset) {
  const juego = String(charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
  try {
    return new TextDecoder(juego, { fatal: false }).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

// Descarga la parte de texto de un mensaje, hasta `maxBytes`. imapflow ya deshace el
// Base64/Quoted-Printable; el juego de caracteres lo ponemos nosotros.
export async function textoDe(cliente, uid, parte, { maxBytes = 256 * 1024 } = {}) {
  if (!parte) return '';
  const { content } = await cliente.download(String(uid), parte.id, { uid: true, maxBytes, chunkSize: Math.min(maxBytes, 64 * 1024) });
  if (!content) return '';
  const trozos = [];
  let total = 0;
  for await (const t of content) {
    trozos.push(t);
    total += t.length;
    if (total >= maxBytes) break;
  }
  const texto = decodificar(Buffer.concat(trozos), parte.charset);
  return parte.tipo === 'text/html' ? htmlATexto(texto) : texto;
}

// Los adjuntos que trae el correo: nombre, tipo, tamaño y la PARTE MIME donde vive cada uno.
// Esto solo los describe —es lo que necesita el abogado para decidir—; bajarlos es cosa de quien
// llama: leer_adjunto trae el texto de uno y archivar_correo lo deja en el expediente.
export function adjuntosDe(nodo) {
  const out = [];
  const recorrer = (n) => {
    if (!n) return;
    const disposicion = String(n.disposition || '').toLowerCase();
    const tipo = String(n.type || '').toLowerCase();
    const nombre = n.dispositionParameters?.filename || n.parameters?.name || null;
    const esAdjunto = disposicion === 'attachment' || (nombre && !tipo.startsWith('multipart/'));
    if (esAdjunto && !tipo.startsWith('multipart/')) {
      out.push({ nombre: nombre || '(sin nombre)', tipo, bytes: n.size || 0, parte: n.part || null });
    }
    for (const hijo of n.childNodes || []) recorrer(hijo);
  };
  recorrer(nodo);
  return out;
}

// Una fecha en «AAAA-MM-DD» (o un Date) → Date. Se devuelve null si no se entiende, para no
// buscar en una ventana de tiempo que el abogado no ha pedido.
export function fecha(valor) {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(String(valor).length <= 10 ? `${valor}T00:00:00` : valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Filtros → consulta IMAP. El servidor hace la criba: bajarse el buzón entero para filtrar aquí
// sería inviable en un buzón de despacho con 80.000 correos.
export function consulta({ remitente, destinatario, asunto, texto, desde, hasta, no_leidos, con_adjunto }) {
  const q = {};
  if (remitente) q.from = remitente;
  if (destinatario) q.to = destinatario;
  if (asunto) q.subject = asunto;
  if (texto) q.body = texto;
  const d = fecha(desde);
  const h = fecha(hasta);
  if (d) q.since = d;
  if (h) {
    // BEFORE en IMAP es estrictamente anterior a ese día: para que «hasta el 15» incluya el 15
    // se pide «antes del 16». Sin esto faltaba siempre el último día del rango pedido.
    const siguiente = new Date(h);
    siguiente.setDate(siguiente.getDate() + 1);
    q.before = siguiente;
  }
  if (no_leidos === true) q.seen = false;
  // `con_adjunto` no existe en IMAP: se filtra después, con la estructura del mensaje.
  if (!Object.keys(q).length) q.all = true;
  return q;
}

const dir = (d) => (d ? { nombre: d.name || null, direccion: d.address || null } : null);

// El sobre del mensaje, con las direcciones ya desmenuzadas.
export function sobre(envelope) {
  return {
    fecha: envelope?.date ? new Date(envelope.date).toISOString() : null,
    de: (envelope?.from || []).map(dir),
    para: (envelope?.to || []).map(dir),
    cc: (envelope?.cc || []).map(dir),
    asunto: envelope?.subject || '(sin asunto)',
    message_id: envelope?.messageId || null,
  };
}

export default { parteDeTexto, textoDe, adjuntosDe, consulta, sobre, decodificar, fecha, TOPE_ENTERO_BYTES };
