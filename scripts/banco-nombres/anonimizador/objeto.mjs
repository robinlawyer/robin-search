// El dato sensible que ES el objeto del escrito.
//
// Criterio de Juan (26-sep), para las dudas 1, 4, 6 y 9 del anexo de categoría especial:
//
//   · Incapacidad permanente. Es una calificación administrativa de la Seguridad Social sobre la
//     capacidad laboral, no dice qué enfermedad hay detrás. Cuando es el objeto del pleito («la
//     resolución que le deniega la incapacidad permanente total») tapar la calificación deja el
//     escrito sin sentido. No se tapa la calificación o la prestación cuando es el objeto directo
//     del escrito; se tapa SIEMPRE el detalle clínico que la acompañe (diagnóstico, patología,
//     informe médico concreto).
//   · Embarazo. Se tapa cuando aparece de forma incidental sobre una tercera persona; pasa cuando
//     es el objeto directo de la pretensión (un despido nulo).
//   · Alcoholismo, ludopatía, toxicomanía. El mismo criterio de fondo.
//   · Antecedentes penales. No son 9.1 sino art. 10 RGPD, pero el art. 10.3 LOPDGDD legitima al
//     abogado a tratarlos, no a mandárselos a un tercero que no los necesita ver: mismo criterio
//     que la categoría especial. Se tapan salvo que sean el objeto directo del escrito (el hecho a
//     probar, el motivo del recurso).
//
// Y una regla que Juan fija expresamente: el criterio va por LO QUE DICE EL TEXTO, no por la
// sección donde aparece. Un dato incidental también se cuela en unos fundamentos, y el objeto del
// pleito también se cita dentro de un documento aportado. Por eso aquí no se mira si el fragmento
// es el suplico o un anexo: se mira si la FRASE presenta el dato como aquello que se pide, se
// deniega, se recurre o se discute.
//
// En la duda, se tapa. Es la regla de toda la categoría especial y no se rompe aquí: pasar en
// claro exige que la frase lo diga, o que el propio expediente ya lo haya dicho (ver abajo), y
// nunca cuando la frase habla de un tercero.

// ───────────────────────────── Los términos de fondo ─────────────────────────────
//
// Solo la CALIFICACIÓN: lo que puede ser el objeto del pleito. Lo que la acompaña —«derivada de
// espondilitis», «por un episodio depresivo»— lo siguen tapando las reglas de salud, que no
// saben nada de esto.

import { CRITERIO_EXTENDIDO, EXTENDIDAS } from './criterio.mjs';

