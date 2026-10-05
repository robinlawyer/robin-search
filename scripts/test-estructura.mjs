// «Buscar por estructura» (correo de Juan del 1-oct-2026): indice_documento, leer_seccion y la
// fase 2 de buscar_documentos detrás de ROBIN_SECCIONES_EN_BUSQUEDA. Se prueba con el servidor de
// verdad por MCP, como lo usa Claude:
//
//   · El extractor con saltos de línea da los MISMOS fragmentos, carácter a carácter (no hay que
//     reindexar a nadie).
//   · El índice de un contrato en PDF de varias páginas: cláusulas, anexos, títulos partidos en dos
//     líneas, páginas; y el de un escrito con hechos y fundamentos.
//   · leer_seccion por id y por nombre («Anexo II», «cláusula quinta», «hecho tercero»), con sus
//     remisiones; las remisiones EXTERNAS («art. 1.902 del Código Civil») no cuentan.
//   · La remisión errónea del propio texto («la Comisión de Seguimiento de la cláusula sexta», que
//     está en la séptima) se sigue al pie de la letra y se AVISA.
//   · Aislamiento: un doc_id de otro expediente no devuelve ni índice ni sección.
//   · Interruptor apagado: buscar_documentos responde exactamente con los campos de siempre.
//     Encendido: cada fragmento trae su sección y a qué otras remite.
//   · Todo sale por el mismo punto de respuesta que el resto de herramientas (donde irá el filtro
//     del anonimizador): las dos herramientas están en tools/list y responden por tools/call.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const terminar = (p) => (p.exitCode !== null || p.signalCode !== null ? Promise.resolve() : new Promise((r) => {
  p.once('exit', r); p.kill(); setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* */ } }, 15000).unref();
}));
const borrar = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };

// ───────────────────────── 1. Unidades del árbol, sin servidor ─────────────────────────
const A = await import(pathToFileURL(path.join(REPO, 'server/estructura/arbol.js')).href);
check('ordinales en letra', A.ordinalANumero('decimotercera') === 13 && A.ordinalANumero('Décimo tercero') === 13
  && A.ordinalANumero('décimo-tercero') === 13 && A.ordinalANumero('vigésima primera') === 21 && A.ordinalANumero('undécimo') === 11
  && A.ordinalANumero('séptima') === 7 && A.ordinalANumero('única') === 1);
check('romanos bien formados y nada más', A.romanoANumero('XIV') === 14 && A.romanoANumero('IIII') === null && A.romanoANumero('civil') === null);
{
  const t = 'CAPÍTULO I\nDisposiciones generales\nArtículo 1. Objeto.\nTexto.\nArtículo 2. Forma, condiciones y plazo de preaviso de denuncia de la vigencia del\nconvenio.\n1. El presente convenio será de aplicación a todas las personas\ntrabajadoras de la empresa.\nANEXO II\nTablas salariales\nGrupo 1: 20.000 euros.\n';
  const a = A.construirArbol(t);
  const et = a.nodos.map((n) => `${n.etiqueta}|${n.titulo}`);
  check('un título partido en dos líneas se une; un párrafo numerado partido no es rótulo',
    et.includes('Artículo 2|Forma, condiciones y plazo de preaviso de denuncia de la vigencia del convenio') && !et.some((e) => e.startsWith('1|')), et.join(' · '));
  check('el anexo cuelga de la raíz y su título es la línea siguiente', a.nodos.find((n) => n.etiqueta === 'Anexo II')?.padre === null
    && a.nodos.find((n) => n.etiqueta === 'Anexo II')?.titulo === 'Tablas salariales');
}
{
  const t = 'ESTIPULACIONES\nPRIMERA.- Objeto.\nSe arrienda el local. Según el artículo 1.902 del Código Civil y el art. 24 CE, y conforme a la estipulación tercera.\nSEGUNDA.- Renta.\nLa del Anexo II.\nTERCERA.- Fianza.\nDos meses.\nANEXO II\nCuadro de rentas\n';
  const a = A.construirArbol(t); const r = A.remisiones(t, a); const porId = new Map(a.nodos.map((n) => [n.id, n]));
  const destinos = r.map((x) => porId.get(x.destino).etiqueta);
  check('remisiones internas resueltas; las externas fuera', destinos.includes('Tercera') && destinos.includes('Anexo II') && !r.some((x) => /1\.902|24/.test(x.texto)), destinos.join(','));
}

