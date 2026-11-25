// elegir_expediente — abre la ventana de carpetas del sistema (Finder / Explorador / zenity) en la
// carpeta de expedientes para que el abogado ELIJA con un clic en qué expediente trabajar, sin
// escribir ni pegar rutas (propuesta de Juan, 1-oct-2026: «Hola Robin» en una conversación nueva →
// «¿en qué carpeta trabajamos?» → se elige en el Finder).
//
// Solo se acepta lo que RobinSearch vigila y tiene indexado. Lo elegido no sale del ordenador: a
// Claude solo vuelve el nombre del expediente y sus contadores.
//
// Claude corta las llamadas que tardan; el abogado puede tardar más en elegir. Por eso se espera
// como mucho ESPERA_DIALOGO_MS: si aún no ha elegido, la ventana SIGUE abierta, se responde
// «pendiente» y la siguiente llamada recoge la misma elección (no abre otra ventana).

import path from 'node:path';
import crypto from 'node:crypto';
import { ok, fail } from './util.js';
import { config } from '../config.js';
import { state } from '../state.js';
import * as expedientes from '../expedientes.js';
import { fijarSeleccion } from '../seleccion.js';
import { elegirCarpetas, admiteVarias } from '../dialogo-carpeta.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

const ESPERA_DIALOGO_MS = Number(process.env.ROBIN_ESPERA_DIALOGO_MS) || 45000;
// Una elección que nadie recoge (la conversación se fue a otra cosa) caduca: no se aplica horas después.
const CADUCIDAD_ELECCION_MS = 10 * 60 * 1000;

let enCurso = null; // { promesa, opciones, desde }
let sinRecoger = null; // { resultado, opciones, hasta }
// Elección heredada a la espera de que el abogado confirme que es la de ESTA conversación. Se
// confirma con el código, nunca volviendo a escribir el nombre: si la carpeta desaparece, un nombre
// parecido podría resolverse a la de otro cliente (revisión de Codex, 25-nov).
// Una entrada por elección: confirmar una no invalida otra pendiente (revisión de Codex, 6.ª ronda).
const porConfirmar = new Map(); // codigo → { clave, ids, hasta }