export const FONDO = {
  INCAPACIDAD: new RegExp(
    // Solo la PERMANENTE: es la que dijo Juan. La temporal es una baja y se tapa como dato de salud.
    '\\b(?:incapacitat\\s+permanent(?:\\s+(?:parcial|total|absoluta))?|' +
      'incapacidade\\s+permanente(?:\\s+(?:parcial|total|absoluta))?|' +
      'incapacidad\\s+permanente(?:\\s+(?:parcial|total|absoluta|cualificada))?' +
      // «…de incapacidad permanente EN GRADO DE ABSOLUTA»: el grado es parte de la calificación.
      '(?:\\s+en\\s+(?:su\\s+)?grado\\s+de\\s+(?:parcial|total|absoluta|gran\\s+invalidez))?' +
      '(?:\\s+(?:para\\s+(?:la|su)\\s+profesi[óo]n\\s+habitual|para\\s+todo\\s+trabajo))?|' +
      'incapacidad\\s+laboral(?:\\s+(?:permanente|total|absoluta|parcial))?|' +
      'gran\\s+invalidez|invalidez(?:\\s+permanente)?(?:\\s+(?:total|absoluta))?)\\b',
    'gi',
  ),
  // Sin la de la interrupción voluntaria del embarazo: eso no es la calificación de nadie, y Juan
  // no la ha sacado de la regla general.
  // Tampoco el «embarazo de riesgo» ni la «baja por embarazo»: eso ya no es la calificación, es el
  // detalle clínico que la acompaña, y se tapa siempre.
  EMBARAZO: new RegExp(
    '\\b(?:riesgo\\s+durante\\s+el\\s+embarazo|estado\\s+de\\s+gestaci[óo]n|' +
      '(?<!voluntaria\\s+del\\s+|baja\\s+por\\s+)embarazo(?!\\s+de\\s+riesgo)|' +
      'embarazada(?:\\s+de\\s+[a-záéíóúñ\\d]+\\s+(?:meses|semanas))?|gestaci[óo]n(?!\\s+(?:de|del)\\s+(?:alto\\s+)?riesgo)|embar[àa]s|embarassada)\\b',
    'giu',
  ),
  ADICCION: new RegExp(
    '\\b(?:alcoholismo(?:\\s+cr[óo]nico)?|alcoholisme|ludopat[íi]a|toxicoman[íi]a|drogodependencia|drogodepend[èe]ncia|drogadicci[óo]n|' +
      'dependencia\\s+(?:de|del|a\\s+la)\\s+(?:coca[íi]na|alcohol|hero[íi]na|opi[áa]ceos|cannabis|juego|drogas)|' +
      'drogadicci[óo]n\\s+de\\s+larga\\s+evoluci[óo]n|(?:estado\\s+de\\s+)?embriaguez(?:\\s+habitual)?|problemas\\s+con\\s+(?:la\\s+bebida|el\\s+alcohol|el\\s+juego|las\\s+drogas)|' +
      // Dicho en lenguaje corriente: «bebe mucho», «está borracho», «se droga».
      'beb(?:e|[íi]a)\\s+(?:mucho|demasiado|a\\s+diario|todos\\s+los\\s+d[íi]as)|borrach[oa]s?|borracheras?|se\\s+drogab?a|consum(?:e|[íi]a)\\s+drogas|' +
      'trastorno\\s+por\\s+consumo\\s+de\\s+(?:sustancias|alcohol|coca[íi]na|hero[íi]na|cannabis|opi[áa]ceos)(?:\\s+y\\s+(?:alcohol|coca[íi]na|cannabis))?|' +
      'adicci[óo]n\\s+(?:al\\s+(?:alcohol|juego)|a\\s+(?:las\\s+)?(?:drogas|sustancias\\s+t[óo]xicas|estupefacientes|' +
      // «consumo de cannabis» a secas es el DETALLE (cuánto, desde cuándo); la condición que es el objeto
      // es el consumo habitual, abusivo o continuado (2-oct, auditoría de fugas de la ronda 3).
      'apuestas))|consumo\\s+(?:habitual|abusivo|continuado|problem[áa]tico|compulsivo)\\s+de\\s+(?:alcohol|drogas|t[óo]xicos|' +
      'estupefacientes|coca[íi]na|hero[íi]na|cannabis|sustancias\\s+estupefacientes))\\b',
    'gi',
  ),
  // Antecedentes: la condena ANTERIOR, no la de este asunto. «Condenamos a D. …» es el fallo de la
  // propia causa y no entra; «condenado anteriormente por un delito de robo» sí. Y la prisión
  // provisional de esta misma causa es una medida del procedimiento, no un antecedente.
  ANTECEDENTES: new RegExp(
    '\\b(?:antecedents\\s+(?:penals|policials)|antecedentes\\s+(?:penais|policiais)|' +
      'antecedentes(?:\\s+(?:penales|policiales))(?:\\s+(?:no\\s+cancelados|cancelados|computables))?' +
      '(?:\\s+por\\s+(?:un\\s+|dos\\s+|varios\\s+)?(?:delitos?\\s+(?:de\\s+|contra\\s+))?[a-záéíóúñ]+(?:\\s+[a-záéíóúñ\\d]+){0,6})?|' +
      'antecedentes\\s+por\\s+(?:un\\s+|dos\\s+|varios\\s+)?(?:delitos?\\s+(?:de\\s+|contra\\s+))?[a-záéíóúñ]+(?:\\s+[a-záéíóúñ\\d]+){0,6}|' +
      'hoja\\s+hist[óo]rico[-\\s]penal|multirreincidencia|reincidencia|reincidente|' +
      // La pena de una condena anterior dicha por su contenido: «la pena de 6 meses de prisión por un
      // delito de hurto» (en una solicitud de cancelación, es lo que se pide cancelar).
      '(?:la\\s+)?pena\\s+de\\s+[^.;,\\n]{3,40}?\\s+por\\s+(?:un\\s+)?delitos?\\s+(?:de\\s+|contra\\s+)[a-záéíóúñ]+(?:\\s+[a-záéíóúñ]+){0,4}|' +
      // La condena de la propia parte de la que trata el escrito: «La única condena de mi defendido».
      '(?:la\\s+)?(?:[úu]nica\\s+)?condenas?\\s+(?:anterior(?:es)?\\s+)?de\\s+mi\\s+(?:defendid[oa]|mandante|cliente|representad[oa])|' +
      // En catalán: «per un furt del 2025», «condemnat per un robatori».
      'per\\s+un\\s+(?:furt|robatori|delicte(?:\\s+de\\s+[a-zàèéíòóúç]+)?)\\s+del?\\s+\\d{4}|condemnat\\s+(?:per|el|l\'any)[^.;,\\n]{3,60}|' +
      // (Sin «consta en el Registro Central de Penados»: el Registro es una institución y va en claro;
      // lo que se tapa es la condena que consta en él.)
      '(?:una\\s+)?condena\\s+de\\s+\\d{4}(?:\\s+del?\\s+[a-záéíóúñ]+(?:\\s+[a-záéíóúñ]+)?)?\\s+por\\s+(?:un\\s+)?delitos?\\s+de\\s+[^.;,\\n]{3,90}?(?=[.;,\\n]|$)|' +
      '(?:ya\\s+)?(?:fue|ha\\s+sido|hab[íi]a\\s+sido)\\s+condenad[oa]\\s+(?:en\\s+\\d{4}|anteriormente|previamente|con\\s+anterioridad)(?:\\s+(?:a|por)\\s+[^.;,\\n]{3,60})?|' +
      '(?:ya\\s+)?(?:estuvo|ha\\s+estado|hab[íi]a\\s+estado|estuve|he\\s+estado)\\s+(?:en\\s+(?:prisi[óo]n|la\\s+c[áa]rcel|el\\s+centro\\s+penitenciario)(?:\\s+de\\s+[A-ZÁÉÍÓÚ][\\wáéíóúñ]+)?|dentro)(?:\\s+(?:en|hasta|desde)\\s+\\d{4})?(?:\\s+por\\s+(?:un\\s+|una\\s+)?[a-záéíóúñ]+(?:\\s+(?:con|de)?\\s*[a-záéíóúñ]+){0,4})?|' +
      '(?:hab[íi]a\\s+|ha\\s+|acababa\\s+de\\s+)?salid[oa]\\s+de\\s+(?:la\\s+c[áa]rcel|prisi[óo]n)(?:\\s+hac[íi]a\\s+poco)?|' +
      '(?:cumpli[óo]|cumpl[íi]a)\\s+condena\\s+en\\s+el\\s+Centro\\s+Penitenciario\\s+de\\s+[A-ZÁÉÍÓÚ][^.;,\\n]{2,40}?(?:\\s+hasta\\s+\\d{4})?(?=[.;,\\n]|$|\\s+y\\s)|' +
      'condenad[oa]\\s+(?:anteriormente|previamente|con\\s+anterioridad|ejecutoriamente|en\\s+(?:\\d+|dos|tres|cuatro|varias|m[úu]ltiples)\\s+ocasiones)' +
      '(?:\\s+por\\s+(?:un\\s+|dos\\s+|varios\\s+)?delitos?\\s+(?:de\\s+|contra\\s+)[a-záéíóúñ]+(?:\\s+[a-záéíóúñ]+){0,6})?(?=[.,;:)\\n]|\\s+(?:y|a|en|por|mediante|que|lo|seg[úu]n)\\s|$)|' +
      'condenas?\\s+(?:anteriores|previas|anterior|previa)(?:\\s+por\\s+[a-záéíóúñ]+(?:\\s+[a-záéíóúñ]+){0,6})?(?=[.,;:)\\n]|\\s+(?:y|a|en|que|lo)\\s|$)|' +
      '(?:cumpli[óo]|cumple|cumpl[íi]a|cumpliendo|extingui[óo]|extinguida)\\s+(?:la\\s+|su\\s+)?condena(?:\\s+por\\s+(?:un\\s+)?delitos?\\s+(?:de\\s+|contra\\s+)[a-záéíóúñ]+(?:\\s+[a-záéíóúñ]+){0,5})?|' +
      'condena\\s+de\\s+\\d{4}\\s+por\\s+(?:un\\s+)?delitos?\\s+(?:de\\s+|contra\\s+)[a-záéíóúñ]+(?:\\s+[a-záéíóúñ]+){0,5}|' +
      '(?:ingres[óo]|estuvo|ha\\s+estado|permaneci[óo])\\s+en\\s+prisi[óo]n(?!\\s+provisional)|' +
      'libertad\\s+condicional|tercer\\s+grado(?:\\s+penitenciario)?|' +
      'intern[oa]\\s+en\\s+(?:el\\s+)?(?:centro\\s+penitenciario|C\\.?\\s?P\\.?)(?:\\s+de\\s+[A-ZÁÉÍÓÚ][\\wáéíóúñ]*(?:\\s+[IVX]+)?)?(?:\\s+cumpliendo\\s+condena)?)(?![\\p{L}])',
    'giu',
  ),
  // Las demás categorías del 9.1 con el MISMO criterio de fondo (2-oct). La medición con
  // expedientes completos lo pidió: en una tutela de libertad sindical, la condición de delegado
  // del actor es lo que se litiga; en una solicitud de asilo, la orientación sexual; en una
  // demanda por discriminación, el origen étnico. Taparlo dejaba el escrito sin objeto. Solo la
  // CONDICIÓN; lo que la acompaña (la pareja, el insulto, el chat) se sigue tapando.
  SINDICAL: new RegExp(
    '(?<![\\p{L}])(?:(?:delegad[oa]|delegat)\\s+(?:sindical\\s+)?(?:de\\s+la\\s+secci[óo]n?\\s+sindical\\s+)?(?:de|d\'|de\\s+la)\\s*(?:CCOO|CC\\.?\\s?OO\\.?|UGT|CGT|CNT|CIG|ELA|LAB|CSIF|USO)|' +
      'delegad[oa]s?\\s+sindical(?:es)?|delegat\\s+sindical|delegad[oa]\\s+de\\s+personal|' +
      'representante\\s+(?:sindical|de\\s+los\\s+trabajadores|legal\\s+de\\s+los\\s+trabajadores)|' +
      'miembro\\s+del\\s+comit[ée]\\s+de\\s+empresa|membre\\s+del\\s+comit[èée]\\s+d.empresa|afiliaci[óo]n\\s+sindical|' +
      'condici[óo]n\\s+de\\s+(?:delegad[oa]|representante|afiliad[oa])(?:\\s+sindical)?|actividad\\s+sindical|activitat\\s+sindical|' +
      'libertad\\s+sindical|llibertat\\s+sindical)(?![\\p{L}])',
    'giu',
  ),
  ORIENTACION: new RegExp(
    '(?<![\\p{L}])(?:orientaci[óo]n\\s+sexual(?:\\s+alegada)?|orientaci[óo]\\s+sexual|homosexualidad(?:\\s+del\\s+(?:recurrente|solicitante|actor|demandante))?|' +
      'identidad\\s+de\\s+g[ée]nero|identitat\\s+de\\s+g[èe]nere|condici[óo]n\\s+(?:de\\s+)?(?:homosexual|lesbiana|gay|bisexual|transexual|mujer\\s+transexual)|' +
      '(?:que\\s+)?(?:ser|es|soy|sea|era)\\s+(?:homosexual|gay|lesbiana|bisexual|transexual)|persona\\s+(?:homosexual|LGTBI?|trans))(?![\\p{L}])',
    'giu',
  ),
  ETNIA: new RegExp(
    '(?<![\\p{L}])(?:origen\\s+[ée]tnico(?:\\s+gitano)?|origen\\s+[èe]tnic|(?:de\\s+)?(?:etnia|ètnia)\\s+gitana|' +
      '(?:una\\s+)?(?:familia|persona|personas|comunidad|mujer|hombre)\\s+(?:de\\s+etnia\\s+)?gitan[oa]s?|por\\s+ser\\s+gitan[oa]s?|porque\\s+somos\\s+gitan[oa]s|' +
      'condici[óo]n?\\s+de\\s+persona\\s+d.[èe]tnia\\s+gitana)(?![\\p{L}])',
    'giu',
  ),
  DISCAPACIDAD: new RegExp(
    '(?<![\\p{L}])(?:personas?\\s+con\\s+discapacidad|persona\\s+amb\\s+discapacitat|' +
      '(?:provisi[óo]n\\s+de\\s+)?medidas\\s+(?:judiciales\\s+)?de\\s+apoyo(?:\\s+a\\s+(?:la\\s+)?persona\\s+con\\s+discapacidad)?)(?![\\p{L}])',
    'giu',
  ),
  // La patología cuya OCULTACIÓN o cuyo RETRASO DIAGNÓSTICO es el pleito: el «trasplante renal» que
  // la aseguradora dice ocultado en el cuestionario de salud, el «cáncer colorrectal» que el
  // hospital tardó en diagnosticar. Solo la expresión con su marca; las demás menciones de esa
  // patología las encuentra el expediente (ver PATOLOGIA_DE más abajo).
  PATOLOGIA: new RegExp(
    '(?<![\\p{L}])(?:retraso\\s+(?:en\\s+el\\s+)?diagn[óo]stic[oa]\\s+(?:de(?:l)?\\s+)?|falta\\s+de\\s+diagn[óo]stico\\s+(?:de(?:l)?\\s+)?|' +
      'ocultaci[óo]n\\s+(?:de(?:l)?\\s+)?|omisi[óo]n\\s+(?:de(?:l)?\\s+)?|(?:ocult[óo]|ocultaba|ocultado|no\\s+declar[óo]|no\\s+declarado|omiti[óo])\\s+(?:a\\s+la\\s+aseguradora\\s+)?)' +
      '(?:(?:el|la|su|un|una|los|las)\\s+)?((?:c[áa]ncer|trasplante|tumor|carcinoma|infarto|ictus|diabetes|VIH|enfermedad|insuficiencia|cardiopat[íi]a|hepatitis|esclerosis|neoplasia|[a-záéíóúñ]+(?:itis|osis|patía|oma|emia))(?:\\s+(?!y\\b|que\\b|en\\b|de\\s+la\\b|por\\b)[a-záéíóúñ]+){0,2})(?![\\p{L}])',
    'giu',
  ),
};