// ───────────────────────── 2. Expedientes de prueba ─────────────────────────
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-estructura-'));
const MADRE = path.join(base, 'Expedientes');
const EXP_A = path.join(MADRE, 'Arrendamiento-Local');
const EXP_B = path.join(MADRE, 'Otro-Cliente');
fs.mkdirSync(EXP_A, { recursive: true });
fs.mkdirSync(EXP_B, { recursive: true });

const mupdf = await import(pathToFileURL(path.join(REPO, 'node_modules', 'mupdf', 'dist', 'mupdf.js')).href);
// PDF de varias páginas, una línea por renglón (como un PDF de verdad: los párrafos van partidos).
function pdfDePaginas(paginas) {
  const doc = new mupdf.PDFDocument();
  const fuente = doc.addSimpleFont(new mupdf.Font('Helvetica'));
  const recursos = doc.addObject({ Font: { F1: fuente } });
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  for (const lineas of paginas) {
    const cuerpo = lineas.map((l, i) => `BT /F1 10 Tf 40 ${800 - i * 14} Td (${esc(l)}) Tj ET`).join('\n');
    doc.insertPage(-1, doc.addPage([0, 0, 600, 842], 0, recursos, cuerpo));
  }
  return doc.saveToBuffer('compress').asUint8Array();
}
const relleno = (n, tema) => Array.from({ length: n }, (_, i) => `texto del contrato sobre ${tema}, renglon ${i + 1} de la clausula, sin mas`);
const PAG1 = [
  'CONTRATO DE ARRENDAMIENTO DE LOCAL DE NEGOCIO',
  'REUNIDOS',
  'De una parte el arrendador y de otra el arrendatario.',
  'ESTIPULACIONES',
  'PRIMERA.- Objeto del contrato.',
  'El arrendador cede el local en los terminos del Anexo II, y la renta se',
  'actualizara conforme a la clausula tercera. Responde segun el articulo 1.902 del',
  'Codigo Civil.',
  ...relleno(12, 'objeto'),
  'SEGUNDA.- Duracion.',
  'Cinco anos desde la firma. CLAVE-DURACION-5521.',
  ...relleno(10, 'duracion'),
];
const PAG2 = [
  'TERCERA.- Renta y actualizacion.',
  'La renta mensual es de 2.300 euros y se actualizara cada ano. CLAVE-RENTA-7710.',
  ...relleno(12, 'renta'),
  'CUARTA.- Resolucion de discrepancias.',
  'Las discrepancias se someteran a la Comision de Seguimiento prevista en la',
  'clausula quinta del presente contrato.',
  'QUINTA.- Fianza.',
  'Dos mensualidades de fianza. CLAVE-FIANZA-3301.',
  'SEXTA.- Comision de Seguimiento.',
  'Se crea una comision de dos miembros, uno por cada parte. CLAVE-COMISION-9090.',
];
const PAG3 = [
  'ANEXO II',
  'Inventario del local',
  'Mostrador, dos vitrinas, camara frigorifica y rotulo luminoso. CLAVE-INVENTARIO-4242.',
  ...relleno(8, 'inventario'),
];
fs.writeFileSync(path.join(EXP_A, 'contrato local.pdf'), pdfDePaginas([PAG1, PAG2, PAG3]));
fs.writeFileSync(path.join(EXP_A, 'demanda.txt'), [
  'AL JUZGADO DE PRIMERA INSTANCIA',
  'HECHOS',
  'PRIMERO.- El contrato se firmo en 2024.',
  'SEGUNDO.- Se dejo de pagar la renta, como se expone en el hecho tercero.',
  'TERCERO.- Impago de tres mensualidades. CLAVE-IMPAGO-6060.',
  'FUNDAMENTOS DE DERECHO',
  'I. Competencia. Articulo 52 LEC.',
  'II. Fondo. Resolucion por impago.',
  'SUPLICO',
  'Que se dicte sentencia de desahucio.',
].join('\n'));
fs.writeFileSync(path.join(EXP_B, 'contrato ajeno.txt'), [
  'ESTIPULACIONES', 'PRIMERA.- Objeto.', 'Contrato de otro cliente. SECRETO-AJENO-1234. Ver Anexo I.', 'ANEXO I', 'Lista secreta. SECRETO-AJENO-1234.',
].join('\n'));