export const definition = {
  name: 'elegir_expediente',
  title: 'Elegir el expediente en la ventana de carpetas',
  description:
    'Abre en el ordenador del abogado la ventana del sistema para elegir carpeta (Finder en Mac, ' +
    'Explorador en Windows), ya situada en su carpeta de expedientes, y fija como expediente activo ' +
    'el que elija. Úsala cuando haya que saber en qué expediente trabajar y el abogado no haya dado ' +
    'un nombre: al empezar una conversación nueva sobre sus documentos o cuando diga «Hola Robin» ' +
    'ya configurado. Avísale ANTES en una frase («te abro la ventana para que elijas la carpeta»). ' +
    'Solo acepta carpetas que RobinSearch vigila y tiene indexadas. Con "varias": true puede ' +
    'elegir varias carpetas a la vez (en Windows, de una en una con "anadir": true). Si devuelve ' +
    '"pendiente", la ventana sigue abierta: vuelve a llamarla para recoger la elección. Si la ' +
    'ventana no se puede abrir o el abogado la cierra, enséñale la lista expedientes_disponibles ' +
    'y fija el que diga con establecer_expediente_activo.',
  inputSchema: {
    type: 'object',
    properties: {
      varias: {
        type: 'boolean',
        description: 'Permitir elegir varias carpetas a la vez (expedientes separados para el mismo trabajo).',
        default: false,
      },
      anadir: {
        type: 'boolean',
        description: 'Sumar lo elegido a los expedientes ya seleccionados en vez de sustituirlos. Exige "seleccion_actual".',
        default: false,
      },
      seleccion_actual: {
        type: ['string', 'array'],
        items: { type: 'string' },
        description: 'Con "anadir": la selección que tiene ESTA conversación (la de "pasa_en_cada_llamada" de la última respuesta).',
      },
      confirmar: {
        type: 'string',
        description: 'El código "confirmar" que devolvió una respuesta con "pendiente_de_confirmar", cuando el abogado ha dicho que esa carpeta es la de esta conversación.',
      },
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

function carpetaInicial() {
  const roots = config.roots || [];
  if (roots.length === 1) return roots[0].path;
  // Con varias carpetas vigiladas, la que las contiene a todas si la hay; si no, la primera.
  if (roots.length > 1) {
    const partes = roots.map((r) => path.resolve(r.path).split(path.sep));
    const comun = [];
    for (let i = 0; i < Math.min(...partes.map((p) => p.length)); i += 1) {
      const s = partes[0][i];
      if (partes.every((p) => p[i] === s)) comun.push(s);
      else break;
    }
    const base = comun.join(path.sep);
    return base && base !== path.parse(base).root ? base : roots[0].path;
  }
  return null;
}

function disponibles() {
  return expedientes.catalogo()
    .filter((e) => e.documentos > 0)
    .map((e) => ({ expediente: e.expediente, documentos: e.documentos }));
}

function abrir(opciones) {
  const ficha = { opciones, desde: Date.now() };
  ficha.promesa = elegirCarpetas({
    inicial: carpetaInicial(),
    titulo: opciones.varias ? 'RobinSearch — elige las carpetas de los expedientes' : 'RobinSearch — elige la carpeta del expediente',
    varias: opciones.varias && admiteVarias(),
  }).then((resultado) => {
    // Si la llamada que la abrió ya contestó «pendiente», la elección espera a la siguiente.
    if (enCurso === ficha) {
      enCurso = null;
      sinRecoger = { resultado, opciones, hasta: Date.now() + CADUCIDAD_ELECCION_MS };
    }
    return resultado;
  });
  enCurso = ficha;
  return ficha;
}

async function aplicar(resultado, opciones, { heredada = false } = {}) {
  if (resultado.estado === 'cancelado') {
    return ok({
      cancelado: true,
      mensaje:
        'El abogado ha cerrado la ventana sin elegir. Pregúntale en qué expediente quiere trabajar ' +
        '(lista abajo) y fíjalo con establecer_expediente_activo.',
      expedientes_disponibles: disponibles(),
    });
  }
  if (resultado.estado === 'error') {
    return fail(
      'No se ha podido abrir la ventana de carpetas en este ordenador. Enséñale al abogado la ' +
        'lista de expedientes (numerada, para que conteste con el número) y fija el que diga con ' +
        'establecer_expediente_activo.',
      { motivo: resultado.motivo, detalle: resultado.detalle, expedientes_disponibles: disponibles() },
    );
  }

  const elegidos = [];
  const rechazados = [];
  for (const ruta of resultado.rutas) {
    const r = expedientes.expedienteDeCarpeta(ruta);
    const nombre = path.basename(ruta.replace(/[\\/]+$/, ''));
    if (!r.ok && r.motivo === 'fuera') {
      rechazados.push({
        carpeta: nombre,
        motivo:
          'No está dentro de las carpetas que vigila RobinSearch. Para usarla, el abogado tiene que ' +
          'añadirla en RobinDesktop → Expedientes (o mover el caso a su carpeta de expedientes).',
      });
      continue;
    }
    if (!r.ok && r.motivo === 'raiz') {
      // La carpeta vigilada misma. Puede ser la de UN caso con sus piezas en subcarpetas, o la
      // madre con todos los clientes: desde aquí no se distingue, así que no se fija y se pregunta.
      // Si además tiene documentos sueltos, es un expediente por sí misma y se puede fijar por su
      // nombre una vez confirmado.
      const fijable = expedientes.nombresConocidos().includes(r.raiz);
      rechazados.push({
        carpeta: nombre,
        motivo: fijable
          ? 'Es la carpeta de arriba: abarca varias carpetas que RobinSearch trata como expedientes ' +
            'distintos (lista en "contiene"). Pregúntale al abogado si son piezas de UN mismo asunto ' +
            `(entonces fíjala con establecer_expediente_activo y expediente="${r.raiz}") o clientes ` +
            'distintos (entonces que elija la carpeta del caso, o varias si son del mismo trabajo).'
          : 'Es la carpeta que contiene los expedientes, no un expediente: juntaría a todos los ' +
            'clientes. Que elija la carpeta del caso (o varias, si son del mismo trabajo).',
        necesita_confirmacion: fijable,
        contiene: r.contiene,
      });
      continue;
    }
    const cuenta = expedientes.contadoresAmbito(r.expediente);
    if (cuenta.documentos === 0) {
      rechazados.push({
        carpeta: nombre,
        expediente: r.expediente,
        motivo: state.estado === 'indexando'
          ? 'Todavía no está indexada: RobinSearch la está indexando ahora. Puede elegirse en cuanto termine (progreso en estado_servidor).'
          : 'No tiene documentos indexados (está vacía o sus ficheros no son de un tipo que RobinSearch lea).',
      });
      continue;
    }
    elegidos.push({ ...r, carpeta: nombre });
  }

  if (!elegidos.length) {
    return fail(
      resultado.rutas.length
        ? 'Lo elegido no se puede usar como expediente. Explícale al abogado el motivo y vuelve a abrir la ventana, o fija uno de la lista con establecer_expediente_activo.'
        : 'No ha llegado ninguna carpeta elegida.',
      { rechazados, expedientes_disponibles: disponibles() },
    );
  }

  const ids = expedientes.listaIds(elegidos.map((e) => e.expediente));
  if (heredada) {
    // La ventana la abrió una llamada anterior, que pudo ser de OTRA conversación: el servidor no
    // lo sabe. No se fija nada hasta que el abogado confirme que es la carpeta de ESTE asunto
    // (revisión de Codex, 25-nov).
    // La MISMA elección recogida por dos llamadas a la vez da el mismo código: el primero no queda
    // invalidado por el segundo (revisión de Codex, 5.ª ronda).
    const clave = expedientes.claveSeleccion(ids);
    const t = Date.now();
    for (const [c, p] of porConfirmar) if (t > p.hasta) porConfirmar.delete(c);
    const vigente = [...porConfirmar].find(([, p]) => p.clave === clave);
    const codigo = vigente ? vigente[0] : crypto.randomBytes(6).toString('hex');
    porConfirmar.set(codigo, { clave, ids, hasta: t + CADUCIDAD_ELECCION_MS });
    return ok({
      pendiente_de_confirmar: true,
      carpetas_elegidas: elegidos.map((e) => e.carpeta),
      expedientes_elegidos: ids,
      confirmar: codigo,
      mensaje:
        'Esta carpeta se eligió en una ventana que abrió una llamada anterior, quizá desde otra ' +
        'conversación, así que NO se ha fijado. Pregunta al abogado si es la carpeta del asunto de ' +
        'ESTA conversación; si dice que sí, vuelve a llamar a elegir_expediente con "confirmar" ' +
        `= "${codigo}" (y, si esta conversación quería SUMARLA a su selección, con "anadir": true y ` +
        'su "seleccion_actual"). No la fijes escribiendo el nombre: si la carpeta ya no está, un ' +
        'nombre parecido podría ser el de otro cliente.',
    });
  }
  const f = await fijarSeleccion(ids, { anadir: opciones.anadir === true, seleccionActual: opciones.seleccionActual });
  if (!f.ok) return fail(f.error, { ...f.extra, expedientes_disponibles: disponibles() });

  const respuesta = { ...f.respuesta };
  const ampliados = elegidos.filter((e) => !e.exacta);
  if (ampliados.length) {
    respuesta.nota_subcarpeta = ampliados
      .map((e) => `«${e.carpeta}» está dentro del expediente «${e.expediente}»: se ha fijado el expediente entero. Para ceñir una búsqueda a esa parte, usa "subcarpeta" en buscar_documentos.`)
      .join(' ');
  }
  if (rechazados.length) respuesta.rechazados = rechazados;
  if (opciones.varias && !admiteVarias()) {
    respuesta.nota_varias = 'En Windows la ventana elige una carpeta cada vez: para sumar otra, vuelve a llamar con "anadir": true.';
  }
  return ok(respuesta);
}

export async function handler(args) {
  const auth = await ensureAuthorized();
  if (!auth.ok) return authPromptResult(auth.loginUrl);

  const opciones = { varias: args?.varias === true, anadir: args?.anadir === true, seleccionActual: args?.seleccion_actual ?? null };

  if (args?.confirmar != null) return confirmar(String(args.confirmar), opciones);

  // Una elección hecha después de que la llamada anterior contestara «pendiente».
  if (sinRecoger) {
    const s = sinRecoger;
    sinRecoger = null;
    if (Date.now() <= s.hasta) return aplicar(s.resultado, s.opciones, { heredada: true });
  }

  if (!(config.roots || []).length) {
    return fail(
      'RobinSearch no tiene ninguna carpeta de expedientes configurada. El abogado la elige en ' +
        'RobinDesktop → Expedientes.',
      { motivo: 'sin_carpetas' },
    );
  }

  // Si ya hay una ventana abierta (la llamada anterior contestó «pendiente»), se espera a ESA.
  const heredada = Boolean(enCurso);
  const actual = enCurso || abrir(opciones);
  let tope;
  const SIGUE = Symbol('sigue');
  const r = await Promise.race([
    actual.promesa,
    new Promise((res) => { tope = setTimeout(() => res(SIGUE), ESPERA_DIALOGO_MS); }),
  ]);
  clearTimeout(tope);

  if (r === SIGUE) {
    return ok({
      pendiente: true,
      mensaje:
        'La ventana para elegir la carpeta sigue abierta en el ordenador del abogado. Vuelve a ' +
        'llamar a elegir_expediente para recoger su elección (no abrirá otra ventana). Si dice que ' +
        'no la ve, puede estar detrás de otras ventanas.',
    });
  }
  // La resolvió esta misma llamada: no queda nada sin recoger.
  sinRecoger = null;
  return aplicar(r, actual.opciones, { heredada });
}

// Confirmación de una elección heredada: los identificadores EXACTOS que se eligieron, o nada.
async function confirmar(codigo, opciones) {
  const p = porConfirmar.get(codigo);
  if (!p || Date.now() > p.hasta) {
    porConfirmar.delete(codigo);
    return fail(
      'Ese código de confirmación no es válido o ha caducado. Vuelve a abrir la ventana con ' +
        'elegir_expediente para que el abogado elija la carpeta.',
      { motivo: 'confirmacion_no_valida' },
    );
  }
  porConfirmar.delete(codigo);
  const conocidos = new Set(expedientes.nombresConocidos());
  const faltan = p.ids.filter((id) => !conocidos.has(id));
  if (faltan.length) {
    return fail(
      `La carpeta elegida ya no está entre los expedientes de RobinSearch (${faltan.join(', ')}): no se ` +
        'ha fijado nada. Vuelve a abrir la ventana con elegir_expediente.',
      { motivo: 'carpeta_desaparecida', expedientes_disponibles: disponibles() },
    );
  }
  const f = await fijarSeleccion(p.ids, { anadir: opciones.anadir, seleccionActual: opciones.seleccionActual });
  if (!f.ok) return fail(f.error, { ...f.extra, expedientes_disponibles: disponibles() });
  return ok(f.respuesta);
}

export default { definition, handler };