// ───────────────────────────── Lo que dice que ES el objeto ─────────────────────────────
//
// Palabras que, en la MISMA frase, presentan el dato como aquello que se pide, se deniega, se
// recurre, se discute o hay que probar. Por clase, porque lo que convierte un embarazo en el
// objeto (un despido) no es lo que convierte en objeto una incapacidad (una prestación).

const PROCESALES =
  // Y en catalán y gallego: «sol·licita», «denega», «recoñeza», «reconeixement».
  'sol·licit\\w*|solicitud\\w*|denega\\w*|recoñe\\w*|reconeix\\w*|reconeg\\w*|' +
  'solicit\\w*|reclam\\w*|deneg\\w*|impugn\\w*|recurr\\w*|recurso|pretensi[óo]n\\w*|suplic\\w*|' +
  'se\\s+interesa|interesamos|objeto\\s+(?:del|de\\s+(?:la|este))|versa\\w*|motivo|se\\s+discute|controvert\\w*|' +
  'se\\s+declare|declaraci[óo]n\\s+de|reconocimiento\\s+de|se\\s+reconozca|le\\s+reconoci[óo]|le\\s+deniega|' +
  'resoluci[óo]n\\s+(?:que|por\\s+la\\s+que|del|de\\s+la|sobre)|acredit\\w*|probar|hecho\\s+a\\s+probar|' +
  // «prueba de» a secas NO: «la prueba de alcoholemia» no convierte nada en el objeto del escrito.
  'medio\\s+de\\s+prueba|a\\s+efectos\\s+de\\s+prueba';

