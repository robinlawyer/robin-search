// ESCENARIOS (27-oct-2026, correo de Juan «RobinSearch, un núcleo y varios despliegues»):
//
//  1. Ridwan guarda todo en Google Drive. Los Google Docs nativos llegan a la carpeta como un
//     acceso directo (.gdoc, .gsheet, .gslides) sin el texto: RobinSearch no puede leerlos, y el
//     aviso genérico («1 .gdoc… expórtalo») no decía qué son ni cómo sacarlos.
//  2. Claude Desktop comparte UN proceso de RobinSearch entre todos sus chats. Con dos asuntos a
//     la vez, el segundo chat cambiaba el expediente activo del primero y la siguiente búsqueda
//     del primero, sin «expediente», devolvía documentos del otro cliente sin error.
//
// Contra el servidor MCP real por stdio (como test-aislamiento).
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const terminar = (p) => (p.exitCode !== null || p.signalCode !== null ? Promise.resolve() : new Promise((r) => {
  p.once('exit', r); p.kill(); setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* ya */ } }, 15000).unref();
}));

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-27oct-'));
const MADRE = path.join(base, 'Mi unidad');
const CASOS = {
  'Perez-Divorcio': 'Demanda de divorcio. Guarda y custodia de los hijos y pensión de alimentos. Se reclama indemnización. SECRETO-PEREZ-8891.',
  'Acme-Mercantil': 'Contrato de agencia. Indemnización por clientela del artículo 28. Se reclama indemnización. SECRETO-ACME-4417.',
};
for (const [caso, texto] of Object.entries(CASOS)) {
  fs.mkdirSync(path.join(MADRE, caso), { recursive: true });
  fs.writeFileSync(path.join(MADRE, caso, 'escrito.txt'), texto);
}
// Lo que deja Google Drive para escritorio por cada documento nativo de Google.
const acceso = (tipo) => JSON.stringify({ doc_id: '1AbC', resource_id: `${tipo}:1AbC`, url: `https://docs.google.com/${tipo}/d/1AbC/edit` });
fs.writeFileSync(path.join(MADRE, 'Perez-Divorcio', 'Notas de la clienta.gdoc'), acceso('document'));
fs.writeFileSync(path.join(MADRE, 'Perez-Divorcio', 'Gastos.gsheet'), acceso('spreadsheets'));
fs.writeFileSync(path.join(MADRE, 'Acme-Mercantil', 'Presentación.gslides'), acceso('presentation'));
fs.writeFileSync(path.join(MADRE, 'Acme-Mercantil', 'minuta.pages'), 'x');

