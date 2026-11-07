// MOTOR AUTOACTUALIZABLE (1.13.0, 7-nov-2026).
//
// 🔴 EL PROBLEMA. Una versión nueva de la extensión solo llegaba al abogado si pulsaba «Actualizar
// ahora» en RobinDesktop y además confirmaba el cuadro de instalación de Claude. Casi nadie lo
// hace: el 4-nov Eduardo seguía en la 1.12.2 con la 1.12.9 publicada, y ggarcia en la 1.11.4, los
// dos cayéndose por fallos ya arreglados. Cada arreglo llegaba solo a los clientes nuevos.
//
// LA SOLUCIÓN, la misma que ya usa RobinDesktop para actualizarse sola (lib/autoinstalar.js): se
// baja el paquete publicado, se comprueba BYTE A BYTE contra la huella sha-256 del fichero de
// versiones (que se sirve por HTTPS desde robinlawyer.ai) y, solo si coincide, se deja listo en
// <datos>/motor/<versión>. El supervisor (supervisor.js, que es lo que Claude ejecuta y no cambia)
// arranca a partir de ese momento el motor más nuevo verificado. No se toca la carpeta de la
// extensión dentro de Claude ni su registro: si Claude instala después una versión aún más nueva,
// manda la de Claude.
//
// Lo que nunca puede pasar: ejecutar algo sin comprobar. Sin huella no se baja nada; con la huella
// distinta se borra lo bajado; la ficha `robin-motor.json` (que es lo que el supervisor exige para
// usar un motor) se escribe lo ÚLTIMO, cuando todo está en su sitio.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isMainThread, workerData, parentPort } from 'node:worker_threads';
import { config, VERSION } from './config.js';
import { log } from './logger.js';
import { cabeceras } from './auth/oauth.js';

const DOMINIOS = /^https:\/\/([a-z0-9-]+\.)*robinlawyer\.ai\//i;
const SIN_DATOS_MS = Number(process.env.ROBIN_MOTOR_SIN_DATOS_MS) || 60_000;
const INTENTOS = 4;

export const supervisado = () => !isMainThread && Number(workerData?.robinSupervisor) >= 1;
const dirMotores = () => path.join(config.dataDir, 'motor');

function compararVersiones(a, b) {
  const x = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  }
  return 0;
}

function descartados() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dirMotores(), 'descartados.json'), 'utf8'));
    return new Set((d?.versiones || []).map(String));
  } catch {
    return new Set();
  }
}

export function motorInstalado(version) {
  try {
    const f = JSON.parse(fs.readFileSync(path.join(dirMotores(), version, 'robin-motor.json'), 'utf8'));
    return f?.version === version && Boolean(f.sha256);
  } catch {
    return false;
  }
}

// Bajada con huella calculada al vuelo, reanudable (Range) y con tope de silencio: una conexión con
// pérdidas se queda parada sin dar error (6-nov-2026, salida del servidor perdiendo el 12 %).
async function bajar(url, destino, sha256) {
  let hechos = 0;
  try {
    hechos = fs.statSync(destino).size;
  } catch {
    hechos = 0;
  }
  for (let intento = 1; intento <= INTENTOS; intento++) {
    const ctl = new AbortController();
    let vigia = null;
    const avivar = () => {
      clearTimeout(vigia);
      vigia = setTimeout(() => ctl.abort(new Error('sin datos')), SIN_DATOS_MS);
      vigia.unref?.();
    };
    try {
      avivar();
      const res = await fetch(url, { signal: ctl.signal, headers: cabeceras(hechos ? { Range: `bytes=${hechos}-` } : {}) });
      if (hechos && res.status !== 206) hechos = 0; // el servidor no reanuda: desde el principio
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const salida = fs.createWriteStream(destino, { flags: hechos ? 'a' : 'w' });
      try {
        for await (const trozo of res.body) {
          avivar();
          if (!salida.write(trozo)) await new Promise((r) => salida.once('drain', r));
          hechos += trozo.length;
        }
      } finally {
        await new Promise((r) => salida.end(r));
      }
      clearTimeout(vigia);
      break;
    } catch (err) {
      clearTimeout(vigia);
      if (intento === INTENTOS) throw err;
      try {
        hechos = fs.statSync(destino).size;
      } catch {
        hechos = 0;
      }
      await new Promise((r) => setTimeout(r, 2000 * intento));
    }
  }
  // La huella decide, sobre el fichero ENTERO tal como quedó en disco.
  const h = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(destino).on('data', (d) => h.update(d)).on('end', resolve).on('error', reject);
  });
  const hecha = h.digest('hex');
  if (hecha !== String(sha256).toLowerCase()) {
    fs.rmSync(destino, { force: true });
    throw new Error('la huella no coincide');
  }
}

// Cerrojo de la bajada: un fichero creado en exclusiva que se RENUEVA mientras se baja (la bajada
// dura minutos; el de auth/cerrojo.js da el suyo por abandonado a los 30 s). Abandonado = más de
// un minuto sin renovar (el que bajaba murió). Devuelve la función que lo suelta, o null.
function tomarCerrojo() {
  const ruta = path.join(dirMotores(), 'bajando.lock');
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(ruta, JSON.stringify({ pid: process.pid, t: new Date().toISOString() }), { flag: 'wx' });
      const renovar = setInterval(() => {
        try {
          const ahora = new Date();
          fs.utimesSync(ruta, ahora, ahora);
        } catch {
          /* nada */
        }
      }, 10_000);
      renovar.unref?.();
      return () => {
        clearInterval(renovar);
        fs.rmSync(ruta, { force: true });
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') return null;
      try {
        if (Date.now() - fs.statSync(ruta).mtimeMs > 60_000) fs.rmSync(ruta, { force: true });
        else return null;
      } catch {
        /* lo soltó entre medias */
      }
    }
  }
  return null;
}

