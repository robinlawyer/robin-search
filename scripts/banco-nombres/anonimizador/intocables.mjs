// Guardia de lo que NUNCA se tapa.
//
// La lista es la revisada por Alonso el 21-sep, después de comprobar que el dictamen de la AEPD
// 0049/2023 no la respalda (el pasaje que parecía criterio de la Agencia estaba en los antecedentes,
// y el propio texto manda anonimizar al agente que figura con nombre y apellidos). El fundamento
// que queda en pie es el sencillo: se deja con nombre real lo que el escrito NECESITA para ser
// válido y lo que ya es público dentro del propio procedimiento.
//
//   Siempre en claro
//     · órganos judiciales y su sede
//     · número de autos, de recurso, de ejecución, de diligencias
//     · ECLI y ROJ
//     · normas y artículos
//     · organismos públicos como institución
//     · magistrado ponente cuando viene de una resolución publicada
//     · Letrado de la Administración de Justicia y personal de la oficina judicial
//     · agente por su número de identificación profesional (TIP)
//
//   Fuera del bloque intocable (o sea, SE TAPAN)
//     · los peritos, todos — no por su condición de funcionario, sino porque el nombre del perito
//       no hace falta para que el escrito funcione, y la distinción público/privado no la sabe hacer
//       con fiabilidad ningún reconocedor automático
//     · los agentes actuantes con nombre y apellidos
//
// Esta guardia se aplica DESPUÉS del reconocedor: marca regiones protegidas del texto y descarta
// toda detección que caiga dentro. Es lo que impide que «Juzgado de Primera Instancia nº 5 de
// Madrid» o el ponente de una STS salgan tapados y el escrito deje de servir.

import { plegar } from './texto.mjs';

