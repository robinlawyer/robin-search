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
        description: 'Sumar lo elegido a los expedientes ya seleccionados en vez de sustituirlos.',
        default: false,
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

async function aplicar(resultado, opciones) {
  if (resultado.estado === 'cancelado') {
    return ok({
      cancelado: true,
      expediente_activo: expedientes.getActivo(),
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

  const ids = expedientes.normalizarSeleccion(elegidos.map((e) => e.expediente));
  const f = await fijarSeleccion(ids, { anadir: opciones.anadir === true });
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

  const opciones = { varias: args?.varias === true, anadir: args?.anadir === true };

  // Una elección hecha después de que la llamada anterior contestara «pendiente».
  if (sinRecoger) {
    const s = sinRecoger;
    sinRecoger = null;
    if (Date.now() <= s.hasta) return aplicar(s.resultado, s.opciones);
  }

  if (!(config.roots || []).length) {
    return fail(
      'RobinSearch no tiene ninguna carpeta de expedientes configurada. El abogado la elige en ' +
        'RobinDesktop → Expedientes.',
      { motivo: 'sin_carpetas' },
    );
  }

  // Si ya hay una ventana abierta (la llamada anterior contestó «pendiente»), se espera a ESA.
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
  return aplicar(r, actual.opciones);
}

export default { definition, handler };
