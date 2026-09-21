// ESCENARIO (1.8.1): la correspondencia del caso, DENTRO del expediente.
//
// Hasta la 1.8.0, el correo se leía en vivo contra el buzón y ahí se quedaba: no era un fichero
// del expediente, así que buscar_documentos no lo alcanzaba y el abogado tenía que acordarse de
// buscarlo aparte. Y guardar solo el adjunto tampoco vale: sin el correo que lo traía no consta
// quién lo mandó, cuándo, ni qué decía (Juan Maza, 21-sep-2026).
//
// Lo que se prueba aquí es justo lo que puede salir mal en un despacho:
//   · Que NUNCA se adivine el expediente: sin uno activo, se pregunta.
//   · Que no se escriba nada sin confirmar, y que la pregunta diga REMITENTE y EXPEDIENTE en la
//     misma frase — el error que hay que ver antes es meter el correo de un cliente en el
//     expediente de otro.
//   · Que el .eml archivado conserve las cabeceras originales (es lo que pesa como prueba).
//   · Que el mismo contenido no se guarde dos veces aunque venga con OTRO nombre de fichero.
//   · Que jamás se pise un documento del abogado.
//   · Que el nombre del fichero lo escribe un tercero: un adjunto «../../otro cliente.pdf» no
//     puede salirse de la carpeta.
//   · Y que, una vez archivado, el caso se busca JUNTO: el correo aparece en buscar_documentos
//     por el texto del PDF que llevaba dentro, y no se ve desde el expediente del otro cliente.
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-archivo-'));
const MADRE = path.join(base, 'Expedientes');
const PEREZ = path.join(MADRE, 'Pérez - Divorcio');
const NUNEZ = path.join(MADRE, 'Núñez - Reclamación');
fs.mkdirSync(PEREZ, { recursive: true });
fs.mkdirSync(NUNEZ, { recursive: true });
fs.writeFileSync(path.join(PEREZ, '01 demanda.txt'), 'Demanda de divorcio contencioso. '.repeat(30));
fs.writeFileSync(path.join(NUNEZ, '01 contrato.txt'), 'Contrato de obra y reclamación de cantidad. '.repeat(30));

process.env.ROBIN_DATA_DIR = path.join(base, 'datos');
process.env.ROBIN_FOLDERS = MADRE;
process.env.ROBIN_LOG_LEVEL = 'error';
process.env.ROBIN_TOKEN = 't';
process.env.ROBIN_CORREO_LLAVERO = 'fichero';
process.env.ROBIN_VIGILANTE = 'ninguno';     // aquí indexa la herramienta, no el vigilante
fs.mkdirSync(process.env.ROBIN_DATA_DIR, { recursive: true });

const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { BuzonFalso, levantar } = await imp('scripts/fixtures/imap-falso.mjs');
const ajustes = await imp('server/correo/ajustes.js');
const llavero = await imp('server/correo/llavero.js');
const conexion = await imp('server/correo/conexion.js');
const escritor = await imp('server/escritor.js');
const archivo = await imp('server/correo/archivo.js');
const expedientes = await imp('server/expedientes.js');
const archivarCorreo = (await imp('server/tools/archivar_correo.js')).default;
const leerCorreoTool = (await imp('server/tools/leer_correo.js')).default;
const buscarDocumentos = (await imp('server/tools/buscar_documentos.js')).default;
const establecerExpediente = (await imp('server/tools/establecer_expediente_activo.js')).default;

const datos = (r) => r.structuredContent;
const CUENTA = 'abogado@despacho.test';
const CLAVE = 'clave de prueba 2026';
escritor.adquirir();

