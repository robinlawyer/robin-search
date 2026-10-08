// Cerrojo ENTRE PROCESOS para gastar la llave de renovación (Juan, 8-oct-2026). Claude Desktop,
// Claude Code, la sonda que Claude arranca y mata y el CLI que lanza RobinDesktop pueden querer
// renovar a la vez con la MISMA llave; con rotación, la segunda llegaría con una llave ya gastada.
// Dentro del cerrojo se relee la llave (disco y llavero) y, si otra instancia acaba de renovar, se
// usa lo suyo en vez de gastar nada.
//
// Un fichero creado en exclusiva (`wx`): funciona igual en macOS, Windows y Linux, sin módulos
// nativos. Si el que lo tenía murió sin soltarlo, a los 30 s se da por abandonado.

import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDirs } from '../config.js';

const ABANDONADO_MS = 30000;

export async function conCerrojo(nombre, fn, { esperaMaxMs = 20000 } = {}) {
  ensureDataDirs();
  const ruta = path.join(config.dataDir, `${nombre}.lock`);
  const hasta = Date.now() + esperaMaxMs;
  let tengo = false;
  while (!tengo) {
    try {
      const fd = fs.openSync(ruta, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      tengo = true;
    } catch (e) {
      if (e?.code !== 'EEXIST') break; // disco raro: sin cerrojo, como antes
      try {
        if (Date.now() - fs.statSync(ruta).mtimeMs > ABANDONADO_MS) fs.rmSync(ruta, { force: true });
      } catch { /* lo soltó entre medias */ }
      if (Date.now() > hasta) break;
      await new Promise((r) => setTimeout(r, 100 + Math.floor(Math.random() * 100)));
    }
  }
  try {
    return await fn();
  } finally {
    if (tengo) {
      try { fs.rmSync(ruta, { force: true }); } catch { /* ya no está */ }
    }
  }
}

export default { conCerrojo };
