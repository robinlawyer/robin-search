// Medición del anonimizador con EXPEDIENTES REALES, en local.
//
// Lo que pidió Juan el 26-sep: «Hazlo en local, en tu propio ordenador, sobre expedientes ya
// cerrados, sin que ningún documento salga de esa máquina. Es el mismo principio que ya aplica el
// filtro (nada sale sin pasar por el alias), así que aplícaselo también a la propia medición.»
//
//   1. Medir     npm run medir:reales -- --carpeta "/ruta/a/expedientes cerrados"
//   2. Revisar   abrir revision.html (en la carpeta de salida) en el navegador y marcar
//   3. Resultado npm run medir:reales -- --resultado "/ruta/a/la/salida"
//
// CÓMO SE GARANTIZA QUE NADA SALE
//
//   · En macOS la medición se relanza a sí misma dentro de `sandbox-exec` con la red DENEGADA por
//     el sistema operativo: ni el proceso, ni el hilo del OCR, ni ninguna librería pueden abrir un
//     socket. Antes de leer un solo documento se comprueba que es así (se intenta conectar y tiene
//     que fallar); si la red respondiera, se aborta sin leer nada.
//   · Además, dentro del proceso se anulan fetch, http, https, net, tls, dns y dgram. En Windows y
//     Linux, donde no hay caja del sistema, es la única barrera, y se dice.
//   · Por pantalla solo salen CIFRAS: ni un nombre, ni un fragmento, ni el nombre de un fichero. Lo
//     que lleva texto (la página de revisión y el detalle) se escribe en la carpeta de salida, que
//     no puede estar dentro de la de expedientes, y se borra con --borrar al terminar.
//   · marcas.json, lo que exporta la página de revisión, no lleva texto: posiciones y categorías.
//     Es lo único que se puede enseñar fuera de esta máquina.
//
// QUÉ MIDE, sin oro anotado
//
//   Automático (sin que nadie lea nada):
//     · FUGAS DE TABLA: un valor que el filtro tapó en un sitio y aparece en claro en otro. Tiene
//       que ser 0.
//     · IDA Y VUELTA: anonimizar y revertir devuelve el texto (o el nombre canonizado). Rotos: 0.
//     · Latencia real por respuesta de 60 fragmentos.
//   Con revisión humana (la página):
//     · SOSPECHAS: secuencias con pinta de nombre, números con pinta de DNI/teléfono/IBAN, que no
//       están tapadas ni protegidas. Se marcan «escape real» o «no es dato».
//     · MUESTRA A CIEGAS: fragmentos sin sospechas, al azar, para leerlos enteros. Es lo que da el
//       número honesto: lo que las sospechas no ven es justo lo que hay que contar.
//     · SOBRA: lo tapado que no debía taparse (un clic sobre lo tapado).
//   Y cada escape confirmado lleva CATEGORÍA (nombre sin presentar, perífrasis, apellido que es una
//   institución, OCR roto…), que es lo que Juan quiere ver para decidir si hace falta una v1.1:
//   «si aparece un patrón de fuga distinto al que has visto en tu corpus inventado».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { esPalabraInstitucional } from './anonimizador/texto.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');

// ───────────────────────────── Argumentos ─────────────────────────────

function args() {
  const a = process.argv.slice(2);
  const val = (k) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : null;
  };
  return {
    carpeta: val('--carpeta'),
    salida: val('--salida'),
    resultado: val('--resultado'),
    borrar: val('--borrar'),
    muestra: Number(val('--muestra') ?? 80),
    maxRevision: Number(val('--max-revision') ?? 400),
    semilla: val('--semilla') ?? 'robin',
    segundaOpinion: a.includes('--segunda-opinion'),
    sinCaja: a.includes('--sin-caja'),
  };
}

const A = args();
const decir = (s = '') => process.stdout.write(`${s}\n`);

// ───────────────────────────── La caja ─────────────────────────────
//
// macOS: relanzarse dentro de sandbox-exec con la red denegada. `allow default` + `deny network*`:
// se puede leer y escribir en disco (hace falta), no se puede abrir ninguna conexión.
const PERFIL = '(version 1)(allow default)(deny network*)';

if (!A.resultado && !A.borrar && process.platform === 'darwin' && !process.env.ROBIN_MEDICION_EN_CAJA && !A.sinCaja) {
  if (!fs.existsSync('/usr/bin/sandbox-exec')) {
    decir('✗ No encuentro /usr/bin/sandbox-exec: no puedo cortar la red a nivel del sistema. No mido.');
    process.exit(2);
  }
  const r = spawnSync('/usr/bin/sandbox-exec', ['-p', PERFIL, process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ROBIN_MEDICION_EN_CAJA: '1' },
  });
  process.exit(r.status ?? 1);
}

// Dentro del proceso, siempre: se anula todo lo que abre una conexión. Si algo lo intenta, se
// anota y se aborta al final (no debería pasar nunca: nada de lo que se usa aquí va a la red).
const intentosDeRed = [];
async function cortarRedEnProceso() {
  const bloquea = (que) =>
    function () {
      intentosDeRed.push(que);
      throw new Error(`RED BLOQUEADA en la medición (${que})`);
    };
  const net = await import('node:net');
  const tls = await import('node:tls');
  const http = await import('node:http');
  const https = await import('node:https');
  const dns = await import('node:dns');
  const dgram = await import('node:dgram');
  net.default.Socket.prototype.connect = bloquea('net.Socket.connect');
  net.default.connect = net.default.createConnection = bloquea('net.connect');
  tls.default.connect = bloquea('tls.connect');
  http.default.request = http.default.get = bloquea('http');
  https.default.request = https.default.get = bloquea('https');
  dns.default.lookup = bloquea('dns.lookup');
  dns.default.resolve = bloquea('dns.resolve');
  if (dns.default.promises) {
    dns.default.promises.lookup = bloquea('dns.promises.lookup');
    dns.default.promises.resolve = bloquea('dns.promises.resolve');
  }
  dgram.default.createSocket = bloquea('dgram');
  globalThis.fetch = async () => {
    intentosDeRed.push('fetch');
    throw new Error('RED BLOQUEADA en la medición (fetch)');
  };
}

