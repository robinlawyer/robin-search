// Canal de control local: deja que la app de escritorio vea lo que está
// pasando (progreso de indexado, errores) y pida un reindexado.
//
// POR QUÉ UN SOCKET CON NOMBRE Y NO UN PUERTO. Un puerto en 127.0.0.1 es
// exactamente lo que bloquean los antivirus/EDR de despacho — nos costó un
// abogado entero el 10-sep-2026. Un socket de dominio UNIX (mac/Linux) o una
// tubería con nombre (Windows) no es tráfico de red: no lo filtra ningún
// cortafuegos ni escudo web.
//
// El estado vive en la MEMORIA de este proceso (state.js). Sin este canal, la
// app solo puede leer el índice ya escrito en disco: sabe cuántos documentos
// hay, pero no que en este momento van 34 de 120.
//
// Regla de oro: esto es un accesorio. Si falla, se registra y el servidor MCP
// sigue exactamente igual. Nunca puede tumbar el trabajo del abogado.
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { config, guardarCarpetas, carpetasFijadasPorEntorno } from './config.js';
import { log } from './logger.js';
import { state, alCambiar } from './state.js';
import { indexFolder, indexandoAhora, alTerminarIndexado } from './indexer/indexer.js';
import { startWatcher, stopWatcher } from './watcher/watcher.js';

// Un nombre por carpeta de datos: dos instalaciones distintas (p. ej. un
// segundo perfil) no se pisan.
function nombreCanal() {
  const huella = crypto.createHash('sha256').update(config.dataDir).digest('hex').slice(0, 8);
  return `robinsearch-${huella}`;
}

export function rutaCanal() {
  if (process.platform === 'win32') return `\\\\.\\pipe\\${nombreCanal()}`;
  // `/tmp` A PROPÓSITO, y no os.tmpdir().
  //
  // os.tmpdir() NO vale aquí: este servidor lo lanza Claude Desktop, y ese
  // proceso no hereda el TMPDIR por usuario de la sesión gráfica de macOS. El
  // servidor acababa abriendo /tmp/robinsearch-<x>.sock mientras la app de
  // escritorio miraba en /var/folders/…/T/robinsearch-<x>.sock. Mismo nombre,
  // mismo hash, distinto directorio: no se encontraban nunca.
  //
  // Tampoco vale el directorio de datos: la ruta de un socket UNIX no puede
  // pasar de ~104 caracteres y "…/Library/Application Support/RobinLawyer/
  // robin-search/" ya se come 90 con un usuario de nombre normal.
  //
  // /tmp es corto y es el mismo para todos los procesos del equipo. El socket
  // se crea con permisos 0600, así que otro usuario no puede leerlo, y el
  // nombre lleva el hash del directorio de datos: dos instalaciones distintas
  // no se pisan.
  return path.join('/tmp', `${nombreCanal()}.sock`);
}

let servidor = null;
const clientes = new Set();
let ultimoEnvio = 0;
let pendiente = null;
let ultimaFase; // fase/estado del último envío: un cambio de fase sale siempre, sin esperar

function retrato() {
  return {
    tipo: 'estado',
    version: config.version,
    estado: state.estado,
    progreso: state.progreso,          // { procesados, total, ficheroActual } o null
    ultimoError: state.ultimoError ? String(state.ultimoError.message ?? state.ultimoError) : null,
    ultimoIndexado: state.ultimoIndexado,
    carpetas: config.watchedFolders,
    sinTexto: state.ficherosSinOcr ? state.ficherosSinOcr.size : 0,
    actualizacionDisponible: state.actualizacionDisponible,
    ts: Date.now(),
  };
}

function enviar(socket, objeto) {
  try {
    socket.write(JSON.stringify(objeto) + '\n');
  } catch {
    /* cliente que se fue: se limpia solo en 'close' */
  }
}

// Un indexado grande cambia el estado miles de veces. Se emite como mucho dos
// veces por segundo: la app pinta una barra, no necesita cada fichero. Los CAMBIOS DE FASE
// (buscando → indexando → fin) salen al momento: agrupados, una fase corta desaparecía y la
// app no llegaba a saber que había empezado.
export function anunciar() {
  if (!clientes.size) return;
  const ahora = Date.now();
  const fase = `${state.estado}|${state.progreso?.fase ?? ''}`;
  const espera = fase !== ultimaFase ? 0 : 500 - (ahora - ultimoEnvio);
  if (espera > 0) {
    if (!pendiente) {
      pendiente = setTimeout(() => { pendiente = null; anunciar(); }, espera);
      if (pendiente.unref) pendiente.unref();
    }
    return;
  }
  if (pendiente) {
    clearTimeout(pendiente);
    pendiente = null;
  }
  ultimoEnvio = ahora;
  ultimaFase = fase;
  const r = retrato();
  for (const c of clientes) enviar(c, r);
}