const env = { ...process.env, ROBIN_TOKEN: 't', ROBIN_FOLDERS: MADRE, ROBIN_DATA_DIR: path.join(base, 'datos'), ROBIN_OCR: 'false',
  ROBIN_LOG_LEVEL: 'error', ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no', ROBIN_VENTANA_VARIOS_EXPEDIENTES_MIN: '480' };
const c = spawn(process.execPath, [path.join(REPO, 'server/index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = ''; const w = new Map(); let id = 1;
c.stderr.on('data', () => {});
c.stdout.on('data', (d) => {
  buf += d.toString(); let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue;
    let m; try { m = JSON.parse(l); } catch { continue; }
    const f = w.get(m.id); if (f) { w.delete(m.id); f(m); }
  }
});
const rpc = (method, params) => new Promise((res, rej) => {
  const i = id++; const t = setTimeout(() => rej(new Error(`timeout ${method}`)), 180000);
  w.set(i, (m) => { clearTimeout(t); res(m); });
  c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`);
});
const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const t = r.result?.content?.[0]?.text;
  return { isError: Boolean(r.result?.isError), data: t ? JSON.parse(t) : r, raw: t || '' };
};
const frags = (r) => JSON.stringify(r.data?.fragmentos || []);

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
let est;
for (let i = 0; i < 120; i++) {
  est = (await call('estado_servidor')).data;
  if (est.estado === 'activo' && est.documentos_indexados >= 2) break;
  await new Promise((r) => setTimeout(r, 1500));
}

// ── 1. Google Docs nativos ───────────────────────────────────────────────────────────
const ni = est.no_indexables || {};
check('los accesos directos de Google se cuentan aparte (3)', ni.google_nativos === 3, JSON.stringify(ni));
check('y no se mezclan con los formatos que no leemos (.pages sí sigue ahí)',
  !['.gdoc', '.gsheet', '.gslides'].some((e) => e in (ni.formatos_fuera || {})) && ni.formatos_fuera?.['.pages'] === 1, JSON.stringify(ni.formatos_fuera));
check('el aviso dice qué son y cómo sacarlos (Archivo → Descargar, Word/Excel/PDF)',
  /Google Docs, Hojas o Presentaciones/.test(est.aviso_no_indexables || '') && /Archivo → Descargar/.test(est.aviso_no_indexables || ''), (est.aviso_no_indexables || '').slice(0, 160));
const idx = await call('indexar_carpeta', {});
check('indexar_carpeta lo dice también', /Google Docs, Hojas o Presentaciones/.test(JSON.stringify(idx.data)), idx.raw.slice(0, 160));

// ── 2. Dos conversaciones a la vez en el mismo Claude ────────────────────────────────
// Un solo asunto: todo como siempre, sin repetir el expediente.
await call('establecer_expediente_activo', { expediente: 'Perez-Divorcio' });
let b = await call('buscar_documentos', { query: 'se reclama indemnización' });
check('con un solo asunto abierto se busca en el activo sin repetirlo', !b.isError && frags(b).includes('SECRETO-PEREZ') && !frags(b).includes('SECRETO-ACME'), b.raw.slice(0, 160));

// Otro chat abre Acme.
const e2 = await call('establecer_expediente_activo', { expediente: 'Acme-Mercantil' });
check('al fijar un segundo asunto se avisa de que hay que indicarlo en cada llamada',
  /indica "expediente": "Mi unidad\/Acme-Mercantil"/.test(e2.data.aviso_varias_conversaciones || '') && e2.data.otros_expedientes_recientes?.[0] === 'Mi unidad/Perez-Divorcio', JSON.stringify(e2.data).slice(0, 300));

// El primer chat vuelve a buscar sin decir su expediente: antes recibía lo de Acme.
for (const [tool, args] of [
  ['buscar_documentos', { query: 'se reclama indemnización' }],
  ['listar_documentos_indexados', {}],
  ['obtener_documento', { doc_id: 'x' }],
  ['obtener_fragmento', { doc_id: 'x', chunk_id: 'x' }],
  ['indice_documento', { doc_id: 'x' }],
  ['cambios_expediente', {}],
]) {
  const r = await call(tool, args);
  check(`${tool} sin expediente, con dos asuntos abiertos: NO responde con el de otro chat`,
    r.isError && /varios expedientes/.test(r.raw) && !r.raw.includes('SECRETO-ACME'), r.raw.slice(0, 140));
}
const err = await call('buscar_documentos', { query: 'se reclama indemnización' });
check('el error trae los candidatos para que Claude elija el suyo', JSON.stringify(err.data).includes('Perez-Divorcio') && JSON.stringify(err.data).includes('Acme-Mercantil'));

// Indicándolo, cada uno el suyo.
b = await call('buscar_documentos', { query: 'se reclama indemnización', expediente: 'Perez-Divorcio' });
check('indicando el expediente, Pérez ve solo lo suyo', !b.isError && frags(b).includes('SECRETO-PEREZ') && !frags(b).includes('SECRETO-ACME'));
b = await call('buscar_documentos', { query: 'se reclama indemnización', expediente: 'Acme-Mercantil' });
check('y Acme lo suyo', !b.isError && frags(b).includes('SECRETO-ACME') && !frags(b).includes('SECRETO-PEREZ'));

// Cerrar el asunto deja a todos sin activo (nadie hereda el de otro).
await call('establecer_expediente_activo', { limpiar: true });
b = await call('buscar_documentos', { query: 'se reclama indemnización' });
check('tras cerrar el asunto, nadie busca en un expediente heredado', b.isError && /No hay expediente activo/.test(b.raw));
await call('establecer_expediente_activo', { expediente: 'Acme-Mercantil' });
b = await call('buscar_documentos', { query: 'se reclama indemnización' });
check('y con un solo asunto otra vez, vuelve a bastar el activo', !b.isError && frags(b).includes('SECRETO-ACME'));

await terminar(c);
fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const ok = results.every(Boolean);
console.log(ok ? `\nTODO OK (${results.length})` : `\nFALLOS: ${results.filter((x) => !x).length}/${results.length}`);
process.exit(ok ? 0 : 1);
