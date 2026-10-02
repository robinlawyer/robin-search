// Detectores deterministas: lo que se coge SIN modelo porque lleva dígito de control.
//
// Son la mitad barata del anonimizador. Aquí solo se miden; no tocan el servidor.
//
// Regla de oro de este fichero: si algo tiene dígito de control, se COMPRUEBA. Un detector que
// acepta «12345678A» porque «tiene forma de DNI» produce falsos positivos sobre números de
// expediente, de colegiado y de finca registral, que están por todas partes en un escrito, y cada
// falso positivo es un trozo de escrito tapado de más.

const quitarTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// ───────────────────────────── DNI ─────────────────────────────
const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function letraDniCorrecta(numero, letra) {
  return LETRAS_DNI[Number(numero) % 23] === letra.toUpperCase();
}

// ───────────────────────────── CIF ─────────────────────────────
// Letra de organización + 7 dígitos + control (dígito o letra, según la organización).
const ORG_SOLO_LETRA = 'PQRSNW'; // control siempre letra
const ORG_SOLO_DIGITO = 'ABEH'; // control siempre dígito
const LETRAS_CIF = 'JABCDEFGHI';

export function controlCifCorrecto(letraOrg, digitos, control) {
  let par = 0;
  let impar = 0;
  for (let i = 0; i < 7; i++) {
    const n = Number(digitos[i]);
    if (i % 2 === 0) {
      const x = n * 2;
      impar += Math.floor(x / 10) + (x % 10);
    } else {
      par += n;
    }
  }
  const c = (10 - ((par + impar) % 10)) % 10;
  const org = letraOrg.toUpperCase();
  const ctrl = control.toUpperCase();
  if (ORG_SOLO_LETRA.includes(org)) return ctrl === LETRAS_CIF[c];
  if (ORG_SOLO_DIGITO.includes(org)) return ctrl === String(c);
  return ctrl === String(c) || ctrl === LETRAS_CIF[c];
}

// ───────────────────────────── IBAN ─────────────────────────────
export function ibanCorrecto(iban) {
  const limpio = iban.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(limpio) || limpio.length < 15 || limpio.length > 34) return false;
  const rotado = limpio.slice(4) + limpio.slice(0, 4);
  let resto = 0;
  for (const ch of rotado) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) resto = (resto * 10 + Number(d)) % 97;
  }
  return resto === 1;
}

// ───────────────────────────── Matrícula ─────────────────────────────
// Formato de 2000 en adelante: 4 dígitos + 3 consonantes, sin vocales, sin Ñ ni Q.
const CONSONANTES_MATRICULA = 'BCDFGHJKLMNPRSTVWXYZ';

export function matriculaCorrecta(letras) {
  return [...letras.toUpperCase()].every((c) => CONSONANTES_MATRICULA.includes(c));
}

// ───────────────────────────── Los detectores ─────────────────────────────
//
// Cada uno devuelve [{ tipo, valor, inicio, fin }]. El orden importa: el que corre antes se queda
// con el trozo (un IBAN español empieza por dos letras y 22 dígitos; sin el IBAN primero, el
// detector de teléfono se llevaría un cacho de dentro).

