// Ficha de estado por ASUNTO — la memoria del director de asunto (despacho agéntico, fase 1;
// documento de Juan del 12-oct-2026).
//
// Un ASUNTO es el trabajo de un cliente que el abogado dirige de principio a fin, y su expediente
// son UNA O VARIAS carpetas vigiladas (con sus subcarpetas): la documentación de un mismo asunto
// muchas veces vive repartida (la carpeta del cliente, la del procedimiento, la del data room). Solo
// hay un asunto activo a la vez, y activarlo fija como selección de trabajo exactamente sus
// carpetas: el mismo aislamiento por expediente de siempre, ahora a la medida del asunto.
//
// Por qué vive en RobinSearch y no en un fichero que escriba Claude: en la pestaña Chat de Claude
// Desktop y en claude.ai Claude no tiene disco, así que un `matter.md` escrito por Claude no
// sobrevive a la conversación. RobinSearch sí corre en el ordenador del abogado, en todas las
// pestañas, y ya guarda aquí el barrido y las anotaciones. La ficha NO copia documentos del
// cliente: apunta a carpetas y guarda lo que el abogado decide.
//
// Reglas que este módulo hace cumplir en vez de confiarlas al modelo:
//   · La fase solo cambia resolviendo la puerta, y la resolución exige la decisión del abogado,
//     que queda registrada con fecha, fase y puerta (trazabilidad, imprescindible si un despacho
//     colegiado firma con Robin detrás).
//   · Las decisiones solo se AÑADEN: no hay forma de editarlas ni de borrarlas.
//   · Un plazo sin herramienta de cálculo no se marca como firme.
//   · Un escrito no pasa a «validado» ni a «enviado» sin la decisión del abogado.
//
// Se guarda en <dataDir>/asuntos.json (escritura atómica con copia .bak, como el resto del estado)
// y, para que el abogado lo pueda leer sin Claude, en <dataDir>/asuntos/<id>/ficha.md y
// decisiones.md. Nada de esto sale del ordenador.

import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDirs, expedienteForLogicalPath } from './config.js';
import { log } from './logger.js';
import { conCerrojoDeFichero, escribirAtomico, escribirJson, leerJson } from './persistencia.js';
import * as registry from './indexer/registry.js';
import * as expedientes from './expedientes.js';

export const FASES = [
  'Entrada',
  'Expediente',
  'Diagnóstico y plan',
  'Escritos',
  'Revisión cruzada',
  'Pre-mortem',
  'Informe al equipo',
  'Informe al cliente',
  'Cambios',
];

// Lo que el socio decide en cada fase (la tabla «Máquina de estados» del documento).
export const PUERTAS = [
  'Elegir el asunto o abrir uno nuevo',
  'Confirmar objetivo, posición, hito procesal y carpetas',
  'Validar el plan',
  'Validar cada escrito',
  'Elegir qué correcciones se aplican',
  'Decidir con el riesgo a la vista',
  'Aprobar el informe al equipo',
  'Aprobar el informe al cliente (el envío siempre es expreso)',
  'Decidir si se reabre el paso afectado',
];

export const ORDENES = ['civil', 'mercantil', 'penal', 'laboral', 'contencioso', 'fiscal'];
export const POSICIONES = ['demandante', 'demandado', 'acusacion', 'defensa', 'recurrente', 'asesoramiento', 'otra'];
export const ESTADOS_ESCRITO = ['borrador', 'validado', 'enviado'];
const HERRAMIENTAS_PLAZO = new Set(['calculo_plazos', 'plazos', 'deposito_recurso']);

const MAX_LISTA_CAMBIOS = 40;

function rutaFichero() {
  return path.join(config.dataDir, 'asuntos.json');
}

const vacio = () => ({ version: 1, asuntos: {} });

// Asunto activo de ESTE proceso. Como la selección de expedientes, no se persiste: al cerrar
// Claude no queda un asunto «pegado», y el siguiente «Hola Robin» propone los recientes.
let _activo = null;
// Asuntos activados hace poco (id → cuándo). Como con los expedientes (1.12.6): Claude comparte un
// solo RobinSearch entre todas sus conversaciones; si en la ventana se han abierto otros asuntos,
// una acción sin "asunto_id" podría ser de la otra conversación y no se resuelve con el activo
// (revisión de Codex, 25-nov). Dos asuntos con las mismas carpetas se distinguen aquí.
const _activados = new Map();

