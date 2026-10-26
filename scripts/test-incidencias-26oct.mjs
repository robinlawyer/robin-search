// ESCENARIO (Juan, 26-oct-2026): RobinDesktop en «3 de 114 · 3 %» con «G/Mi unidad/APELACION
// ANCIZAR.pdf» más de diez minutos, «Calculando el tiempo que queda…». Era un recurso escaneado
// pasando por OCR (5,8 s por página medido en un Mac; 10-15 s en un portátil Windows): el panel
// solo cambiaba al pasar de documento y parecía colgado. Ahora el OCR anuncia por qué página va
// y cuánto le queda a ese documento, y eso llega a la app aunque empiece otro documento.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-26oct-'));
const pdf = path.join(base, 'APELACION ESCANEADA.pdf');
const href = (p) => JSON.stringify(pathToFileURL(path.join(REPO, p)).href);

// Un PDF de solo imagen (como sale de un escáner) con texto de verdad en cada página, para que el
// OCR trabaje como en casa del abogado.
const prog = `
  const fs = await import('node:fs');
  const mupdf = await import(${href('node_modules/mupdf/dist/mupdf.js')});
  const fuente = new mupdf.PDFDocument();
  const w = 595, h = 842;
  for (let i = 0; i < 4; i++) {
    const texto = 'BT /F1 14 Tf 60 760 Td (RECURSO DE APELACION - pagina ' + (i + 1) + ') Tj 0 -30 Td (AL JUZGADO DE PRIMERA INSTANCIA) Tj ET';
    const res = fuente.addObject({ Font: { F1: fuente.addSimpleFont(new mupdf.Font('Times-Roman')) } });
    fuente.insertPage(-1, fuente.addPage([0, 0, w, h], 0, res, texto));
  }
  const escaneado = new mupdf.PDFDocument();
  for (let i = 0; i < 4; i++) {
    const pix = fuente.loadPage(i).toPixmap(mupdf.Matrix.scale(150 / 72, 150 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    const img = escaneado.addImage(new mupdf.Image(pix));
    escaneado.insertPage(-1, escaneado.addPage([0, 0, w, h], 0, escaneado.addObject({ XObject: { I0: img } }), 'q ' + w + ' 0 0 ' + h + ' 0 0 cm /I0 Do Q'));
  }
  fs.writeFileSync(${JSON.stringify(pdf)}, escaneado.saveToBuffer('compress').asUint8Array());

  const st = await import(${href('server/state.js')});
  const ocr = await import(${href('server/indexer/ocr.js')});
  const vistas = [];
  st.alCambiar((s) => vistas.push(s.progreso ? JSON.parse(JSON.stringify(s.progreso)) : null));
  st.setIndexando({ fase: 'indexando', procesados: 3, total: 114, ficheroActual: 'G/Mi unidad/APELACION ESCANEADA.pdf' });
  // Con documentos en paralelo empieza otro mientras este se lee: no puede borrar la lectura.
  let otro = false;
  const t = setInterval(() => {
    if (vistas.some((v) => v?.lectura?.pagina >= 2) && !otro) {
      otro = true;
      st.setIndexando({ fase: 'indexando', procesados: 4, total: 114, ficheroActual: 'G/Mi unidad/otro.docx' });
    }
  }, 20);
  const paginas = await ocr.ocrPdf(${JSON.stringify(pdf)});
  clearInterval(t);
  const alAcabar = JSON.parse(JSON.stringify(st.state.progreso));
  st.setActivo();
  await ocr.terminateOcr();
  console.log(JSON.stringify({ vistas, alAcabar, otro, leidas: paginas.length, texto: paginas.map((p) => p.text).join(' ').slice(0, 200) }));
`;
const r = await new Promise((res) => {
  const h = spawn(process.execPath, ['--input-type=module', '-e', prog], { env: { ...process.env, ROBIN_DATA_DIR: path.join(base, 'datos'), ROBIN_LOG_LEVEL: 'error' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; h.stdout.on('data', (d) => { out += d; }); h.stderr.on('data', (d) => { err += d; });
  const t = setTimeout(() => h.kill('SIGKILL'), 240000);
  h.on('exit', (code) => { clearTimeout(t); let j = null; try { j = JSON.parse(out.trim().split('\n').pop()); } catch { /* sin salida */ } res({ code, j, err }); });
});
const j = r.j || {};
const lecturas = (j.vistas || []).map((v) => v?.lectura).filter(Boolean);
check('el escaneado se lee entero', r.code === 0 && j.leidas === 4 && /APELACI[OÓ]N/i.test(j.texto || ''), `código ${r.code} · ${j.leidas} páginas · «${(j.texto || "").slice(0, 80)}» ${r.err.slice(-200)}`);
check('el panel recibe la página por la que va, de 1 a 4', [1, 2, 3, 4].every((n) => lecturas.some((l) => l.pagina === n && l.paginas === 4)), JSON.stringify(lecturas.map((l) => l.pagina)));
check('lleva el nombre del documento (sin la ruta)', lecturas.every((l) => l.fichero === 'APELACION ESCANEADA.pdf' && l.tipo === 'ocr'));
check('sin página leída no inventa tiempo; con una, ya lo calcula', lecturas[0]?.eta_segundos === null && lecturas.some((l) => l.pagina > 1 && Number.isFinite(l.eta_segundos) && l.eta_segundos >= 0), JSON.stringify(lecturas.map((l) => l.eta_segundos)));
check('el resto del progreso sigue ahí (3 de 114)', (j.vistas || []).every((v) => !v || v.total === 114));
check('empezar otro documento no borra la lectura del escaneado', j.otro && (j.vistas || []).some((v) => v?.ficheroActual === 'G/Mi unidad/otro.docx' && v.lectura?.fichero === 'APELACION ESCANEADA.pdf'));
check('al acabar el OCR la lectura desaparece', j.alAcabar && !('lectura' in j.alAcabar), JSON.stringify(j.alAcabar));

// El canal de la app (control.js) manda `state.progreso` tal cual: la lectura viaja con él.
const control = fs.readFileSync(path.join(REPO, 'server/control.js'), 'utf8');
check('el canal de control manda el progreso entero', /progreso:\s*state\.progreso/.test(control));

fs.rmSync(base, { recursive: true, force: true });
const ok = results.every(Boolean);
console.log(ok ? `\nTODO OK (${results.length})` : `\nFALLOS: ${results.filter((x) => !x).length}/${results.length}`);
process.exit(ok ? 0 : 1);
