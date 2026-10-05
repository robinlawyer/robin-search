// Índice de un documento por su ESTRUCTURA: rótulos y numeración (cláusulas, anexos, artículos,
// hechos, fundamentos…), sin modelo y sin red. Es la idea de Juan del 26-sep («buscar por
// estructura, no solo por parecido»): cuando un fragmento dice «según el Anexo II», la respuesta
// está en otra sección que no se parece a la pregunta, y la búsqueda por parecido se la salta.
//
// Todo se calcula al vuelo sobre el texto del documento: ~1-3 ms por documento. No hay caché en
// disco ni se toca el índice vectorial.
//
//   construirArbol(texto, { plano })  → { nodos, raices }
//   remisiones(texto, arbol)           → [{ inicio, fin, texto, destino, aviso? }]
//
// `plano`: el texto viene sin saltos de línea (reconstruido de los fragmentos de un escaneado o de
// un fichero que ya no está en disco). Se buscan solo los rótulos inconfundibles y el índice se da
// por aproximado.

// ─────────────────────────────────────────────────────────────────────────────
// Texto: plegado de mayúsculas y tildes que NO cambia la longitud (las posiciones valen igual
// en el original y en el plegado).
// ─────────────────────────────────────────────────────────────────────────────
const PLIEGUE = {
  á: 'a', à: 'a', ä: 'a', â: 'a', é: 'e', è: 'e', ë: 'e', ê: 'e', í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o', ú: 'u', ù: 'u', ü: 'u', û: 'u', ç: 'c',
};
const RE_PLIEGUE = new RegExp(`[${Object.keys(PLIEGUE).join('')}]`, 'g');
export function plegar(s) {
  // toLowerCase no cambia la longitud en el alfabeto latino (la «İ» turca sí: se deja como está).
  const t = String(s);
  const bajo = t.toLowerCase();
  return (bajo.length === t.length ? bajo : t).replace(RE_PLIEGUE, (c) => PLIEGUE[c]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Números: ordinales en letra, romanos, arábigos
// ─────────────────────────────────────────────────────────────────────────────
const UNIDADES = [
  ['primer', 1], ['segund', 2], ['tercer', 3], ['cuart', 4], ['quint', 5], ['sext', 6],
  ['septim', 7], ['setim', 7], ['octav', 8], ['noven', 9], ['non', 9],
];
const DECENAS = [['decim', 10], ['vigesim', 20], ['trigesim', 30], ['cuadragesim', 40], ['quincuagesim', 50]];

// Fuente de las expresiones regulares (sobre texto PLEGADO).
const RE_UNIDAD = '(?:primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|sext[oa]|septim[oa]|setim[oa]|octav[oa]|noven[oa]|non[oa])';
const RE_DECENA = '(?:decim[oa]|vigesim[oa]|trigesim[oa]|cuadragesim[oa]|quincuagesim[oa])';
export const RE_ORDINAL = `(?:${RE_DECENA}[\\s-]?${RE_UNIDAD}|undecim[oa]|duodecim[oa]|${RE_DECENA}|${RE_UNIDAD}|unic[oa])`;
const RE_ROMANO = '(?:[ivxlc]{1,7})';
const RE_ARABIGO = '(?:\\d{1,3}(?:[\\s.]?(?:bis|ter|quater))?(?:\\.\\d{1,2}){0,3}(?:\\.?\\s?[ºª°](?![a-z]))?)';

export function ordinalANumero(palabra) {
  const p = plegar(palabra).replace(/[\s-]+/g, '');
  if (/^unic[oa]$/.test(p)) return 1;
  if (/^undecim[oa]$/.test(p)) return 11;
  if (/^duodecim[oa]$/.test(p)) return 12;
  let total = 0;
  let resto = p;
  for (const [raiz, v] of DECENAS) {
    if (resto.startsWith(raiz)) {
      total += v;
      resto = resto.slice(raiz.length).replace(/^[oa]/, '');
      break;
    }
  }
  if (!resto) return total || null;
  for (const [raiz, v] of UNIDADES) {
    if (resto.startsWith(raiz)) {
      const cola = resto.slice(raiz.length);
      if (/^[oa]?$/.test(cola)) return total + v;
    }
  }
  return null;
}

export function romanoANumero(s) {
  const r = String(s).toUpperCase();
  if (!/^[IVXLC]+$/.test(r)) return null;
  const val = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let n = 0;
  for (let i = 0; i < r.length; i++) {
    const a = val[r[i]];
    const b = val[r[i + 1]] ?? 0;
    n += a < b ? -a : a;
  }
  // Solo romanos bien formados (evita que «civil» o «vil» pasen por números).
  return aRomano(n) === r ? n : null;
}
function aRomano(n) {
  const t = [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, l] of t) while (n >= v) { s += l; n -= v; }
  return s;
}

// Identificador de una sección («quinta», «II», «5», «5.2», «3 bis», «A», «único») → clave
// comparable: número si lo es, si no la cadena en minúsculas.
export function claveDeId(id, { permitirLetra = false } = {}) {
  const raw = String(id || '').trim();
  if (!raw) return null;
  const p = plegar(raw).replace(/[ºª°.]+$/, '').trim();
  if (/^\d/.test(p)) {
    const m = p.match(/^(\d{1,3})((?:\.\d{1,2}){0,3})[\s.]*(bis|ter|quater)?/);
    if (!m) return null;
    return `${Number(m[1])}${m[2] || ''}${m[3] ? ` ${m[3]}` : ''}`;
  }
  const ord = ordinalANumero(p);
  if (ord != null) return String(ord);
  const rom = romanoANumero(raw);
  if (rom != null) return String(rom);
  if (permitirLetra && /^[A-Z]$/.test(raw)) return raw.toLowerCase();
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rótulos
// ─────────────────────────────────────────────────────────────────────────────
// Bloques sin número que abren una parte del documento. `familia` es lo que las remisiones
// buscan: «hecho tercero» → el TERCERO de un bloque de familia «hecho».
const BLOQUES = [
  [/^antecedentes de hecho$/, 'Antecedentes de hecho', 'antecedente'],
  [/^antecedentes$/, 'Antecedentes', 'antecedente'],
  [/^hechos probados$/, 'Hechos probados', 'hecho'],
  [/^hechos( que se declaran probados)?$/, 'Hechos', 'hecho'],
  [/^fundamentos (de derecho|juridicos)$/, 'Fundamentos de derecho', 'fundamento'],
  [/^fundamentos de derecho (procesales|materiales|sustantivos|de fondo)$/, 'Fundamentos de derecho', 'fundamento'],
  [/^fundamentos$/, 'Fundamentos', 'fundamento'],
  [/^(fallo|fallamos)$/, 'Fallo', 'fallo'],
  [/^(parte dispositiva|dispongo|decido|resuelvo|resuelve|acuerdo|acuerda|se acuerda)$/, 'Parte dispositiva', 'fallo'],
  [/^(suplico|suplica|solicito|solicita|suplico al juzgado|suplico a la sala)$/, 'Suplico', 'suplico'],
  [/^(primer |segundo |tercer )?otrosi( digo| dice)?$/, 'Otrosí', 'otrosi'],
  [/^(expone|exponen|exponemos|manifiesta|manifiestan|manifiestan y exponen)$/, 'Exponen', 'expositivo'],
  [/^(reunidos|intervienen|comparecen|de una parte|las partes)$/, 'Reunidos', 'comparecencia'],
  [/^(estipulaciones|clausulas|pactos|acuerdos|condiciones (generales|particulares)|clausulado)$/, 'Estipulaciones', 'clausula'],
  [/^(preambulo|exposicion de motivos)$/, 'Preámbulo', 'preambulo'],
  [/^voto particular( concurrente| discrepante)?$/, 'Voto particular', 'voto'],
  [/^(documentos|documentos que se acompanan|documental|relacion de documentos|indice de documentos)$/, 'Documentos', 'documento'],
  [/^(anexos)$/, 'Anexos', 'anexo-bloque'],
  [/^(firmas?|en prueba de conformidad.*)$/, 'Firmas', 'firma'],
];

const RE_LBL = (palabra) => new RegExp(`^(${palabra})\\s+(${RE_ORDINAL}|${RE_ROMANO}|${RE_ARABIGO}|[a-z])(?![\\p{L}\\d])\\s*([.:\\-–—)]*)\\s*(.*)$`, 'u');

const ROTULOS_NUMERADOS = [
  // tipo, palabra (plegada), rango, familia, permite letra, etiqueta
  ['titulo', 't[ií]tulo|titulo', 1, 'titulo', false, 'Título'],
  ['capitulo', 'cap[ií]tulo|capitulo', 2, 'capitulo', false, 'Capítulo'],
  ['seccion', 'secci[oó]n|seccion|subsecci[oó]n|subseccion', 3, 'seccion', false, 'Sección'],
  ['articulo', 'articulo|art\\.', 4, 'articulo', false, 'Artículo'],
  ['clausula', 'clausula|estipulacion|pacto|condicion', 4, 'clausula', false, 'Cláusula'],
  ['anexo', 'anexo|apendice|adjunto', 1, 'anexo', true, 'Anexo'],
];

const ROTULOS_COMPILADOS = ROTULOS_NUMERADOS.map(([tipo, palabra, ...resto]) => [tipo, RE_LBL(palabra), ...resto]);

const RE_DISPOSICION = new RegExp(`^disposicion(?:es)?\\s+(adicional|transitoria|derogatoria|final)\\s+(${RE_ORDINAL}|${RE_ARABIGO})\\b\\.?\\s*([.:\\-–—)]+)?\\s*(.*)$`);
const RE_ORDINAL_SOLO = new RegExp(`^(${RE_ORDINAL})\\s*(\\.\\s*-|\\.\\s*–|\\.\\s*—|-|–|—|\\.|:|\\))\\s*(.*)$`);
const RE_NUMERADO = /^(\d{1,2}(?:\.\d{1,2}){0,3})\s*(\.\s*-|\.-|\.|\)|-|–)\s+(.*)$/;
const RE_ADJUNTO_CORREO = /^\[(adjunto|archivo): (.+)\]$/;

// ¿La línea siguiente continúa la frase (el PDF la partió)? Empieza en minúscula, pero no es el
// «a)» de una lista.
function sigueLaFrase(s) {
  const t = String(s || '').trim();
  return /^[a-záéíóúñü(]/.test(t) && !/^[a-z]\)/.test(t) && !/^\([a-z0-9]{1,3}\)/.test(t);
}

const MAX_ROTULO = 140; // un rótulo es una línea corta; un párrafo numerado largo no lo es

function esMayusculas(s) {
  const letras = s.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letras.length < 3) return false;
  const may = letras.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length;
  return may / letras.length >= 0.8;
}