export function getActivoId() {
  return _activo;
}

function cargar() {
  ensureDataDirs();
  const r = leerJson(rutaFichero());
  if (r.estado === 'ok') {
    const v = r.valor;
    if (!v.asuntos || typeof v.asuntos !== 'object') v.asuntos = {};
    return v;
  }
  // Un error de disco (ocupado, permisos) lo LANZA leerJson: nunca se toma por «vacío», que
  // escribir encima borraría las fichas.
  if (r.estado === 'corrupto') log.error('asuntos.json dañado y sin copia: se aparta intacto y se empieza de cero');
  return vacio();
}

function conAlmacen(fn) {
  ensureDataDirs();
  return conCerrojoDeFichero(rutaFichero(), () => {
    const datos = cargar();
    const out = fn(datos);
    if (out?.guardar !== false) {
      escribirJson(rutaFichero(), datos, { bak: true, indent: 2 });
      for (const id of out?.tocados || []) espejo(datos.asuntos[id]);
    }
    return out?.resultado ?? out;
  });
}

const ahora = () => new Date().toISOString();
const texto = (v) => (typeof v === 'string' ? v.trim() : '');

// ---------------------------------------------------------------------------------------------
// Validaciones de campos
// ---------------------------------------------------------------------------------------------

function normOrden(v) {
  const t = expedientes.slug(texto(v)).replace(/-/g, '');
  if (!t) return null;
  if (t.startsWith('contencioso') || t === 'administrativo') return 'contencioso';
  if (t.startsWith('mercantil') || t.startsWith('corporativo') || t.startsWith('societario')) return 'mercantil';
  if (t.startsWith('fiscal') || t.startsWith('tributario')) return 'fiscal';
  return ORDENES.includes(t) ? t : undefined;
}

function normPosicion(v) {
  const t = expedientes.slug(texto(v)).replace(/-/g, '');
  if (!t) return null;
  if (t.startsWith('acusa')) return 'acusacion';
  if (t.startsWith('asesor')) return 'asesoramiento';
  return POSICIONES.includes(t) ? t : undefined;
}

function normFecha(v) {
  const t = texto(v);
  if (!t) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && Number.isFinite(Date.parse(t)) ? t : undefined;
}

function normHito(v) {
  if (v == null) return null;
  if (typeof v === 'string') return { descripcion: texto(v), fecha: null };
  const fecha = normFecha(v.fecha);
  if (fecha === undefined) throw new Error(`hito_procesal.fecha no es una fecha AAAA-MM-DD: ${v.fecha}`);
  return { descripcion: texto(v.descripcion), fecha };
}

function normPlazos(lista) {
  if (!Array.isArray(lista)) throw new Error('plazos debe ser una lista');
  return lista.map((p, i) => {
    const fecha = normFecha(p?.fecha);
    if (!fecha) throw new Error(`plazos[${i}].fecha debe ser AAAA-MM-DD`);
    const herramienta = texto(p?.herramienta) || null;
    const firme = Boolean(herramienta && HERRAMIENTAS_PLAZO.has(herramienta));
    return {
      fecha,
      tipo: texto(p?.tipo) || null,
      descripcion: texto(p?.descripcion) || null,
      herramienta,
      // Un plazo sin cálculo no se muestra como firme (documento de Juan, «Ficha de estado»).
      firme,
      ...(firme ? {} : { aviso: 'Sin cálculo con calculo_plazos: orientativo, no firme.' }),
    };
  });
}

function normEscritos(lista, previos, hayDecision) {
  if (!Array.isArray(lista)) throw new Error('escritos debe ser una lista');
  const antes = new Map((previos || []).map((e) => [e.titulo, e]));
  return lista.map((e, i) => {
    const titulo = texto(e?.titulo);
    if (!titulo) throw new Error(`escritos[${i}] necesita "titulo"`);
    const estado = texto(e?.estado || 'borrador').toLowerCase();
    if (!ESTADOS_ESCRITO.includes(estado)) {
      throw new Error(`escritos[${i}].estado debe ser uno de ${ESTADOS_ESCRITO.join(', ')}`);
    }
    const previo = antes.get(titulo);
    if (estado !== 'borrador' && estado !== previo?.estado && !hayDecision) {
      throw new Error(
        `El escrito "${titulo}" no puede pasar a "${estado}" sin la decisión del abogado: ` +
          'pásala en "decision" con sus palabras (validar o enviar es suyo, no de Robin).',
      );
    }
    return {
      titulo,
      version: Number.isFinite(Number(e?.version)) ? Number(e.version) : previo?.version ?? 1,
      estado,
      ruta: texto(e?.ruta) || previo?.ruta || null,
    };
  });
}

