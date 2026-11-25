// SUPERVISOR de RobinSearch (1.13.0, 7-nov-2026).
//
// 🔴 POR QUÉ EXISTE. Hasta la 1.12.x el servidor MCP que lanza Claude ERA el proceso que indexa:
// lee PDF con mupdf/pdfjs, pasa OCR con tesseract (WASM), calcula vectores con onnxruntime (WASM),
// abre ZIP/RAR/7z (WASM)… Cualquier fallo de cualquiera de esos motores —un «Aborted()» de
// tesseract (fmchocarro, 6-nov), un «memory access out of bounds» de un WASM (Eduardo, 31-oct y
// 2-nov), el montón de V8 lleno con un expediente de 114.000 documentos— se llevaba el proceso
// entero, Claude decía «RobinSearch dejó de ejecutarse» y no había más indexado ni más búsquedas
// hasta reiniciar Claude. Cada cliente nuevo traía un motor que fallaba de una forma nueva.
//
// Arreglar cada fallo sigue siendo obligatorio, pero ya no es lo único que separa al abogado de
// un RobinSearch muerto: el proceso que habla con Claude es ESTE, que no carga ningún motor ni
// toca ningún documento, y el servidor de verdad corre en un hilo aislado (worker_threads) que se
// repone solo si muere. Claude no se entera: el supervisor repite el saludo MCP al hilo nuevo,
// reenvía lo que estaba en vuelo (si se puede repetir sin efectos) y el indexado sigue donde iba.
//
// POR QUÉ UN HILO Y NO UN PROCESO HIJO. En Windows (y en el Mac sin Node instalado) Claude ejecuta
// RobinSearch con el Node que lleva dentro, un «UtilityProcess» de Electron, y Claude tiene el
// fusible RunAsNode APAGADO (leído del binario de Claude 4.29.0: `RunAsNode 0`): lanzar
// `process.execPath otro.js` abriría OTRA ventana de Claude, no un Node. Un hilo funciona igual en
// los tres sistemas y con cualquier Node, y aísla lo que de verdad nos ha tumbado: excepciones de
// los WASM y el montón de V8 lleno (el hilo tiene su propio límite: si se llena, muere el hilo).
//
// MOTOR ACTUALIZABLE. El hilo puede ejecutar el servidor que viene en la extensión o uno más
// nuevo que el propio RobinSearch se ha descargado, con su huella sha-256 comprobada, en
// <datos>/motor/<versión> (motor.js). Así un arreglo llega a todos los equipos sin que el abogado
// tenga que pulsar nada ni confirmar el cuadro de Claude (Eduardo seguía en la 1.12.2 el 4-nov con
// la 1.12.9 publicada; ggarcia, en la 1.11.4). Si un motor descargado no llega a saludar dos
// veces seguidas, se aparta y se vuelve al de la extensión.
//
// Este fichero NO importa nada del servidor (ni config.js, ni el logger, ni el SDK de MCP): todo
// lo que cargue aquí puede tumbar al proceso que Claude ve. Solo módulos de Node.

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { Worker, SHARE_ENV } from 'node:worker_threads';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { dataDirEfectivo } from './datos-dir.js';

// Versión del contrato supervisor ↔ motor. Un motor descargado declara en su package.json
// (`robinSupervisor`) qué contrato entiende; uno que no lo declare no se usa.
export const CONTRATO_SUPERVISOR = 1;

const RAIZ_INCLUIDA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MB = 1048576;

// Esperas antes de reponer el hilo según cuántas muertes seguidas lleva (sin haber vivido 5 min).
const ESPERAS_MS = (process.env.ROBIN_SUPERVISOR_ESPERAS_MS || '500,1000,2000,5000,10000,30000,60000')
  .split(',')
  .map((n) => Number(n))
  .filter((n) => Number.isFinite(n) && n >= 0);
const VIDA_SANA_MS = Number(process.env.ROBIN_SUPERVISOR_VIDA_SANA_MS) || 5 * 60 * 1000;
// Con el hilo caído más de esto, las peticiones se contestan en vez de quedarse esperando.
const ESPERA_PACIENTE_MS = 5000;
const CIERRE_MAX_MS = 8000;
// Un motor que arranca pero no contesta al saludo en este tiempo se da por roto (el saludo no
// espera al índice: el trabajo pesado empieza después).
const SALUDO_MAX_MS = Number(process.env.ROBIN_SUPERVISOR_SALUDO_MS) || 40_000;

