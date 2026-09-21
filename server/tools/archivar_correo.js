// archivar_correo — deja el correo (y, si se quiere, sus adjuntos) DENTRO de la carpeta del
// expediente, para que forme parte del caso y se pueda buscar con todo lo demás.
//
// EL HUECO QUE CIERRA. Hasta ahora el correo se leía en vivo contra el buzón y ahí se quedaba:
// no era un fichero del expediente, así que buscar_documentos no lo alcanzaba y el abogado tenía
// que acordarse de buscarlo aparte. Y guardar solo el adjunto tampoco vale: sin el correo que lo
// traía no consta quién lo mandó, cuándo, ni qué decía (Juan Maza, 21-sep-2026).
//
// SE GUARDA EL .eml ORIGINAL, no un resumen de Robin: conserva las cabeceras completas —que es
// lo que pesa como prueba—, se abre con doble clic en cualquier cliente de correo, y RobinSearch
// ya lo sabe leer: al indexarlo desmonta cabecera, cuerpo y el texto de CADA adjunto que lleve
// dentro, de forma recursiva. O sea que archivando el correo quedan dentro del índice también
// sus adjuntos, sin sacarlos a ficheros sueltos. Sacarlos («que»: "adjunto") es para cuando el
// abogado quiere el PDF a mano, no el único camino.
//
// NUNCA AUTOMÁTICO. Ni todo lo que entra en el buzón, ni una carpeta entera: el spam, la
// facturación del despacho y la agenda no pintan nada en el expediente de un cliente. Un correo,
// una confirmación, y la confirmación dice remitente y expediente destino EN LA MISMA FRASE,
// porque el fallo que hay que ver antes de que ocurra es archivar la correspondencia de un
// cliente en el expediente de otro.

// CARGA PEREZOSA (como el resto del correo): imapflow y mailparser son ~7,5 s de arranque que no
// puede pagar quien no tiene el correo conectado. Arriba solo lo que declara la herramienta.
import path from 'node:path';

import { ok, fail } from './util.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';
import { leerCorreo } from '../correo/ajustes.js';
import { SIN_CUENTA } from '../correo/avisos.js';
import * as expedientes from '../expedientes.js';
import * as archivo from '../correo/archivo.js';
import { limiteBytes, logicalPath } from '../config.js';
import { log } from '../logger.js';

