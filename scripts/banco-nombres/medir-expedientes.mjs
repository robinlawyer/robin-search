// Medición del anonimizador con EXPEDIENTES COMPLETOS anotados: documentos de verdad (Word, PDF,
// correos, WhatsApp, escaneos) que pasan por el MISMO extractor y el MISMO troceador que
// RobinSearch, se anonimizan en respuestas de 60 fragmentos como en producción, y se puntúan
// contra la anotación de quien los escribió.
//
//   python3 expedientes/construir.py expedientes/ronda-1 /ruta/ronda-1-ficheros
//   npm run medir:expedientes -- --carpeta /ruta/ronda-1-ficheros [--informe salida.txt]
//
// (la anotación se lee de `<carpeta>.oro.json`, fuera de la carpeta de expedientes, o de --oro).
//
// Es el paso de Juan del 30-sep —«lo primero que mires con expedientes reales, la categoría
// especial»— hecho con expedientes escritos a ciegas por otros redactores, con la anotación al
// lado: no hace falta revisión a mano y el número sale por categoría del 9.1.
//
// Lo que esta medición ve y el banco de fragmentos no:
//   · El texto como lo saca el extractor de cada formato (mammoth, mupdf, el .eml decodificado).
//   · El troceado real: ventanas de ~365 palabras con 45 de solape. Un nombre o un diagnóstico que
//     cae en la frontera llega PARTIDO a Claude («… la demandante Doña María» | «Luisa Ferrán Gil
//     …»). Esos trozos se anotan también y se miden: es lo que de verdad sale.
//   · La pasada previa del objeto del escrito por respuesta de 60, no por expediente entero.
//
// La red se corta igual que en medir-reales.mjs (sandbox-exec en macOS y dentro del proceso),
// aunque estos expedientes sean inventados: así se mide la herramienta que se usará con los de
// verdad.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');

const argv = process.argv.slice(2);
const val = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
};
const A = {
  carpeta: val('--carpeta'),
  oro: val('--oro'),
  informe: val('--informe'),
  json: val('--json'),
  sinCaja: argv.includes('--sin-caja'),
  // --volcar F: guarda los fragmentos ya extraídos y troceados (con su anotación) para iterar
  // sin volver a leer los PDF; --desde F los usa en vez de la carpeta.
  volcar: val('--volcar'),
  desde: val('--desde'),
};
const decir = (s = '') => process.stdout.write(`${s}\n`);

const PERFIL = '(version 1)(allow default)(deny network*)';
if (process.platform === 'darwin' && !process.env.ROBIN_MEDICION_EN_CAJA && !A.sinCaja) {
  const r = spawnSync('/usr/bin/sandbox-exec', ['-p', PERFIL, process.execPath, fileURLToPath(import.meta.url), ...argv], {
    stdio: 'inherit',
    env: { ...process.env, ROBIN_MEDICION_EN_CAJA: '1' },
  });
  process.exit(r.status ?? 1);
}

async function comprobarCaja() {
  if (!process.env.ROBIN_MEDICION_EN_CAJA) return 'sin caja';
  const net = await import('node:net');
  const r = await new Promise((resolve) => {
    const s = net.default.connect(443, '1.1.1.1');
    const t = setTimeout(() => { s.destroy(); resolve('timeout'); }, 3000);
    s.on('connect', () => { clearTimeout(t); s.destroy(); resolve('CONECTA'); });
    s.on('error', (e) => { clearTimeout(t); resolve(e.code ?? 'error'); });
  });
  if (r === 'CONECTA') {
    decir('✗ La red NO está cortada dentro de la caja. No mido.');
    process.exit(3);
  }
  return r;
}

const plano = (x) => x.split(/\s+/).filter(Boolean).join(' ');
const VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'i', 'con', 'en', 'a', 'al', 'da', 'do', 'dos', 'das', 'por', 'para', 'su', 'sus', 'un', 'una', 'que']);

