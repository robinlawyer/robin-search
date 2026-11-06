// ESCENARIO (Juan, 6-nov-2026, equipo Windows de un cliente; mismos informes el 5-nov con la
// 1.11.4 y el 4-nov con la 1.12.2): RobinSearch moría una y otra vez indexando —cada vez con un
// documento distinto— y había que reiniciar Claude para que volviera. En el registro, siempre la
// misma secuencia: una tanda de imágenes al OCR, un «RuntimeError: Aborted()» del motor, más
// imágenes al MISMO motor y, pocos segundos después, el proceso muerto sin una línea más.
//
// Un motor de tesseract que ha abortado está MUERTO (es WASM en un worker_threads que comparte
// proceso con todo lo demás): seguir llamándolo se lleva por delante RobinSearch entero. Aquí se
// comprueba que un abort tira el motor, que los trabajos entran de uno en uno, que a la enésima
// caída seguida el OCR se para un rato en vez de insistir, y que un documento que no se pudo leer
// por eso se reintenta (no queda marcado «sin texto legible» para siempre).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(Boolean(c)); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-6nov-'));
const OCR = pathToFileURL(path.join(REPO, 'server/indexer/ocr.js')).href;
const EXTRACT = pathToFileURL(path.join(REPO, 'server/indexer/extract.js')).href;

