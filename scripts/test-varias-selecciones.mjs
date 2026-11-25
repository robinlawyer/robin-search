// Selecciones de VARIOS expedientes (1.14.0) con varias conversaciones a la vez, en un proceso limpio (revisión de Codex, 25-nov). Arnés tomado de test-incidencias-27oct:
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

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-varias-sel-'));
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
// Con la selección de VARIOS expedientes (1.14.0): una selección de dos en un chat cuenta como
// UNA (en cualquier orden); otro chat con otro expediente bloquea; y sumar con «anadir» también
// pide el expediente, porque el servidor no sabe si la ampliación la hizo otro chat.
let b;
await call('establecer_expediente_activo', { expediente: ['Perez-Divorcio', 'Acme-Mercantil'] });
b = await call('buscar_documentos', { query: 'se reclama indemnización', n_resultados: 20 });
check('una selección de dos en un chat: busca en las dos sin repetirlas',
  !b.isError && frags(b).includes('SECRETO-PEREZ') && frags(b).includes('SECRETO-ACME'), b.raw.slice(0, 200));
await call('establecer_expediente_activo', { expediente: ['Acme-Mercantil', 'Perez-Divorcio'] });
b = await call('buscar_documentos', { query: 'se reclama indemnización', n_resultados: 20 });
check('la misma selección en otro orden es la misma (no bloquea)', !b.isError && frags(b).includes('SECRETO-PEREZ') && frags(b).includes('SECRETO-ACME'), b.raw.slice(0, 200));
await call('establecer_expediente_activo', { expediente: 'Perez-Divorcio' });
b = await call('buscar_documentos', { query: 'se reclama indemnización', n_resultados: 20 });
check('otro chat que fija solo Pérez tras la selección de dos: sin expediente NO responde', b.isError && !frags(b).includes('SECRETO-ACME'), b.raw.slice(0, 200));
b = await call('buscar_documentos', { query: 'se reclama indemnización', expediente: ['Perez-Divorcio', 'Acme-Mercantil'], n_resultados: 20 });
check('indicando la lista, la selección de dos ve las dos', !b.isError && frags(b).includes('SECRETO-PEREZ') && frags(b).includes('SECRETO-ACME'));
b = await call('buscar_documentos', { query: 'se reclama indemnización', expediente: 'Perez-Divorcio', n_resultados: 20 });
check('indicando Pérez, solo Pérez', !b.isError && frags(b).includes('SECRETO-PEREZ') && !frags(b).includes('SECRETO-ACME'));
await call('establecer_expediente_activo', { expediente: 'Perez-Divorcio' });
b = await call('establecer_expediente_activo', { expediente: 'Acme-Mercantil', anadir: true });
check('«anadir» sin la selección de esta conversación no suma', b.isError && /seleccion_actual/.test(b.raw), b.raw.slice(0, 160));
b = await call('establecer_expediente_activo', { expediente: 'Acme-Mercantil', anadir: true, seleccion_actual: 'Mi unidad/Perez-Divorcio' });
check('con la selección de esta conversación, sí suma', !b.isError && Array.isArray(b.data.expediente_activo) && b.data.expediente_activo.length === 2, b.raw.slice(0, 200));
b = await call('buscar_documentos', { query: 'se reclama indemnización', n_resultados: 20 });
check('tras sumar, con selecciones distintas en la ventana, sin expediente NO responde (pide indicarlo)', b.isError && !frags(b).includes('SECRETO'), b.raw.slice(0, 200));

// La ficha del asunto con dos chats: sin "asunto_id" no actúa sobre el asunto del otro.
const fa = await call('ficha_asunto', { accion: 'crear', nombre: 'Pérez divorcio', carpetas_expediente: 'Perez-Divorcio', orden: 'civil' });
const fb = await call('ficha_asunto', { accion: 'crear', nombre: 'Acme agencia', carpetas_expediente: 'Acme-Mercantil', orden: 'mercantil' });
const idA = fa.data.asunto?.asunto_id; const idB = fb.data.asunto?.asunto_id;
b = await call('ficha_asunto', { accion: 'leer' });
check('ficha_asunto sin asunto_id, con dos asuntos abiertos: pide el suyo', b.isError && b.raw.includes(idA) && b.raw.includes(idB), b.raw.slice(0, 200));
b = await call('ficha_asunto', { accion: 'leer', asunto_id: idA });
check('y con asunto_id lee el pedido', !b.isError && JSON.stringify(b.data).includes(idA));

await terminar(c);
fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const ok = results.every(Boolean);
console.log(ok ? `\nTODO OK (${results.length})` : `\nFALLOS: ${results.filter((x) => !x).length}/${results.length}`);
process.exit(ok ? 0 : 1);