// Los trozos de un literal que una frontera de fragmento deja sueltos: el principio al final del
// fragmento, o el final al principio. Solo los que llevan alguna palabra con contenido.
function trozosEnFrontera(texto, literal) {
  const pal = literal.split(' ');
  if (pal.length < 2) return [];
  const fuera = [];
  const util = (ws) => ws.some((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length >= 3 && !VACIAS.has(w.toLowerCase()));
  for (let k = 1; k < pal.length; k++) {
    const cabeza = pal.slice(0, k);
    const cola = pal.slice(k);
    if (util(cabeza) && texto.endsWith(` ${cabeza.join(' ')}`) && !texto.endsWith(literal)) fuera.push(cabeza.join(' '));
    if (util(cola) && texto.startsWith(`${cola.join(' ')} `) && !texto.startsWith(literal)) fuera.push(cola.join(' '));
  }
  return fuera;
}

async function principal() {
  if (!A.carpeta && !A.desde) {
    decir('Uso: npm run medir:expedientes -- --carpeta DIR [--oro DIR.oro.json] [--informe F] [--json F]');
    process.exit(1);
  }
  const carpeta = path.resolve(A.carpeta ?? A.desde);
  const ORO = A.desde ? null : JSON.parse(fs.readFileSync(path.resolve(A.oro ?? `${carpeta.replace(/\/+$/, '')}.oro.json`), 'utf8'));

  const caja = await comprobarCaja();
  process.env.ROBIN_DATA_DIR = path.join(path.dirname(carpeta), '.datos-robin-medicion');
  process.env.ROBIN_FOLDERS = '';
  const { extractFile } = await import(path.join(RAIZ, 'server', 'indexer', 'extract.js'));
  const { chunkPages } = await import(path.join(RAIZ, 'server', 'indexer', 'chunk.js'));
  const { config } = await import(path.join(RAIZ, 'server', 'config.js'));
  const { Anonimizador, TablaAlias } = await import('./anonimizador/index.mjs');
  const { cargar, medir, bloque } = await import('./banco.mjs');

  let frags = [];
  let sinLocalizar = [];
  let stats = { expedientes: 0, documentos: 0, fragmentos: 0, partidos: 0, porFormato: {} };
  const exps = A.desde ? [] : fs.readdirSync(carpeta, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const exp of exps) {
    stats.expedientes++;
    const docs = fs.readdirSync(path.join(carpeta, exp)).filter((f) => !f.startsWith('.')).sort();
    for (const doc of docs) {
      const rel = `${exp}/${doc}`;
      const anot = ORO[rel];
      if (!anot) throw new Error(`documento sin anotación: ${rel}`);
      const leido = await extractFile(path.join(carpeta, rel), { maxPages: config.maxPagesPerFile });
      const trozos = chunkPages(leido.pages ?? [], { chunkSizeTokens: config.chunkSizeTokens, chunkOverlapTokens: config.chunkOverlapTokens });
      stats.documentos++;
      stats.porFormato[anot.formato] = (stats.porFormato[anot.formato] ?? 0) + 1;
      const oroDoc = anot.oro.map(([t, l, sub]) => [t, plano(l), sub]);
      const visto = new Set();
      trozos.forEach((t, k) => {
        const texto = t.text;
        const oro = [];
        for (const [tipo, lit, sub] of oroDoc) {
          if (texto.includes(lit)) {
            oro.push([tipo, lit, sub]);
            visto.add(lit);
          }
          for (const pieza of trozosEnFrontera(texto, lit)) {
            if (!oroDoc.some(([, l]) => l === pieza)) {
              oro.push([tipo, pieza, sub]);
              stats.partidos++;
            }
          }
        }
        frags.push({
          id: `${rel}#${k}`,
          clase: anot.formato === 'escaneo' ? 'ocr' : anot.formato === 'eml' ? 'correo' : anot.formato === 'whatsapp' ? 'whatsapp' : 'nativo',
          expediente: exp,
          respuesta: `${rel}#${Math.floor(k / 60)}`,
          texto,
          oro,
          ambiguo: (anot.ambiguo ?? []).map(plano),
        });
        stats.fragmentos++;
      });
      for (const [tipo, lit] of oroDoc) {
        if (!visto.has(lit)) sinLocalizar.push({ doc: rel, tipo, lit });
      }
    }
  }

  if (A.desde) ({ frags, sinLocalizar, stats } = JSON.parse(fs.readFileSync(A.desde, 'utf8')));
  if (A.volcar) fs.writeFileSync(A.volcar, JSON.stringify({ frags, sinLocalizar, stats }));

  // Si dos anotaciones del mismo fragmento comparten literal, gana la primera (como en el corpus).
  for (const f of frags) {
    const vistos = new Set();
    f.oro = f.oro.filter(([, l]) => (vistos.has(l) ? false : (vistos.add(l), true)));
  }
  const r = await medir(cargar(frags), { anonimizador: new Anonimizador({ tabla: new TablaAlias() }) });

  const L = [];
  L.push('═'.repeat(96));
  L.push('EXPEDIENTES COMPLETOS — anonimizador v1 (sin modelo), extractor y troceado de RobinSearch');
  L.push(`Carpeta: ${path.basename(carpeta)} · ${stats.expedientes} expedientes · ${stats.documentos} documentos · ${stats.fragmentos} fragmentos`);
  L.push(`Formatos: ${Object.entries(stats.porFormato).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  L.push(`Datos partidos por la frontera de un fragmento (medidos también): ${stats.partidos}`);
  L.push(`Red: ${caja === 'sin caja' ? 'sin caja del sistema' : `cortada por el sistema (prueba → ${caja})`}`);
  L.push(`Anotaciones que el extractor no deja en ningún fragmento: ${sinLocalizar.length}`);
  for (const s of sinLocalizar.slice(0, 30)) L.push(`   · [${s.doc}] ${s.tipo} ${JSON.stringify(s.lit)}`);
  L.push('═'.repeat(96));
  bloque(r, 'RESULTADO', L);
  // Todas las escapadas de categoría especial, sin recortar: es lo que Juan quiere ver primero.
  const esp = r.escapadas.filter((e) => e.tipo === 'CAT_ESPECIAL' || e.tipo === 'DATO_PENAL');
  L.push('');
  L.push(`   CATEGORÍA ESPECIAL Y DATO PENAL QUE SE ESCAPAN: ${esp.length}`);
  for (const e of esp) L.push(`     · [${e.frag}] ${e.tipo}${e.sub ? `/${e.sub}` : ''} ${JSON.stringify(e.valor)}`);
  L.push('');
  L.push(`   TODAS LAS ESCAPADAS: ${r.escapadas.length}`);
  for (const e of r.escapadas) L.push(`     · [${e.frag}] ${e.tipo}${e.sub ? `/${e.sub}` : ''} ${JSON.stringify(e.valor)}`);
  L.push('');
  L.push(`   TODO LO TAPADO DE MÁS: ${r.deMas.length}`);
  for (const f of r.deMas) L.push(`     · [${f.frag}] ${f.tipo} ${JSON.stringify(f.valor)} (${f.via})`);
  L.push('');
  L.push(`   TODOS LOS INTOCABLES TAPADOS: ${r.intocables.ejemplos.length}`);
  for (const e of r.intocables.ejemplos) L.push(`     · [${e.frag}] ${e.tipo} ${JSON.stringify(e.valor)}  ← ${(e.por ?? []).join(' | ')}`);
  const texto = L.join('\n');
  if (A.informe) fs.writeFileSync(A.informe, `${texto}\n`);
  if (A.json) fs.writeFileSync(A.json, `${JSON.stringify({ stats, sinLocalizar, ...r }, null, 2)}\n`);

  // Por pantalla, el resumen.
  const tot = Object.values(r.porTipo).reduce((a, v) => [a[0] + v.oro, a[1] + v.cubiertas], [0, 0]);
  decir(L.slice(0, 7).join('\n'));
  decir('');
  for (const [t, v] of Object.entries(r.porTipo)) decir(`   ${t.padEnd(14)} ${String(v.cubiertas).padStart(5)}/${String(v.oro).padEnd(5)} ${((v.cubiertas / v.oro) * 100).toFixed(1)} %`);
  decir(`   ${'TOTAL'.padEnd(14)} ${String(tot[1]).padStart(5)}/${String(tot[0]).padEnd(5)} ${((tot[1] / tot[0]) * 100).toFixed(1)} %`);
  decir('');
  for (const [t, v] of Object.entries(r.porSub ?? {})) decir(`   especial/${t.padEnd(12)} ${String(v.cubiertas).padStart(5)}/${String(v.oro).padEnd(5)} ${((v.cubiertas / v.oro) * 100).toFixed(1)} %`);
  decir('');
  decir(`   intocables tapados ${r.intocables.sobreConGuardia}/${r.intocables.oro} · tapado de más ${r.deMas.length} (${((r.caracteres.deMas / Math.max(1, r.caracteres.libres)) * 100).toFixed(1)} % del texto que no es dato) · fusiones ${r.fusiones.length} · ida y vuelta rotos ${r.idaVuelta.ko}`);
  if (A.informe) decir(`\n   Informe completo: ${A.informe}`);
}

principal().catch((e) => {
  process.stderr.write(`\n✗ ${e.stack}\n`);
  process.exit(1);
});