// Las carpetas del expediente: TODAS deben existir en lo vigilado. Si una falla, falla todo (un
// asunto «a medias» buscaría en menos de lo que el abogado cree).
function resolverCarpetas(lista) {
  const pedidas = expedientes.normalizarSeleccion(lista);
  if (!pedidas.length) {
    return { ok: false, error: 'Un asunto necesita al menos una carpeta del expediente ("carpetas_expediente").' };
  }
  const r = expedientes.resolverVarios(pedidas);
  if (!r.ok) return r;
  return { ok: true, carpetas: r.expedientes };
}

function carpetasGuardadas(lista) {
  const guardadas = expedientes.listaIds(lista);
  if (!guardadas.length) return resolverCarpetas(lista);
  const conocidos = new Set(expedientes.nombresConocidos());
  const faltan = guardadas.filter((id) => !conocidos.has(id));
  if (faltan.length) {
    return {
      ok: false,
      error: `${faltan.map((x) => `«${x}»`).join(', ')} ya no está entre los expedientes que vigila RobinSearch.`,
      extra: { carpetas_que_faltan: faltan, expedientes_disponibles: expedientes.nombresConocidos() },
    };
  }
  return { ok: true, carpetas: guardadas };
}

// ---------------------------------------------------------------------------------------------
// Instantánea del expediente para el resumen «desde la última vez»
// ---------------------------------------------------------------------------------------------

function entradasDe(carpeta) {
  return registry
    .entries()
    .map(([, e]) => e)
    .filter((e) => expedientes.enAmbito(e.expediente || expedienteForLogicalPath(e.rutaRelativa), carpeta));
}

function instantanea(carpetas) {
  const out = {};
  for (const c of carpetas) {
    const docs = {};
    for (const e of entradasDe(c)) {
      if (!e.docId) continue;
      docs[e.docId] = { r: e.rutaRelativa, s: e.size ?? null, m: e.mtimeMs ?? null };
    }
    out[c] = docs;
  }
  return out;
}

function ultimaIndexacion(carpetas) {
  let max = null;
  for (const c of carpetas) {
    for (const e of entradasDe(c)) {
      if (e.indexedAt && (!max || e.indexedAt > max)) max = e.indexedAt;
    }
  }
  return max;
}

function cambiosEntre(previa, actual) {
  const porCarpeta = [];
  for (const [carpeta, docs] of Object.entries(actual)) {
    const antes = previa?.[carpeta];
    if (!antes) {
      // Carpeta añadida al asunto después de la última sesión: todo lo suyo es nuevo PARA EL
      // ASUNTO, pero no se listan sus documentos uno a uno, que no es lo que el abogado busca.
      porCarpeta.push({ carpeta, carpeta_nueva_en_el_asunto: true, documentos: Object.keys(docs).length });
      continue;
    }
    const nuevos = [];
    const modificados = [];
    for (const [id, d] of Object.entries(docs)) {
      const a = antes[id];
      if (!a) nuevos.push(d.r);
      else if (a.s !== d.s || a.m !== d.m) modificados.push(d.r);
    }
    const retirados = Object.entries(antes).filter(([id]) => !docs[id]).map(([, d]) => d.r);
    if (nuevos.length || modificados.length || retirados.length) {
      porCarpeta.push({
        carpeta,
        nuevos: nuevos.slice(0, MAX_LISTA_CAMBIOS),
        modificados: modificados.slice(0, MAX_LISTA_CAMBIOS),
        retirados: retirados.slice(0, MAX_LISTA_CAMBIOS),
        recuento: { nuevos: nuevos.length, modificados: modificados.length, retirados: retirados.length },
      });
    }
  }
  return porCarpeta;
}

