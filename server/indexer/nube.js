// Documentos que están en la carpeta pero NO en el disco: iCloud, OneDrive, Dropbox.
//
// Hasta la 1.8.1 se contaban («202 ficheros sin descargar», «72 ficheros vacíos») y ahí se
// quedaban: el abogado tenía doscientos documentos que no salían en ninguna búsqueda y nadie se
// lo decía. Contarlos no es arreglarlo. Lo que hace falta es lo que haría una persona: PEDIR la
// descarga y volver a mirar hasta que el fichero esté.
//
//   · Se apunta el fichero como PENDIENTE (no como error) y se pide su descarga a la nube.
//   · Se vuelve a mirar cada poco, con espera creciente: 2 min, 5, 15, 45, 2 h… hasta un día.
//   · En cuanto tiene contenido, se indexa como cualquier otro documento y deja de estar pendiente.
//   · Si después de un día entero sigue a cero bytes, es que está vacío de verdad: se dice como
//     lo que es (un documento vacío, nada que indexar) y se deja de insistir.
//
// La lista se guarda en disco: apagar el ordenador no puede perder los documentos que faltaban.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { rutas } from '../rutas.js';
import { log } from '../logger.js';

const ESPERAS_MS = [2, 5, 15, 45, 120, 360, 720].map((m) => m * 60 * 1000);
// A partir de aquí, un fichero que sigue sin contenido es un fichero vacío, no uno por descargar.
const SE_DA_POR_VACIO_MS = Number(process.env.ROBIN_NUBE_DIAS_MAX || 1) * 24 * 60 * 60 * 1000;
// Cuántas descargas se piden de una vez: no se le pide a iCloud doscientos ficheros a la vez, ni
// se ocupa la línea del despacho a media mañana.
const POR_TANDA = Number(process.env.ROBIN_NUBE_POR_TANDA || 20);
const REVISAR_CADA_MS = Number(process.env.ROBIN_NUBE_REVISAR_MS) || 2 * 60 * 1000;

const _pend = new Map();  // clave de ruta → { ruta, motivo, desde, intentos, proximo, pedida }
let _cargado = false;
let _timer = null;

const ruta_lista = () => path.join(config.dataDir, 'pendientes-nube.json');
const clave = (p) => {
  try {
    return rutas.claveRuta(p);
  } catch {
    return String(p);
  }
};

function cargar() {
  if (_cargado) return;
  _cargado = true;
  try {
    const datos = JSON.parse(fs.readFileSync(ruta_lista(), 'utf8'));
    for (const e of datos?.pendientes || []) if (e?.ruta) _pend.set(clave(e.ruta), e);
  } catch {
    /* no hay lista todavía */
  }
}

function guardar() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(ruta_lista(), JSON.stringify({ pendientes: [..._pend.values()] }), 'utf8');
  } catch (err) {
    log.warn('No se pudo guardar la lista de documentos por descargar', { err: String(err?.message ?? err) });
  }
}

// ¿Tiene ya contenido? 'si' | 'no' | 'desaparecido'
export function estadoEnDisco(ruta) {
  let st;
  try {
    st = fs.statSync(ruta);
  } catch (err) {
    return err?.code === 'ENOENT' || err?.code === 'ENOTDIR' ? 'desaparecido' : 'no';
  }
  if (!st.isFile()) return 'desaparecido';
  if (st.size === 0) return 'no';
  // Con tamaño pero sin bloques asignados sigue siendo un marcador (iCloud/OneDrive en Mac y
  // Linux). En Windows `stat` no lo dice: allí basta con que tenga tamaño.
  if (process.platform !== 'win32' && st.blocks === 0) return 'no';
  return 'si';
}