// ───────────────────────── 3. Identidad de fragmentos con y sin saltos ─────────────────────────
{
  const { extractFile } = await import(pathToFileURL(path.join(REPO, 'server/indexer/extract.js')).href);
  const { chunkPages } = await import(pathToFileURL(path.join(REPO, 'server/indexer/chunk.js')).href);
  const f = path.join(EXP_A, 'contrato local.pdf');
  const a = await extractFile(f, {});
  const b = await extractFile(f, { conSaltos: true });
  const ca = chunkPages(a.pages, { chunkSizeTokens: 60, chunkOverlapTokens: 10 });
  const cb = chunkPages(b.pages, { chunkSizeTokens: 60, chunkOverlapTokens: 10 });
  check('con saltos de línea los fragmentos son idénticos carácter a carácter',
    b.pages.some((p) => p.text.includes('\n')) && !a.pages.some((p) => p.text.includes('\n'))
      && ca.length === cb.length && ca.every((c, i) => c.text === cb[i].text && c.page === cb[i].page), `${ca.length} fragmentos`);
}

// ───────────────────────── 4. Servidor ─────────────────────────
function arrancar(extraEnv, datos) {
  const env = { ...process.env, ROBIN_TOKEN: 't', ROBIN_FOLDERS: MADRE, ROBIN_DATA_DIR: datos, ROBIN_OCR: 'false',
    ROBIN_LOG_LEVEL: 'error', ROBIN_UPDATE_URL: 'http://127.0.0.1:9/no', ROBIN_CHUNK_SIZE: '60', ROBIN_CHUNK_OVERLAP: '10', ...extraEnv };
  delete env.ROBIN_SECCIONES_EN_BUSQUEDA;
  Object.assign(env, extraEnv);
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
    return { isError: Boolean(r.result?.isError), data: t ? JSON.parse(t) : r, raw: t || '', estructurado: r.result?.structuredContent };
  };
  return { c, rpc, call };
}