// Instala la versión publicada como motor. Devuelve true si queda lista (o ya lo estaba).
export async function prepararMotor({ version, url, sha256 }) {
  if (!supervisado()) return false;
  if (!version || !url || !/^[0-9a-f]{64}$/i.test(String(sha256 || ''))) return false;
  // Solo de robinlawyer.ai por HTTPS (las pruebas sirven en 127.0.0.1 con su variable).
  const local = process.env.ROBIN_MOTOR_PERMITIR_LOCAL === '1' && /^http:\/\/127\.0\.0\.1:\d+\//.test(String(url));
  if (!/^\d+\.\d+\.\d+$/.test(String(version)) || !(DOMINIOS.test(String(url)) || local)) return false;
  if (compararVersiones(version, VERSION) <= 0) return false;
  if (descartados().has(String(version))) return false;
  if (motorInstalado(version)) {
    avisarSupervisor(version);
    return true;
  }
  // Claude arranca dos instancias: baja una sola; la otra lo intentará en su siguiente consulta.
  fs.mkdirSync(dirMotores(), { recursive: true });
  const soltar = tomarCerrojo();
  if (!soltar) return false;
  try {
    if (motorInstalado(version)) {
      avisarSupervisor(version);
      return true;
    }
    const paquete = path.join(dirMotores(), `${version}.mcpb.parcial`);
    const tmp = path.join(dirMotores(), `${version}.instalando-${process.pid}`);
    const destino = path.join(dirMotores(), version);
    const t0 = Date.now();
    try {
      log.info('Bajando la versión nueva de RobinSearch para instalarla sola', { version });
      await bajar(url, paquete, sha256);
      fs.rmSync(tmp, { recursive: true, force: true });
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(paquete);
      // Nada fuera de la carpeta del motor (ni rutas absolutas ni «..»).
      for (const e of zip.getEntries()) {
        const n = e.entryName.replace(/\\/g, '/');
        if (n.startsWith('/') || /^[a-z]:/i.test(n) || n.split('/').includes('..')) throw new Error('paquete con rutas no válidas');
      }
      zip.extractAllTo(tmp, true);
      const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
      if (pkg.version !== version) throw new Error(`el paquete dice ser la ${pkg.version}`);
      if (!(Number(pkg.robinSupervisor) >= 1) || !fs.existsSync(path.join(tmp, 'server', 'index.js'))) throw new Error('el paquete no trae un motor supervisable');
      fs.rmSync(destino, { recursive: true, force: true });
      fs.renameSync(tmp, destino);
      // La ficha, lo último: es lo que el supervisor exige para usarlo.
      fs.writeFileSync(path.join(destino, 'robin-motor.json'), JSON.stringify({ version, sha256: String(sha256).toLowerCase(), url, instalado: new Date().toISOString(), desde: VERSION }));
      fs.rmSync(paquete, { force: true });
      log.info('Versión nueva de RobinSearch lista: entra sola en cuanto no haya peticiones en curso', { version, s: Math.round((Date.now() - t0) / 1000) });
      limpiarViejos(version);
      avisarSupervisor(version);
      return true;
    } catch (err) {
      fs.rmSync(tmp, { recursive: true, force: true });
      // Un .parcial con la huella mala ya se borró; uno cortado se conserva para reanudar.
      log.warn('No se pudo preparar la versión nueva (se reintentará)', { version, err: String(err?.message || err).slice(0, 200) });
      return false;
    }
  } finally {
    soltar();
  }
}

function avisarSupervisor(version) {
  try {
    parentPort?.postMessage({ robin: 'motor-nuevo', version });
  } catch {
    /* sin supervisor */
  }
}

// Se quedan la nueva y la anterior (puede estar corriendo en la otra instancia); lo demás se borra.
function limpiarViejos(nueva) {
  let nombres = [];
  try {
    nombres = fs.readdirSync(dirMotores());
  } catch {
    return;
  }
  const versiones = nombres.filter((n) => /^\d+\.\d+\.\d+$/.test(n)).sort(compararVersiones);
  const quedan = new Set([nueva, ...versiones.filter((v) => v !== nueva).slice(-1)]);
  for (const n of nombres) {
    const ruta = path.join(dirMotores(), n);
    const esVersion = /^\d+\.\d+\.\d+$/.test(n);
    const resto = (/\.instalando-\d+$/.test(n) && n !== `${nueva}.instalando-${process.pid}`) || (/\.mcpb\.parcial$/.test(n) && !n.startsWith(`${nueva}.`));
    if ((esVersion && !quedan.has(n)) || resto) {
      try {
        fs.rmSync(ruta, { recursive: true, force: true });
      } catch {
        /* en uso: la próxima vez */
      }
    }
  }
}

export default { prepararMotor, motorInstalado, supervisado };