// Título de un rótulo: lo que va detrás de la etiqueta en la misma línea («QUINTA.- Duración del
// contrato. El presente…» → «Duración del contrato»), o la línea siguiente si la etiqueta va sola
// («ANEXO II» / «Tabla salarial»).
// ¿Es un título o el arranque del párrafo? «PRIMERO.- Relación laboral.» tiene título; «PRIMERO.-
// Dña. Nerea Lasheras Tomé, con DNI…, ha prestado servicios…» no: eso es el arranque del texto, y
// presentarlo como título confunde (auditoría del 5-oct). Título: la primera frase, si es corta.
export function tituloOArranque(resto, siguiente) {
  const t = String(resto || '').trim();
  if (!t) return { titulo: tituloDe('', siguiente), arranque: '' };
  const frase = t.match(/^(.+?)(?<![A-Z]|\b(?:art|núm|nº|apdo|pág|Sr|Sra|Dª|D|Dña|Excmo|Ilmo|S\.A|S\.L|etc|vid|cfr|op|cit))(?:[.:;—]|\.-|\.—)(\s|$)/)?.[1] ?? null;
  const candidato = frase ?? (t.length <= 90 ? t : null);
  if (candidato && candidato.split(/\s+/).length <= 12 && candidato.length <= 100) return { titulo: tituloDe(t, siguiente), arranque: '' };
  const a = t.replace(/\s+/g, ' ');
  return { titulo: '', arranque: a.length > 90 ? `${a.slice(0, 87).trimEnd()}…` : a };
}

function tituloDe(resto, siguiente) {
  let t = String(resto || '').trim();
  // El PDF parte las líneas: «Artículo 3. Forma, condiciones y plazo de preaviso de denuncia de la
  // vigencia del» / «convenio.». Si el título no acaba y la línea siguiente sigue en minúscula, es
  // el mismo título.
  const sig = String(siguiente || '').trim();
  if (t && !/[.:;]$/.test(t) && sigueLaFrase(sig)) t = `${t} ${sig}`;
  if (t) {
    const corte = t.search(/(?<![A-Z]|\b(?:art|núm|nº|apdo|pág|Sr|Sra|Dª|D|Dña|Excmo|Ilmo|S\.A|S\.L|etc|vid|cfr|op|cit))[.:;](\s|$)/);
    if (corte > 0) t = t.slice(0, corte);
    return t.length > 120 ? `${t.slice(0, 117).trimEnd()}…` : t;
  }
  const s = String(siguiente || '').trim();
  if (s && s.length <= 120 && !/^(primero|primera|1[.)]|el |la |los |las |en |de |que |por )/i.test(s)) {
    const c = s.replace(/[.:]$/, '');
    return c;
  }
  return '';
}

// Detecta si una línea (ya recortada) es un rótulo. Devuelve { tipo, clave, etiqueta, titulo,
// rango, familia, titulo_en_linea_siguiente } o null.
// El OCR confunde la O con el cero: «PRIMER0.-», «AN0X0 II». Dentro de una palabra, un 0 es una o.
// Misma longitud: las posiciones no se descuadran.
function deshacerOcr(p) {
  return p.replace(/0(?=[a-zñ])|(?<=[a-zñ])0/g, 'o');
}

// Primeras palabras con las que puede empezar un rótulo (plegadas). Las demás líneas —casi todas—
// se descartan sin mirar ninguna expresión regular.
const ARRANQUES = /^(?:\[|\d|[ivx]{1,6}\s*[.)\-–]|antecedentes|hechos?|fundamentos|fallo|fallamos|parte|dispongo|decido|acuerd|resuelv|suplic|solicit|(?:primer |segundo |tercer )?otrosi|expon|manifiest|reunidos|intervienen|comparecen|de una parte|las partes|estipulacion|clausul|pacto|acuerdos|condicion|preambulo|exposicion|voto|document|relacion|indice|anexo|apendice|adjunto|firma|en prueba|t[ií]tulo|cap[ií]tulo|secci|subsecci|art|disposici|primer|segund|tercer|cuart|quint|sext|septim|setim|octav|noven|non[oa]|decim|undecim|duodecim|vigesim|trigesim|cuadragesim|quincuagesim|unic)/;