// Prueba de que la red está cortada POR EL SISTEMA, antes de tocar un documento. Se hace con el
// socket original, antes de anularlo dentro del proceso: si el sistema lo deja salir, se aborta.
async function comprobarCaja() {
  if (!process.env.ROBIN_MEDICION_EN_CAJA) return { sistema: false };
  const net = await import('node:net');
  const ok = await new Promise((resolve) => {
    const s = net.default.connect(443, '1.1.1.1');
    const t = setTimeout(() => { s.destroy(); resolve('timeout'); }, 3000);
    s.on('connect', () => { clearTimeout(t); s.destroy(); resolve('CONECTA'); });
    s.on('error', (e) => { clearTimeout(t); resolve(e.code ?? 'error'); });
  });
  if (ok === 'CONECTA') {
    decir('✗ La red NO está cortada dentro de la caja. No leo ningún documento.');
    process.exit(3);
  }
  return { sistema: true, prueba: ok };
}

// ───────────────────────────── Utilidades ─────────────────────────────

const plegar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function aleatorio(semilla) {
  let h = crypto.createHash('sha256').update(String(semilla)).digest().readUInt32LE(0) || 1;
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 2 ** 32;
  };
}

function dentro(hijo, padre) {
  const rel = path.relative(path.resolve(padre), path.resolve(hijo));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function recorrer(dir) {
  const fuera = [];
  const pila = [dir];
  while (pila.length) {
    const d = pila.pop();
    let entradas = [];
    try { entradas = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entradas) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) pila.push(p);
      else if (e.isFile()) fuera.push(p);
    }
  }
  return fuera.sort();
}

// ───────────────────────────── Sospechas ─────────────────────────────
//
// Lo que tiene pinta de dato y no está ni tapado ni protegido. No decide nada: lo pone delante de
// quien revisa. Las sospechas se miden a propósito con un criterio DISTINTO del filtro (si fuera
// el mismo, nunca sospecharían de nada).

const PALABRAS_CORRIENTES_MAYUS = new Set(
  ('AL,EL,LA,LOS,LAS,DE,DEL,Y,E,EN,A,POR,PARA,CON,SIN,QUE,SU,SUS,UN,UNA,SE,LO,NO,SI,COMO,ANTE,CONTRA,' +
    'SEGUN,SOBRE,ENTRE,HASTA,DESDE,OTROSI,DIGO,DICE,SUPLICO,SOLICITO,HECHOS,FUNDAMENTOS,DERECHO,FALLO,' +
    'PRIMERO,SEGUNDO,TERCERO,CUARTO,QUINTO,SEXTO,SEPTIMO,OCTAVO,NOVENO,DECIMO,DEMANDA,DEMANDANTE,' +
    'DEMANDADO,DEMANDADA,JUICIO,ORDINARIO,VERBAL,PROCEDIMIENTO,RECURSO,SENTENCIA,AUTO,DECRETO,DILIGENCIA,' +
    'JUZGADO,TRIBUNAL,AUDIENCIA,PRIMERA,INSTANCIA,INSTRUCCION,SOCIAL,PENAL,CIVIL,MERCANTIL,CONTENCIOSO,' +
    'ADMINISTRATIVO,SALA,SECCION,NUMERO,ARTICULO,LEY,REAL,CODIGO,MINISTERIO,FISCAL,ABOGADO,LETRADO,' +
    'PROCURADOR,TRIBUNALES,NOMBRE,REPRESENTACION,MAYOR,EDAD,DOMICILIO,CALLE,COMPARECE,EXPONE,CONTRATO,' +
    'CLAUSULA,ANEXO,DOCUMENTO,ACTA,ESCRITURA,NOTARIO,PODER,TOTAL,IMPORTE,EUROS,FECHA,FIRMA,FIRMADO,' +
    'CONFORME,EXCMO,ILMO,SR,SRA,DON,DONA,DOÑA,EMPRESA,TRABAJADOR,CIF,NIF,DNI,NIE,IBAN,CUENTA,PAGINA,PAG,' +
    'ESTIMACION,DESESTIMACION,COSTAS,INTERESES,CANTIDAD,RECLAMACION,DESPIDO,NULIDAD,IMPROCEDENCIA').split(','),
);