const OBJETO = {
  SINDICAL: new RegExp(`\\b(?:${PROCESALES}|tutela|vulnera\\w*|indemnidad|represali\\w*|discrimin\\w*|antisindical|28\\.1|177|garant[íi]a|por\\s+su\\s+condici[óo]n|acoso|sanci[óo]n|cambio\\s+de\\s+turno|canvi\\s+de\\s+torn|despid\\w*|nul\\w*)\\b`, 'i'),
  // Orientación y origen étnico: solo por el contexto del fragmento (ver CONTEXTO_FRAGMENTO), que
  // exige que el escrito sea de la propia parte. Una marca suelta («acoso», «denuncia») en la frase no
  // basta: en una tutela sindical, el acoso a la compañera lesbiana es el dato de una tercera.
  ORIENTACION: /(?!)/,
  ETNIA: /(?!)/,
  DISCAPACIDAD: new RegExp(`\\b(?:${PROCESALES}|provisi[óo]n|apoyo\\w*|curatela|8\\/2021|ajustes\\s+razonables|discrimin\\w*|adaptaci[óo]n\\s+del\\s+puesto|procedimiento|expediente|auto|demanda)\\b`, 'i'),
  PATOLOGIA: /./,
  INCAPACIDAD: new RegExp(
    `\\b(?:${PROCESALES}|prestaci[óo]n|pensi[óo]n|calificaci[óo]n|grado\\s+de|revisi[óo]n|` +
      'equipo\\s+de\\s+valoraci[óo]n|INSS|Instituto\\s+Nacional\\s+de\\s+la\\s+Seguridad\\s+Social|' +
      'contingencia|base\\s+reguladora|propuesta|dictamen|EVI)\\b',
    'i',
  ),
  EMBARAZO: new RegExp(
    `\\b(?:${PROCESALES}|despid\\w*|extinci[óo]n|nul(?:o|a|idad)|discrimin\\w*|por\\s+raz[óo]n\\s+de|` +
      'riesgo\\s+durante|maternidad|lactancia|suspensi[óo]n\\s+del\\s+contrato|reducci[óo]n\\s+de\\s+jornada|' +
      'no\\s+renovaci[óo]n|periodo\\s+de\\s+prueba|55\\.5|53\\.4)\\b',
    'i',
  ),
  ADICCION: new RegExp(
    `\\b(?:${PROCESALES}|fundament\\w*|modificaci[óo]n|custodia|r[ée]gimen\\s+de\\s+(?:visitas|estancias|comunicaci[óo]n)|` +
      'patria\\s+potestad|modificaci[óo]n\\s+de\\s+medidas|guarda|eximente|atenuante|20\\.2|21\\.2|' +
      'desamparo|tutela|acogimiento|retirada|protecci[óo]n\\s+(?:del\\s+menor|de\\s+menores)|' +
      '54\\.2\\.f|provisi[óo]n\\s+de\\s+apoyos|medidas\\s+de\\s+apoyo|curatela|internamiento|facultades\\s+(?:volitivas|intelectivas|cognitivas)|imputabilidad|disminuid[oa]s?)\\b',
    'i',
  ),
  ANTECEDENTES: new RegExp(
    `\\b(?:${PROCESALES}|sostien\\w*|sostenemos|aleg\\w*|argument\\w*|comput\\w*|cancelad[oa]s?|cancelable|cancelaci[óo]n|apreciaci[óo]n|aplicaci[óo]n|inaplicaci[óo]n|concurr\\w*|` +
      'circunstancia\\s+modificativa|agravante|22\\.8|expulsi[óo]n|autorizaci[óo]n\\s+de\\s+residencia|' +
      'arraigo|reagrupaci[óo]n|residencia|nacionalidad|visado|renovaci[óo]n)\\b',
    'i',
  ),
};

