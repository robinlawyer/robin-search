// cambios_expediente — el «vigilante de data room» (P6 del informe de Juan, 1-oct-2026).
//
// Una operación viva de M&A no tiene un data room quieto: entran documentos nuevos y versiones
// nuevas de los que ya había. RobinSearch vigila las carpetas y los indexa solos; esta tool dice
// QUÉ ha cambiado respecto de lo ya revisado con el barrido (siguiente_por_revisar + anotar):
// nuevos, modificados (sus fichas viejas ya no valen), a medias, retirados y sin texto legible.
// Es local por diseño: el delta sale del índice y del ledger del propio equipo, nada de un
// proveedor de VDR ni de la nube.

import * as expedientes from '../expedientes.js';
import * as anotaciones from '../anotaciones.js';
import { ok, fail } from './util.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

export const definition = {
  name: 'cambios_expediente',
  title: 'Qué ha cambiado en el expediente desde la última revisión',
  description:
    'Delta del expediente (data room vivo) respecto de lo ya revisado con el barrido: documentos ' +
    'NUEVOS, MODIFICADOS en disco después de revisarlos (sus fichas ya no valen), revisados A ' +
    'MEDIAS, RETIRADOS del índice y llegados SIN TEXTO legible. Por defecto compara con el último ' +
    'barrido completo; con "desde" (AAAA-MM-DD), con esa fecha. Úsala en una due diligence en ' +
    'curso para saber qué falta por revisar y, después, sigue con siguiente_por_revisar: solo te ' +
    'servirá lo nuevo y lo cambiado. Aparte, en la PRIMERA consulta sobre un expediente tras una ' +
    'pausa, la respuesta de cualquier herramienta trae "cambios_desde_tu_ultima_consulta" ' +
    '(nuevos, modificados y retirados desde la consulta anterior): díselo al abogado antes de ' +
    'contestar, una sola vez.',
  inputSchema: {
    type: 'object',
    properties: {
      expediente: { type: 'string', description: 'Expediente. Si se omite, el activo de la sesión.' },
      desde: {
        type: 'string',
        description: 'Opcional: fecha de referencia AAAA-MM-DD. Por defecto, el último barrido completo.',
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handler(args) {
  const auth = await ensureAuthorized();
  if (!auth.ok) return authPromptResult(auth.loginUrl);

  const gate = expedientes.exigirExpediente(args?.expediente ?? null);
  if (!gate.ok) return fail(gate.error, gate.extra);
  const expediente = gate.expediente;

  const d = anotaciones.delta(expediente, { desde: args?.desde || null });
  if (!d.ok) return fail(d.error);
  const recuento = {
    nuevos: d.nuevos.length,
    modificados: d.modificados.length,
    a_medias: d.a_medias.length,
    retirados: d.retirados.length,
    sin_texto: d.sin_texto.length,
  };
  const pasos = [];
  if (!d.hay_barrido) {
    pasos.push(
      'Este expediente aún no tiene barrido: todo es nuevo. Empieza la revisión con ' +
        'siguiente_por_revisar.',
    );
  } else if (d.hay_cambios) {
    if (recuento.nuevos || recuento.modificados || recuento.a_medias) {
      pasos.push(
        'Para revisar lo nuevo y lo cambiado, sigue con siguiente_por_revisar: ya no te dará lo ' +
          'que estaba revisado y no ha cambiado. Al terminar, rehaz la síntesis con ' +
          'obtener_anotaciones (sobre todo los documentos modificados: compara la versión nueva ' +
          'con lo que decía la anterior).',
      );
    }
    if (recuento.retirados) {
      pasos.push(
        'Hay documentos retirados del data room que ya estaban revisados: dilo en el informe ' +
          '(una retirada es en sí misma un hallazgo) y no cites sus fichas como vigentes.',
      );
    }
    if (recuento.sin_texto) {
      pasos.push('Los documentos sin texto legible son zona ciega: pide OCR o una versión en texto.');
    }
  } else {
    pasos.push('Sin cambios respecto de la referencia: el barrido sigue al día.');
  }
  return ok({
    expediente,
    referencia: d.referencia,
    ultima_revision_completa: d.ultima_revision_completa,
    recuento,
    nuevos: d.nuevos,
    modificados: d.modificados,
    a_medias: d.a_medias,
    retirados: d.retirados,
    sin_texto: d.sin_texto,
    siguiente_paso: pasos.join(' '),
    nota:
      'RobinSearch vigila las carpetas e indexa solo lo que llega. Si acabas de copiar ficheros, ' +
      'comprueba con estado_servidor que el indexado ha terminado antes de fiarte del delta.',
  });
}

export default { definition, handler };
