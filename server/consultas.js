// «¿Qué ha cambiado desde la última vez?», SIN que el abogado lo pregunte (nota de mejora de
// Juan, 6-oct-2026): «que Robin detecte reactivamente qué ha cambiado y lo comunique al abogado
// cuando este haga la primera consulta en el chat sobre ese asunto».
//
// cambios_expediente compara con el último BARRIDO de revisión, y la mayoría de los abogados no
// hace barridos: consulta. Aquí la referencia es lo YA CONTADO: por cada expediente se guarda una
// foto de cada documento (tamaño y fecha) tal como estaba la última vez que se le dijo al abogado
// (o la primera vez que consultó el expediente). Cada consulta compara el índice con esa foto y
// cuenta lo que aún no se ha contado: documentos nuevos, modificados, retirados y llegados sin
// texto legible. Lo contado pasa a la foto y no se repite nunca; lo no contado sigue pendiente
// hasta que se cuente.
//
// 🔴 8-oct-2026 (pregunta de Juan: «¿y si abro un chat nuevo a los diez minutos de otro?»).
// Claude Desktop arranca UN proceso de RobinSearch al abrirse y lo comparte entre todos los chats,
// y el protocolo no avisa de que empieza un chat (initialize llega una vez por proceso; tools/call
// solo trae nombre y argumentos). La 1.11.2 solo comparaba tras 30 min de pausa y, mientras tanto,
// «refrescaba» la foto cada minuto: lo que entraba entre un chat y otro abierto a los diez minutos,
// o durante el propio chat, pasaba a la foto SIN contarse y se perdía para siempre. Ahora no
// depende de la pausa: se cuenta en la primera consulta que lo vea, sea el chat que sea.
//
// La pausa (30 min por defecto, ROBIN_PAUSA_CONSULTA_MIN) solo separa «sesiones de trabajo» para
// el ruido: dentro de una sesión, un documento que ya se contó y vuelve a cambiar (el abogado
// retocando su escrito, Word guardando) no se repite en cada llamada; queda pendiente y se cuenta
// al empezar la sesión siguiente, una vez. Y un documento que desaparece del índice pero sigue en
// el disco (se está reindexando, un guardado de Word en dos pasos) no se da por retirado.
//
// Todo es local: la foto vive en el directorio de datos del usuario (consultas.json), como el
// índice y las anotaciones, y no sale del ordenador. Varios procesos (Claude Desktop y Claude
// Code a la vez) comparten la foto bajo cerrojo: lo que cuenta uno no lo repite el otro.

import fs from 'node:fs';
import { config, ensureDataDirs, expedienteForLogicalPath } from './config.js';
import { log } from './logger.js';
import { conCerrojoDeFichero, escribirJson, leerJson } from './persistencia.js';
import * as registry from './indexer/registry.js';
import * as expedientes from './expedientes.js';

const PAUSA_MS = (() => {
  const n = parseFloat(process.env.ROBIN_PAUSA_CONSULTA_MIN);
  return (Number.isFinite(n) && n >= 0 ? n : 30) * 60 * 1000;
})();
const GUARDAR_ULTIMA_MS = 60 * 1000;
const MAX_LISTA = 25;

// Herramientas que son «una consulta sobre el expediente».
export const HERRAMIENTAS_CONSULTA = new Set([
  'buscar_documentos',
  'obtener_documento',
  'obtener_fragmento',
  'indice_documento',
  'leer_seccion',
  'listar_documentos_indexados',
  'establecer_expediente_activo',
  'siguiente_por_revisar',
  'obtener_anotaciones',
]);

// Sesión de trabajo por expediente EN ESTE PROCESO: última llamada, qué documentos se han contado
// ya en esta sesión y cuándo se guardó la fecha de la última consulta.
const actividad = new Map();

function rutaFichero() {
  return `${config.dataDir}/consultas.json`;
}

function cargar() {
  ensureDataDirs();
  const r = leerJson(rutaFichero());
  return r.estado === 'ok' && r.valor && typeof r.valor === 'object' ? r.valor : {};
}

