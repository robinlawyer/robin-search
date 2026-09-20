// Construcción del correo en crudo (MIME) y, sobre todo, las cabeceras de HILO.
//
// POR QUÉ IMPORTAN LAS CABECERAS. Un borrador de respuesta sin `In-Reply-To` ni `References`
// es un correo suelto: el abogado lo abre en su Outlook o en Apple Mail y no está dentro de la
// conversación con el cliente, sino tirado en Borradores sin contexto. Con ellas, el cliente de
// correo lo enhebra donde toca. Son dos cabeceras y son la diferencia entre «útil» y «cacharro».
//
// El MIME lo arma MailComposer (nodemailer): codificación del asunto con acentos, saltos de
// línea CRLF, Content-Type y Message-ID. Escribirlo a mano es garantía de asunto ilegible en
// algún cliente.

import MailComposer from 'nodemailer/lib/mail-composer/index.js';

// Un Message-ID por correo. El dominio sale del remitente: un Message-ID con un dominio ajeno
// hace que algunos filtros antispam lo miren con lupa.
function dominioDe(direccion) {
  const m = /@([^@>\s]+)/.exec(String(direccion || ''));
  return m ? m[1].replace(/[>\s]/g, '') : 'robinsearch.local';
}

// `References` es la cadena entera del hilo: la del correo al que se responde MÁS su propio
// Message-ID. Los clientes enhebran por ahí cuando falta el In-Reply-To.
export function cadenaDeHilo(original) {
  if (!original) return { inReplyTo: null, references: [] };
  const suyo = original.messageId || null;
  const previas = []
    .concat(original.references || [])
    .flatMap((r) => String(r).split(/\s+/))
    .filter(Boolean);
  const references = [...new Set([...previas, ...(suyo ? [suyo] : [])])];
  // Un hilo largo puede acumular decenas: los clientes solo necesitan el principio y el final.
  const recortadas = references.length > 20 ? [references[0], ...references.slice(-19)] : references;
  return { inReplyTo: suyo, references: recortadas };
}

// «Re:» una sola vez, respetando el prefijo que ya traiga el asunto (también «RE:» o «Rv:»).
export function asuntoDeRespuesta(asunto) {
  const a = String(asunto || '').trim();
  if (!a) return 'Re:';
  return /^(re|rv|fwd?|rif)\s*:/i.test(a) ? a : `Re: ${a}`;
}

const lista = (v) => (Array.isArray(v) ? v : (v ? [v] : []))
  .flatMap((x) => String(x).split(','))
  .map((x) => x.trim())
  .filter(Boolean);

// Una dirección mínimamente creíble. No se valida contra el RFC entero (nadie lo hace bien):
// se comprueba que hay algo@algo.algo, que es lo que rechaza los errores de dedo de verdad.
export function direccionValida(x) {
  const s = String(x || '').trim();
  const dentro = /<([^>]+)>\s*$/.exec(s);
  return /^[^\s@<>,;]+@[^\s@<>,;.]+(\.[^\s@<>,;.]+)+$/.test(dentro ? dentro[1].trim() : s);
}

// Devuelve { raw: Buffer, messageId, cabeceras } listo para APPEND o para enviar.
export async function componer({ de, para, cc, cco, asunto, cuerpo, original = null, fecha = new Date() }) {
  const hilo = cadenaDeHilo(original);
  const messageId = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}@${dominioDe(de)}>`;
  const mail = new MailComposer({
    from: de,
    to: lista(para),
    cc: lista(cc),
    bcc: lista(cco),
    subject: asunto,
    text: String(cuerpo ?? ''),
    date: fecha,
    messageId,
    ...(hilo.inReplyTo ? { inReplyTo: hilo.inReplyTo } : {}),
    ...(hilo.references.length ? { references: hilo.references } : {}),
    // Sin `X-Mailer`: ninguna necesidad de anunciar a la contraparte con qué se escribió.
  });
  const raw = await new Promise((resolve, reject) => {
    mail.compile().build((err, mensaje) => (err ? reject(err) : resolve(mensaje)));
  });
  return {
    raw,
    messageId,
    cabeceras: { inReplyTo: hilo.inReplyTo, references: hilo.references },
  };
}

export default { componer, cadenaDeHilo, asuntoDeRespuesta, direccionValida };