// ── Registro ─────────────────────────────────────────────────────────────────────────────────
// Por stderr (Claude lo guarda en su registro) y en el registro propio, con el mismo formato que
// logger.js, para que el diagnóstico del servidor lo lea como sus propias líneas.
let _dataDir = null;
function registrar(nivel, msg, data) {
  try {
    process.stderr.write(`robin-search: ${msg}${data ? ` ${JSON.stringify(data)}` : ''}\n`);
  } catch {
    /* stderr roto: da igual */
  }
  try {
    if (!_dataDir) return;
    const dir = path.join(_dataDir, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'robin-search.log'), `${JSON.stringify({ t: new Date().toISOString(), level: nivel, msg, ...(data ? { data } : {}) })}\n`);
  } catch {
    /* sin registro en disco se sigue igual */
  }
}

// ── Qué motor ejecutar ───────────────────────────────────────────────────────────────────────
function leerJsonSeguro(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return null;
  }
}

export function compararVersiones(a, b) {
  const x = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  }
  return 0;
}

export const dirMotores = (dataDir) => path.join(dataDir, 'motor');
const rutaDescartados = (dataDir) => path.join(dirMotores(dataDir), 'descartados.json');

export function motoresDescartados(dataDir) {
  const d = leerJsonSeguro(rutaDescartados(dataDir));
  return Array.isArray(d?.versiones) ? d.versiones.map(String) : [];
}

function descartarMotor(dataDir, version, motivo) {
  try {
    const lista = new Set(motoresDescartados(dataDir));
    lista.add(String(version));
    fs.mkdirSync(dirMotores(dataDir), { recursive: true });
    fs.writeFileSync(rutaDescartados(dataDir), JSON.stringify({ versiones: [...lista], ultimo: { version, motivo, t: new Date().toISOString() } }));
  } catch {
    /* sin disco: se volvería a probar, y a descartar */
  }
}

// El motor que trae la extensión y, si lo hay, uno descargado más nuevo, verificado y no descartado.
// `entrada`: el módulo del servidor dentro de ese motor (server/index.js o server/pasada.js).
export function elegirMotor({ dataDir, raizIncluida = RAIZ_INCLUIDA, entrada = 'server/index.js', soloIncluido = false } = {}) {
  const incluido = {
    raiz: raizIncluida,
    version: leerJsonSeguro(path.join(raizIncluida, 'package.json'))?.version || '0.0.0',
    descargado: false,
  };
  if (soloIncluido || process.env.ROBIN_MOTOR_SOLO_INCLUIDO === '1' || !dataDir) return { ...incluido, entrada: path.join(raizIncluida, entrada) };
  let mejor = null;
  const descartados = new Set(motoresDescartados(dataDir));
  let nombres = [];
  try {
    nombres = fs.readdirSync(dirMotores(dataDir));
  } catch {
    nombres = [];
  }
  for (const n of nombres) {
    if (!/^\d+\.\d+\.\d+$/.test(n) || descartados.has(n)) continue;
    const raiz = path.join(dirMotores(dataDir), n);
    const ficha = leerJsonSeguro(path.join(raiz, 'robin-motor.json'));
    const pkg = leerJsonSeguro(path.join(raiz, 'package.json'));
    // Solo un motor TERMINADO de instalar (la ficha se escribe lo último), de la versión que dice
    // su carpeta, que entienda este supervisor y que tenga la entrada pedida.
    if (!ficha?.sha256 || ficha.version !== n || pkg?.version !== n) continue;
    if (!(Number(pkg.robinSupervisor) >= CONTRATO_SUPERVISOR)) continue;
    if (!fs.existsSync(path.join(raiz, entrada))) continue;
    if (compararVersiones(n, incluido.version) <= 0) continue;
    if (!mejor || compararVersiones(n, mejor.version) > 0) mejor = { raiz, version: n, descargado: true };
  }
  const elegido = mejor || incluido;
  return { ...elegido, entrada: path.join(elegido.raiz, entrada) };
}