// Lee, decide y, solo si hace falta, escribe, todo bajo el cerrojo (otro proceso puede estar
// contando lo mismo a la vez). `fn` devuelve { escribir, resultado }.
function conFoto(fn) {
  ensureDataDirs();
  return conCerrojoDeFichero(rutaFichero(), () => {
    const todo = cargar();
    const { escribir, resultado } = fn(todo);
    if (escribir) escribirJson(rutaFichero(), todo, { bak: true });
    return resultado;
  });
}

function entradasDe(expediente) {
  return registry
    .entries()
    .map(([abs, e]) => ({ abs, ...e }))
    .filter((e) =>
      expedientes.enAmbito(e.expediente || expedienteForLogicalPath(e.rutaRelativa), expediente),
    );
}

const fotoDe = (e) => ({ r: e.rutaRelativa, a: e.abs ?? null, s: e.size ?? null, m: e.mtimeMs ?? null });

// ¿Sigue en el disco un documento que ya no está en el índice? Entonces no se ha retirado: se
// está reindexando (o el editor lo guarda en dos pasos) y volverá con el mismo docId. Una foto
// antigua (1.11.x) no guarda la ruta absoluta: se da por retirado, como antes.
export function sigueEnDisco(v) {
  if (!v?.a) return false;
  try {
    return fs.existsSync(v.a);
  } catch {
    return false;
  }
}

// Compara el índice de ahora con la foto. Puro (salvo `enDisco`), para poder probarlo.
export function comparar(fotoAnterior, entradas, { enDisco = sigueEnDisco } = {}) {
  const nuevos = [];
  const modificados = [];
  const sinTexto = [];
  const vistos = new Set();
  for (const e of entradas) {
    vistos.add(e.docId);
    const antes = fotoAnterior[e.docId];
    const base = {
      docId: e.docId,
      ruta_relativa: e.rutaRelativa,
      modificado_en: e.mtimeMs != null ? new Date(e.mtimeMs).toISOString() : null,
    };
    if (!antes) {
      if (e.sinOcr || !e.numChunks) sinTexto.push(base);
      else nuevos.push(base);
    } else if ((antes.s ?? null) !== (e.size ?? null) || (antes.m ?? null) !== (e.mtimeMs ?? null)) {
      modificados.push(base);
    }
  }
  const retirados = Object.entries(fotoAnterior)
    .filter(([id, v]) => !vistos.has(id) && !enDisco(v))
    .map(([id, v]) => ({ docId: id, ruta_relativa: v.r }));
  const orden = (a, b) => String(a.ruta_relativa).localeCompare(String(b.ruta_relativa));
  return {
    nuevos: nuevos.sort(orden),
    modificados: modificados.sort(orden),
    retirados: retirados.sort(orden),
    sin_texto: sinTexto.sort(orden),
  };
}

function fechaLegible(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })
    : iso;
}

const sinDocId = ({ docId, ...resto }) => resto;