const T = (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');


// ───────────────────────────── Piezas comunes ─────────────────────────────
//
// Lo que cambió el 29-sep, después de medir con un corpus escrito a ciegas: las regiones de la
// guardia se estiraban «hasta la coma» o «hasta el punto», y eso se llevaba por delante lo que
// viniera detrás. «…la resolución de la Consejería de Salud y Consumo de la Junta de Andalucía que
// la excluyó … tras haber manifestado su objeción de conciencia a la práctica de la interrupción
// voluntaria del embarazo» dejaba EN CLARO dos datos de categoría especial, porque la Consejería
// llegaba hasta el punto. Ahora el nombre de una institución acaba donde acaban sus palabras:
// palabras con mayúscula, partículas entre ellas y números («nº 5»), y nada más.
//
// Y los nombres de ponente, LAJ y oficina judicial tienen que empezar por MAYÚSCULA. Antes la
// bandera `i` de esos patrones anulaba esa exigencia y «el juez acordó la prisión de Juan Pérez»
// protegía media frase.

// Una palabra, en mayúsculas o minúsculas y con las tildes que sean: «Consejería», «CONSEJERIA»,
// «consejería». Para las cabezas y los cargos, que no deciden nada por su capitalización.
const VOCAL = { a: 'aáàAÁÀ', e: 'eéèEÉÈ', i: 'iíïIÍÏ', o: 'oóòOÓÒ', u: 'uúüUÚÜ' };
const BASE = (c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function ci(texto) {
  let out = '';
  for (const c of texto) {
    const b = BASE(c);
    if (c === ' ') out += '\\s+';
    else if (VOCAL[b]) out += `[${VOCAL[b]}]`;
    else if (c === 'ñ' || c === 'Ñ') out += '[ñÑ]';
    else if (c === 'ç' || c === 'Ç') out += '[çÇ]';
    else if (/[a-z]/i.test(c)) out += `[${c.toLowerCase()}${c.toUpperCase()}]`;
    else out += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return out;
}
const alguno = (lista) => `(?:${[...lista].sort((a, b) => b.length - a.length).map(ci).join('|')})`;
// La cabeza de un nombre de institución: con MAYÚSCULA inicial (o toda en mayúsculas) y palabra
// entera. En minúscula, «equipo», «servicio», «centro» o «registro» son palabras corrientes: casaba
// «equipo» dentro de «equipo@despachovo.es», la región pisaba el correo y la guardia lo dejaba en
// claro. Y sin el límite del final, «Sala» casaba dentro de «Salamanca» y protegía a una persona.
function cap(texto) {
  const t = ci(texto);
  const primera = texto[0];
  const clase = t.startsWith('[') ? t.slice(0, t.indexOf(']') + 1) : null;
  if (!clase) return t;
  const mayus = /[a-z]/i.test(BASE(primera)) ? `[${[...clase.slice(1, -1)].filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).join('')}]` : clase;
  return `(?:${mayus}${t.slice(clase.length)})`;
}
const cabeza = (lista) => `(?<![\\p{L}\\p{N}@._-])(?:${[...lista].sort((a, b) => b.length - a.length).map(cap).join('|')})(?![\\p{L}\\p{N}@])`;

// Palabra con mayúscula (o toda en mayúsculas), incluido lo que llevan el catalán, el gallego y el
// euskera: «Instància», «Xustiza», «Ciències», «Col·legi».
const W = "[A-ZÁÉÍÓÚÑÇÀÈÒÏÜ][A-Za-zÁÉÍÓÚÑÇÀÈÒÏÜáéíóúñçàèòïü'’·-]*";
// Lo que NO sigue un nombre de institución aunque vaya con mayúscula: un tratamiento (ahí empieza
// una persona) o una vía (ahí empieza una dirección: «Comunidad de Propietarios de la Calle
// Mayor, 12» no es un organismo que proteja la calle).
const NO_SIGUE = `(?!(?:D\\.|Dª|D\\.ª|Dña\\.?|DÑA\\.?|Doña|DOÑA|DONA|Don|DON|Sr\\.|Sra\\.|SR\\.|SRA\\.|Dr\\.|Dra\\.|Excm[oa]\\.|Ilm[oa]\\.|EXCM[OA]\\.|ILM[OA]\\.|Calle|CALLE|Avenida|AVENIDA|Avda|AVDA|Carrer|CARRER|R[úu]a|Paseo|PASEO|Passeig|Kalea?|KALEA?|Camino|CAMINO|Plaza\\s+(?!n[ºo°]|N[ºO°])|` +
  // Palabras de trámite: donde acaba el nombre del órgano en un escaneo en mayúsculas.
  `CONTRA|Contra|SENTENCIA|Sentencia|AUTOS?|Autos?|RECURSO|Recurso|SEGUIDOS|INTERPUESTO|VISTOS?|Vistos?|EN|En|POR|Por|` +
  `QUE|Que|ANTE|Ante|HECHOS|FALLO|DILIGENCIA|Diligencia|PROVIDENCIA|Providencia|DECRETO|EXPEDIENTE|Expediente|` +
  `PROCEDIMIENTO|Procedimiento|NIG|ROLLO|Rollo|SUMARIO|Sumario|INFORME|Informe|PACIENTE|Paciente|MOTIVO|Motivo|` +
  `ANTECEDENTES|DIAGNOSTICO|DIAGNÓSTICO|Diagn[óo]stico|TRATAMIENTO|Tratamiento|EXPLORACION|EXPLORACIÓN|JUICIO|BENEFICIARIO|` +
  `TRABAJADOR|CONDUCTOR|DENUNCIANTE|TESTIGO|FIRMA|FDO|RESUELVE|Resuelve|ACUERDA|Acuerda|DISPONGO|ASUNTO|Asunto)(?![\\p{L}]))`;
// El número de un órgano o de una sección: corto (hasta tres cifras) y que no sea el principio de
// un identificador. Sin esa condición, «afiliación a la Seguridad Social 28/1234567890» metía el
// «28» en el nombre del organismo, la región pisaba el número de afiliación y la guardia lo
// dejaba en claro.
// «n.º» (con el punto ANTES del ordinal) es como lo escribe casi todo el mundo, y no estaba: «Juzgado de lo
// Penal n.º 1 de Logroño» se cortaba en «Penal» (2-oct).
const NUM = '(?:(?:n\\.?\\s?[ºo°]|N\\.?\\s?[ºO°]|n[úu]m(?:ero)?|N[ÚU]M(?:ERO)?)\\.?\\s*\\d{1,3}|\\d{1,3}(?:\\.?[ªº])?|[IVXL]{1,4}(?![\\p{L}]))(?![\\d/.,-]?\\d)';
// Sin «en», «a», «para» ni «contra»: en un escaneo TODO va con mayúscula y, con ellas, «INSTITUTO
// NACIONAL DE LA SEGURIDAD SOCIAL CONTRA LA SENTENCIA DEL JUZGADO…» seguía siendo el organismo.
const PARTI = '(?:de|del|de la|de los|de las|y|e|i|la|el|los|las|lo|da|do|das|dos|sobre)';
// La cola de un nombre de institución: palabras con mayúscula o números, con partículas entre
// ellas, o «d'Esquadra».
const COLA = `(?:(?:\\s+${PARTI})*\\s+${NO_SIGUE}(?:${NUM}|${W})|\\s*(?:d'|l'|D'|L')${W})*`;
// Lo que un órgano judicial lleva detrás de una coma y sigue siendo su nombre: la sección, la
// plaza, la sede. «Tribunal de Instancia de Madrid, Sección de Familia, Infancia y Capacidad,
// Plaza nº 22». Nada más: detrás de la coma de un juzgado puede venir una persona.
const SIGUE_TRAS_COMA = `(?:,\\s*(?:${alguno(['Sección', 'Secció', 'Sala', 'Plaza', 'Plaça', 'con sede en', 'amb seu a', 'con sede na'])})(?![\\p{L}])${COLA}|,\\s*${ci('Infancia y Capacidad')})*`;
const RX = (fuente) => new RegExp(fuente, 'gu');

// El cargo judicial, en las cuatro lenguas y escrito como venga. «Presidente» a secas NO está: el
// presidente de una comunidad de propietarios no es un órgano judicial. Solo en la lista de la Sala
// o entre paréntesis detrás del nombre.
const CARGO_JUDICIAL = alguno([
  'Magistrado-Juez', 'Magistrada-Jueza', 'Magistrada-Juez', 'Magistrado', 'Magistrada', 'Juez de Paz', 'Jueza de Paz',
  'Jueza', 'Juez', 'Jutge', 'Jutgessa', 'Magistrat', 'Magistrada-Jutgessa', 'Maxistrado', 'Maxistrada',
  'Maxistrada-Xuíza', 'Maxistrado-Xuíz', 'Xuíz', 'Xuíza', 'Ponente',
  'Letrado de la Administración de Justicia', 'Letrada de la Administración de Justicia',
  "Lletrat de l'Administració de Justícia", "Lletrada de l'Administració de Justícia",
  'Letrado da Administración de Xustiza', 'Letrada da Administración de Xustiza',
  'Justizia Administrazioko letratua', 'LAJ', 'Secretario judicial', 'Secretaria judicial',
  'Secretario del Juzgado', 'Secretaria del Juzgado', 'Encargado del Registro Civil', 'Encargada del Registro Civil',
  'Tramitador Procesal', 'Tramitadora Procesal', 'Gestor Procesal', 'Gestora Procesal', 'Auxilio Judicial',
  'funcionario del Cuerpo de Auxilio Judicial', 'funcionaria del Cuerpo de Auxilio Judicial',
  'funcionario del Cuerpo de Tramitación Procesal', 'funcionaria del Cuerpo de Tramitación Procesal',
  'funcionario del Cuerpo de Gestión Procesal', 'funcionaria del Cuerpo de Gestión Procesal',
  'Tramitador Procesal y Administrativo', 'Tramitadora Procesal y Administrativa',
  // El Constitucional: la Sección la preside un magistrado y el LAJ se llama «secretario de Justicia».
  'Presidente de la Sección', 'Presidenta de la Sección', 'Presidente de la Sala', 'Presidenta de la Sala',
  'Presidente del Tribunal', 'Presidenta del Tribunal', 'Secretario de Justicia', 'Secretaria de Justicia',
  'Gestor Procesal y Administrativo', 'Gestora Procesal y Administrativa',
]);
// El tratamiento que puede ir delante del nombre: «Ilmo. Sr. D.», «Dña.», «ILMA. SRA. DÑA.».
const TRATO = '(?:(?:Excm[oa]|Ilm[oa]|EXCM[OA]|ILM[OA])\\.\\s*)?(?:(?:Sr|Sra|SR|SRA)\\.\\s*)?(?:(?:D\\.\\s?ª|Dª\\.?|D\\.|Dña\\.|DÑA\\.|dña\\.|Doña|DOÑA|DONA|doña|Don|DON|don|Dr\\.|Dra\\.)\\s*)?';
// El nombre protegido: piezas con mayúscula, partículas entre ellas, SIN la «y» (que separa a los
// magistrados de una lista, no los junta).
// Y se para en lo que ya no es el nombre: otro cargo, un tratamiento, o la palabra que abre la
// frase siguiente (en producción no hay saltos de línea: «…D. Rodrigo Valcárcel Ybarra Letrado de
// la Administración de Justicia: Ilmo. Sr. D. Andrés…» se leía como un solo nombre de seis piezas
// y el LAJ quedaba fuera).
const PARA_NOMBRE = `(?!${CARGO_JUDICIAL}(?![\\p{L}])|${alguno(['En', 'El', 'La', 'Los', 'Las', 'Lo', 'Por', 'Con', 'Que', 'Doy', 'Firmado', 'Fdo', 'Visto', 'Vistos', 'Ante', 'Ilmo', 'Ilma', 'Excmo', 'Excma', 'Sr', 'Sra', 'Don', 'Doña', 'Dña', 'Letrado', 'Letrada', 'Magistrados', 'Presidente', 'Presidenta', 'Secretario', 'Secretaria', 'Contra', 'Madrid', 'Sentencia', 'Auto', 'Providencia', 'Diligencia', 'Recurso', 'Antecedentes', 'Hechos', 'Fundamentos', 'Fallo', 'Primero', 'Segundo'])}(?![\\p{L}]))`;
const NOMBRE_J = `${W}(?:\\s+(?:(?:de|del|de la|de los|i|DE|DEL|DE LA|I)\\s+)?${PARA_NOMBRE}${W}){0,5}`;

// Cada patrón puede llevar un grupo 1; si lo lleva, se protege SOLO ese grupo (sirve para
// «Ponente: Excmo. Sr. D. <nombre>», donde lo que hay que proteger es el nombre, no la etiqueta).
const PATRONES = [
  // ── Órganos judiciales y su sede ────────────────────────────────────────────────
  // En las cuatro lenguas: Juzgado, Jutjat, Xulgado; Tribunal (también el de Instancia de la LO
  // 1/2025, con su sección y su plaza), Audiencia, Audiència, Sala; y el euskera, que pone el
  // nombre DELANTE: «Bilboko Lehen Auzialdiko 5 zenbakiko Epaitegia».
  { clase: 'ORGANO', preFold: /juzgad|jutjat|xulgad|tribunal|audiencia|sala|seccio/, re: RX(`${cabeza(['Juzgado', 'Juzgados', 'Jutjat', 'Jutjats', 'Xulgado', 'Xulgados', 'Tribunal', 'Tribunales', 'Tribunals', 'Audiencia', 'Audiència', 'Sala', 'Secció'])}${COLA}${SIGUE_TRAS_COMA}`) },
  { clase: 'ORGANO', re: RX(`(?<![\\p{L}])${W}(?:\\s+[\\p{L}\\d]+){0,7}\\s+(?:Epaitegia|EPAITEGIA|Auzitegia|AUZITEGIA)(?![\\p{L}])`) },
  { clase: 'ORGANO', re: T(/\bSecci[óo]n\s+\d+[ªº]?(?:\s*\([^)]*\))?/i) },
  // ── Número de autos, recurso, ejecución, diligencias, expediente sancionador ────
  { clase: 'AUTOS', re: T(/\b(?:Autos|AUTOS|Procedimiento(?:\s+(?:Ordinario|Abreviado))?|PROCEDIMIENTO(?:\s+(?:ORDINARIO|ABREVIADO))?|Juicio\s+Ordinario|JUICIO\s+ORDINARIO|Ordinario|Recurso(?:\s+de\s+(?:Casaci[óo]n|Apelaci[óo]n|Suplicaci[óo]n))?|Rollo(?:\s+de\s+Apelaci[óo]n)?|Ejecuci[óo]n(?:\s+de\s+T[íi]tulos\s+Judiciales)?|Diligencias(?:\s+(?:Previas|Urgentes))?)\s*(?:n[úu]m\.?|n[ºo]\.?)?\s*[\d.]+\/\d{2,4}\b/i) },
  { clase: 'AUTOS', re: T(/\bPS\/\d+\/\d{4}\b/) },
  // «Jurisdicción voluntaria 1422/2026», «Expediente de jurisdicción voluntaria n.º 88/2025», «Diligencias indeterminadas 12/2026».
  { clase: 'AUTOS', re: T(/(?<![\p{L}])(?:(?:Expediente\s+de\s+)?jurisdicci[óo]n\s+voluntaria|diligencias\s+indeterminadas|medidas\s+(?:provisionales|cautelares|de\s+apoyo)|guarda\s+y\s+custodia|modificaci[óo]n\s+de\s+medidas|divorcio\s+(?:contencioso|de\s+mutuo\s+acuerdo)|filiaci[óo]n|sucesiones?)\s*(?:n[ºo.]*\s*)?\d+\/\d{2,4}/iu) },
  // «Expediente de provisión de apoyos n.º 1422/2026», «Expediente de reforma n.º 12/2026»: el expediente con
  // su materia y su número es la referencia del procedimiento.
  { clase: 'AUTOS', re: T(/(?<![\p{L}])(?:Expediente|EXPEDIENTE|Exp\.)\s+(?:de|DE)\s+[^.;\n]{3,50}?\s*n[.º°o]*\s*\d+\/\d{2,4}/u) },
  // «T. Instancia Zaragoza Secc. Civil», «TRIB. INSTANCIA …»: el Tribunal de Instancia abreviado.
  { clase: 'ORGANO', re: T(/(?<![\p{L}])(?:T\.|TRIB\.|Trib\.)\s*(?:DE\s+|de\s+)?(?:INSTANCIA|Instancia)(?:\s+(?:DE\s+|de\s+)?[\p{Lu}][\p{L}-]+)?(?:\s*,?\s*(?:SECC\.|Secc\.|SECCI[ÓO]N|Secci[óo]n)\s*[\p{L}\d]+)?/u) },
  // Las abreviaturas de procedimiento: «P.A. 45/2024», «D.P. 412/2026», «J.V. 88/2025», «D.U. 3/2026».
  { clase: 'AUTOS', re: T(/(?<![\p{L}])(?:P\.\s?A\.|P\.\s?O\.|D\.\s?P\.|D\.\s?U\.|J\.\s?V\.|J\.\s?R\.|E\.\s?T\.\s?J\.|P\.\s?S\.|R\.\s?A\.|PA|DP|DU|ETJ|JV)\s*(?:n[ºo.]*\s*)?\d+\/\d{2,4}/u) },
  // Tipos de procedimiento que el corpus de validación destapó y que la primera lista no cubría:
  // conciliación, arbitraje, concurso, monitorio, verbal, ejecutoria, sumario, expediente. El
  // patrón es siempre el mismo —nombre del procedimiento + número/año—, así que se amplía la
  // familia, no se parchea el caso.
  { clase: 'AUTOS', re: T(/\b(?:Acto\s+de\s+conciliaci[óo]n|Conciliaci[óo]n|Procedimiento\s+arbitral|Arbitraje|Concurso(?:\s+(?:Abreviado|Voluntario|Necesario|Consecutivo))?|Monitorio|Cambiario|Juicio\s+Verbal|Verbal|Ejecutoria|Sumario|Expediente(?:\s+(?:de\s+\w+|gubernativo))?|Divorcio|Medidas(?:\s+\w+)?|Desahucio|Incidente|Pieza(?:\s+\w+)?|Exhorto|Dilig\.?\s*Prep\.?)\s*(?:n[úu]m\.?|n[ºo]\.?)?\s*[\d.]+\/\d{2,4}\b/i) },
  // Expedientes administrativos con referencia alfanumérica: «2025/SAN/00412».
  { clase: 'AUTOS', re: T(/\b(?:[Ee]xpediente|EXPEDIENTE)(?:\s+\w+)?\s+\d{4}\/[A-Z]{2,5}\/\d+\b/) },
  { clase: 'AUTOS', re: T(/\bexpediente\s+(?:sancionador|de\s+protecci[óo]n|gubernativo|disciplinario)\s+(?:n\.?\s?[º°o]\.?\s*)?[\w/.-]*\d[\w/.-]*/i) },
  { clase: 'AUTOS', re: T(/\bATESTADO\s+N[UÚ]MERO\s+[\d.]+\/\d{4}/i) },

  // ── ECLI y ROJ ─────────────────────────────────────────────────────────────────
  { clase: 'ECLI', re: T(/\bECLI:[A-Z]{2}:[A-Z]+:\d{4}:\d+\b/) },
  { clase: 'ROJ', re: T(/\bROJ:\s*[A-Z]+\s+[A-Z]*\s*\d+\/\d{4}\b/) },

  // ── Normas y artículos ─────────────────────────────────────────────────────────
  // El punto NO cierra la cita: «artículo 12.3», «artículo 83.5.b)» y «artículo 250.1.1» llevan
  // puntos dentro. Cierra el punto seguido de espacio o de fin, que es el final de la frase.
  // La cita acaba donde empieza la siguiente oración. Sin este corte, «…del Reglamento General de
  // Circulación cometida con el vehículo matrícula 9012 MNP.» quedaba ENTERA dentro de la región
  // protegida y la matrícula salía en claro: la guardia, estirada de más, destapa.
  { clase: 'NORMA', re: T(/\bart[íi]culos?\s+[^\n]*?(?=\.(?:\s|$)|,\s+(?:y\s+)?(?:en|de\s+conformidad|siguiendo)|\s+(?:cometid[oa]|en\s+relaci[óo]n|respecto|por\s+la|para\s+la|y\s+se\s|que\s+se\s)|\n|$)/i) },
  { clase: 'NORMA', re: T(/\bART[IÍ]CULOS?\s+[^\n]*?(?=\.(?:\s|$)|\s+(?:COMETID[OA]|EN\s+RELACION|POR\s+LA)|\n|$)/i) },
  { clase: 'NORMA', re: T(/\b(?:Ley(?:\s+Org[áa]nica)?|LEY(?:\s+ORG[ÁA]NICA)?|Real\s+Decreto(?:\s+Legislativo)?|REAL\s+DECRETO(?:\s+LEGISLATIVO)?|Decreto|Reglamento(?:\s+\(UE\))?|Directiva|Texto\s+Refundido[^.,;\n]*)\s*(?:\(UE\)\s*)?[\d./]+(?:\/(?:CEE|UE|CE))?[^.\n]*?(?=\.(?:\s|$)|\n|$)/i) },
  { clase: 'NORMA', re: T(/\b(?:C[óo]digo\s+(?:Civil|Penal|de\s+Comercio)|CODIGO\s+(?:CIVIL|PENAL)|Constituci[óo]n\s+Espa[ñn]ola|CONSTITUCION\s+ESPANOLA|Ley\s+de\s+Enjuiciamiento\s+(?:Civil|Criminal)|LEY\s+DE\s+ENJUICIAMIENTO\s+(?:CIVIL|CRIMINAL)|Estatuto\s+de\s+los\s+Trabajadores|Ley\s+de\s+Sociedades\s+de\s+Capital|Ley\s+General\s+Tributaria|Reglamento\s+General\s+de\s+Circulaci[óo]n|Tratado\s+de\s+Funcionamiento\s+de\s+la\s+Uni[óo]n\s+Europea)\b/i) },
  // La cita abreviada («art. 16 CE», «ART. 52 C) ET», «art. 140.3 LRJS», «art. 68 e ET») y la gallega
  // («artigo 92 da Lei 39/2015»). Hasta el 2-oct nada intentaba taparlas y no se veía que la guardia
  // no las conocía; con el tramo sensible, una frase con un dato y una cita se llevaba la cita.
  { clase: 'NORMA', re: T(/(?<![\p{L}])(?:arts?\.|ARTS?\.|Arts?\.|art[íi]culos?|ART[ÍI]CULOS?|artigos?|ARTIGOS?|articles?|artikulua)\s*\d+(?:[.,]\d+)*(?:\.?\s?[ªº])?(?:\s*(?:bis|ter|quater|quinquies))?(?:\s*\.?[a-zA-Z]\)|\.[a-z](?![\p{L}])|\s+[a-z](?=\s+[A-Z]))?(?:\s*(?:,|y|e|i)\s*\d+(?:[.,]\d+)*(?:\s*[a-zA-Z]\))?)*(?:\s+(?:de\s+la|del|de|da|do|de\s+les|dels|de\s+l')\s*[A-ZÁÉÍÓÚ][^\s,;.)]*(?:\s+(?:[A-ZÁÉÍÓÚ0-9][^\s,;)]*|de|del|la|do|da|das|dos|y|e|i))*|\s+(?:[A-Z][A-Za-z]{1,7})(?![\p{L}]))?/u) },
  { clase: 'NORMA', re: T(/\b(?:STS|STC|SAP|STSJ)\s+[\d.]+\/\d{4}\b/) },
  { clase: 'NORMA', re: T(/\bSentencia\s+n[úu]m\.?\s*[\d.]+\/\d{4}\b/i) },
  { clase: 'NORMA', re: T(/\basuntos?\s+(?:acumulados\s+)?C-\d+\/\d{2}(?:[,\s]+(?:y\s+)?C-\d+\/\d{2})*/i) },
  { clase: 'NORMA', re: T(/\b\d{3}\/\d{4},\s+de\s+\d{1,2}\s+de\s+[a-záéíóú]+/i) },

  // ── Organismos públicos como institución ───────────────────────────────────────
  // La cabeza (Ministerio, Consejería, Instituto, Registro…) y la cola de su nombre, que acaba
  // donde acaban las palabras con mayúscula. En las cuatro lenguas.
  { clase: 'ORGANISMO', preFold: /ministeri|conse(?:j|ll)|departament|direcci|delegaci|secretar|subdirecci|institut|agenci|servi(?:ci|zo)|unida|unitat|oficina|equipo|regist|rexistro|fiscal|ayuntamiento|ajuntament|concello|diputaci|deputaci|cabildo|consell|consejo|xunta|generalitat|gobierno|govern|goberno|principado|hacienda|tesorer|col·legi|colegio|colexio|camara|corte|universi|mutua|hospital|centro|comisar|comissar|polic|mossos|ertzaintza|guardia civil|defensor|sindic|ararteko|valedor|banco de espana|concejal|regidoria|seguridad social|abogacia|comunidad|junta de|fondo de garantia|cuerpo nacional/, re: RX(`${cabeza([
    'Ministerio', 'Consejería', 'Conselleria', 'Consellería', 'Departamento', 'Departament', 'Dirección', 'Direcció',
    'Delegación', 'Subdelegación', 'Secretaría', 'Subdirección', 'Instituto', 'Institut', 'Institutu', 'Agencia',
    'Agència', 'Servicio', 'Servei', 'Servizo', 'Unidad', 'Unitat', 'Oficina', 'Equipo', 'Registro', 'Registre',
    'Rexistro', 'Fiscalía', 'Fiscalia', 'Ayuntamiento', 'Ajuntament', 'Concello', 'Diputación', 'Diputació',
    'Deputación', 'Cabildo', 'Consell', 'Consello', 'Consejo', 'Xunta', 'Generalitat', 'Gobierno', 'Govern',
    'Goberno', 'Principado', 'Hacienda', 'Tesorería', 'Colegio', 'Col·legi', 'Colexio', 'Ilustre Colegio',
    'Cámara', 'Corte', 'Universidad', 'Universitat', 'Mutua', 'Hospital', 'Centro', 'Comisaría', 'Comissaria',
    'Policía', 'Policia', 'Mossos', 'Ertzaintza', 'Guardia Civil', 'Defensor del Pueblo', 'Síndic de Greuges',
    'Ararteko', 'Valedor do Pobo', 'Banco de España', 'Concejalía', 'Regidoria', 'Seguridad Social',
    'Abogacía del Estado', 'Ministerio Fiscal', 'Comunidad Autónoma', 'Comunidad Foral', 'Comunidad de Madrid',
    'Comunidad Valenciana', 'Junta de Andalucía', 'Junta de Castilla', 'Junta de Extremadura',
    'Junta de Comunidades', 'Junta de Galicia', 'Fondo de Garantía Salarial', 'Cuerpo Nacional de Policía',
    'Policía Nacional', 'Policía Local', 'Policía Municipal', 'Policía Foral', 'Equipo de Valoración', 'Jefatura',
    'Dirección General de Tráfico', 'Comisión Técnica', 'Servicios Sociales', 'Punto de Encuentro',
    // La sanidad como institución (2-oct): en un informe clínico, con el tramo sensible, el nombre
    // del servicio o del centro se llevaba por delante si la guardia no lo conocía.
    'Unidade', 'Área Sanitaria', 'Area Sanitaria', 'Área de Gestión Sanitaria', 'Distrito Sanitario', 'Sector',
    'Complexo Hospitalario', 'Complejo Hospitalario', 'Consorcio', 'Centro de Salud', 'Centre de Salut',
    'Centro de Saúde', 'Red de Salud Mental', 'Servizo Galego de Saúde', 'Asociación', 'Associació', 'Fundación',
    'Fundació', 'Programa', 'Colegio Oficial', 'Real e Ilustre Colegio', 'Consulado', 'Embajada', 'Comisión',
    'Inspección Médica', 'Inspección de Trabajo', 'Inspecció de Treball', 'Atención Primaria', 'Urgencias',
  ])}${COLA}`) },
  // La especialidad dicha como servicio, solo con su ancla institucional: «Neumología HUVR», «Salud Mental de
  // Conxo», «Salud Mental Infanto-Juvenil». A secas («derivado a Salud Mental») es un hecho de la persona,
  // no una institución, y la auditoría de fugas del 2-oct lo vio salir en claro.
  { clase: 'ORGANISMO', re: RX(`(?<![\\p{L}])(?:Neumolog[íi]a|Cardiolog[íi]a|Psiquiatr[íi]a|Psicolog[íi]a(?:\\s+Cl[íi]nica)?|Oncolog[íi]a(?:\\s+M[ée]dica)?|Neurolog[íi]a|Endocrinolog[íi]a|Ginecolog[íi]a|Obstetricia|Pediatr[íi]a|Traumatolog[íi]a|Reumatolog[íi]a|Urolog[íi]a|Oftalmolog[íi]a|Dermatolog[íi]a|Nefrolog[íi]a|Hematolog[íi]a|Digestivo|Medicina\\s+(?:Interna|de\\s+Familia|Legal|del\\s+Trabajo|Intensiva|Preventiva)|Salud\\s+Mental|Sa[úu]de\\s+Mental|Salut\\s+Mental|Atenci[óo]n\\s+Primaria|Enfermedades\\s+Infecciosas|Cirug[íi]a\\s+General)(?:\\s+(?:Infanto-?Juvenil|Infantil|Comunitaria|[A-Z]{2,6}|de\\s+[A-Z][\\p{L}-]+|del\\s+Hospital[^.,;]{0,60}))(?![\\p{L}])`) },
  // El euskera pone la cabeza al final: «Lan Harremanen Kontseilua», «Bizkaiko Foru Aldundia».
  { clase: 'ORGANISMO', re: RX(`(?<![\\p{L}])(?:${W}\\s+){1,5}(?:Kontseilua|KONTSEILUA|Aldundia|ALDUNDIA|Udala|UDALA|Jaurlaritza|JAURLARITZA|Saila|Zuzendaritza|Ogasuna|Fiskaltza|Batzordea)(?![\\p{L}])`) },
  // Siglas de organismos: van en mayúsculas y sin puntos. El reconocedor las marca como
  // organización o como persona; son instituciones y se quedan en claro.
  { clase: 'ORGANISMO', re: T(/\b(?:SAMU|SUMMA|SVB|SVA|INTCF|IMLCF|AECC|EOEP|EOE|HUMV|HUJ|HUVN|HCUV|HUCA|SES|SACYL|SESCAM|SERMAS|SESPA|SCS|SMS|PAIPSE|CPEE|CEIP|IES|AMPA|AFA|ICAVA|ICAB|ICAV|CODINUGAL|UVIVG|EVO|CRMF|IASS|CTA|UTCA|UVI|CSMIJ|CSMA|CSM|USMIJ|USMI|USMC|USM|UCI|CAP|CAS|CAD|CRAE|CDIAP|CHUO|CHUS|CHUAC|HUVR|HUVM|HUCA|EVI|CIM|OAR|ICASS|IMSERSO|INSS|TGSS|SEPE|AEAT|INEM|ICO|CNMV|CNMC|AEPD|SEPA|ISM|IMV|FOGASA|SMAC|CMAC|IRPF|IVA|INE|BOE|BORME|DGT|DGSFP|DGSJFP|CGPJ|TEAC|TEAR|TACRC|ICAM|SAREB|FROB|CORA|MUFACE|MUGEJU|ISFAS|UCO|UDEF|SEPBLAC|UVFI|OAV|IML|IMLCF|CRL|TSJ|LexNET|SAS|SERGAS|SESCAM|ICS|SERMAS|OSAKIDETZA|CAID|CAD|IVASS)\b/) },
  // La sigla de un centro sanitario con su lugar: «CSMIJ del Gironès», «USMC Macarena Norte», «CAP
  // Güell», y la de uno extranjero tras «en el»: «en el UKE de Hamburgo».
  { clase: 'ORGANISMO', re: T(/(?<![\p{L}])(?:CSMIJ|CSMA|CSM|USMIJ|USMI|USMC|USM|CAP|CAS|CAD|CDIAP|HUVR|HUVM|CHUO|CHUS)\s+(?:(?:del|de\s+la|de|d')\s*)?[\p{Lu}][\p{L}·'’-]+(?:\s+[\p{Lu}][\p{L}·'’-]+)?/u) },
  { clase: 'ORGANISMO', re: T(/(?<=(?:^|\s)(?:en|del|al)\s+(?:el\s+|la\s+)?)[A-Z]{2,6}\s+(?:de|del)\s+[\p{Lu}][\p{L}-]+/u) },
  // ── Ponente, LAJ y oficina judicial: nombres que NO se tapan, por su cargo ─────
  // Protege SOLO el nombre (grupo 1), y el nombre empieza por mayúscula. El cargo puede ir
  // delante («La Letrada de la Administración de Justicia, Dña. Soledad Montero Lagos»,
  // «Magistrado sustituto: D. …», «A maxistrada-xuíza, Uxía Rodríguez Seoane») o detrás
  // («VISTOS POR D. ALFONSO PEREA CAÑIZARES, MAGISTRADO-JUEZ», «Doy fe, Almudena Recio Tobar,
  // Letrada de la Administración de Justicia», «ILMA. SRA. DÑA. MERCE ALEGRET FONT (PONENTE)»).
  { clase: 'PONENTE', pre: /magistr|juez|jueza|jutge|maxistr|xu[íi]z|ponente|letrad|lletrad|letratu|\bLAJ\b|secretari|encargad|tramitad|gestor|auxilio|funcionari|Magistrat/i, re: RX(`(?<![\\p{L}])${CARGO_JUDICIAL}(?:\\s+${alguno(['sustituto', 'sustituta', 'titular', 'de guardia', 'en funciones'])})?\\s*[,:]?\\s*(?:${alguno(['el', 'la', 'o', 'a'])}\\s+)?${TRATO}(${NOMBRE_J})`), grupo: 1 },
  { clase: 'PONENTE', pre: /magistr|juez|jueza|jutge|maxistr|xu[íi]z|ponente|letrad|lletrad|letratu|\bLAJ\b|secretari|encargad|tramitad|gestor|auxilio|funcionari|Magistrat/i, re: RX(`${TRATO}(${NOMBRE_J})\\s*,\\s*(?:${alguno(['el', 'la', 'els', 'les', 'o', 'a'])}\\s+)?${CARGO_JUDICIAL}(?![\\p{L}])`), grupo: 1 },
  { clase: 'PONENTE', pre: /ponente|president/i, re: RX(`${TRATO}(${NOMBRE_J})\\s*\\((?:[^)]*?${alguno(['ponente', 'presidente', 'presidenta'])})[^)]*\\)`), grupo: 1 },
  // «Lo acuerda y firma S.Sª Dña. Pilar Encinas Llorente»
  { clase: 'PONENTE', pre: /S\.?\s?S\.?\s?[ªa]/, re: RX(`(?<![\\p{L}])S\\.?\\s?S\\.?\\s?(?:ª|a)\\.?\\s*(?:${alguno(['Ilma.', 'Ilmo.'])}\\s*)?${TRATO}(${NOMBRE_J})`), grupo: 1 },
  // «ante el Juez de Paz, D. …, asistido del Secretario, D. …»
  { clase: 'LAJ', pre: /asistid[oa]\s+de/i, re: RX(`${alguno(['asistido del Secretario', 'asistida del Secretario', 'asistido de la Secretaria', 'asistida de la Secretaria', 'asistido del Secretario judicial', 'asistida de la Secretaria judicial'])}\\s*,?\\s*${TRATO}(${NOMBRE_J})`), grupo: 1 },

  // ── Agente por su TIP (sin nombre) ─────────────────────────────────────────────
  // Con letra o sin ella: «TIP U-34215», «TIP 118442», «agente TIP 4455».
  { clase: 'TIP', re: T(/\b(?:TIP|T\.I\.P\.)\s*(?:n[ºo]\.?\s*|n[úu]m\.?\s*)?[A-Z]?-?\d{3,}(?:-[A-Z])?\b/i) },
  { clase: 'TIP', re: T(/\b(?:carn[ée]\s+profesional|n[úu]mero\s+profesional|placa)\s*(?:n[ºo]\.?\s*|n[úu]m(?:ero)?\.?\s*)?[A-Z]?-?\d{3,}\b/i) },
];

// La composición de la Sala: «Magistrados: Montserrat Comas Ribalta (presidenta y ponente), Josep
// Maria Riera Tió y Rafael Mora Serrano.» Cada nombre de la lista es un magistrado.
// También «Ilmos. Sres.: Presidente D. …; Magistrados D.ª …» (con o sin dos puntos).
const LISTA_SALA = RX(`(?:${alguno(['Magistrados', 'Magistradas', 'Magistrats', 'Maxistrados', 'Integran la Sala', 'Componen la Sala'])}\\s*:?|${alguno(['Ilmos. Sres.', 'Ilmas. Sras.', 'Excmos. Sres.', 'Ilmos. Sres', 'Excmos. Sres'])}\\s*:)\\s*((?:[^.\\n]|(?<=(?<![\\p{L}])(?:D|Dª|Dña|Sr|Sra|Excmo|Ilmo|Excma|Ilma))\\.|(?<=D)\\.ª)+)`);
const NOMBRE_EN_LISTA = RX(`${TRATO}(${NOMBRE_J})`);

// Devuelve las regiones protegidas del texto: [{ clase, inicio, fin }].
export function regionesIntocables(texto) {
  const fuera = [];
  LISTA_SALA.lastIndex = 0;
  let l;
  if (/Magistrad|Magistrat|Maxistrad|Integran|Componen|Sres\.|Sras\./i.test(texto))
  while ((l = LISTA_SALA.exec(texto)) !== null) {
    const base = l.index + l[0].indexOf(l[1]);
    NOMBRE_EN_LISTA.lastIndex = 0;
    let n;
    while ((n = NOMBRE_EN_LISTA.exec(l[1])) !== null) {
      if (!n[1]) { NOMBRE_EN_LISTA.lastIndex++; continue; }
      const i = base + n.index + n[0].indexOf(n[1]);
      fuera.push({ clase: 'PONENTE', inicio: i, fin: i + n[1].length, valor: n[1] });
    }
  }
  const plegado = plegar(texto);
  for (const p of PATRONES) {
    if (p.pre && !p.pre.test(texto)) continue;
    if (p.preFold && !p.preFold.test(plegado)) continue;
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(texto)) !== null) {
      if (m[0].length === 0) { p.re.lastIndex++; continue; }
      let inicio = m.index;
      let fin = m.index + m[0].length;
      if (p.grupo && m[p.grupo]) {
        const rel = m[0].indexOf(m[p.grupo]);
        if (rel >= 0) {
          inicio = m.index + rel;
          fin = inicio + m[p.grupo].length;
        }
      }
      fuera.push(cortarPorCaja(texto, { clase: p.clase, inicio, fin, valor: texto.slice(inicio, fin) }));
    }
  }
  return fuera;
}

// Una región de institución no cambia de caja a mitad: «AL JUTJAT SOCIAL NÚM. 21 DE BARCELONA
// Arnau Soler Vives, amb DNI…» (en producción sin salto de línea) es el órgano EN MAYÚSCULAS y
// detrás, en minúsculas, la persona. La cola de la región se corta donde las palabras pasan de
// todo mayúsculas a llevar minúsculas (o al revés).
const PARTICULAS_CAJA = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'lo', 'y', 'e', 'i', 'da', 'do', 'das', 'dos', 'en', 'sobre', 'para', 'a', 'contra']);
function cortarPorCaja(texto, r) {
  if (r.clase !== 'ORGANO' && r.clase !== 'ORGANISMO') return r;
  const trozo = texto.slice(r.inicio, r.fin);
  const palabras = [...trozo.matchAll(/[\p{L}][\p{L}'’·-]*/gu)].filter((w) => !PARTICULAS_CAJA.has(w[0].toLowerCase()) && w[0].length > 1);
  if (palabras.length < 2) return r;
  const caja = (w) => (w === w.toUpperCase() ? 'M' : /^[\p{Lu}]/u.test(w) ? 'T' : 'm');
  // Una sigla y su lugar: «CSMIJ del Gironès», «UKE de Hamburgo», «USMC Macarena Norte». No es un
  // cambio de caja: es el nombre entero.
  if (/^[A-Z]{2,6}$/.test(palabras[0][0]) && palabras.slice(1).every((w) => caja(w[0]) === 'T')) return r;
  const primera = caja(palabras[0][0]);
  for (const w of palabras.slice(1)) {
    const c = caja(w[0]);
    if (c === 'm') continue;
    if (c !== primera && w[0].length > 2) {
      const fin = r.inicio + w.index;
      const recorte = texto.slice(r.inicio, fin).replace(/[\s,;:.]+$/, '');
      return { ...r, fin: r.inicio + recorte.length, valor: recorte };
    }
  }
  return r;
}

// ¿Cae esta detección dentro de una región protegida? Basta con que se solape: si el reconocedor
// marca «Primera Instancia» dentro del nombre del juzgado, tapar ese trozo rompe el escrito igual.
export function estaProtegida(det, regiones) {
  return regiones.some((r) => det.inicio < r.fin && r.inicio < det.fin);
}

export default regionesIntocables;

export const _patrones = PATRONES;