export const definition = {
  name: 'archivar_correo',
  title: 'Archivar un correo en el expediente',
  description:
    'Guarda un correo del buzón del abogado DENTRO de la carpeta del expediente (en '
    + `«${archivo.CARPETA_COMUNICACIONES}/», como .eml), para que quede en el caso y se pueda `
    + 'buscar junto al resto de documentos con buscar_documentos. Al indexar el .eml, RobinSearch '
    + 'lee también el texto de los adjuntos que lleve dentro, así que archivar el correo suele '
    + 'bastar; usa "que": "adjunto" solo si el abogado quiere además el fichero suelto (el PDF del '
    + 'burofax, por ejemplo), o "todo" para las dos cosas. Va al expediente ACTIVO de la sesión '
    + 'salvo que se indique otro, y NO escribe nada sin "confirmar": true: llámala primero sin '
    + 'confirmar, enséñale al abogado la frase que devuelve —dice el remitente y el expediente '
    + 'destino— y confirma solo si él dice que sí. Si el mismo contenido ya está en el expediente, '
    + 'avisa en vez de dejar una copia repetida.',
  inputSchema: {
    type: 'object',
    properties: {
      uid: { type: 'integer', description: 'uid del correo, tal y como lo devolvió buscar_correos.' },
      bandeja: { type: 'string', description: 'Carpeta donde está: "entrada" (por defecto), "enviados", "borradores" o el nombre exacto.' },
      que: {
        type: 'string',
        enum: ['correo', 'adjunto', 'todo'],
        description:
          'Qué se archiva: "correo" (por defecto) guarda el correo entero en .eml, con sus '
          + 'adjuntos dentro y buscables; "adjunto" saca a fichero suelto un adjunto concreto; '
          + '"todo" hace las dos cosas.',
        default: 'correo',
      },
      adjunto: { type: 'string', description: 'Nombre (o parte) del adjunto, cuando "que" es "adjunto" o "todo". Si se omite, el primero.' },
      numero: { type: 'integer', description: 'Alternativa al nombre: posición del adjunto en la lista de leer_correo, empezando por 1.', minimum: 1 },
      expediente: { type: 'string', description: 'Expediente destino. Si se omite, el activo de la sesión; si no hay ninguno, se pide (nunca se adivina).' },
      subcarpeta: {
        type: 'string',
        description:
          `Subcarpeta del expediente donde dejarlo. Por defecto «${archivo.CARPETA_COMUNICACIONES}», `
          + 'que es donde vive la correspondencia del caso.',
      },
      confirmar: { type: 'boolean', description: 'Tiene que ser true para que se escriba algo. Sin esto solo se devuelve qué se haría y dónde.', default: false },
      aunque_este_repetido: { type: 'boolean', description: 'Guardarlo aunque ese mismo contenido ya esté en el expediente con otro nombre.', default: false },
    },
    required: ['uid'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

const quienEs = (d) => (d?.name && d?.address ? `${d.name} <${d.address}>` : (d?.address || d?.name || 'remitente desconocido'));
// Para la frase de confirmación: el nombre a secas si lo hay («Suministros Vidal»), que es como
// el abogado reconoce a quién pertenece un correo.
const quienCorto = (d) => d?.name || d?.address || 'remitente desconocido';

async function bandejaReal(carpetas, cliente, pedida) {
  const p = String(pedida || '').trim().toLowerCase();
  if (!p || ['entrada', 'inbox', 'bandeja de entrada', 'recibidos'].includes(p)) return 'INBOX';
  if (['enviados', 'sent'].includes(p)) return (await carpetas.resolver(cliente, 'enviados')) || 'INBOX';
  if (['borradores', 'drafts'].includes(p)) return (await carpetas.resolver(cliente, 'borradores')) || 'INBOX';
  return String(pedida).trim();
}

function elegirAdjunto(adjuntos, args) {
  if (Number.isFinite(parseInt(args?.numero, 10))) return adjuntos[parseInt(args.numero, 10) - 1];
  if (args?.adjunto) {
    const buscado = String(args.adjunto).toLowerCase();
    return adjuntos.find((a) => a.nombre.toLowerCase() === buscado)
      || adjuntos.find((a) => a.nombre.toLowerCase().includes(buscado));
  }
  return adjuntos[0];
}

// Que lo archivado se pueda buscar YA, sin esperar al vigilante ni al repaso periódico: el
// abogado acaba de archivarlo y lo siguiente que hará es buscarlo. Que falle el indexado no
// invalida el archivo: el fichero está en su carpeta y el repaso lo recogerá.
async function indexarAhora(rutas) {
  const salida = [];
  try {
    const { indexFile } = await import('../indexer/indexer.js');
    for (const abs of rutas) {
      try {
        const r = await indexFile(abs, { force: false });
        salida.push({ ruta: logicalPath(abs), estado: r?.estado ?? 'desconocido' });
      } catch (err) {
        log.warn('Archivado pero sin indexar', { code: err?.code || null });
        salida.push({ ruta: logicalPath(abs), estado: 'pendiente_de_indexar' });
      }
    }
  } catch {
    for (const abs of rutas) salida.push({ ruta: logicalPath(abs), estado: 'pendiente_de_indexar' });
  }
  return salida;
}

export async function handler(args) {
  const auth = await ensureAuthorized();
  if (!auth.ok) return authPromptResult(auth.loginUrl);

  const cfg = leerCorreo();
  if (!cfg.configurado) return fail(SIN_CUENTA, { motivo: 'sin_cuenta' });

  const uid = parseInt(args?.uid, 10);
  if (!Number.isFinite(uid) || uid <= 0) return fail('Falta el "uid" del correo (lo da buscar_correos).');

  const que = ['correo', 'adjunto', 'todo'].includes(args?.que) ? args.que : 'correo';

  // El expediente destino, con la misma política de aislamiento que la búsqueda: si no hay
  // activo y no se indica ninguno, se PIDE. Adivinar dónde va la correspondencia de un cliente
  // es exactamente el error que no puede ocurrir.
  const puerta = expedientes.exigirExpediente(args?.expediente || null);
  if (!puerta.ok) {
    return fail(
      `${puerta.error} Para archivar un correo hay que saber en qué expediente va: dímelo o `
      + 'fíjalo con establecer_expediente_activo.',
      { ...puerta.extra, motivo: 'sin_expediente' },
    );
  }
  const expediente = puerta.expediente;
  const raizExpediente = expedientes.rutaAbsoluta(expediente);
  if (!raizExpediente) {
    return fail(
      `El expediente «${expediente}» no se corresponde con ninguna carpeta del disco, así que no `
      + 'hay dónde archivar. Elige un expediente que sea una carpeta de las vigiladas.',
      { motivo: 'sin_carpeta' },
    );
  }

  const sub = String(args?.subcarpeta ?? archivo.CARPETA_COMUNICACIONES).trim();
  // La subcarpeta la propone quien llama: se limpia y se comprueba que el destino sigue DENTRO
  // del expediente. Ni «..», ni rutas absolutas, ni salir por un enlace.
  const partes = sub.replace(/\\/g, '/').split('/').map((x) => x.trim())
    // «..» y «.» se TIRAN, no se sanean: sanearlos convertiría «../../..» en tres subcarpetas
    // absurdas dentro del expediente en vez de en lo que el abogado quería decir (nada).
    .filter((x) => x && x !== '.' && x !== '..')
    .map((x) => archivo.nombreSeguro(x, { max: 80, porDefecto: archivo.CARPETA_COMUNICACIONES }));
  const carpetaDestino = partes.length ? path.join(raizExpediente, ...partes) : raizExpediente;
  const { rutas: rutasUtil } = await import('../rutas.js');
  if (!rutasUtil.dentroDe(carpetaDestino, raizExpediente)) {
    return fail('La subcarpeta indicada se sale de la carpeta del expediente.', { motivo: 'destino_invalido' });
  }
  const destinoLegible = partes.length ? `${expediente}/${partes.join('/')}` : expediente;

  const { conImap } = await import('../correo/conexion.js');
  const carpetas = await import('../correo/carpetas.js');
  const mensajes = await import('../correo/mensajes.js');

  try {
    return await conImap(async (cliente) => {
      const ruta = await bandejaReal(carpetas, cliente, args?.bandeja);
      const cerrojo = await cliente.getMailboxLock(ruta, { readOnly: true });
      try {
        const meta = await cliente.fetchOne(String(uid), { envelope: true, bodyStructure: true, size: true }, { uid: true });
        if (!meta) return fail(`En «${ruta}» no hay ningún correo con uid ${uid}. Puede que se haya movido o borrado; vuelve a buscarlo.`, { motivo: 'no_encontrado' });

        const sobre = mensajes.sobre(meta.envelope);
        const remitente = (meta.envelope?.from || [])[0] || null;
        const adjuntos = mensajes.adjuntosDe(meta.bodyStructure);

        let elegido = null;
        if (que !== 'correo') {
          if (!adjuntos.length) {
            return fail(
              'Ese correo no trae ningún adjunto que sacar. Si lo que quieres es dejar el correo en '
              + 'el expediente, llámala con "que": "correo".',
              { motivo: 'sin_adjuntos' },
            );
          }
          elegido = elegirAdjunto(adjuntos, args);
          if (!elegido) {
            return fail(
              `En ese correo no hay ningún adjunto que se llame así. Los que trae son: ${adjuntos.map((a) => a.nombre).join(', ')}.`,
              { motivo: 'no_encontrado' },
            );
          }
          if (!elegido.parte) return fail('Ese adjunto no se puede localizar dentro del correo.', { motivo: 'no_encontrado' });
        }

        const nombreCorreo = archivo.nombreParaCorreo({
          fecha: meta.envelope?.date ? new Date(meta.envelope.date) : null,
          de: quienCorto(remitente),
          asunto: sobre.asunto,
        });

        // ── Sin confirmar: se enseña exactamente lo que se haría, y no se toca el disco ──
        if (args?.confirmar !== true) {
          const queFrase = que === 'correo'
            ? `el correo «${sobre.asunto}»`
            : (que === 'adjunto' ? `«${elegido.nombre}»` : `el correo «${sobre.asunto}» y su adjunto «${elegido.nombre}»`);
          return ok({
            confirmacion_pendiente: true,
            // La frase que hay que enseñarle al abogado TAL CUAL: remitente y expediente destino
            // juntos, para que un cruce de clientes se vea antes de confirmar y no después.
            pregunta: `¿Guardo ${queFrase}, de ${quienCorto(remitente)}, en el expediente «${expediente}»?`,
            uid,
            bandeja: ruta,
            de: quienEs(remitente),
            asunto: sobre.asunto,
            fecha: sobre.fecha,
            expediente_destino: expediente,
            carpeta_destino: destinoLegible,
            se_escribiria: que === 'correo'
              ? [nombreCorreo]
              : (que === 'adjunto' ? [elegido.nombre] : [nombreCorreo, elegido.nombre]),
            adjuntos_del_correo: adjuntos.map((a) => ({ nombre: a.nombre, tipo: a.tipo, bytes: a.bytes })),
            bytes_del_correo: meta.size || 0,
            // Archivar exige bajarse el correo ENTERO (para eso es el original). Con un escaneado
            // de 40 MB al otro lado de la línea del despacho, eso se nota: mejor decirlo antes.
            aviso_tamano: (meta.size || 0) > 10 * 1024 * 1024
              ? `Este correo ocupa ${((meta.size || 0) / 1048576).toFixed(1)} MB y hay que descargarlo entero para archivarlo: puede tardar.`
              : null,
            nota: que === 'correo' && adjuntos.length
              ? 'Al archivar el correo, sus adjuntos quedan dentro del .eml y se indexan con él: se '
                + 'podrá buscar por su contenido sin sacarlos a ficheros sueltos. Si el abogado quiere '
                + 'además el fichero suelto, vuelve a llamarla con "que": "todo".'
              : null,
            para_confirmar: 'Vuelve a llamar a archivar_correo con los mismos datos y "confirmar": true.',
          });
        }

        // ── Confirmado: se baja lo que haga falta y se escribe ──
        const escritos = [];
        const repetidos = [];

        const bajar = async (parte) => {
          const { content } = await cliente.download(String(uid), parte, { uid: true });
          const trozos = [];
          for await (const t of content) trozos.push(t);
          return Buffer.concat(trozos);
        };

        const guardar = (contenido, nombre) => {
          const sha = archivo.huellaContenido(contenido);
          const ya = args?.aunque_este_repetido === true
            ? null
            : archivo.yaGuardado(sha, { expediente, carpeta: raizExpediente, bytes: contenido.length });
          if (ya) {
            repetidos.push({
              nombre,
              ya_guardado_como: ya.rutaRelativa || path.basename(ya.ruta),
              ruta: ya.ruta,
            });
            return null;
          }
          const abs = archivo.escribirSinPisar(carpetaDestino, nombre, contenido);
          const limite = limiteBytes(path.extname(abs).toLowerCase());
          escritos.push({
            fichero: path.basename(abs),
            ruta: logicalPath(abs),
            bytes: contenido.length,
            // Honestidad por delante: si pesa más de lo que el indexador admite, el fichero está
            // guardado pero NO se va a poder buscar, y el abogado tiene que saberlo.
            se_indexara: contenido.length <= limite,
          });
          return abs;
        };

        if (que === 'correo' || que === 'todo') {
          guardar(await bajar(undefined), nombreCorreo);
        }
        if (que === 'adjunto' || que === 'todo') {
          guardar(await bajar(elegido.parte), elegido.nombre);
        }

        const indexado = await indexarAhora(escritos.filter((e) => e.se_indexara).map((e) => path.join(carpetaDestino, e.fichero)));
        const sinIndexar = escritos.filter((e) => !e.se_indexara);

        return ok({
          archivado: escritos.length > 0,
          uid,
          de: quienEs(remitente),
          asunto: sobre.asunto,
          expediente_destino: expediente,
          carpeta_destino: destinoLegible,
          ficheros: escritos,
          ya_estaban: repetidos,
          indexado,
          nota: [
            escritos.length
              ? `Guardado en «${destinoLegible}»: ${escritos.map((e) => e.fichero).join(', ')}. Ya forma parte del `
                + 'expediente y buscar_documentos lo alcanza como a cualquier otro documento.'
              : null,
            repetidos.length
              ? `Esto ya estaba en el expediente, con el mismo contenido: ${repetidos.map((r) => `«${r.nombre}» está guardado como «${r.ya_guardado_como}»`).join('; ')}. `
                + 'No se ha dejado una copia repetida. Si aun así el abogado la quiere, vuelve a llamarla con "aunque_este_repetido": true.'
              : null,
            sinIndexar.length
              ? `Ojo: ${sinIndexar.map((e) => `«${e.fichero}»`).join(', ')} pesa más de lo que RobinSearch indexa, `
                + 'así que está guardado en la carpeta pero no se podrá buscar por su contenido.'
              : null,
          ].filter(Boolean).join(' ') || 'No se ha escrito nada.',
        });
      } finally {
        cerrojo.release();
      }
    });
  } catch (err) {
    return fail(err?.message || 'No se ha podido archivar el correo.', { motivo: err?.motivo || 'error' });
  }
}

export default { definition, handler };