function sospechas(texto, cubierto) {
  const fuera = [];
  const libre = (i, f) => { for (let k = i; k < f; k++) if (cubierto[k]) return false; return true; };
  const mayus = (texto.match(/[A-ZÁÉÍÓÚÑ]/g) ?? []).length / Math.max(1, (texto.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) ?? []).length);
  const escaneo = mayus > 0.8;
  const PIEZA = escaneo ? '[A-ZÁÉÍÓÚÑÜÇ]{2,}(?:-[A-ZÁÉÍÓÚÑ]{2,})?' : "[A-ZÁÉÍÓÚÑÜÇ][a-záéíóúñüçàèòïl·'’]+(?:-[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?";
  const re = new RegExp(`(?<![\\p{L}])${PIEZA}(?:\\s+(?:(?:de|del|de la|i|DE|DEL|DE LA|I)\\s+)?${PIEZA}){1,4}(?![\\p{L}])`, 'gu');
  let m;
  while ((m = re.exec(texto)) !== null) {
    const piezas = m[0].split(/\s+/).filter((p) => !/^(?:de|del|la|i|DE|DEL|LA|I)$/.test(p));
    const utiles = piezas.filter((p) => !PALABRAS_CORRIENTES_MAYUS.has(plegar(p).toUpperCase()));
    if (piezas.some((p) => esPalabraInstitucional(p))) continue;
    if (utiles.length < 2) continue;
    if (!libre(m.index, m.index + m[0].length)) continue;
    fuera.push({ tipo: 'nombre', inicio: m.index, fin: m.index + m[0].length });
  }
  const NUMEROS = [
    ['dni', /\b\d{8}\s?-?[A-Z]\b/g],
    ['nie', /\b[XYZ]\s?-?\d{7}\s?-?[A-Z]\b/g],
    ['telefono', /(?<![\d])(?:\+34\s?)?[6789]\d{2}(?:[\s.]?\d{2,3}){3}(?![\d])/g],
    ['iban', /\bES\d{2}(?:\s?\d{4}){5}\b/g],
    ['matricula', /\b\d{4}\s?-?[BCDFGHJKLMNPRSTVWXYZ]{3}\b/g],
    ['correo', /[\w.+-]+@[\w-]+\.[\w.-]+/g],
  ];
  for (const [tipo, r] of NUMEROS) {
    r.lastIndex = 0;
    while ((m = r.exec(texto)) !== null) {
      if (libre(m.index, m.index + m[0].length)) fuera.push({ tipo, inicio: m.index, fin: m.index + m[0].length });
    }
  }
  return { sospechas: fuera, escaneo };
}

// ───────────────────────────── Medir ─────────────────────────────