const DETECTORES = [
  {
    tipo: 'IBAN',
    // El grupo final NO admite separador delante. Con `[ -]?[A-Z0-9]{1,4}` al final, en un texto
    // TODO EN MAYÚSCULAS el patrón se comía la palabra siguiente («…4567 EN»), el dígito de control
    // lo rechazaba entero y el IBAN bueno que había dentro no se volvía a intentar: la cuenta del
    // cliente salía en claro. Lo destapó el corpus de validación, en el único fragmento escaneado
    // que llevaba IBAN.
    re: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){2,7}[A-Z0-9]{0,3}\b/g,
    valida: (m) => ibanCorrecto(m[0]) || /^ES\d{2}(?:[ -]?\d{4}){5}$/.test(m[0]),
  },
  {
    tipo: 'CORREO',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    valida: () => true,
  },
  {
    tipo: 'NIE',
    // Por la forma: X/Y/Z + 7 cifras + letra no es ninguna otra cosa en un escrito. Con la letra
    // mal es una errata, y sigue siendo el NIE de alguien.
    re: /\b([XYZ])[ -]?(\d{7})[ -]?([A-Z])\b/g,
    valida: () => true,
  },
  {
    tipo: 'CIF',
    re: /\b([ABCDEFGHJNPQRSUVW])[ -]?(\d{7})[ -]?([0-9A-Ja-j])\b/g,
    valida: (m) => controlCifCorrecto(m[1], m[2], m[3]),
  },
  {
    tipo: 'DNI',
    re: /\b(\d{8})[ -]?([A-Za-z])\b/g,
    // Con la letra bien, siempre. Con la letra mal (errata, OCR), solo con la forma exacta —ocho
    // cifras y una letra mayúscula— y si no es la referencia de un expediente o unos autos.
    valida: (m, texto) => letraDniCorrecta(m[1], m[2]) ||
      (/^[A-Z]$/.test(m[2]) && !/(?:n\.?º|núm\.?|expediente|exp\.|autos|procedimiento|ref\.?|referencia|factura|p[óo]liza|cuenta)\s*:?\s*$/i.test(texto.slice(Math.max(0, m.index - 25), m.index))),
  },
  {
    // Número de afiliación a la Seguridad Social: 2 de provincia + 10. No lleva dígito de control
    // comprobable aquí, así que se exige el separador o la etiqueta delante para no tragarse cifras
    // sueltas de un escrito (importes, números de finca).
    tipo: 'NUSS',
    // El grupo 1 es SOLO el número. La etiqueta que lo anuncia queda fuera del trozo que se tapa:
    // si el alias se comiera «número de afiliación a la Seguridad Social», además de tapar de más
    // chocaría con la guardia —«Seguridad Social» es un organismo y va en claro— y la detección
    // entera se caería. El alias sustituye al dato, nunca a la etiqueta que lo presenta.
    re: /\b(?:(?:NUSS|NAF|N\.?A\.?F\.?|(?:n[úu]mero de )?afiliaci[óo]n (?:a )?(?:la )?Seguridad Social)\s*:?\s*)?((\d{2})[ /-](\d{8,10}))\b/gi,
    grupo: 1,
    valida: (m, texto) => {
      const antes = texto.slice(Math.max(0, m.index - 70), m.index);
      return /NUSS|NAF|N\.?A\.?F|afiliaci/i.test(quitarTildes(antes)) || /NUSS|NAF|afiliaci/i.test(quitarTildes(m[0]));
    },
  },
  {
    // Teléfono extranjero con prefijo: «+44 7700 900412», «+49 40 3861 2274».
    tipo: 'TELEFONO',
    re: /(?<![\w+])\+(?:[1-9]\d{0,2})[ .-]?\d{2,5}(?:[ .-]?\d{2,5}){1,4}(?![\d])/g,
    valida: (m) => {
      const d = m[0].replace(/[^\d]/g, '');
      return d.length >= 9 && d.length <= 15 && !m[0].startsWith('+34');
    },
  },
  {
    // Matrícula provincial antigua: «B-3456-TX», «M 1234 ZZ».
    tipo: 'MATRICULA',
    re: /\b(A|AB|AL|AV|B|BA|BI|BU|C|CA|CC|CE|CO|CR|CS|CU|GC|GE|GI|GR|GU|H|HU|IB|J|L|LE|LO|LU|M|MA|ML|MU|NA|O|OR|OU|P|PM|PO|S|SA|SE|SG|SO|SS|T|TE|TF|TO|V|VA|VI|Z|ZA)[ -](\d{4})[ -]([A-Z]{1,2})\b/g,
    valida: () => true,
  },
  {
    tipo: 'MATRICULA',
    re: /\b(\d{4})[ -]?([A-Za-z]{3})\b/g,
    valida: (m) => matriculaCorrecta(m[2]),
  },
  {
    // Teléfono español: fijo o móvil, 9 dígitos empezando por 6, 7, 8 o 9, con prefijo opcional.
    // Con CUALQUIER agrupación: «688 12 34 56», «91 555 12 34», «944.15.26.37», «600-11-22-33».
    // Solo se admitía 3-3-3 o 3-2-3-… y el corpus escrito a ciegas destapó siete teléfonos de siete
    // en otras agrupaciones: la mitad de como los escribe la gente. Lo que NO es un teléfono: un
    // importe («961.324.567 euros»).
    tipo: 'TELEFONO',
    re: /(?:(?:\+|00)34[ .-]?)?(?<![\d.,/-])[6789](?:[ .-]?\d){8}(?![\d]|[.,]\d)/g,
    valida: (m, texto) => {
      const d = m[0].replace(/[^\d]/g, '').replace(/^(?:00)?34(?=\d{9}$)/, '');
      if (d.length !== 9 || !/^[6789]/.test(d)) return false;
      const despues = texto.slice(m.index + m[0].length, m.index + m[0].length + 12);
      const antes = texto.slice(Math.max(0, m.index - 3), m.index);
      return !/^\s*(?:€|euros?|EUR|ptas?|pesetas)/i.test(despues) && !/€\s*$/.test(antes);
    },
  },
];

