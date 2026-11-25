// PDFs cuya fuente no trae tabla de caracteres (sin cmap ni ToUnicode): pdfjs devuelve el NÚMERO
// DE GLIFO en vez de la letra, y con el orden estándar de Apple (TrueType 'post' formato 1) eso
// deja el texto corrido 29 posiciones: «de las tierras» sale «GH ODV WLHUUDV», la «á» sale «i» y la
// «ó» sale «y». Caso real (4-nov-2026, un expediente de obra): decenas de páginas así. Ese texto no
// se puede buscar, y lo peor: un nombre metido ahí no lo ve el anonimizador, pero cualquiera lo
// descifra. Aquí se detecta por fuente (el texto «descifrado» tiene que parecer español y el
// original no) y se devuelve la letra.

// Glifos 98-257 del orden estándar de Macintosh (los 3-97 son el ASCII 32-126).
const MAC_ALTOS = [
  'Ä', 'Å', 'Ç', 'É', 'Ñ', 'Ö', 'Ü', 'á', 'à', 'â', 'ä', 'ã', 'å', 'ç', 'é', 'è', 'ê', 'ë', 'í', 'ì', 'î', 'ï',
  'ñ', 'ó', 'ò', 'ô', 'ö', 'õ', 'ú', 'ù', 'û', 'ü', '†', '°', '¢', '£', '§', '•', '¶', 'ß', '®', '©', '™', '´',
  '¨', '≠', 'Æ', 'Ø', '∞', '±', '≤', '≥', '¥', 'µ', '∂', '∑', '∏', 'π', '∫', 'ª', 'º', 'Ω', 'æ', 'ø', '¿', '¡',
  '¬', '√', 'ƒ', '≈', '∆', '«', '»', '…', ' ', 'À', 'Ã', 'Õ', 'Œ', 'œ', '–', '—', '“', '”', '‘', '’', '÷', '◊',
  'ÿ', 'Ÿ', '⁄', '¤', '‹', '›', 'fi', 'fl', '‡', '·', '‚', '„', '‰', 'Â', 'Ê', 'Á', 'Ë', 'È', 'Í', 'Î', 'Ï', 'Ì',
  'Ó', 'Ô', '', 'Ò', 'Ú', 'Û', 'Ù', 'ı', 'ˆ', '˜', '¯', '˘', '˙', '˚', '¸', '˝', '˛', 'ˇ', 'Ł', 'ł', 'Š', 'š',
  'Ž', 'ž', '¦', 'Ð', 'ð', 'Ý', 'ý', 'Þ', 'þ', '−', '×', '¹', '²', '³', '½', '¼', '¾', '₣', 'Ğ', 'ğ', 'İ', 'Ş',
  'ş', 'Ć', 'ć', 'Č', 'č', 'đ',
];

export function descifrarGlifos(s) {
  let r = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    // El espacio y el salto que mete pdfjs entre trozos se quedan (el glifo 32 sería «=»: se pierde).
    if (ch === ' ' || ch === '\n' || ch === '\t') r += ch;
    else if (c >= 3 && c <= 97) r += String.fromCharCode(c + 29);
    else if (c >= 98 && c <= 257) r += MAC_ALTOS[c - 98];
    else r += ch;
  }
  return r;
}

const CORTAS = new Set(['de', 'la', 'el', 'en', 'que', 'los', 'las', 'por', 'con', 'para', 'del', 'se', 'un', 'una', 'y', 'a', 'al', 'es', 'no', 'lo', 'su', 'o']);
function pareceEspanol(s) {
  let n = 0;
  for (const w of s.toLowerCase().split(/[^\p{L}]+/u)) if (CORTAS.has(w)) n++;
  return n;
}

// items: los de page.getTextContent(). Devuelve los mismos, con el texto de las fuentes cifradas
// ya descifrado. Se decide por fuente y con todo el texto de esa fuente en la página.
export function descifrarItemsPorFuente(items) {
  const porFuente = new Map();
  for (const it of items) {
    if (typeof it.str !== 'string' || !it.str) continue;
    const k = it.fontName ?? '';
    porFuente.set(k, (porFuente.get(k) ?? '') + ' ' + it.str);
  }
  const cifradas = new Set();
  for (const [k, txt] of porFuente) {
    const antes = pareceEspanol(txt);
    const despues = pareceEspanol(descifrarGlifos(txt));
    // Muchas palabras cortas del español al descifrar, y muchas más que sin descifrar.
    if (despues >= 3 && despues >= 4 * Math.max(1, antes)) cifradas.add(k);
  }
  if (!cifradas.size) return items;
  return items.map((it) => (typeof it.str === 'string' && cifradas.has(it.fontName ?? '') ? { ...it, str: descifrarGlifos(it.str) } : it));
}
