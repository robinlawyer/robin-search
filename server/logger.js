// Logger local con rotación. NUNCA registra contenido documental — solo rutas de
// fichero, contadores y estados (RNF-01 / RNF-07).

import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDirs } from './config.js';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB por fichero
const MAX_FILES = 3;

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

let logPath = null;

function logFile() {
  if (!logPath) {
    ensureDataDirs();
    logPath = path.join(config.logDir, 'robin-search.log');
  }
  return logPath;
}

function rotateIfNeeded(file) {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return;
  }
  if (size < MAX_BYTES) return;
  // robin-search.log.2 → .3, .1 → .2, base → .1
  for (let i = MAX_FILES - 1; i >= 1; i--) {
    const src = i === 1 ? file : `${file}.${i - 1}`;
    const dst = `${file}.${i}`;
    if (fs.existsSync(src)) {
      try {
        fs.renameSync(src, dst);
      } catch {
        /* best-effort */
      }
    }
  }
}

function write(level, msg, extra) {
  if ((LEVELS[level] ?? 2) > threshold) return;
  const file = logFile();
  rotateIfNeeded(file);
  const line =
    JSON.stringify({
      t: new Date().toISOString(),
      level,
      msg,
      ...(extra ? { data: extra } : {}),
    }) + '\n';
  try {
    fs.appendFileSync(file, line);
  } catch {
    /* si el disco falla, no tumbamos el servidor por un log */
  }
  // stderr es seguro en MCP stdio (stdout está reservado para el protocolo JSON-RPC).
  if (level === 'error' || level === 'warn') process.stderr.write(line);
}

export const log = {
  error: (msg, extra) => write('error', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  info: (msg, extra) => write('info', msg, extra),
  debug: (msg, extra) => write('debug', msg, extra),
  path: () => logFile(),
};

export default log;