// ── El buzón: un correo del proveedor con el requerimiento en PDF ──
const pdf = fs.readFileSync(path.join(REPO, 'scripts/fixtures/requerimiento.pdf'));
const buzon = new BuzonFalso({ usuario: CUENTA, clave: CLAVE });
const limite = 'limite-adjunto';
const conPdf = buzon.anadir('INBOX', {
  de: 'Suministros Vidal <facturacion@vidal.test>', para: CUENTA, asunto: 'Requerimiento de pago',
  fecha: new Date('2026-09-20T10:00:00Z'),
  mime: Buffer.from([
    'From: Suministros Vidal <facturacion@vidal.test>', `To: ${CUENTA}`, 'Subject: Requerimiento de pago',
    'Date: Sun, 20 Sep 2026 10:00:00 GMT', 'Message-ID: <req-vidal@vidal.test>', 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary=${limite}`, '',
    `--${limite}`, 'Content-Type: text/plain; charset=utf-8', '', 'Le adjunto el requerimiento.', '',
    `--${limite}`, 'Content-Type: application/pdf; name="requerimiento.pdf"',
    'Content-Disposition: attachment; filename="requerimiento.pdf"',
    'Content-Transfer-Encoding: base64', '', pdf.toString('base64'), `--${limite}--`,
  ].join('\r\n'), 'utf8'),
});
const servidor = await levantar(buzon);
await llavero.guardar(CUENTA, CLAVE);
ajustes.guardarCorreo({
  usuario: CUENTA,
  imap: { host: '127.0.0.1', puerto: servidor.puerto, tls: false },
  carpetas: { borradores: null, enviados: null },
  configuradoEl: new Date().toISOString(),
});

const COMUNICACIONES = path.join(PEREZ, archivo.CARPETA_COMUNICACIONES);
const ficherosDe = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

// ─────────── 1. Sin expediente: se pregunta, no se adivina ───────────
{
  expedientes.setActivo(null);
  const r = datos(await archivarCorreo.handler({ uid: conPdf, confirmar: true }));
  check('sin expediente activo no archiva: lo pide', r.error && r.motivo === 'sin_expediente', r.motivo || 'sin error');
  check('y dice cuáles hay para elegir',
    (r.expedientes_disponibles || []).some((x) => /Pérez/.test(x)), JSON.stringify(r.expedientes_disponibles));
  check('y no ha escrito nada en el expediente', ficherosDe(COMUNICACIONES).length === 0);
}

// ─────────── 2. Sin confirmar: la frase que ve el abogado ───────────
{
  await establecerExpediente.handler({ expediente: 'Pérez - Divorcio' });
  const r = datos(await archivarCorreo.handler({ uid: conPdf }));
  check('sin confirmar, no escribe: solo dice qué haría', r.confirmacion_pendiente === true && ficherosDe(COMUNICACIONES).length === 0);
  check('la pregunta lleva REMITENTE y EXPEDIENTE en la misma frase',
    /Suministros Vidal/.test(r.pregunta || '') && /Pérez - Divorcio/.test(r.pregunta || ''), r.pregunta);
  check('dice exactamente qué fichero se escribiría y dónde',
    (r.se_escribiria || []).some((f) => f.endsWith('.eml')) && /Comunicaciones/.test(r.carpeta_destino || ''),
    `${JSON.stringify(r.se_escribiria)} en ${r.carpeta_destino}`);
  check('y lista los adjuntos del correo', (r.adjuntos_del_correo || []).some((a) => a.nombre === 'requerimiento.pdf'));
}

// ─────────── 3. Confirmado: el .eml, con sus cabeceras ───────────
let emlGuardado = null;
{
  const r = datos(await archivarCorreo.handler({ uid: conPdf, confirmar: true }));
  const ficheros = ficherosDe(COMUNICACIONES);
  emlGuardado = ficheros.find((f) => f.endsWith('.eml')) || null;
  check('archivado: queda un .eml en «Comunicaciones» del expediente', r.archivado === true && Boolean(emlGuardado), ficheros.join(', ') || r.error);
  check('el nombre del fichero lleva fecha, remitente y asunto',
    /^2026-09-20 \d{4} - Suministros Vidal - Requerimiento de pago\.eml$/.test(emlGuardado || ''), emlGuardado);
  const crudo = fs.readFileSync(path.join(COMUNICACIONES, emlGuardado), 'utf8');
  check('y es el correo ORIGINAL, con sus cabeceras completas (lo que pesa como prueba)',
    /^Message-ID: <req-vidal@vidal\.test>$/m.test(crudo) && /^From: Suministros Vidal/m.test(crudo) && crudo.includes(pdf.toString('base64').slice(0, 40)));
  check('no ha tocado el expediente del otro cliente', ficherosDe(path.join(NUNEZ, archivo.CARPETA_COMUNICACIONES)).length === 0);
}

// ─────────── 4. Dos veces el mismo correo: se avisa, no se duplica ───────────
{
  const r = datos(await archivarCorreo.handler({ uid: conPdf, confirmar: true }));
  check('archivar otra vez el mismo correo no deja una copia repetida',
    ficherosDe(COMUNICACIONES).filter((f) => f.endsWith('.eml')).length === 1 && (r.ya_estaban || []).length === 1,
    JSON.stringify(ficherosDe(COMUNICACIONES)));
  check('y se dice con qué nombre está ya guardado', /está guardado como/.test(r.nota || ''), r.nota);
}

// ─────────── 5. El mismo contenido con OTRO nombre ───────────
{
  // El abogado ya se había guardado el PDF a mano, con su nombre: «escrito.pdf» y «factura.pdf»
  // se repiten muchísimo entre remitentes distintos, así que el nombre no vale para saber si es
  // el mismo documento. El contenido sí.
  fs.writeFileSync(path.join(PEREZ, 'requerimiento del proveedor.pdf'), pdf);
  const r = datos(await archivarCorreo.handler({ uid: conPdf, que: 'adjunto', adjunto: 'requerimiento.pdf', confirmar: true }));
  check('un adjunto que ya está en el expediente con otro nombre: se avisa y no se duplica',
    (r.ya_estaban || []).length === 1 && /requerimiento del proveedor\.pdf/.test(r.nota || ''), r.nota);
  check('y no se ha escrito el PDF suelto', !ficherosDe(COMUNICACIONES).some((f) => f.endsWith('.pdf')));

  const forzado = datos(await archivarCorreo.handler({ uid: conPdf, que: 'adjunto', adjunto: 'requerimiento.pdf', confirmar: true, aunque_este_repetido: true }));
  check('si el abogado insiste, se guarda igualmente', (forzado.ficheros || []).some((f) => f.fichero === 'requerimiento.pdf'), forzado.nota);
}

// ─────────── 6. Jamás se pisa un documento del abogado ───────────
{
  const yaEstaba = path.join(COMUNICACIONES, 'requerimiento.pdf');
  const antes = fs.readFileSync(yaEstaba);
  fs.writeFileSync(yaEstaba, 'ESTO LO ESCRIBIÓ EL ABOGADO');   // mismo nombre, otro contenido
  const r = datos(await archivarCorreo.handler({ uid: conPdf, que: 'adjunto', adjunto: 'requerimiento.pdf', confirmar: true, aunque_este_repetido: true }));
  check('el fichero que ya existía sigue intacto', fs.readFileSync(yaEstaba, 'utf8') === 'ESTO LO ESCRIBIÓ EL ABOGADO');
  check('y el nuevo se escribe al lado, con « (2)»',
    (r.ficheros || []).some((f) => f.fichero === 'requerimiento (2).pdf'), JSON.stringify((r.ficheros || []).map((f) => f.fichero)));
  check('el contenido del nuevo es el del adjunto de verdad',
    fs.readFileSync(path.join(COMUNICACIONES, 'requerimiento (2).pdf')).equals(antes));
}

// ─────────── 7. El nombre lo escribe un TERCERO ───────────
{
  // Un remitente puede llamar a su adjunto como quiera. Si el nombre decidiera la ruta, bastaría
  // un correo para escribir en el expediente de otro cliente — o fuera de la carpeta vigilada.
  const malicioso = buzon.anadir('INBOX', {
    de: 'atacante@fuera.test', para: CUENTA, asunto: 'Fuga', fecha: new Date('2026-09-21T09:00:00Z'),
    mime: Buffer.from([
      'From: atacante@fuera.test', `To: ${CUENTA}`, 'Subject: Fuga',
      'Date: Mon, 21 Sep 2026 09:00:00 GMT', 'Message-ID: <fuga@fuera.test>', 'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary=x', '',
      '--x', 'Content-Type: text/plain; charset=utf-8', '', 'Mira el adjunto.', '',
      '--x', 'Content-Type: application/pdf; name="../../../Núñez - Reclamación/colado.pdf"',
      'Content-Disposition: attachment; filename="../../../Núñez - Reclamación/colado.pdf"',
      'Content-Transfer-Encoding: base64', '', pdf.toString('base64'), '--x--',
    ].join('\r\n'), 'utf8'),
  });
  const r = datos(await archivarCorreo.handler({ uid: malicioso, que: 'adjunto', confirmar: true, aunque_este_repetido: true }));
  check('un adjunto con «../» en el nombre no se sale de la carpeta del expediente',
    !fs.existsSync(path.join(NUNEZ, 'colado.pdf')) && !fs.existsSync(path.join(base, 'colado.pdf')),
    JSON.stringify((r.ficheros || []).map((f) => f.ruta)));
  check('se queda dentro, con el nombre saneado',
    (r.ficheros || []).every((f) => fs.existsSync(path.join(COMUNICACIONES, f.fichero))), JSON.stringify(r.ficheros));

  // Y la subcarpeta que llega por parámetro, igual: no saca el fichero del expediente.
  const fuera = datos(await archivarCorreo.handler({ uid: malicioso, subcarpeta: '../../..', confirmar: true, aunque_este_repetido: true }));
  check('tampoco una subcarpeta «../../..» saca nada del expediente',
    !(fuera.ficheros || []).some((f) => /\.\./.test(f.ruta || '')) && !fs.existsSync(path.join(base, 'colado.pdf')),
    fuera.carpeta_destino || fuera.error);
}

// ─────────── 8. leer_correo ofrece el destino en la misma respuesta ───────────
{
  const r = datos(await leerCorreoTool.handler({ uid: conPdf }));
  check('leer_correo dice cuál es el expediente activo', r.expediente_activo === 'Expedientes/Pérez - Divorcio', r.expediente_activo);
  check('y ofrece archivarlo, con remitente y expediente en la misma frase',
    /Suministros Vidal/.test(r.sugerencia_archivo?.pregunta || '') && /Pérez - Divorcio/.test(r.sugerencia_archivo?.pregunta || ''),
    r.sugerencia_archivo?.pregunta);
  check('y la nota de los adjuntos ya no dice que no se puedan leer',
    /leer_adjunto/.test(r.nota_adjuntos || '') && !/NO se han descargado/.test(r.nota_adjuntos || ''), r.nota_adjuntos);

  expedientes.setActivo(null);
  const sin = datos(await leerCorreoTool.handler({ uid: conPdf }));
  check('sin expediente activo, avisa de que hay que elegirlo y no propone ninguno',
    sin.sugerencia_archivo?.pregunta === null && /no hay expediente activo/i.test(sin.sugerencia_archivo?.que_haria || ''),
    sin.sugerencia_archivo?.que_haria);
  expedientes.setActivo('Expedientes/Pérez - Divorcio');
}

// ─────────── 9. Ya es parte del caso: se busca con todo lo demás ───────────
{
  const r = datos(await buscarDocumentos.handler({ query: '¿cuánto se reclama en el requerimiento?', n_resultados: 5 }));
  const delCorreo = (r.fragmentos || []).filter((x) => /\.eml$/i.test(x.fichero || ''));
  check('el correo archivado está en el índice del expediente y sale al buscar',
    delCorreo.length > 0, JSON.stringify((r.fragmentos || []).map((x) => x.fichero)));
  check('y se encuentra por el texto del PDF que llevaba DENTRO',
    delCorreo.some((x) => /12\.480/.test(x.texto || '')),
    (delCorreo[0]?.texto || '').replace(/\s+/g, ' ').slice(0, 100));

  const otro = datos(await buscarDocumentos.handler({ query: 'requerimiento de pago', expediente: 'Núñez - Reclamación', n_resultados: 5 }));
  check('y NO se ve desde el expediente del otro cliente',
    !(otro.fragmentos || []).some((x) => /\.eml$/i.test(x.fichero || '') || /Pérez/.test(x.ruta_relativa || '')),
    JSON.stringify((otro.fragmentos || []).map((x) => x.ruta_relativa)));
}

// ─────────── 10. Nombres de fichero que Windows no perdona ───────────
{
  check('un asunto con «/» o «:» no parte la ruta', !/[\\/:]/.test(archivo.nombreSeguro('Sentencia 12/2026: notificación')));
  check('un nombre que acaba en punto o espacio se limpia (Windows lo come en silencio)',
    archivo.nombreSeguro('escrito. ') === 'escrito');
  check('un nombre reservado de Windows no se usa tal cual', archivo.nombreSeguro('CON') === '_CON');
  check('un asunto vacío no deja el fichero sin nombre', archivo.nombreParaCorreo({ fecha: new Date('2026-09-20T10:00:00Z'), de: '', asunto: '' }).endsWith('sin asunto.eml'));
}

await conexion.cerrar();
servidor.servidor.close();
await llavero.borrar(CUENTA);
fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} comprobaciones OK`);
process.exit(ok === results.length ? 0 : 1);