// La frase habla de OTRA persona: el dato es incidental sobre un tercero y se tapa aunque la misma
// palabra sea el objeto del pleito para la parte. En la duda —la frase nombra a un tercero y no se
// sabe de quién es el dato— también se tapa.
const TERCERO = new RegExp(
  // «vecino DE Alcobendas» es vecindad (dónde vive), no un vecino: solo cuenta «vecino» sin un
  // lugar detrás («vecino del demandado», «la vecina»).
  '\\b(?:testigos?|vecin[oa]s?(?!\\s+de\\s+[A-ZÁÉÍÓÚÑ])|herman[oa]s?|prim[oa]s?|cuñad[oa]s?|suegr[oa]s?|compañer[oa]s?|' +
    'otr[oa]s?\\s+(?:trabajador(?:a|es|as)?|emplead[oa]s?|persona)|terceros?|amig[oa]s?|conocid[oa]s?|' +
    'sobrin[oa]s?|t[íi][oa]s?|v[íi]ctima|nueva\\s+pareja|anterior\\s+pareja|expareja|espos[oa]|marido|' +
    'c[óo]nyuge|abuel[oa]s?)\\b',
  'i',
);

// La EMBARAZADA despedida es el caso de manual: por el art. 55.5 ET el despido de una trabajadora
// embarazada es nulo, y el embarazo es el hecho que se litiga aunque la frase que lo cuenta
// («comunicó a la empresa su embarazo el 4 de febrero») no diga «despido». Por eso en esta clase,
// y solo en esta, basta con que el FRAGMENTO trate de un despido o una extinción nulos o
// discriminatorios.
const CONTEXTO_FRAGMENTO = {
  // La adicción de un PROGENITOR en una resolución de desamparo o en unas medidas: es lo que las funda,
  // aunque la frase que la cuenta («La madre presenta un trastorno por consumo de cocaína…») no lo diga.
  // Solo si la frase habla de un progenitor o de una parte; en una pericial penal no aplica.
  ADICCION: {
    test: (texto) => /\b(?:desamparo|modificaci[óo]n\s+de\s+medidas|guarda\s+y\s+custodia|custodia|patria\s+potestad|r[ée]gimen\s+de\s+visitas|visitas|acogimiento|tutela|adopci[óo]n)\b/i.test(texto),
    frase: /./,
  },
  // El CERTIFICADO de antecedentes en un arraigo o una reagrupación: es el requisito que se acredita.
  ANTECEDENTES: {
    test: (texto) => /\b(?:arraigo|autorizaci[óo]n\s+de\s+residencia|reagrupaci[óo]n|nacionalidad|visado|residencia\s+de\s+larga|renovaci[óo]n)\b/i.test(texto),
    frase: /certificado/i,
  },
  SINDICAL: /\b(?:libertad\s+sindical|llibertat\s+sindical|tutela\s+de\s+(?:los\s+)?derechos\s+fundamentales|antisindical|garant[íi]a\s+de\s+indemnidad|vulneraci[óo]\s+de\s+drets|tutela\s+de\s+drets)\b/i,
  // La solicitud de asilo o protección por la orientación del propio solicitante.
  ORIENTACION: { test: (t) => /\b(?:protecci[óo]n\s+internacional|asilo|refugiad\w*|OAR)\b/i.test(t) && /\b(?:orientaci[óo]n\s+sexual|homosexual\w*|gay|lesbiana|LGTBI?)\b/i.test(t), frase: /./ },
  // La discriminación por origen étnico de la PROPIA parte.
  ETNIA: { test: (t) => /(?:discrimina\w*|racis\w*|assetjament|acoso)[^.;]{0,80}(?:origen\s+[ée]tnic|[èe]tni|etnia|racial|gitan)/i.test(t) && /\b(?:actor[a]?|actores|demandantes?|mis?\s+mandantes?|mis?\s+representad[oa]s?|la\s+familia|denunciant\w*|reclamant\w*|recurrente|solicitante|sol·licitant|els\s+meus\s+representats)\b/i.test(t), frase: /./ },
  DISCAPACIDAD: /\b(?:medidas\s+(?:judiciales\s+)?de\s+apoyo|provisi[óo]n\s+de\s+apoyos|curatela)\b/i,
  EMBARAZO: /\b(?:despid\w*|extinci[óo]n)\b[\s\S]*\b(?:nul(?:o|a|idad)|discrimin\w*)\b|\b(?:nul(?:o|a|idad)|discrimin\w*)\b[\s\S]*\b(?:despid\w*|extinci[óo]n)\b/i,
};