// ── Lo que deja un hilo muerto ───────────────────────────────────────────────────────────────
// El servidor muerto compartía pid con el que lo sustituye, y tres cosas del servidor se fían del
// pid para saber si su dueño vive: la marca de fase (diagnostico.js), el cerrojo del índice
// (escritor.js) y los cerrojos de la sesión (auth/cerrojo.js). Con el pid vivo, el hilo nuevo
// habría tomado la marca por «otra instancia en marcha» (y nunca se habría sabido de la caída) y
// habría esperado dos minutos de lector antes de poder volver a indexar.
export function recogerHiloMuerto({ dataDir, generacion, codigo, error, version }) {
  const pid = process.pid;
  const out = { marca: false, cerrojos: 0 };
  if (!dataDir) return out;
  // 1) La marca de fase pasa a llevar el número del hilo: así es de un hilo MUERTO aunque el pid
  //    viva, y el siguiente arranque (de este proceso o de otra instancia) la cuenta como caída.
  const ruta = path.join(dataDir, `en_curso-${pid}.json`);
  const destino = path.join(dataDir, `en_curso-${pid}-h${generacion}.json`);
  const muerte = { codigo: codigo ?? null, error: error ? String(error).slice(0, 300) : null, t: new Date().toISOString() };
  try {
    let marca = leerJsonSeguro(ruta);
    if (!marca) {
      // Murió sin fase abierta (p. ej. el montón lleno entre dos documentos): igual se deja dicho,
      // para que se sepa —y se avise— que hubo una caída.
      marca = { pid, fase: 'en_marcha', t: muerte.t, latido: muerte.t, version: version || null };
    }
    marca.muerte_hilo = muerte;
    fs.writeFileSync(destino, JSON.stringify(marca));
    fs.rmSync(ruta, { force: true });
    out.marca = true;
  } catch {
    /* sin marca no hay aviso, pero el hilo nuevo arranca igual */
  }
  // 2) Cerrojos con nuestro pid: solo los podía tener el hilo que acaba de morir.
  let nombres = [];
  try {
    nombres = fs.readdirSync(dataDir);
  } catch {
    nombres = [];
  }
  for (const n of nombres) {
    if (!n.endsWith('.lock')) continue;
    const r = path.join(dataDir, n);
    let txt = '';
    try {
      txt = fs.readFileSync(r, 'utf8').trim();
    } catch {
      continue;
    }
    let suyo = txt === String(pid);
    if (!suyo) {
      try {
        suyo = JSON.parse(txt)?.pid === pid;
      } catch {
        suyo = false;
      }
    }
    if (!suyo) continue;
    try {
      fs.rmSync(r, { force: true });
      out.cerrojos += 1;
    } catch {
      /* lo caducará el tiempo */
    }
  }
  return out;
}

// ── Mensajes JSON-RPC ────────────────────────────────────────────────────────────────────────
const claveId = (id) => `${typeof id}:${id}`;

function lector(alLinea) {
  const dec = new StringDecoder('utf8');
  let resto = '';
  return {
    meter(chunk) {
      resto += typeof chunk === 'string' ? chunk : dec.write(chunk);
      let i;
      while ((i = resto.indexOf('\n')) !== -1) {
        const linea = resto.slice(0, i).replace(/\r$/, '');
        resto = resto.slice(i + 1);
        if (linea.trim()) alLinea(linea);
      }
    },
  };
}

function analizar(linea) {
  try {
    const m = JSON.parse(linea);
    return m && typeof m === 'object' ? m : null;
  } catch {
    return null;
  }
}

const TEXTO_REPUESTO =
  'RobinSearch se ha repuesto de un fallo interno mientras atendía esta petición. El indexado sigue solo y ' +
  'los documentos no se han perdido. Vuelve a lanzar la petición.';
const TEXTO_REPONIENDO =
  'RobinSearch se está reponiendo de un fallo interno y estará de vuelta en unos segundos. El indexado sigue ' +
  'solo y los documentos no se han perdido. Vuelve a lanzar la petición en un momento.';