// ---------------------------------------------------------------------------------------------
// Vista pública de la ficha (sin la instantánea interna)
// ---------------------------------------------------------------------------------------------

function fase(n) {
  return { numero: n, nombre: FASES[n] };
}

function metricas(a) {
  const dec = a.decisiones || [];
  const conPrompts = dec.filter((d) => Number.isInteger(d.prompts_abogado));
  const primerPlan = dec.find((d) => d.fase === 2 && /Pasa a la fase/.test(d.efecto || ''));
  return {
    prompts_abogado: conPrompts.reduce((n, d) => n + d.prompts_abogado, 0),
    puertas_con_dato_de_prompts: conPrompts.length,
    correcciones_en_puertas: dec.filter((d) => d.correccion === true).length,
    puertas_resueltas: dec.filter((d) => /^(Pasa a|Reabre) la fase/.test(d.efecto || '')).length,
    minutos_hasta_plan_validado: primerPlan
      ? Math.round((Date.parse(primerPlan.fecha) - Date.parse(a.creado_en)) / 60000)
      : null,
  };
}

export function vista(a, { conDecisiones = true } = {}) {
  if (!a) return null;
  const { instantanea: _i, ...resto } = a;
  return {
    ...resto,
    fase_director: fase(a.fase_director),
    ultima_indexacion: ultimaIndexacion(a.carpetas_expediente || []),
    decisiones: conDecisiones ? a.decisiones : undefined,
    num_decisiones: (a.decisiones || []).length,
    metricas: metricas(a),
    activo: _activo === a.asunto_id,
  };
}

function resumenLista(a) {
  return {
    asunto_id: a.asunto_id,
    nombre: a.nombre,
    orden: a.orden,
    fase_director: fase(a.fase_director),
    puerta_pendiente: a.puerta_pendiente,
    carpetas_expediente: a.carpetas_expediente,
    ultima_sesion: a.ultima_sesion,
    activo: _activo === a.asunto_id,
  };
}

// ---------------------------------------------------------------------------------------------
// Espejo legible (ficha.md y decisiones.md)
// ---------------------------------------------------------------------------------------------

function carpetaEspejo(id) {
  return path.join(config.dataDir, 'asuntos', id);
}

function espejo(a) {
  if (!a) return;
  try {
    const dir = carpetaEspejo(a.asunto_id);
    fs.mkdirSync(dir, { recursive: true });
    const l = [];
    l.push(`# ${a.nombre}`, '');
    l.push(`- Identificador: ${a.asunto_id}`);
    l.push(`- Estado: ${a.estado}`);
    l.push(`- Orden: ${a.orden || '—'}`);
    l.push(`- Objetivo del cliente: ${a.objetivo_cliente || '—'}`);
    l.push(`- Posición: ${a.posicion || '—'}`);
    l.push(`- Hito procesal: ${a.hito_procesal?.descripcion || '—'}${a.hito_procesal?.fecha ? ` (${a.hito_procesal.fecha})` : ''}`);
    l.push(`- Fase: ${a.fase_director}. ${FASES[a.fase_director]}`);
    l.push(`- Puerta pendiente: ${a.puerta_pendiente || '—'}`);
    l.push(`- Última sesión: ${a.ultima_sesion || '—'}`, '');
    l.push('## Carpetas del expediente', '', ...(a.carpetas_expediente || []).map((c) => `- ${c}`), '');
    l.push('## Plazos', '');
    for (const p of a.plazos || []) l.push(`- ${p.fecha} · ${p.tipo || ''} ${p.descripcion || ''} · ${p.firme ? `firme (${p.herramienta})` : 'NO firme: sin cálculo'}`);
    l.push('', '## Escritos', '');
    for (const e of a.escritos || []) l.push(`- ${e.titulo} · v${e.version} · ${e.estado}${e.ruta ? ` · ${e.ruta}` : ''}`);
    l.push('', '## Riesgos aceptados', '', ...(a.riesgos_aceptados || []).map((r) => `- ${r}`));
    l.push('', '## Cambios detectados', '');
    for (const c of a.cambios_detectados || []) l.push(`- ${c.fecha} · ${c.cambio}${c.paso_reabierto != null ? ` · paso reabierto: ${c.paso_reabierto}` : ''}`);
    const m = metricas(a);
    l.push('', '## Medidas del director', '');
    l.push(`- Mensajes que escribió el abogado por su cuenta: ${m.prompts_abogado} (en ${m.puertas_con_dato_de_prompts} puertas con dato)`);
    l.push(`- Correcciones en las puertas: ${m.correcciones_en_puertas}`);
    l.push(`- Minutos hasta el plan validado: ${m.minutos_hasta_plan_validado ?? '—'}`);
    l.push('', 'Generado por RobinSearch. Las decisiones están en decisiones.md.', '');
    escribirAtomico(path.join(dir, 'ficha.md'), l.join('\n'));

    const d = [`# Decisiones — ${a.nombre}`, '', 'Registro de solo añadir: cada decisión del abogado en cada puerta, con su fecha.', ''];
    for (const x of a.decisiones || []) {
      d.push(`## ${x.fecha} · fase ${x.fase}. ${FASES[x.fase] || ''}`, '');
      d.push(`- Puerta: ${x.puerta || '—'}`);
      d.push(`- Decisión del abogado: ${x.decision}`);
      if (x.efecto) d.push(`- Efecto: ${x.efecto}`);
      if (x.prompts_abogado != null) d.push(`- Mensajes del abogado por su cuenta desde la puerta anterior: ${x.prompts_abogado}`);
      if (x.correccion != null) d.push(`- ¿Corrigió a Robin en esta puerta?: ${x.correccion ? 'sí' : 'no'}`);
      d.push('');
    }
    escribirAtomico(path.join(dir, 'decisiones.md'), d.join('\n'));
  } catch (err) {
    // El espejo es una comodidad: si falla, la ficha (asuntos.json) ya está guardada.
    log.warn('No se pudo escribir el espejo legible del asunto', { asunto: a.asunto_id, error: err?.message });
  }
}