function rotuloDeLinea(linea, siguiente, { plano = false } = {}) {
  // Un párrafo de Word es una línea entera: para ver si EMPIEZA con un rótulo basta su arranque.
  // «ANEXO V» citado dentro de una modificación («queda redactado: «ANEXO V…») sigue siendo su rótulo.
  const l = linea.trim().replace(/^[«"“]\s*/, '').slice(0, 400);
  if (!l) return null;
  if (!ARRANQUES.test(deshacerOcr(plegar(l.slice(0, 24))))) return null;
  const p = deshacerOcr(plegar(l));

  const adj = l.match(RE_ADJUNTO_CORREO);
  if (adj) {
    return { tipo: 'adjunto', clave: plegar(adj[2]), etiqueta: adj[1] === 'adjunto' ? 'Adjunto' : 'Archivo', titulo: adj[2], rango: 0, familia: 'adjunto' };
  }

  // Bloques: la línea entera es el rótulo (con «:» o «.» al final como mucho).
  const pb = p.replace(/[\s.:\-–—]+$/, '').replace(/\s+/g, ' ');
  if (pb.length <= 60) {
    for (const [re, etiqueta, familia] of BLOQUES) {
      if (re.test(pb)) {
        // «Hechos» o «Fallo» en minúsculas dentro de una frase no es un rótulo: hace falta que vaya
        // en mayúsculas, o solo en su línea con «:» / sin nada más.
        if (!esMayusculas(l) && !/[:.]$/.test(l) && l.split(/\s+/).length > 1 && !/^(Fundamentos|Antecedentes|Hechos)/.test(l)) continue;
        return { tipo: 'bloque', clave: familia, etiqueta, titulo: '', rango: 1, familia };
      }
    }
  }

  // «ANEXO» o «ANEXO ÚNICO» solo en su línea: el anexo único del documento.
  if (/^(anexo|apendice)(\s+unico)?\s*[.:]?$/.test(pb) && (esMayusculas(l) || /^An|^Ap/.test(l))) {
    return { tipo: 'anexo', clave: '1', etiqueta: /unico/.test(pb) ? 'Anexo único' : 'Anexo', titulo: tituloDe('', siguiente), rango: 1, familia: 'anexo', unico: true };
  }

  const disp = p.match(RE_DISPOSICION);
  if (disp && (esMayusculas(l.slice(0, 20)) || /^Disposici/.test(l))) {
    const clave = claveDeId(disp[2]);
    if (clave) {
      const titulo = tituloDe(l.slice(l.length - disp[4].length), siguiente);
      const clase = disp[1];
      return { tipo: 'disposicion', clave: `${clase}:${clave}`, etiqueta: `Disposición ${clase} ${l.slice(0, 200).match(new RegExp(`${disp[1]}\\s+(\\S+)`, 'i'))?.[1]?.replace(/[.:\-–]+$/, '') ?? clave}`, titulo, rango: 4, familia: 'disposicion' };
    }
  }

  for (const [tipo, re, rango, familia, permitirLetra, nombre] of ROTULOS_COMPILADOS) {
    const m = p.match(re);
    if (!m) continue;
    // Un rótulo empieza en mayúscula: «artículo 20.º apartado A)…» en minúscula a principio de
    // línea es una frase que el PDF ha partido justo ahí.
    if (!plano && !/^[A-ZÁÉÍÓÚÑ]/.test(l)) continue;
    const idOrig = l.slice(m[1].length).trim().split(/\s+/)[0]?.replace(/[.:\-–—)]+$/, '') ?? '';
    // Una sola letra solo vale en mayúscula y donde tiene sentido (Anexo A).
    const id = /^[a-z]$/.test(m[2]) ? idOrig : m[2];
    const clave = claveDeId(/^[a-z]$/.test(m[2]) ? idOrig : (/^[ivxlc]+$/.test(m[2]) ? idOrig.toUpperCase() : m[2]), { permitirLetra });
    if (!clave) continue;
    const resto = m[4] ? l.slice(l.length - m[4].length) : '';
    const sep = m[3] || '';
    // «Artículo 5 del Estatuto…» dentro de una frase no es un rótulo. Se exige: separador
    // detrás del número, o la línea sola / en mayúsculas, o un título corto.
    const cabeEnLinea = l.length <= MAX_ROTULO;
    // «Artículo 21.4 Contrato de fijos discontinuos.»: sin separador, pero el título empieza en
    // mayúscula y la línea es corta. («Artículo 5 del Estatuto…» sigue en minúscula: no vale.)
    const pareceRotulo = Boolean(sep) || !resto || esMayusculas(l.slice(0, Math.min(l.length, 40)))
      || (cabeEnLinea && /^[A-ZÁÉÍÓÚÑ]/.test(resto));
    if (!pareceRotulo) continue;
    if (!cabeEnLinea && !sep) continue;
    // En texto plano las remisiones («según el artículo 5 del…») se confunden con rótulos: solo
    // valen en mayúsculas.
    if (plano && !esMayusculas(l.slice(0, m[1].length + 1 + String(id).length))) continue;
    if (tipo === 'articulo' && /^(de|del|de la|y|e|o)\b/.test(plegar(resto))) continue;
    const { titulo, arranque } = tituloOArranque(resto, siguiente);
    const bis = String(id).match(/\s?(bis|ter|quater)\b/i)?.[1];
    const idBonito = /^[ivxlc]+$/i.test(idOrig) && romanoANumero(idOrig.toUpperCase()) != null
      ? idOrig.toUpperCase()
      : (/^[a-záéíóúñü-]+$/i.test(idOrig) && idOrig.length > 1 ? idOrig.toLowerCase() : idOrig);
    const etiqueta = `${nombre} ${idBonito}${bis && !String(idBonito).toLowerCase().includes(bis.toLowerCase()) ? ` ${bis.toLowerCase()}` : ''}`.trim();
    return { tipo, clave, etiqueta, titulo, arranque, rango, familia, tituloEnSiguiente: !resto.trim() && Boolean(titulo) };
  }

  // «PRIMERO.-», «Segundo.-», «TERCERA:» — hechos, fundamentos, estipulaciones, antecedentes.
  const o = p.match(RE_ORDINAL_SOLO);
  if (o) {
    const palabraOrig = l.slice(0, o[1].length);
    const enMayus = esMayusculas(palabraOrig) || /^[A-ZÁÉÍÓÚ0-9]+$/.test(palabraOrig.replace(/\s/g, ''));
    const sepFuerte = /-|–|—/.test(o[2]);
    // «Cuarto.» solo en su línea, o «Cuarto. Sustituciones de personal.» en una línea corta: rótulo.
    const restoOrd = l.slice(l.length - o[3].length);
    const cortoConPunto = !plano && /^[.:]/.test(o[2].trim()) && /^[A-ZÁÉÍÓÚ]/.test(palabraOrig)
      && (!restoOrd || (restoOrd.length <= 80 && /^[A-ZÁÉÍÓÚÑ¿«"]/.test(restoOrd)));
    if (enMayus || sepFuerte || cortoConPunto) {
      const n = ordinalANumero(o[1]);
      if (n != null) {
        const resto = l.slice(l.length - o[3].length);
        return { tipo: 'ordinal', clave: String(n), etiqueta: palabraOrig.charAt(0).toUpperCase() + palabraOrig.slice(1).toLowerCase(), ...tituloOArranque(resto, siguiente), rango: 4, familia: null };
      }
    }
  }

  if (plano) return null;

  // «II.- Hechos», «IV. Fundamentos» (solo romanos válidos y línea corta).
  // Solo I…XXXIX: una «C.» o una «L.» suelta es una letra de lista, no el cien ni el cincuenta.
  const r = l.match(/^([IVX]{1,6})\s*(\.\s*-|\.|-|–|\))\s+(.*)$/);
  // En un Word cada párrafo es una línea: «II. Legitimación y procedimiento. Artículos 103 y
  // siguientes LRJS…». Vale como rótulo si su primera frase es corta.
  const primeraFrase = r ? (r[3].match(/^[^.:;]{1,80}[.:;]/)?.[0] ?? null) : null;
  // La cabecera de sección del BOE («III. OTRAS DISPOSICIONES») no es parte del documento.
  const cabeceraBoe = r && /^(DISPOSICIONES GENERALES|AUTORIDADES Y PERSONAL|OTRAS DISPOSICIONES|ANUNCIOS|ADMINISTRACI[OÓ]N DE JUSTICIA|TRIBUNAL CONSTITUCIONAL)\.?$/.test(r[3].trim());
  if (r && !cabeceraBoe && (l.length <= MAX_ROTULO || primeraFrase) && /^[A-ZÁÉÍÓÚÑ¿"«]/.test(r[3]) && romanoANumero(r[1]) != null && !sigueLaFrase(siguiente)) {
    return { tipo: 'romano', clave: String(romanoANumero(r[1])), etiqueta: r[1], ...tituloOArranque(r[3], siguiente), rango: 3, familia: 'romano' };
  }

  // «1. Objeto», «2.3.- Plazo»: solo líneas cortas que no acaban como una frase de un párrafo.
  // Un párrafo numerado que el PDF parte en líneas («1. El presente convenio colectivo será de
  // aplicación a todas las personas» / «trabajadoras…») NO es un rótulo: la línea siguiente sigue en
  // minúscula. Un rótulo es corto, no acaba en coma ni en dos puntos y lo que viene detrás empieza
  // de nuevo.
  const nu = l.match(RE_NUMERADO);
  const sigTrim = String(siguiente || '').trim();
  const lineaCorta = nu && nu[3].length <= 80 && nu[3].split(/\s+/).length <= 10 && !/[,;:]$/.test(l);
  // En un Word, «1. Sobre la responsabilidad. La aseguradora…» es un párrafo entero: rótulo si su
  // primera frase es un título (corta y cerrada).
  const tituloEnParrafo = nu && l.length > MAX_ROTULO && /^[^.:;]{3,70}[.:](\s|$)/.test(nu[3])
    && nu[3].match(/^[^.:;]{3,70}/)[0].split(/\s+/).length <= 8;
  if (nu && (lineaCorta || tituloEnParrafo) && /^[A-ZÁÉÍÓÚÑ¿"«]/.test(nu[3]) && !sigueLaFrase(sigTrim)) {
    const prof = nu[1].split('.').length;
    return { tipo: 'numerado', clave: nu[1], etiqueta: nu[1], ...tituloOArranque(nu[3], siguiente), rango: 4 + prof, familia: 'apartado' };
  }
  return null;
}

// Rótulos que llevan el texto en la MISMA línea (auditoría del 5-oct): «SUPLICO AL JUZGADO que dicte
// sentencia…», «OTROSÍ DIGO PRIMERO: que…», «DILIGENCIA DE INICIO.— Siendo las…», «OBSERVACIÓN DE LA
// LETRADA:», «SENTENCIA N.º 512/2026».
const RE_SUPLICO_EN_LINEA = /^((?:PRIMER |SEGUNDO |TERCER |CUARTO )?OTROS[IÍ](?: DIGO| DICE)?(?: (?:PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO))?|SUPLICO|SUPLICA|SOLICITO|SOLICITA)\b[\s.:,\-–—]*(.*)$/;
function rotuloEnLinea(linea, siguiente, documentoEnMayusculas) {
  const t = linea.trim();
  const su = t.match(RE_SUPLICO_EN_LINEA);
  if (su) {
    const otrosi = /^.{0,8}OTROS/.test(su[1]);
    const etiqueta = su[1].charAt(0) + su[1].slice(1).toLowerCase();
    return { tipo: 'bloque', clave: plegar(su[1]), etiqueta, ...tituloOArranque(su[2], siguiente), rango: 1, familia: otrosi ? 'otrosi' : 'suplico' };
  }
  // «Esta Subsecretaría acuerda:», «La Dirección General de Trabajo resuelve:»: la parte dispositiva.
  if (t.length <= 160 && /\b(acuerda|acuerdo|resuelve|resuelvo|dispone|dispongo|decide|decreta|decido)\s*:\s*$/i.test(t)) {
    return { tipo: 'bloque', clave: 'fallo', etiqueta: 'Parte dispositiva', titulo: t.replace(/\s*:\s*$/, ''), rango: 1, familia: 'fallo' };
  }
  const res = t.match(/^(SENTENCIA|AUTO|DECRETO|PROVIDENCIA)\s+(?:N\.?\s?º|NÚM\.?|NUM\.?|N\.)\s*[\d/]+\S*$/);
  if (res) return { tipo: 'rotulo', clave: plegar(t), etiqueta: t, titulo: '', rango: 1, familia: 'rotulo' };
  if (documentoEnMayusculas) return null;
  const et = t.match(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 ,()/º]{3,70}?)\s*(\.\s?—|\.\s?-|—|:)\s*(.*)$/);
  if (et && esMayusculas(et[1]) && et[1].split(/\s+/).length <= 9 && !CONECTOR_FINAL.test(et[1].trim())) {
    const conGuion = /—|-/.test(et[2]);
    if (conGuion || !et[3]) {
      const limpio = et[1].trim();
      return { tipo: 'rotulo', clave: plegar(limpio), etiqueta: limpio.charAt(0) + limpio.slice(1).toLowerCase(), ...tituloOArranque(et[3], siguiente), rango: 1, familia: 'rotulo' };
    }
  }
  return null;
}

const MEMBRETE = /^(MINISTERIO|CONSEJER|CONSELLERI|DEPARTAMENT|SERVICIO|SERVIZO|AYUNTAMIENTO|AJUNTAMENT|GOBIERNO|GOBIERNO|JUNTA |GENERALITAT|XUNTA|DIPUTACI|BOLET[IÍ]N|HOSPITAL|OSAKIDETZA|MUTUA|INSTITUTO|COMUNIDAD|REGI[OÓ]N|AGENCIA|TESORER|DIRECCI[OÓ]N (GENERAL|PROVINCIAL))/;

// Un rótulo sin palabra clave: una línea corta toda en mayúsculas a la que sigue texto normal
// («MOTIVO DE CONSULTA», «EXPLORACIÓN FÍSICA», «JUICIO CLÍNICO» en un informe médico; «ALEGACIONES»
// en un recurso). No: cabeceras repetidas, «ESTATURA: 1,72», importes, líneas partidas.
const CONECTOR_FINAL = /\b(de|del|la|las|el|los|y|e|o|u|en|con|por|para|que|a|al|sin|sobre|entre)$/i;
function rotuloGenerico(linea, siguiente, repetidas, inicio = Infinity) {
  const t = linea.trim();
  // El membrete de arriba («SERVICIO ANDALUZ DE SALUD», «MINISTERIO DE TRABAJO») no es una sección.
  if (inicio < 400 && MEMBRETE.test(t)) return null;
  if (t.length < 4 || t.length > 70) return null;
  if (!esMayusculas(t) || t.split(/\s+/).length > 8) return null;
  if (/[,;]$/.test(t) || CONECTOR_FINAL.test(t.replace(/[.:]$/, ''))) return null;
  if (/:\s*\S/.test(t) || /\.{3,}|…/.test(t) || /\d[\d.,]{2,}/.test(t) || /^[\-–—*•·]/.test(t)) return null;
  if ((repetidas.get(t) ?? 0) >= 3) return null;
  // La cabecera del BOE en cada página (aunque el documento solo tenga dos) y las fórmulas.
  if (/^(BOLET[ÍI]N OFICIAL|N[úu]m\.\s*\d|Sec\.\s*[IVX]+|P[áa]g\.\s*\d|cve:|Verificable en)|^(EN NOMBRE DEL REY|Y EN SU NOMBRE)/i.test(t)) return null;
  const sig = String(siguiente || '').trim();
  if (!sig || esMayusculas(sig)) return null;
  const limpio = t.replace(/[.:]$/, '');
  const etiqueta = limpio.charAt(0) + limpio.slice(1).toLowerCase();
  return { tipo: 'rotulo', clave: plegar(limpio), etiqueta, titulo: '', rango: 1, familia: 'rotulo' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Árbol
// ─────────────────────────────────────────────────────────────────────────────
// En texto plano se parte por los rótulos inconfundibles, que se buscan EN MEDIO del texto.
const RE_ROTULO_PLANO = new RegExp(
  [
    '(?:ANTECEDENTES DE HECHO|HECHOS PROBADOS|FUNDAMENTOS DE DERECHO|FUNDAMENTOS JUR[IÍ]DICOS|FALLAMOS|FALLO|SUPLICO|OTROS[IÍ](?: DIGO)?|ESTIPULACIONES|EXPONEN|MANIFIESTAN|REUNIDOS)(?=[\\s:.]|$)',
    '(?:CL[AÁ]USULA|ESTIPULACI[OÓ]N|ANEXO|AP[EÉ]NDICE|ART[IÍ]CULO|CAP[IÍ]TULO|T[IÍ]TULO)\\s+[A-ZÁÉÍÓÚ0-9]+',
    '(?:PRIMER[OA]|SEGUND[OA]|TERCER[OA]|CUART[OA]|QUINT[OA]|SEXT[OA]|S[EÉ]PTIM[OA]|OCTAV[OA]|NOVEN[OA]|D[EÉ]CIM[OA]|UND[EÉ]CIM[OA]|DUOD[EÉ]CIM[OA]|(?:DECIMO|VIG[EÉ]SIMO|DECIMA|VIG[EÉ]SIMA)\\s?[A-ZÁÉÍÓÚ]+)\\s*\\.?\\s*[-–—]',
  ].join('|'),
  'g',
);

function lineasDe(texto, { plano }) {
  const out = [];
  if (!plano) {
    let pos = 0;
    for (const l of texto.split('\n')) {
      out.push({ inicio: pos, texto: l });
      pos += l.length + 1;
    }
    return out;
  }
  // Plano: «líneas» = tramos entre rótulos inconfundibles.
  const cortes = [0];
  for (const m of texto.matchAll(RE_ROTULO_PLANO)) if (m.index > 0) cortes.push(m.index);
  cortes.push(texto.length);
  for (let i = 0; i < cortes.length - 1; i++) out.push({ inicio: cortes[i], texto: texto.slice(cortes[i], cortes[i + 1]) });
  return out;
}

// Construye el árbol. Devuelve { nodos (en orden de aparición), raices }. Cada nodo:
// { id, tipo, clave, etiqueta, titulo, familia, nivel, inicio, finPropio, fin, padre, hijos }.
// `inicio..fin` es la sección entera con sus subsecciones; `inicio..finPropio`, hasta el primer
// hijo.
export function construirArbol(texto, { plano = false } = {}) {
  const t = String(texto || '');
  const lineas = lineasDe(t, { plano });
  // Para los rótulos genéricos en mayúsculas («MOTIVO DE CONSULTA», «EVOLUCIÓN»): las cabeceras que
  // se repiten en cada página («BOLETÍN OFICIAL DEL ESTADO») no lo son, y en un documento todo en
  // mayúsculas (un escaneo antiguo) ninguna línea destaca.
  const repetidas = new Map();
  let conLetras = 0;
  let enMayus = 0;
  if (!plano) {
    for (const { texto: l } of lineas) {
      const tt = l.trim();
      if (!tt) continue;
      repetidas.set(tt, (repetidas.get(tt) ?? 0) + 1);
      if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]{4}/.test(tt)) {
        conLetras += 1;
        if (esMayusculas(tt)) enMayus += 1;
      }
    }
  }
  const documentoEnMayusculas = conLetras > 0 && enMayus / conLetras >= 0.3;
  const nodos = [];
  const pila = [];
  let bloqueFamilia = null; // familia del último bloque abierto (para los ordinales)

  for (let i = 0; i < lineas.length; i++) {
    const { inicio, texto: l } = lineas[i];
    const sangria = l.length - l.trimStart().length;
    let siguiente = '';
    if (!plano) {
      for (let j = i + 1; j < lineas.length && j < i + 6; j++) {
        if (lineas[j].texto.trim()) { siguiente = lineas[j].texto; break; }
      }
    }
    let r = rotuloDeLinea(l, siguiente, { plano });
    // Un elemento de una LISTA numerada («1. Pasaporte en vigor» / «2. Certificado de…») no es un
    // apartado: la línea de antes o la de después es otro número del mismo nivel, sin texto en medio.
    if (r && (r.tipo === 'numerado' || r.tipo === 'romano') && !plano) {
      const prof = String(r.clave).split('.').length;
      const vecina = (paso) => {
        for (let j = i + paso; j >= 0 && j < lineas.length && Math.abs(j - i) < 4; j += paso) {
          const tt = lineas[j].texto.trim();
          if (!tt) continue;
          const mm = tt.match(r.tipo === 'romano' ? /^([IVX]{1,6})\s*[.)\-–]\s+\S/ : /^(\d{1,2}(?:\.\d{1,2}){0,3})\s*(?:\.-|\.|\)|-|–)\s+\S/);
          return Boolean(mm) && (r.tipo === 'romano' || mm[1].split('.').length === prof);
        }
        return false;
      };
      // …y solo si la línea es una frase corta y nada más: «II. Fondo. Resolución por impago.» lleva
      // su cuerpo detrás y es un fundamento aunque el siguiente vaya pegado.
      const cuerpo = l.trim().replace(/^\S+\s*/, '');
      const unaFrase = !/[.:;]\s+\S/.test(cuerpo.replace(/[.:;]\s*$/, '')) && cuerpo.split(/\s+/).length <= 14;
      if (unaFrase && (vecina(-1) || vecina(1))) r = null;
    }
    // El «SUPLICO AL JUZGADO» con que se cierra cada otrosí es parte del otrosí, no otro bloque.
    if (r && r.familia === 'suplico' && bloqueFamilia === 'otrosi') r = null;
    if (!r && !plano) r = rotuloEnLinea(l, siguiente, documentoEnMayusculas);
    if (!r && !plano && !documentoEnMayusculas) r = rotuloGenerico(l, siguiente, repetidas, inicio);
    // Arriba del todo, un rótulo genérico es el membrete («Concello de Lugo», «Coromina advocats
    // laboralistes») salvo que sea el título del documento («INFORME PERICIAL», «DEMANDA DE…»).
    if (r && r.tipo === 'rotulo' && !nodos.length && inicio < 300 && !/^(informe|sentencia|auto|decreto|demanda|contestaci|recurso|escrito|contrato|convenio|acta|certifica|resoluci|declaraci|dictamen|atestado|denuncia|querella|solicitud|alegaciones|diligencia|testamento|escritura|poder|acuerdo|propuesta|parte|historia|hoja|nota|carta|burofax|requerimiento|providencia|comunicaci|notificaci|citaci|informaci|memoria|anexo|documento)/i.test(plegar(r.etiqueta))) r = null;
    if (!r) continue;
    let { rango } = r;
    let familia = r.familia;
    if (r.tipo === 'bloque') bloqueFamilia = r.familia;
    if (r.tipo === 'ordinal') {
      familia = bloqueFamilia ?? 'ordinal';
      // Un ordinal cuelga del bloque abierto (Hechos, Fundamentos, Estipulaciones…).
      rango = 4;
    }
    if (r.tipo === 'anexo' || r.tipo === 'titulo' || r.tipo === 'adjunto') bloqueFamilia = null;
    const nodo = {
      id: `s${nodos.length + 1}`,
      tipo: r.tipo,
      clave: r.clave,
      etiqueta: r.etiqueta,
      titulo: r.titulo || '',
      arranque: r.arranque || '',
      familia,
      inicio: inicio + sangria,
      finPropio: t.length,
      fin: t.length,
      padre: null,
      hijos: [],
      nivel: 0,
    };
    // Un adjunto o un archivo de un contenedor vuelve siempre a la raíz.
    const r0 = r.tipo === 'adjunto' ? 0 : rango;
    while (pila.length && pila[pila.length - 1]._rango >= r0) {
      const cerrado = pila.pop();
      cerrado.fin = nodo.inicio;
    }
    const padre = pila[pila.length - 1] ?? null;
    // «I. Competencia», «II. Fondo» directamente bajo FUNDAMENTOS DE DERECHO son fundamentos: «en
    // los términos del fundamento III» va ahí. Igual «1.», «2.» directamente bajo HECHOS.
    if ((nodo.tipo === 'romano' || nodo.tipo === 'numerado') && padre?.tipo === 'bloque'
      && ['hecho', 'fundamento', 'antecedente', 'clausula'].includes(padre.familia)) nodo.familia = padre.familia;
    if (padre) {
      nodo.padre = padre.id;
      padre.hijos.push(nodo.id);
      if (padre.hijos.length === 1) padre.finPropio = nodo.inicio;
      nodo.nivel = padre.nivel + 1;
    }
    nodo._rango = r0;
    nodos.push(nodo);
    pila.push(nodo);
  }
  for (const n of pila) n.fin = t.length;
  for (const n of nodos) {
    if (!n.hijos.length) n.finPropio = n.fin;
    delete n._rango;
  }
  marcarIrregulares(nodos);
  return { nodos, raices: nodos.filter((n) => !n.padre).map((n) => n.id) };
}

// Numeración irregular dentro de un mismo padre (un «CUARTO» repetido, un salto): se marca, no se
// corrige. El índice enseña el documento como es.
function marcarIrregulares(nodos) {
  const porPadre = new Map();
  for (const n of nodos) {
    if (!['ordinal', 'clausula', 'articulo', 'anexo', 'capitulo', 'titulo', 'seccion'].includes(n.tipo)) continue;
    const k = `${n.padre ?? '-'}|${n.tipo}`;
    if (!porPadre.has(k)) porPadre.set(k, []);
    porPadre.get(k).push(n);
  }
  for (const grupo of porPadre.values()) {
    let previo = null;
    const vistos = new Set();
    for (const n of grupo) {
      const v = Number.parseInt(n.clave, 10);
      if (vistos.has(n.clave)) n.numeracion = 'repetida';
      else if (Number.isFinite(v) && previo != null && v !== previo + 1 && v > 1) n.numeracion = 'salto';
      vistos.add(n.clave);
      if (Number.isFinite(v)) previo = v;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Remisiones internas
// ─────────────────────────────────────────────────────────────────────────────
const TIPOS_REMISION = [
  ['clausula', 'cl[aá]usulas?|estipulaci[oó]n(?:es)?|pactos?|condici[oó]n(?:es)?'],
  ['anexo', 'anexos?|ap[eé]ndices?'],
  ['articulo', 'art[íi]culos?|arts?\\.'],
  ['hecho', 'hechos?(?:\\s+probados?)?'],
  ['fundamento', 'fundamentos?(?:\\s+(?:de\\s+derecho|jur[íi]dicos?))?|f\\.?\\s?j\\.?'],
  ['antecedente', 'antecedentes?(?:\\s+de\\s+hecho)?'],
  ['capitulo', 'cap[íi]tulos?'],
  ['titulo', 't[íi]tulos?'],
  ['seccion', 'secci[oó]n(?:es)?'],
  ['apartado', 'apartados?|ep[íi]grafes?|puntos?'],
  ['disposicion', 'disposici[oó]n(?:es)?\\s+(?:adicional|transitoria|derogatoria|final)(?:es)?'],
  ['otrosi', 'otros[íi]'],
];
// Sobre texto PLEGADO (sin tildes, minúsculas).
const RE_TIPOS = TIPOS_REMISION.map(([t, re]) => [t, plegar(re).replace(/\[aa\]/g, 'a').replace(/\[ii\]/g, 'i').replace(/\[oo\]/g, 'o').replace(/\[ee\]/g, 'e')]);
// Una letra suelta como identificador («Anexo A», «apartado b)»), nunca la conjunción («Anexo II, y…»).
const ID_REM = `(?:${RE_ORDINAL}|${RE_ARABIGO}|${RE_ROMANO}(?![a-z])|(?![eo]\\b)[a-h](?=\\)|\\b))`;
const RE_REMISION = new RegExp(
  `\\b(${RE_TIPOS.map(([, re]) => re).join('|')})\\s+(?:(?:n[uú]m(?:ero)?\\.?|n\\.?\\s?[ºo°]\\.?)\\s*)?(${ID_REM}(?:\\s*(?:,|y|e|o|a|al|hasta)\\s*(?:(?:el|la|los|las)\\s+)?${ID_REM})*)`,
  'g',
);

// Lo que sigue a «artículo 55» y lo hace EXTERNO: otra norma, otro convenio, otro contrato.
const RE_EXTERNA = new RegExp(
  '^[\\s,]*(?:\\.?\\s*\\d[\\d.]*\\s*)?(?:(?:de(?:l)?|de\\s+la|de\\s+los|de\\s+las|en\\s+(?:el|la))\\s+)?' +
    '(?:ley|l\\.?\\s?o\\.?|real\\s+decreto|r\\.?\\s?d\\.?|rdl|decreto|orden|reglamento|directiva|estatuto|e\\.?\\s?t\\.?\\b|codigo|c\\.?\\s?c\\.?\\b|c\\.?\\s?p\\.?\\b|constitucion|c\\.?\\s?e\\.?\\b|texto\\s+refundido|trlgss|trlgdcu|lgss|lec\\b|lecrim|ljs\\b|lrjs|lopj|lsc\\b|lau\\b|lpac|lrjsp|lcsp|lgt\\b|lirpf|rgpd|lopdgdd|tratado|carta|convenio\\s+(?:colectivo|europeo|de\\s+la|de\\s+roma|n)|esquema|norma|normativa|ordenanza|convencion|protocolo|acuerdo\\s+(?:marco|interprofesional)|resolucion|instruccion|circular|tfue|tue\\b|cedh|ley\\s+organica|loreg|[a-z]{2,6}\\s*\\d)',
);
// Y lo que la hace INTERNA sin dudas.
const RE_INTERNA = /^[\s,]*(?:(?:de(?:l)?|a|al|en)\s+)?(?:(?:el|la|este|esta|presente|mismo|misma)\s+)?(?:presente|este|esta|anterior|siguiente|precedente|mismo|misma)\b(?![^\S\n]+(?:ley|norma|real|reglamento|estatuto|codigo|directiva|decreto|orden|texto|cuerpo legal|precepto legal)\b)/;
// Lo que la hace EXTERNA mirando el original (con sus mayúsculas): «de la LPRL», «del ET», «del III
// Convenio», «de la Ley 4/2023», «del Código Civil».
const RE_EXTERNA_ORIG = /^[ \t,]*(?:\.?\d[\d.]*[ \t]*)?(?:\.?[a-z]\)\s*|\.[a-z]\s+)?(?:(?:y|e|,)[ \t]*\d[\d.]*(?:\.?[a-z]\))?[ \t]*)*(?:(?:de|del|de la|de los|de las|en el|en la)\s+|(?<=\))\s*(?:de|del|de la|de los|de las)\s+)?(?:[A-ZÁÉÍÓÚ]{2,}[a-z]{0,2}\b|(?:[IVX]+|[\dº]+)\s+Convenio|Ley\b|Real\b|Estatuto|C[oó]digo|Constituci|Reglamento|Directiva|Decreto|Orden\b|Acuerdo\s+(?:Marco|Interprofesional)|Convenio\s+(?:Colectivo|General|Estatal|Provincial|Sectorial|de\s+la|de\s+Rom|Europeo|n))/;
// …y lo que la hace externa por DELANTE: «la Ley en su artículo 33», «Estatuto de los Trabajadores
// (artículo 17)», «su artículo 7».
const RE_EXTERNA_ANTES = /(?:\b(?:Ley|LPRL|ET|LISOS|LRJS|LEC|LOPJ|Estatuto de los Trabajadores|Real Decreto(?: Legislativo)?|RD|R\.D\.|Reglamento|Constituci[oó]n|C[oó]digo \w+|Ley Org[aá]nica [\d/]+|Directiva|Convenio Colectivo [^.;]{0,40})[^.;()]{0,30}(?:\(|en su|,)\s*$)|(?:\b(?:Ley|Estatuto|Real Decreto|Reglamento|Directiva|Ley Org[aá]nica)\b[^.;]{0,320}\(\s*(?:actual|antiguo|vigente|nuevo)?\s*$)|(?:\b(?:Ley|LO|Ley Org[aá]nica|Real Decreto|RD|R\.D\.|Estatuto|Reglamento|Directiva|C[oó]digo|Constituci[oó]n|norma|texto legal)\b[^.]{0,230}\b[Ee]n\s+su\s+$)|(?:\b(?:OIT|Convenios?\s+(?:n\.?\s?º\s*)?\d+)\b[^.;]{0,40}\ben\s+(?:los|el|sus|su)\s+$)|(?:concretamente|en concreto|en particular)\s+(?:el|la|los|las)?\s*$|(?:\b(?:Ley|Real Decreto|Estatuto|Reglamento|Directiva)\b[^.]{0,140}:\s*[^.:]{0,90}$)/;
// La norma ajena aparece MÁS ADELANTE en la misma frase: «artículo 16 de dicha Ley», «anexo III y
// anexo IV del Convenio Colectivo 2012-2015», «capítulo II, sección 4.ª, artículo 66, de su Reglamento».
const RE_EXTERNA_LEJOS = /^(?:[^.;]|\.(?=[ªº\d]|[a-z]\)|\s*(?:de|del)\s)){0,90}?\b(?:de|del|en el|en la)\s+(?:su|sus|dicha|dicho|la mencionada|el mencionado|la citada|el citado|citado|citada|mencionado|mencionada|esta|la)?\s*(?:Ley\b|ley\b|Reglamento|reglamento|Estatuto|estatuto|Real Decreto|C[oó]digo|LPRL|LISOS|ET\b|E\.\s?T\.|mismo texto|texto legal|misma norma|norma\b|Circular|Protocolo\b|OIT\b|Convenio\s+(?:n\.?\s?º\s*)?\d+\s+de\s+la\s+OIT|(?:[IVX]+|\d+º?)\s+Convenio|Convenio\s+(?:Colectivo\s+)?(?:\d{4}|de\s+\d{4}|del?\s+Grupo|[A-Z][a-z]+\s+\d{4})|convenios?\s+colectivos?\s+de\b|Acuerdo\s+(?:sobre|Interprofesional|Marco|Estatal|de\s+Soluci)|ASAC|V\s+ASAC)/;

function partirIds(s) {
  return plegar(s).split(/\s*(?:,|\by\b|\be\b|\bo\b|\ba\b|\bal\b|\bhasta\b)\s*(?:(?:el|la|los|las)\s+)?/).map((x) => x.trim()).filter(Boolean);
}

// ¿Qué nodos son el destino de (familia, clave)?
function candidatos(arbol, familia, clave) {
  const { nodos } = arbol;
  const casa = (n) => n.clave === clave;
  if (familia === 'clausula') {
    const directos = nodos.filter((n) => n.tipo === 'clausula' && casa(n));
    if (directos.length) return directos;
    return nodos.filter((n) => n.tipo === 'ordinal' && n.familia === 'clausula' && casa(n));
  }
  if (familia === 'hecho' || familia === 'fundamento' || familia === 'antecedente') {
    const directos = nodos.filter((n) => ['ordinal', 'romano', 'numerado'].includes(n.tipo) && n.familia === familia && casa(n));
    if (directos.length) return directos;
    // «Antecedentes de hecho» de una sentencia ↔ «hecho» de la demanda: no se cruzan.
    return [];
  }
  if (familia === 'apartado') {
    // «apartado V» → el rótulo romano V; «apartado 2.3» → el numerado 2.3. Solo si es único.
    const directos = nodos.filter((n) => (n.tipo === 'numerado' || n.tipo === 'romano') && casa(n));
    return directos.length === 1 ? directos : [];
  }
  if (familia === 'otrosi') return nodos.filter((n) => n.familia === 'otrosi');
  if (familia === 'disposicion') return [];
  return nodos.filter((n) => n.tipo === familia && casa(n));
}

// La sección más profunda que contiene `pos`. Los nodos van en orden de inicio: se para al pasar.
function nodoEn(arbol, pos) {
  let mejor = null;
  for (const n of arbol.nodos) {
    if (n.inicio > pos) break;
    if (pos < n.fin && (!mejor || n.nivel >= mejor.nivel)) mejor = n;
  }
  return mejor;
}
export { nodoEn };

// Palabras de contenido para comparar «de qué trata» la remisión con el destino.
const VACIAS = new Set(plegar(
  'a al ante bajo con contra de del desde durante en entre hacia hasta mediante para por segun sin sobre tras el la los las lo un una unos unas y e o u ni que se su sus le les como mas pero ya este esta estos estas ese esa eso dicho dicha dichos dichas presente previsto prevista previstos previstas establecido establecida establecidos establecidas recogido recogida recogidos recogidas regulado regulada regulados reguladas indicado indicada referido referida dispuesto dispuesta contenido contenida senalado senalada conforme termino terminos lo cual cuya cuyo cuyas cuyos sera seran podra podran debera deberan articulo clausula anexo hecho fundamento apartado estipulacion pacto documento parte partes caso efectos acuerdo mismo misma mismos mismas otro otra otros otras cada todo toda todos todas cualquier', ).split(/\s+/));
function palabras(s) {
  return (plegar(s).match(/[a-zñ]{4,}/g) || []).filter((w) => !VACIAS.has(w));
}
function raiz(w) {
  return w.slice(0, Math.max(4, Math.min(w.length - 1, 7)));
}

// Contexto de la remisión: la frase hasta ella («la Comisión de Seguimiento prevista en la
// cláusula sexta») —lo que dice que hay allí—.
function temaDe(texto, inicio) {
  // Los saltos de línea sueltos son renglones del PDF, no fin de frase; el párrafo acaba en una
  // línea en blanco.
  const antes = texto.slice(Math.max(0, inicio - 220), inicio).replace(/\n\n+/g, '¶').replace(/\n/g, ' ');
  const corte = Math.max(antes.lastIndexOf('. '), antes.lastIndexOf('¶'), antes.lastIndexOf('; '), antes.lastIndexOf(': '));
  const frase = antes.slice(corte + 1);
  // El sintagma justo antes de «prevista en / regulada en / reconocidos en / según / (»: de eso es
  // de lo que habla la remisión. Sin esa forma, las últimas palabras de la frase.
  const m = frase.match(/([^,;:()]{3,90}?)\s+(?:(?:prevista?s?|previstos|establecida?s?|establecidos|regulada?s?|regulados|recogida?s?|recogidos|contemplada?s?|definida?s?|fijada?s?|indicada?s?|detallada?s?|descrita?s?|relacionada?s?|reconocida?s?|reconocidos|dispuest[oa]s?|señalada?s?|contenida?s?|mencionada?s?|referida?s?|desarrollad[oa]s?|que\s+(?:figura|consta|viene\s+desarrollad[oa]|se\s+(?:recoge|detalla|establece|regula|incluye|adjunta|acompana|une|desarrolla))n?|incluida?s?|a\s+que\s+se\s+refiere\w*|conforme\s+(?:a|al)|seg[uú]n|de\s+acuerdo\s+con|con\s+arreglo\s+a)\s+(?:en\s+)?(?:el|la|los|las|al)?\s*|\s*\(\s*)$/i);
  return m ? m[1] : '';
}

function solapa(a, b) {
  const ra = new Set(a.map(raiz));
  return b.filter((w) => ra.has(raiz(w))).length;
}

// Todas las remisiones internas resueltas del texto. Cada una:
// { inicio, fin, texto, familia, clave, destino: id|null, ambiguo?, aviso? }
export function remisiones(texto, arbol) {
  const t = String(texto || '');
  const p = plegar(t);
  // Los renglones del PDF no cortan la frase: «Estatuto de los\nTrabajadores (actual artículo 34)».
  const tn = t.replace(/(?<!\n)\n(?!\n)/g, ' ');
  const out = [];
  for (const m of p.matchAll(RE_REMISION)) {
    const tipoTxt = m[1];
    const familia = RE_TIPOS.find(([, re]) => new RegExp(`^(?:${re})$`).test(tipoTxt))?.[0];
    if (!familia) continue;
    const fin = m.index + m[0].length;
    // «HECHOS» / «PRIMERO.-»: un rótulo de bloque seguido del primer ordinal, no una remisión.
    const tipoOrig = t.slice(m.index, m.index + tipoTxt.length);
    if (esMayusculas(tipoOrig) && /\n/.test(t.slice(m.index + tipoTxt.length, fin))) continue;
    // Un rótulo a principio de línea («Artículo 8. Protección de datos», una fila de tabla «Artículo
    // 24. Plus…») no remite a nada: es el propio rótulo.
    const antesLinea = t.slice(Math.max(0, m.index - 3), m.index);
    if ((m.index === 0 || /(^|\n)[\s«"“]*$/.test(antesLinea)) && /[A-ZÁÉÍÓÚ]/.test(t[m.index])) continue;
    // «B. ANEXO VI.2 Modelo de compromiso…»: un rótulo en mayúsculas tras la letra de un apartado.
    if (esMayusculas(t.slice(m.index, m.index + tipoTxt.length)) && /(^|\n)\s*[A-Z0-9]{1,3}[.)]\s*$/.test(t.slice(Math.max(0, m.index - 6), m.index))) continue;
    const tras = p.slice(fin, fin + 70);
    const interna = RE_INTERNA.test(tras);
    // «artículo 8.1.3, apartado c), de este convenio»: la marca de interna, un poco más allá.
    const internaLejos = /^[^.;]{0,40}?\b(?:de|del)\s+(?:este|esta|presente)\s+(?:texto\s+(?:de\s+(?:este|esta)\s+)?)?(?:convenio|contrato|acuerdo|documento)/.test(tn.slice(fin, fin + 90).toLowerCase().replace(/[áéíóú]/g, (c) => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' })[c]));
    if (!interna && RE_EXTERNA.test(tras)) continue;
    // «artículo 1.902 del…», «art. 24 CE», «artículos 35 y 36 de la LPRL», «del III Convenio».
    const trasOrig = t.slice(fin, fin + 40);
    if (!interna && RE_EXTERNA_ORIG.test(trasOrig) && !/^\s*(?:del?\s+)?(?:II|III|IV|VI|VII|VIII|IX|XI|XII)\b(?!\s+Convenio)/.test(trasOrig)) continue;
    if (!interna && RE_EXTERNA_ANTES.test(tn.slice(Math.max(0, m.index - 330), m.index))) continue;
    if (!interna && RE_EXTERNA_LEJOS.test(t.slice(fin, fin + 140).replace(/\n/g, ' ')) && !/^[^.;]{0,90}?\b(?:presente|este|esta)\s+(?:convenio|contrato|acuerdo|acta|documento)/i.test(t.slice(fin, fin + 140).replace(/\n/g, ' ').split(/\b(?:de|del|en el|en la)\s+(?:su|dicha|esta|la|Ley|Reglamento)/)[0])) continue;
    // Un apartado suelto solo cuenta si el texto dice que es de este documento («el apartado 3 de
    // la presente cláusula»): «del apartado 3» a secas suele ser de la norma que se cita.
    // (Salvo «el apartado V» de un informe, que tiene sus rótulos en romanos: se mira abajo si es único.)
    if (familia === 'apartado' && !interna && !/^[ivxl]+$/.test(m[2].trim())) continue;
    // «(El RD 1215/1997 en su artículo 3 apartado 5)»: el apartado de un artículo nombrado justo antes.
    if (familia === 'apartado' && /art[ií]culo\s+\d[\w.]*\s*,?\s*$/i.test(t.slice(Math.max(0, m.index - 25), m.index))) continue;
    // «el apartado 1 del artículo 62 de este Convenio»: la remisión es al artículo 62, que se
    // resuelve aparte; el apartado suelto no es una sección del índice.
    if (familia === 'apartado' && /^\s*,?\s*(?:del|de este|de la|de esta)\s+(?:articulo|clausula|anexo|capitulo)/.test(tras)) continue;
    // «artículos 22 a 25», «hechos primero a octavo»: el rango entero.
    let ids = partirIds(m[2]);
    const rango = m[2].match(new RegExp(`^(${ID_REM})\\s+(?:a|al|hasta(?:\\s+el)?)\\s+(${ID_REM})$`));
    if (rango) {
      const x = Number(claveDeId(rango[1])); const y = Number(claveDeId(rango[2]));
      if (Number.isFinite(x) && Number.isFinite(y) && y > x && y - x <= 40) ids = Array.from({ length: y - x + 1 }, (_, i) => String(x + i));
    }
    const origen = nodoEn(arbol, m.index);
    for (const idTxt of ids) {
      // Letra suelta: solo en mayúscula en el original («Anexo A»).
      let clave;
      if (/^[a-z]$/.test(idTxt) && !/^[ivx]$/.test(idTxt)) {
        const pos = t.slice(m.index, fin).search(new RegExp(`\\b${idTxt.toUpperCase()}\\b`));
        if (pos < 0 || !['anexo', 'apartado'].includes(familia)) continue;
        clave = idTxt;
      } else {
        const idOrig = /^[ivxlc]+$/.test(idTxt) ? idTxt.toUpperCase() : idTxt;
        clave = claveDeId(idOrig, { permitirLetra: false });
      }
      if (!clave) continue;
      let cands = candidatos(arbol, familia, clave);
      // «artículo 30.7.8.2», «24.8.2»: si el índice no baja hasta ahí, al artículo que lo contiene.
      // Solo en documentos que numeran así: en los demás, «artículo 46.1» suele ser del Estatuto.
      const numeraConDecimales = arbol._decimales ?? (arbol._decimales = arbol.nodos.filter((n) => {
        if (n.tipo !== 'numerado' || !/^\d+\.\d/.test(String(n.clave))) return false;
        let x = n.padre ? arbol.nodos.find((y) => y.id === n.padre) : null;
        while (x && !['articulo', 'clausula'].includes(x.tipo)) x = x.padre ? arbol.nodos.find((y) => y.id === x.padre) : null;
        return x && String(n.clave).split('.')[0] === String(x.clave).split(/[ .]/)[0];
      }).length >= 3);
      for (let c = clave; !cands.length && (numeraConDecimales || interna || internaLejos) && /\.\d+$/.test(c) && ['articulo', 'clausula', 'anexo'].includes(familia);) {
        c = c.replace(/\.\d+$/, '');
        cands = candidatos(arbol, familia, c);
      }
      if (familia === 'apartado' && !interna && !(cands.length === 1 && cands[0].tipo === 'romano')) continue;
      // Un anexo que trae su propio articulado (un protocolo, un plan de igualdad) numera aparte:
      // desde dentro, «artículo 8» es el suyo; desde fuera, el del documento.
      const anexoDe = (n) => { let x = n; while (x && x.tipo !== 'anexo') x = x.padre ? arbol.nodos.find((y) => y.id === x.padre) : null; return x; };
      const anexoOrigen = origen ? anexoDe(origen) : null;
      const mismos = cands.filter((c) => anexoDe(c)?.id === anexoOrigen?.id);
      if (!cands.length) continue;
      if (anexoOrigen && !mismos.length && arbol.nodos.some((n) => n.tipo === cands[0].tipo && anexoDe(n)?.id === anexoOrigen.id)) continue;
      if (mismos.length && mismos.length < cands.length) cands = mismos;
      if (!cands.length) continue; // remite a algo que este documento no tiene: externa o desconocida
      // A sí misma («la presente cláusula quinta» dentro de la quinta) no es una remisión.
      const dest = cands.length === 1 ? cands[0] : (cands.find((c) => c.inicio > m.index) ?? cands[0]);
      if (origen && (origen.id === dest.id || estaDentro(arbol, origen, dest))) continue;
      const r = {
        inicio: m.index,
        fin,
        texto: t.slice(m.index, fin),
        familia,
        clave,
        destino: dest.id,
      };
      if (cands.length > 1) r.ambiguo = cands.map((c) => c.id);
      const aviso = avisoDeRemision(t, m.index, dest, arbol, familia, origen);
      if (aviso) r.aviso = aviso;
      out.push(r);
    }
  }
  // «el artículo anterior», «la cláusula siguiente»: la hermana de la sección desde la que se remite.
  const FAM_REL = { articulo: 'articulo', clausula: 'clausula', capitulo: 'capitulo', anexo: 'anexo', hecho: 'ordinal', fundamento: 'ordinal' };
  for (const m of p.matchAll(/\b(?:el|del|al|la|en el|en la)\s+(articulo|clausula|capitulo|anexo|hecho|fundamento)\s+(anterior|precedente|siguiente)\b/g)) {
    const inicio = m.index + m[0].indexOf(m[1]);
    let origen = nodoEn(arbol, inicio);
    const tipo = FAM_REL[m[1]];
    while (origen && origen.tipo !== tipo) origen = origen.padre ? arbol.nodos.find((n) => n.id === origen.padre) : null;
    if (!origen) continue;
    // El anterior en el documento aunque sea de otro capítulo (el primero del capítulo II remite al
    // último del I); los ordinales (hechos, fundamentos), dentro de su bloque.
    const hermanos = arbol.nodos.filter((n) => n.tipo === origen.tipo && (origen.tipo !== 'ordinal' || n.padre === origen.padre));
    const i = hermanos.findIndex((n) => n.id === origen.id);
    const dest = m[2] === 'siguiente' ? hermanos[i + 1] : hermanos[i - 1];
    if (!dest) continue;
    out.push({ inicio, fin: m.index + m[0].length, texto: t.slice(inicio, m.index + m[0].length), familia: m[1], clave: dest.clave, destino: dest.id, relativa: true });
  }
  // «el anexo de pagos», «el capítulo de permisos»: por su título, si casa con una sola sección.
  for (const m of p.matchAll(/\b(?:el|del|al|en el)\s+(anexo|apendice|capitulo)\s+(?:de|sobre|relativo a)\s+(?:los\s+|las\s+|la\s+|el\s+)?([a-zñ]{4,}(?:\s+[a-zñ]{3,}){0,3})/g)) {
    const inicio = m.index + m[0].indexOf(m[1]);
    if (out.some((r) => r.inicio === inicio)) continue;
    const pals = palabras(m[2]);
    if (!pals.length) continue;
    const tipoDesc = m[1] === 'apendice' ? 'anexo' : m[1];
    const cands = arbol.nodos.filter((n) => n.tipo === tipoDesc && solapa(pals, palabras(`${n.titulo} ${n.arranque || ''}`)) > 0);
    if (cands.length !== 1) continue;
    const origen = nodoEn(arbol, inicio);
    if (origen && (origen.id === cands[0].id || estaDentro(arbol, origen, cands[0]))) continue;
    out.push({ inicio, fin: m.index + m[0].length, texto: t.slice(inicio, m.index + m[0].length), familia: m[1], clave: cands[0].clave, destino: cands[0].id, por_titulo: true });
  }
  // «las tablas que figuran en el anexo», «según el anexo del presente convenio»: si el documento
  // tiene UN solo anexo, es ese.
  const anexos = arbol.nodos.filter((n) => n.tipo === 'anexo');
  if (anexos.length === 1) {
    for (const m of p.matchAll(/\b(?:el|al|del|en el|este|dicho|como)\s+(anexo|apendice)\b(?!\s*(?:[ivxlc]+\b|\d|n[uú]m|n\.?\s?º|(?![aeouy]\b)[a-z]\b(?!\w)))/g)) {
      const inicio = m.index + m[0].length - m[1].length;
      const tras = p.slice(inicio + m[1].length, inicio + m[1].length + 70);
      if (!RE_INTERNA.test(tras) && RE_EXTERNA.test(tras)) continue;
      const origen = nodoEn(arbol, inicio);
      if (origen && (origen.id === anexos[0].id || estaDentro(arbol, origen, anexos[0]))) continue;
      if (out.some((r) => r.inicio === inicio)) continue;
      out.push({ inicio, fin: inicio + m[1].length, texto: t.slice(inicio, inicio + m[1].length), familia: 'anexo', clave: anexos[0].clave, destino: anexos[0].id });
    }
    out.sort((a, b) => a.inicio - b.inicio);
  }
  return out;
}

function estaDentro(arbol, nodo, posibleAncestro) {
  const porId = arbol._porId ?? (arbol._porId = new Map(arbol.nodos.map((n) => [n.id, n])));
  let x = nodo;
  while (x?.padre) {
    if (x.padre === posibleAncestro.id) return true;
    x = porId.get(x.padre);
  }
  return false;
}

// La remisión dice de qué trata («la Comisión de Seguimiento prevista en la cláusula sexta») y el
// título del destino no tiene nada que ver, pero otra sección de la misma clase sí: el propio
// texto remite mal. No se corrige —el índice sigue la remisión al pie de la letra—, se avisa.
// Cuánto casa el tema de la remisión con el TÍTULO de una sección (las palabras genéricas de un
// convenio —«trabajo», «personal», «empresa»— no cuentan).
const GENERICAS = new Set(['trabajo', 'trabajador', 'trabajadora', 'trabajadores', 'personas', 'persona', 'personal', 'empresa', 'empresas', 'convenio', 'colectivo', 'presente', 'regimen', 'general', 'generales', 'normas', 'condiciones', 'derechos', 'derecho', 'laboral', 'laborales', 'ambito', 'disposiciones', 'disposicion', 'articulo', 'otros', 'otras']);
function puntuar(tema, titulo) {
  return solapa(tema.filter((w) => !GENERICAS.has(w)), palabras(titulo).filter((w) => !GENERICAS.has(w)));
}

// La remisión dice de qué trata («faltas muy graves (artículo 53)», «la excedencia voluntaria con
// reserva de puesto prevista en el artículo 42») y el título del destino no tiene que ver, pero el de
// otra sección del mismo tipo casa claramente mejor: el propio texto remite mal. No se corrige —el
// índice sigue la remisión al pie de la letra—, se avisa. Estricto a propósito: un aviso de más
// manda a Claude a dudar de una remisión buena.
function avisoDeRemision(texto, inicio, destino, arbol, familia, origen) {
  const temaTxt = temaDe(texto, inicio).trim();
  const tema = palabras(temaTxt).filter((w) => !GENERICAS.has(w));
  if (tema.length < 1 || !destino.titulo) return null;
  const enDestino = puntuar(tema, destino.titulo);
  // Lo que cuenta el arranque del destino también vale: si habla del tema, la remisión es buena.
  const arranque = palabras(texto.slice(destino.inicio, Math.min(destino.finPropio, destino.inicio + 500))).filter((w) => !GENERICAS.has(w));
  if (solapa(tema, arranque) >= 2) return null;
  // La sección desde la que se remite no es la alternativa: es la que está hablando del tema.
  const mismas = arbol.nodos.filter((n) => n.id !== destino.id && n.id !== origen?.id
    && !(origen && estaDentro(arbol, origen, n)) && n.tipo === destino.tipo && (n.familia === destino.familia || familia === 'anexo'));
  let mejor = null;
  let empate = false;
  for (const n of mismas) {
    const sc = puntuar(tema, n.titulo || '');
    if (!mejor || sc > mejor.s) { mejor = { n, s: sc }; empate = false; } else if (sc === mejor.s) empate = true;
  }
  if (!mejor || empate) return null;
  // Una palabra larga y propia («excedencia», «carrera») vale; si no, hacen falta dos.
  const fuerte = !mejor ? false : palabras(mejor.n.titulo || '').some((w) => w.length >= 8 && !GENERICAS.has(w) && tema.some((t) => raiz(t) === raiz(w)));
  void fuerte;
  if (!(mejor.s >= 2 && enDestino === 0)) return null;
  if (mejor.s <= enDestino) return null;
  return {
    dice: destino.id,
    parece: mejor.n.id,
    tema: temaTxt,
    motivo: `La remisión habla de «${temaTxt}», que es el título de ${mejor.n.etiqueta}${mejor.n.titulo ? ` («${mejor.n.titulo}»)` : ''}, no de ${destino.etiqueta}${destino.titulo ? ` («${destino.titulo}»)` : ''}.`,
  };
}

export default { construirArbol, remisiones, plegar, ordinalANumero, romanoANumero, claveDeId, nodoEn };
