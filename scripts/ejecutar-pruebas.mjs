// Ejecuta las pruebas en serie, igual en Windows, Linux y macOS.
//
// Sustituye a `export ROBIN_DIAGNOSTICO_URL=off; npm run a && npm run b …` de package.json:
// `export` es sintaxis de sh y npm usa cmd.exe en Windows, así que `npm test` ni arrancaba.
//
//   node scripts/ejecutar-pruebas.mjs                  → todas
//   node scripts/ejecutar-pruebas.mjs control red      → solo esas
//   ROBIN_REGISTROS_PRUEBAS=<dir>                      → salida de cada prueba en <dir>/<prueba>.log
//   ROBIN_PRUEBA_MAX_MIN=<n>                           → tope por prueba (por defecto 20 min)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ORDEN = [
  'login', 'login-bloqueado', 'sondeo-colgado', 'control', 'aislamiento',
  'red', 'vigilante-local', 'rutas', 'carpetas', 'diagnostico', 'incidencias-sep', 'correo', 'correo-oauth', 'barrido', 'robustez', 'concurrencia', 'contenedores', 'escala', 'persistencia', 'ocr', 'formato-real', 'sin-conexion', 'no-modifica', 'velocidad', 'humo-so',
];
const pedidas = process.argv.slice(2);
const pruebas = pedidas.length ? ORDEN.filter((p) => pedidas.includes(p)) : ORDEN;
const DIR = process.env.ROBIN_REGISTROS_PRUEBAS || path.join(os.tmpdir(), 'robinsearch-pruebas');
const TOPE_MS = Number(process.env.ROBIN_PRUEBA_MAX_MIN || 20) * 60 * 1000;
fs.mkdirSync(DIR, { recursive: true });

// Ninguna prueba puede mandar avisos técnicos a producción.
const env = { ...process.env, ROBIN_DIAGNOSTICO_URL: 'off', ROBIN_REGISTROS_PRUEBAS: DIR };

function ejecutar(nombre) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const log = fs.createWriteStream(path.join(DIR, `${nombre}.log`));
    const hijo = spawn(process.execPath, [path.join(AQUI, `test-${nombre}.mjs`)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const s of [hijo.stdout, hijo.stderr]) {
      s.on('data', (d) => { process.stdout.write(d); log.write(d); });
    }
    const tope = setTimeout(() => {
      log.write(`\n*** TOPE de ${TOPE_MS / 60000} min superado: se mata la prueba ***\n`);
      hijo.kill('SIGKILL');
    }, TOPE_MS);
    hijo.on('exit', (code, signal) => {
      clearTimeout(tope);
      log.end();
      resolve({ nombre, ok: code === 0, code, signal, s: Math.round((Date.now() - t0) / 1000) });
    });
  });
}

const resumen = [];
for (const p of pruebas) {
  console.log(`\n══════ test-${p} (${process.platform}, Node ${process.versions.node}) ══════`);
  resumen.push(await ejecutar(p));
}
console.log('\n══════ Resumen ══════');
for (const r of resumen) console.log(`${r.ok ? '  OK  ' : ' FALLO'}  test-${r.nombre}  (${r.s} s${r.ok ? '' : `, code=${r.code} signal=${r.signal}`})`);
process.exit(resumen.every((r) => r.ok) ? 0 : 1);
