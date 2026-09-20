// Pool de hilos de trabajo para el embedding (worker_threads propios, ver hilo.js).
//
// Por qué: medido el 16-sep-2026 sobre un corpus sintético de escritos en español, el embedding es
// el ~95 % del tiempo de indexado (extracción ~1,4 %, índice y registro <1 %), y onnxruntime-web
// en Node solo sabe usar UN núcleo (sin proxy ni pthreads, ver motor.js). Con 20.000 ficheros eso
// son horas de un solo núcleo mientras los demás esperan, y además con el hilo principal
// bloqueado: Claude no recibía respuesta mientras se calculaba un lote.
//
// Reglas del pool:
// - Cada hilo carga su modelo (el mismo, empaquetado en models/) y calcula un lote cada vez.
// - Arranque escalonado: primero UNO; con él listo se mide cuánta memoria ocupa y solo se añaden
//   más mientras quepan en la memoria libre (un portátil de 8 GB con Word, Outlook y Claude
//   abiertos no puede cargar cuatro modelos a la vez).
// - La unidad de trabajo es el LOTE tal cual lo arma quien llama (embedder.js: los fragmentos de un
//   documento de 16 en 16, en orden, como siempre). El pool no mezcla ni reordena fragmentos: el
//   modelo cuantizado calcula la escala de cuantización de las activaciones sobre el lote entero,
//   así que el mismo texto en otro lote da un vector algo distinto (coseno ≈0,997, medido). Con
//   los mismos lotes, los vectores son idénticos bit a bit a los del hilo principal y a los de los
//   índices ya creados.
// - Si un hilo muere (memoria agotada, fallo del WASM) su lote NO se pierde: se reintenta en otro
//   hilo (hasta MAX_INTENTOS; si sigue tumbando el motor, falla solo ese documento) y el hilo se
//   repone. Si mueren demasiados seguidos, o ninguno llega a cargar, se vuelve al cálculo en el
//   hilo principal, como antes de los hilos: nunca peor que hoy.
// - Las consultas del abogado pasan delante de los lotes del indexado.

import { Worker } from 'node:worker_threads';
import os from 'node:os';

const MAX_INTENTOS = 3; // por lote, contando el primero
const VENTANA_MUERTES_MS = 60 * 1000;
const MAX_MUERTES_EN_VENTANA = 6;
const MB = 1024 * 1024;
const MEMORIA_POR_HILO = 1150 * MB;

let _opc = null; // { objetivo, datosHilo, topeCargaMs, respaldo, avisar }
let _hilos = [];
let _consultas = [];
let _pasajes = [];
let _modo = 'apagado'; // 'apagado' | 'arrancando' | 'hilos' | 'respaldo'
let _motivo = null;
let _muertes = [];
let _muertesTotales = 0;
let _memoriaPorHilo = null;
let _siguienteId = 1;
let _respaldoEnCurso = false;
let _arranqueEscalonado = null;
let _avisadoMemoria = false;
let _temporizadorOcio = null;
// Por qué no hay más hilos de los pedidos. Hasta la 1.6.1 esto solo se escribía en el registro
// («no hay memoria para otro hilo, libre_mb: 301»): el abogado veía el indexado ir a un cuarto de
// velocidad y no había forma de saber por qué sin abrir un fichero de log (correo de Eduardo y
// Juan, 19/20-sep-2026). Ahora sale en estado_servidor y en la app.
let _limite = null; // { motivo, explicacion, hilos, libre_mb, total_mb }

function avisar(nivel, msg, datos) {
  try {
    _opc?.avisar?.(nivel, msg, datos);
  } catch {
    /* un aviso roto no rompe el cálculo */
  }
}