// Lo que la app pide con un indexado ya en marcha (el del arranque, o uno anterior) NO se
// rechaza: el abogado ha pulsado un botón y tiene que pasar algo. Se pone en cola y sale en
// cuanto termine el actual. null = nada · 'todas' = todas las carpetas · Set = esas carpetas.
let reindexando = false;
let enCola = null;
let colaForce = false;

function carpetaVigilada(carpeta) {
  const pedida = path.resolve(String(carpeta));
  return config.watchedFolders.find((c) => path.resolve(c) === pedida) ?? null;
}

function encolar(carpetas, force) {
  if (!carpetas) enCola = 'todas';
  else if (enCola !== 'todas') {
    enCola = enCola || new Set();
    for (const c of carpetas) enCola.add(c);
  }
  colaForce = colaForce || force;
}

function drenarCola() {
  if (!enCola || reindexando || indexandoAhora()) return;
  const siguiente = enCola;
  const force = colaForce;
  enCola = null;
  colaForce = false;
  lanzar(null, siguiente === 'todas' ? null : [...siguiente].filter(carpetaVigilada), force).catch((err) =>
    log.warn('Fallo lanzando el reindexado en cola', { err: String(err) }),
  );
}

// `carpeta`: solo esa (el botón «Indexar ahora» de cada carpeta en la app); sin ella, todas.
async function reindexar(socket, { force = false, carpeta = null } = {}) {
  let carpetas = null;
  if (carpeta) {
    const vigilada = carpetaVigilada(carpeta);
    if (!vigilada) {
      return enviar(socket, { tipo: 'respuesta', cmd: 'reindexar', ok: false, motivo: 'carpeta_no_vigilada', carpeta });
    }
    carpetas = [vigilada];
  }
  if (reindexando || indexandoAhora()) {
    encolar(carpetas, force);
    return enviar(socket, { tipo: 'respuesta', cmd: 'reindexar', ok: true, encolado: true, carpetas: carpetas ?? config.watchedFolders });
  }
  return lanzar(socket, carpetas, force);
}

async function lanzar(socket, carpetas, force) {
  if (carpetas && !carpetas.length) return;
  const cuales = carpetas ?? config.watchedFolders;
  reindexando = true;
  if (socket) enviar(socket, { tipo: 'respuesta', cmd: 'reindexar', ok: true, iniciado: true, carpetas: cuales });
  try {
    const resumen = await indexFolder({ folders: carpetas ?? undefined, force, reconciliarBorrados: true, onProgress: anunciar });
    log.info('Reindexado a petición de la app', resumen);
    for (const c of clientes) enviar(c, { tipo: 'fin-reindexado', ok: true, resumen, carpetas: cuales });
  } catch (err) {
    log.error('Fallo el reindexado pedido por la app', { err: String(err) });
    for (const c of clientes) enviar(c, { tipo: 'fin-reindexado', ok: false, motivo: String(err?.message ?? err), carpetas: cuales });
  } finally {
    reindexando = false;
    anunciar();
    drenarCola();
  }
}

// Cambiar las carpetas desde la app: se guardan, se aplican EN CALIENTE (sin
// reiniciar Claude) y se indexa lo nuevo. Antes esto vivía en la pantalla de
// configuración de Claude y obligaba a reiniciarlo.
async function configurar(socket, { carpetas }) {
  if (!Array.isArray(carpetas)) {
    return enviar(socket, { tipo: 'respuesta', cmd: 'configurar', ok: false, motivo: 'carpetas_invalidas' });
  }
  try {
    const aplicadas = guardarCarpetas(carpetas);
    // Si las carpetas vienen impuestas por el entorno, lo guardado NO es lo
    // vigilado. Se dice y no se reindexa: al abogado no se le puede enseñar un
    // «ya se está indexando» que no va a ocurrir.
    if (carpetasFijadasPorEntorno()) {
      log.warn('Carpetas guardadas pero NO aplicadas: las fija el entorno', { guardadas: carpetas });
      return enviar(socket, {
        tipo: 'respuesta', cmd: 'configurar', ok: false, motivo: 'fijadas_por_entorno',
        guardadas: carpetas, vigiladas: config.watchedFolders,
      });
    }
    log.info('Carpetas de expedientes cambiadas desde la app', { carpetas: aplicadas });
    try {
      await stopWatcher();          // es asíncrono: sin await se solapan dos vigilantes
      if (aplicadas.length) startWatcher();
    } catch (err) {
      log.warn('No se pudo reiniciar el vigilante de carpetas', { err: String(err) });
    }
    enviar(socket, { tipo: 'respuesta', cmd: 'configurar', ok: true, carpetas: aplicadas });
    anunciar();
    if (aplicadas.length) reindexar(socket, { force: false }).catch((err) => log.warn('Fallo en el reindexado', { err: String(err) }));
  } catch (err) {
    log.error('Fallo guardando las carpetas', { err: String(err) });
    enviar(socket, { tipo: 'respuesta', cmd: 'configurar', ok: false, motivo: String(err?.message ?? err) });
  }
}