// DNI y NIE enmascarados como los publica la Administración (disposición adicional 7.ª LOPDGDD):
// «***4521**», «****3361*». Siguen siendo un dato de la persona, y en una lista de admitidos van
// pegados a su nombre.
const ENMASCARADO = /(?<![\w*])(\*{3}\d{4}\*{2}|\*{4}\d{4}\*|\*{2,5}\d{3,5}\*{1,4})(?![\w*])/g;

// La sombra numérica: en un trozo que es casi todo cifras, la «l», la «I» y la «O» de un OCR malo
// son un 1 y un 0 («73l04588-J», «28794O31-T», «688 4l7 290», «41/l0245678/33»). Mismo largo que
// el texto: las posiciones casan y el valor que se tapa es el ORIGINAL, con su errata.
export function sombraNumerica(texto) {
  const c = texto.split('');
  // Grupos de cifras (con la «l», la «I» o la «O» del OCR dentro), separados por espacio, punto,
  // barra o guion, con una letra opcional delante o detrás: «73l04588-J», «B5O987412»,
  // «41/l0245678/33», «688 4l7 290», «0l9374620».
  const GRUPO = '[0-9lIO]*\\d[0-9lIO]*';
  const re = new RegExp(`(?<![A-Za-z0-9])(?:[A-Z][ -]?)?${GRUPO}(?:[ ./-]${GRUPO})*(?:[ -]?[A-Za-z])?(?![A-Za-z0-9])`, 'g');
  let m;
  while ((m = re.exec(texto)) !== null) {
    const w = m[0];
    const nDig = (w.match(/\d/g) ?? []).length;
    // Cuatro cifras, o tres en algo con forma de código postal («26OO2»).
    if (nDig < 4 && !(nDig >= 3 && /^[0-9lIO]{5}$/.test(w))) continue;
    if (!/[lIO]/.test(w)) continue;
    for (let k = 0; k < w.length; k++) {
      const ch = w[k];
      if (ch !== 'l' && ch !== 'I' && ch !== 'O') continue;
      // Solo dentro de un grupo de cifras: con una cifra (o otra confusión) a algún lado.
      const izq = w[k - 1] ?? '';
      const der = w[k + 1] ?? '';
      if (!/[\dlIO]/.test(izq) && !/[\dlIO]/.test(der)) continue;
      c[m.index + k] = ch === 'O' ? '0' : '1';
    }
  }
  return c.join('');
}

