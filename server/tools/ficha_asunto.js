// ficha_asunto — la ficha de estado de cada asunto que lleva el director de asunto («Hola Robin»,
// despacho agéntico, fase 1; documento de Juan del 12-oct-2026). La lógica y sus reglas están en
// server/asuntos.js; aquí solo se exponen las acciones.

import * as asuntos from '../asuntos.js';
import * as expedientes from '../expedientes.js';
import { fijarSeleccion } from '../seleccion.js';
import { ok, fail } from './util.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

const ACCIONES = ['listar', 'leer', 'crear', 'activar', 'actualizar', 'resolver_puerta', 'anotar_decision', 'cerrar', 'reabrir'];

const lista = (descripcion) => ({ type: 'array', items: { type: 'string' }, description: descripcion });

export const definition = {
  name: 'ficha_asunto',
  title: 'Ficha de estado del asunto (director de asunto)',
  description:
    'La ficha de estado de cada ASUNTO que dirige Robin: en qué fase está (0 Entrada, 1 Expediente, ' +
    '2 Diagnóstico y plan, 3 Escritos, 4 Revisión cruzada, 5 Pre-mortem, 6 Informe al equipo, 7 ' +
    'Informe al cliente, 8 Cambios), qué puerta espera la decisión del abogado, sus decisiones, ' +
    'plazos, escritos y riesgos aceptados. Un asunto reúne UNA O VARIAS carpetas del expediente y ' +
    'solo hay uno activo a la vez: "activar" fija como selección de trabajo exactamente sus carpetas ' +
    'y devuelve qué ha cambiado en ellas desde la última sesión. Acciones: "listar" (los asuntos ' +
    'abiertos, el más reciente primero), "leer", "crear" (nombre + carpetas_expediente), "activar", ' +
    '"actualizar" (objetivo, posición, hito, orden, plazos, escritos, carpetas, puerta pendiente), ' +
    '"resolver_puerta" (la ÚNICA forma de cambiar de fase: exige "decision" con las palabras del ' +
    'abogado y queda registrada), "anotar_decision" (una decisión sin cambio de fase), "cerrar" y ' +
    '"reabrir". Nunca resuelvas una puerta por el abogado ni inventes su decisión. Todo se guarda en ' +
    'este ordenador; la ficha no copia documentos del cliente.',
  inputSchema: {
    type: 'object',
    properties: {
      accion: { type: 'string', enum: ACCIONES, description: 'Qué hacer. Por defecto "listar".' },
      asunto_id: { type: 'string', description: 'El asunto. Si se omite, el activo.' },
      nombre: { type: 'string', description: 'Título corto del asunto (crear/actualizar).' },
      carpetas_expediente: {
        anyOf: [{ type: 'string' }, lista('Carpetas')],
        description:
          'Carpeta o carpetas del expediente (nombre, ruta o slug, como en establecer_expediente_activo). ' +
          'Cada una incluye sus subcarpetas.',
      },
      orden: { type: 'string', enum: asuntos.ORDENES },
      objetivo_cliente: { type: 'string', description: 'Lo que quiere conseguir el cliente, en una frase.' },
      posicion: { type: 'string', enum: asuntos.POSICIONES },
      hito_procesal: {
        type: 'object',
        properties: { descripcion: { type: 'string' }, fecha: { type: 'string', description: 'AAAA-MM-DD' } },
        description: 'Punto en que está el asunto (p. ej. resolución notificada) y su fecha.',
      },
      plazos: {
        type: 'array',
        description:
          'Lista COMPLETA de plazos del asunto (sustituye a la anterior). Solo es firme el que trae ' +
          '"herramienta": "calculo_plazos" (o plazos/deposito_recurso).',
        items: {
          type: 'object',
          properties: {
            fecha: { type: 'string', description: 'AAAA-MM-DD' },
            tipo: { type: 'string' },
            descripcion: { type: 'string' },
            herramienta: { type: 'string' },
          },
          required: ['fecha'],
        },
      },
      escritos: {
        type: 'array',
        description:
          'Lista COMPLETA de escritos (sustituye a la anterior). Pasar uno a "validado" o "enviado" ' +
          'exige "decision".',
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string' },
            version: { type: 'integer' },
            estado: { type: 'string', enum: asuntos.ESTADOS_ESCRITO },
            ruta: { type: 'string' },
          },
          required: ['titulo'],
        },
      },
      puerta_pendiente: { type: 'string', description: 'Qué se espera del abogado ahora.' },
      decision: {
        type: 'string',
        description: 'Lo que ha decidido el abogado, con SUS palabras (resolver_puerta, anotar_decision, cerrar, reabrir).',
      },
      fase_siguiente: { type: 'integer', minimum: 0, maximum: 8, description: 'resolver_puerta: fase a la que pasa (menor que la actual = reabrir).' },
      puerta_siguiente: { type: 'string', description: 'resolver_puerta: la puerta de la fase siguiente, si no es la de por defecto.' },
      riesgos_aceptados: lista('resolver_puerta (pre-mortem): los riesgos que el abogado acepta.'),
      motivo_reapertura: { type: 'string', description: 'resolver_puerta al reabrir: el cambio que lo motiva.' },
      puerta: { type: 'string', description: 'anotar_decision: a qué pregunta responde la decisión.' },
      prompts_abogado: {
        type: 'integer',
        minimum: 0,
        description:
          'resolver_puerta: cuántos mensajes escribió el abogado POR SU CUENTA desde la puerta anterior ' +
          '(sin contar sus respuestas a tus preguntas). Es la medida de éxito del director.',
      },
      correccion: { type: 'boolean', description: 'resolver_puerta: true si el abogado corrigió o rechazó lo propuesto.' },
      incluir_cerrados: { type: 'boolean', default: false },
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const SIGUIENTE = [
  'Pregunta al abogado si retoma un asunto reciente o abre uno nuevo.',
  'Confirma con el abogado objetivo, posición, hito procesal y carpetas (cuatro preguntas como máximo, con opciones) y resuelve la puerta.',
  'Prepara el diagnóstico y el plan de actuación con plazos y pide al abogado que lo valide.',
  'Antes de redactar, pregunta la vía procesal (con la consecuencia de cada una); redacta los escritos del plan y pide validar cada uno.',
  'Contrasta citas (verificar_cita), plazos y coherencia con el expediente y pide al abogado qué correcciones aplicar.',
  'Lista las formas en que puede salir mal y su riesgo, y pide al abogado decidir con el riesgo a la vista.',
  'Prepara el informe al equipo y pide aprobarlo.',
  'Prepara el informe al cliente y pide aprobarlo; enviarlo exige aprobación expresa cada vez.',
  'Explica el cambio detectado y su riesgo, y pregunta si se reabre el paso afectado.',
];

export async function handler(args = {}) {
  const auth = await ensureAuthorized();
  if (!auth.ok) return authPromptResult(auth.loginUrl, auth);

  const accion = String(args.accion || 'listar').toLowerCase();
  if (!ACCIONES.includes(accion)) return fail(`Acción no válida: ${accion}`, { acciones: ACCIONES });

  let r;
  try {
    switch (accion) {
      case 'listar':
        r = asuntos.listar({ incluirCerrados: args.incluir_cerrados === true });
        break;
      case 'leer':
        r = asuntos.leer(args.asunto_id);
        break;
      case 'crear': {
        r = asuntos.crear(args);
        if (r.ok) {
          // Crear es abrirlo: queda activo, con sus carpetas como selección.
          r = await asuntos.activar(r.asunto.asunto_id, { fijarSeleccion });
          if (r.ok) r.creado = true;
        }
        break;
      }
      case 'activar':
        r = await asuntos.activar(args.asunto_id, { fijarSeleccion });
        break;
      case 'actualizar':
        r = await asuntos.actualizar(args.asunto_id, args, { fijarSeleccion });
        break;
      case 'resolver_puerta':
        r = asuntos.resolverPuerta(args.asunto_id, args);
        break;
      case 'anotar_decision':
        r = asuntos.anotarDecision(args.asunto_id, args);
        break;
      case 'cerrar':
        r = asuntos.cerrar(args.asunto_id, { decision: args.decision, alCerrarActivo: () => expedientes.setActivo(null) });
        break;
      case 'reabrir':
        r = asuntos.reabrir(args.asunto_id, { decision: args.decision });
        break;
      default:
        r = { ok: false, error: 'acción no implementada' };
    }
  } catch (err) {
    return fail(`No se ha podido guardar la ficha del asunto: ${err?.message || err}`);
  }

  if (!r.ok) return fail(r.error, r.extra || {});
  const { ok: _ok, ...datos } = r;
  const fase = datos.asunto?.fase_director?.numero;
  if (Number.isInteger(fase)) {
    datos.siguiente_paso = SIGUIENTE[fase];
    datos.ficha_legible = asuntos.rutaEspejo(datos.asunto.asunto_id);
  }
  if (accion === 'activar' || accion === 'crear') {
    datos.pasa_en_cada_llamada = { expediente: datos.seleccion?.expediente_activo ?? null };
  }
  return ok(datos);
}

export default { definition, handler };