export function rutaEspejo(id) {
  return carpetaEspejo(id);
}

// ---------------------------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------------------------

function buscar(datos, id) {
  const explicito = texto(id);
  if (!explicito && _activo) {
    const otros = [..._activados]
      .filter(([x, t]) => x !== _activo && expedientes.enVentanaDeConversaciones(t))
      .map(([x]) => x);
    if (otros.length) {
      return {
        ok: false,
        error:
          'En este Claude se han abierto hace poco varios asuntos, seguramente desde conversaciones ' +
          'distintas, y el asunto activo es uno solo para todas: podría ser el de otra conversación. ' +
          'Repite la llamada indicando el "asunto_id" de ESTA conversación.',
        extra: { asunto_activo: _activo, asuntos_recientes: [_activo, ...otros] },
      };
    }
  }
  const pedido = explicito || _activo;
  if (!pedido) {
    return { ok: false, error: 'No hay asunto activo: indica "asunto_id" (los tienes en accion="listar").' };
  }
  const a = datos.asuntos[pedido] || datos.asuntos[expedientes.slug(pedido)];
  if (!a) {
    return {
      ok: false,
      error: `No hay ningún asunto "${pedido}".`,
      extra: { asuntos: Object.values(datos.asuntos).filter((x) => x.estado !== 'cerrado').map(resumenLista) },
    };
  }
  // Toda operación sobre un asunto renueva su hora, como las lecturas de un expediente: si otra
  // conversación abre otro, la barrera salta también para quien seguía con este sin abrirlo de
  // nuevo (revisión de Codex, 6.ª ronda).
  _activados.set(a.asunto_id, Date.now());
  return { ok: true, asunto: a };
}

export function listar({ incluirCerrados = false } = {}) {
  const datos = cargar();
  const lista = Object.values(datos.asuntos)
    .filter((a) => incluirCerrados || a.estado !== 'cerrado')
    .sort((x, y) => String(y.ultima_sesion || y.actualizado_en).localeCompare(String(x.ultima_sesion || x.actualizado_en)))
    .map(resumenLista);
  return { ok: true, activo: _activo, asuntos: lista };
}

export function leer(id) {
  const datos = cargar();
  const b = buscar(datos, id);
  if (!b.ok) return b;
  return { ok: true, asunto: vista(b.asunto) };
}