// Identificadores con etiqueta delante: lo que dice la etiqueta manda sobre el dígito de control.
// Un DNI con la letra mal (una errata, un OCR) sigue siendo el DNI de alguien; un número de
// historia clínica, de tarjeta sanitaria, de pasaporte o de afiliación no tiene dígito comprobable
// pero la etiqueta dice lo que es.
const ETIQUETA_ID = new RegExp(
  '(?<![\\p{L}])(?:' +
    'NHC|N\\.?\\s?H\\.?\\s?C\\.?|N\\.?º?\\s*(?:de\\s+)?(?:episodio|historia|HC)|historia\\s+cl[íi]nica|N\\.?\\s*HISTORIA(?:\\s+[A-Z]{2,4})?|CIA|N\\.?º?\\s*(?:de\\s+)?(?:historia|hist\\.)\\s+(?:cl[íi]nica|social|cl\\.)|historia\\s+cl[íi]nica\\s*(?:n\\.?º|n[úu]m\\.?)?|' +
    'CIPA(?:\\s*/\\s*TSI)?|CIP|CIC(?:\\s*\\([^)]{0,40}\\))?|TSI|TIS|SIP|NUHSA|NASS|NUSS|NAF|N\\.?\\s*(?:de\\s+)?afiliaci[óo]n(?:\\s+a\\s+la\\s+Seguridad\\s+Social)?|' +
    'tarjeta\\s+(?:individual\\s+)?sanitaria(?:\\s+[A-Z]{2,4})?(?:\\s+del?\\s+\\p{L}+)?|tarjeta\\s+nacional\\s+de\\s+identidad(?:\\s+electr[óo]nica)?|NIA|N\\.?\\s*petici[óo]n|N\\.?º?\\s*(?:de\\s+)?expediente\\s+(?:interno|social)|' +
    'pasaporte(?:\\s+n\\.?º)?|passport(?:\\s+no\\.?)?|passeport|N\\.?\\s*CNIE|CNIE|N\\.?\\s*ESP|' +
    'DNI\\s*/\\s*NIE|DNI\\s*/\\s*NIF|D\\.?\\s?N\\.?\\s?I\\.?|N\\.?\\s?I\\.?\\s?F\\.?|N\\.?\\s?I\\.?\\s?E\\.?|C\\.?\\s?I\\.?\\s?F\\.?' +
  ')(?![\\p{L}])(?:\\s*\\([^)]{0,40}\\))?(?:\\s+(?:auton[òo]mic|[A-Z]{2,6}))?\\s*(?:n\\.?º|núm\\.?|número)?\\s*[:.]?(?:\\s*\\.{2,})?\\s*' +
  // Un espacio dentro del valor solo si lo que sigue lleva cifras («L 4820193»), no la palabra de
  // después («ADRESSE»).
  '(?=[A-Z0-9./-]*\\d|[A-Z]{1,5}\\s\\d)([A-Z0-9](?:[A-Z0-9]|[./-](?=[A-Z0-9])|\\s(?=[A-Z0-9]*\\d[A-Z0-9]*(?:[\\s./,;-]|$)))*[A-Z0-9])',
  'giu',
);
// La etiqueta también sale del OCR con un 0 por una O («N. AFILIACI0N»).
const sombraEtiqueta = (s) => s.replace(/(?<![\p{N}])[\p{L}0]*\p{L}[\p{L}0]*(?![\p{N}])/gu, (w) => ((w.match(/\p{L}/gu) ?? []).length >= 3 && w.includes('0') ? w.replace(/0/g, 'O') : w));
function etiquetados(texto, sombra) {
  const fuera = [];
  ETIQUETA_ID.lastIndex = 0;
  let m;
  const heno = sombraEtiqueta(sombra);
  while ((m = ETIQUETA_ID.exec(heno)) !== null) {
    const v = m[1];
    // Con la bandera «i» el valor podría ser una palabra: un identificador no lleva minúsculas.
    if (/[a-z]/.test(v)) continue;
    const i = m.index + m[0].length - v.length;
    // Que tenga pinta de identificador: al menos 4 cifras, y no una fecha ni un importe.
    if ((v.match(/\d/g) ?? []).length < 4) continue;
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(v)) continue;
    const et = m[0].slice(0, m[0].length - v.length);
    // El tipo, por lo que dice la etiqueta y la forma del valor. Un pasaporte o una tarjeta de
    // identidad extranjera es un documento de identidad: sale como DNI (un «[NUSS_1]» le diría a
    // Claude que es la Seguridad Social).
    const tipo = /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v) && /N\.?\s?I\.?\s?F|C\.?\s?I\.?\s?F/i.test(et) ? 'CIF'
      : /^[XYZ][\s-]?\d{7}[\s-]?[A-Z]$/.test(v) ? 'NIE'
        : /DNI|D\.?\s?N\.?\s?I|N\.?\s?I\.?\s?F|pasaporte|passport|passeport|CNIE|identidad|N\.?\s*ESP/i.test(et) ? 'DNI'
          : /C\.?\s?I\.?\s?F/i.test(et) ? 'CIF' : 'NUSS';
    fuera.push({ tipo, valor: texto.slice(i, i + v.length), inicio: i, fin: i + v.length });
  }
  return fuera;
}