async function medir() {
  if (!A.carpeta) {
    decir('Uso: npm run medir:reales -- --carpeta "/ruta/a/expedientes cerrados" [--salida DIR] [--muestra 80]');
    process.exit(1);
  }
  const carpeta = path.resolve(A.carpeta);
  if (!fs.existsSync(carpeta) || !fs.statSync(carpeta).isDirectory()) {
    decir('✗ La carpeta de expedientes no existe.');
    process.exit(1);
  }
  const fecha = new Date().toISOString().slice(0, 10);
  const salida = path.resolve(A.salida ?? path.join(os.homedir(), `RobinSearch-medicion-${fecha}`));
  if (dentro(salida, carpeta)) {
    decir('✗ La carpeta de salida no puede estar dentro de la de expedientes: la medición no escribe nada ahí.');
    process.exit(1);
  }

  const caja = await comprobarCaja();
  await cortarRedEnProceso();

  fs.mkdirSync(salida, { recursive: true });
  // El servidor de RobinSearch escribe logs en su directorio de datos: aquí, a la salida, para no
  // mezclar nada con la instalación del abogado ni dejar rastro fuera de esta carpeta.
  process.env.ROBIN_DATA_DIR = path.join(salida, '.datos-robin');
  process.env.ROBIN_FOLDERS = '';
  const { extractFile } = await import(path.join(RAIZ, 'server', 'indexer', 'extract.js'));
  const { chunkPages } = await import(path.join(RAIZ, 'server', 'indexer', 'chunk.js'));
  const { config } = await import(path.join(RAIZ, 'server', 'config.js'));
  const { Anonimizador, TablaAlias } = await import('./anonimizador/index.mjs');
  const { variantesDe } = await import('./anonimizador/alias.mjs');
  const { terminosDeFondo } = await import('./anonimizador/objeto.mjs');

  // Segunda opinión (opcional): el modelo pequeño del banco, SOLO desde la copia local y con la
  // descarga desactivada. No tapa nada —la v1 va sin modelo—: señala nombres que las reglas no
  // cubren, para buscar en los expedientes reales un patrón de fuga que el corpus inventado no
  // tenía. Es la pregunta de Juan para decidir si hace falta una v1.1.
  let reconocedor = null;
  let traducir = null;
  let reconocerLote = null;
  if (A.segundaOpinion) {
    const ner = await import('./anonimizador/ner.mjs');
    const { default: CANDIDATOS } = await import('./candidatos.mjs');
    const cand = CANDIDATOS.find((c) => c.id === 'bert-small-pii');
    const local = path.join(AQUI, '.modelos');
    if (!fs.existsSync(path.join(local, cand.modelo))) {
      decir('✗ --segunda-opinion necesita el modelo ya descargado (npm run banco:nombres lo baja). Sin red no lo bajo.');
      process.exit(1);
    }
    reconocedor = await ner.cargarReconocedor({ modelo: cand.modelo, modelsDir: local, empaquetado: true });
    traducir = cand.etiqueta;
    reconocerLote = ner.reconocerLote;
  }

  decir('═'.repeat(78));
  decir('MEDICIÓN CON EXPEDIENTES REALES — RobinSearch, anonimizador v1 (sin modelo)');
  decir(caja.sistema
    ? `Red: CORTADA por el sistema (sandbox-exec; prueba de conexión → ${caja.prueba}) y dentro del proceso.`
    : 'Red: cortada dentro del proceso (este sistema no tiene caja; en macOS se usa sandbox-exec).');
  decir('Por pantalla solo salen cifras. El texto se queda en la carpeta de salida, en este ordenador.');
  decir('═'.repeat(78));

  // Expedientes: cada subcarpeta de primer nivel es un expediente (su tabla de alias, aislada).
  // Lo que cuelgue directamente de la raíz va a un expediente propio.
  const ficheros = recorrer(carpeta);
  const porExp = new Map();
  for (const f of ficheros) {
    const rel = path.relative(carpeta, f);
    const exp = rel.includes(path.sep) ? rel.split(path.sep)[0] : '(raíz)';
    if (!porExp.has(exp)) porExp.set(exp, []);
    porExp.get(exp).push(f);
  }

  const anon = new Anonimizador({ tabla: new TablaAlias() });
  const detalle = { version: 1, generado: new Date().toISOString(), fragmentos: [] };
  const cifras = {
    expedientes: porExp.size, documentos: 0, ilegibles: {}, sinTexto: 0, fragmentos: 0, escaneos: 0,
    porTipo: {}, porVia: {}, objetosEnClaro: 0, fugasTabla: 0, idaVuelta: { identicos: 0, canonizados: 0, rotos: 0 },
    aliasInventados: 0, sospechas: {}, latencias: [], intentosDeRed: 0,
  };
  let nExp = 0;
  for (const [exp, docs] of porExp) {
    nExp++;
    const idExp = `E${String(nExp).padStart(3, '0')}`;
    for (const abs of docs) {
      let leido;
      try {
        leido = await extractFile(abs, { maxPages: config.maxPagesPerFile });
      } catch (e) {
        const code = e?.code ?? 'OTRO';
        cifras.ilegibles[code] = (cifras.ilegibles[code] ?? 0) + 1;
        continue;
      }
      const pages = leido?.pages ?? [];
      if (!pages.length || leido.sinOcr) { cifras.sinTexto++; continue; }
      cifras.documentos++;
      const trozos = chunkPages(pages, { chunkSizeTokens: config.chunkSizeTokens, chunkOverlapTokens: config.chunkOverlapTokens });
      // Por respuestas de 60, que es el techo real de obtener_documento.
      for (let i = 0; i < trozos.length; i += 60) {
        const lote = trozos.slice(i, i + 60).map((t) => t.text);
        const t0 = performance.now();
        const res = await anon.anonimizarRespuesta(lote, { expediente: exp });
        cifras.latencias.push({ ms: performance.now() - t0, n: lote.length });
        const opinion = reconocedor ? await reconocerLote(reconocedor, lote, traducir) : lote.map(() => []);
        for (let k = 0; k < lote.length; k++) {
          const texto = lote[k];
          const { detecciones } = res[k];
          const { regiones } = anon.detectar(texto, { expediente: exp });
          const cubierto = new Array(texto.length).fill(false);
          for (const d of [...detecciones, ...regiones]) for (let x = d.inicio; x < d.fin; x++) cubierto[x] = true;
          // Lo que pasa en claro por ser el objeto del escrito también se da por «visto».
          for (const t of terminosDeFondo(texto)) {
            if (!detecciones.some((d) => d.inicio < t.fin && t.inicio < d.fin)) {
              cifras.objetosEnClaro++;
              for (let x = t.inicio; x < t.fin; x++) cubierto[x] = true;
            }
          }
          const { sospechas: sos, escaneo } = sospechas(texto, cubierto);
          // El modelo marca tramos imprecisos («Me llamó ayer Sonia Belmonte Tirado» entero, o
          // «icilio» de «domicilio»). Se queda solo lo que dentro del tramo son piezas de nombre
          // capitalizadas; si no queda ninguna, no es una sospecha.
          for (const o of opinion[k] ?? []) {
            if (o.tipo !== 'PERSONA') continue;
            const tramo = texto.slice(o.inicio, o.fin);
            for (const p of tramo.matchAll(/(?<![\p{L}])[\p{Lu}][\p{L}'’-]+(?:\s+(?:(?:de|del|de la|i)\s+)?[\p{Lu}][\p{L}'’-]+)*/gu)) {
              const i0 = o.inicio + p.index;
              const f0 = i0 + p[0].length;
              if (i0 > 0 && /[\p{L}]/u.test(texto[i0 - 1])) continue;
              if (f0 < texto.length && /[\p{L}]/u.test(texto[f0])) continue;
              if (p[0].split(/\s+/).every((w) => PALABRAS_CORRIENTES_MAYUS.has(plegar(w).toUpperCase()) || esPalabraInstitucional(w))) continue;
              let libre = true;
              for (let x = i0; x < f0; x++) if (cubierto[x]) { libre = false; break; }
              if (libre && !sos.some((q) => q.inicio < f0 && i0 < q.fin)) sos.push({ tipo: 'modelo', inicio: i0, fin: f0 });
            }
          }
          if (escaneo) cifras.escaneos++;
          for (const s of sos) cifras.sospechas[s.tipo] = (cifras.sospechas[s.tipo] ?? 0) + 1;
          for (const d of detecciones) {
            cifras.porTipo[d.tipo] = (cifras.porTipo[d.tipo] ?? 0) + 1;
            const via = String(d.via ?? '').split(':').slice(0, 2).join(':');
            cifras.porVia[via] = (cifras.porVia[via] ?? 0) + 1;
          }

          // Fugas de tabla: un valor tapado que sigue en claro en el texto que sale.
          const salidaPlegada = plegar(res[k].texto);
          for (const { valor, tipo } of anon.tabla.volcar(exp)) {
            if (valor.length < 5 || tipo === 'CAT_ESPECIAL' || tipo === 'DATO_PENAL') continue;
            const aguja = plegar(valor);
            let desde = 0;
            for (;;) {
              const j = salidaPlegada.indexOf(aguja, desde);
              if (j < 0) break;
              desde = j + 1;
              const a = salidaPlegada[j - 1];
              const b = salidaPlegada[j + aguja.length];
              if ((a && /[\p{L}\p{N}]/u.test(a)) || (b && /[\p{L}\p{N}]/u.test(b))) continue;
              cifras.fugasTabla++;
            }
          }

          // Ida y vuelta.
          let roto = false;
          const vuelta = anon.rehidratar(res[k].texto, { expediente: exp });
          cifras.aliasInventados += vuelta.desconocidos.length;
          if (vuelta.texto === texto) cifras.idaVuelta.identicos++;
          else {
            let canon = texto;
            const pares = [];
            for (const { valor, tipo } of anon.tabla.volcar(exp)) {
              if (tipo !== 'PERSONA') continue;
              for (const v of variantesDe(valor)) if (v.length >= 4) pares.push([v, valor]);
            }
            pares.sort((x, y) => y[0].length - x[0].length);
            if (pares.length) {
              const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${pares.map((p) => esc(p[0])).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
              const mapa = new Map(pares);
              canon = texto.replace(re, (x) => mapa.get(x) ?? x);
            }
            if (plegar(canon) === plegar(vuelta.texto)) cifras.idaVuelta.canonizados++;
            else { cifras.idaVuelta.rotos++; roto = true; }
          }

          cifras.fragmentos++;
          detalle.fragmentos.push({
            id: `${idExp}-${cifras.documentos}-${i + k}`,
            expediente: idExp,
            documento: path.relative(carpeta, abs),
            escaneo,
            texto,
            tapado: detecciones.map((d) => ({ inicio: d.inicio, fin: d.fin, tipo: d.tipo, via: d.via, alias: anon.tabla.alias(exp, d.tipo, d.valor) })),
            protegido: regiones.map((r) => ({ inicio: r.inicio, fin: r.fin, clase: r.clase })),
            sospechas: sos,
            ...(roto ? { rotoIdaVuelta: true, vuelta: vuelta.texto } : {}),
          });
        }
      }
    }
  }
  cifras.intentosDeRed = intentosDeRed.length;

  // Qué se revisa: todo lo que tiene sospechas (hasta el tope) y una muestra A CIEGAS del resto.
  const conSospecha = detalle.fragmentos.filter((f) => f.sospechas.length || f.rotoIdaVuelta);
  const sinSospecha = detalle.fragmentos.filter((f) => !f.sospechas.length && !f.rotoIdaVuelta);
  const azar = aleatorio(A.semilla);
  const muestra = [...sinSospecha].sort(() => azar() - 0.5).slice(0, A.muestra);
  const aRevisar = [...conSospecha.slice(0, Math.max(0, A.maxRevision - muestra.length)), ...muestra];
  for (const f of muestra) f.muestraCiega = true;
  detalle.revision = aRevisar.map((f) => f.id);

  fs.writeFileSync(path.join(salida, 'detalle.json'), JSON.stringify(detalle));
  fs.writeFileSync(path.join(salida, 'revision.html'), paginaRevision(aRevisar));
  fs.writeFileSync(path.join(salida, 'cifras.json'), JSON.stringify(cifras, null, 2));

  // Por pantalla: solo cifras.
  const ms = cifras.latencias.reduce((a, l) => a + l.ms, 0);
  const n = cifras.latencias.reduce((a, l) => a + l.n, 0);
  decir('');
  decir(`Expedientes ${cifras.expedientes} · documentos leídos ${cifras.documentos} · sin texto ${cifras.sinTexto} · ilegibles ${Object.values(cifras.ilegibles).reduce((a, b) => a + b, 0)}`);
  decir(`Fragmentos ${cifras.fragmentos} (escaneos en mayúsculas: ${cifras.escaneos})`);
  decir(`Latencia real: ${n ? (ms / n).toFixed(1) : '—'} ms/fragmento · ${n ? ((ms / n) * 60 / 1000).toFixed(2) : '—'} s por respuesta de 60`);
  decir('');
  decir('Tapado, por tipo:');
  for (const [t, v] of Object.entries(cifras.porTipo).sort((a, b) => b[1] - a[1])) decir(`   ${t.padEnd(14)} ${String(v).padStart(7)}`);
  decir(`Datos sensibles en claro por ser el OBJETO del escrito: ${cifras.objetosEnClaro}`);
  decir('');
  decir('Comprobaciones automáticas (tienen que ser 0):');
  decir(`   fugas de tabla (tapado en un sitio, en claro en otro)   ${cifras.fugasTabla}`);
  decir(`   ida y vuelta ROTOS                                     ${cifras.idaVuelta.rotos}   (idénticos ${cifras.idaVuelta.identicos}, canonizados ${cifras.idaVuelta.canonizados})`);
  decir(`   intentos de conexión a la red                          ${cifras.intentosDeRed}`);
  decir('');
  decir('Sospechas para revisar (no tapadas ni protegidas):');
  for (const [t, v] of Object.entries(cifras.sospechas).sort((a, b) => b[1] - a[1])) decir(`   ${t.padEnd(14)} ${String(v).padStart(7)}`);
  decir('');
  decir(`A revisar: ${aRevisar.length} fragmentos (${aRevisar.length - muestra.length} con sospechas + ${muestra.length} de muestra a ciegas).`);
  decir(`Abre en el navegador:  ${path.join(salida, 'revision.html')}`);
  decir(`Cuando acabes, guarda marcas.json en esa misma carpeta y corre:`);
  decir(`   npm run medir:reales -- --resultado "${salida}"`);
  decir(`Y al terminar del todo:  npm run medir:reales -- --borrar "${salida}"`);
  if (cifras.intentosDeRed) process.exit(4);
}

