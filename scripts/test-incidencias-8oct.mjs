// ESCENARIO (informe del panel del 8-oct-2026, Juan, macOS, 1.12.0, registro de Claude LEÍDO):
// «caída previa abriendo el índice» que era Claude cerrando el proceso a los 4 s de lanzarlo.
// Claude anota cada lanzamiento dos veces: «Initializing server» (registro del servidor, con
// milisegundos) y «Connecting to RobinSearch» (main.log, al segundo y en hora local). El proceso
// nació después del «Connecting» truncado, se tomaba ese como su lanzamiento y en el canal de
// main.log no había cierre: el «Shutting down» del otro canal no se miraba.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (n, c, d = '') => {
  results.push(c);
  console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`);
};
const { claudeLaCerro } = await import(pathToFileURL(path.join(REPO, 'server/diagnostico.js')).href);

// main.log va en hora LOCAL del equipo y sin milisegundos: se escribe como lo escribiría Claude
// en el equipo donde corre la prueba, para que no dependa de su zona horaria.
const local = (iso) => {
  const d = new Date(iso);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const juan = [
  '2026-10-08T16:17:54.791Z [RobinSearch] [info] Shutting down server... { metadata: undefined }',
  '2026-10-08T16:17:54.794Z [RobinSearch] [info] Server transport closed (intentional shutdown) { metadata: undefined }',
  '2026-10-08T16:17:56.331Z [RobinSearch] [info] Server transport closed { metadata: undefined }',
  '2026-10-08T16:18:12.928Z [RobinSearch] [info] Initializing server... { metadata: undefined }',
  '2026-10-08T16:18:17.009Z [RobinSearch] [info] Shutting down server... { metadata: undefined }',
  '2026-10-08T16:18:17.009Z [RobinSearch] [info] Server transport closed (intentional shutdown) { metadata: undefined }',
  '2026-10-08T16:18:17.051Z [RobinSearch] [info] Server transport closed { metadata: undefined }',
  '2026-10-08T16:18:17.052Z [RobinSearch] [info] Initializing server... { metadata: undefined }',
  `${local('2026-10-08T16:17:53Z')} [info] [LocalMcpServerManager] Closing RobinSearch`,
  `${local('2026-10-08T16:17:56Z')} [warn] [LocalMcpServerManager] RobinSearch disconnected`,
  `${local('2026-10-08T16:18:14Z')} [info] [LocalMcpServerManager] Connecting to RobinSearch`,
];
console.log('\n1. Registro de Claude de Juan (8-oct 16:18 UTC)\n');
check('1.1 proceso nacido ANTES del «Connecting» de main.log y cerrado a las 16:18:17: no es caída',
  claudeLaCerro({ inicio: '2026-10-08T16:18:13.600Z' }, juan) === true);
check('1.2 nacido DESPUÉS del «Connecting» truncado (16:18:14.4): tampoco es caída',
  claudeLaCerro({ inicio: '2026-10-08T16:18:14.400Z' }, juan) === true);
check('1.3 el relanzado (nacido 16:18:17.6) no hereda aquel cierre',
  claudeLaCerro({ inicio: '2026-10-08T16:18:17.600Z' }, juan) === false);
check('1.4 caída de verdad con los dos canales: sin «Shutting down» ni «Closing» detrás, es caída',
  claudeLaCerro({ inicio: '2026-10-08T10:00:01.500Z' }, [
    '2026-10-08T10:00:00.900Z [RobinSearch] [info] Initializing server...',
    `${local('2026-10-08T10:00:01Z')} [info] [LocalMcpServerManager] Connecting to RobinSearch`,
    '2026-10-08T10:05:00.000Z [RobinSearch] [info] Server transport closed',
    `${local('2026-10-08T10:05:00Z')} [warn] [LocalMcpServerManager] RobinSearch disconnected`,
  ]) === false);
check('1.5 si el canal que manda calla y el otro anota la MUERTE (sin cierre), es caída',
  claudeLaCerro({ inicio: '2026-10-08T12:00:01.400Z' }, [
    '2026-10-08T12:00:00.100Z [RobinSearch] [info] Initializing server...',
    `${local('2026-10-08T12:00:01Z')} [info] [LocalMcpServerManager] Connecting to RobinSearch`,
    '2026-10-08T12:00:05.000Z [RobinSearch] [info] Server transport closed',
  ]) === false);
check('1.6 cierre que solo anota main.log («Closing») también cuenta',
  claudeLaCerro({ inicio: '2026-10-08T11:00:01.500Z' }, [
    `${local('2026-10-08T11:00:01Z')} [info] [LocalMcpServerManager] Connecting to RobinSearch`,
    `${local('2026-10-08T11:30:00Z')} [info] [LocalMcpServerManager] Closing RobinSearch`,
  ]) === true);

const fallos = results.filter((x) => !x).length;
console.log(`\n${results.length - fallos}/${results.length} comprobaciones OK`);
process.exit(fallos ? 1 : 0);