function nuevoId(datos, nombre) {
  const base = expedientes.slug(nombre).slice(0, 60) || 'asunto';
  let id = base;
  for (let i = 2; datos.asuntos[id]; i++) id = `${base}-${i}`;
  return id;
}

export function crear(campos) {
  const nombre = texto(campos?.nombre);
  if (!nombre) return { ok: false, error: 'Falta "nombre": un título corto del asunto, sin datos que no hagan falta.' };
  const c = resolverCarpetas(campos?.carpetas_expediente);
  if (!c.ok) return c;
  let base;
  try {
    base = camposEditables(campos, null, false);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return conAlmacen((datos) => {
    const id = nuevoId(datos, nombre);
    const t = ahora();
    const a = {
      asunto_id: id,
      nombre,
      estado: 'abierto',
      orden: null,
      objetivo_cliente: null,
      posicion: null,
      hito_procesal: null,
      ...base,
      carpetas_expediente: c.carpetas,
      fase_director: 1,
      puerta_pendiente: PUERTAS[1],
      plazos: base.plazos || [],
      escritos: base.escritos || [],
      riesgos_aceptados: [],
      cambios_detectados: [],
      decisiones: [
        { fecha: t, fase: 0, puerta: PUERTAS[0], decision: 'Abrir un asunto nuevo', efecto: 'Asunto creado en fase 1 (Expediente)' },
      ],
      creado_en: t,
      actualizado_en: t,
      ultima_sesion: null,
      instantanea: null,
    };
    datos.asuntos[id] = a;
    return { tocados: [id], resultado: { ok: true, asunto: a } };
  });
}

// Campos que el director puede escribir sin cambiar de fase.
function camposEditables(campos, previo, hayDecision) {
  const out = {};
  if ('nombre' in campos && texto(campos.nombre)) out.nombre = texto(campos.nombre);
  if ('orden' in campos) {
    const o = normOrden(campos.orden);
    if (o === undefined) throw new Error(`orden debe ser uno de ${ORDENES.join(', ')}`);
    out.orden = o;
  }
  if ('objetivo_cliente' in campos) out.objetivo_cliente = texto(campos.objetivo_cliente) || null;
  if ('posicion' in campos) {
    const p = normPosicion(campos.posicion);
    if (p === undefined) throw new Error(`posicion debe ser una de ${POSICIONES.join(', ')}`);
    out.posicion = p;
  }
  if ('hito_procesal' in campos) out.hito_procesal = normHito(campos.hito_procesal);
  if ('plazos' in campos) out.plazos = normPlazos(campos.plazos);
  if ('escritos' in campos) out.escritos = normEscritos(campos.escritos, previo?.escritos, hayDecision);
  if ('puerta_pendiente' in campos) out.puerta_pendiente = texto(campos.puerta_pendiente) || null;
  return out;
}

export async function activar(id, { fijarSeleccion }) {
  const datos = cargar();
  const b = buscar(datos, id);
  if (!b.ok) return b;
  if (b.asunto.estado === 'cerrado') {
    return { ok: false, error: `El asunto "${b.asunto.asunto_id}" está cerrado. Reábrelo con accion="reabrir" si el abogado lo pide.` };
  }
  // Las carpetas pueden haberse renombrado o movido desde la última vez. Las guardadas ya son ids
  // del catálogo: se exigen EXACTAS. Pasarlas por el resolvedor tolerante podía cambiar una carpeta
  // desaparecida por la de otro cliente de nombre parecido (revisión de Codex, 9.ª ronda).
  const c = carpetasGuardadas(b.asunto.carpetas_expediente);
  if (!c.ok) {
    return {
      ok: false,
      error:
        `Alguna carpeta del asunto ya no está entre lo vigilado (${c.error}) Pregunta al abogado ` +
        'dónde está ahora y corrígela con accion="actualizar" y "carpetas_expediente".',
      extra: c.extra,
    };
  }
  const sel = await fijarSeleccion(c.carpetas);
  if (!sel.ok) return sel;
  _activo = b.asunto.asunto_id;
  _activados.set(_activo, Date.now());

  const actual = instantanea(c.carpetas);
  const resultado = conAlmacen((d) => {
    const a = d.asuntos[_activo];
    const t = ahora();
    const cambios = a.ultima_sesion ? cambiosEntre(a.instantanea, actual) : [];
    if (cambios.length) {
      a.cambios_detectados = [
        ...(a.cambios_detectados || []),
        {
          fecha: t,
          cambio: cambios
            .map((x) =>
              x.carpeta_nueva_en_el_asunto
                ? `${x.carpeta}: carpeta incorporada al asunto (${x.documentos} documentos)`
                : `${x.carpeta}: ${x.recuento.nuevos} nuevos, ${x.recuento.modificados} modificados, ${x.recuento.retirados} retirados`,
            )
            .join('; '),
          paso_reabierto: null,
        },
      ];
    }
    const sesionAnterior = a.ultima_sesion;
    a.ultima_sesion = t;
    a.instantanea = actual;
    return { tocados: [a.asunto_id], resultado: { asunto: a, cambios, sesionAnterior } };
  });
  return {
    ok: true,
    asunto: vista(resultado.asunto),
    cambios_desde_ultima_sesion: resultado.sesionAnterior ? resultado.cambios : null,
    ultima_sesion_anterior: resultado.sesionAnterior,
    seleccion: sel.respuesta,
  };
}

export async function actualizar(id, campos, { fijarSeleccion }) {
  const datos = cargar();
  const b = buscar(datos, id);
  if (!b.ok) return b;
  if ('fase_director' in (campos || {})) {
    return {
      ok: false,
      error:
        'La fase no se cambia con "actualizar": solo avanza o se reabre resolviendo la puerta ' +
        '(accion="resolver_puerta") con la decisión del abogado.',
    };
  }
  const decision = texto(campos?.decision);
  let cambios;
  try {
    cambios = camposEditables(campos || {}, b.asunto, Boolean(decision));
  } catch (err) {
    return { ok: false, error: err.message };
  }
  let carpetas = null;
  if ('carpetas_expediente' in (campos || {})) {
    const c = resolverCarpetas(campos.carpetas_expediente);
    if (!c.ok) return c;
    carpetas = c.carpetas;
  }
  if (!Object.keys(cambios).length && !carpetas) {
    return { ok: false, error: 'No se ha indicado ningún campo que cambiar.' };
  }
  const asunto = conAlmacen((d) => {
    const a = d.asuntos[b.asunto.asunto_id];
    Object.assign(a, cambios);
    if (carpetas) a.carpetas_expediente = carpetas;
    a.actualizado_en = ahora();
    if (decision) {
      a.decisiones.push({
        fecha: a.actualizado_en,
        fase: a.fase_director,
        puerta: a.puerta_pendiente,
        decision,
        efecto: `Actualizados: ${[...Object.keys(cambios), ...(carpetas ? ['carpetas_expediente'] : [])].join(', ')}`,
      });
    }
    return { tocados: [a.asunto_id], resultado: a };
  });
  let seleccion = null;
  if (carpetas && _activo === asunto.asunto_id) {
    const sel = await fijarSeleccion(carpetas);
    if (sel.ok) seleccion = sel.respuesta;
  }
  return { ok: true, asunto: vista(asunto), ...(seleccion ? { seleccion } : {}) };
}

// La única vía para cambiar de fase: la decisión del abogado queda registrada.
export function resolverPuerta(id, { decision, fase_siguiente, puerta_siguiente, riesgos_aceptados, motivo_reapertura, prompts_abogado, correccion }) {
  const dec = texto(decision);
  if (!dec) {
    return {
      ok: false,
      error:
        'Falta "decision": lo que ha decidido el abogado en esta puerta, con sus palabras. Robin ' +
        'no resuelve una puerta por él.',
    };
  }
  const n = Number(fase_siguiente);
  if (!Number.isInteger(n) || n < 0 || n >= FASES.length) {
    return { ok: false, error: `"fase_siguiente" debe ser un número de 0 a ${FASES.length - 1} (${FASES.map((f, i) => `${i} ${f}`).join(', ')}).` };
  }
  const datos = cargar();
  const b = buscar(datos, id);
  if (!b.ok) return b;
  return conAlmacen((d) => {
    const a = d.asuntos[b.asunto.asunto_id];
    const t = ahora();
    const reabre = n < a.fase_director;
    const entrada = {
      fecha: t,
      fase: a.fase_director,
      puerta: a.puerta_pendiente,
      decision: dec,
      efecto: n === a.fase_director ? 'Sigue en la misma fase' : `${reabre ? 'Reabre' : 'Pasa a'} la fase ${n} (${FASES[n]})`,
      // Lo que Juan pide medir desde el primer asunto: cuántos mensajes tuvo que escribir el
      // abogado por su cuenta (no las respuestas a una pregunta de Robin) y si corrigió en la puerta.
      ...(Number.isInteger(Number(prompts_abogado)) && Number(prompts_abogado) >= 0 ? { prompts_abogado: Number(prompts_abogado) } : {}),
      ...(typeof correccion === 'boolean' ? { correccion } : {}),
    };
    a.decisiones.push(entrada);
    if (Array.isArray(riesgos_aceptados) && riesgos_aceptados.length) {
      a.riesgos_aceptados = [...(a.riesgos_aceptados || []), ...riesgos_aceptados.map(texto).filter(Boolean)];
    }
    if (reabre) {
      a.cambios_detectados = [
        ...(a.cambios_detectados || []),
        { fecha: t, cambio: texto(motivo_reapertura) || dec, paso_reabierto: n },
      ];
    }
    a.fase_director = n;
    a.puerta_pendiente = texto(puerta_siguiente) || PUERTAS[n];
    a.actualizado_en = t;
    return { tocados: [a.asunto_id], resultado: { ok: true, asunto: vista(a), decision_registrada: entrada } };
  });
}

// Una decisión que no cambia de fase (la vía procesal antes de redactar, un destinatario…).
export function anotarDecision(id, { decision, puerta }) {
  const dec = texto(decision);
  if (!dec) return { ok: false, error: 'Falta "decision": lo que ha decidido el abogado, con sus palabras.' };
  const datos = cargar();
  const b = buscar(datos, id);
  if (!b.ok) return b;
  return conAlmacen((d) => {
    const a = d.asuntos[b.asunto.asunto_id];
    const entrada = { fecha: ahora(), fase: a.fase_director, puerta: texto(puerta) || a.puerta_pendiente, decision: dec };
    a.decisiones.push(entrada);
    a.actualizado_en = entrada.fecha;
    return { tocados: [a.asunto_id], resultado: { ok: true, decision_registrada: entrada, num_decisiones: a.decisiones.length } };
  });
}

export function cerrar(id, { decision, alCerrarActivo }) {
  const dec = texto(decision);
  if (!dec) return { ok: false, error: 'Falta "decision": cerrar un asunto lo decide el abogado; pásalo con sus palabras.' };
  const datos = cargar();
  const b = buscar(datos, id);
  if (!b.ok) return b;
  const r = conAlmacen((d) => {
    const a = d.asuntos[b.asunto.asunto_id];
    const t = ahora();
    a.decisiones.push({ fecha: t, fase: a.fase_director, puerta: 'Cerrar el asunto', decision: dec, efecto: 'Asunto cerrado (se conserva)' });
    a.estado = 'cerrado';
    a.actualizado_en = t;
    return { tocados: [a.asunto_id], resultado: a };
  });
  if (_activo === r.asunto_id) {
    _activo = null;
    alCerrarActivo?.();
  }
  return { ok: true, asunto: vista(r, { conDecisiones: false }) };
}

export function reabrir(id, { decision }) {
  const dec = texto(decision);
  if (!dec) return { ok: false, error: 'Falta "decision": reabrir un asunto cerrado lo decide el abogado.' };
  const datos = cargar();
  const b = buscar(datos, id);
  if (!b.ok) return b;
  return conAlmacen((d) => {
    const a = d.asuntos[b.asunto.asunto_id];
    const t = ahora();
    a.decisiones.push({ fecha: t, fase: a.fase_director, puerta: 'Reabrir el asunto', decision: dec, efecto: 'Asunto reabierto' });
    a.estado = 'abierto';
    a.actualizado_en = t;
    return { tocados: [a.asunto_id], resultado: { ok: true, asunto: vista(a, { conDecisiones: false }) } };
  });
}

// Para las pruebas.
export function _olvidarActivo() {
  _activo = null;
  _activados.clear();
}

export default {
  FASES, PUERTAS, listar, leer, crear, activar, actualizar, resolverPuerta, anotarDecision, cerrar, reabrir,
};