// ── El supervisor del servidor MCP ───────────────────────────────────────────────────────────
// `entrada` / `raizIncluida` son para las pruebas; en producción se elige con elegirMotor.
export function supervisarServidor({ raizIncluida = RAIZ_INCLUIDA, entrada = null, entradaMotor = 'server/index.js', stdin = process.stdin, stdout = process.stdout, salir = (c) => process.exit(c) } = {}) {
  _dataDir = dataDirEfectivo();
  const heapMb = Math.max(1024, Math.round(v8.getHeapStatistics().heap_size_limit / MB));

  let hilo = null;
  let generacion = 0;
  let motor = null;
  let nacio = 0;
  let listo = false; // el hilo actual ya puede recibir lo de Claude
  let saludo = null; // { linea, id } — el `initialize` de Claude
  let saludoInicializado = null; // la línea `notifications/initialized`
  let saludoRespondido = false; // Claude ya tiene respuesta a su initialize
  let idReplay = null;
  let cerrando = false;
  let reinicioPedido = null; // { motivo }
  let muertesSeguidas = 0;
  let fallosSinSaludo = 0;
  let caidoDesde = 0;
  let temporizador = null;
  let huboCliente = false;
  let topeSaludo = null;
  const vigilarSaludo = (gen) => {
    if (topeSaludo) clearTimeout(topeSaludo);
    topeSaludo = setTimeout(() => {
      topeSaludo = null;
      if (gen !== generacion || !hilo) return;
      registrar('error', 'El motor no contesta al saludo: se da por roto', { version: motor?.version, ms: SALUDO_MAX_MS });
      hilo.terminate().catch(() => {});
    }, SALUDO_MAX_MS);
    topeSaludo.unref?.();
  };
  const saludoContestado = () => {
    if (topeSaludo) clearTimeout(topeSaludo);
    topeSaludo = null;
  };
  let herramientas = null; // la última respuesta a tools/list (para contestar con el hilo caído)
  const soloLectura = new Set();
  const pendientes = new Map(); // clave → { linea, id, metodo, herramienta, intentos, gen }
  const cola = []; // líneas de Claude que esperan a un hilo listo

  const aClaude = (obj) => {
    try {
      stdout.write(`${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n`);
    } catch {
      /* stdout roto: se atiende en su 'error' */
    }
  };

  const alHilo = (linea) => {
    try {
      hilo.stdin.write(`${linea}\n`);
      return true;
    } catch {
      return false;
    }
  };

  function contestarSinHilo(p, texto) {
    if (p.metodo === 'tools/call') {
      aClaude({ jsonrpc: '2.0', id: p.id, result: { content: [{ type: 'text', text: texto }], isError: true } });
    } else {
      aClaude({ jsonrpc: '2.0', id: p.id, error: { code: -32603, message: texto } });
    }
  }

  // Lo que llega de Claude.
  function deClaude(linea) {
    huboCliente = true;
    const m = analizar(linea);
    if (m && m.method !== undefined && m.id !== undefined && m.id !== null) {
      if (m.method === 'initialize') saludo = { linea, id: m.id };
      const p = { linea, id: m.id, metodo: m.method, herramienta: m.method === 'tools/call' ? m.params?.name : null, intentos: 0, gen: null };
      pendientes.set(claveId(m.id), p);
      if (!listo && hiloCaidoDemasiado()) {
        if (responderSinHilo(p)) return;
      }
    } else if (m && m.method === 'notifications/initialized') {
      saludoInicializado = linea;
    }
    if (listo) enviar(linea, m);
    else cola.push(linea);
  }

  function enviar(linea, m = analizar(linea)) {
    if (m?.id !== undefined && m.method !== undefined) {
      const p = pendientes.get(claveId(m.id));
      if (p) p.gen = generacion;
      if (m.method === 'initialize') vigilarSaludo(generacion);
    }
    alHilo(linea);
  }

  function hiloCaidoDemasiado() {
    return caidoDesde && Date.now() - caidoDesde > ESPERA_PACIENTE_MS && saludoRespondido;
  }

  // Con el hilo caído un rato, lo que se puede contestar sin él se contesta; lo demás, con un
  // error que dice qué pasa. Devuelve true si la petición quedó contestada.
  function responderSinHilo(p) {
    if (p.metodo === 'ping') {
      pendientes.delete(claveId(p.id));
      aClaude({ jsonrpc: '2.0', id: p.id, result: {} });
      return true;
    }
    if (p.metodo === 'tools/list' && herramientas) {
      pendientes.delete(claveId(p.id));
      aClaude({ jsonrpc: '2.0', id: p.id, result: herramientas });
      return true;
    }
    if (p.metodo === 'initialize') return false;
    pendientes.delete(claveId(p.id));
    contestarSinHilo(p, TEXTO_REPONIENDO);
    return true;
  }

  // Lo que sale del hilo.
  function delHilo(linea, gen) {
    if (gen !== generacion) return; // un hilo viejo que aún escribe al morir
    const m = analizar(linea);
    if (!m || m.jsonrpc !== '2.0') {
      // stdout es SOLO del protocolo; algo que no es JSON no puede llegar a Claude.
      registrar('warn', 'El motor escribió en la salida del protocolo algo que no es un mensaje', { bytes: linea.length });
      return;
    }
    if (m.id !== undefined && m.method === undefined) {
      if (idReplay !== null && m.id === idReplay) {
        idReplay = null;
        saludoContestado();
        if (m.error) {
          registrar('error', 'El motor repuesto no aceptó el saludo', { err: String(m.error?.message || '').slice(0, 200) });
          return;
        }
        listo = true;
        fallosSinSaludo = 0;
        if (saludoInicializado) alHilo(saludoInicializado);
        vaciarCola();
        return;
      }
      const clave = claveId(m.id);
      const p = pendientes.get(clave);
      if (p) {
        pendientes.delete(clave);
        if (p.metodo === 'initialize') saludoContestado();
        if (p.metodo === 'initialize' && !m.error) {
          saludoRespondido = true;
          fallosSinSaludo = 0;
        }
        if (p.metodo === 'tools/list' && m.result?.tools) {
          herramientas = m.result;
          soloLectura.clear();
          for (const t of m.result.tools) if (t?.annotations?.readOnlyHint === true || t?.annotations?.idempotentHint === true) soloLectura.add(t.name);
        }
      }
    }
    aClaude(linea);
  }

  function vaciarCola() {
    // Primero lo que estaba en vuelo cuando murió el anterior (en su orden), luego lo que llegó
    // mientras tanto.
    const enVuelo = [...pendientes.values()].filter((p) => p.gen !== null && p.gen !== generacion && p.reenviar);
    for (const p of enVuelo) {
      p.reenviar = false;
      enviar(p.linea);
    }
    while (cola.length && listo) enviar(cola.shift());
    if (reinicioPedido) intentarReinicioOrdenado();
  }

  function arrancarHilo() {
    temporizador = null;
    if (cerrando) return;
    generacion += 1;
    const gen = generacion;
    motor = entrada
      ? { raiz: raizIncluida, version: leerJsonSeguro(path.join(raizIncluida, 'package.json'))?.version || '0.0.0', descargado: false, entrada }
      : elegirMotor({ dataDir: _dataDir, raizIncluida, entrada: entradaMotor });
    listo = false;
    idReplay = null;
    nacio = Date.now();
    try {
      hilo = new Worker(motor.entrada, {
        stdin: true,
        stdout: true,
        stderr: false,
        env: SHARE_ENV,
        argv: process.argv.slice(2),
        // Vacío, como el pool de embedding: alguna opción del proceso no vale para un hilo
          // (ERR_INPUT_TYPE_NOT_ALLOWED, o las de Electron en el Node de Claude) y el hilo no arrancaría.
          execArgv: [],
        name: `robinsearch-motor-${gen}`,
        resourceLimits: { maxOldGenerationSizeMb: heapMb },
        workerData: { robinSupervisor: CONTRATO_SUPERVISOR, generacion: gen, motor: { version: motor.version, descargado: motor.descargado, raizIncluida } },
      });
    } catch (err) {
      registrar('error', 'No se pudo arrancar el motor de RobinSearch', { err: String(err?.message || err).slice(0, 300), version: motor.version });
      return alMorir(gen, 1, err);
    }
    if (motor.descargado) registrar('info', 'Motor de RobinSearch actualizado en uso', { version: motor.version });
    const leer = lector((l) => delHilo(l, gen));
    hilo.stdout.on('data', (c) => leer.meter(c));
    hilo.stdout.on('error', () => {});
    hilo.stdin.on('error', () => {});
    let ultimoError = null;
    hilo.on('error', (err) => {
      ultimoError = err;
      registrar('error', 'El motor de RobinSearch ha fallado', { err: String(err?.stack || err?.message || err).slice(0, 600), code: err?.code || null });
    });
    hilo.on('message', (m) => alMensaje(m, gen));
    hilo.on('exit', (codigo) => alMorir(gen, codigo, ultimoError));

    if (!saludoRespondido) {
      // Primer hilo (o uno que murió antes de contestar al saludo): Claude habla directamente.
      listo = true;
      vaciarCola();
      // El initialize en vuelo del hilo muerto se reenvía tal cual: es la respuesta que Claude espera.
    } else if (saludo) {
      idReplay = `robin-supervisor-${gen}`;
      const s = analizar(saludo.linea);
      alHilo(JSON.stringify({ ...s, id: idReplay }));
      vigilarSaludo(gen);
    } else {
      listo = true;
      vaciarCola();
    }
  }

  function alMensaje(m, gen) {
    if (gen !== generacion || !m || typeof m !== 'object' || !m.robin) return;
    if (m.robin === 'dataDir' && typeof m.dataDir === 'string') _dataDir = m.dataDir;
    if (m.robin === 'motor-nuevo') {
      const nuevo = elegirMotor({ dataDir: _dataDir, raizIncluida, entrada: entradaMotor });
      if (entrada || (nuevo.raiz === motor?.raiz && nuevo.version === motor?.version)) return;
      registrar('info', 'Motor nuevo listo: se cambia en cuanto no haya peticiones en curso', { de: motor?.version, a: nuevo.version });
      reinicioPedido = { motivo: 'motor' };
      intentarReinicioOrdenado();
    }
  }

  let esperaReinicio = null;
  function intentarReinicioOrdenado() {
    if (!reinicioPedido || !hilo || !listo || cerrando) return;
    const enCurso = [...pendientes.values()].some((p) => p.gen === generacion);
    const pedidoHace = (reinicioPedido.desde ||= Date.now());
    if (enCurso && Date.now() - pedidoHace < 60_000) {
      if (!esperaReinicio) {
        esperaReinicio = setTimeout(() => {
          esperaReinicio = null;
          intentarReinicioOrdenado();
        }, 500);
        esperaReinicio.unref?.();
      }
      return;
    }
    reinicioPedido.enMarcha = true;
    listo = false;
    try {
      hilo.stdin.end();
    } catch {
      /* ya cerrado */
    }
    const h = hilo;
    setTimeout(() => h.terminate().catch(() => {}), CIERRE_MAX_MS).unref?.();
  }

  function alMorir(gen, codigo, error) {
    if (gen !== generacion) return;
    saludoContestado();
    hilo = null;
    listo = false;
    if (cerrando) return salir(0);
    const ordenado = Boolean(reinicioPedido?.enMarcha);
    const vivio = Date.now() - nacio;
    // Lo que estaba en vuelo en ese hilo.
    for (const p of [...pendientes.values()]) {
      if (p.gen !== gen) continue;
      p.intentos += 1;
      const repetible = p.metodo !== 'tools/call' || soloLectura.has(p.herramienta);
      if (p.metodo === 'initialize' && !saludoRespondido) {
        // Claude sigue esperando la respuesta a SU saludo: se reenvía al hilo nuevo tal cual.
        cola.unshift(p.linea);
        p.gen = null;
      } else if (ordenado || (repetible && p.intentos <= 1)) {
        p.reenviar = true;
      } else {
        pendientes.delete(claveId(p.id));
        contestarSinHilo(p, TEXTO_REPUESTO);
      }
    }
    if (ordenado) {
      reinicioPedido = null;
      registrar('info', 'Motor de RobinSearch reiniciado para cambiar de versión');
      return arrancarHilo();
    }
    // Una caída.
    const recogido = recogerHiloMuerto({ dataDir: _dataDir, generacion: gen, codigo, error: error?.message || error, version: motor?.version });
    const sinSaludar = idReplay !== null || !saludoRespondido;
    if (sinSaludar) fallosSinSaludo += 1;
    registrar('error', 'El motor de RobinSearch se ha caído: se repone solo', {
      codigo,
      vivio_s: Math.round(vivio / 1000),
      version: motor?.version,
      descargado: Boolean(motor?.descargado),
      sin_saludar: sinSaludar,
      marca: recogido.marca,
      cerrojos: recogido.cerrojos,
    });
    if (motor?.descargado && fallosSinSaludo >= 2) {
      // Un motor descargado que no consigue ni arrancar se aparta: se vuelve al de la extensión.
      descartarMotor(_dataDir, motor.version, `no arranca (código ${codigo})`);
      registrar('error', 'El motor descargado no arranca: se vuelve al de la extensión', { version: motor.version });
      fallosSinSaludo = 0;
    } else if (!motor?.descargado && !saludoRespondido && fallosSinSaludo >= 3) {
      // El de la extensión no llega ni a saludar a Claude (Node que no sirve, disco ilegible…):
      // como antes, que Claude lo diga.
      registrar('error', 'RobinSearch no consigue arrancar', { codigo });
      return salir(typeof codigo === 'number' && codigo !== 0 ? codigo : 1);
    }
    muertesSeguidas = vivio > VIDA_SANA_MS ? 1 : muertesSeguidas + 1;
    const espera = ESPERAS_MS[Math.min(muertesSeguidas - 1, ESPERAS_MS.length - 1)] ?? 1000;
    caidoDesde = caidoDesde || Date.now();
    temporizador = setTimeout(() => {
      caidoDesde = 0;
      arrancarHilo();
    }, espera);
    // Si se espera mucho, lo que ya está en cola no puede quedarse colgado.
    if (espera > ESPERA_PACIENTE_MS) {
      setTimeout(() => {
        if (listo || cerrando) return;
        for (const p of [...pendientes.values()]) if (p.gen === null || p.reenviar) responderSinHilo(p) && quitarDeCola(p);
      }, ESPERA_PACIENTE_MS).unref?.();
    }
  }

  function quitarDeCola(p) {
    const i = cola.indexOf(p.linea);
    if (i !== -1) cola.splice(i, 1);
    p.reenviar = false;
  }

  function apagar(motivo) {
    if (cerrando) return;
    cerrando = true;
    registrar('info', 'Cierre del supervisor de RobinSearch', { motivo });
    if (temporizador) clearTimeout(temporizador);
    if (!hilo) return salir(0);
    // El servidor cierra ordenado al quedarse sin entrada (suelta el índice, borra su marca).
    try {
      hilo.stdin.end();
    } catch {
      /* ya cerrado */
    }
    const h = hilo;
    setTimeout(() => {
      h.terminate()
        .catch(() => {})
        .finally(() => salir(0));
    }, CIERRE_MAX_MS).unref?.();
  }

  // Entrada de Claude.
  const leerClaude = lector(deClaude);
  stdin.on('data', (c) => leerClaude.meter(c));
  stdin.on('error', () => {});
  // Sin cliente (stdin a /dev/null: pruebas, un servicio de IT) el fin llega al instante y no
  // significa que nadie se haya ido.
  stdin.on('end', () => {
    if (huboCliente) apagar('stdin_cerrado');
  });
  stdout.on?.('error', () => apagar('salida_cerrada'));
  process.stderr.on?.('error', () => {});
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    try {
      process.on(s, () => apagar(s));
    } catch {
      /* señal no disponible en esta plataforma */
    }
  }
  arrancarHilo();
  return {
    apagar,
    get generacion() {
      return generacion;
    },
    get motor() {
      return motor;
    },
  };
}

