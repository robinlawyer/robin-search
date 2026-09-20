// guardar_borrador — deja el correo redactado en la carpeta de Borradores del abogado, para que
// él lo lea, lo corrija y lo mande desde su propio programa de correo.
//
// ES LA HERRAMIENTA QUE JUSTIFICA TODO EL MÓDULO. Robin redacta; el abogado firma y envía. Por
// eso esta es la que se usa siempre y `enviar_correo` la excepción.
//
// DOS COSAS QUE SE HACEN MAL EN TODAS PARTES Y AQUÍ NO:
//  1. La carpeta. Un APPEND a «Drafts» a pelo crea una carpeta suelta que el abogado no mira
//     nunca; la de verdad la dice el servidor con SPECIAL-USE y en Dovecot es «INBOX.Drafts».
//  2. El hilo. Un borrador de respuesta sin In-Reply-To ni References aparece fuera de la
//     conversación, sin contexto, y el abogado no sabe ni a qué contesta.

// ⚠️ CARGA PEREZOSA. Nada de imapflow, mailparser ni nodemailer arriba: entre los tres son unos
// 7,5 s de carga de módulos (medido el 21-sep-2026), y eso lo pagaba CADA arranque del servidor,
// tuviera el abogado el correo conectado o no — que la mayoría no lo tiene. Aquí arriba solo va
// lo que hace falta para DECLARAR la herramienta y para contestar «no hay cuenta»; lo pesado se
// importa dentro del handler, la primera vez que alguien usa el correo de verdad.
import { ok, fail } from './util.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';
import { leerCorreo } from '../correo/ajustes.js';
import { SIN_CUENTA } from '../correo/avisos.js';