// ───────────────────────────── La página de revisión ─────────────────────────────
//
// Un solo fichero, sin nada de fuera: ni fuentes, ni scripts, ni imágenes. La política de
// contenido (`default-src 'none'`) impide además que la página haga ninguna petición, así que
// abrirla en el navegador no saca nada de la máquina.

function paginaRevision(frags) {
  const datos = JSON.stringify(frags).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revisión del anonimizador</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--mut:#6b6a66;--card:#fff;--line:#e4e1da;--tap:#1d4ed8;--tapbg:#dbe6ff;--prot:#8a8a8a;--obj:#0f766e;--sos:#b91c1c;--sosbg:#fde2e2;--ok:#15803d;--sobra:#a16207;--sobrabg:#fdf0c7}
@media (prefers-color-scheme: dark){:root{--bg:#161615;--fg:#ecebe7;--mut:#a3a19b;--card:#1f1f1d;--line:#34332f;--tap:#93b4ff;--tapbg:#1e2b4d;--prot:#8d8c88;--obj:#5eead4;--sos:#fca5a5;--sosbg:#4a1d1d;--ok:#86efac;--sobra:#fcd34d;--sobrabg:#4a3a10}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px;z-index:2}
header h1{font-size:17px;margin:0 0 4px}header p{margin:0;color:var(--mut);font-size:13px}
.barra{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center}
button,select{font:inherit;font-size:13px;padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.pri{background:var(--fg);color:var(--bg);border-color:var(--fg)}
main{max-width:980px;margin:0 auto;padding:16px}
.leyenda{font-size:13px;color:var(--mut);margin-bottom:12px;line-height:1.9}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px}
.card.hecha{opacity:.55}
.meta{font-size:12px;color:var(--mut);display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;word-break:break-all}
.txt{white-space:pre-wrap;word-wrap:break-word}
.t{background:var(--tapbg);color:var(--tap);border-radius:3px;cursor:pointer;padding:0 1px}
.t.sobra{background:var(--sobrabg);color:var(--sobra);text-decoration:line-through}
.p{border-bottom:1px dotted var(--prot)}
.s{outline:2px dashed var(--sos);background:var(--sosbg);border-radius:3px;cursor:pointer}
.s.real{outline-style:solid}.s.nodato{outline-color:var(--ok);background:none}
.e{outline:2px solid var(--sos);border-radius:3px}
.acc{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center}
.chip{font-size:11px;padding:1px 6px;border-radius:10px;border:1px solid var(--line)}
@media (max-width:600px){main{padding:12px}header{padding:10px 12px}}
</style></head><body>
<header><h1>Revisión del anonimizador — expedientes reales</h1>
<p>Esta página no se conecta a nada. Lo que marques se guarda en este navegador y en el fichero que descargues.</p>
<div class="barra"><span id="prog"></span>
<select id="cat" title="Categoría del escape que marques con el ratón">
<option value="nombre-sin-presentar">Nombre sin presentar</option><option value="perifrasis">Perífrasis que identifica</option>
<option value="apellido-institucion">Apellido que es una institución</option><option value="ocr-roto">OCR roto</option>
<option value="salud-o-penal">Dato de salud o penal</option><option value="direccion">Dirección</option>
<option value="identificador">DNI, teléfono, cuenta…</option><option value="otro">Otro</option></select>
<button id="marcar">Marcar selección como escape</button>
<button class="pri" id="bajar">Descargar marcas.json</button>
<label><button id="cargarB">Cargar marcas</button><input type="file" id="cargar" accept=".json" hidden></label></div></header>
<main><div class="leyenda">
<span class="t">azul</span> tapado (clic: <b>sobra</b>, no debía taparse) ·
<span class="p">punteado</span> protegido (intocable) ·
<span class="s">rojo discontinuo</span> sospecha (clic: <b>escape real</b> → <b>no es dato</b> → sin revisar) ·
para un escape que nadie ha señalado, <b>selecciónalo con el ratón</b>, elige categoría y pulsa «Marcar selección».
Los fragmentos de <span class="chip">muestra a ciegas</span> no tienen sospechas: léelos enteros, son los que dan el número honesto.
Cuando acabes un fragmento, pulsa «Revisado».</div><div id="lista"></div></main>
<script>
const F=${datos};
const K='robin-revision-marcas';
let M;try{M=JSON.parse(localStorage.getItem(K)||'null')}catch(e){M=null}
M=M||{version:1,revisados:{},sobra:{},sospechas:{},escapes:[]};
const guardar=()=>{try{localStorage.setItem(K,JSON.stringify(M))}catch(e){}prog()};
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function pintar(f){
  const marcas=[];
  f.tapado.forEach((d,i)=>marcas.push({i:d.inicio,f:d.fin,k:'t',n:i,title:d.alias+' · '+d.via}));
  f.sospechas.forEach((d,i)=>marcas.push({i:d.inicio,f:d.fin,k:'s',n:i,title:'sospecha: '+d.tipo}));
  M.escapes.filter(e=>e.frag===f.id).forEach((e,i)=>marcas.push({i:e.inicio,f:e.fin,k:'e',n:i,title:'escape: '+e.categoria}));
  marcas.sort((a,b)=>a.i-b.i||b.f-a.f);
  const prot=new Array(f.texto.length).fill(false);f.protegido.forEach(r=>{for(let k=r.inicio;k<r.fin;k++)prot[k]=true});
  let h='',c=0;
  const plano=(a,b)=>{let o='';let ab=false;for(let k=a;k<b;k++){if(prot[k]&&!ab){o+='<span class="p">';ab=true}if(!prot[k]&&ab){o+='</span>';ab=false}o+=esc(f.texto[k])}if(ab)o+='</span>';return o};
  for(const m of marcas){if(m.i<c)continue;h+=plano(c,m.i);
    let cls=m.k;if(m.k==='t'&&M.sobra[f.id+':'+m.n])cls+=' sobra';if(m.k==='s'){const v=M.sospechas[f.id+':'+m.n];if(v)cls+=' '+v}
    h+='<span class="'+cls+'" data-k="'+m.k+'" data-n="'+m.n+'" title="'+esc(m.title)+'">'+esc(f.texto.slice(m.i,m.f))+'</span>';c=m.f}
  return h+plano(c,f.texto.length)}
function render(){const L=document.getElementById('lista');L.innerHTML='';
  F.forEach(f=>{const d=document.createElement('div');d.className='card'+(M.revisados[f.id]?' hecha':'');d.dataset.id=f.id;
    d.innerHTML='<div class="meta"><span>'+esc(f.id)+'</span><span>'+esc(f.documento)+'</span>'+(f.escaneo?'<span class="chip">escaneo</span>':'')+(f.muestraCiega?'<span class="chip">muestra a ciegas</span>':'')+(f.rotoIdaVuelta?'<span class="chip">ida y vuelta ROTA</span>':'')+'</div><div class="txt">'+pintar(f)+'</div>'+(f.rotoIdaVuelta?'<div class="meta">Al revertir vuelve así:</div><div class="txt">'+esc(f.vuelta)+'</div>':'')+'<div class="acc"><button data-rev>'+(M.revisados[f.id]?'Revisado ✓ (deshacer)':'Revisado')+'</button></div>';
    L.appendChild(d)});prog()}
function prog(){const r=Object.keys(M.revisados).length;document.getElementById('prog').textContent=r+' / '+F.length+' revisados · '+M.escapes.length+' escapes marcados'}
document.getElementById('lista').addEventListener('click',ev=>{const card=ev.target.closest('.card');if(!card)return;const id=card.dataset.id;
  if(ev.target.matches('[data-rev]')){if(M.revisados[id])delete M.revisados[id];else M.revisados[id]=true;guardar();render();return}
  const s=ev.target.closest('span[data-k]');if(!s)return;const key=id+':'+s.dataset.n;
  if(s.dataset.k==='t'){if(M.sobra[key])delete M.sobra[key];else M.sobra[key]=true}
  else if(s.dataset.k==='s'){const v=M.sospechas[key];M.sospechas[key]=v==='real'?'nodato':v==='nodato'?undefined:'real';if(!M.sospechas[key])delete M.sospechas[key]}
  else if(s.dataset.k==='e'){const n=+s.dataset.n;const mias=M.escapes.filter(e=>e.frag===id);const x=mias[n];M.escapes=M.escapes.filter(e=>e!==x)}
  guardar();render()});
function offset(card,node,off){const txt=card.querySelector('.txt');const w=document.createTreeWalker(txt,NodeFilter.SHOW_TEXT);let t=0,n;while((n=w.nextNode())){if(n===node)return t+off;t+=n.textContent.length}return -1}
document.getElementById('marcar').onclick=()=>{const sel=getSelection();if(!sel.rangeCount||sel.isCollapsed)return alert('Selecciona primero el texto que se ha escapado.');
  const r=sel.getRangeAt(0);const card=r.startContainer.parentElement.closest('.card');if(!card||card!==r.endContainer.parentElement.closest('.card'))return alert('La selección tiene que estar dentro de un solo fragmento.');
  const i=offset(card,r.startContainer,r.startOffset),f=offset(card,r.endContainer,r.endOffset);if(i<0||f<=i)return;
  M.escapes.push({frag:card.dataset.id,inicio:i,fin:f,categoria:document.getElementById('cat').value,origen:'manual'});sel.removeAllRanges();guardar();render()};
document.getElementById('bajar').onclick=()=>{const b=new Blob([JSON.stringify(M,null,1)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='marcas.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
document.getElementById('cargarB').onclick=()=>document.getElementById('cargar').click();
document.getElementById('cargar').onchange=ev=>{const f=ev.target.files[0];if(!f)return;f.text().then(t=>{M=JSON.parse(t);guardar();render()})};
render();
</script></body></html>`;
}

// ───────────────────────────── Resultado ─────────────────────────────
//
// Solo cifras. marcas.json no lleva texto, y aquí tampoco se imprime ninguno.

function resultado() {
  const dir = path.resolve(A.resultado);
  const detalle = JSON.parse(fs.readFileSync(path.join(dir, 'detalle.json'), 'utf8'));
  const cifras = JSON.parse(fs.readFileSync(path.join(dir, 'cifras.json'), 'utf8'));
  const M = JSON.parse(fs.readFileSync(path.join(dir, 'marcas.json'), 'utf8'));
  const porId = new Map(detalle.fragmentos.map((f) => [f.id, f]));
  const revisados = Object.keys(M.revisados ?? {}).filter((id) => porId.has(id));
  if (!revisados.length) {
    decir('No hay ningún fragmento marcado como «Revisado» en marcas.json.');
    process.exit(1);
  }
  const rev = new Set(revisados);
  let tapados = 0;
  let sobra = 0;
  const sobraPorTipo = {};
  const tapadosPorTipo = {};
  for (const id of revisados) {
    const f = porId.get(id);
    f.tapado.forEach((d, i) => {
      tapados++;
      tapadosPorTipo[d.tipo] = (tapadosPorTipo[d.tipo] ?? 0) + 1;
      if (M.sobra?.[`${id}:${i}`]) { sobra++; sobraPorTipo[d.tipo] = (sobraPorTipo[d.tipo] ?? 0) + 1; }
    });
  }
  const escapes = [];
  for (const [clave, v] of Object.entries(M.sospechas ?? {})) {
    const [id, n] = [clave.slice(0, clave.lastIndexOf(':')), Number(clave.slice(clave.lastIndexOf(':') + 1))];
    if (v !== 'real' || !rev.has(id)) continue;
    const s = porId.get(id)?.sospechas[n];
    escapes.push({ id, categoria: s?.tipo === 'nombre' ? 'nombre-sin-presentar' : 'identificador', origen: 'sospecha', ciega: !!porId.get(id)?.muestraCiega });
  }
  for (const e of M.escapes ?? []) if (rev.has(e.frag)) escapes.push({ id: e.frag, categoria: e.categoria, origen: 'manual', ciega: !!porId.get(e.frag)?.muestraCiega });

  const ok = tapados - sobra;
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)} %` : '—');
  decir('═'.repeat(78));
  decir('RESULTADO — expedientes reales (solo cifras)');
  decir('═'.repeat(78));
  decir(`Fragmentos revisados: ${revisados.length} de ${detalle.revision.length} (muestra a ciegas: ${revisados.filter((id) => porId.get(id)?.muestraCiega).length})`);
  decir(`Datos tapados bien: ${ok} · tapados de más (sobra): ${sobra} (${pct(sobra, tapados)})`);
  decir(`Escapes confirmados: ${escapes.length}`);
  decir(`COBERTURA estimada: ${pct(ok, ok + escapes.length)}   (tapados bien / (tapados bien + escapes))`);
  const ciegos = revisados.filter((id) => porId.get(id)?.muestraCiega);
  if (ciegos.length) {
    let okC = 0;
    for (const id of ciegos) porId.get(id).tapado.forEach((d, i) => { if (!M.sobra?.[`${id}:${i}`]) okC++; });
    const escC = escapes.filter((e) => e.ciega).length;
    decir(`   solo en la muestra a ciegas (el número honesto): ${pct(okC, okC + escC)} (${escC} escapes)`);
  }
  decir('');
  decir('Escapes por categoría (el patrón de fuga):');
  const porCat = {};
  for (const e of escapes) porCat[e.categoria] = (porCat[e.categoria] ?? 0) + 1;
  for (const [c, v] of Object.entries(porCat).sort((a, b) => b[1] - a[1])) decir(`   ${c.padEnd(24)} ${v}`);
  decir('');
  decir('Tapado de más, por tipo:');
  for (const [t, v] of Object.entries(sobraPorTipo)) decir(`   ${t.padEnd(14)} ${v} de ${tapadosPorTipo[t]}`);
  decir('');
  decir(`Automático: fugas de tabla ${cifras.fugasTabla} · ida y vuelta rotos ${cifras.idaVuelta.rotos} · intentos de red ${cifras.intentosDeRed}`);
  decir(`Latencia: ${(cifras.latencias.reduce((a, l) => a + l.ms, 0) / Math.max(1, cifras.latencias.reduce((a, l) => a + l.n, 0)) * 60 / 1000).toFixed(2)} s por respuesta de 60 fragmentos`);
  const r = { fecha: new Date().toISOString().slice(0, 10), revisados: revisados.length, tapadosBien: ok, sobra, escapes: escapes.length, porCategoria: porCat, cifras: { ...cifras, latencias: undefined } };
  fs.writeFileSync(path.join(dir, 'resultado.json'), JSON.stringify(r, null, 2));
  decir('');
  decir(`resultado.json (sin texto) en ${dir}`);
}

// ───────────────────────────── Borrar ─────────────────────────────

function borrar() {
  const dir = path.resolve(A.borrar);
  const esperado = ['detalle.json', 'revision.html'];
  if (!esperado.every((f) => fs.existsSync(path.join(dir, f)))) {
    decir('✗ Esa carpeta no parece una salida de la medición (no tiene detalle.json y revision.html). No borro nada.');
    process.exit(1);
  }
  const guardar = path.join(dir, 'resultado.json');
  const resultadoTxt = fs.existsSync(guardar) ? fs.readFileSync(guardar) : null;
  fs.rmSync(dir, { recursive: true, force: true });
  if (resultadoTxt) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(guardar, resultadoTxt);
    decir(`Borrado todo lo que lleva texto. Queda solo resultado.json (sin texto) en ${dir}`);
  } else {
    decir(`Borrado ${dir}`);
  }
  decir('Recuerda vaciar también «robin-revision-marcas» del navegador si lo usaste en un equipo compartido.');
}

if (A.resultado) resultado();
else if (A.borrar) borrar();
else medir().catch((e) => {
  // El mensaje de error puede llevar una ruta o un trozo de texto: por pantalla, solo el tipo.
  decir(`✗ Error ${e?.code ?? e?.name ?? ''} en la medición. Detalle en la carpeta de salida.`);
  try {
    const salida = path.resolve(A.salida ?? path.join(os.homedir(), `RobinSearch-medicion-${new Date().toISOString().slice(0, 10)}`));
    fs.mkdirSync(salida, { recursive: true });
    fs.writeFileSync(path.join(salida, 'error.txt'), String(e?.stack ?? e));
  } catch { /* nada */ }
  process.exit(1);
});