// ── La pasada de una vez (--silent, la que lanza RobinDesktop con Claude cerrado) ───────────────
// También en un hilo: si un documento tumba el motor, se repone y se sigue hasta acabar (el
// documento sospechoso se reintenta una vez y después se aparta, como en el servidor).
export function supervisarPasada({ raizIncluida = RAIZ_INCLUIDA, entrada = null, maxCaidas = Number(process.env.ROBIN_PASADA_MAX_CAIDAS) || 25 } = {}) {
  _dataDir = dataDirEfectivo();
  const heapMb = Math.max(1024, Math.round(v8.getHeapStatistics().heap_size_limit / MB));
  return new Promise((resolver) => {
    let caidas = 0;
    let generacion = 0;
    let hilo = null;
    let parar = false;
    let pararPedido = false;
    const terminar = (codigo) => {
      if (parar) return;
      parar = true;
      resolver(codigo);
    };
    // Cierre pedido (RobinDesktop cuando vuelve Claude): se le pide al hilo que pare LIMPIO —suelta
    // el índice y borra su marca—, así el siguiente arranque no lo toma por una caída ni pone bajo
    // sospecha el documento que estaba leyendo. Antes de la 1.13.0 el modo --silent no atendía
    // ninguna señal: ceder el turno a Claude era un corte en seco.
    const pedirParada = () => {
      if (pararPedido) return;
      pararPedido = true;
      if (!hilo) return terminar(0);
      hilo.postMessage({ robin: 'parar' });
      const h = hilo;
      setTimeout(() => h.terminate().catch(() => {}).finally(() => terminar(0)), CIERRE_MAX_MS).unref?.();
    };
    for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
      try {
        process.on(s, pedirParada);
      } catch {
        /* señal no disponible */
      }
    }
    // En Windows no hay señales que atender (kill = corte en seco): quien lance la pasada con
    // ROBIN_PASADA_PARAR_POR_STDIN=1 le pide parar CERRANDO su entrada. Solo con la variable: un
    // despliegue de IT con la entrada vacía la cerraría al instante.
    if (process.env.ROBIN_PASADA_PARAR_POR_STDIN === '1' && process.stdin) {
      process.stdin.on('end', pedirParada);
      process.stdin.on('error', () => {});
      process.stdin.resume();
      process.stdin.unref?.();
    }
    const lanzar = () => {
      generacion += 1;
      const gen = generacion;
      const motor = entrada
        ? { raiz: raizIncluida, version: leerJsonSeguro(path.join(raizIncluida, 'package.json'))?.version, descargado: false, entrada }
        : elegirMotor({ dataDir: _dataDir, raizIncluida, entrada: 'server/pasada.js' });
      let error = null;
      try {
        hilo = new Worker(motor.entrada, {
          env: SHARE_ENV,
          argv: process.argv.slice(2),
          // Vacío, como el pool de embedding: alguna opción del proceso no vale para un hilo
          // (ERR_INPUT_TYPE_NOT_ALLOWED, o las de Electron en el Node de Claude) y el hilo no arrancaría.
          execArgv: [],
          name: `robinsearch-pasada-${gen}`,
          resourceLimits: { maxOldGenerationSizeMb: heapMb },
          workerData: { robinSupervisor: CONTRATO_SUPERVISOR, generacion: gen, pasada: true, motor: { version: motor.version, descargado: motor.descargado, raizIncluida } },
        });
      } catch (err) {
        registrar('error', 'No se pudo arrancar la pasada de indexado', { err: String(err?.message || err).slice(0, 300) });
        return terminar(1);
      }
      hilo.on('error', (err) => {
        error = err;
      });
      hilo.on('exit', (codigo) => {
        hilo = null;
        if (parar) return;
        if (pararPedido) return terminar(0);
        if (codigo === 0 || codigo === 2) return terminar(codigo);
        if (codigo === 3) return terminar(1); // terminó, con errores (pasada.js)
        caidas += 1;
        const recogido = recogerHiloMuerto({ dataDir: _dataDir, generacion: gen, codigo, error: error?.message || error, version: motor.version });
        registrar('error', 'La pasada de indexado se ha caído: se repone y sigue', { codigo, caidas, marca: recogido.marca, version: motor.version });
        if (motor.descargado && caidas >= 2) descartarMotor(_dataDir, motor.version, `pasada caída (código ${codigo})`);
        if (caidas >= maxCaidas) return terminar(1);
        // Sin unref: este temporizador es lo único que mantiene vivo el proceso hasta relanzar.
        setTimeout(lanzar, Math.min(30_000, 500 * caidas));
      });
    };
    lanzar();
  });
}

export default { supervisarServidor, supervisarPasada, elegirMotor, recogerHiloMuerto, compararVersiones, CONTRATO_SUPERVISOR };
