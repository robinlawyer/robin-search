import { NOMBRES_DE_PILA, AMBIGUOS, APELLIDOS_CHINOS } from './nombres-de-pila.mjs';

// Utilidades de texto que comparten las capas.
//
// Viven aquí y no en ner.mjs a propósito: la v1 sale SIN modelo (decisión de Juan del 26-sep), y el
// filtro no puede arrastrar el módulo del reconocedor —ni la librería que ese módulo carga— solo
// para plegar tildes.

// Copia en minúsculas y sin tildes que conserva las posiciones: un carácter de entrada, uno de
// salida. NFD descompone y nos quedamos con la base, así que la longitud no cambia.
// Plegado rápido y que CONSERVA la longitud. Los caracteres ASCII van por el atajo; los demás se
// pliegan una vez y se recuerdan. Y si plegar un carácter cambiaría su longitud —un emoji o
// cualquier carácter astral (dos unidades), o la «İ» turca, que en minúscula son dos—, se deja tal
// cual: antes la copia plegada salía más corta y TODAS las posiciones de detrás se descuadraban, así
// que en un WhatsApp transcrito con emojis se habría tapado el trozo equivocado.
const PLIEGUE = new Map();
function plegarCaracter(ch) {
  let r = PLIEGUE.get(ch);
  if (r === undefined) {
    r = (ch.normalize('NFD')[0] ?? ch).toLowerCase();
    if (r.length !== ch.length) r = ch.length === 1 ? ch.toLowerCase().slice(0, 1) || ch : ch;
    if (r.length !== ch.length) r = ch;
    PLIEGUE.set(ch, r);
  }
  return r;
}

export function plegar(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 128) out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : ch;
    else out += plegarCaracter(ch);
  }
  return out;
}

// ───────────────────── Un nombre va en mayúscula ─────────────────────
//
// La propagación compara plegando mayúsculas y tildes, para que «JUAN PEREZ GOMEZ» de un escaneo
// case con «Juan Pérez Gómez». Pero eso hacía casar también las palabras corrientes que son
// nombres o apellidos: en un expediente con una «Amparo Vidal Sagrera», el «al amparo de la Ley
// 12/2009» se tapaba como si fuera ella, y al revertir el borrador decía «al Amparo Vidal Sagrera
// de la Ley». Lo mismo con «la mora del deudor» y un Mora, o «las fuentes del derecho» y un
// Fuentes. Un nombre se escribe con mayúscula; cada palabra de la mención, salvo las partículas,
// tiene que empezar por una.
const PARTICULAS_MINUS = new Set(['de', 'del', 'la', 'las', 'los', 'i', 'da', 'dos', 'van', 'von', 'y']);

export function vaEnMayuscula(mencion) {
  const palabras = mencion.split(/\s+/).filter(Boolean);
  return palabras.length > 0 && palabras.every((w) => PARTICULAS_MINUS.has(w) || /^[\p{Lu}]/u.test(w));
}

// ───────────────────── El nombre del que un apellido conocido es solo un trozo ─────────────────────
//
// La propagación busca los apellidos de las personas ya vistas. Pero un apellido conocido puede ir
// dentro del nombre de OTRA persona: en un convenio regulador, «Zamarreño» es del padre y
// «Alcaine» de la madre, y «Daniel Zamarreño Alcaine» es el hijo. Tapar solo los dos apellidos
// dejaba «Daniel» en claro y convertía al niño en «Daniel [PADRE] [MADRE]»: un nombre de pila
// fuera y dos identidades fundidas en una. Si el apellido va pegado a otras palabras de nombre, la
// detección se estira hasta cubrirlas, y lo que sale es una persona nueva.

const NO_ES_PIEZA_DE_NOMBRE = new Set(
  [
    // Palabras funcionales que empiezan frase con mayúscula.
    'EL', 'LA', 'LOS', 'LAS', 'UN', 'UNA', 'UNOS', 'UNAS', 'LO', 'AL', 'DEL', 'DE', 'Y', 'E', 'O', 'U',
    'QUE', 'EN', 'POR', 'PARA', 'CON', 'SIN', 'SEGUN', 'ANTE', 'TRAS', 'SI', 'NO', 'SE', 'SU', 'SUS',
    'MI', 'ESTE', 'ESTA', 'ESTOS', 'ESTAS', 'ESE', 'ESA', 'DICHO', 'DICHA', 'AMBOS', 'AMBAS', 'CUANDO',
    'COMO', 'DONDE', 'PERO', 'AUNQUE', 'PUES', 'ASI', 'YA', 'TAMBIEN', 'NI', 'A', 'HA', 'HAN', 'ES',
    // Tratamientos, que no son el nombre aunque vayan delante.
    'SENOR', 'SENORA', 'SR', 'SRA', 'DON', 'DONA', 'D', 'DNA',
    // Verbos y rótulos del escrito que abren frase delante de un apellido.
    'INTERROGADO', 'INTERROGADA', 'PREGUNTADO', 'PREGUNTADA', 'COMPARECE', 'COMPARECEN', 'MANIFIESTA',
    'DECLARA', 'CONSTA', 'RESULTA', 'VISTOS', 'VISTO', 'HECHOS', 'FUNDAMENTOS', 'FALLO', 'SUPLICO',
    'OTROSI', 'DICE', 'EXPONE', 'SOLICITA', 'ALEGA', 'FIRMAN', 'FIRMA', 'RECONOCE', 'RATIFICA',
    'PRIMERO', 'SEGUNDO', 'TERCERO', 'CUARTO', 'QUINTO', 'SEXTO', 'SEPTIMO', 'OCTAVO', 'NOVENO',
    'DECIMO', 'PRIMERA', 'SEGUNDA', 'TERCERA', 'CUARTA', 'QUINTA', 'ANEXO', 'ASUNTO', 'NOTA',
    'ACTOR', 'ACTORA', 'DEMANDANTE', 'DEMANDADO', 'DEMANDADA', 'TESTIGO', 'PERITO', 'LETRADO', 'DENUNCIANTE',
    'DENUNCIADO', 'DENUNCIADA', 'PERJUDICADO', 'PERJUDICADA', 'INVESTIGADO', 'INVESTIGADA', 'DETENIDO', 'DETENIDA',
    'VICTIMA', 'CONDUCTOR', 'AGENTE', 'INSTRUCTOR', 'SECRETARIO', 'REQUERIDO', 'REQUERIDA', 'SOLICITANTE', 'OS', 'NOS',
    'OYE', 'GRACIAS', 'BUENAS', 'HOLA', 'SOY', 'TE', 'ME', 'LE', 'LES', 'SI', 'SÍ', 'VALE', 'OK', 'CONTRARIO', 'CONTRARIA',
    'KAIXO', 'HOLA', 'ESTIMADO', 'ESTIMADA', 'QUERIDO', 'QUERIDA', 'EGUN', 'BON', 'BONA', 'BOS', 'BOAS', 'HELLO', 'DEAR', 'HI',
    'OTRA', 'OTRO', 'OTRAS', 'OTROS', 'FDO', 'FIRMADO', 'CONFORME', 'RECIBI', 'PROCEDIMIENTO', 'TUTELA', 'CURATELA',
    'GUARDA', 'CUSTODIA', 'HERENCIA', 'DEMANDA', 'RECURSO', 'SENTENCIA', 'AUTO', 'RESOLUCION', 'DECLARACION',
    'DESAMPARO', 'EXPEDIENTE', 'VISTA', 'VISTO', 'VISTOS', 'ACUERDO', 'ACUERDA', 'NOTIFICACION', 'TITULAR', 'MOTIVO',
    'CARNE', 'PROFESIONAL', 'NUMERO', 'NUM', 'TIP', 'PLACA', 'ENCARGADO', 'ENCARGADA', 'JEFE', 'JEFA', 'GERENTE', 'EMPLEADO',
    'EMPLEADA', 'INSPECTOR', 'INSPECTORA', 'SUBINSPECTOR', 'CONCURSAL', 'PRESIDENTE', 'PRESIDENTA', 'VOCAL', 'SOCIO', 'SOCIA',
    'LETRADA', 'PROCURADOR', 'PROCURADORA', 'HERMANO', 'HERMANA', 'HIJO', 'HIJA', 'PADRE', 'MADRE',
    // Piezas de institución: si el apellido va pegado a una de estas, no es un nombre más largo.
    'JUZGADO', 'TRIBUNAL', 'AUDIENCIA', 'SALA', 'SECCION', 'MINISTERIO', 'AYUNTAMIENTO', 'REGISTRO',
    'COLEGIO', 'HOSPITAL', 'SERVICIO', 'INSTITUTO', 'CONSEJERIA', 'DIRECCION', 'AGENCIA', 'BANCO',
    'CALLE', 'AVENIDA', 'PLAZA', 'PASEO', 'ABOGADOS', 'ASESORES', 'SL', 'SA', 'SLU', 'SAU', 'CB',
    'HERMANOS', 'HNOS', 'GRUPO', 'SOCIEDAD', 'FUNDACION', 'ASOCIACION', 'COOPERATIVA',
  ],
);

const PARTICULA_NOMBRE = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'I', 'DA', 'DOS', 'VAN', 'VON']);

const CLAVES = new Map();
const clavePieza = (p) => {
  let r = CLAVES.get(p);
  if (r === undefined) {
    r = p.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[.,;:]+$/, '');
    if (CLAVES.size > 50000) CLAVES.clear();
    CLAVES.set(p, r);
  }
  return r;
};

// ¿Empieza aquí una frase? Principio del texto, salto de línea, o signo de cierre de frase.
const empiezaFrase = (texto, i) => /(?:^|[\n.!?;:]\s*|[—–-]\s*)$/.test(texto.slice(Math.max(0, i - 4), i));

const PIEZA = /(?:[\p{Lu}][\p{Ll}'’]+(?:-[\p{Lu}][\p{Ll}'’]+)*|[\p{Lu}]{2,}(?:-[\p{Lu}]{2,})*)/u;

const PIEZA_ENTERA = new RegExp(`^(?:${PIEZA.source})$`, 'u');

function esPieza(palabra, { alPrincipioDeFrase }) {
  if (!PIEZA_ENTERA.test(palabra)) return false;
  const k = clavePieza(palabra);
  if (NO_ES_PIEZA_DE_NOMBRE.has(k)) return false;
  // Una palabra de institución o de empresa no alarga un nombre: «TALLERES BELTRÁN E HIJOS» no es
  // una persona que se llame «de TALLERES BELTRÁN».
  if (INSTITUCION.has(k) && !alPrincipioDeFrase) return false;
  // Un participio o un adverbio que abre la frase («Interrogado», «Finalmente») no es un nombre.
  // Solo al principio: «Delgado» o «Machado» detrás de otro apellido sí lo son.
  if (alPrincipioDeFrase && /(?:ADO|ADA|IDO|IDA|ADOS|ADAS|IDOS|IDAS|ANDO|IENDO|MENTE|CION)$/.test(k)) return false;
  return true;
}