export const definition = {
  name: 'guardar_borrador',
  title: 'Guardar un borrador en el correo del abogado',
  description:
    'Escribe un correo y lo deja en la carpeta de Borradores del buzón del abogado, SIN enviarlo. '
    + 'Aparece en su programa de correo (Outlook, Apple Mail, webmail) listo para revisar y mandar. '
    + 'Si se indica "en_respuesta_a" con el uid de un correo, el borrador queda dentro de ese hilo '
    + 'y con el asunto «Re:», y los destinatarios se toman del correo original si no se dan. '
    + 'Esta es la forma normal de que Robin escriba correo: redactar, nunca enviar.',
  inputSchema: {
    type: 'object',
    properties: {
      para: { type: 'array', items: { type: 'string' }, description: 'Destinatarios. Si es respuesta y se omite, se usa quien envió el original.' },
      cc: { type: 'array', items: { type: 'string' }, description: 'En copia.' },
      asunto: { type: 'string', description: 'Asunto. Si es respuesta y se omite, «Re: » + el asunto del original.' },
      cuerpo: { type: 'string', description: 'Texto del correo, ya redactado y en el tono que use el abogado.' },
      en_respuesta_a: { type: 'integer', description: 'uid del correo al que responde (de buscar_correos), para que el borrador quede enhebrado en la conversación.' },
      bandeja_original: { type: 'string', description: 'Carpeta donde está ese correo original: "entrada" (por defecto), "enviados" o el nombre exacto.' },
    },
    required: ['cuerpo'],
  },
  annotations: {
    readOnlyHint: false,
    // Escribe en el buzón, pero solo AÑADE un borrador: no toca ni borra nada del abogado.
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

async function bandejaReal(carpetas, cliente, pedida) {
  const p = String(pedida || '').trim().toLowerCase();
  if (!p || ['entrada', 'inbox', 'bandeja de entrada', 'recibidos'].includes(p)) return 'INBOX';
  if (['enviados', 'sent'].includes(p)) return (await carpetas.resolver(cliente, 'enviados')) || 'INBOX';
  if (['borradores', 'drafts'].includes(p)) return (await carpetas.resolver(cliente, 'borradores')) || 'INBOX';
  return String(pedida).trim();
}

// Lee del servidor el correo al que se responde: su Message-ID, su cadena de References, su
// asunto y quién lo mandó. Sin esto no hay hilo posible.
async function original(carpetas, cliente, uid, bandeja) {
  const ruta = await bandejaReal(carpetas, cliente, bandeja);
  const cerrojo = await cliente.getMailboxLock(ruta, { readOnly: true });
  try {
    const m = await cliente.fetchOne(String(uid), { envelope: true, headers: ['references', 'reply-to'] }, { uid: true });
    if (!m) return null;
    const cabeceras = m.headers ? m.headers.toString('utf8') : '';
    const refs = /^references:\s*([\s\S]*?)(?=\r?\n[^\s]|\r?\n\r?\n|$)/im.exec(cabeceras);
    const replyTo = /^reply-to:\s*(.*)$/im.exec(cabeceras);
    return {
      messageId: m.envelope?.messageId || null,
      references: refs ? refs[1].split(/\s+/).filter(Boolean) : [],
      asunto: m.envelope?.subject || '',
      // Se responde a Reply-To si lo hay: en los correos de un juzgado o de un gestor documental
      // el From es un buzón que no lee nadie.
      responderA: (replyTo && replyTo[1].trim())
        || (m.envelope?.replyTo || [])[0]?.address
        || (m.envelope?.from || [])[0]?.address
        || null,
    };
  } finally {
    cerrojo.release();
  }
}

export async function handler(args) {
  const auth = await ensureAuthorized();
  if (!auth.ok) return authPromptResult(auth.loginUrl);

  const cfg = leerCorreo();
  if (!cfg.configurado) return fail(SIN_CUENTA, { motivo: 'sin_cuenta' });

  const { conImap } = await import('../correo/conexion.js');
  const carpetas = await import('../correo/carpetas.js');
  const { componer, asuntoDeRespuesta, direccionValida } = await import('../correo/redaccion.js');

  const cuerpo = typeof args?.cuerpo === 'string' ? args.cuerpo : '';
  if (!cuerpo.trim()) return fail('El borrador no puede ir vacío: falta "cuerpo".');
  const respondeA = Number.isFinite(parseInt(args?.en_respuesta_a, 10)) ? parseInt(args.en_respuesta_a, 10) : null;

  try {
    return await conImap(async (cliente) => {
      const destino = await carpetas.resolver(cliente, 'borradores');
      if (!destino) {
        return fail(
          'Tu servidor de correo no dice cuál es su carpeta de Borradores y no hay ninguna con un '
          + 'nombre reconocible. Ponla a mano en la app de RobinSearch → Tu correo → Ajustes '
          + 'avanzados; si no, el borrador acabaría en una carpeta suelta que no mira nadie.',
          { motivo: 'sin_carpeta_borradores' },
        );
      }

      let previo = null;
      if (respondeA !== null) {
        previo = await original(carpetas, cliente, respondeA, args?.bandeja_original);
        if (!previo) {
          return fail(`No se encuentra el correo con uid ${respondeA} para responderle. Vuelve a buscarlo con buscar_correos.`, { motivo: 'no_encontrado' });
        }
      }

      const para = (Array.isArray(args?.para) ? args.para : (args?.para ? [args.para] : []))
        .map((x) => String(x).trim()).filter(Boolean);
      const destinatarios = para.length ? para : (previo?.responderA ? [previo.responderA] : []);
      if (!destinatarios.length) {
        return fail('Falta "para": no hay destinatario y el correo original tampoco dice a quién responder.');
      }
      const malas = destinatarios.concat(Array.isArray(args?.cc) ? args.cc : []).filter((d) => !direccionValida(d));
      if (malas.length) return fail(`Esta dirección no parece válida: ${malas.join(', ')}. Compruébala antes de guardar el borrador.`);

      const asunto = args?.asunto || (previo ? asuntoDeRespuesta(previo.asunto) : '(sin asunto)');
      const { raw, messageId, cabeceras } = await componer({
        de: cfg.usuario,
        para: destinatarios,
        cc: args?.cc,
        asunto,
        cuerpo,
        original: previo,
      });

      // La bandera \Draft es lo que hace que Outlook y Apple Mail lo abran para EDITAR en vez de
      // enseñarlo como un correo recibido. Y la fecha, para que salga el primero de la lista.
      const r = await cliente.append(destino, raw, ['\\Draft'], new Date());

      return ok({
        guardado: true,
        carpeta: destino,
        uid: r?.uid ?? null,
        asunto,
        para: destinatarios,
        cc: Array.isArray(args?.cc) ? args.cc : [],
        message_id: messageId,
        en_hilo: Boolean(cabeceras.inReplyTo),
        in_reply_to: cabeceras.inReplyTo,
        referencias: cabeceras.references.length,
        nota: `El borrador está en «${destino}». El abogado lo verá en su programa de correo `
          + '(puede tardar unos segundos en sincronizarse) y podrá revisarlo antes de enviarlo. '
          + 'RobinSearch no lo ha enviado.',
      });
    });
  } catch (err) {
    return fail(err?.message || 'No se ha podido guardar el borrador.', { motivo: err?.motivo || 'error' });
  }
}

export default { definition, handler };