// ¿Cabe otro hilo? Dos límites:
// - Entre todos, como mucho el 30 % de la memoria del equipo (8 GB → 2 hilos; 16 GB → 4).
// - Y en Windows y Linux, que haya memoria libre de verdad para uno más (con margen). En macOS
//   os.freemem() solo cuenta páginas LIBRES: la memoria inactiva y la caché, que el sistema
//   entrega en cuanto se pide, no entran, y en un Mac en uso normal sale en unos cientos de MB
//   aunque haya gigas disponibles; allí manda solo el primer límite.
function cabeOtroHilo(hilosActuales) {
  const porHiloMb = Math.round(_memoriaPorHilo / MB);
  const totalMb = Math.round(os.totalmem() / MB);
  const libreMb = Math.round(os.freemem() / MB);
  if ((hilosActuales + 1) * _memoriaPorHilo > os.totalmem() * 0.3) {
    return {
      cabe: false,
      motivo: 'memoria_del_equipo',
      explicacion:
        `Se usan ${hilosActuales} hilo(s) de cálculo en vez de ${_opc?.objetivo ?? hilosActuales}: cada uno necesita ` +
        `unos ${porHiloMb} MB y RobinSearch no pasa del 30 % de la memoria del equipo (${totalMb} MB en total), para ` +
        'dejarle sitio a Claude, a Word y al resto. El indexado va más lento, pero termina igual; con más memoria RAM iría más rápido.',
      hilos: hilosActuales,
      libre_mb: libreMb,
      total_mb: totalMb,
      por_hilo_mb: porHiloMb,
    };
  }
  if (process.platform === 'darwin') return { cabe: true };
  if (os.freemem() < _memoriaPorHilo * 1.2) {
    return {
      cabe: false,
      motivo: 'memoria_libre',
      explicacion:
        `Se usan ${hilosActuales} hilo(s) de cálculo en vez de ${_opc?.objetivo ?? hilosActuales}: cada uno necesita ` +
        `unos ${porHiloMb} MB y ahora mismo quedan ${libreMb} MB libres de ${totalMb} MB. Cerrando alguna aplicación ` +
        'pesada el indexado irá más rápido; tal cual, va más lento pero termina igual.',
      hilos: hilosActuales,
      libre_mb: libreMb,
      total_mb: totalMb,
      por_hilo_mb: porHiloMb,
    };
  }
  return { cabe: true };
}

// Cuántos hilos intentar por defecto: uno por núcleo dejando uno para el sistema y para Claude,
// y como mucho 4 (a partir de ahí la memoria pesa más que lo que se gana).
export function hilosPorDefecto() {
  const nucleos = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(nucleos - 1, 4));
}

function vivos() {
  return _hilos.filter((h) => !h.muerto);
}

function ajustarRef(h) {
  // Un hilo ocupado mantiene vivo el proceso (alguien espera su resultado); uno ocioso no: si no,
  // un proceso sin nada más que hacer (la CLI al terminar) no saldría nunca.
  try {
    if (h.lote || !h.listo) h.w.ref();
    else h.w.unref();
  } catch {
    /* hilo ya terminado */
  }
}

function crearHilo() {
  const h = { id: _siguienteId++, w: null, listo: false, muerto: false, lote: null };
  let alListo;
  h.cargado = new Promise((r) => {
    alListo = r;
  });
  try {
    // execArgv vacío: por defecto el hilo hereda las opciones de arranque del proceso, y alguna no
    // vale para un hilo (con `node --input-type=module -e …` el hilo ni arrancaba:
    // ERR_INPUT_TYPE_NOT_ALLOWED). El hilo no necesita ninguna.
    h.w = new Worker(new URL('./hilo.js', import.meta.url), { workerData: _opc.datosHilo, execArgv: [] });
  } catch (err) {
    h.muerto = true;
    alListo({ ok: false, error: String(err?.message ?? err) });
    return h;
  }
  const tope = setTimeout(() => {
    if (h.listo || h.muerto) return;
    alListo({ ok: false, error: `el modelo no cargó en ${Math.round(_opc.topeCargaMs / 1000)} s` });
    retirar(h, 'tope de carga');
  }, _opc.topeCargaMs);
  tope.unref?.();
  h.w.on('message', (m) => {
    if (m?.tipo === 'listo') {
      clearTimeout(tope);
      h.listo = true;
      alListo({ ok: true, ms: m.ms });
      ajustarRef(h);
      repartir();
    } else if (m?.tipo === 'no_carga') {
      clearTimeout(tope);
      alListo({ ok: false, error: m.error });
      retirar(h, 'no_carga');
    } else if (m?.tipo === 'hecho') {
      terminarLote(h, m);
    } else if (m?.tipo === 'fallo') {
      // Una excepción dentro del modelo puede dejar la sesión WASM en mal estado: el hilo se
      // cambia por uno nuevo y el lote se reintenta como si hubiera muerto.
      anotarMuerte();
      loteCaido(h, m.error);
      retirar(h, 'fallo en lote');
      reponer();
    }
  });
  h.w.on('error', (err) => {
    h.ultimoError = String(err?.code || err?.message || err);
  });
  h.w.on('exit', (code) => {
    clearTimeout(tope);
    if (h.muerto) return;
    h.muerto = true;
    _hilos = _hilos.filter((x) => x !== h);
    if (!h.listo) {
      alListo({ ok: false, error: h.ultimoError || `hilo terminado (código ${code})` });
      return;
    }
    anotarMuerte();
    avisar('warn', 'Hilo de embedding caído: se reintenta su trabajo', { codigo: code, causa: h.ultimoError ?? null });
    loteCaido(h, h.ultimoError || `hilo terminado (código ${code})`);
    reponer();
  });
  // Referenciado mientras carga: que el proceso no salga a mitad (ajustarRef lo suelta al quedar ocioso).
  _hilos.push(h);
  return h;
}

