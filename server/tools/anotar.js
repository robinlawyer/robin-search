// anotar — guarda la ficha de una ventana ya leída. Es la mitad que escribe del barrido
// exhaustivo (la otra es siguiente_por_revisar).
//
// La ficha NO es un resumen. Un resumen no sirve para una due diligence: «este documento
// trata de un contrato de obra» no permite detectar nada. Lo que hace útil el barrido es
// extraer HECHOS con su página, porque una contradicción se ve cruzando hechos —dos fechas
// de entrega distintas para la misma obligación— y no comparando resúmenes. Por eso los
// campos de la ficha son listas de hechos, y por eso cada hecho lleva su página: para poder
// volver al original y citarlo.

import * as expedientes from '../expedientes.js';
import * as anotaciones from '../anotaciones.js';
import { ok, fail } from './util.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

const hechoConPagina = (descripcion, campos) => ({
  type: 'object',
  description: descripcion,
  properties: {
    ...campos,
    pagina: { type: 'integer', description: 'Página donde consta. Imprescindible para poder citarlo.' },
  },
});

export const definition = {
  name: 'anotar',
  title: 'Anotar la ventana revisada',
  description:
    'Guarda la ficha de la ventana que acabas de leer con siguiente_por_revisar, y devuelve el ' +
    'progreso del barrido. NO escribas un resumen: extrae HECHOS con su página (fechas, ' +
    'importes, obligaciones, afirmaciones, cláusulas atípicas). Las contradicciones de una due ' +
    'diligence se detectan cruzando hechos entre documentos, no comparando resúmenes: lo que no ' +
    'anotes aquí no existirá en la síntesis. Ante la duda, anota de más. Si algo queda sin ' +
    'aclarar en esta ventana, dilo en "pendiente".',
  inputSchema: {
    type: 'object',
    properties: {
      doc_id: { type: 'string', description: 'El doc_id que devolvió siguiente_por_revisar.' },
      desde_fragmento: {
        type: 'integer',
        description: 'El desde_fragmento que devolvió siguiente_por_revisar (identifica la ventana).',
      },
      expediente: { type: 'string', description: 'Expediente. Si se omite, el activo de la sesión.' },
      resumen: {
        type: 'string',
        description: 'Dos o tres líneas: qué es este trozo y para qué sirve en el caso.',
      },
      tipo_documento: {
        type: 'string',
        description: 'Contrato, escritura, correo, factura, informe pericial, resolución…',
      },
      partes: {
        type: 'array',
        description: 'Personas y entidades que aparecen, con el papel que juegan.',
        items: hechoConPagina('Una parte interviniente.', {
          nombre: { type: 'string' },
          papel: { type: 'string', description: 'Vendedor, arrendatario, avalista, perito…' },
        }),
      },
      fechas: {
        type: 'array',
        description: 'Fechas relevantes y QUÉ pasa en cada una. Cruzarlas revela incoherencias de calendario.',
        items: hechoConPagina('Una fecha con su hecho.', {
          fecha: { type: 'string' },
          que: { type: 'string', description: 'Qué ocurre o vence en esa fecha.' },
        }),
      },
      importes: {
        type: 'array',
        description: 'Cantidades económicas con su concepto. Cruzarlas revela descuadres.',
        items: hechoConPagina('Un importe con su concepto.', {
          importe: { type: 'string' },
          concepto: { type: 'string' },
        }),
      },
      obligaciones: {
        type: 'array',
        description: 'Quién se obliga a qué y con qué plazo o condición.',
        items: hechoConPagina('Una obligación.', {
          quien: { type: 'string' },
          que: { type: 'string' },
          plazo: { type: 'string' },
        }),
      },
      afirmaciones: {
        type: 'array',
        description:
          'EL CAMPO CLAVE. Afirmaciones concretas y verificables que hace este documento ' +
          '(«el plazo de entrega es el 30/06/2024», «la finca está libre de cargas»). Son las ' +
          'que, cruzadas con las de otros documentos, hacen saltar las contradicciones.',
        items: hechoConPagina('Una afirmación concreta.', { afirmacion: { type: 'string' } }),
      },
      clausulas_atipicas: {
        type: 'array',
        description: 'Cláusulas que se salen de lo estándar, o que desplazan riesgo de forma llamativa.',
        items: hechoConPagina('Una cláusula atípica.', {
          clausula: { type: 'string' },
          por_que: { type: 'string', description: 'Por qué llama la atención.' },
        }),
      },
      alertas: {
        type: 'array',
        description:
          'Lo que un abogado querría ver marcado en rojo: contradicción aparente, documento ' +
          'incompleto, firma o fecha que falta, plazo vencido, remisión a un anexo que no está.',
        items: hechoConPagina('Una alerta.', {
          tipo: { type: 'string' },
          detalle: { type: 'string' },
        }),
      },
      pendiente: {
        type: 'string',
        description:
          'Lo que NO has podido determinar en esta ventana (texto cortado, remisión a otro ' +
          'documento, letra ilegible). Se conserva para la síntesis: es tan importante como lo que sí.',
      },
    },
    required: ['doc_id', 'desde_fragmento', 'resumen'],
  },
  annotations: {
    readOnlyHint: false,
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

  const docId = args?.doc_id;
  const desde = Number(args?.desde_fragmento);
  if (!docId) return fail('Se requiere "doc_id" (el que devolvió siguiente_por_revisar).');
  if (!Number.isFinite(desde)) return fail('Se requiere "desde_fragmento" (entero).');
  const resumen = String(args?.resumen || '').trim();
  if (!resumen) return fail('Se requiere "resumen": qué es este trozo y para qué sirve en el caso.');

  const ficha = { resumen };
  if (args?.tipo_documento) ficha.tipo_documento = args.tipo_documento;
  for (const campo of anotaciones.CAMPOS_CRUZABLES) {
    if (Array.isArray(args?.[campo]) && args[campo].length) ficha[campo] = args[campo];
  }
  if (args?.pendiente) ficha.pendiente = args.pendiente;

  const res = anotaciones.guardar(expediente, docId, desde, ficha);
  if (!res.ok) return fail(res.error);

  const estado = anotaciones.estadoBarrido(expediente);
  const hechos = anotaciones.CAMPOS_CRUZABLES.reduce(
    (n, c) => n + (Array.isArray(ficha[c]) ? ficha[c].length : 0),
    0,
  );

  return ok({
    guardada: true,
    documento: res.ventana.ruta_relativa,
    desde_fragmento: desde,
    hechos_anotados: hechos,
    ventanas_totales: estado.ventanas_totales,
    ventanas_revisadas: estado.ventanas_revisadas,
    ventanas_pendientes: estado.ventanas_pendientes,
    cobertura: estado.cobertura,
    completado: estado.completado,
    siguiente_paso: estado.completado
      ? 'Barrido completo. Llama a obtener_anotaciones para la síntesis.'
      : 'Llama otra vez a siguiente_por_revisar para continuar.',
    ...(hechos === 0
      ? {
          aviso:
            'Esta ficha no contiene ningún hecho cruzable (solo resumen). Si la ventana tenía ' +
            'fechas, importes, obligaciones o afirmaciones, anótalos: la síntesis solo podrá ' +
            'cruzar lo que quede aquí escrito.',
        }
      : {}),
  });
}

export default { definition, handler };