export function detectarDeterministas(textoOriginal) {
  const texto = sombraNumerica(textoOriginal);
  const fuera = [];
  const ocupado = new Array(texto.length).fill(false);
  for (const d of etiquetados(textoOriginal, texto)) {
    for (let i = d.inicio; i < d.fin; i++) ocupado[i] = true;
    fuera.push(d);
  }
  for (const det of DETECTORES) {
    det.re.lastIndex = 0;
    let m;
    while ((m = det.re.exec(texto)) !== null) {
      // `grupo` recorta el trozo al dato en sí, dejando fuera la etiqueta que lo anuncia.
      let inicio = m.index;
      let fin = m.index + m[0].length;
      if (det.grupo && m[det.grupo]) {
        const rel = m[0].indexOf(m[det.grupo]);
        if (rel >= 0) { inicio = m.index + rel; fin = inicio + m[det.grupo].length; }
      }
      // Un trozo ya reclamado por un detector anterior no se vuelve a partir.
      let libre = true;
      for (let i = inicio; i < fin; i++) if (ocupado[i]) { libre = false; break; }
      if (!libre) continue;
      let ok = false;
      try {
        ok = det.valida(m, texto);
      } catch {
        ok = false;
      }
      if (!ok) {
        // Un trozo rechazado por el dígito de control no debe dejar «quemado» lo que viene detrás:
        // se retrocede el cursor para que un identificador válido que empiece dentro de este mismo
        // trozo siga teniendo su oportunidad.
        det.re.lastIndex = m.index + 1;
        continue;
      }
      for (let i = inicio; i < fin; i++) ocupado[i] = true;
      fuera.push({ tipo: det.tipo, valor: textoOriginal.slice(inicio, fin), inicio, fin });
    }
  }
  // La zona legible por máquina de un pasaporte o una tarjeta: «P<MAREL<AMRANI<<FATIMA<ZAHRA<<<…».
  // Lleva el nombre, el número y la fecha de nacimiento: se tapa entera.
  // El pasaporte dicho con palabras por medio: «pasaporte del interesado (n.º TK8820164)»,
  // «pasaporte marroquí TK8820164».
  for (const z of texto.matchAll(/(?:pasaporte|passport|passeport)(?:[^\n;.]|\.(?=\S)){0,40}?(?<![\p{L}\p{N}])([A-Z]{1,3}\d{6,9})(?![\p{L}\p{N}])/giu)) {
    const ini = z.index + z[0].length - z[1].length;
    let libre = true;
    for (let i = ini; i < ini + z[1].length; i++) if (ocupado[i]) { libre = false; break; }
    if (!libre || /[a-z]/.test(z[1])) continue;
    for (let i = ini; i < ini + z[1].length; i++) ocupado[i] = true;
    fuera.push({ tipo: 'DNI', valor: textoOriginal.slice(ini, ini + z[1].length), inicio: ini, fin: ini + z[1].length });
  }
  for (const z of texto.matchAll(/[A-Z0-9]{1,}<[A-Z0-9<]{8,}/g)) {
    let libre = true;
    for (let i = z.index; i < z.index + z[0].length; i++) if (ocupado[i]) { libre = false; break; }
    if (!libre) continue;
    for (let i = z.index; i < z.index + z[0].length; i++) ocupado[i] = true;
    fuera.push({ tipo: 'DNI', valor: textoOriginal.slice(z.index, z.index + z[0].length), inicio: z.index, fin: z.index + z[0].length });
  }
  ENMASCARADO.lastIndex = 0;
  let e;
  while ((e = ENMASCARADO.exec(texto)) !== null) {
    const valor = e[1];
    fuera.push({ tipo: /^\*{4}\d{4}\*$/.test(valor) ? 'NIE' : 'DNI', valor, inicio: e.index, fin: e.index + valor.length });
  }
  return fuera.sort((a, b) => a.inicio - b.inicio);
}

export default detectarDeterministas;