function retirar(h, motivo) {
  if (h.muerto) return;
  h.muerto = true;
  _hilos = _hilos.filter((x) => x !== h);
  h.w?.terminate().catch(() => {});
  if (motivo !== 'apagar') avisar('info', 'Hilo de embedding retirado', { motivo });
}

function anotarMuerte() {
  const ahora = Date.now();
  _muertesTotales += 1;
  _muertes = _muertes.filter((t) => ahora - t < VENTANA_MUERTES_MS);
  _muertes.push(ahora);
}

function loteCaido(h, causa) {
  const lote = h.lote;
  h.lote = null;
  _hilos = _hilos.filter((x) => x !== h);
  if (!lote) return;
  lote.intentos += 1;
  if (lote.intentos >= MAX_INTENTOS) {
    lote.reject(Object.assign(new Error(`El motor de embedding falló calculando este documento: ${causa}`), { code: 'ROBIN_EMBEDDING_CAIDO' }));
    return;
  }
  (lote.consulta ? _consultas : _pasajes).unshift(lote);
}

// Repone un hilo caído, salvo que se estén cayendo demasiados: entonces, al hilo principal.
function reponer() {
  if (_modo !== 'hilos') return;
  if (_muertes.length >= MAX_MUERTES_EN_VENTANA) {
    if (vivos().length === 0) pasarARespaldo(`${_muertes.length} caídas de hilos en un minuto`);
    else repartir();
    return;
  }
  const h = crearHilo();
  h.cargado.then((r) => {
    if (!r.ok) {
      retirar(h, 'no_carga');
      if (vivos().filter((x) => x.listo).length === 0) pasarARespaldo(`no se pudo reponer el hilo: ${r.error}`);
    }
  });
  repartir();
}

function pasarARespaldo(motivo) {
  if (_modo === 'respaldo') return;
  _modo = 'respaldo';
  _motivo = motivo;
  avisar('error', 'Embedding en hilos desactivado: se calcula en el hilo principal', { motivo });
  for (const h of [..._hilos]) retirar(h, 'apagar');
  _hilos = [];
  repartir();
}

function tomarLote() {
  return _consultas.shift() || _pasajes.shift() || null;
}

function enviar(h, lote) {
  lote.id = _siguienteId++;
  h.lote = lote;
  ajustarRef(h);
  try {
    h.w.postMessage({ tipo: 'lote', id: lote.id, textos: lote.textos });
  } catch (err) {
    h.ultimoError = String(err?.message ?? err);
    loteCaido(h, h.ultimoError);
    retirar(h, 'envío fallido');
    reponer();
  }
}

function terminarLote(h, m) {
  const lote = h.lote;
  h.lote = null;
  ajustarRef(h);
  if (lote && lote.id === m.id) lote.resolve(m.vectores);
  repartir();
}

async function respaldoCola() {
  if (_respaldoEnCurso) return;
  _respaldoEnCurso = true;
  try {
    for (let lote = tomarLote(); lote; lote = tomarLote()) {
      try {
        lote.resolve(await _opc.respaldo(lote.textos));
      } catch (err) {
        lote.reject(err);
      }
    }
  } finally {
    _respaldoEnCurso = false;
  }
}

