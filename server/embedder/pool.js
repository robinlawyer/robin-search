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
const MEMORIA_POR_HILO = 800 * MB;
// Memoria libre por debajo de la cual el equipo entero empieza a fallar (el OCR aborta, un hilo
// no carga): se sueltan los hilos de más en vez de esperar a los dos minutos de ocio.
// 6-nov-2026: en el equipo de un cliente, con el sistema por debajo de 400 MB libres, el motor de
// OCR abortaba, los hilos no cargaban («no_carga» una y otra vez, uno cada tres segundos) y el
// proceso acabó muerto. Un hilo menos es ir más lento; insistir es morir.
const SUELO_LIBRE = Number(process.env.ROBIN_EMBED_SUELO_LIBRE_MB || 700) * MB;
const PRESION_CADA_MS = 5000;
// Tras un hilo que no carga, no se vuelve a intentar crecer durante un rato (y a la tercera, ya
// no se intenta más en toda la ejecución): cada intento carga un modelo y, si lo que falta es
// memoria, el propio intento la remata.
const ESPERA_TRAS_NO_CARGAR_MS = Number(process.env.ROBIN_EMBED_ESPERA_NO_CARGA_MS || 60000);
const MAX_FALLOS_DE_CARGA = 3;
// Un fallo del motor de JS del hilo (memoria agotada) mata al hilo, no al proceso: sin esto, un
// `FatalProcessOutOfMemory` dentro de un worker_thread se lleva RobinSearch entero. El tope es
// holgado (el pico medido de un hilo entero, WASM incluido, son ~678 MB) para que no muerda.
const LIMITES_HILO = { maxOldGenerationSizeMb: 1024, maxYoungGenerationSizeMb: 64 };

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
let _lotesPartidos = 0;
let _respaldoEnCurso = false;
let _arranqueEscalonado = null;
let _avisadoMemoria = false;
let _temporizadorOcio = null;
let _sinCrecerHasta = 0;
let _fallosDeCarga = 0;
let _ultimaPresion = 0;
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
    h.w = new Worker(new URL('./hilo.js', import.meta.url), { workerData: _opc.datosHilo, execArgv: [], resourceLimits: LIMITES_HILO });
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
      retirar(h, 'no_carga', m.error);
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

function retirar(h, motivo, causa = null) {
  if (h.muerto) return;
  h.muerto = true;
  _hilos = _hilos.filter((x) => x !== h);
  h.w?.terminate().catch(() => {});
  // La causa, SIEMPRE. Hasta la 1.12.9 esto decía solo «motivo: no_carga» y en el informe de un
  // equipo que se estaba quedando sin memoria no había forma de saber qué había fallado dentro
  // del hilo (6-nov-2026).
  if (motivo !== 'apagar') {
    avisar('info', 'Hilo de embedding retirado', {
      motivo,
      causa: causa ? String(causa).slice(0, 300) : h.ultimoError ? String(h.ultimoError).slice(0, 300) : null,
      libre_mb: Math.round(os.freemem() / MB),
      hilos: vivos().length,
    });
  }
}

function anotarMuerte() {
  const ahora = Date.now();
  _muertesTotales += 1;
  _muertes = _muertes.filter((t) => ahora - t < VENTANA_MUERTES_MS);
  _muertes.push(ahora);
}

// 🔴 7-nov-2026 (equipo Windows de un cliente, 16 GB con 1,3-3,6 libres): «failed to call
// OrtRun(). error code = 6» una y otra vez con los MISMOS documentos (.msg de 11 MB y de 3,5 MB),
// que se quedaban sin indexar. Es el motor sin memoria para calcular un lote de 16 fragmentos
// largos (el pico de memoria crece con el tamaño del lote): repetir el mismo lote tres veces
// fallaba tres veces. Ahora, a la segunda, el lote se PARTE en dos, y así hasta fragmentos sueltos:
// con lotes pequeños cabe. Un vector calculado en otro lote difiere en el redondeo (coseno ≈0,997,
// ver la cabecera): mucho mejor que un documento fuera del índice.
function partirLote(lote) {
  const mitad = Math.ceil(lote.textos.length / 2);
  const hijos = [lote.textos.slice(0, mitad), lote.textos.slice(mitad)].map((textos) => {
    const hijo = { textos, intentos: 1, consulta: lote.consulta, partido: true };
    hijo.promesa = new Promise((resolve, reject) => {
      hijo.resolve = resolve;
      hijo.reject = reject;
    });
    return hijo;
  });
  Promise.all(hijos.map((h) => h.promesa)).then(([a, b]) => {
    const v = new Float32Array(a.length + b.length);
    v.set(a);
    v.set(b, a.length);
    lote.resolve(v);
  }, lote.reject);
  // Delante de la cola y en orden: son trabajo ya empezado.
  const cola = lote.consulta ? _consultas : _pasajes;
  cola.unshift(...hijos);
  _lotesPartidos += 1;
}