function contextoFragmento(texto, frase, clase) {
  const c = CONTEXTO_FRAGMENTO[clase];
  if (!c) return false;
  if (c instanceof RegExp) return c.test(texto);
  return c.test(texto) && c.frase.test(texto.slice(frase.inicio, frase.fin));
}

// ───────────────────────────── Frases ─────────────────────────────
//
// Se corta en el punto que acaba frase, en el punto y coma y en el salto de línea. No en el punto
// de una abreviatura: «D. Juan», «art. 55.5», «núm. 12», «Sra. Gil».
// La inicial suelta tiene que ir sola («J. Pérez»): «0,62 MG/L.» acaba frase, y no cortarla metía en
// la misma frase lo que venía detrás.
// Con límite de palabra de verdad (`\b` no ve la «ó» como letra: «remisión.» parecía la abreviatura «n.»).
const ABREV = /(?:(?<![\p{L}])(?:D|Dª|D\.ª|Dña|Sr|Sra|Srta|art|arts|núm|n|nº|Excmo|Excma|Ilmo|Ilma|pág|págs|apdo|aptdo|ss|vid|cfr|etc|Rec|rec|S\.L|S\.A)|(?:^|[\s(])[A-ZÁÉÍÓÚ])$/u;

export function frases(texto) {
  const fuera = [];
  let inicio = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    let corta = false;
    if (c === '\n' || c === ';') corta = true;
    else if (c === '.' || c === '!' || c === '?') {
      const siguiente = texto[i + 1];
      if (siguiente === undefined || /\s/.test(siguiente)) {
        if (!ABREV.test(texto.slice(Math.max(inicio, i - 8), i))) corta = true;
      }
    }
    if (corta) {
      fuera.push({ inicio, fin: i + 1 });
      inicio = i + 1;
    }
  }
  if (inicio < texto.length) fuera.push({ inicio, fin: texto.length });
  return fuera;
}

const fraseDe = (lista, pos) => lista.find((f) => pos >= f.inicio && pos < f.fin) ?? { inicio: 0, fin: 0 };

// ¿Presenta esta frase el término como objeto? El término mismo no cuenta como marca («la
// prestación de incapacidad permanente» sí; «incapacidad permanente» a secas, no).
function marcaObjeto(texto, frase, termino, clase) {
  const antes = texto.slice(frase.inicio, termino.inicio);
  const despues = texto.slice(termino.fin, frase.fin);
  return OBJETO[clase].test(antes) || OBJETO[clase].test(despues);
}