function repartir() {
  if (_modo === 'respaldo') {
    respaldoCola();
    return;
  }
  for (const h of _hilos) {
    if (h.muerto || !h.listo || h.lote) continue;
    const lote = tomarLote();
    if (!lote) break;
    enviar(h, lote);
  }
}

// Vectores de UN lote de textos (ya con su prefijo): Float32Array n × dim, en el mismo orden.
export function calcular(textos, { consulta = false } = {}) {
  if (_modo === 'apagado') return Promise.reject(new Error('pool de embedding no iniciado'));
  const p = new Promise((resolve, reject) => {
    (consulta ? _consultas : _pasajes).push({ textos, resolve, reject, intentos: 0, consulta });
  });
  repartir();
  if (!consulta) {
    ampliar();
    vigilarOcio();
  }
  return p;
}

// Fragmentos esperando o calculándose: el indexado no extrae más documentos mientras haya
// trabajo de sobra en cola (memoria acotada).
export function pendientes() {
  let n = 0;
  for (const l of _pasajes) n += l.textos.length;
  for (const h of _hilos) if (h.lote && !h.lote.consulta) n += h.lote.textos.length;
  return n;
}

// Hilos calculando ahora mismo (o que calcularán en cuanto carguen): para dimensionar la cola.
export function capacidad() {
  if (_modo === 'respaldo') return 1;
  return Math.max(1, vivos().length);
}

export function activo() {
  return _modo === 'hilos';
}

export function estado() {
  return {
    modo: _modo === 'hilos' ? 'hilos' : _modo === 'respaldo' ? 'hilo_principal' : _modo,
    hilos: vivos().filter((h) => h.listo).length,
    ...(_modo === 'hilos' && vivos().some((h) => !h.listo) ? { hilos_cargando: vivos().filter((h) => !h.listo).length } : {}),
    hilos_objetivo: _opc?.objetivo ?? null,
    ...(_memoriaPorHilo ? { memoria_por_hilo_mb: Math.round(_memoriaPorHilo / MB) } : {}),
    ...(_muertesTotales ? { hilos_caidos: _muertesTotales } : {}),
    ...(_motivo ? { motivo: _motivo } : {}),
    // Por qué hay menos hilos de los pedidos: en claro, para que se pueda enseñar tal cual.
    ...(_limite && _modo === 'hilos' && vivos().length < (_opc?.objetivo ?? 1)
      ? { limitado_por: _limite.motivo, por_que_va_lento: _limite.explicacion, memoria_libre_mb: _limite.libre_mb }
      : {}),
  };
}

// Arranca el pool. Resuelve true en cuanto hay UN hilo listo (los demás siguen cargando en
// segundo plano) y false si no se ha podido (quien llama sigue en el hilo principal).
//   objetivo      hilos deseados (1..16)
//   ajustarPorMemoria  si false, se respetan los hilos pedidos aunque la memoria sea justa
//   respaldo(textos) → Float32Array  cálculo en el hilo principal si los hilos dejan de servir
export async function iniciar({ objetivo, datosHilo, topeCargaMs = 180000, ajustarPorMemoria = true, respaldo, avisar: aviso }) {
  if (_modo !== 'apagado') return _modo === 'hilos';
  _opc = { objetivo: Math.max(1, Math.min(16, objetivo | 0)), datosHilo, topeCargaMs, respaldo, avisar: aviso };
  _modo = 'arrancando';
  _motivo = null;
  const primero = crearHilo();
  const r = await primero.cargado;
  if (!r.ok) {
    retirar(primero, 'no_carga');
    _hilos = [];
    _modo = 'apagado';
    _motivo = `los hilos de embedding no arrancan: ${r.error}`;
    avisar('warn', 'Embedding en hilos no disponible: se usa el hilo principal', { motivo: _motivo });
    return false;
  }
  _modo = 'hilos';
  // Lo que ocupa un hilo: ~0,25 GB el tokenizador, ~0,45 GB la sesión WASM y ~0,45 GB más que crece
  // la memoria del WASM al calcular un lote de 16 fragmentos de 512 tokens y ya no devuelve
  // (medido el 16-sep-2026). Una cifra fija y no el RSS medido al cargar: con el sistema paginando,
  // la medida bailaba cientos de MB y con ella el número de hilos.
  _memoriaPorHilo = MEMORIA_POR_HILO;
  avisar('info', 'Hilo de embedding listo', { ms: r.ms, memoria_por_hilo_mb: Math.round(_memoriaPorHilo / MB) });
  _opc.ajustarPorMemoria = ajustarPorMemoria;
  repartir();
  return true;
}