async function listo(s) {
  await s.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  s.c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  let est;
  for (let i = 0; i < 120; i++) {
    est = (await s.call('estado_servidor')).data;
    if (est.estado === 'activo' && est.documentos_indexados >= 3) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return est;
}

const CAMPOS_DE_SIEMPRE = ['doc_id', 'chunk_id', 'texto', 'fichero', 'raiz', 'expediente', 'ruta_relativa', 'pagina', 'fecha_modificacion', 'score'];

async function main() {
  const datos = path.join(base, 'datos');
  const s = arrancar({}, datos);
  try {
    const est = await listo(s);
    check('los tres documentos se indexan', est.documentos_indexados === 3, `documentos=${est.documentos_indexados}`);

    const lista = await s.rpc('tools/list', {});
    const nombres = lista.result.tools.map((t) => t.name);
    check('indice_documento y leer_seccion se ofrecen (mismo punto de respuesta que el resto)', nombres.includes('indice_documento') && nombres.includes('leer_seccion'));
    const anot = lista.result.tools.filter((t) => ['indice_documento', 'leer_seccion'].includes(t.name)).every((t) => t.annotations?.readOnlyHint === true);
    check('las dos son de solo lectura', anot);

    await s.call('establecer_expediente_activo', { expediente: 'Arrendamiento-Local' });
    const docs = (await s.call('listar_documentos_indexados')).data.documentos;
    const idDe = (nombre) => docs.find((d) => (d.ruta_relativa || d.fichero || '').endsWith(nombre))?.doc_id;
    const pdfId = idDe('contrato local.pdf');
    const demId = idDe('demanda.txt');

    // Interruptor APAGADO: los campos de siempre, ni uno más.
    const b0 = await s.call('buscar_documentos', { query: 'inventario del local mostrador vitrinas', n_resultados: 5 });
    const claves = new Set(b0.data.fragmentos.flatMap((f) => Object.keys(f)));
    check('interruptor apagado: buscar_documentos devuelve exactamente los campos de siempre',
      [...claves].every((k) => CAMPOS_DE_SIEMPRE.includes(k)) && Object.keys(b0.data).join() === 'query,expediente,n_resultados,fragmentos', [...claves].join(','));

    // Índice del PDF.
    const ind = await s.call('indice_documento', { doc_id: pdfId });
    const secs = ind.data.secciones || [];
    const busca = (et) => secs.find((x) => x.etiqueta === et);
    check('índice exacto del PDF (vuelto a leer con saltos y comprobado contra el índice)', ind.data.modo === 'exacto', ind.data.aviso_modo || '');
    check('estipulaciones, cláusulas con título y anexo con su título',
      busca('Estipulaciones') && busca('Primera')?.titulo === 'Objeto del contrato' && busca('Sexta')?.titulo === 'Comision de Seguimiento'
        && busca('Anexo II')?.titulo === 'Inventario del local', secs.map((x) => `${x.etiqueta}:${x.titulo ?? ''}`).join(' · '));
    check('páginas de cada sección', busca('Tercera')?.paginas === '2' && busca('Anexo II')?.paginas === '3' && busca('Primera')?.paginas === '1', JSON.stringify(busca('Tercera')));
    check('la primera cláusula remite al Anexo II y a la tercera (y no al Código Civil)',
      (busca('Primera')?.remite_a || []).length === 2, JSON.stringify(busca('Primera')?.remite_a));
    const aviso = (ind.data.avisos_de_remision || [])[0];
    check('la remisión errónea del propio texto se sigue y se AVISA (Comisión de Seguimiento → quinta, está en la sexta)',
      aviso && aviso.etiqueta === 'Quinta' && aviso.posible_seccion_id === busca('Sexta')?.id, JSON.stringify(ind.data.avisos_de_remision));

    // leer_seccion por nombre y por id.
    const an = await s.call('leer_seccion', { doc_id: pdfId, seccion: 'Anexo II' });
    check('leer_seccion("Anexo II") trae el anexo entero, con saltos y su página',
      an.data.texto?.includes('CLAVE-INVENTARIO-4242') && an.data.texto.includes('\n') && an.data.texto.startsWith('[pág. 3]') && !an.data.texto.includes('CLAVE-RENTA'), an.data.texto?.slice(0, 80));
    const q = await s.call('leer_seccion', { doc_id: pdfId, seccion: 'cláusula tercera' });
    check('leer_seccion("cláusula tercera") trae solo la tercera', q.data.texto?.includes('CLAVE-RENTA-7710') && !q.data.texto.includes('CLAVE-COMISION') && q.data.seccion?.etiqueta === 'Tercera');
    const p1 = await s.call('leer_seccion', { doc_id: pdfId, seccion: busca('Primera').id });
    check('leer_seccion por id devuelve las remisiones a seguir', (p1.data.remite_a || []).map((r) => r.etiqueta).sort().join() === 'Anexo II,Tercera', JSON.stringify(p1.data.remite_a));
    const est4 = await s.call('leer_seccion', { doc_id: pdfId, seccion: 'cuarta' });
    check('la remisión con aviso lleva el aviso también al leer la sección', (est4.data.remite_a || []).some((r) => r.aviso && r.posible_seccion_id === busca('Sexta').id), JSON.stringify(est4.data.remite_a || est4.data));
    const nada = await s.call('leer_seccion', { doc_id: pdfId, seccion: 'Anexo IX' });
    check('una sección que no existe: error claro con las disponibles', nada.isError && (nada.data.secciones_disponibles || []).length > 3);
    // Sección larga troceada: con desde_caracter.
    const est0 = await s.call('leer_seccion', { doc_id: pdfId, seccion: 'Estipulaciones' });
    check('una sección con subsecciones las lista', (est0.data.subsecciones || []).length === 6, JSON.stringify(est0.data.subsecciones));

    // Escrito con hechos y fundamentos.
    const indD = await s.call('indice_documento', { doc_id: demId });
    const sd = indD.data.secciones || [];
    check('índice del escrito: hechos, fundamentos en romanos, suplico',
      ['Hechos', 'Primero', 'Segundo', 'Tercero', 'Fundamentos de derecho', 'I', 'II', 'Suplico'].every((e) => sd.some((x) => x.etiqueta === e)), sd.map((x) => x.etiqueta).join(','));
    const h3 = await s.call('leer_seccion', { doc_id: demId, seccion: 'hecho tercero' });
    check('leer_seccion("hecho tercero")', h3.data.texto?.includes('CLAVE-IMPAGO-6060') && !h3.data.texto.includes('2024'));
    const h2 = await s.call('leer_seccion', { doc_id: demId, seccion: 'hecho segundo' });
    check('el hecho segundo remite al tercero', (h2.data.remite_a || []).some((r) => r.etiqueta === 'Tercero'));

    // Aislamiento.
    const ajenoId = (await s.call('listar_documentos_indexados', { expediente: 'Otro-Cliente' })).data.documentos?.[0]?.doc_id;
    const i2 = await s.call('indice_documento', { doc_id: ajenoId });
    const l2 = await s.call('leer_seccion', { doc_id: ajenoId, seccion: 'Anexo I' });
    check('aislamiento: el índice de un documento de OTRO expediente no se sirve', i2.isError && !i2.raw.includes('SECRETO-AJENO'));
    check('aislamiento: ni una sección suya', l2.isError && !l2.raw.includes('SECRETO-AJENO'));
    const sin = await s.call('indice_documento', {});
    check('sin doc_id: error', sin.isError);

    // La respuesta es la MISMA en texto y en structuredContent (lo que verá el filtro de salida).
    check('texto y structuredContent coinciden (un solo punto de salida)', JSON.stringify(ind.estructurado) === JSON.stringify(ind.data));
    check('sin el modo de prueba, las piezas NO salen en la respuesta', !ind.raw.includes('_piezas_prueba') && !('_piezas_prueba' in (ind.estructurado || {})));
  } finally {
    await terminar(s.c);
  }

  // Interruptor ENCENDIDO (y modo de prueba de piezas: comprueba que TODO el texto del despacho de
  // las respuestas nuevas está registrado para el filtro del anonimizador).
  const s2 = arrancar({ ROBIN_SECCIONES_EN_BUSQUEDA: '1', ROBIN_PRUEBA_PIEZAS: '1' }, path.join(base, 'datos'));
  try {
    await listo(s2);
    await s2.call('establecer_expediente_activo', { expediente: 'Arrendamiento-Local' });
    // La primera búsqueda puede dejar la estructura calculándose en segundo plano (presupuesto de
    // 1,5 s): es lo previsto. La segunda ya la tiene.
    const q1 = { query: 'cede el local en los terminos del Anexo II actualizara conforme a la clausula tercera', n_resultados: 5 };
    const b0b = await s2.call('buscar_documentos', q1);
    check('la búsqueda con el interruptor responde aunque la estructura no esté lista', Array.isArray(b0b.data.fragmentos) && b0b.data.fragmentos.length > 0);
    await new Promise((r) => setTimeout(r, 3000));
    const b1 = await s2.call('buscar_documentos', q1);
    const dePrimera = b1.data.fragmentos.filter((f) => f.seccion?.etiqueta === 'Primera');
    const remitidas = new Set(dePrimera.flatMap((f) => (f.remite_a || []).map((r) => r.etiqueta)));
    check('interruptor encendido: cada fragmento trae su sección y a qué otras remite',
      dePrimera.length > 0 && remitidas.has('Anexo II') && remitidas.has('Tercera') && dePrimera.every((f) => f.seccion.ruta === 'Estipulaciones › Primera'),
      JSON.stringify(b1.data.fragmentos.map((f) => [f.seccion?.etiqueta, (f.remite_a || []).map((r) => r.etiqueta)])));
    check('los campos de siempre siguen igual con el interruptor encendido', b1.data.fragmentos.every((f) => CAMPOS_DE_SIEMPRE.every((k) => k in f)));

    const norm = (x) => String(x).replace(/…$/, '').replace(/\s+/g, ' ').trim();
    const cubre = (piezas, v) => !v || piezas.some((p) => norm(p).includes(norm(v)));
    const pzB = b1.estructurado._piezas_prueba || [];
    const titulosB = b1.data.fragmentos.flatMap((f) => [f.seccion?.titulo, ...(f.remite_a || []).map((r) => r.titulo)]).filter(Boolean);
    check('piezas · los títulos que añade la búsqueda están registrados para el filtro', titulosB.length > 0 && titulosB.every((t) => cubre(pzB, t)), JSON.stringify(titulosB.filter((t) => !cubre(pzB, t))));

    const docs2 = (await s2.call('listar_documentos_indexados')).data.documentos;
    const pdf2 = docs2.find((d) => (d.ruta_relativa || '').endsWith('contrato local.pdf')).doc_id;
    const ind2 = await s2.call('indice_documento', { doc_id: pdf2 });
    const pzI = ind2.estructurado._piezas_prueba || [];
    const textosI = [...ind2.data.secciones.flatMap((x) => [x.titulo, x.arranque]), ...(ind2.data.avisos_de_remision || []).flatMap((a) => [a.titulo])].filter(Boolean);
    check('piezas · cada título y arranque del índice está registrado', textosI.length > 5 && textosI.every((t) => cubre(pzI, t)), JSON.stringify(textosI.filter((t) => !cubre(pzI, t))));
    const temas = (ind2.data.avisos_de_remision || []).map((a) => a.aviso.match(/habla de «([^»]+)»/)?.[1]).filter(Boolean);
    check('piezas · el tema que cita un aviso de remisión está registrado', temas.length > 0 && temas.every((t) => cubre(pzI, t)), JSON.stringify(temas));

    for (const nombre of ['Anexo II', 'cláusula cuarta', 'Estipulaciones']) {
      const ls = await s2.call('leer_seccion', { doc_id: pdf2, seccion: nombre });
      const pz = ls.estructurado._piezas_prueba || [];
      const sinMarcas = norm(ls.data.texto.replace(/\[pág\. \d+\]/g, ' '));
      const titulos = [ls.data.seccion?.titulo, ...(ls.data.remite_a || []).map((r) => r.titulo)].filter(Boolean);
      check(`piezas · leer_seccion("${nombre}"): el texto entero y los títulos están registrados`,
        sinMarcas.length > 20 && norm(pz.join(' ')).includes(sinMarcas.slice(0, 200)) && sinMarcas.split(' ').every((w) => norm(pz.join(' ')).includes(w)) && titulos.every((t) => cubre(pz, t)));
    }
  } finally {
    await terminar(s2.c);
    borrar(base);
  }

  const fallos = results.filter((x) => !x).length;
  console.log(`\n${results.length - fallos}/${results.length} comprobaciones OK`);
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
