// El sondeo del login no puede quedarse parado por UNA petición colgada.
//
// Por qué existe: la recogida del código por la conexión de salida
// (POST /oauth/pickup) es el camino para los despachos cuyo antivirus corta la
// vuelta al puerto local. En esas redes, un proxy que retiene una petición sin
// contestar es de lo más normal. Sin límite por petición, el fetch de Node
// esperaba hasta 5 minutos antes de rendirse, y el login se quedaba mudo.
//
// Aquí el emisor de pega deja colgada la PRIMERA consulta para siempre y
// contesta a las siguientes. Con el límite, el código llega en segundos.
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.ROBIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sondeo-'));
const { pickupCode } = await import('../server/auth/oauth.js');

const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };

let peticiones = 0;
const colgadas = [];
const srv = http.createServer((req, res) => {
  peticiones++;
  if (peticiones === 1) { colgadas.push(res); return; }   // la primera: ni respuesta ni cierre
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ready', code: 'CODIGO_TRAS_EL_CUELGUE', state: null }));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/oauth/pickup`;

const t0 = Date.now();
let codigo = null; let error = null;
try {
  codigo = await pickupCode(url, 'cli_pega', 'verifier_pega', Date.now() + 60000, undefined, { timeoutMs: 1000 });
} catch (e) { error = String(e?.message || e); }
const ms = Date.now() - t0;

check('el sondeo recoge el código aunque la primera petición se quede colgada', codigo === 'CODIGO_TRAS_EL_CUELGUE', error || codigo);
check('y lo hace en segundos, no en los 5 minutos del límite por defecto', ms < 15000, `${ms} ms`);
check('porque abandonó la petición colgada y volvió a preguntar', peticiones >= 2, `${peticiones} peticiones`);

for (const r of colgadas) { try { r.destroy(); } catch { /* ya cerrada */ } }
srv.close();
const fallos = results.filter((x) => !x).length;
console.log(`\n${results.length - fallos}/${results.length} comprobaciones OK`);
process.exit(fallos ? 1 : 0);