// Los términos de fondo que hay en un texto, con su clase y su posición.
import { sombra } from './tramos.mjs';

const plegarObj = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function terminosDeFondo(texto, { objetos = null } = {}) {
  const fuera = [];
  for (const [clase, re] of Object.entries(FONDO)) {
    if (!CRITERIO_EXTENDIDO && EXTENDIDAS.has(clase)) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(texto)) !== null) {
      if (!m[0].length) { re.lastIndex++; continue; }
      fuera.push({ clase, inicio: m.index, fin: m.index + m[0].length, valor: m[0], ...(clase === 'PATOLOGIA' ? { patologia: plegarObj(m[1]) } : {}) });
    }
  }
  // Las demás menciones de una patología que el expediente ya estableció como objeto («el trasplante
  // renal» a secas, en la contestación de la aseguradora).
  if (objetos) {
    const pats = [...objetos].filter((o) => o.startsWith('PAT:')).map((o) => o.slice(4));
    if (pats.length) {
      const heno = sombra(texto);
      if (heno) {
        for (const p of pats) {
          let desde = 0;
          for (;;) {
            const i = heno.indexOf(p, desde);
            if (i < 0) break;
            desde = i + 1;
            const a = heno[i - 1];
            const b = heno[i + p.length];
            if ((a && /[a-z0-9]/.test(a)) || (b && /[a-z0-9]/.test(b))) continue;
            fuera.push({ clase: 'PATOLOGIA', inicio: i, fin: i + p.length, valor: texto.slice(i, i + p.length), patologia: p });
          }
        }
      }
    }
  }
  return fuera;
}

// Las clases que ESTE texto establece como objeto del escrito: algún término de esa clase va en
// una frase que lo presenta como lo que se pide o se discute, y no en boca de un tercero. Sirve
// para la pasada previa por la respuesta entera y para recordarlo en el expediente: el «padece
// alcoholismo» del hecho cuarto es el mismo alcoholismo que el suplico pide valorar para la
// custodia, aunque el hecho cuarto no diga «custodia».
// ¿Habla del dato un TERCERO? Tiene que estar CERCA: nombrado poco antes del dato en la misma frase
// («La vecina, que estaba embarazada…», «SU ESPOSA, DOÑA …, PERCIBE PENSION DE INCAPACIDAD…»), o
// justo detrás como su dueño («el alcoholismo del vecino»). Mirar la frase entera hacía tercero a
// cualquiera: en «Frente a la agravante de reincidencia que el Ministerio Fiscal aplica a los
// hermanos Ferreiro…», los hermanos son los ACUSADOS, y la reincidencia que es el motivo del
// escrito de defensa salía tapada.
const TERCERO_DETRAS = new RegExp(`^\\s+(?:de|del)\\s+(?:la\\s+|el\\s+|su\\s+|sus\\s+)?${TERCERO.source.replace(/^\\b/, '')}`, 'i');
//
// La ventana cruza la frase anterior (150 caracteres): «Testigo: Rosendo Ibáñez Pastor, vecino del
// demandado. Manifiesta que él mismo estuvo en tratamiento por ludopatía» — el sujeto de la segunda
// frase es el vecino de la primera. Si la ventana pilla a un tercero que no era el dueño del dato,
// se tapa: en la duda, se tapa.
function deTercero(texto, frase, termino) {
  // «la condena anterior de mi defendido»: el dueño está dicho en el propio término, y es la parte.
  if (/\bmis?\s+(?:defendid[oa]|mandante|cliente|representad[oa])\b/i.test(termino.valor ?? '')) return false;
  // Solo cruza a la frase anterior si esta empieza SIN sujeto («Manifiesta que él mismo…», «Refiere
  // que…»): entonces el sujeto es el de la anterior. Si la frase tiene el suyo («Documentación:
  // certificado de antecedentes penales del reagrupante…»), el tercero de la frase de antes —«su
  // esposa, CHEN MEIHUA»— no es el dueño del dato.
  const cuerpo = texto.slice(frase.inicio, frase.fin).replace(/^[\s\d.ºª)—-]+/, '');
  const sinSujeto = /^(?:Manifiesta|Declara|Refiere|Reconoce|Afirma|Señala|Indica|Explica|Admite|Añade|Dice|Relata|Cuenta|Asegura|Niega|Confirma|Estaba|Estuvo|Era|Fue|Tiene|Tenía|Padece|Padecía|Sufre|Sufría|Presenta|Presentaba|Él|Ella|Este|Esta|Dicho|Dicha)\b/i.test(cuerpo);
  let antes = texto.slice(Math.max(sinSujeto ? 0 : frase.inicio, termino.inicio - 150), termino.inicio);
  // Nunca por encima de un salto de párrafo.
  const salto = antes.lastIndexOf('\n\n');
  if (salto >= 0) antes = antes.slice(salto);
  // Los rótulos «TERCERO.-», «Segundo.—» no son un tercero.
  antes = antes.replace(/(?:PRIMER[OA]|SEGUND[OA]|TERCER[OA]|CUART[OA]|QUINT[OA]|SEXT[OA]|S[ÉE]PTIM[OA]|OCTAV[OA]|NOVEN[OA]|D[ÉE]CIM[OA]|Primer[oa]|Segund[oa]|Tercer[oa]|Cuart[oa]|Quint[oa]|Sext[oa])\s*[.\-—–:]+/g, '');
  if (TERCERO.test(antes)) return true;
  return TERCERO_DETRAS.test(texto.slice(termino.fin, frase.fin));
}