// Estira [inicio, fin) por los dos lados mientras haya piezas de nombre separadas por un espacio
// (con partículas en medio: «María de la Fuente»). Devuelve el tramo, igual si no hay nada que
// estirar.
export function extenderNombre(texto, inicio, fin) {
  let i = inicio;
  // Quien escribe en un chat («Vicent: …») empieza un mensaje: lo de delante es el final del
  // mensaje anterior («…sabes Pau»), no su nombre de pila.
  const esRemitente = /^\s*:/.test(texto.slice(fin, fin + 2));
  for (;!esRemitente;) {
    const antes = texto.slice(Math.max(0, i - 60), i);
    const m = antes.match(/((?:(?:de|del|de la|de los|de las|i|da|dos|van|von|DE|DEL|DE LA|I) )*)([\p{L}'’-]+) $/u);
    if (!m) break;
    const palabra = m[2];
    const iPalabra = i - m[0].length;
    if (/:\s*$/.test(texto.slice(iPalabra, i))) break;
    if (!esPieza(palabra, { alPrincipioDeFrase: empiezaFrase(texto, iPalabra) })) break;
    i = iPalabra;
  }
  let f = fin;
  for (;;) {
    const despues = texto.slice(f, f + 60);
    const m = despues.match(/^ ((?:(?:de|del|de la|de los|de las|i|da|dos|van|von|DE|DEL|DE LA|I) )*)([\p{L}'’-]+)/u);
    if (!m) break;
    if (!esPieza(m[2], { alPrincipioDeFrase: false })) break;
    // Una palabra seguida de «:» es quien escribe el mensaje siguiente de un chat («…dice Pau Vicent:
    // …», aplanado) o el rótulo de un campo («Pau Bellver Ferrer Data: …»): ahí empieza otra cosa.
    if (/^\s*:/.test(texto.slice(f + m[0].length, f + m[0].length + 2))) break;
    f += m[0].length;
  }
  // Una partícula no puede quedar colgando en los bordes (no la hay: solo se cruzan si detrás
  // viene una pieza), pero sí puede quedar una pieza única de 1 letra que no es nombre.
  return { inicio: i, fin: f, estirado: i !== inicio || f !== fin };
}

// ───────────────────── El nombre completo que aparece sin presentar ─────────────────────
//
// «Me llamó ayer Sonia Belmonte Tirado», «Avisa a Macarena Ordóñez Pelayo, que es la testigo».
// Es el caso por el que se midieron los modelos, y el único dato que el mejor de ellos ponía sobre
// las reglas. La v1 sale sin modelo, y esto lo cubre con una regla: un nombre completo español son
// tres piezas capitalizadas seguidas (nombre y dos apellidos), y a MITAD de frase, sin ser
// institución ni palabra funcional, eso es casi siempre una persona. Solo en texto con minúsculas:
// en un escaneo todo va en mayúsculas y la capitalización ya no dice nada.
const PIEZA_TITULO = /[\p{Lu}][\p{Ll}'’]+(?:-[\p{Lu}][\p{Ll}'’]+)*/u;

const RE_PIEZA_TITULO_G = new RegExp(PIEZA_TITULO.source, 'gu');
const RE_NSP = new RegExp(`(?<![\\p{L}\\p{N}.])${PIEZA_TITULO.source}(?:\\s+(?:(?:de|del|de la|de los|i|y) )?${PIEZA_TITULO.source})+`, 'gu');
export function nombresSinPresentar(texto) {
  const fuera = [];
  // Tramos de piezas capitalizadas (con partículas). Dentro de cada tramo se buscan las RACHAS de
  // tres o más piezas válidas: «Para: Marta Cordero Rey Asunto: …» es un tramo de cuatro, y antes
  // se tiraba entero por la cuarta («Asunto») en vez de quedarse con las tres buenas.
  const re = RE_NSP;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const tramo = m[0];
    const piezas = [...tramo.matchAll(RE_PIEZA_TITULO_G)].map((x) => ({ p: x[0], i: m.index + x.index }));
    let racha = [];
    const cerrar = () => {
      // Una «y» entre dos piezas de la racha la parte: «Juan y Pedro Gómez» no es uno.
      if (racha.length >= 3) {
        const ini = racha[0].i;
        const fin = racha[racha.length - 1].i + racha[racha.length - 1].p.length;
        const valor = texto.slice(ini, fin);
        if (!/\sy\s/.test(valor)) fuera.push({ tipo: 'PERSONA', valor, inicio: ini, fin, via: 'contexto:nombre-completo' });
      }
      racha = [];
    };
    for (let k = 0; k < piezas.length; k++) {
      const { p, i } = piezas[k];
      const alPrincipio = racha.length === 0 && empiezaFrase(texto, i);
      const valida = esPieza(p, { alPrincipioDeFrase: alPrincipio }) && !INSTITUCION.has(clavePieza(p));
      if (!valida) { cerrar(); continue; }
      if (racha.length) {
        const entre = texto.slice(racha[racha.length - 1].i + racha[racha.length - 1].p.length, i);
        if (!/^\s+(?:(?:de|del|de la|de los|i) )?$/.test(entre)) cerrar();
        // «… i Montserrat …»: la «i» delante de un nombre de pila separa a dos personas.
        else if (/^\s+i\s+$/.test(entre) && esNombreDePila(p)) cerrar();
      }
      racha.push({ p, i });
    }
    cerrar();
  }
  return fuera;
}

// ───────────────────── Los apellidos que hacen de sujeto ─────────────────────
//
// «Urdiales Cotrina acreditó la cotización…», «Robles Camuñas interesó la ampliación…». Así se
// nombra a las partes en un escrito a partir de la segunda mención, y si el nombre completo no ha
// salido antes en ninguna respuesta del expediente, la propagación no tiene de dónde tirar y los
// dos apellidos salían en claro. Lo que los delata es la sintaxis: dos piezas capitalizadas que
// no son institución ni lugar, seguidas del VERBO del que son sujeto.
const VERBO_CONJUGADO = /^(?:[a-záéíóúñ]{2,}(?:ó|ió|aron|ieron|aba|aban|ía|ían|ará|erá|irá|arán|erán|irán|a|an|e|en))$/u;
const NO_VERBO = new Set(['de', 'la', 'el', 'en', 'y', 'a', 'que', 'se', 'para', 'con', 'por', 'una', 'sobre', 'entre',
  'ante', 'como', 'esta', 'esa', 'cada', 'toda', 'otra', 'dicha', 'donde', 'desde', 'hasta', 'contra', 'mediante',
  'durante', 'nombre', 'parte', 'fecha', 'calle', 'plaza', 'suma', 'cuenta', 'causa', 'firma', 'forma', 'norma',
  'demanda', 'vista', 'sede', 'clase', 'base', 'fase', 'orden', 'origen', 'número', 'numero', 'capital', 'mayor', 'menor']);

const RE_AS = new RegExp(`(?<![\\p{L}\\p{N}.])(${PIEZA_TITULO.source}[ \\t]+${PIEZA_TITULO.source})[ \\t]+([\\p{Ll}]+)`, 'gu');
export function apellidosSujeto(texto) {
  const fuera = [];
  // Sin cruzar un salto de línea (el nombre de un órgano y el rótulo de debajo no son una persona) y
  // sin lugares: «Bilbao / Prozedura arrunta» no es nadie.
  const re = RE_AS;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const verbo = m[2];
    if (NO_VERBO.has(verbo) || !VERBO_CONJUGADO.test(verbo)) { re.lastIndex = m.index + 1; continue; }
    const piezas = m[1].split(/\s+/);
    const alPrincipio = empiezaFrase(texto, m.index);
    const ok = piezas.every((p, k) => esPieza(p, { alPrincipioDeFrase: k === 0 && alPrincipio }) && !INSTITUCION.has(clavePieza(p)) && !LUGARES.has(clavePieza(p)));
    if (!ok) { re.lastIndex = m.index + 1; continue; }
    fuera.push({ tipo: 'PERSONA', valor: m[1], inicio: m.index, fin: m.index + m[1].length, via: 'contexto:apellidos-sujeto' });
  }
  return fuera;
}


// ───────────────────── Con el léxico de nombres de pila ─────────────────────
//
// Ver nombres-de-pila.mjs. Todo lo de aquí exige MAYÚSCULA inicial (un nombre se escribe así).

export const esNombreDePila = (p) => p.split('-').every((x) => NOMBRES_DE_PILA.has(clavePieza(x)));
const esAmbiguo = (p) => AMBIGUOS.has(clavePieza(p));

// Lugares que abren frase o van solos con mayúscula y no son personas. Para las reglas que miran
// UNA sola pieza (el apellido suelto de un correo, el apellido con guion).
export const LUGARES = new Set(`
MADRID BARCELONA VALENCIA SEVILLA ZARAGOZA MALAGA MURCIA PALMA BILBAO ALICANTE CORDOBA VALLADOLID VIGO GIJON GRANADA
OVIEDO BADALONA CARTAGENA TERRASSA JEREZ SABADELL MOSTOLES SANTANDER BURGOS PAMPLONA ALMERIA CASTELLON ALBACETE LOGROÑO
LOGRONO BADAJOZ SALAMANCA HUELVA MARBELLA LEON TARRAGONA CADIZ LLEIDA JAEN OURENSE GIRONA LUGO CACERES GUADALAJARA TOLEDO
PONTEVEDRA PALENCIA ZAMORA AVILA CUENCA HUESCA SEGOVIA SORIA TERUEL MELILLA CEUTA DONOSTIA VITORIA GASTEIZ IRUN GETXO
BARAKALDO ELCHE ALCALA GETAFE LEGANES FUENLABRADA ALCORCON REUS HOSPITALET MATARO SANTIAGO CORUÑA CORUNA FERROL
EUROPA ESPAÑA ESPANA FRANCIA PORTUGAL ITALIA ALEMANIA MARRUECOS RUMANIA COLOMBIA ECUADOR PERU VENEZUELA ARGENTINA
SENEGAL NIGERIA CHINA CHIPRE LONDRES PARIS BRUSELAS LUXEMBURGO ESTRASBURGO ANDALUCIA CATALUÑA CATALUNYA CATALUNA GALICIA
ASTURIAS CANTABRIA NAVARRA ARAGON EXTREMADURA EUSKADI BIZKAIA GIPUZKOA ARABA ALAVA VIZCAYA GUIPUZCOA CANARIAS BALEARES
RIOJA MENORCA MALLORCA IBIZA TENERIFE LANZAROTE FUERTEVENTURA ALMAZAN ALCOBENDAS MARBELLA PATERNA BANYOLES GALDAKAO
HERNANI VALDEMORILLO VITORIA-GASTEIZ CASTILLA-LA
`.split(/\s+/).filter(Boolean));

// Lo que va delante de un nombre de pila y dice que es otra cosa: una advocación, una calle, un
// hospital, un premio. «Hospital Virgen del Rocío», «calle del Carme», «Premio Rosalía de Castro».
const ANTES_NO_PERSONA = /(?:\b(?:al|del|Jutjat\s+de|Juzgado\s+de|HOSPITAL|Hospital\s+Universitario|HOSPITAL\s+UNIVERSITARIO|C\.S\.|Centro\s+de\s+Salud|CENTRO\s+DE\s+SALUD|San|Santa|Santo|Sant|SAN|SANTA|SANTO|SANT|Sta\.|Virgen|VIRGEN|Beato|Beata|Nuestra\s+Señora|Hospital|Colegio|Instituto|Fundaci[óo]n|Premio|Reina|Rey|Pr[íi]ncipe|Princesa|Infanta|Infante|Papa|Calle|Avenida|Plaza|Paseo|Carrer|R[úu]a|Barrio|Parroquia|Iglesia|Hermandad|Cofrad[íi]a|Residencia|Centro|Club|Teatro|Museo|Estadio|Parque|Puerto|Plaça|Passeig|Avinguda|Kalea|calle|avenida|plaza|paseo|carrer|r[úu]a|c\/)(?:\s+(?:de|del|de\s+la|de\s+los|dels|d'))?\s*)$/u;

// Entre paréntesis de grupo: sin ellos, al incrustarla detrás de otra cosa («\\s+${…}») la
// alternativa quedaba suelta —«\\s+A|B»— y la segunda casaba sin espacio delante, partiendo «CHEN» en
// «CH» + «EN».
const PIEZA_O_MAYUS = /(?:[\p{Lu}][\p{Ll}'’]+(?:-[\p{Lu}][\p{Ll}'’]+)*|[\p{Lu}]{2,}(?:-[\p{Lu}]{2,})*)/u;
const CABEZAS_NO_APELLIDO = new Set(['JUZGADO', 'TRIBUNAL', 'HOSPITAL', 'MINISTERIO', 'CONSEJERIA', 'AYUNTAMIENTO',
  'UNIVERSIDAD', 'COLEGIO', 'REGISTRO', 'INSTITUTO', 'SERVICIO', 'CALLE', 'AVENIDA', 'PLAZA', 'PASEO', 'AUDIENCIA',
  'SALA', 'SECCION', 'FISCALIA', 'AGENCIA', 'DIRECCION', 'DEPARTAMENTO', 'OFICINA', 'UNIDAD', 'EQUIPO', 'CENTRO',
  'EMPRESA', 'SOCIEDAD', 'GRUPO', 'ASOCIACION', 'FUNDACION', 'CLUB', 'BANCO', 'CAJA', 'SEGUROS', 'MUTUA', 'DE', 'DEL', 'LA',
  'LOS', 'LAS', 'EL', 'Y', 'E', 'EN', 'CON', 'POR', 'PARA', 'QUE', 'SIN', 'SOBRE', 'ANTE', 'CONTRA', 'SEGUN', 'ASUNTO',
  'PARA', 'DE', 'CC', 'ENVIADO', 'FECHA', 'TEL', 'TFNO', 'MOVIL', 'DNI', 'NIE', 'NIF', 'CIF', 'IBAN', 'SL', 'SA', 'SLU']);

// Detrás de «de la», «del»: solo cortan las palabras FUNCIONALES y los tratamientos. «de la Calle»,
// «de la Torre», «del Castillo» son apellidos.
const FUNCIONALES = new Set(['EL', 'LA', 'LOS', 'LAS', 'UN', 'UNA', 'DE', 'DEL', 'Y', 'E', 'O', 'U', 'QUE', 'EN', 'POR',
  'PARA', 'CON', 'SIN', 'SEGUN', 'ANTE', 'SU', 'SUS', 'AL', 'A', 'DON', 'DONA', 'SR', 'SRA', 'CON', 'DNI', 'NIE', 'NIF']);
// Las palabras de institución que SÍ son apellido detrás de una partícula.
const APELLIDO_TRAS_PARTICULA = new Set(['CALLE', 'TORRE', 'TORRES', 'IGLESIA', 'CRUZ', 'ROSA', 'FUENTE', 'FUENTES', 'PENA',
  'VEGA', 'CAMPO', 'CAMPOS', 'CASTILLO', 'RIO', 'VALLE', 'HOZ', 'SERNA', 'PUENTE', 'PRADO', 'VILLA', 'PLAZA', 'CASA',
  'CUEVA', 'SIERRA', 'MORA', 'OLIVA', 'PINO', 'OLMO', 'ROBLE', 'ENCINA', 'MAR', 'PAZ', 'LUZ', 'CONCEPCION', 'MERCED',
  'CAMARA', 'PUERTA', 'ISLA', 'CASTRO', 'REY', 'REINA', 'SANTOS', 'CORTE', 'CUESTA', 'MORAL', 'GUARDIA', 'PUERTO']);
function esApellidoTrasParticula(p) {
  const k = clavePieza(p);
  if (FUNCIONALES.has(k) || k.length < 2) return false;
  if ((INSTITUCION.has(k) || NO_ES_PIEZA_DE_NOMBRE.has(k)) && !APELLIDO_TRAS_PARTICULA.has(k)) return false;
  return true;
}

// Palabras corrientes que en un escaneo en mayúsculas se leerían como apellido: «RAMIRO TIENE DEUDAS DE
// JUEGO». Un apellido no es un verbo ni un sustantivo corriente.
const FRECUENTES = new Set(`TIENE TENIA TUVO DICE DIJO DECIA ESTA ESTABA ESTUVO ES ERA FUE HA HABIA HAY HACE HIZO DEBE DEBIA VIVE VIVIA
TRABAJA TRABAJABA QUIERE QUERIA PUEDE PODIA SABE SABIA VA IBA VINO VIENE LLEVA LLEVABA PIDE PIDIO PAGA PAGO COBRA
NO SI YA MUY MAS MENOS PERO AUNQUE TAMBIEN SOLO NUNCA SIEMPRE AHORA ANTES DESPUES AQUI ALLI BIEN MAL MUCHO POCO
DEUDAS DEUDA JUEGO DINERO CASA COCHE PISO TRABAJO EMPRESA PADRE MADRE HIJO HIJA HERMANO HERMANA TIO TIA ABUELO
ABUELA ESPOSA MARIDO MUJER NOVIO NOVIA VECINO VECINA AMIGO AMIGA SEÑOR SENOR SEÑORA SENORA CUANDO DONDE COMO
QUIEN PORQUE PARA SEGUN DESDE HASTA ENTRE SOBRE TRAS CONTRA HACIA DURANTE MEDIANTE AÑO ANO AÑOS ANOS MES MESES DIA
DIAS HORA HORAS TAMBIEN LLAMAR LLAMO PEDIR VER HABLAR DECIR FIRMAR TELEFONO TEL DOMIC DOMICILIO DNI PENDIENTE URGENTE`.split(/\s+/));

export function esApellidoPosible(p) {
  const k = clavePieza(p);
  if (FRECUENTES.has(k)) return false;
  return !CABEZAS_NO_APELLIDO.has(k) && !NO_ES_PIEZA_DE_NOMBRE.has(k) && !LUGARES.has(k) && k.length >= 2;
}

// ¿Va justo detrás de otra palabra con mayúscula (con o sin partícula)? Entonces es parte de un
// nombre que empieza antes. Un tratamiento («Don», «D.ª») no cuenta: detrás de él SÍ empieza el nombre.
function detrasDePieza(texto, inicio) {
  const antes = texto.slice(Math.max(0, inicio - 40), inicio);
  const m = antes.match(/([\p{Lu}][\p{L}'’-]*)\.?\s+(?:(?:de|del|de la|i)\s+)?$/u);
  if (!m) return false;
  if (/^(?:Don|DON|Doña|DOÑA|DONA|Dña|DÑA|D|Sr|Sra|SR|SRA|Dr|Dra|Excmo|Ilmo|Excma|Ilma|Mr|Mrs|Ms|Miss|Herr|Frau|Mme|Mlle|Dott|Sig|Sgra|Lieber|Liebe|Dear|Hola|Kaixo|Estimado|Estimada|Querido|Querida)$/.test(m[1])) return false;
  const k = clavePieza(m[1]);
  // En un escaneo TODO va en mayúsculas: «VIAJA COMO PASAJERO MAMADOU DIALLO». Ahí la palabra de
  // delante solo es parte del nombre si es a su vez un nombre de pila («MANUEL JESUS ORTEGA»).
  if (m[1] === m[1].toUpperCase() && m[1].length > 1) return NOMBRES_DE_PILA.has(k);
  return !NO_ES_PIEZA_DE_NOMBRE.has(k) && !INSTITUCION.has(k) && !LUGARES.has(k);
}

// Nombre de pila (uno o dos) + uno a cuatro apellidos. «Jon Ugalde», «Rocío Justicia Moreno»,
// «JOSE ANTONIO BARRIOS DE LA ROSA», «Hans-Peter Müller».
// Partículas de un apellido, también las árabes y las europeas: «EL AMRANI», «Ben Ali», «van der Berg».
const siguiente = new RegExp(`^(\\s+(?:(?:de la|de los|de las|del|de|i|el|al|ben|bin|abu|ould|ait|van der|van den|van|von|der|di|du|le|DE LA|DE LOS|DEL|DE|I|EL|AL|BEN|BIN|ABU|OULD|AIT|VAN DER|VAN|VON|DER|DI|DU|LE|von der|von dem|van de|El|Al|Ben|Bin|Abu|Ould|Ait|Van|Von|Di|Du|Le)\\s+)?)(${PIEZA_O_MAYUS.source})`, 'u');
const RE_Y = new RegExp(`^\\s+y\\s+(${PIEZA_O_MAYUS.source})((?:\\s+(?:de la|de los|del|de)\\s+${PIEZA_O_MAYUS.source})*)`, 'u');
const RE_NCP = new RegExp(`(?<![\\p{L}\\p{N}.@])${PIEZA_O_MAYUS.source}`, 'gu');
export function nombresConPila(texto) {
  const fuera = [];
  const re = RE_NCP;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const primera = m[0];
    if (!esNombreDePila(primera)) continue;
    const inicio = m.index;
    if (detrasDePieza(texto, inicio)) continue;
    if (antesNoPersona(texto, inicio)) continue;
    // Recorre hacia delante: más nombres de pila, luego apellidos, con partículas entre medias.
    let fin = inicio + primera.length;
    let pilas = 1;
    let apellidos = 0;
    for (;;) {
      const x = texto.slice(fin).match(siguiente);
      if (!x) break;
      const pieza = x[2];
      const conParticula = /\S/.test(x[1]);
      // «i»/«y» delante de un nombre de pila es una conjunción, no una partícula: «Jordi Font i Casals
      // i Montserrat Vidal Puig» son dos personas.
      if (/^\s+(?:i|I|y|Y)\s+$/.test(x[1]) && esNombreDePila(pieza)) break;
      if (!conParticula && apellidos === 0 && pilas < 3 && esNombreDePila(pieza) && !esAmbiguo(pieza)) { pilas++; fin += x[0].length; continue; }
      // Detrás de una partícula, un apellido puede ser una palabra corriente o de institución: «de la
      // Calle», «de la Torre», «del Campo», «de la Iglesia». Sin partícula, no.
      // Un lugar puede ser apellido detrás del nombre de pila: «SERGIO TOLEDO MORA», «Ana Soria Gil».
      if (!(conParticula ? esApellidoTrasParticula(pieza) : esApellidoPosible(pieza) || LUGARES.has(clavePieza(pieza)))) break;
      // Un apellido va en la misma caja que el nombre: todo mayúsculas detrás de un nombre en
      // minúsculas, o al revés («ASUNCIÓN DE TUTELA Vista»), no es su apellido.
      if ((pieza === pieza.toUpperCase()) !== (primera === primera.toUpperCase()) && pieza.length > 1) break;
      if (/^\s*\d/.test(texto.slice(fin + x[0].length))) break;
      apellidos++;
      fin += x[0].length;
      if (apellidos >= 4) break;
    }
    // La «y» de un apellido compuesto: «de la Fuente y Sáenz de Tejada». Solo si lo que sigue NO es
    // otro nombre de pila (entonces es una enumeración: «Juan Pérez y Pedro López»).
    const y = texto.slice(fin).match(RE_Y);
    if (apellidos && y && !esNombreDePila(y[1]) && esApellidoPosible(y[1])) fin += y[0].length;
    if (!apellidos) continue;
    // Un nombre ambiguo («Rosa», «Pilar», «Santiago») con un solo apellido, a principio de frase o
    // detrás de un artículo o una preposición, está en la duda: pasa.
    if (esAmbiguo(primera) && apellidos < 2) {
      const antes = texto.slice(Math.max(0, inicio - 6), inicio);
      if (empiezaFrase(texto, inicio) || /\b(?:la|el|en|de|del|a|al|las|los)\s+$/i.test(antes)) continue;
    }
    fuera.push({ tipo: 'PERSONA', valor: texto.slice(inicio, fin), inicio, fin, via: 'contexto:nombre-de-pila' });
    re.lastIndex = fin;
  }
  return fuera;
}

// El nombre de pila SOLO: «Me llamó ayer Garbiñe», «Hablé con Iñaki y con Maite», «Irene, de 11
// años». Con mayúscula, que no sea ambiguo, y que no vaya detrás de una advocación o una calle.
const RE_NDPS = new RegExp(`(?<![\\p{L}\\p{N}.@-])(${PIEZA_TITULO.source}|[\\p{Lu}]{2,}(?:-[\\p{Lu}]{2,})?)(?![\\p{L}\\p{N}@-])`, 'gu');
export function nombresDePilaSueltos(texto) {
  const fuera = [];
  const re = RE_NDPS;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const p = m[1];
    if (!esNombreDePila(p) || p.split('-').some(esAmbiguo)) continue;
    const inicio = m.index;
    // Detrás de otra pieza con mayúscula es un APELLIDO que coincide con un nombre de pila («Ramón
    // Gil Esteban», «Soledad Montero Lagos»): no es una persona suelta.
    if (detrasDePieza(texto, inicio)) continue;
    if (antesNoPersona(texto, inicio)) continue;
    // Si detrás viene un apellido (en la misma caja), eso es de nombresConPila. En mayúsculas también
    // vale («a sus hijos, MARC y LAIA…»), salvo pegado a una razón social.
    const sig = texto.slice(inicio + p.length).match(/^\s+(?:(?:de la|de los|del|de|i)\s+)?([\p{Lu}][\p{L}'’-]+)(\s*:)?/u);
    // …salvo que esa palabra sea quien escribe el mensaje siguiente de un chat («…lo sabe Pau Vicent: lo
    // siento»): entonces «Pau» acaba un mensaje y está solo.
    if (sig && !sig[2] && esApellidoPosible(sig[1]) && (sig[1] === sig[1].toUpperCase()) === (p === p.toUpperCase())) continue;
    if (p === p.toUpperCase() && dentroDeRazonSocial(texto, inicio, inicio + p.length)) continue;
    // En un escaneo, un nombre de pila en mayúsculas y SOLO es a menudo otra cosa sin su tilde: «SE
    // ALEJO» (alejó), «31 DE JULIO», «EN SAN FERNANDO». Solo vale en una enumeración o en un inciso:
    // detrás de una coma, de «Y» o de «A», o de un paréntesis o dos puntos.
    if (p === p.toUpperCase() && !/(?:^|[,(:;]\s*|\s(?:Y|E|A|y|e|a)\s+)$/.test(texto.slice(Math.max(0, inicio - 4), inicio))) continue;
    fuera.push({ tipo: 'PERSONA', valor: p, inicio, fin: inicio + p.length, via: 'contexto:nombre-de-pila' });
  }
  return fuera;
}

// El nombre detrás de una relación: «mi cuñado Toño», «su hermana Carmen», «su compañera Sonia».
// Aquí vale cualquier nombre con mayúscula, esté o no en el léxico (y los ambiguos también: la
// relación ya dice que es una persona).
const RELACION = '(?:herman[oa]|cuñad[oa]|prim[oa]|madre|padre|hij[oa]|marido|mujer|espos[oa]|pareja|expareja|novi[oa]|' +
  'abuel[oa]|niet[oa]|t[íi][oa]|sobrin[oa]|suegr[oa]|yerno|nuera|compañer[oa](?:\\s+de\\s+trabajo)?|amig[oa]|jef[ea]|' +
  'encargad[oa]|vecin[oa]|client[ea]|soci[oa]|hijastr[oa]|madrastra|padrastro|cuidador[a]?)';
// Con posesivo o con artículo: «mi cuñado Toño», «la tía Pura», «el primo Sebas».
// «el tal Arteaga», «la tal Mari»: presenta a una persona.
const RE_TAL = /(?<![\p{L}])(?:el|la|al|del|El|La|Al|Del)\s+tal\s+([\p{Lu}][\p{Ll}'’-]+(?:\s+[\p{Lu}][\p{Ll}'’-]+){0,2})/gu;
export function nombresTrasTal(texto) {
  const fuera = [];
  RE_TAL.lastIndex = 0;
  let m;
  while ((m = RE_TAL.exec(texto)) !== null) {
    const i = m.index + m[0].lastIndexOf(m[1]);
    fuera.push({ tipo: 'PERSONA', valor: m[1], inicio: i, fin: i + m[1].length, via: 'contexto:relacion' });
  }
  return fuera;
}

const RE_REL = new RegExp(`(?<![\\p{L}])(?:[Mm]i|[Tt]u|[Ss]u|[Ss]us|[Nn]uestr[oa]s?|[Vv]uestr[oa]s?|[Ll]a|[Ee]l)\\s+${RELACION}(?:\\s+(?:paterna?|materna?|mayor|menor|peque[ñn][oa]))?\\s*,?\\s+(${PIEZA_TITULO.source}(?:\\s+(?:(?:de|del|de la|i)\\s+)?${PIEZA_TITULO.source}){0,3})`, 'gu');
export function nombresTrasRelacion(texto) {
  const fuera = [];
  const re = RE_REL;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const nombre = m[1];
    const piezas = nombre.split(/\s+/);
    const buenas = [];
    for (const p of piezas) {
      if (/^(?:de|del|la|i)$/.test(p)) { buenas.push(p); continue; }
      if (!esApellidoPosible(p) && !esNombreDePila(p)) break;
      buenas.push(p);
    }
    while (buenas.length && /^(?:de|del|la|i)$/.test(buenas[buenas.length - 1])) buenas.pop();
    if (!buenas.length) continue;
    const valor = buenas.join(' ');
    const inicio = m.index + m[0].lastIndexOf(nombre);
    fuera.push({ tipo: 'PERSONA', valor, inicio, fin: inicio + valor.length, via: 'contexto:relacion' });
  }
  return fuera;
}

// «El procurador, Lorenzo, me dijo…»: el cargo, una coma, el nombre y otra coma.
const RE_COMAS = new RegExp(`(?<![\\p{L}])(?:[Ee]l|[Ll]a)\\s+(?:procurador(?:a)?|abogad[oa]|letrad[oa]|perit[oa]|notari[oa]|testigo|gestor(?:a)?|administrador(?:a)?|mediador(?:a)?|[áa]rbitro|[áa]rbitra|psic[óo]log[oa]|trabajador(?:a)?\\s+social|m[ée]dic[oa]|detective|traductor(?:a)?|int[ée]rprete)\\s*,\\s*(${PIEZA_TITULO.source}(?:\\s+(?:(?:de|del|de la|i)\\s+)?${PIEZA_TITULO.source}){0,3})\\s*,`, 'gu');
export function nombresEntreComas(texto) {
  const fuera = [];
  const re = RE_COMAS;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const inicio = m.index + m[0].indexOf(m[1]);
    if (!esApellidoPosible(m[1].split(/\s+/)[0]) && !esNombreDePila(m[1].split(/\s+/)[0])) continue;
    fuera.push({ tipo: 'PERSONA', valor: m[1], inicio, fin: inicio + m[1].length, via: 'contexto:cargo-entre-comas' });
  }
  return fuera;
}

// «Ane, buenas:», «Jon, te cuento»: el vocativo que abre un correo.
const RE_VOC = new RegExp(`(?:^|(?<=[\\n.!?:]\\s*))(${PIEZA_TITULO.source})\\s*,\\s*(?:buenas|buenos\\s+d[íi]as|buenas\\s+tardes|hola|qu[ée]\\s+tal|te\\s+escribo|te\\s+cuento|os\\s+escribo|una\\s+cosa)`, 'gu');
export function vocativos(texto) {
  const fuera = [];
  const re = RE_VOC;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(texto)) !== null) {
    if (!esNombreDePila(m[1]) && !esApellidoPosible(m[1])) continue;
    const inicio = m.index + m[0].indexOf(m[1]);
    fuera.push({ tipo: 'PERSONA', valor: m[1], inicio, fin: inicio + m[1].length, via: 'contexto:vocativo' });
  }
  return fuera;
}


// «ÁLVAREZ SOUTO, Brais», «FERREIRO BARREIRO, MANUEL ANXO», «WANG, Li Na»: el formato de las listas
// de admitidos, los informes de urgencias y los partes. Apellidos en MAYÚSCULAS, coma, y el nombre
// de pila (del léxico, o cualquiera si el apellido es un apellido chino).
const RE_INVERTIDO = new RegExp(`(?<![\\p{L}\\p{N}])((?:[\\p{Lu}][\\p{Lu}'’-]+)(?:\\s+(?:(?:DE LA|DE LOS|DEL|DE|Y|I|EL|AL|VAN|VON)\\s+)?[\\p{Lu}][\\p{Lu}'’-]+){0,3}),\\s*((?:${PIEZA_O_MAYUS.source})(?:\\s+(?:(?:del|de la|de|DEL|DE LA|DE)\\s+)?${PIEZA_O_MAYUS.source}){0,2})`, 'gu');
export function nombresInvertidos(texto) {
  const fuera = [];
  RE_INVERTIDO.lastIndex = 0;
  let m;
  while ((m = RE_INVERTIDO.exec(texto)) !== null) {
    // Cada apellido, con el criterio que le toca: detrás de una partícula vale «DE LA TORRE».
    const fichas = m[1].split(/\s+/);
    // No empieza por una partícula ni por un artículo: «EL ENCARGADO, FRANCISCO JAVIER…» no es un apellido.
    if (/^(?:DE|DEL|LA|LOS|LAS|Y|I|EL|AL|VAN|VON|UN|UNA)$/.test(fichas[0])) continue;
    const apellidos = [];
    let malo = false;
    for (let k = 0; k < fichas.length; k++) {
      if (/^(?:DE|DEL|LA|LOS|Y|I|EL|AL|VAN|VON)$/.test(fichas[k])) continue;
      const trasParticula = k > 0 && /^(?:DE|DEL|LA|LOS|Y|I|EL|AL|VAN|VON)$/.test(fichas[k - 1]);
      if (!(trasParticula ? esApellidoTrasParticula(fichas[k]) : esApellidoPosible(fichas[k]) || LUGARES.has(clavePieza(fichas[k])))) { malo = true; break; }
      apellidos.push(fichas[k]);
    }
    if (malo || !apellidos.length) continue;
    const pilas = m[2].split(/\s+/).filter((x) => !/^(?:de|del|la|DE|DEL|LA)$/.test(x));
    if (!pilas.length) continue;
    const chino = apellidos.length === 1 && APELLIDOS_CHINOS.has(clavePieza(apellidos[0]));
    if (!chino && !esNombreDePila(pilas[0])) continue;
    fuera.push({ tipo: 'PERSONA', valor: m[0], inicio: m.index, fin: m.index + m[0].length, via: 'contexto:nombre-invertido' });
  }
  return fuera;
}

// ¿Es la palabra una secuencia de sílabas pinyin? «XIAOMING» = xiao+ming, «MEIHUA» = mei+hua. «ESPOSA»,
// «DOMICILIO» o «ENCARGADA» no lo son.
const SILABA_PINYIN = '(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(?:iang|iong|uang|ang|eng|ing|ong|ian|iao|uai|uan|ai|ei|ao|ou|an|en|in|un|ia|ie|iu|ua|uo|ui|ue|er|a|e|i|o|u|v)';
const PINYIN = new RegExp(`^(?:${SILABA_PINYIN}){1,3}$`);
const esPinyin = (p) => /^[A-Za-z]{2,}$/.test(p) && PINYIN.test(p.toLowerCase());

// Nombres chinos, con el apellido delante: «LIN XIAOMING», «Chen Meihua», «Wang Li Na».
const RE_CHINO = new RegExp(`(?<![\\p{L}\\p{N}])(${PIEZA_O_MAYUS.source})((?:\\s+${PIEZA_O_MAYUS.source}){1,2})(?![\\p{L}])`, 'gu');
export function nombresChinos(texto) {
  const fuera = [];
  RE_CHINO.lastIndex = 0;
  let m;
  while ((m = RE_CHINO.exec(texto)) !== null) {
    const siguiente = () => { RE_CHINO.lastIndex = m.index + m[1].length; };
    if (!APELLIDOS_CHINOS.has(clavePieza(m[1]))) { siguiente(); continue; }
    // «SU ESPOSA», «HE COMPROBADO»: «Su» y «He» son apellidos chinos y palabras castellanas.
    if (/^(?:SU|Su|HE|He|YA|Ya|MA|Ma)$/.test(m[1])) { siguiente(); continue; }
    const resto = m[2].trim().split(/\s+/);
    // El nombre chino son sílabas pinyin: letras latinas sin tildes, sin palabras corrientes, y en
    // la misma caja que el apellido.
    const caja = (x) => x === x.toUpperCase();
    if (!resto.every((p) => esPinyin(p) && caja(p) === caja(m[1]) && !NO_ES_PIEZA_DE_NOMBRE.has(clavePieza(p)) && !INSTITUCION.has(clavePieza(p)) && !LUGARES.has(clavePieza(p)))) { siguiente(); continue; }
    fuera.push({ tipo: 'PERSONA', valor: m[0], inicio: m.index, fin: m.index + m[0].length, via: 'contexto:nombre-chino' });
  }
  return fuera;
}

// Un nombre con la edad detrás: «Nel (10 años)», «Irene, de 11 años». Eso es una persona, esté o
// no el nombre en el léxico.
const RE_EDAD = new RegExp(`(?<![\\p{L}\\p{N}])(${PIEZA_TITULO.source}(?:\\s+(?:(?:de|del|de la|i)\\s+)?${PIEZA_TITULO.source}){0,3})(?:\\s*\\(\\s*\\d{1,3}\\s+a[ñn]os?\\s*\\)|\\s*,\\s*de\\s+\\d{1,3}(?:\\s+a[ñn]os)?(?![\\p{L}\\d]))`, 'gu');
export function nombresConEdad(texto) {
  const fuera = [];
  RE_EDAD.lastIndex = 0;
  let m;
  while ((m = RE_EDAD.exec(texto)) !== null) {
    const primera = m[1].split(/\s+/)[0];
    if (!esPrimeraPiezaDeNombre(primera) || INSTITUCION.has(clavePieza(primera)) || LUGARES.has(clavePieza(primera))) continue;
    fuera.push({ tipo: 'PERSONA', valor: m[1], inicio: m.index, fin: m.index + m[1].length, via: 'contexto:edad' });
  }
  return fuera;
}

// El mote entre paréntesis detrás de un nombre: «D. FRANCISCO RAMOS BRAVO ("PACO")».
const RE_MOTE = /(?<=[\p{L}]\s*\(\s*["«“'])([\p{Lu}][\p{L}'’-]+)(?=["»”']\s*\))/gu;
export function motes(texto) {
  const fuera = [];
  RE_MOTE.lastIndex = 0;
  let m;
  while ((m = RE_MOTE.exec(texto)) !== null) {
    if (NO_ES_PIEZA_DE_NOMBRE.has(clavePieza(m[1])) || INSTITUCION.has(clavePieza(m[1]))) continue;
    fuera.push({ tipo: 'PERSONA', valor: m[1], inicio: m.index, fin: m.index + m[1].length, via: 'contexto:mote' });
  }
  return fuera;
}


// ¿Es un correo o un mensaje? Cabeceras, una dirección de correo, un saludo o una despedida.
export const pareceCorreo = (texto) =>
  /(?:^|\s)(?:De|Para|Asunto|CC|From|To|Subject)\s*:|[\w.+-]+@[\w-]+\.[\w.]+|\b(?:Un\s+(?:abrazo|saludo)|Saludos|Hola|Buenos\s+d[íi]as|Oye|SMS|WhatsApp|Telegram|Kaixo)\b|\[\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\]/.test(texto);

// En un correo, a los compañeros se les nombra por el apellido: «¿sabes si Casado mandó ya el
// informe?», «Porque Fuentes dice que…», «Lo ha revisado Vallejo». Solo en correos: en un escrito
// judicial una pieza suelta con mayúscula delante de un verbo es tan a menudo una empresa o un
// lugar que, en la duda, pasa.
const VERBO_IRREGULAR = new Set(['dice', 'dijo', 'quiere', 'quiso', 'tiene', 'tuvo', 'está', 'esta', 'estuvo', 'ha', 'había',
  'va', 'fue', 'era', 'sabe', 'supo', 'puede', 'pudo', 'hace', 'hizo', 'viene', 'vino', 'manda', 'mandó', 'lleva', 'llevó', 'sigue',
  'siguió', 'pide', 'pidió', 'cree', 'creyó', 'se', 'me', 'te', 'nos', 'os', 'le', 'les', 'lo', 'la', 'no', 'ya', 'también', 'tampoco']);
const RE_CORREO = new RegExp(`(?<![\\p{L}\\p{N}.@-])(${PIEZA_TITULO.source})(?![\\p{L}@])`, 'gu');
export function apellidosEnCorreo(texto) {
  if (!pareceCorreo(texto)) return [];
  const fuera = [];
  const re = RE_CORREO;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const p = m[1];
    const inicio = m.index;
    const k = clavePieza(p);
    if (k.length < 4 || INSTITUCION.has(k) || LUGARES.has(k) || NO_ES_PIEZA_DE_NOMBRE.has(k)) continue;
    if (empiezaFrase(texto, inicio)) continue;
    // Detrás de una preposición es un lugar o una cosa: «en Alcúdia», «desde Sóller».
    if (/\b(?:en|de|a|desde|hacia|hasta|para|por|sobre|con|al|del|entre)\s+$/i.test(texto.slice(Math.max(0, inicio - 8), inicio))) continue;
    const despues = texto.slice(inicio + p.length).match(/^\s+([\p{Ll}]+)/u)?.[1];
    const antes = texto.slice(Math.max(0, inicio - 30), inicio);
    const verboDetras = despues && (VERBO_IRREGULAR.has(despues) || (VERBO_CONJUGADO.test(despues) && !NO_VERBO.has(despues)));
    const verboDelante = /\b(?:ha|han|había|habían|he|hemos)\s+[\p{Ll}]+(?:ado|ido)\s+$/u.test(antes);
    if (!verboDetras && !verboDelante) continue;
    fuera.push({ tipo: 'PERSONA', valor: p, inicio, fin: inicio + p.length, via: 'contexto:apellido-en-correo' });
  }
  return fuera;
}

// Apellido compuesto con guion: «Uribe-Etxebarria», «Fernández-Arias». Si ninguna de las dos
// mitades es una institución ni un lugar, es un apellido.
export function apellidosConGuion(texto) {
  const fuera = [];
  const re = /(?<![\p{L}\p{N}@-])([\p{Lu}][\p{Ll}]+-[\p{Lu}][\p{Ll}]+)(?![\p{L}\p{N}@-])/gu;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const [a, b] = m[1].split('-');
    if ([a, b].some((x) => INSTITUCION.has(clavePieza(x)) || LUGARES.has(clavePieza(x)) || NO_ES_PIEZA_DE_NOMBRE.has(clavePieza(x)))) continue;
    if (LUGARES.has(clavePieza(m[1]))) continue;
    fuera.push({ tipo: 'PERSONA', valor: m[1], inicio: m.index, fin: m.index + m[1].length, via: 'contexto:apellido-con-guion' });
  }
  return fuera;
}

// ¿Está esta mención dentro de una razón social? «TALLERES BELTRÁN E HIJOS, S.L.»: el apellido es
// parte del nombre de la empresa, no una mención de la persona.
export function dentroDeRazonSocial(texto, i, fin) {
  if (/(?:^|[\s,(])(?:TALLERES|CONSTRUCCIONES|HERMANOS|HNOS\.?|HIJOS|LIMPIEZAS|TRANSPORTES|INVERSIONES|PROMOCIONES|BUFETE|DESPACHO|ABOGADOS|ASESORES|ASESORIA|ASESORÍA|GESTORIA|GESTORÍA|CLINICA|CLÍNICA|FARMACIA|CARPINTERIAS|CARPINTERÍAS|Talleres|Construcciones|Hermanos|Hijos|Limpiezas|Transportes|Inversiones|Promociones|Bufete|Despacho|Abogados|Asesores|Asesoría|Gestoría|Clínica|Farmacia|Carpinterías|Mas\s+del?|Masía|Finca|Cortijo|Villa|Can|Ca\s+n'|Hotel|Casa)\s+(?:DE\s+|de\s+)?$/.test(texto.slice(Math.max(0, i - 25), i))) return true;
  return /^\s+(?:E|Y|e|y)\s+(?:HIJOS|Hijos|HERMANOS|Hermanos)\b|^,?\s*S\.?\s?[LA]\.?/.test(texto.slice(fin, fin + 14));
}

// Lo que va delante dice que no es una persona («SAN JOSE», «Hospital Virgen del Rocío», «el Gregorio
// Marañón»). Para la propagación de nombres ya vistos, que también puede caer ahí.
// Con artículo delante: «el Gregorio Marañón» (nombre y apellido: un hospital, una calle) no es una persona;
// «la Pili», «el Tomás» (solo el nombre, en un mensaje) sí.
const ARTICULO_LUGAR = /\b(?:el|la|El|La|EL|LA)\s+$/;
export const antesNoPersona = (texto, i) => ANTES_NO_PERSONA.test(texto.slice(Math.max(0, i - 40), i)) ||
  (ARTICULO_LUGAR.test(texto.slice(Math.max(0, i - 4), i)) && /^[\p{Lu}][\p{L}'’-]*\s+(?:(?:de|del)\s+)?[\p{Lu}]/u.test(texto.slice(i, i + 60)));

export const esPalabraInstitucional = (p) => INSTITUCION.has(clavePieza(p));

// Palabras que, dentro de una secuencia capitalizada, dicen que es una institución, un lugar o un
// título, no una persona. La guardia protege los órganos y organismos de todos modos; esto evita
// que se marquen para empezar («Hospital Universitario Central», «Servicio Andaluz Salud»).
const INSTITUCION = new Set([
  'PAERIA', 'GENERALITAT', 'CONSELL', 'XUNTA', 'LEHENDAKARITZA',
  'UNIVERSITARIO', 'UNIVERSIDAD', 'CENTRAL', 'GENERAL', 'NACIONAL', 'PROVINCIAL', 'MUNICIPAL',
  'REGIONAL', 'AUTONOMICA', 'PUBLICA', 'PUBLICO', 'SUPERIOR', 'SUPREMO', 'CONSTITUCIONAL', 'JUSTICIA',
  'ADMINISTRACION', 'GOBIERNO', 'ESTADO', 'REAL', 'DECRETO', 'LEY', 'ORGANICA', 'REGLAMENTO', 'CODIGO',
  'CIVIL', 'PENAL', 'SOCIAL', 'MERCANTIL', 'LABORAL', 'SEGURIDAD', 'HACIENDA', 'TRIBUTARIA', 'AGENCIA',
  'CONSEJO', 'CONSEJERIA', 'COMISION', 'DEPARTAMENTO', 'OFICINA', 'SECRETARIA', 'DELEGACION', 'JUNTA',
  'GENERALITAT', 'XUNTA', 'CABILDO', 'DIPUTACION', 'AYUNTAMIENTO', 'COMUNIDAD', 'PRINCIPADO', 'REGION',
  'CIUDAD', 'PUEBLO', 'VALLE', 'SIERRA', 'PUERTO', 'ISLA', 'ISLAS', 'NORTE', 'SUR', 'ESTE', 'OESTE',
  'SAN', 'SANTA', 'SANTO', 'SANT', 'SANTS', 'VILA', 'NUESTRA', 'SEÑORA', 'SENORA', 'VIRGEN', 'IGLESIA', 'PARROQUIA', 'CLUB',
  'EMPRESA', 'COMPAÑIA', 'COMPANIA', 'SERVICIOS', 'SISTEMAS', 'SOLUCIONES', 'CONSTRUCCIONES',
  'INVERSIONES', 'INMOBILIARIA', 'PROMOCIONES', 'TRANSPORTES', 'DISTRIBUCIONES', 'INDUSTRIAS', 'HOTEL',
  'RESTAURANTE', 'CLINICA', 'FARMACIA', 'CENTRO', 'CASA', 'EDIFICIO', 'TORRE', 'PARQUE', 'MUSEO',
  'TEATRO', 'ESTADIO', 'AEROPUERTO', 'ESTACION', 'PUERTA', 'CAMINO', 'CARRETERA', 'AUTOVIA', 'RIO',
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE',
  'NOVIEMBRE', 'DICIEMBRE', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO',
  'EUROPEA', 'EUROPEO', 'UNION', 'UNIDAS', 'NACIONES', 'INTERNACIONAL', 'MINISTERIO', 'INSTITUTO',
  'HOSPITAL', 'SERVICIO', 'JUZGADO', 'TRIBUNAL', 'AUDIENCIA', 'FISCALIA', 'POLICIA', 'GUARDIA',
  'REGISTRO', 'NOTARIA', 'COLEGIO', 'ILUSTRE', 'EXCELENTISIMO', 'ILUSTRISIMO', 'SALA', 'SECCION',
  'PRIMERA', 'SEGUNDA', 'TERCERA', 'CUARTA', 'QUINTA', 'INSTANCIA', 'INSTRUCCION', 'VIOLENCIA', 'MUJER',
  'MENORES', 'VIGILANCIA', 'PENITENCIARIA', 'CONTENCIOSO', 'ADMINISTRATIVO', 'TRABAJO', 'EMPLEO',
  'SALUD', 'SANIDAD', 'EDUCACION', 'CULTURA', 'DEFENSA', 'INTERIOR', 'ECONOMIA', 'FOMENTO', 'ASUNTOS',
  'EXTERIORES', 'IGUALDAD', 'VIVIENDA', 'TRANSPORTE', 'AGRICULTURA', 'PESCA', 'ALIMENTACION', 'ENERGIA',
  'INDUSTRIA', 'COMERCIO', 'TURISMO', 'CIENCIA', 'INNOVACION', 'DERECHOS', 'BIENESTAR', 'TRIBUNALES',
  'ABOGACIA', 'PROCURADORES', 'NOTARIOS', 'REGISTRADORES', 'ASOCIACION', 'FUNDACION', 'FEDERACION',
  'CONFEDERACION', 'SINDICATO', 'PARTIDO', 'MUTUA', 'SEGUROS', 'BANCO', 'CAJA', 'CREDITO', 'AHORROS',
  'SOCIEDAD', 'ANONIMA', 'LIMITADA', 'COOPERATIVA', 'GRUPO', 'HOLDING', 'CAPITAL', 'PARTNERS', 'ASESORES',
  'ABOGADOS', 'CONSULTORES', 'AUDITORES', 'HERMANOS', 'HIJOS', 'SUCESORES', 'ADVOCATS', 'ASSOCIATS', 'ASOCIADOS',
  'ABOKATUAK', 'AVOGADOS', 'BUFETE', 'DESPACHO', 'GESTORIA', 'ASESORIA', 'NOTARIA', 'CARNE', 'PROFESIONAL',
  'RENDA', 'GARANTIDA', 'CIUTADANIA', 'GARDEN', 'RESORT', 'CALA', 'PLAYA', 'PLATJA', 'APARTAMENTOS', 'PROGRAMA',
  'INDIVIDUAL', 'ATENCION', 'CARITAS', 'DIOCESANA', 'ALCALDE', 'ALCALDESA', 'FINCA', 'CAN', 'PUNTO', 'ENCUENTRO',
  'FAMILIAR', 'CUIDADOS', 'DEPENDENCIA', 'VIDA', 'PENSIONES', 'TASACIONES',
  // Lugares de dos palabras que abren frase delante de un verbo («Estados Unidos impuso…»).
  'NUEVA', 'NUEVO', 'BUENOS', 'COSTA', 'REINO', 'ESTADOS', 'PAISES', 'GRAN', 'CASTILLA', 'ARABIA',
  'AMERICA', 'AFRICA', 'ASIA', 'EUROPA', 'ESPAÑA', 'ESPANA', 'COMUNIDADES', 'MUNICIPIO', 'PROVINCIA',
  // Euskera: las palabras de una institución vasca («Justizia Administrazioko letratua»).
  'JUSTIZIA', 'ADMINISTRAZIOKO', 'EPAITEGIA', 'AUZITEGIA', 'KONTSEILUA', 'ALDUNDIA', 'UDALA', 'JAURLARITZA',
  'LETRATUA', 'ZENBAKIKO', 'AUZIALDIKO', 'FORU', 'HARREMANEN', 'ECONOMICO', 'TALLERES', 'LIMPIEZAS', 'LOGISTICA',
  // Vías: una dirección con mayúsculas («Polígono Industrial Fuente del Jarro») no es un nombre.
  'POLIGONO', 'INDUSTRIAL', 'URBANIZACION', 'CALLE', 'AVENIDA', 'PASEO', 'CARRER', 'RUA', 'KALEA', 'KALE',
  'TRAVESIA', 'RONDA', 'GLORIETA', 'CARRETERA', 'BARRIADA', 'BARRIO', 'COLONIA', 'EDIFICIO', 'BLOQUE', 'PORTAL',
  // Departamentos y órganos internos de una empresa o una administración.
  'RECURSOS', 'HUMANOS', 'GERENCIA', 'COMITE', 'ASAMBLEA', 'MESA', 'ORGANO', 'EQUIPO', 'UNIDAD', 'AREA',
  'CONTABILIDAD', 'PERSONAL', 'ADMINISTRADORES', 'CONSEJEROS', 'SOCIOS', 'ACCIONISTAS', 'PATRONATO',
  // Cargos y oficios, que en una secuencia capitalizada son el puesto, no la persona.
  'LETRADO', 'LETRADA', 'TRAMITADOR', 'TRAMITADORA', 'GESTOR', 'GESTORA', 'TECNICO', 'TECNICA',
  'SECRETARIO', 'SECRETARIA', 'AGENTE', 'FUNCIONARIO', 'FUNCIONARIA', 'INSTRUCTOR', 'DIRECTOR', 'DIRECTORA',
  'PRESIDENTE', 'PRESIDENTA', 'JEFE', 'JEFA', 'INSPECTOR', 'INSPECTORA', 'MAGISTRADO', 'MAGISTRADA',
  'JUEZ', 'JUEZA', 'FISCAL', 'NOTARIO', 'NOTARIA', 'REGISTRADOR', 'REGISTRADORA', 'PROCURADOR',
  'PROCURADORA', 'ABOGADO', 'ABOGADA', 'PERITO', 'PERITA', 'MEDICO', 'MEDICA', 'FORENSE', 'DOCTOR', 'DOCTORA',
]);

// La primera pieza de un nombre detectado por contexto: no puede ser una palabra funcional ni un
// rótulo del escrito. Las iniciales («J.», «M.ª») sí valen.
export function esPrimeraPiezaDeNombre(pieza) {
  if (/^[\p{Lu}]\.[ªº]?$/u.test(pieza)) return true;
  return !NO_ES_PIEZA_DE_NOMBRE.has(clavePieza(pieza));
}

export const _paraPruebas = { esPieza, PARTICULA_NOMBRE };


// ───────────────────── ¿Es esto un nombre de persona? ─────────────────────
//
// La última puerta antes de que algo entre en la tabla como PERSONA. Lo destapó la medición con
// expedientes completos (2-oct): «Gestión Sanitaria Sevilla Norte-Macarena», «SENTENCIA
// ANTECEDENTES DE HECHO», «Valoración del Daño Corporal» o «Escala de Hamilton» entraban como
// personas, y la propagación esparcía luego «Sevilla» o «Ourense» por todo el expediente, hasta
// dentro del «Juzgado de lo Social número 7 de Sevilla». Se rechaza lo que empieza por una cabeza de
// institución o de documento, y lo que no tiene ni una pieza que pueda ser un nombre: todas son
// lugares, palabras institucionales, palabras corrientes del escrito o palabras que el propio texto
// escribe en minúscula («valoración», «sentencia», «protección»).
const CABEZAS_NO_PERSONA = new Set(`ESCALA INVENTARIO INVENTORY TEST CUESTIONARIO QUESTIONNAIRE INDICE PROGRAMA PLAN CONSULTA UNIDAD UNIDADE UNITAT AREA
DISTRITO COMANDANCIA PUESTO ASOCIACION ASSOCIACIO FUNDACION FUNDACIO SERVEIS SERVICIOS SERVIZO CENTRO CENTRE RENTA INGRESO PIEZA ORDEN DILIGENCIAS
DILIXENCIAS COUNTRY HUMAN AMERICAN HARVARD REPUBLICA BIZKAIKO GESTION RED XARXA SAREA OSASUN HOSPITAL HOSPITALARIO COMPLEXO COMPLEJO CONSORCIO
INSPECCION INSPECCIO OBSERVATORIO PROTOCOLO GUIA MANUAL INFORME DICTAMEN SENTENCIA AUTO DECRETO PROVIDENCIA ACTA ATESTADO EXPEDIENTE ANEXO
DOCUMENTO RECURSO DEMANDA ESCRITO REGISTRO COLEGIO SOCIEDAD GRUPO EQUIPO JEFATURA SUBDELEGACION DELEGACION FINQUES INMOBILIARIA ABOGADAS ABOGADOS
ADVOCATS DESPACHO BUFETE LABORATORIO CLINICA TANATORIO DESTACAMENTO SUBSECTOR AGRUPACION CENTRAL SECTOR SECRETARIA JUNTA AMPA COMITE GERENCIA RESIDENCIA CONSULADO EMBAJADA REFUGIO TUTELAR PACIENTES PERSONAS SOLICITANTES ORDENES MEDICA`.split(/\s+/).filter(Boolean));
const COMUNES = new Set(`FECHA DATA DATOS NOMBRE NOM APELLIDO APELLIDOS PERSONA MEDICO MEDICA MEDICOS PSICOLOGA PSICOLOGO PSIQUIATRA DIRECTOR DIRECTORA
RECURSOS HUMANOS SENTENCIA ANTECEDENTES HECHO HECHOS DIGO SUPLICO OTROSI PRIMERO SEGUNDO TERCERO CUARTO QUINTO SEXTO INCAPACIDAD
BENEFICIARIO BENEFICIARIA VALORACION DAÑO DANO CORPORAL LESIONES FISICAS PENAS PROTECCION SUBSIDIARIA NACIONALIDAD LENGUA PERFECTO
LUEGO SOBRE CUANTO PUEDEN ENTREVISTA INGRESOS MINIMO VITAL INSERCION GARANTIA MEDICINA FAMILIA CARDIOLOGIA NEUMOLOGIA PSIQUIATRIA
PSICOLOGIA NEUROLOGIA ONCOLOGIA GINECOLOGIA OBSTETRICIA URGENCIAS TRAUMATOLOGIA REUMATOLOGIA ENDOCRINOLOGIA DERIVADO DERIVADA
PERICIAL INFORME MEDICO PACIENTE TRANSP MAP NUESTR NUESTRO NUESTRA CONCLUSIONES CONSIDERACIONES EXPLORACION DIAGNOSTICO TRATAMIENTO
EVOLUCION MOTIVO JUICIO CLINICO ALTA BAJA PARTE FALLO RESUELVO ACUERDO DISPONGO PARTE DISPOSITIVA FUNDAMENTOS DERECHO ANTECEDENTES
MAGISTRADA MAGISTRADO JUEZ JUEZA MAXISTRADA XUIZA TRADUCTORA INTERPRETE TRAMITE ASUNTO ATENTAMENTE SALUDOS CORDIALES ENTIDAD GESTORA
CRITERIOS TRASTORNO ESTRES POSTRAUMATICO SINTOMAS ESCALA AMBITO CONCLUSION OBJETO METODOLOGIA ESTADO CIVIL EDAD SEXO DOMICILIO
LOCALIDAD PROVINCIA PAIS TELEFONO CORREO OCUPACION PROFESION CATEGORIA PUESTO TURNO NOCHE DIA CONTRATO CONVENIO NOMINA SALARIO
ORIENTACION SEXUAL IDENTIDAD ORIGEN NEANT MENCION RESOLUCION PROPUESTA DICTAMEN EQUIPO VALORACION INCAPACIDADES NOTIFICACION
CITACION SECRETARIA PROCEDIMIENTO PROCESO SITUACION SUPUESTO CASO NOTA OBSERVACIONES FIRMA FIRMADO FDO SELLO LUGAR HORA
TESTIGO CAUSA PREGUNTA RESPUESTA LETRADO LETRADA FISCAL DECLARANTE ACTOR ACTORA DEMANDANTE DEMANDADO DEMANDADA PARTIDA RESULTADO MOTIVO
ENJUICIAMIENTO CRIMINAL CIVIL PROTECCION COORDINACION REFUGIO ASILO TETUAN CAMERUN BAMENDA TANGER NADOR RABAT CASABLANCA DOUALA YAUNDE`.split(/\s+/).filter(Boolean));

export function pareceNombreDePersona(valor, texto = '', inicio = -1) {
  const piezas = valor.split(/[\s,]+/).filter(Boolean).filter((p) => !PARTICULA_NOMBRE.has(clavePieza(p)) && !/^(?:de|del|la|las|los|el|y|e|i|da|do|dos|das|van|von|d'|l')$/i.test(p));
  if (!piezas.length) return false;
  // Una sola pieza detrás de una preposición de lugar es un lugar o una ley, no una persona: «de
  // Sevilla», «en Tetuán», «da Lei», «del Ramón» (y Cajal). Con tratamiento delante no llega aquí
  // sola: «la Sra. de Miguel» trae el tratamiento.
  // Si la pieza es un nombre de pila del léxico, solo «de / del / da / do»: «aviso a Quique» lleva la
  // «a» de persona, y «En Pau» es el artículo catalán.
  const prep = esNombreDePila(piezas[0]) ? /(?:^|\s)(?:de|del|da|do)\s+$/ : /(?:^|\s)(?:de|del|da|do|en|desde|hacia|hasta)\s+$/;
  if (piezas.length === 1 && inicio > 0 && prep.test(texto.slice(Math.max(0, inicio - 8), inicio)) &&
    !/(?:D|Dª|D\.ª|Dña|Sr|Sra|Srta|don|doña)\.?\s+(?:de|del)\s+$/i.test(texto.slice(Math.max(0, inicio - 14), inicio))) return false;
  const k0 = clavePieza(piezas[0]);
  if (CABEZAS_NO_PERSONA.has(k0)) return false;
  const conNombre = piezas.some((p) => {
    if (esNombreDePila(p)) return true;
    const k = clavePieza(p);
    if (!k || k.length < 2) return false;
    if (INSTITUCION.has(k) || LUGARES.has(k) || COMUNES.has(k) || CABEZAS_NO_PERSONA.has(k)) return false;
    // ¿La escribe el propio texto en minúscula, como palabra corriente?
    const minus = p.toLowerCase();
    if (minus !== p && texto && new RegExp(`(?<![\\p{L}])${minus.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(texto)) return false;
    return true;
  });
  return conNombre;
}


// ───────────────────── Expedientes completos (2-oct): tres familias de personas ─────────────────────
//
// 1. El nombre con ARTÍCULO, como se habla y como escribe el catalán: «lo de la Leti», «el Roca va a
//    por Jordi», «la Xelo esa del sindicato», «del Ramon», «o Tito, o da CIG». Con un nombre de pila
//    del léxico basta; con un apellido suelto («el Roca»), solo en un texto informal (chat, correo).
const ARTICULO = /(?<![\p{L}'’])(?:el|la|l['’]|en|na|o|a|del|al|de\s+la|amb\s+el|amb\s+la|con\s+el|con\s+la|co|coa|do|da|ao|á)\s+([\p{Lu}][\p{Ll}'’-]+(?:\s+(?:de\s+|i\s+)?[\p{Lu}][\p{Ll}'’-]+){0,2})/gu;
export function nombresConArticulo(texto) {
  const fuera = [];
  const informal = pareceCorreo(texto) || /(?:^|\s)[\p{Lu}][\p{L}]+(?:\s+[\p{Lu}][\p{L}]+)?:\s/u.test(texto) && (texto.match(/(?:^|\s)[\p{Lu}][\p{L}]+(?:\s+[\p{Lu}][\p{L}]+)?:\s/gu) ?? []).length >= 3;
  ARTICULO.lastIndex = 0;
  let m;
  while ((m = ARTICULO.exec(texto)) !== null) {
    const nombre = m[1];
    const inicio = m.index + m[0].length - nombre.length;
    const piezas = nombre.split(/\s+/).filter((p) => !/^(?:de|i)$/.test(p));
    if (/^(?:Dr|Dra|Sr|Sra|Srta|Don|Doña|Dª|Fray|Sor|Mn|Mossèn|Padre|San|Santa|Sant)$/i.test(piezas[0])) continue;
    const pila = esNombreDePila(piezas[0]);
    if (!pila && !(informal && esApellidoPosible(piezas[0]))) continue;
    if (piezas.some((p) => INSTITUCION.has(clavePieza(p)) || LUGARES.has(clavePieza(p)))) continue;
    if (antesNoPersona(texto, inicio)) continue;
    // Un nombre de pila ambiguo («la Paz», «la Rosa», «el Pilar») solo con apellido detrás.
    if (pila && esAmbiguo(piezas[0]) && piezas.length < 2) continue;
    fuera.push({ tipo: 'PERSONA', valor: nombre, inicio, fin: inicio + nombre.length, via: 'contexto:articulo' });
  }
  return fuera;
}

// 2. Las iniciales en todas sus formas: «M. V. C., afiliada a CCOO», «Fdo.: J. PUIGVERT», «R.
//    Gámez (cód. 55812)», «Marta V.:», «Emmanuel N. - denegación». Con espacio entre las letras, una
//    inicial con su apellido, o un nombre de pila con la inicial del apellido.
const INI_ESPACIADAS = /(?<![\p{L}.])((?:[A-ZÁÉÍÓÚÑ]\.\s?){2,4})(?![\p{L}])/gu;
const INI_APELLIDO = /(?<![\p{L}\p{N}.\-])((?:[A-CE-ZÁÉÍÓÚÑ]\.\s?){1,2}(?:[\p{Lu}][\p{Ll}'’-]+|[\p{Lu}]{2,}[\p{Lu}0]*)(?:[\s-]+(?:[\p{Lu}][\p{Ll}'’-]+|[\p{Lu}]{2,}[\p{Lu}0]*))?)/gu;
const PILA_INICIAL = /(?<![\p{L}])([\p{Lu}][\p{Ll}]+\s+[A-ZÁÉÍÓÚÑ]\.)(?=\s*[:\-–—,);]|\s*$)/gu;
const NO_INI = new Set(['S.L.', 'S.A.', 'S.L.U.', 'S.A.U.', 'S.C.', 'C.B.', 'P.D.', 'P.O.', 'P.A.', 'J.V.', 'J.R.', 'D.U.', 'N.B.', 'E.P.', 'A.C.', 'C.P.', 'S.S.', 'D.P.', 'T.S.', 'T.C.', 'R.D.', 'L.O.', 'U.E.', 'A.N.', 'C.E.', 'C.C.', 'B.O.E.', 'I.T.', 'EE.UU.', 'S.M.', 'V.E.', 'V.I.', 'S.E.', 'A.P.', 'L.E.C.', 'C.P.N.']);
export function inicialesAmplias(texto) {
  const fuera = [];
  for (const m of texto.matchAll(INI_ESPACIADAS)) {
    const v = m[1].trim();
    if (NO_INI.has(v.replace(/\s/g, ''))) continue;
    if ((v.match(/\./g) ?? []).length < 2) continue;
    // Con algo que diga que es alguien: un trabajador, una firma, una coma de inciso o el final de una
    // firma; «S. L.» o «D. P.» sueltas no.
    const antes = texto.slice(Math.max(0, m.index - 40), m.index);
    const despues = texto.slice(m.index + m[1].length, m.index + m[1].length + 30);
    if (!/(?:treballador[a]?|trabajador[a]?|emplead[oa]|testigo|test(?:imoni|imoni)|menor|alumn[oae]s?|v[íi]ctima|Sr\.|Sra\.|Fdo\.?:?|firma(?:do)?:?|y|i|e|,|—|–|-)\s*$/i.test(antes) &&
      !/^\s*(?:,|\(|—|–|-|$)/.test(despues)) continue;
    fuera.push({ tipo: 'PERSONA', valor: v, inicio: m.index, fin: m.index + v.length, via: 'contexto:iniciales' });
  }
  for (const m of texto.matchAll(INI_APELLIDO)) {
    const v = m[1];
    const ini = (v.match(/^(?:[A-ZÁÉÍÓÚÑ]\.\s?)+/) ?? [''])[0].replace(/\s/g, '');
    if (NO_INI.has(ini)) continue;
    // Seguida de cifras es una referencia («P.A. 45/2024»), no una inicial.
    if (/^\s*\d/.test(texto.slice(m.index + v.length, m.index + v.length + 3))) continue;
    const apellidos = v.replace(/^(?:[A-ZÁÉÍÓÚÑ]\.\s?)+/, '').split(/[\s-]+/);
    if (apellidos.some((p) => INSTITUCION.has(clavePieza(p)) || LUGARES.has(clavePieza(p)) || COMUNES.has(clavePieza(p)))) continue;
    if (!apellidos.every((p) => esApellidoPosible(p.replace(/0/g, 'O')) || esNombreDePila(p))) continue;
    fuera.push({ tipo: 'PERSONA', valor: v, inicio: m.index, fin: m.index + v.length, via: 'contexto:inicial-apellido' });
  }
  for (const m of texto.matchAll(PILA_INICIAL)) {
    const pila = m[1].split(/\s+/)[0];
    if (!esNombreDePila(pila) || esAmbiguo(pila)) continue;
    fuera.push({ tipo: 'PERSONA', valor: m[1], inicio: m.index, fin: m.index + m[1].length, via: 'contexto:pila-inicial' });
  }
  return fuera;
}

// 3. Las fichas y hojas de datos (también del OCR y en las cuatro lenguas): «NOMBRE Y APELLIDOS:
//    JOSUE MONTOYA AMAYA», «APELLIDOS: GULIAS PEREIRO NOMBRE: BRAIS», «PADRES: RAFAEL Y REMEDIOS»,
//    «HIJO DE: MANUEL Y DE ROSA», «filla de Xosé e de Maruxa», «REPRESENTANT LEGAL: ROCIO AMAYA».
const ETIQUETA_FICHA = /(?<![\p{L}])(?:(?:nombre\s+y\s+apellidos|apellidos|nombre|nom\s+i\s+cognoms|cognoms|nom|izen-abizenak|padres|pares|representante?\s+legal|enfermer[oa]|facultativ[oa]|emplead[oa]\/?a?|madre|padre|mare|pare|c[óo]nyuge|tutor[a]?|guardador[a]?)\s*:|(?:hij[oa]|fill[ao]?|filla)\s+de\s*:?)\s*(?=[\p{Lu}])/giu;
const PIEZA_FICHA = "(?:[\\p{Lu}][\\p{L}'’-]+)";
const NOMBRE_FICHA = new RegExp(`^(${PIEZA_FICHA}(?:\\s+(?:(?:de|del|de la|DE|DEL|DE LA)\\s+)?${PIEZA_FICHA}){0,3}?)(?=\\s*(?:[,;/(:]|\\s(?:y|e|i|Y|E|I)\\s|\\s(?:${['DNI', 'NIE', 'NIF', 'D0CUM', 'DOCUM', 'FECHA', 'DATA', 'TEL', 'DOMICILI', 'D0MICILI', 'NACION', 'SEX', 'EDAD', 'LUGAR', 'NAC', 'HIJ', 'N0MBRE', 'NOMBRE', 'APELLID', 'PADRES', 'GURASO', 'HELBIDE', 'N0D', 'NOD', 'con', 'amb', 'na', 'en', 'de 1', 'de 2', 'nacid', 'nascud', 'mayor', 'vecin'].join('|')})|$))`, 'u');
export function nombresEnFicha(texto) {
  const fuera = [];
  ETIQUETA_FICHA.lastIndex = 0;
  let m;
  while ((m = ETIQUETA_FICHA.exec(texto)) !== null) {
    let pos = m.index + m[0].length;
    for (let n = 0; n < 3; n++) {
      const resto = texto.slice(pos, pos + 120);
      const x = resto.match(NOMBRE_FICHA);
      if (!x) break;
      const v = x[1];
      const piezas = v.split(/\s+/).filter((p) => !/^(?:de|del|la|DE|DEL|LA)$/.test(p));
      const valida = piezas.length && piezas.every((p) => !INSTITUCION.has(clavePieza(p.replace(/0/g, 'O'))) && !COMUNES.has(clavePieza(p.replace(/0/g, 'O')))) &&
        (piezas.some((p) => esNombreDePila(p.replace(/0/g, 'O'))) || piezas.length >= 2);
      if (valida) fuera.push({ tipo: 'PERSONA', valor: v, inicio: pos, fin: pos + v.length, via: 'contexto:ficha' });
      // «RAFAEL Y REMEDIOS», «Xosé e de Maruxa»: otra persona detrás de la conjunción.
      const sig = texto.slice(pos + v.length, pos + v.length + 12).match(/^\s+(?:y|e|i|Y|E|I)\s+(?:(?:de|DE)\s+)?(?=[\p{Lu}])/u);
      if (!sig) break;
      pos += v.length + sig[0].length;
    }
  }
  return fuera;
}


// La puerta ligera de la propagación: lo que ya está en la tabla se propaga, salvo que la variante
// sea SOLO un lugar, una palabra institucional o una corriente. «Tanatorio de Cáceres» entró una vez
// como persona y su variante «Cáceres» acababa tapada dentro de cada juzgado del expediente.
export function esSoloLugarOInstitucion(valor) {
  const piezas = valor.split(/[\s,]+/).filter(Boolean).filter((p) => !PARTICULA_NOMBRE.has(clavePieza(p)) && !/^(?:de|del|la|las|los|el|y|e|i|da|do|dos|das)$/i.test(p));
  if (!piezas.length) return true;
  return piezas.every((p) => { const k = clavePieza(p); return LUGARES.has(k) || INSTITUCION.has(k) || COMUNES.has(k) || CABEZAS_NO_PERSONA.has(k); });
}
