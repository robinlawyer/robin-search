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
import { indexFolder } from './indexer/indexer.js';
import { startWatcher, stopWatcher } from './watcher/watcher.js';

// Un nombre por carpeta de datos: dos instalaciones distintas (p. ej. un
// segundo perfil) no se pisan.
function nombreCanal() {
  const huella = crypto.createHash('sha256').update(config.dataDir).digest('hex').slice(0, 8);
  return `robinsearch-${huella}`;
}

export function rutaCanal() {
  if (process.platform === 'win32') return `\\\\.\\pipe\\${nombreCanal()}`;
  // En macOS la ruta de un socket no puede pasar de ~104 caracteres, así que
  // NO vale meterlo en "Application Support/...": el directorio temporal del
  // usuario es corto y además privado.
  return path.join(os.tmpdir(), `${nombreCanal()}.sock`);
}

let servidor = null;
const clientes = new Set();
let ultimoEnvio = 0;
let pendiente = null;

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
// veces por segundo: la app pinta una barra, no necesita cada fichero.
export function anunciar() {
  if (!clientes.size) return;
  const ahora = Date.now();
  const espera = 500 - (ahora - ultimoEnvio);
  if (espera > 0) {
    if (!pendiente) {
      pendiente = setTimeout(() => { pendiente = null; anunciar(); }, espera);
      if (pendiente.unref) pendiente.unref();
    }
    return;
  }
  ultimoEnvio = ahora;
  const r = retrato();
  for (const c of clientes) enviar(c, r);
}

let reindexando = false;
async function reindexar(socket, { force = false } = {}) {
  if (reindexando) return enviar(socket, { tipo: 'respuesta', cmd: 'reindexar', ok: false, motivo: 'ya_en_curso' });
  reindexando = true;
  enviar(socket, { tipo: 'respuesta', cmd: 'reindexar', ok: true, iniciado: true });
  try {
    const resumen = await indexFolder({ force, reconciliarBorrados: true, onProgress: anunciar });
    log.info('Reindexado a petición de la app', resumen);
    for (const c of clientes) enviar(c, { tipo: 'fin-reindexado', ok: true, resumen });
  } catch (err) {
    log.error('Fallo el reindexado pedido por la app', { err: String(err) });
    for (const c of clientes) enviar(c, { tipo: 'fin-reindexado', ok: false, motivo: String(err?.message ?? err) });
  } finally {
    reindexando = false;
    anunciar();
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
    if (aplicadas.length) reindexar(socket, { force: false });
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
      else if (msg.cmd === 'reindexar') reindexar(socket, msg);
      else if (msg.cmd === 'configurar') configurar(socket, msg);
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
    await new Promise((resolve) => servidor.listen(ruta, resolve));
    if (process.platform !== 'win32') {
      // Solo el dueño. Sin esto, otro usuario del mismo equipo podría ver los
      // nombres de fichero de los expedientes.
      try { fs.chmodSync(ruta, 0o600); } catch { /* best-effort */ }
    }
    if (servidor.unref) servidor.unref();  // nunca debe impedir que el proceso cierre
    alCambiar(anunciar);                   // cada cambio de estado llega a la app
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