// Llamada tras cada consulta sobre `expediente`. Devuelve el bloque para la respuesta si hay algo
// que aún no se ha contado; si no, null.
export function alConsultar(expediente, ahora = Date.now()) {
  if (!expediente) return null;
  const previa = actividad.get(expediente);
  const enSesion = Boolean(previa && ahora - previa.ultima < PAUSA_MS);
  const sesion = enSesion
    ? previa
    : { contados: new Set(), guardadaUltima: 0, inicio: ahora };
  sesion.ultima = ahora;
  actividad.set(expediente, sesion);
  try {
    const entradas = entradasDe(expediente);
    const porId = new Map(entradas.map((e) => [e.docId, e]));
    return conFoto((todo) => {
      const guardado = todo[expediente];
      const isoAhora = new Date(ahora).toISOString();
      if (!guardado?.docs) {
        // Primera vez: no hay con qué comparar. Lo que hay ahora es la línea base.
        const docs = {};
        for (const e of entradas) docs[e.docId] = fotoDe(e);
        todo[expediente] = { docs, ultima: isoAhora };
        sesion.guardadaUltima = ahora;
        return { escribir: true, resultado: null };
      }
      const c = comparar(guardado.docs, entradas);
      // Dentro de una sesión, lo ya contado en ella que vuelve a cambiar se aplaza (ni se cuenta
      // ni pasa a la foto): se contará al empezar la sesión siguiente.
      const aplazar = (l) => (enSesion ? l.filter((x) => !sesion.contados.has(x.docId)) : l);
      const contar = {
        nuevos: aplazar(c.nuevos),
        modificados: aplazar(c.modificados),
        retirados: aplazar(c.retirados),
        sin_texto: aplazar(c.sin_texto),
      };
      const recuento = {
        nuevos: contar.nuevos.length,
        modificados: contar.modificados.length,
        retirados: contar.retirados.length,
        sin_texto: contar.sin_texto.length,
      };
      const hay = Object.values(recuento).some((n) => n > 0);
      const ultimaAnterior = guardado.ultima;
      const guardarUltima = ahora - sesion.guardadaUltima >= GUARDAR_ULTIMA_MS;
      if (!hay) {
        if (guardarUltima) {
          guardado.ultima = isoAhora;
          sesion.guardadaUltima = ahora;
        }
        return { escribir: guardarUltima, resultado: null };
      }
      // Lo que se cuenta pasa a la foto: no se volverá a contar.
      for (const x of [...contar.nuevos, ...contar.modificados, ...contar.sin_texto]) {
        guardado.docs[x.docId] = fotoDe(porId.get(x.docId));
        sesion.contados.add(x.docId);
      }
      for (const x of contar.retirados) {
        delete guardado.docs[x.docId];
        sesion.contados.add(x.docId);
      }
      guardado.ultima = isoAhora;
      sesion.guardadaUltima = ahora;

      const momento = enSesion ? 'durante_la_sesion' : 'inicio_de_sesion';
      log.info('Cambios en el expediente aún no contados', { expediente, momento, ...recuento });
      const recortar = (l) => l.slice(0, MAX_LISTA).map(sinDocId);
      const desde = enSesion ? new Date(previa.inicio).toISOString() : ultimaAnterior;
      const aviso = enSesion
        ? 'Mientras el abogado trabajaba (en este chat o en otro abierto hace poco) han entrado ' +
          'o cambiado documentos de este expediente que aún no se le han contado. Díselo en una ' +
          'línea, nombrándolos si son pocos, y sigue con lo que ha pedido. Si es un documento que ' +
          'acabáis de guardar vosotros en esta conversación, basta con confirmar que ya está en ' +
          'el índice. Díselo una sola vez.'
        : `ANTES de contestar a lo que ha preguntado, dile al abogado en una o dos líneas qué ha ` +
          `cambiado en este expediente desde su última consulta (${fechaLegible(ultimaAnterior)}): ` +
          'cuántos documentos nuevos, modificados y retirados, nombrándolos si son pocos, y los que ' +
          'han llegado sin texto legible (zona ciega). Ofrécele revisarlos (para un repaso ' +
          'completo, siguiente_por_revisar o cambios_expediente). Díselo una sola vez y sigue con ' +
          'su pregunta.';
      return {
        escribir: true,
        resultado: {
          expediente,
          momento,
          ultima_consulta: ultimaAnterior,
          desde,
          recuento,
          nuevos: recortar(contar.nuevos),
          modificados: recortar(contar.modificados),
          retirados: recortar(contar.retirados),
          sin_texto: recortar(contar.sin_texto),
          ...(Object.values(recuento).some((n) => n > MAX_LISTA)
            ? { nota_listas: `Listas recortadas a ${MAX_LISTA}; el detalle completo, con cambios_expediente.` }
            : {}),
          aviso_al_abogado:
            aviso +
            ' Si acaba de copiar ficheros y el índice aún trabaja (estado_servidor), adviértelo: ' +
            'los que falten se contarán en cuanto entren.',
        },
      };
    });
  } catch (err) {
    log.warn('No se pudo comparar con lo ya contado', { expediente, err: String(err) });
    return null;
  }
}

// Expediente al que va una llamada: el explícito o el activo. Sin error si no hay (la propia
// herramienta ya lo habrá dicho).
export function expedienteDeLaLlamada(args) {
  const g = expedientes.exigirExpediente(args?.expediente ?? null);
  return g.ok ? g.expediente : null;
}

// Para las pruebas.
export function _olvidarActividad() {
  actividad.clear();
}

export function _existeFichero() {
  return fs.existsSync(rutaFichero());
}