export function objetosDelTexto(texto) {
  const lista = frases(texto);
  const fuera = new Set();
  for (const t of terminosDeFondo(texto)) {
    const f = fraseDe(lista, t.inicio);
    if (deTercero(texto, f, t)) continue;
    if (t.clase === 'PATOLOGIA') { fuera.add(`PAT:${t.patologia}`); continue; }
    if (marcaObjeto(texto, f, t, t.clase)) fuera.add(t.clase);
    else if (contextoFragmento(texto, f, t.clase)) fuera.add(t.clase);
  }
  return fuera;
}

// ¿Pasa en claro ESTE término? Sí si su frase lo presenta como objeto; o si el expediente ya lo
// estableció como objeto (o el fragmento, en el embarazo) y la frase no habla de un tercero.
// La condena CONCRETA («la condena de 2009 por un delito de contrabando», «cumplió condena por tráfico
// de drogas») solo es el objeto con una marca fuerte: se recurre, es el motivo, la reincidencia, lo
// que se pide. En una reagrupación, lo que hay que acreditar es que no hay antecedentes; el delito
// concreto no hace falta para nada, y se tapa.
const CONDENA_CONCRETA = /\bpor\s+(?:un\s+|dos\s+|varios\s+)?delitos?\b|pena\s+de\s|antecedentes\s+(?:penales\s+|policiales\s+)?por\s+(?!un\s+delito)[a-záéíóúñ]+|condena\s+de\s+\d{4}|cumpli\w*\s+condena\s+por|condenad[oa]\s+ejecutoriamente/i;
const OBJETO_FUERTE = /\b(?:recurr\w*|recurso|impugn\w*|motivo|reincidencia|agravante|22\.8|se\s+solicita|solicit\w*|suplic\w*|se\s+interesa|hecho\s+a\s+probar|se\s+discute)\b/i;

export function esObjeto(texto, termino, { objetos = new Set(), lista = frases(texto) } = {}) {
  const f = fraseDe(lista, termino.inicio);
  // Si el propio escrito dice que NO es el objeto («…una incapacidad permanente absoluta … que no es
  // objeto de este pleito»), no lo es.
  if (/\bno\s+(?:es|son|constituye|forma\s+parte\s+del)\s+(?:el\s+)?objeto\b/i.test(texto.slice(termino.fin, Math.min(texto.length, f.fin + 60)))) return false;
  if (deTercero(texto, f, termino)) return false;
  // La patología del pleito: con su marca («retraso en el diagnóstico del…») o porque el expediente
  // ya la estableció.
  if (termino.clase === 'PATOLOGIA') return objetos.has(`PAT:${termino.patologia}`) || /retraso|ocult|omisi|omiti|declar|falta\s+de/i.test(termino.valor);
  // Lo concreto se mira en la FRASE, no solo en el término: «una condena anterior | de 2021 del Juzgado
  // de lo Penal n.º 1 por conducción con tasa de alcohol» es una condena concreta aunque el término
  // reconocido sea solo «condena anterior».
  const tramoFrase = texto.slice(termino.inicio, Math.min(f.fin, termino.fin + 160));
  const concreta = CONDENA_CONCRETA.test(termino.valor) || /conden/i.test(termino.valor) && /\bde\s+(?:19|20)\d{2}\b[^.;]{0,80}\b(?:por|del\s+Juzgado)|\bpor\s+(?:conducci[óo]n|robo|hurto|lesiones|amenazas|tr[áa]fico|maltrato|abuso|agresi[óo]n|estafa|apropiaci[óo]n|atentado|resistencia|quebrantamiento)/i.test(tramoFrase);
  if (termino.clase === 'ANTECEDENTES' && concreta) {
    // O que el escrito trate de la reincidencia: entonces la condena anterior es el hecho probado.
    // O que la frase hable de la condena de la PROPIA parte y de su cancelación: «La única condena de
    // mi defendido … está cancelada o es cancelable» (en una reagrupación, en cambio, la cancelación
    // de la condena de 2009 se acredita, y el delito concreto no hace falta).
    const fr = texto.slice(f.inicio, f.fin);
    if (/\bmis?\s+(?:defendid[oa]|mandante|cliente|representad[oa])\b/i.test(fr) && /\bcancelad[oa]s?\b|\bcancelable\b/i.test(fr)) return true;
    return OBJETO_FUERTE.test(texto.slice(f.inicio, termino.inicio)) || OBJETO_FUERTE.test(texto.slice(termino.fin, f.fin)) ||
      /\b(?:reincidencia|agravante\s+de\s+reincidencia)\b/i.test(texto);
  }
  if (marcaObjeto(texto, f, termino, termino.clase)) return true;
  if (objetos.has(termino.clase)) return true;
  if (contextoFragmento(texto, f, termino.clase)) return true;
  return false;
}

export default esObjeto;