// Pedirle a la nube que traiga el fichero. Cada sistema tiene su manera, y ninguna es un
// convertidor ni un binario que empaquetemos: es el propio cliente de sincronización del equipo.
function pedirDescarga(ruta) {
  if (process.platform === 'darwin') {
    // `brctl` viene con macOS y es lo que usa el Finder al pulsar la nubecita.
    try {
      const hijo = spawn('/usr/bin/brctl', ['download', ruta], { stdio: 'ignore', detached: false });
      hijo.on('error', () => { /* no está iCloud por medio: se reintentará al mirar */ });
      setTimeout(() => { try { hijo.kill(); } catch { /* ya terminó */ } }, 30_000).unref?.();
      return true;
    } catch {
      return false;
    }
  }
  // Windows (OneDrive/Dropbox) y Linux: el contenido se trae solo al LEERLO. Se leen unos bytes,
  // que es justo lo que dispara la descarga bajo demanda, y se deja al sincronizador trabajar.
  try {
    const fd = fs.openSync(ruta, 'r');
    try {
      fs.readSync(fd, Buffer.alloc(1), 0, 1, 0);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

// Apunta un documento que está en la carpeta pero no en el disco, y pide su descarga.
export function apuntar(ruta, motivo = 'sin_descargar') {
  cargar();
  const k = clave(ruta);
  const ya = _pend.get(k);
  if (ya) return ya;
  const e = { ruta, motivo, desde: new Date().toISOString(), intentos: 0, proximo: Date.now(), pedida: false };
  _pend.set(k, e);
  guardar();
  return e;
}

export function olvidar(ruta) {
  cargar();
  if (_pend.delete(clave(ruta))) guardar();
}

export function lista() {
  cargar();
  return [..._pend.values()].map((e) => ({ ...e }));
}

export function cuantos() {
  cargar();
  return _pend.size;
}

// Una pasada: pide las descargas que toquen y devuelve los que YA se pueden indexar.
export async function revisar({ indexar = null, forzar = false } = {}) {
  cargar();
  const ahora = Date.now();
  const listos = [];
  const vacios = [];
  let pedidas = 0;
  for (const [k, e] of [..._pend]) {
    if (!forzar && e.proximo > ahora) continue;
    const estado = estadoEnDisco(e.ruta);
    if (estado === 'desaparecido') {
      _pend.delete(k);
      continue;
    }
    if (estado === 'si') {
      _pend.delete(k);
      listos.push(e.ruta);
      continue;
    }
    if (ahora - Date.parse(e.desde) > SE_DA_POR_VACIO_MS) {
      _pend.delete(k);
      vacios.push(e.ruta);
      continue;
    }
    if (pedidas < POR_TANDA) {
      e.pedida = pedirDescarga(e.ruta);
      pedidas += 1;
    }
    e.intentos += 1;
    e.proximo = ahora + (ESPERAS_MS[Math.min(e.intentos, ESPERAS_MS.length - 1)]);
  }
  guardar();
  if (listos.length) {
    log.info('Documentos que ya se han descargado de la nube: se indexan', { n: listos.length });
    if (indexar) {
      for (const r of listos) {
        try {
          await indexar(r);
        } catch (err) {
          log.warn('No se pudo indexar un documento recién descargado', { err: String(err?.message ?? err) });
        }
      }
    }
  }
  if (vacios.length) {
    log.info('Documentos que llevan un día sin contenido: se dan por vacíos', { n: vacios.length });
  }
  return { listos: listos.length, vacios: vacios.length, pendientes: _pend.size, pedidas };
}

// Revisión periódica. `indexar(ruta)` es lo que hay que hacer con el que ya está descargado.
export function arrancar({ indexar = null } = {}) {
  if (_timer) return;
  _timer = setInterval(() => {
    revisar({ indexar }).catch((err) => log.warn('Fallo revisando los documentos por descargar', { err: String(err?.message ?? err) }));
  }, REVISAR_CADA_MS);
  _timer.unref?.();
}

export function parar() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

export function _limpiarParaPrueba() {
  _pend.clear();
  _cargado = false;
  parar();
  try {
    fs.rmSync(ruta_lista(), { force: true });
  } catch {
    /* nada */
  }
}

export default { apuntar, olvidar, lista, cuantos, revisar, arrancar, parar, estadoEnDisco, _limpiarParaPrueba };
