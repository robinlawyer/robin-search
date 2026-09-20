// enviar_correo — manda el correo de verdad. La única herramienta de RobinSearch que produce un
// efecto que el abogado no puede deshacer: un correo salido no vuelve.
//
// TRES CANDADOS, Y LOS TRES HACEN FALTA:
//  1. El envío viene DESACTIVADO de fábrica. Se enciende con un interruptor en la app de
//     escritorio — en el ordenador del abogado, con su mano. Sin eso, aquí se falla siempre.
//  2. Cada llamada exige `confirmar: true`. Que el modelo tenga permiso no quita que tenga que
//     decir explícitamente, en esa llamada, que va a mandarlo.
//  3. `destructiveHint: true`: Claude Desktop pide confirmación al abogado antes de ejecutarla.
//
// Lo NORMAL es guardar_borrador. Esta herramienta es para cuando el abogado dice «mándalo».

// ⚠️ CARGA PEREZOSA. Nada de imapflow, mailparser ni nodemailer arriba: entre los tres son unos
// 7,5 s de carga de módulos (medido el 21-sep-2026), y eso lo pagaba CADA arranque del servidor,
// tuviera el abogado el correo conectado o no — que la mayoría no lo tiene. Aquí arriba solo va
// lo que hace falta para DECLARAR la herramienta y para contestar «no hay cuenta»; lo pesado se
// importa dentro del handler, la primera vez que alguien usa el correo de verdad.
import { ok, fail } from './util.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';
import { leerCorreo } from '../correo/ajustes.js';
import { SIN_CUENTA } from '../correo/avisos.js';
import { log } from '../logger.js';