// Un PNG de 1×1 que el motor lee sin problema.
const img = (n) => { const f = path.join(base, `${n}.png`); fs.writeFileSync(f, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')); return f; };
const A = img('foto 1'); const B = img('foto 2'); const C = img('foto 3'); const D = img('foto 4');

const correr = (guion, env = {}) => new Promise((res) => {
  const c = spawn(process.execPath, ['--input-type=module', '-e', guion], {
    env: { ...process.env, ROBIN_DATA_DIR: path.join(base, 'datos'), ROBIN_LOG_LEVEL: 'error', ROBIN_DIAGNOSTICO_URL: 'off', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; let err = '';
  c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
  const t = setTimeout(() => c.kill('SIGKILL'), 180000);
  c.on('exit', (code, signal) => { clearTimeout(t); let r = null; try { r = JSON.parse(out.trim().split('\n').pop()); } catch { /* sin salida */ } res({ code, signal, r, err }); });
});

// 1. Un abort tira el motor y el siguiente documento se lee con uno limpio.
{
  const g = `
    const m = await import(${JSON.stringify(OCR)});
    const r = [];
    for (const f of ${JSON.stringify([A, B, C])}) { try { await m.ocrImage(f); r.push('ok'); } catch (e) { r.push('rechazo:' + String(e.message).slice(0, 30)); } }
    const est = m._estadoMotorParaPruebas();
    await m.terminateOcr();
    console.log(JSON.stringify({ r, est }));`;
  const a = await correr(g, { ROBIN_PRUEBA_OCR_ABORTA: '1' });
  check('un motor que aborta no tumba el proceso', a.code === 0, `código ${a.code} ${a.signal || ''} ${a.err.slice(-200)}`);
  check('falla solo el documento que lo pilló abortando', a.r?.r[0]?.startsWith('rechazo'), JSON.stringify(a.r?.r));
  check('y los siguientes se leen con un motor limpio', a.r?.r[1] === 'ok' && a.r?.r[2] === 'ok', JSON.stringify(a.r?.r));
  check('tras el abort no quedan caídas pendientes', a.r?.est?.muertes === 0 && !a.r?.est?.roto, JSON.stringify(a.r?.est));
}

// 2. Nadie entra en el motor mientras otro está dentro (ni lo cierra por debajo).
{
  const g = `
    const m = await import(${JSON.stringify(OCR)});
    await Promise.all(${JSON.stringify([A, B, C, D])}.map((f) => m.ocrImage(f).catch(() => null)));
    const est = m._estadoMotorParaPruebas();
    await m.terminateOcr();
    console.log(JSON.stringify({ est }));`;
  const b = await correr(g);
  check('cuatro documentos a la vez entran en el motor de uno en uno', b.code === 0 && b.r?.est?.pico === 1, `pico ${b.r?.est?.pico}, código ${b.code} ${b.err.slice(-160)}`);
}

// 3. Si el motor cae varias veces seguidas, el OCR se para un rato en vez de insistir.
{
  const g = `
    const m = await import(${JSON.stringify(OCR)});
    const r = [];
    for (const f of ${JSON.stringify([A, B, C, D])}) { try { await m.ocrImage(f); r.push('ok'); } catch (e) { r.push(e.code || ('rechazo:' + String(e.message).slice(0, 30))); } }
    console.log(JSON.stringify({ r, estado: m.estadoOcr() }));`;
  const c = await correr(g, { ROBIN_PRUEBA_OCR_ABORTA: '9', ROBIN_OCR_MUERTES_PARA_PAUSA: '2', ROBIN_OCR_PAUSA_MS: '60000' });
  check('el proceso sigue vivo tras varias caídas del motor', c.code === 0, `código ${c.code} ${c.signal || ''}`);
  check('a la segunda caída seguida el OCR se pone en pausa', c.r?.r[2] === 'ROBIN_OCR_EN_PAUSA' && c.r?.r[3] === 'ROBIN_OCR_EN_PAUSA', JSON.stringify(c.r?.r));
  check('y el estado del servidor lo dice en claro', c.r?.estado?.estado === 'en_pausa' && c.r?.estado?.pausa_segundos > 0, JSON.stringify(c.r?.estado));
}

// 4. Un documento que no se pudo leer por la pausa se REINTENTA: no queda «sin texto legible».
{
  const g = `
    const m = await import(${JSON.stringify(OCR)});
    const x = await import(${JSON.stringify(EXTRACT)});
    try { await m.ocrImage(${JSON.stringify(A)}); } catch {}
    try { await m.ocrImage(${JSON.stringify(B)}); } catch {}
    let salida;
    try { salida = { sinOcr: (await x.extractImage(${JSON.stringify(C)})).sinOcr }; } catch (e) { salida = { code: e.code || null }; }
    console.log(JSON.stringify(salida));`;
  const d = await correr(g, { ROBIN_PRUEBA_OCR_ABORTA: '9', ROBIN_OCR_MUERTES_PARA_PAUSA: '2', ROBIN_OCR_PAUSA_MS: '60000' });
  check('con el OCR en pausa el documento se deja para la pasada siguiente', d.r?.code === 'ROBIN_OCR_EN_PAUSA', JSON.stringify(d.r));
}

// 5. Y un PDF escaneado tampoco: con el motor en pausa ni se rasteriza, y vuelve a la cola.
{
  const pdf = path.join(base, 'escaneado.pdf');
  const g = `
    const fs = await import('node:fs');
    const mupdf = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'node_modules', 'mupdf', 'dist', 'mupdf.js')).href)});
    const d = new mupdf.PDFDocument();
    d.insertPage(-1, d.addPage([0, 0, 200, 200], 0, d.newDictionary(), ''));
    fs.writeFileSync(${JSON.stringify(pdf)}, d.saveToBuffer('').asUint8Array());
    const m = await import(${JSON.stringify(OCR)});
    try { await m.ocrImage(${JSON.stringify(A)}); } catch {}
    try { await m.ocrImage(${JSON.stringify(B)}); } catch {}
    let salida;
    try { await m.ocrPdf(${JSON.stringify(pdf)}); salida = { code: null }; } catch (e) { salida = { code: e.code || null }; }
    console.log(JSON.stringify(salida));`;
  const e = await correr(g, { ROBIN_PRUEBA_OCR_ABORTA: '9', ROBIN_OCR_MUERTES_PARA_PAUSA: '2', ROBIN_OCR_PAUSA_MS: '60000' });
  check('con el OCR en pausa un PDF escaneado se deja para la pasada siguiente', e.r?.code === 'ROBIN_OCR_EN_PAUSA', `${JSON.stringify(e.r)} ${e.err.slice(-160)}`);
}

fs.rmSync(base, { recursive: true, force: true });
const mal = results.filter((x) => !x).length;
console.log(`\n${results.length - mal}/${results.length} comprobaciones OK`);
process.exit(mal ? 1 : 0);