function loteCaido(h, causa) {
  const lote = h.lote;
  h.lote = null;
  _hilos = _hilos.filter((x) => x !== h);
  if (!lote) return;
  lote.intentos += 1;
  if (lote.intentos >= 2 && lote.textos.length > 1) {
    avisar('info', 'Lote de embedding partido en dos tras fallar', { fragmentos: lote.textos.length, causa: String(causa ?? '').slice(0, 200), libre_mb: Math.round(os.freemem() / MB) });
    partirLote(lote);
    return;
  }
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
      anotarNoCarga(r.error);
      retirar(h, 'no_carga', r.error);
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
        lote.resolve(await calcularPartiendo(_opc.respaldo, lote.textos));
      } catch (err) {
        lote.reject(err);
      }
    }
  } finally {
    _respaldoEnCurso = false;
  }
}

// En un solo hilo (respaldo, o sin hilos): si el lote falla, se calcula por mitades, hasta
// fragmentos sueltos. Solo un fragmento que falla SOLO hace fallar el documento.
export async function calcularPartiendo(fn, textos) {
  try {
    return await fn(textos);
  } catch (err) {
    if (textos.length <= 1) throw err;
    const mitad = Math.ceil(textos.length / 2);
    const a = await calcularPartiendo(fn, textos.slice(0, mitad));
    const b = await calcularPartiendo(fn, textos.slice(mitad));
    const v = new Float32Array(a.length + b.length);
    v.set(a);
    v.set(b, a.length);
    return v;
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
    vigilarPresion();
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
    ...(_lotesPartidos ? { lotes_partidos: _lotesPartidos } : {}),
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
  // Lo que ocupa un hilo: el tokenizador, la sesión WASM y lo que crece la memoria del WASM al
  // calcular y ya no devuelve. Una cifra fija y no el RSS medido al cargar: con el sistema
  // paginando, la medida bailaba cientos de MB y con ella el número de hilos.
  //
  // 800 MB, no 1150 (21-sep-2026). El 1150 era una suma a ojo (0,25 + 0,45 + 0,45) y se quedó
  // un 70 % por encima de lo que gasta de verdad: medido el peor caso posible —ocho rondas de
  // lotes de 16 fragmentos de 512 tokens, el tope del troceado—, el PICO del proceso fue de
  // 678 MB. Con 800 quedan ~120 MB de margen sobre ese pico, y en un equipo de 8 GB caben tres
  // hilos en vez de dos sin tocar el límite del 30 %: en el Mac de Alonso, 521 documentos a un
  // hilo iban a 0,2 documentos por segundo. El límite del 30 % NO se toca: el sitio para Claude,
  // Word y el resto sigue siendo sagrado.
  _memoriaPorHilo = MEMORIA_POR_HILO;
  avisar('info', 'Hilo de embedding listo', { ms: r.ms, memoria_por_hilo_mb: Math.round(_memoriaPorHilo / MB) });
  _opc.ajustarPorMemoria = ajustarPorMemoria;
  repartir();
  return true;
}

// ¿Hace falta otro hilo? Hay demanda si queda algún lote esperando O si TODOS los hilos vivos
// están ocupados: en los dos casos, un hilo más adelantaría trabajo.
//
// 🔴 ANTES SE MIRABA SOLO LA COLA, Y ASÍ EL POOL NO CRECÍA NUNCA (21-sep-2026, medido en el Mac de
// Alonso: 521 documentos indexándose con UN hilo, más de media hora, sin una sola línea de «Hilo
// de embedding listo»). El motivo: `calcular()` llama primero a `repartir()`, que entrega el lote
// al hilo libre y lo SACA de la cola, y después a `ampliar()`, que se encontraba la cola vacía y
// se volvía por donde había venido. Con un solo hilo, el indexador manda los documentos de uno en
// uno —porque mira cuántos hilos hay—, así que nunca se acumulaba cola: el pool no crecía porque
// era pequeño y era pequeño porque no crecía.
export function hayDemanda({ cola = _pasajes.length, hilos = vivos() } = {}) {
  if (cola > 0) return true;
  return hilos.length > 0 && hilos.every((h) => h.lote);
}

// Un hilo que no carga: no se vuelve a intentar enseguida (y a la tercera, ya no se intenta).
function anotarNoCarga(error) {
  _fallosDeCarga += 1;
  _sinCrecerHasta = Date.now() + ESPERA_TRAS_NO_CARGAR_MS;
  if (_fallosDeCarga === MAX_FALLOS_DE_CARGA) {
    _limite = {
      motivo: 'no_cargan',
      explicacion:
        `Se trabaja con ${vivos().length} hilo(s) de cálculo: los demás no han podido cargar el modelo ` +
        `(${String(error ?? '').slice(0, 200)}). Suele ser falta de memoria en el equipo; cerrando alguna ` +
        'aplicación pesada y reiniciando Claude se vuelven a usar todos. El indexado va más lento, pero termina igual.',
      hilos: vivos().length,
      libre_mb: Math.round(os.freemem() / MB),
      total_mb: Math.round(os.totalmem() / MB),
    };
    avisar('warn', 'No se intentan más hilos de embedding: el modelo no carga', { fallos: _fallosDeCarga, causa: String(error ?? '').slice(0, 200), libre_mb: _limite.libre_mb });
  }
}

// Con el equipo por debajo del suelo de memoria libre, los hilos de más se sueltan YA.
function vigilarPresion() {
  if (process.platform === 'darwin') return; // os.freemem() allí no dice la verdad (ver cabeOtroHilo)
  if (_modo !== 'hilos') return;
  const ahora = Date.now();
  if (ahora - _ultimaPresion < PRESION_CADA_MS) return;
  _ultimaPresion = ahora;
  if (os.freemem() >= SUELO_LIBRE) return;
  const sobrantes = vivos().filter((h) => h.listo && !h.lote);
  if (vivos().length - sobrantes.length < 1) sobrantes.pop();
  for (const h of sobrantes) retirar(h, 'poca memoria en el equipo');
  _sinCrecerHasta = ahora + ESPERA_TRAS_NO_CARGAR_MS;
  if (sobrantes.length) {
    avisar('warn', 'Poca memoria libre en el equipo: se sueltan hilos de embedding', {
      libre_mb: Math.round(os.freemem() / MB),
      suelo_mb: Math.round(SUELO_LIBRE / MB),
      quedan: vivos().length,
    });
  }
}

// Más hilos SOLO cuando hay indexado que hacer: la instancia que solo busca (Claude arranca dos) o
// un servidor con todo al día se queda con uno, que ocupa lo mismo que el modelo en el hilo
// principal de antes.
function ampliar() {
  if (_arranqueEscalonado || _modo !== 'hilos' || vivos().length >= _opc.objetivo || !hayDemanda()) return;
  if (_fallosDeCarga >= MAX_FALLOS_DE_CARGA || Date.now() < _sinCrecerHasta) return;
  _arranqueEscalonado = (async () => {
    // Soltar antes de empezar: sin esto, si el bucle no entra, el `finally` corre antes de que
    // se asigne _arranqueEscalonado y la promesa ya resuelta lo dejaba bloqueado para siempre.
    await null;
    try {
      while (_modo === 'hilos' && vivos().length < _opc.objetivo && hayDemanda()) {
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
          anotarNoCarga(rr.error);
          retirar(h, 'no_carga', rr.error);
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