// Más hilos SOLO cuando hay indexado que hacer: la instancia que solo busca (Claude arranca dos) o
// un servidor con todo al día se queda con uno, que ocupa lo mismo que el modelo en el hilo
// principal de antes.
function ampliar() {
  if (_arranqueEscalonado || _modo !== 'hilos' || vivos().length >= _opc.objetivo || !_pasajes.length) return;
  _arranqueEscalonado = (async () => {
    // Soltar antes de empezar: sin esto, si el bucle no entra, el `finally` corre antes de que
    // se asigne _arranqueEscalonado y la promesa ya resuelta lo dejaba bloqueado para siempre.
    await null;
    try {
      while (_modo === 'hilos' && vivos().length < _opc.objetivo && _pasajes.length > 0) {
        const sitio = _opc.ajustarPorMemoria ? cabeOtroHilo(vivos().length) : { cabe: true };
        if (!sitio.cabe) {
          _limite = sitio;
          if (!_avisadoMemoria) {
            _avisadoMemoria = true;
            avisar('info', 'No se cargan más hilos de embedding: no hay memoria para otro', {
              motivo: sitio.motivo,
              hilos: sitio.hilos,
              libre_mb: sitio.libre_mb,
              total_mb: sitio.total_mb,
            });
          }
          break;
        }
        _limite = null;
        const h = crearHilo();
        const rr = await h.cargado;
        if (!rr.ok) {
          retirar(h, 'no_carga');
          break;
        }
      }
    } finally {
      _arranqueEscalonado = null;
    }
  })();
}

// Terminado el indexado, los hilos de más se sueltan: la memoria del WASM no se devuelve nunca
// mientras el hilo viva, y un portátil no puede tener gigas ocupados para esperar a que el
// vigilante encuentre un fichero cambiado. Se vuelven a cargar (unos segundos) si hace falta.
const OCIOSO_MS = Number(process.env.ROBIN_EMBED_OCIOSO_MS) || 2 * 60 * 1000;
function vigilarOcio() {
  if (_temporizadorOcio) clearTimeout(_temporizadorOcio);
  _temporizadorOcio = setTimeout(() => {
    _temporizadorOcio = null;
    if (_modo !== 'hilos' || _pasajes.length || _consultas.length || _arranqueEscalonado) return;
    const sobrantes = vivos().filter((h) => h.listo && !h.lote).slice(1);
    if (vivos().length - sobrantes.length < 1) sobrantes.pop();
    for (const h of sobrantes) retirar(h, 'apagar');
    if (sobrantes.length) avisar('info', 'Hilos de embedding sobrantes liberados', { quedan: vivos().length });
  }, OCIOSO_MS);
  _temporizadorOcio.unref?.();
}

// Para las pruebas y el cierre: espera a que termine el arranque escalonado.
export async function arranqueTerminado() {
  await _arranqueEscalonado;
}

export async function apagar() {
  if (_temporizadorOcio) clearTimeout(_temporizadorOcio);
  const todos = [..._hilos];
  _hilos = [];
  _modo = 'apagado';
  for (const h of todos) {
    h.muerto = true;
    await h.w?.terminate().catch(() => {});
  }
  for (const l of [..._pasajes, ..._consultas]) l.reject(new Error('pool de embedding apagado'));
  _pasajes = [];
  _consultas = [];
}

// Solo pruebas: mata un hilo como lo haría el sistema al quedarse sin memoria.
export function _matarUnHiloParaPrueba() {
  const h = vivos().find((x) => x.listo && x.lote) || vivos().find((x) => x.listo);
  if (!h) return false;
  h.w.terminate();
  return true;
}

export default { iniciar, calcular, pendientes, capacidad, activo, estado, apagar, hilosPorDefecto };