function atender(socket) {
  clientes.add(socket);
  socket.setEncoding('utf8');
  enviar(socket, retrato());

  let buffer = '';
  socket.on('data', (trozo) => {
    buffer += trozo;
    // Un cliente que no manda saltos de línea no puede hacernos crecer sin fin.
    if (buffer.length > 64 * 1024) { buffer = ''; return; }
    let corte;
    while ((corte = buffer.indexOf('\n')) >= 0) {
      const linea = buffer.slice(0, corte).trim();
      buffer = buffer.slice(corte + 1);
      if (!linea) continue;
      let msg;
      try { msg = JSON.parse(linea); } catch { continue; }
      if (msg.cmd === 'estado') enviar(socket, retrato());
      // Sin esperar, pero NUNCA sin catch: una promesa rechazada sin recoger tumba el servidor.
      else if (msg.cmd === 'reindexar') reindexar(socket, msg).catch((err) => log.warn('Fallo en el reindexado', { err: String(err) }));
      else if (msg.cmd === 'configurar') configurar(socket, msg).catch((err) => log.warn('Fallo configurando', { err: String(err) }));
      else enviar(socket, { tipo: 'respuesta', ok: false, motivo: 'orden_desconocida' });
    }
  });
  socket.on('error', () => { /* se cae solo; 'close' limpia */ });
  socket.on('close', () => clientes.delete(socket));
}

// Arranca el canal. Si el nombre ya está cogido por OTRA instancia viva (Claude
// Desktop y Claude Code a la vez), esta instancia simplemente no sirve control:
// no es motivo para fallar.
export async function iniciarControl() {
  const ruta = rutaCanal();
  try {
    if (process.platform !== 'win32' && fs.existsSync(ruta)) {
      // ¿Socket huérfano de un proceso muerto? Se comprueba conectando.
      const vivo = await new Promise((resolve) => {
        const s = net.connect(ruta);
        const fin = (v) => { try { s.destroy(); } catch { /* nada */ } resolve(v); };
        s.once('connect', () => fin(true));
        s.once('error', () => fin(false));
        setTimeout(() => fin(false), 400).unref?.();
      });
      if (vivo) {
        log.info('Canal de control ya servido por otra instancia', { ruta });
        return null;
      }
      try { fs.unlinkSync(ruta); } catch { /* seguimos */ }
    }

    servidor = net.createServer(atender);
    servidor.on('error', (err) => {
      log.warn('Canal de control no disponible', { err: String(err) });
      servidor = null;
    });
    // Con el 'error' del listen atendido: sin él, un EADDRINUSE (el nombre lo ocupa otra
    // instancia que arrancó a la vez) dejaba esta promesa colgada para siempre.
    await new Promise((resolve, reject) => {
      const alFallar = (err) => reject(err);
      servidor.once('error', alFallar);
      servidor.listen(ruta, () => {
        servidor.off('error', alFallar);
        resolve();
      });
    });
    if (process.platform !== 'win32') {
      // Solo el dueño. Sin esto, otro usuario del mismo equipo podría ver los
      // nombres de fichero de los expedientes.
      try { fs.chmodSync(ruta, 0o600); } catch { /* best-effort */ }
    }
    if (servidor.unref) servidor.unref();  // nunca debe impedir que el proceso cierre
    alCambiar(anunciar);                   // cada cambio de estado llega a la app
    alTerminarIndexado(drenarCola);        // lo encolado sale cuando acaba el indexado en curso
    log.info('Canal de control abierto', { ruta });
    return ruta;
  } catch (err) {
    log.warn('No se pudo abrir el canal de control', { err: String(err) });
    return null;
  }
}

export function detenerControl() {
  try { servidor?.close(); } catch { /* nada */ }
  servidor = null;
  for (const c of clientes) { try { c.destroy(); } catch { /* nada */ } }
  clientes.clear();
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(rutaCanal()); } catch { /* nada */ }
  }
}

export default { iniciarControl, detenerControl, anunciar, rutaCanal };