export const definition = {
  name: 'enviar_correo',
  title: 'Enviar un correo desde la cuenta del abogado',
  description:
    'Envía un correo desde el buzón del abogado por SMTP y deja copia en Enviados. Exige '
    + 'confirmar: true en la llamada Y que el abogado haya permitido el envío en la app de '
    + 'RobinSearch (viene desactivado de fábrica: por defecto Robin solo redacta borradores). '
    + 'Un correo enviado no se puede retirar: si hay la menor duda, usa guardar_borrador y deja '
    + 'que lo mande él.',
  inputSchema: {
    type: 'object',
    properties: {
      para: { type: 'array', items: { type: 'string' }, description: 'Destinatarios.' },
      cc: { type: 'array', items: { type: 'string' }, description: 'En copia.' },
      cco: { type: 'array', items: { type: 'string' }, description: 'En copia oculta.' },
      asunto: { type: 'string', description: 'Asunto del correo.' },
      cuerpo: { type: 'string', description: 'Texto del correo.' },
      en_respuesta_a: { type: 'integer', description: 'uid del correo al que responde, para que salga dentro del hilo.' },
      bandeja_original: { type: 'string', description: 'Carpeta del correo original: "entrada" (por defecto), "enviados" o el nombre exacto.' },
      confirmar: { type: 'boolean', description: 'Tiene que ser true. Sin esto no se envía nada.' },
    },
    required: ['cuerpo', 'confirmar'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

async function original(carpetas, cliente, uid, bandeja) {
  const p = String(bandeja || '').trim().toLowerCase();
  let ruta = String(bandeja || 'INBOX').trim();
  if (!p || ['entrada', 'inbox', 'bandeja de entrada', 'recibidos'].includes(p)) ruta = 'INBOX';
  else if (['enviados', 'sent'].includes(p)) ruta = (await carpetas.resolver(cliente, 'enviados')) || 'INBOX';
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
      responderA: (replyTo && replyTo[1].trim()) || (m.envelope?.from || [])[0]?.address || null,
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

  if (!cfg.envioPermitido) {
    return fail(
      'El envío de correo está desactivado en este ordenador: RobinSearch solo puede dejar '
      + 'borradores. El abogado puede permitirlo en la app de RobinSearch → Tu correo → «Permitir '
      + 'además que envíe correos». Mientras tanto, usa guardar_borrador.',
      { motivo: 'envio_no_permitido' },
    );
  }
  if (args?.confirmar !== true) {
    return fail('Para enviar hace falta confirmar: true en la llamada. Si no es lo que quiere el abogado, usa guardar_borrador.', { motivo: 'sin_confirmar' });
  }

  const cuerpo = typeof args?.cuerpo === 'string' ? args.cuerpo : '';
  if (!cuerpo.trim()) return fail('El correo no puede ir vacío: falta "cuerpo".');

  const { conImap } = await import('../correo/conexion.js');
  const carpetas = await import('../correo/carpetas.js');
  const { enviarCrudo } = await import('../correo/smtp.js');
  const { componer, asuntoDeRespuesta, direccionValida } = await import('../correo/redaccion.js');
  const respondeA = Number.isFinite(parseInt(args?.en_respuesta_a, 10)) ? parseInt(args.en_respuesta_a, 10) : null;

  try {
    // El original y la copia en Enviados van por IMAP; el envío, por SMTP.
    const preparado = await conImap(async (cliente) => {
      const previo = respondeA !== null ? await original(carpetas, cliente, respondeA, args?.bandeja_original) : null;
      if (respondeA !== null && !previo) {
        return { error: `No se encuentra el correo con uid ${respondeA} al que responder.`, motivo: 'no_encontrado' };
      }
      const para = (Array.isArray(args?.para) ? args.para : (args?.para ? [args.para] : []))
        .map((x) => String(x).trim()).filter(Boolean);
      const destinatarios = para.length ? para : (previo?.responderA ? [previo.responderA] : []);
      if (!destinatarios.length) return { error: 'Falta "para": no hay a quién enviarlo.', motivo: 'sin_destinatario' };

      const cc = (Array.isArray(args?.cc) ? args.cc : []).map((x) => String(x).trim()).filter(Boolean);
      const cco = (Array.isArray(args?.cco) ? args.cco : []).map((x) => String(x).trim()).filter(Boolean);
      const malas = [...destinatarios, ...cc, ...cco].filter((d) => !direccionValida(d));
      if (malas.length) return { error: `Esta dirección no parece válida: ${malas.join(', ')}. Un correo a una dirección mal escrita se pierde sin aviso.`, motivo: 'direccion_invalida' };

      const asunto = args?.asunto || (previo ? asuntoDeRespuesta(previo.asunto) : '(sin asunto)');
      const compuesto = await componer({ de: cfg.usuario, para: destinatarios, cc, cco, asunto, cuerpo, original: previo });
      return { ...compuesto, destinatarios, cc, cco, asunto, enviados: await carpetas.resolver(cliente, 'enviados') };
    });
    if (preparado.error) return fail(preparado.error, { motivo: preparado.motivo });

    const todos = [...preparado.destinatarios, ...preparado.cc, ...preparado.cco];
    const envio = await enviarCrudo({ raw: preparado.raw, de: cfg.usuario, destinatarios: todos });

    // Copia en Enviados. Que falle NO significa que el correo no haya salido: el abogado tiene
    // que saber exactamente qué pasó, porque lo que ya salió no vuelve.
    let copia = { ok: false, carpeta: preparado.enviados };
    if (preparado.enviados) {
      try {
        await conImap(async (cliente) => {
          await cliente.append(preparado.enviados, preparado.raw, ['\\Seen'], new Date());
        });
        copia.ok = true;
      } catch (err) {
        log.warn('Correo enviado pero sin copia en Enviados', { code: err?.code || null });
      }
    }

    return ok({
      enviado: true,
      destinatarios: preparado.destinatarios.length,
      cc: preparado.cc.length,
      cco: preparado.cco.length,
      asunto: preparado.asunto,
      message_id: preparado.messageId,
      en_hilo: Boolean(preparado.cabeceras.inReplyTo),
      aceptados_por_el_servidor: envio.aceptados,
      rechazados: envio.rechazados,
      copia_en_enviados: copia.ok,
      nota: copia.ok
        ? 'Enviado y con copia en Enviados.'
        : `Enviado. No se ha podido dejar copia en ${copia.carpeta ? `«${copia.carpeta}»` : 'Enviados'}: el correo SÍ ha salido, pero no aparecerá en la carpeta de enviados del abogado.`,
    });
  } catch (err) {
    return fail(err?.message || 'No se ha podido enviar el correo.', { motivo: err?.motivo || 'error' });
  }
}

export default { definition, handler };
