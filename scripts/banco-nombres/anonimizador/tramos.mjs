// El TRAMO sensible: el dato de categoría especial no es una palabra, es lo que se dice con ella.
//
// Lo destapó la medición con expedientes completos (2-oct): el detector de términos cogía
// «cardiopatía isquémica» y dejaba en claro el resto de la frase —«IAM inferoposterior Killip I
// en febrero 2025 tratado con ACTP + stent en CD proximal»—, que dice lo mismo o más. Sobre 2.112
// datos de categoría especial anotados a ciegas en 92 documentos, tapaba el 9,5 %. Un expediente
// real no dice «padece espondilitis» y punto: trae informes clínicos enteros (antecedentes,
// exploración, constantes, analíticas, pauta de fármacos con su nombre comercial), chats («me
// ahogo subiendo las escaleras», «la pastilla de orinar»), nóminas con la IT y la cuota sindical,
// y todo eso en cuatro lenguas.
//
// La regla: un SEGMENTO (la frase partida por sus comas; en un texto clínico denso, la frase
// entera) que contiene un disparador de categoría especial se tapa ENTERO, salvo lo que tiene
// dueño propio:
//   · lo que protege la guardia (el juzgado, la norma, el hospital como institución),
//   · lo que ya está tapado con su tipo (la persona con su alias, el DNI, el domicilio),
//   · el OBJETO del escrito (criterio de fondo de Juan: la incapacidad que se pide, el embarazo
//     del despido nulo, la orientación sexual de la solicitud de asilo…).
// Es el criterio de Juan aplicado a la letra: en categoría especial, en la duda se tapa, y el
// detalle clínico que acompaña al objeto se tapa siempre.
//
// Los disparadores se buscan sobre una SOMBRA del texto del mismo largo: minúsculas, sin tildes y
// con las confusiones del OCR deshechas dentro de las palabras («CARDI0PATIA», «B1EN»). Así las
// posiciones casan con el original sin recalcular nada.

import { CRITERIO_EXTENDIDO } from './criterio.mjs';

// ───────────────────────────── La sombra ─────────────────────────────

const BASE = new Map();
function base(ch) {
  let b = BASE.get(ch);
  if (b === undefined) {
    const n = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    b = n.length === 1 ? n.toLowerCase() : ch.toLowerCase();
    if (b.length !== 1) b = ch;
    BASE.set(ch, b);
  }
  return b;
}
const OCR_LETRA = { 0: 'o', 1: 'i', 3: 'e', 5: 's', 8: 'b' };

export function sombra(texto) {
  const c = new Array(texto.length);
  for (let i = 0; i < texto.length; i++) {
    const u = texto.charCodeAt(i);
    c[i] = u >= 0xd800 && u <= 0xdfff ? texto[i] : base(texto[i]);
  }
  // Dentro de una palabra que es sobre todo letras, un dígito suelto es un error del OCR.
  const re = /[\p{L}\p{N}]+/gu;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const w = m[0];
    const letras = (w.match(/\p{L}/gu) ?? []).length;
    const digitos = w.length - letras;
    if (!digitos || letras < 3 || digitos > 2 || letras < 2 * digitos) continue;
    for (let k = 0; k < w.length; k++) {
      const d = OCR_LETRA[w[k]];
      if (d) c[m.index + k] = d;
    }
  }
  return c.join('');
}

// ───────────────────────────── Los disparadores ─────────────────────────────
//
// Escritos en la forma de la sombra (sin tildes, minúsculas). `B(...)` les pone límites de palabra.
// Español, catalán, gallego y euskera, técnico y coloquial. Lo que se pide a un disparador: que
// dicho en una frase, la frase hable de la salud (o la religión, el sindicato…) de alguien.

const B = (s) => new RegExp(`(?<![a-z0-9])(?:${s})(?![a-z0-9])`, 'g');

const SALUD = [
  // Profesionales y sitios de la sanidad, dichos de la persona («me lo ha prohibido el médico»,
  // «estoy en urgencias»). El nombre de un hospital o un servicio como institución lo protege la
  // guardia; el disparador no cuenta dentro de ella.
  'medic[oa]s?|metge(?:ssa)?|metges|sendagile\\w*|medikua\\w*|enfermer[oa]s?|infermer\\w*|psicolog[oa]s?|psicologic\\w*|psiquiatr\\w*|' +
    'ginecolog\\w*|gine|matrona|llevadora|comadrona|pediatr\\w*|neurolog\\w*|cardiolog\\w*|oncolog\\w*|endocrin\\w*|traumatolog\\w*|' +
    'reumatolog\\w*|neumolog\\w*|urolog\\w*|oftalmolog\\w*|oculista|dermatolog\\w*|fisio(?:terapeut\\w*)?|logoped\\w*|cirujan[oa]s?|' +
    'anestesi\\w*|urgencias|urxencias|urgencies|uci|hospitalizad\\w*|hospitalizacion|' +
    'ingresad[oa]s?\\s+(?:en\\s+(?:el\\s+|la\\s+)?(?:hospital|uci|planta|psiquiatr\\w*|unidad|clinica)|desde|durante|por)|ingressad[ae]s?|' +
    'ingres(?:o|a|ar|aron|ada|ado|e)\\s+(?:en|por)\\s+(?:el\\s+|la\\s+)?(?:hospital|urgencias|uci|planta|psiquiatr\\w*|unidad|servicio|clinica)|' +
    'ingreso\\s+(?:hospitalario|en\\s+(?:el\\s+)?hospital|psiquiatrico|en\\s+uci|en\\s+planta)|consulta\\s+(?:del?\\s+)?(?:medic\\w*|especialista)',
  // Bajas, altas e IT.
  // La baja MÉDICA, no la del contrato o el registro: «causa baja por despido», «dar de baja en la
  // Seguridad Social», «baja voluntaria» son otra cosa.
  '(?<!(?:causa|causo|causar|dar|dado|dada|dio|dieron|darse|darle|darlo|darla|solicitar\\s+la|tramitar\\s+la)\\s)(?:de\\s+baja|la\\s+baja|una\\s+baja)(?!\\s+(?:en\\s+(?:la\\s+)?(?:seguridad|empresa|padron|registro|tesoreria|censo|plantilla)|voluntaria|por\\s+(?:despido|jubilacion|fin|excedencia|cese|dimision|cambio)|del\\s+(?:contrato|vehiculo|padron)))|' +
    'baja\\s+(?:medica|laboral|de\\s+maternidad|de\\s+paternidad)|baja\\s+por\\s+(?!despido|jubilacion|fin\\s|excedencia|cese|dimision|cambio|traslado)|bajas\\s+medicas|parte(?:s)?\\s+de\\s+(?:baja|confirmacion|alta|lesiones)|' +
    'baixa(?:\\s+medica)?|de\\s+baixa|alta\\s+(?:medica|hospitalaria|voluntaria)|informe\\s+de\\s+alta|le\\s+dieron\\s+el\\s+alta|' +
    'incapacidad\\s+temporal|incapacitat\\s+temporal|incapacidade\\s+temporal|it\\s+(?:por|desde|derivada)|situacion\\s+de\\s+it|en\\s+it|proceso\\s+de\\s+it|prestacion\\s+it|' +
    'mutua\\s+(?:me|le)',
  // Tratamiento y medicación (con su dosis, su pauta o en lenguaje de calle).
  'tratamiento\\s+(?!de\\s+(?:los\\s+)?datos)(?:\\w+\\s+)?(?:con|de|para|medico|farmacologico|psicologico|psiquiatrico|oncologico|hormonal|antirretroviral)|' +
    'en\\s+tto|tto\\.?\\s+con|tractament|tratamento|medicacion|medicacio|medicament\\w*|farmaco\\w*|pastill\\w*|pildora\\w*|comprimid\\w*|' +
    'jarabe|inyecc\\w*|inxecc\\w*|pinchaz\\w*|me\\s+pincho|insulin\\w*|recet\\w*|posologia|quimio\\w*|radio(?:terapia)?\\s+(?:y|e)|antirretrovir\\w*|' +
    'antidepresiv\\w*|ansiolitic\\w*|antipsicotic\\w*|benzodiacepin\\w*|analgesic\\w*|antibiotic\\w*|anticoagul\\w*|antiagreg\\w*|corticoid\\w*|' +
    'pilul\\w*|botika\\w*|sendagai\\w*',
  // Diagnóstico, síntomas, pruebas e intervenciones.
  'diagnostic\\w*|diagnosis|diagnostica\\w*|diagnostiqu\\w*|le\\s+detectaron|le\\s+(?:diagnosticaron|encontraron\\s+un)|' +
    'sintoma\\w*|simptom\\w*|sintomatolog\\w*|dolor(?:es)?|doloros\\w*|dolencia\\w*|mina\\s+(?:dut|du)|' +
    'sangr(?:ado|ados|ar|o|e|a|ando|ante|ando)|sangrad\\w*|hemorrag\\w*|metrorrag\\w*|fiebre|febre|marea(?:do|da|os|r|rme|ba)|mareo\\w*|' +
    'vomit\\w*|nausea\\w*|me\\s+ahogo|ahog(?:o|a|aba|arme)\\b|asfixi\\w*|insomnio|no\\s+duermo|no\\s+dormo|no\\s+pego\\s+ojo|' +
    'nervios|ansied\\w*|ansietat|ansiedade|antsietat\\w*|angusti\\w*|estres|panico|fobia\\w*|depresi\\w*|depressi\\w*|deprimid\\w*|' +
    'suicid\\w*|autolit\\w*|autolesi\\w*|ideacion|quitarme\\s+la\\s+vida|psicosis|psicotic\\w*|brote\\w*|alucina\\w*|delirio\\w*|' +
    'esquizo\\w*|bipolar\\w*|anorex\\w*|bulimi\\w*|autis\\w*|asperger|paralisis|ceguera|sordera|sord[oa]s?|' +
    'discapacid\\w*|discapacitat\\w*|minusval\\w*|grado\\s+de\\s+dependencia|dependencia\\s+(?:moderada|severa|grado)|movilidad\\s+reducida|silla\\s+de\\s+ruedas|' +
    'oxigeno|oxigen\\s+portatil|dialisis|trasplant\\w*|transplant\\w*|protesis|marcapasos|desfibrilador\\w*|stent|bypass|ostomia|estoma|colostom\\w*|ileostom\\w*|' +
    'cirugi\\w*|cirurx\\w*|quirofano|quirurgic\\w*|operad[oa]\\s+de|me\\s+(?:operan|operaron|han\\s+operado)|la\\s+(?:operan|operaron)|le\\s+(?:operan|operaron)|' +
    'se\\s+a\\s+operado|se\\s+ha\\s+operado|operat\\s+de|operacion\\s+(?:de|del)\\s+(?!credito|compraventa|financiacion|crédito)\\w+|intervenid[oa]\\s+(?:quirurgicamente|de)|intervencion\\s+quirurgica|' +
    'biopsia\\w*|analitic\\w*|analisis\\s+de\\s+sangre|resonancia\\w*|radiograf\\w*|ecograf\\w*|scanner|escaner|tac|electrocardiogram\\w*|' +
    'espirometr\\w*|gasometr\\w*|holter|ergometr\\w*|colonoscop\\w*|endoscop\\w*|mamograf\\w*|citolog\\w*|amniocent\\w*|cribado|' +
    'prueba\\s+de\\s+(?:embarazo|esfuerzo|imagen)|test\\s+de\\s+(?:embarazo|la\\s+marcha)|' +
    'lesion(?:es)?\\s+(?:fisic\\w*|psiquic\\w*|leves?|graves?|en\\s+(?:la|el)|de\\s+(?:caracter|naturaleza))|hematoma\\w*|contusion\\w*|herida\\w*|ferida\\w*|' +
    'erosion(?:es)?|equimosis|fractura\\w*|esguince\\w*|traumatismo\\w*|luxacion\\w*|cicatri\\w*|quemadura\\w*|moraton\\w*|secuela\\w*|' +
    'cancer\\w*|tumor\\w*|bulto\\s+en|quiste\\w*|infarto\\w*|ictus|corazon\\s+(?:me|le)|el\\s+corazon|cor\\s+(?:em|li)|lo\\s+del\\s+azucar|su\\s+azucar|' +
    'la\\s+tension|tension\\s+alta|pressio\\s+alta|presion\\s+alta|hipertens\\w*|colesterol|diabet\\w*|asma\\w*|alergi\\w*|' +
    'gaixo\\w*|gaixotasun\\w*|enfermedad(?:es)?(?!\\s+(?:comun|profesional))|enfermidade\\w*|doenza\\w*|malaltia\\w*|malalt\\w*|enferm[oa]s?|patolog\\w*|patoloxia\\w*',
  // Embarazo, reproducción y lactancia (el embarazo que es el objeto lo saca el criterio de fondo).
  'embaraz\\w*|embaras\\w*|haurdun\\w*|gestacion\\w*|gestant\\w*|xestacion\\w*|' +
    '(?:estoy|esta|estaba|ya|estic)\\s+de\\s+\\d+\\s+(?:semanas|meses|setmanes|mesos)|\\d+\\+\\d+\\s+semanas|semana\\s+\\d+\\s+de\\s+gestacion|' +
    'parto|partos|cesarea\\w*|aborto\\w*|avortament\\w*|lactancia|lactancia|lactant\\w*|postparto|posparto|puerperio|' +
    'fiv|fiv-icsi|icsi|in\\s+vitro|reproduccion\\s+asistida|transferencia\\s+embrionaria|embrion\\w*|ovari\\w*|estimulacion\\s+ovarica|puncion\\s+folicular|' +
    'esterilidad|infertilidad|fertilidad|menstrua\\w*|menopaus\\w*|anticoncept\\w*',
  // VIH y transmisibles.
  'vih|sida|seropositiv\\w*|carga\\s+viral|cd4|hepatitis|tuberculos\\w*|sifilis|gonorrea|clamidia|herpes|vph|papiloma\\w*|la\\s+del\\s+virus',
  // La pauta dicha en la calle: para qué es la pastilla, quién la sube o la quita.
  '(?:para|sin|no\\s+(?:puedo|puede|consigo|consigue|podia|podía))\\s+dormir|para\\s+(?:el\\s+sueno|los\\s+nervios|la\\s+tension|el\\s+dolor|la\\s+ansiedad|la\\s+depresion|el\\s+azucar|la\\s+tristeza|orinar|el\\s+corazon)|' +
    '(?:me|le|te|nos)\\s+(?:ha|han|a|an)\\s+(?:puesto|recetado|mandado|subido|bajado|quitado|cambiado|retirado|pautado)|' +
    '(?:me|le)\\s+(?:va|van)\\s+a\\s+(?:subir|bajar|quitar|cambiar|poner)\\s+(?:la|el|las|los)|(?:me|se|le)\\s+(?:la|lo|las|los)?\\s*tom(?:a|o|aba|e)\\s+(?:todos|cada|por\\s+la)|' +
    'tomarse\\s+la|se\\s+ha\\s+tomado|te\\s+has\\s+tomado|el\\s+mono|sindrome\\s+de\\s+abstinencia|recaida\\w*|recayo',
  // La exploración física y de rehabilitación, la neuropsicología, la toxicología y el certificado de
  // discapacidad: los informes que no dicen «padece», solo miden (ronda 2 del 2-oct).
  'balance\\s+(?:articular|muscular)|flexion\\s+\\d|extension\\s+[-−]?\\d|derrame\\s+articular|contractura\\w*|inestabilidad|claudica\\w*|' +
    'baston(?:\\s+ingles)?|muleta\\w*|andador|cojea\\w*|marcha\\s+(?:prolongada|en\\s+puntillas|claudicante|inestable)|tolera\\s+marcha|' +
    'lasegue|romberg|daniels|escala\\s+de\\s+berg|goniometr\\w*|tavec|stroop|tmt-[ab]|trail\\s+making|figura\\s+compleja|bads|tomm|wms\\w*|' +
    'anosmia|anomia|disfuncion\\s+erectil|labilidad\\s+emocional|habla\\s+enlentecida|intrusiones|perseveraciones|deterioro\\s+de\\s+las\\s+funciones|' +
    'funciones\\s+ejecutivas|memoria\\s+episodica|velocidad\\s+de\\s+procesamiento|cambio\\s+de\\s+personalidad|tce|politraumatiz\\w*|' +
    'detectad[oa]s?\\s+en\\s+(?:orina|sangre|humor\\s+vitreo)|no\\s+detectad[oa]|humor\\s+vitreo|rango\\s+terapeutico|ng\\s?\\/\\s?ml|' +
    'deficiencia\\s+global|deficiencia\\w*|limitacion(?:es)?\\s+en\\s+la\\s+actividad|grau\\s+de\\s+discapacitat|barem\\w*\\s+de\\s+(?:movilidad|mobilitat)|' +
    'tercera\\s+persona|concurs\\s+de\\s+tercera|dependen(?:cia|t)\\s+(?:moderada|severa|gran)|cuidadora?\\s+de\\s+un\\s+familiar\\s+dependiente|' +
    'status\\s+epileptic\\w*|convulsi\\w*|epilep\\w*|crisis\\s+(?:epilepticas|convulsivas|comiciales)|' +
    // Lo que dice la familia en un correo o en un chat.
    'se\\s+pierde|no\\s+se\\s+acuerda|no\\s+(?:reconoce|conoce\\s+bien)|ya\\s+no\\s+(?:le\\s+dejamos|puede)\\s+(?:salir|andar|conducir)|' +
    '(?:se|me|te)\\s+quiere\\s+morir|me\\s+quiero\\s+morir|quiere\\s+morirse|quitarse\\s+la\\s+vida|' +
    'cortes?\\s+(?:nuevos\\s+)?(?:en|del|de\\s+los)\\s+(?:el\\s+|los\\s+|la\\s+)?(?:brazos?|antebrazos?|munecas?|piernas?)|se\\s+(?:hace|hacia)\\s+cortes|(?:me|se)\\s+he\\s+(?:vuelto\\s+a\\s+)?cortar|me\\s+he\\s+vuelto\\s+a\\s+cortar|lo\\s+de\\s+los\\s+cortes|' +
    'la\\s+regla|por\\s+la\\s+regla|estoy\\s+mala|la\\s+depre|en\\s+shock|no\\s+para\\s+de\\s+llorar|se\\s+pone\\s+a\\s+llorar|llora\\s+(?:al|cuando|todos)|' +
    '(?:unas|unas\\s+cuantas|dos|tres)\\s+copas|(?:iba|estaba|venia|llevaba)\\s+(?:muy\\s+)?bebido|(?:iban|iba|estaba|estaban|llevaban|llevaba)\\s+(?:muy\\s+|toda\\s+la\\s+noche\\s+)?«?cargad[oa]s?|' +
    'como\\s+bloquead[oa]|estado\\s+de\\s+bloqueo|fuera\\s+de\\s+mi\\s+cuerpo|se\\s+le\\s+va\\s+la\\s+mirada|como\\s+ausente|no\\s+duerme|no\\s+dormia|' +
    'puntos\\s+en\\s+la\\s+ceja|nariz\\s+rota|costilla\\s+fisurada|no\\s+(?:puede|podia)\\s+ni\\s+(?:abrir|andar|caminar|subir|cargar|llevar|levantar)|' +
    'proyecto\\s+bebe|projecte\\s+bebe|clinica\\s+de\\s+fertilita?t|psicooncolog\\w*|copag\\w*|farmacia\\s+(?:del\\s+)?hospital|ortopedia|',
  // Ronda 2, segunda tanda: alimentación, opiáceos, salud mental dicha en la calle, epilepsia,
  // valoración de discapacidad y dependencia, sangre, analíticas y el documento clínico por su título.
  'kcal|calorias|sonda\\s+(?:nasogastrica|nasoxastrica)?|(?:en|nos)\\s+los?\\s+huesos|esta\\s+nos\\s+huesos|no\\s+come(?:\\s+casi)?|non\\s+ceou|non\\s+come|alimentacion\\s+(?:muy\\s+)?selectiva|' +
    'selectividad\\s+alimentaria|registros?\\s+alimentarios?|controles?\\s+(?:semanales\\s+)?de\\s+peso|peso\\s+en\\s+percentil|utca|nutricion\\w*|nutricional|dieta\\s+(?:de\\s+\\d|hiposodica|sin)|' +
    'celiac\\w*|alerxia|intolerancia\\s+a|miosis|midriasis|bradipnea|taquipnea|pupilas\\s+como|somnolencia|medio\\s+dormid[oa]|venopuncion\\w*|me\\s+pinchaba|se\\s+(?:esta\\s+)?metiendo\\s+algo|' +
    'opiace\\w*|controles?\\s+toxicologic\\w*|(?:las\\s+)?orinas\\s+(?:todas\\s+)?(?:negativas|positivas)|escalada\\s+del\\s+consumo|busqueda\\s+de\\s+la\\s+sustancia|adherencia\\s+al\\s+tratamiento|' +
    'hipomani\\w*|taquipsiquia|cambios\\s+de\\s+animo|(?:a|la)\\s+cabeza\\s+a\\s+mil|lo\\s+suyo\\s+de\\s+la\\s+cabeza|cosa\\s+de\\s+la\\s+cabeza|duerme\\s+fatal|estoy\\s+(?:bastante\\s+)?mal|hundid[oa]|' +
    'llorab\\w*|plorant|li\\s+costa\\s+dormir|irritabilidad|estado\\s+de\\s+animo|salud\\s+mental\\s+de|estabilidad\\s+clinica|' +
    'crisis\\s+(?:al\\s+mes|nocturnas|febriles)|monitor\\s+de\\s+crisis|registro\\s+de\\s+rescates|stesolid|sudep|' +
    'calificacion\\s+bla|baremo\\s+de\\s+movilidad|ci\\s+total|cociente\\s+intelectual|comprension\\s+verbal|conducta\\s+adaptativa|estereotipias|autoagresi\\w*|' +
    'audicion\\s+y\\s+lenguaje|dificultades\\s+(?:especificas\\s+)?de\\s+(?:lectura|aprendizaje)|contacto\\s+ocular|hipotonia|esfinteres|enuresis|encopresis|' +
    '(?:comer\\s+y\\s+beber|vestirse|asearse|banarse)\\s+\\((?:supervision|ayuda)|actividades\\s+(?:basicas|instrumentales)\\s+de\\s+la\\s+vida|' +
    'hematies|grupo\\s+sanguineo|transfusion\\w*|riesgo\\s+hematologico|el\\s+bazo|esplenectom\\w*|rcp|uvi\\s+movil|litemia\\w*|litio|ca-125|marcador\\s+tumoral|' +
    'politraumatism\\w*|neumotorax|curacion:\\s|tiempo\\s+estimado\\s+de\\s+curacion|turmells|cor\\s+en\\s+perill|temblor\\w*|tremol\\w*|' +
    'informe\\s+(?:clinic\\w*|medic\\w*|de\\s+salud|pericial\\s+(?:medic\\w*|neuropsicologic\\w*|psicologic\\w*|psiquiatric\\w*)|neuropsicologic\\w*|' +
    'de\\s+(?:la|el)\\s+(?:pediatra|psicologa|psicologo|psiquiatra|neurologa|neurologo|medica|medico\\s+de\\s+cabecera)|de\\s+(?:neuropediatria|nutricion|seguimiento\\s+nutricional|seguimento)|' +
    'de\\s+urgencias|de\\s+alta)|dictamen\\s+tecnic\\w*\\s+facultati\\w*|sessio\\s+psicologia|sesion\\s+de\\s+psicologia|farmacia\\s+[a-z]|',
  // Ronda 4: inglés básico (entrevistas de asilo), mutilación y violencia sexual, apoyos a la
  // discapacidad, embarazo dicho de calle, deterioro cognitivo dicho por la familia.
  'pregnan\\w*|bleeding|hiv|aids|stroke|hypertensi\\w*|medicine|tablets|i\\s+was\\s+sick|blood\\s+(?:was\\s+)?(?:very\\s+)?low|depress\\w*|' +
    'mutilaci\\w*\\s+genital|ablacion|circuncision|cut\\s+(?:her|me|girls|again)|violad[oa]s?|violaci\\w*|raped?|' +
    'curatela|curador[a]?|provision\\s+de\\s+apoyos|medidas\\s+de\\s+apoyo|vivienda\\s+tutelada|vivenda\\s+tutelada|centro\\s+ocupacional|pictogramas|' +
    'de\\s+\\d{1,2}\\s+semanas|semana\\s+\\d{1,2}\\s+de\\s+gestacion|lo\\s+perdi|lo\\s+del\\s+bebe|' +
    'perdida\\s+de\\s+la\\s+cabeza|no\\s+sabia\\s+(?:ni\\s+)?quien\\s+era|non\\s+sabia\\s+(?:nin\\s+)?quen\\s+era|encamad[oa]|sin\\s+lenguaje|gds\\s+\\d|' +
    'derivacion\\s+preferente|pronostico|reincorporacion\\s+progresiva|carencia\\s+it|bajon|sogs|manias|' +
    'concejal[a]?\\s+(?:de|en|por)|monarquic\\w*|republican\\w*|' +
    'prueba\\s+de\\s+(?:irmandade|hermandad|adn|paternidad)|proba\\s+de\\s+irmandade|muestra\\s+bucal|mostra\\s+bucal|cotonete|bastoncito|' +
    'hij[oa]\\s+biologic\\w*|avuncular\\w*|perfil\\s+(?:genetico|parcial)|exhumacion|' +
    'juju|shrine|oath|juramento\\s+ritual|ritual|native\\s+doctor|church|pastor\\s+pray|' +
    'xitan\\w*|edo|esan|' +
    // Auditoría de fugas de la ronda 3: fórmulas periciales y rótulos que lo dicen todo.
  
  'facultades\\s+(?:volitivas|intelectivas|cognitivas)|capacidad(?:es)?\\s+volitiva\\w*|imputabilidad|parte\\s+medico\\s+de\\s+baja|' +
    'internamiento\\s+(?:no\\s+voluntario|involuntario|psiquiatrico)|enfermedades\\s+neuromusculares|uhp|unidad\\s+de\\s+hospitalizacion\\s+psiquiatrica|' +
    'antecedentes\\s+toxicologicos|motivo\\s+de\\s+consulta|gran\\s+dependencia|grau\\s+de\\s+dependencia|dependencia\\s+en\\s+grau|pincharse|fase\\s+mani\\w*|' +
    '(?:oigo|oye|oir)\\s+(?:tanto\\s+)?(?:las\\s+)?voces|derivad[oa]\\s+(?:de\\s+forma\\s+preferente\\s+)?a\\s+(?:salud\\s+mental|psiquiatria|psicologia|neurologia)|',
  // Ronda 3: alcohol y drogas de calle, psicosis dicha por el paciente, obstetricia, diabetes y sus
  // aparatos, salud laboral, escalas y la cola en asturiano y francés.
  'canas\\s+(?:al|de)|un\\s+par\\s+de\\s+canas|cervezas?|cubatas?|conac|chupitos?|bebi(?:a|an|do|da|ste)|me\\s+tome\\s+(?:dos|unas|un\\s+par)|los\\s+de\\s+aa|alcoholicos|estoy\\s+limpio|estar\\s+limpio|' +
    'llevo\\s+\\w+\\s+(?:meses|semanas|anos|dias)\\s+limpio|colocad[oa]|(?:par\\s+de\\s+)?rayas|bolsitas|mdma|extasis|ketamina|speed|anfetamin\\w*|consumir|consumia|consumo\\s+(?:diario|esporadico|recreativo|de\\s+(?:cocaina|cannabis|alcohol|drogas|heroina))|' +
    'comunidad\\s+terapeutica|modulo\\s+terapeutico|muestras?\\s+de\\s+cabello|analisis\\s+de\\s+cabello|via\\s+inyectada|' +
    '(?:mete|meten|oye|escucha)\\s+voces|un\\s+chip\\s+en|le\\s+envenenan|me\\s+envenenan|me\\s+persiguen|los\\s+locos|estoy\\s+loco|volviendo\\s+a\\s+subir|hablo\\s+muy\\s+rapido|' +
    'descompensaci\\w*|contencion\\s+mecanica|sujeciones|cinturon\\s+abdominal|ingresos\\s+previos|ingresad[oa]|me\\s+tiemblan|llorosos|' +
    'contracciones|taquisistoli\\w*|oxitocina|prostaglandinas|propess|epidural|paritorio|apgar|ph\\s+arterial|cardiotocograf\\w*|registro\\s+ctg|ctg|desaceleraciones|' +
    'semana\\s+\\d{2}\\+\\d|\\d{2}\\+\\d\\s+semanas|reanimacion\\w*|iot|hipoxic\\w*|isquemic\\w*|dobutamina|adrenalina|peg|nutricion\\s+enteral|pediasure|' +
    'minimed|bomba\\s+de\\s+insulina|sensor\\s+de\\s+glucosa|baqsimi|glucagon|hemoglobina\\s+glicosilada|glucemi\\w*|perfil\\s+glucemico|gel\\s+de\\s+glucosa|lipohipertrofi\\w*|' +
    'vigilancia\\s+de\\s+la\\s+salud|especialmente\\s+sensible|no\\s+apto\\s+para|apto\\s+con\\s+restricciones|adaptacion\\s+(?:del\\s+puesto|de\\s+puesto|del\\s+horario)|reconocimiento\\s+medico|' +
    'glasgow|neumonia\\w*|ulcera\\w*|mec\\s+\\d|downton|scheltens|tanner|densitometr\\w*|sedacion|esfuerzo\\s+terapeutico|cuidados\\s+paliativos|instrucciones\\s+previas|' +
    'cadera\\s+operada|ambulancia|el\\s+higado|tomar?\\s+el\\s+pulso|pesadiell\\w*|mexase|salu\\s+mental|no\\s+dorm\\b|esta\\s+molt\\s+prim|' +
    'douleur\\w*|crise\\w*|hydroxyuree|morphine|fatiguee|hospitalis\\w*|' +
    'crisis\\s+vasooclusiv\\w*|hospital\\s+de\\s+dia|lo\\s+de\\s+la\\s+uci|en\\s+la\\s+uci|',
  // Nombres comerciales frecuentes (psicofármacos, oncología, los de cada día) y escalas clínicas.
  'concerta|lynparza|ideos|emend|ondansetro\\w*|carboplat\\w*|paclitaxel|heparin\\w*|reservori\\w*|keppra|rubifen|medikinet|elvanse|strattera|risperdal|xeplion|abilify|zyprexa|seroquel|depakine|keppra|lamictal|rivotril|orfidal|' +
    'trankimazin|lexatin|valium|tranxilium|stilnox|dormodor|cipralex|seroxat|prozac|zoloft|besitran|dumirox|vandral|cymbalta|lyrica|' +
    'tramadol|zaldiar|enantyum|nolotil|ibuprofeno|paracetamol|omeprazol|sintrom|eliquis|xarelto|adiro|plavix|eutirox|levothroid|' +
    'utrogestan|progeffik|gonal|cetrotide|ovitrelle|menopur|kadcyla|herceptin|keytruda|tamoxifeno|letrozol|zoladex|xeloda|biktarvy|' +
    'triumeq|genvoya|descovy|truvada|atripla|lantus|novorapid|humalog|ozempic|trulicity|jardiance|forxiga|entresto|cristalmina|betadine|' +
    'ventolin|symbicort|seretide|spiriva|trimbow|metadona|suboxone|naltrexona|antabus|colme|disulfiram|' +
    'pcl-5|mcmi\\w*|audit|stai|bdi(?:-ii)?|hdrs|hads|mmse|moca|barthel|rankin|wais\\w*|wisc\\w*|mmpi\\w*|scl-90\\w*|crafft|conners\\w*|sdq|ados\\w*|adi-r|' +
    // Tóxicos en orina, grupos de ayuda, educación especial, el sueño y el peso dichos en la calle.
    'controles?\\s+de\\s+(?:orina|toxicos)|positivos?\\s+(?:a|en)\\s+(?:thc|cocaina|benzo\\w*|opiaceos|anfetamin\\w*|cannabis)|thc|benzoilecgonina|historial\\s+de\\s+consumo|' +
    '(?:alcoholicos|jugadores|narcoticos)\\s+anonimos|educacion\\s+especial|necesidades\\s+educativas\\s+especiales|aula\\s+(?:tea|de\\s+apoyo|enclave)|' +
    'no\\s+(?:duerme|dorm[ií]a|duermo|dorme|durmo)\\s+bien|(?:duerme|duermo)\\s+mal|non\\s+pode\\s+durmir|pesadelos|' +
    '(?:se\\s+)?(?:hace|hacerse|hacia|fa)\\s+pis|pis\\s+en\\s+la\\s+cama|(?:ha|he)\\s+(?:cogido|perdido|ganado|engordado|adelgazado)\\s+(?:\\d+\\s+)?(?:kilos|kg|peso)|' +
    'cabeza\\s+fatal|cabeza\\s+peor|cv\\s+indetectable|uca|conductas\\s+adictivas|' +
    // Lo que se ve en un atestado: «ojos enrojecidos y pupilas dilatadas», «iba muy puesto», «una raya».
    'pupilas\\s+dilatadas|ojos\\s+enrojecidos|habla\\s+pastosa|halitosis\\s+alcoholica|muy\\s+puesto|(?:una|unas|dos)\\s+(?:raya|rayas|raias)|esnifad[oa]',
  // Lo que dice la gente y el informe de exploración, sin término técnico.
  'dosis|duele|duelen|dolia|dolian|me\\s+duele|hinchad[oa]s?|inflamad[oa]s?|sudores|suda\\s+por|desorienta\\w*|agitacio\\w*|confusional|' +
    'deterioro\\s+cognitivo|cognitiv\\w*|memoria\\s+(?:reciente|remota|inmediata|alterada)|perdida\\s+de\\s+memoria|olvidos|demencia\\w*|alzh?eimer|' +
    'veia\\s+cosas|oye\\s+voces|le\\s+persegu\\w*|mala?\\s+de\\s+la\\s+cabeza|la\\s+cabeza\\s+fatal|estou\\s+tola|esta\\s+tola|tolo|' +
    'residencia\\s+(?:de\\s+(?:ancianos|mayores)|de\\s+amurrio|geriatrica)|centro\\s+de\\s+dia|panal\\w*|hemorroid\\w*|astenia|anorexia|perdida\\s+de\\s+peso|' +
    'pesadilla\\w*|llanto|rumiacion\\w*|libido|duelo\\s+(?:complicado|patologico|prolongado)|ideas?\\s+(?:de\\s+muerte|pasivas|autoliticas)|' +
    'consciente|orientad[oa]\\s+en|exploracion\\s+(?:fisica|neurologica|psicopatologica)|auscultacion|a\\s+la\\s+palpacion|constantes|' +
    'estado\\s+general|juicio\\s+clinico|antecedentes\\s+(?:personales|familiares|medicos|quirurgicos|psiquiatricos)|habitos\\s+toxicos|alergias?|ramc|namc|' +
    'reposo|rehabilitacion|logopedia|fisioterapia|psicoterapia|terapia\\w*|' +
    // Morfología clínica (también la gallega: «osteoporose», «artrose»).
    '[a-z]{3,}(?:itis|osis|ose|emia|patia|algia|ectomia|stomia|tomia|plastia|scopia|grafia|terapia|penia|trofia|plejia|paresia|fagia|cardia|rragia|dinia)|' +
    '[a-z]*(?:carcin|sarc|melan|aden|lip|fibr|mi|neur|glioblast|hemat|linf|miel|ater|granul|papil|angi|meningi|terat)oma',
];
// Palabras corrientes con forma clínica.
const NO_CLINICA = new Set(['simpatia', 'antipatia', 'empatia', 'telepatia', 'academia', 'blasfemia', 'bohemia', 'abstemia', 'endemia', 'pandemia',
  'nostalgia', 'neuralgia', 'metamorfosis', 'simbiosis', 'apoteosis', 'hipotesis', 'sintesis', 'tesis', 'antitesis', 'genesis', 'enfasis', 'crisis',
  'dosis', 'misericordia', 'concordia', 'discordia', 'fotografia', 'geografia', 'biografia', 'ortografia', 'caligrafia', 'cartografia', 'coreografia',
  'bibliografia', 'mecanografia', 'pornografia', 'radiografia', 'tipografia', 'filmografia', 'escenografia', 'topografia', 'taquigrafia', 'telegrafia',
  'demografia', 'jurisprudencia', 'monografia', 'anatomia', 'autonomia', 'economia', 'astronomia', 'gastronomia', 'agronomia', 'dicotomia', 'lobotomia',
  'neumonia', 'propose', 'glucose', 'dose', 'pose', 'rose', 'jose', 'close', 'base', 'ose', 'diagnose', 'cose', 'expose', 'chose', 'those', 'whose']);

// Siglas clínicas: sobre el texto ORIGINAL y con su caja, porque en minúsculas son palabras
// corrientes («ta», «fc», «it»). Las cortas, solo con un número detrás.
const ADICCION = [
  // Alcohol, drogas y juego.
  // «bebidas alcohólicas» es el delito de tráfico («conducción bajo la influencia de bebidas
  // alcohólicas»), no la salud de nadie.
  '(?<!bebidas\\s)alcohol(?!emia)\\w*|bebedor\\w*|beb(?:e|ia|o)\\s+(?:mucho|demasiado|a\\s+diario|todos)|ya\\s+no\\s+bebo|borrach\\w*|resaca\\w*|cervezas\\s+al\\s+dia|cubata\\w*|' +
    'abstinen\\w*|droga\\w*|drogodepend\\w*|drogadic\\w*|coca(?!-cola)|cocain\\w*|porro\\w*|cannabis|marihuan\\w*|hachis|heroin\\w*|metadona|' +
    'toxicos?|toxicoman\\w*|consumo\\s+de|consumidor\\w*|desintox\\w*|deshabitua\\w*|proyecto\\s+hombre|ludopat\\w*|apuestas|tragaperras|adicci\\w*|addicci\\w*',
];

const SIGLAS_SALUD = new RegExp(
  '(?<![\\p{L}\\p{N}])(?:HTA|DM[12]?|EPOC|IAM|IAMCEST|IAMSEST|ACV|AIT|TEPT|TAG|TOC|TCA|TDAH|TEA|TLP|SAOS|SAHS|ERC|IRC|ICC|HBP|ITU|ETS|ITS|VIH|' +
    'FEVI|NYHA|IMC|HbA1c|SatO2|Sat\\s?O2|ECG|EEG|EMG|RMN|PET-TC|ETT|ACTP|DAI|CPAP|BiPAP|NAMC|AINEs?|IBP|ISRS|BZD|URPA|IQx?|TVNS|FA|' +
    'FEV1|FVC|GOLD\\s+\\d|mMRC|LCF|LCN|CIE-10|DSM-5|Tª|NT-proBNP|PSA|TSH|GGT|CDT|VCM|PCR|' +
    '(?:TA|FC|FR|Hb|Hto|TC|RM|Sat|Tª)\\s*:?\\s*\\d)(?![\\p{L}])',
  'gu',
);
// La IT dicha con su sigla en una nómina o un escrito: «Complemento empresa hasta 100 % IT»,
// «situación de IT», «en IT prolongada». En minúsculas «it» no es nada.
const SIGLA_IT = /(?<=(?:situaci[óo]n\s+de|en|de\s+la|la|proceso\s+de|prestaci[óo]n|complemento[^.\n]{0,25}|%|de|baja\s+por|agotamiento\s+de\s+la)\s)(?:IT|CUME|ILT)(?![\p{L}])|(?<![\p{L}])(?:Prestaci[óo]n|PRESTACI[ÓO]N)\s+(?:CUME|IT|riesgo\s+durante\s+el\s+embarazo)(?![\p{L}])/gu;
// Un código de diagnóstico CIE-10 («F32.2», «O20.0») y una cifra con unidad clínica.
const CODIGO_CIE = /(?<![\p{L}\p{N}])[A-TV-Z][\dlI]{2}\.[\dlI]{1,2}(?![\p{N}\p{L}])/gu;
const UNIDAD = /\d(?:[.,]\d+)?\s?(?:mg|mcg|µg|μg|ug|ml|mmhg|mm\s?hg|lpm|cel\/µl|cél\/µl|copias\/ml|mg\/dl|g\/dl|mui\/ml|mui\/l|ui\/l|ui|mets|paquetes\/a[nñ]o|cig\/d[ií]a|ml\/min|pg\/ml|mg\/l|ng\/ml|µg\/l|g\/l|mg\/kg|u\/l|mmol\/l)(?![\p{L}])/giu;

const SINDICAL = [
  'sindical\\w*|sindicat\\w*|sindicalist\\w*|sindikat\\w*|afiliad[oa]s?\\s+(?:a|al|en)|afiliacion\\s+sindical|afiliats|afiliat\\s+a|' +
    'delegad[oa]s?\\s+(?:sindical\\w*|de\\s+personal|de\\s+prevencion|de\\s+(?:la\\s+)?(?:ccoo|ugt|cgt|cig|ela|lab|uso|csif|cnt))|delegat\\s+(?:sindical|de)|' +
    '(?:miembro|membre|forma\\s+parte)\\s+del?\\s+comit[eè]\\s+de\\s+empresa|comite\\s+de\\s+(?:huelga|vaga)|comit[eè]\\s+de\\s+vaga|huelga\\w*|' +
    'de\\s+vaga|la\\s+vaga|fer\\s+vaga|folga\\w*|greba\\w*|horas\\s+sindicales|credito\\s+horario|cuota\\s+sindical|seccion\\s+sindical|seccio\\s+sindical|' +
    'liberad[oa]\\s+sindical|candidatura\\s+de|elecciones\\s+sindicales|comisiones\\s+obreras|' +
    'la\\s+cuota(?:\\s+(?:sindical|de\\s+\\w+))?|cuota\\s+(?:en\\s+nomina|sindical)|me\\s+afilie|afiliarte|afiliarse|afiliacion|asamblea\\w*|delegad[oa]s?|los\\s+de\\s+comisiones|garantias\\s+sindicales|',
];
const SIGLAS_SINDICALES = /(?<![\p{L}\p{N}])(?:USTEC|UPA|COAG|ASAJA|STEPV|STES|SIPE|SUP|JUPOL|JUCIL|AUGC|SPP|CCOO|CC\.\s?OO\.?|UGT|CGT|CNT|ELA|LAB|CSIF|CSI-F|CIG|SATSE|STEI|ANPE|USO(?=\s|,|\.|$)|Intersindical)(?![\p{L}])/gu;

const RELIGION = [
  'religio\\w*|creyente\\w*|catolic\\w*|cristian\\w*|evangelic\\w*|protestant\\w*|pentecostal\\w*|testigos?\\s+de\\s+jehova|salon\\s+do\\s+reino|salon\\s+del\\s+reino|' +
    'adventist\\w*|mormon\\w*|musulman\\w*|islam\\w*|mezquita\\w*|mesquita\\w*|iman|imam|ramadan|ramada|hiyab|hijab|velo\\s+islamico|viste\\s+(?:el\\s+)?velo|el\\s+velo|burka|niqab|halal|' +
    'rez(?:ar|a|o|aba|ando|amos)|resar|oracion|oracio|pregaria|plegaria|misa|misas|missa|mezatara|meza|iglesia\\w*|esglesia\\w*|igrexa\\w*|eliza\\w*|parroqu\\w*|' +
    'culto|cultos|pastor(?:a)?\\s+(?:de|evangelic\\w*|en)|mi\\s+padre\\s+(?:es|era)\\s+pastor|sacerdot\\w*|monja\\w*|convento\\w*|rosario|escapulari\\w*|virgen\\s+(?:del?|blanca)|a\\s+la\\s+virgen|' +
    'hermandad\\w*|cofradi\\w*|bautiz\\w*|primera\\s+comunion|la\\s+comunion|extremauncion|funeral\\s+catolico|misas\\s+gregorianas|judi[oa]s?|judaism\\w*|sinagoga\\w*|kosher|rabino\\w*|' +
    'budis\\w*|hindu\\w*|ateo|atea|agnostic\\w*|dios|deu\\s+(?:meu|vos)|la\\s+meca|peregrinacion\\w*|bendig\\w*|fe\\s+(?:catolica|cristiana|musulmana)|la\\s+fe\\s+es|objecion\\s+de\\s+conciencia|' +
    'jehova|predica\\w*|congregaci\\w*|publicador\\w*|siervo\\s+ministerial|cuerpo\\s+de\\s+ancianos|asamblea\\s+de\\s+distrito|desasociaci\\w*|' +
    '(?:testigo|catolic[oa]|musulman[ae]?)\\s+practicante|no\\s+practica|practica\\s+(?:regularmente|la\\s+religion)|creencias|su\\s+fe|contra\\s+su\\s+fe|(?:no\\s+)?crees?\\s+(?:pero|en\\s+dios)|deje\\s+de\\s+creer|' +
    'coran|suras?|educacion\\s+islamica|pregaries|pregaria|mocador|burca|panuelo\\s+(?:islamico|en\\s+la\\s+cabeza)|carne\\s+de\\s+cerdo|sense\\s+porc|sin\\s+cerdo|motivos\\s+religiosos|' +
    'libertad\\s+religiosa\\s+de|religion\\s+catolica|confirmacion\\s+(?:religiosa|de\\s+su\\s+hij\\w*)|preparacion\\s+para\\s+la\\s+confirmacion|matrimonio\\s+(?:canonico|religioso|por\\s+la\\s+iglesia)|' +
    'requete|curas|el\\s+rector|es\\s+rector|oraciones|catequesis|bautizo|monaguillo|' +
    'panuelo|hiyab|velo|ayuno|ayunar|rez(?:os|ado|ar|a|e|o)|recen|oren\\s+por|alfombrilla|inshallah|insha\\s+allah|cofradia\\w*|oratori[oa]|mezquita|magal|' +
    'himnos?|pecado|infierno|capirote|procesion\\w*|capellan|uncion|diacono|el\\s+pastor|(?:mi|tu|su)\\s+fe|prueba\\s+de\\s+fe|en\\s+manos\\s+del\\s+senor|' +
    'dieu|prie\\w*|priere|otoitz\\w*|ramadan',
];
const POLITICA = [
  'partido\\s+(?:politico|comunista|socialista|popular|nacionalista)|del\\s+partido|militan\\w*|afiliacion\\s+politica|ideolog\\w*|de\\s+izquierdas|izquierda\\s+(?:abertzale|unida|radical)|de\\s+derechas|' +
    'comunist\\w*|socialist\\w*|anarquist\\w*|fascist\\w*|facha\\w*|franquist\\w*|falangist\\w*|nacionalist\\w*|independentist\\w*|indepe|indepes|separatist\\w*|' +
    'estelad\\w*|abertzale\\w*|carlist\\w*|batzoki\\w*|herriko\\s+taberna|activist\\w*|activismo|candidat[oa]\\s+(?:en\\s+la\\s+lista|por|de\\s+la\\s+lista)|' +
    'llistes\\s+d|lista\\s+de\\s+(?:esquerra|podemos|vox|bildu|pnv|psoe|pp|junts|cup|bng)|elecciones\\s+(?:municipales|generales|autonomicas)|municipals|' +
    'concejal\\w*\\s+(?:de|del|por)\\s+(?:eh\\s+)?(?:bildu|pnv|psoe|pp|vox|podemos|sumar|erc|junts|cup|bng|compromis)|manifestacion\\w*\\s+(?:a\\s+favor|contra|por)|' +
    'nazis?|neonazi\\w*|cruz\\s+celta|skinhead\\w*|ultraderech\\w*|ultraizquierd\\w*|grupo\\s+ultra|mitin\\w*|quota\\s+(?:d\'?)?afiliat|cuota\\s+de\\s+afiliad[oa]|' +
    'afiliad[oa]\\s+(?:a|al)\\s+(?:un\\s+)?partido|caracter\\s+politico|entidades\\s+de\\s+caracter\\s+politico|mes\\s+per\\s+mallorca|psib|el\\s+pi|' +
    'vot(?:o|as|a|amos|ais|an|aba|aban|e)\\s+(?:a|al|a\\s+la)\\s+\\w+|izquierda\\s+(?:unida|xunida)|ernai|pertenencia\\s+a\\s+un\\s+partido|campana\\s+politica|' +
    '(?:es|era|son)\\s+del\\s+(?:pp|psoe|pnv)|del\\s+pp\\s+de\\s+toda',
];
const SIGLAS_GENETICAS = /(?<![\p{L}\p{N}])(?:DNA|ADN|STR|SNP)(?![\p{L}])/gu;
const SIGLAS_POLITICAS = /(?<![\p{L}\p{N}])(?:PSOE|Vox|VOX|Podemos|Sumar|Bildu|EH\s+Bildu|PNV|EAJ|ERC|Esquerra(?:\s+Republicana)?|Junts|CUP|BNG|Compromís|IU)(?![\p{L}])/gu;
const ETNIA = [
  'gitan\\w*|gitanet\\w*|ijito\\w*|etnia\\w*|etnic\\w*|racial\\w*|racis\\w*|raza|payo|paya|payos|payas|paio|paia|' +
    'pueblo\\s+(?:gitano|roma)|comunidad\\s+(?:gitana|roma)|romani|sudaca\\w*|panchit\\w*|bereber\\w*|amazig\\w*|subsaharian\\w*|afrodescendient\\w*|indigena\\w*|' +
    'negr[oa]s?\\s+de\\s+mierda|moro\\w*\\s+de\\s+mierda|los\\s+moros|ya\\s+sabemos\\s+como\\s+sois|' +
    'que\\s+es\\s+negr[oa]|(?:es|era|son)\\s+(?:arabe|magrebi|negr[oa]s?|gitan[oa]s?)|color\\s+de\\s+(?:la\\s+)?piel|vete\\s+a\\s+tu\\s+(?:selva|pais)|vuelvas?\\s+a\\s+tu\\s+pais|' +
    'llam\\w+\\s+«?(?:mono|negro|moro|sudaca|gitano)|«mono»|«mona»|negrit[oa]s?|morit[oa]s?|(?:una\\s+)?chica\\s+negra|(?:por\\s+)?ser\\s+negr[oa]|lengua\\s+materna|wolof|' +
    'estamos\\s+en\\s+la\\s+selva|de\\s+la\\s+selva',
];
// La condición misma (lo que puede ser el objeto de una solicitud de asilo o de una demanda por
// discriminación), aparte del resto de la vida sexual.
const ORIENTACION = [
  'homosexual\\w*|bisexual\\w*|lesbian\\w*|lesbiana|gay|gays|gai|gais|maric\\w*|bollera\\w*|bolleira\\w*|tortiller\\w*|travesti\\w*|' +
    'transexual\\w*|transgener\\w*|trans|queer|lgtb\\w*|lgbt\\w*|orientacion\\s+sexual|orientacio\\s+sexual|identidad\\s+de\\s+genero|identitat\\s+de\\s+genere|homofob\\w*|transfob\\w*',
];
const SEXUAL = [
  'salir\\s+del\\s+armario|sali[oó]\\s+del\\s+armario|(?:meter|metido|vuelto\\s+a\\s+meter)\\s+en\\s+el\\s+armario|me\\s+gustan\\s+(?:mas\\s+)?(?:las\\s+chicas|los\\s+chicos|las\\s+mujeres|los\\s+hombres)|' +
    'soy\\s+(?:bi|gay|lesbiana|trans|bisexual)|(?:se\\s+)?(?:dieron|daban|dio)\\s+un\\s+beso|besarse|se\\s+besaran|besado|un\\s+beso|expresion\\s+publica\\s+de\\s+su\\s+afectividad|' +
    'pareja\\s+de\\s+hecho\\s+del|su\\s+marido\\s+(?=\\S)|' +
    'asignad[oa]\\s+como\\s+(?:mujer|hombre|nina|nino|chica|chico)|transicion\\s+social|nombre\\s+muerto|pronombres|rectificacion\\s+del\\s+nombre|nombre\\s+anterior|' +
    'vestuario\\w*\\s+(?:de\\s+las\\s+(?:chicas|ninas|neñes|nenes)|de\\s+los\\s+(?:chicos|ninos)|femenino|masculino)|vive\\s+como\\s+(?:nino|nina|chico|chica|lo\\s+que\\s+ye)|' +
    'mariquit\\w*|bandera\\s+arcoiris|love\\s+is\\s+love|orgullo\\s+lgtb\\w*|xicot|relacio\\s+de\\s+parella|' +
    'identidad\\s+sexual|afirmacion\\s+de\\s+genero|proceso\\s+de\\s+transicion|transicion\\s+de\\s+genero|iniciar\\s+el\\s+transito|el\\s+transito\\s+social|' +
    'rectificad[oa]\\s+\\d|mencion\\s+registral|hormonas|tratamiento\\s+hormonal|travelo\\w*|vas\\s+de\\s+muller|(?:co\\s+)?teu\\s+cambio|su\\s+cambio\\s+de|' +
    'relacion\\s+sentimental\\s+con\\s+otr[oa]\\s+(?:mujer|hombre)|(?:era|es)\\s+gay|tenia\\s+marido|vida\\s+intima|abusos?\\s+sexual\\w*|agresion\\s+sexual|' +
  'heterosexual\\w*|' +
    'disforia\\w*|reasignacion\\w*|cambio\\s+de\\s+sexo|mencion\\s+del\\s+sexo|rectificacion\\s+registral|nombre\\s+registral|nombre\\s+(?:de\\s+)?antes|' +
    'vaginoplast\\w*|faloplast\\w*|hormon\\w*\\s+(?:feminiz\\w*|masculiniz\\w*)|homofob\\w*|transfob\\w*|examen\\s+anal|vida\\s+sexual|relaciones\\s+sexuales|' +
    'su\\s+novia|su\\s+novio|mi\\s+novio|mi\\s+novia|la\\s+meva\\s+parella|a\\s+sua\\s+moza|da\\s+sua\\s+moza|sua\\s+moza|pareja\\s+(?:del\\s+mismo\\s+sexo|\\(varon\\))|' +
    'prostitu\\w*|trabajadora\\s+sexual',
];
const GENETICO = [
  // Sin «dna»: «Dña» sin tilde es «dna», y cada «Dña.» de un escrito se volvía un dato genético.
  'adn|genetic\\w*|genetica|xenetic\\w*|gen|genes|mutacion\\w*|mutacio\\w*|mutad[oa]s?|brca\\d?|kras|nras|braf|apoe|fmr1|cftr|cromosom\\w*|haplotip\\w*|alel\\w*|loci|locus|' +
    'marcador\\w*\\s+(?:genetic\\w*|autosomic\\w*|str)|perfil\\s+genetico|perfiles\\s+geneticos|parentesco\\s+biologic\\w*|prueba\\s+(?:de\\s+)?(?:paternidad|maternidad|hermandad|parentesco|biologica)|' +
    'frotis\\s+bucal|hisopo\\w*|saliva|x\\s+fragil|consejo\\s+genetico|secuenciac\\w*|variante\\s+patogenic\\w*|germinal|hereditari\\w*|portador[a]?\\s+de|' +
    'microdelecion\\w*|delecion\\w*|duplicacion\\s+\\d|\\d{1,2}[pq]\\d+(?:\\.\\d+)?|cariotipo|repeticiones\\s+cag|huntington|herencia\\s+(?:autosomica|ligada)|autosomic\\w*|' +
    'no\\s+soy\\s+portadora|no\\s+es\\s+portador[a]?|la\\s+prueba\\s+(?:genetica|del\\s+gen)|(?:dio|dio|me\\s+dio|le\\s+dio)\\s+positivo\\s+(?:el\\s+test|la\\s+prueba)|sali[oó]\\s+limpi[oa]|' +
    'paternidad\\s+(?:biologica|duo)|padre\\s+biologico|indice\\s+de\\s+paternidad|probabilidad\\s+de\\s+paternidad|excluid[oa]\\s+como\\s+padre|laboratorio\\s+de\\s+(?:genetica|adn)|' +
    '[a-z]\\d{1,2}s\\d{2,4}|vwa|fga|th01|tpox|csf1po|amelogenina',
];
const BIOMETRICO = [
  'huella\\w*\\s+(?:dactilar\\w*|digital\\w*)|huella\\s+dactilar|huellas|maquina\\s+de\\s+la\\s+huella|resena\\s+dactilar|resena\\s+(?:fotografica|policial)|impresion\\s+dactilar|dactiloscop\\w*|reconocimiento\\s+facial|biometric\\w*|iris|fotografia\\s+(?:digital\\s+)?del\\s+rostro|resena\\s+fotografica',
];
// Solo lo ANTERIOR o ajeno a esta causa: la condena previa, la cárcel, los antecedentes. El delito
// por el que se sigue el propio procedimiento («delito de lesiones», «pena de prisión», «detenido»)
// es el objeto del procedimiento, no un antecedente, y va en claro: taparlo deja el escrito de
// acusación sin acusación.
const PENAL = [
  'condenad[oa]s?\\s+(?:en\\s+\\d{4}|por\\s+sentencia|anteriormente|previamente|con\\s+anterioridad|ejecutoriamente|el\\s+\\d|a\\s+(?:la\\s+pena|\\d+|un|una|dos|tres|cuatro|cinco|seis|ocho)|en\\s+(?:dos|tres|varias)|por\\s+(?:un|una|dos|varios)\\s+delitos?)|' +
    'fue\\s+condenad\\w*|(?:una|su|la\\s+unica|otra|varias|dos|tres)\\s+condenas?|condenas?\\s+(?:anteriores|previas|anterior|previa)|condena\\s+(?:de|del)\\s+(?:\\d|ano|any)|' +
    '(?:le|me|lo|la|les|nos)\\s+condenaron|condemnat\\w*|carcel\\w*|carcere|presidio|penitenciari\\w*|' +
    'prision(?!\\s+(?:provisional|comunicada|incondicional))|preso\\w*|presa\\s+en|en\\s+prision\\s+preventiva|' +
    'antecedentes\\s+(?:penales|policiales)|antecedents\\s+penals|historico-penal|historico\\s+penal|cancelable\\w*|' +
    'trapicheo\\w*|libertad\\s+condicional|tercer\\s+grado|sursis|ha\\s+estado\\s+(?:dentro|en\\s+la\\s+carcel)|estuvo\\s+(?:dentro|en\\s+la\\s+carcel|preso)|' +
    'salio\\s+de\\s+(?:la\\s+carcel|prision|brians|la\\s+preso)|cumpl\\w*\\s+condena|pena\\s+cumplida|' +
    'brians|basauri|nanclares|soto\\s+del\\s+real|alcala-meco|picassent|quatre\\s+camins|lledoners|teixeiro|a\\s+lama|martutene|zuera|topas|new\\s+bell|' +
    'campos\\s+del\\s+rio|botafuegos|albolote|estremera|navalcarnero|villabona|mansilla\\s+de\\s+las\\s+mulas|el\\s+dueso|fontcalent|mas\\s+d.enric|wad-ras|zaballa|puerto\\s+iii|alhaurin|' +
    'suspension\\s+de\\s+(?:la\\s+)?(?:ejecucion\\s+de\\s+la\\s+)?pena|revocacion\\s+de\\s+la\\s+suspension|ejecutoria\\w*|(?:tiene|con|sin|tenia|tener)\\s+antecedentes|' +
    '(?:le|les|me)\\s+consta(?:n)?\\s+(?:una|un|dos|varias)\\s+(?:condena|detencion|resena|antecedente)\\w*|resena\\s+anterior|detencion\\s+(?:anterior|en\\s+(?:19|20)\\d{2})|' +
    'detenid[oa]\\s+en\\s+(?:19|20)\\d{2}|lo\\s+detuvieron|me\\s+detuvo|fichad[oa]|(?:lo|la|le)\\s+(?:habian|habia)\\s+pillado|(?:lo|le|la)\\s+condenaron|' +
    '(?:esta|estuvo|sigue)\\s+en\\s+(?:la\\s+)?(?:carcel|prision)|delincuentes\\s+sexuales|licenciamiento\\s+definitivo|ejecutoria\\s+\\d|juicio\\s+de\\s+antes|diligencias\\s+sobreseidas',
];

// Fuera de una causa penal (una reagrupación, un despido, un divorcio), todo lo penal que aparece es
// de antes o de otro: «a la pena de ocho meses de prisión, en suspenso», «le pusieron una multa»,
// «por un delito de lesiones en una riña en 2009». Dentro de una causa penal ese vocabulario es la
// causa misma, y solo cuenta el de los antecedentes (PENAL, arriba).
const PENAL_AMPLIO = [
  'pena\\s+de|penas\\s+de|delitos?\\s+(?:de|contra|leve)|multa\\s+de|una\\s+multa|pago\\s+(?:una\\s+)?multa|prision(?!\\s+provisional)|detenid[oa]s?|detencion|' +
    'conden\\w*|en\\s+suspenso|suspendid[oa]|juzgad[oa]\\s+por|juicio\\s+(?:por|penal)|causa\\s+penal|procedimiento\\s+penal|cancelad[oa]s?\\s+en\\s+\\d{4}',
];
const ANCLA_PERSONAL = /\b(?:19|20)\d{2}\b|\b(?:tuvo|tiene|ten[íi]a|le|les|me|fue|ha\s+sido|hab[íi]a|pag[óo]|cumpli[óo]|estuvo|su|sus|mi|mis|pusieron|condenaron|del\s+(?:padre|marido|esposo|c[óo]nyuge|hermano|reagrupante|interesado|solicitante))\b/i;
const CAUSA_PENAL = /\b(?:acusad[oa]s?|investigad[oa]s?|procesad[oa]s?|encausad[oa]s?|diligencias\s+previas|dilixencias\s+previas|procedimiento\s+abreviado|sumario|juicio\s+(?:oral|r[áa]pido|por\s+delito)|escrito\s+de\s+(?:acusaci[óo]n|defensa|calificaci[óo]n)|querella|atestado|Juzgado\s+de\s+(?:lo\s+Penal|Instrucci[óo]n|Menores|Violencia)|Xulgado\s+de|Fiscal[íi]a|Ministerio\s+Fiscal|expediente\s+de\s+reforma|orden\s+de\s+protecci[óo]n)\b/i;

const CLASES = [
  { clase: 'SALUD', tipo: 'CAT_ESPECIAL', res: SALUD.map(B), extra: [SIGLAS_SALUD, CODIGO_CIE, UNIDAD, SIGLA_IT] },
  { clase: 'SINDICAL', tipo: 'CAT_ESPECIAL', res: SINDICAL.map(B), extra: [SIGLAS_SINDICALES] },
  { clase: 'RELIGION', tipo: 'CAT_ESPECIAL', res: RELIGION.map(B) },
  { clase: 'POLITICA', tipo: 'CAT_ESPECIAL', res: POLITICA.map(B), extra: [SIGLAS_POLITICAS] },
  { clase: 'ETNIA', tipo: 'CAT_ESPECIAL', res: ETNIA.map(B) },
  { clase: 'SEXUAL', tipo: 'CAT_ESPECIAL', res: SEXUAL.map(B) },
  { clase: 'ORIENTACION', tipo: 'CAT_ESPECIAL', res: ORIENTACION.map(B) },
  { clase: 'ADICCION', tipo: 'CAT_ESPECIAL', res: ADICCION.map(B) },
  { clase: 'GENETICO', tipo: 'CAT_ESPECIAL', res: GENETICO.map(B), extra: [SIGLAS_GENETICAS] },
  { clase: 'BIOMETRICO', tipo: 'CAT_ESPECIAL', res: BIOMETRICO.map(B) },
  { clase: 'PENAL', tipo: 'DATO_PENAL', res: PENAL.map(B) },
  { clase: 'PENAL', tipo: 'DATO_PENAL', res: PENAL_AMPLIO.map(B), soloFueraDeCausa: true, anclado: true },
];

// Los disparadores de un texto: [{inicio, fin, clase, tipo}].
// Dentro del NOMBRE de una institución, un disparador no dice nada de nadie: «Directora General de
// Cuidados, Dependencia y Discapacidad», «Unidad de Conductas Adictivas», «Asociación de Apoyo a
// Pacientes Oncológicos». Se reconoce por la forma: una cabeza institucional y, hasta el
// disparador, solo palabras con mayúscula y conectores; y el disparador también con mayúscula.
const CABEZA_INST = /(?:Direcci[óo]n|Director[a]?|Consejer[íi]a|Conselleria|Conseller[íi]a|Ministerio|Servicio|Servei|Servizo|Unidad|Unitat|Unidade|Instituto|Institut|Centro|Centre|Asociaci[óo]n|Associaci[óo]|Fundaci[óo]n?|Programa|[ÁA]rea|Departamento|Departament|Comisi[óo]n|Oficina|Hospital|Cl[íi]nica|Federaci[óo]n|Confederaci[óo]n|Red|Xarxa|Plan|Consulta|Secci[óo]n|Subdirecci[óo]n|Agencia|Observatorio|Juzgado|Tribunal|Fiscal[íi]a|Registro|Colegio|Col·legi|Sociedad|Grupo)\s+(?:[\p{Lu}][\p{L}·'’-]*|de|del|la|las|los|y|e|i|a|al|en|para|sobre|contra|d'|,)(?:\s+(?:[\p{Lu}][\p{L}·'’-]*|de|del|la|las|los|y|e|i|a|al|en|para|sobre|contra|d'|,)|,)*\s*$/u;
function enNombreDeInstitucion(texto, inicio) {
  if (!/\p{Lu}/u.test(texto[inicio] ?? '')) return false;
  return CABEZA_INST.test(texto.slice(Math.max(0, inicio - 120), inicio));
}

// Una sigla sindical dentro del nombre de una empresa: «ATLANTIC SURF LAB, S.L.».
// En un escaneo (todo en mayúsculas) la palabra de delante va en mayúsculas siempre: «DELEGADA CGT» no es
// una empresa.
const esEscaneo = (t) => { const l = t.match(/\p{L}/gu) ?? []; return l.length > 40 && l.filter((c) => c === c.toUpperCase()).length / l.length > 0.8; };
const enRazonSocial = (texto, inicio, fin) => /^,?\s*S\.?\s?[LA]\.?(?![\p{L}])/u.test(texto.slice(fin, fin + 8)) || (!esEscaneo(texto) && /[A-ZÁÉÍÓÚÑ]{3,}\s+$/.test(texto.slice(Math.max(0, inicio - 12), inicio)));

// Una profesión dicha como CARGO de quien firma o informa no es un dato de salud de nadie: «la
// Procuradora D.ª», «psiquiatra colegiado nº 4.881, a instancia de la defensa», «Informe emitido
// por la Médico Forense D.ª», «especialista en Cirugía General».
const PROFESION = /^(?:medic[oa]s?|psicolog[oa]s?|psiquiatr\w*|enfermer[oa]s?|ginecolog\w*|pediatr\w*|neurolog\w*|cardiolog\w*|oncolog\w*|traumatolog\w*|cirujan[oa]s?|fisio\w*)$/;
function esCargo(texto, sombraTxt, d) {
  if (!PROFESION.test(sombraTxt.slice(d.inicio, d.fin))) return false;
  const despues = sombraTxt.slice(d.fin, d.fin + 40);
  const antes = sombraTxt.slice(Math.max(0, d.inicio - 40), d.inicio);
  return /^\s*(?:forense|colegiad|especialista|clinic[oa]|de\s+familia|del\s+trabajo|evaluador|perit|d\.|dr|dra|dª|d\.ª|don|dona|n\.?º|num|col\.)/.test(despues) ||
    /\b(?:perit[oa]s?|informe\s+(?:del?|emitido\s+por)|emitido\s+por|firmado\s+por|suscrito\s+por|a\s+instancia|designad[oa]|especialista\s+en|licenciad[oa]\s+en|colegio\s+de)\s+(?:la\s+|el\s+)?$/.test(antes) ||
    /^\s*[,:]?\s*\p{Lu}/u.test(texto.slice(d.fin, d.fin + 4)) && /\p{Lu}/u.test(texto[d.inicio]);
}

// El derecho, no el dato: «libertad sindical», «derecho de huelga», «Ley Orgánica de Libertad
// Sindical», «representación unitaria» son conceptos jurídicos, no la afiliación de nadie. (Una
// demanda «DE TUTELA DEL DERECHO FUNDAMENTAL DE LIBERTAD SINDICAL» se tapaba entera.)
const CONCEPTO_SINDICAL = /(?:libertad|llibertat|liberdade)\s+sindical|derecho\s+(?:de|a\s+la)\s+huelga|dret\s+de\s+vaga|ley\s+organica\s+(?:11\/1985|de\s+libertad\s+sindical)|representacion\s+(?:unitaria|sindical\s+en\s+la\s+empresa)|garantia\s+de\s+indemnidad|conducta\s+antisindical/g;

export function disparadores(texto, sombraTxt = sombra(texto)) {
  const conceptos = [...sombraTxt.matchAll(CONCEPTO_SINDICAL)].map((m) => [m.index, m.index + m[0].length]);
  const todos = disparadoresCrudos(texto, sombraTxt).filter((d) => d.clase !== 'SINDICAL' || !conceptos.some(([a, b]) => d.inicio >= a && d.fin <= b));
  return todos.filter((d) => !enNombreDeInstitucion(texto, d.inicio) && !(d.sigla && d.clase === 'SINDICAL' && enRazonSocial(texto, d.inicio, d.fin)) &&
    !(d.clase === 'SALUD' && NO_CLINICA.has(sombraTxt.slice(d.inicio, d.fin))) && !esCargo(texto, sombraTxt, d) &&
    // La tasa de alcoholemia es una prueba de tráfico, no un dato de salud (la cifra va en claro).
    !(d.clase === 'SALUD' && /mg\s?\/\s?l/i.test(texto.slice(d.inicio, d.fin)) && /alcoholemia|aire\s+espirado/i.test(texto.slice(Math.max(0, d.inicio - 120), d.fin))));
}

function disparadoresCrudos(texto, sombraTxt) {
  const fuera = [];
  const causaPenal = CAUSA_PENAL.test(texto);
  for (const c of CLASES) {
    if (c.soloFueraDeCausa && causaPenal) continue;
    for (const re of c.res) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(sombraTxt)) !== null) {
        if (!m[0].length) { re.lastIndex++; continue; }
        fuera.push({ inicio: m.index, fin: m.index + m[0].length, clase: c.clase, tipo: c.tipo, ...(c.anclado ? { anclado: true } : {}) });
      }
    }
    for (const re of c.extra ?? []) {
      re.lastIndex = 0;
      let m;
      // Sobre el texto con los ceros del OCR devueltos a su O, conservando la caja: «EP0C» es EPOC.
      const heno = texto.replace(/(?<=\p{Lu})0|0(?=\p{Lu})/gu, 'O');
      while ((m = re.exec(heno)) !== null) {
        if (!m[0].length) { re.lastIndex++; continue; }
        fuera.push({ inicio: m.index, fin: m.index + m[0].length, clase: c.clase, tipo: c.tipo, sigla: true });
      }
    }
  }
  return fuera;
}

// ───────────────────────────── Segmentos ─────────────────────────────
//
// La frase se corta en el punto (no el de una abreviatura: «tto.», «n.º», «Dr.»), el punto y coma,
// los dos puntos que abren un rótulo, el «·» de los informes y el arranque de cada mensaje de un
// chat («12/05/26, 10:01 - Lucía: …»). En la frase, cada coma abre un segmento; en un texto
// clínico denso no, porque ahí la frase entera es el dato.

const ABREV = /(?:^|[\s(])(?:d|dª|dña|sr|sra|srta|dr|dra|art|arts|núm|num|n|nº|excmo|excma|ilmo|ilma|pág|pag|apdo|ss|tto|trat|aprox|etc|vs|p\.ej|cf|cfr|rec|s\.l|s\.a|c|av|avda|izq|dcha|ej|exp|ref|tel|tlf|fdo|mg|ml|h|min|seg|vol|cap|ap)$/i;

export function segmentos(texto, { porComas = true } = {}) {
  const cortes = new Set([0, texto.length]);
  const debiles = new Set();
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    const sig = texto[i + 1];
    if (c === ';' || c === '\n' || c === '·' || c === '•' || c === '|') { cortes.add(i + 1); continue; }
    if ((c === '.' || c === '!' || c === '?' || c === '…') && (sig === undefined || /\s/.test(sig))) {
      const antes = texto.slice(Math.max(0, i - 8), i);
      if (!ABREV.test(antes) && !/(?:^|\s)\p{Lu}$/u.test(antes)) cortes.add(i + 1);
      continue;
    }
    // «Paciente: …», «Fecha: …»: los dos puntos de un rótulo. En un texto clínico no: «Anatomía
    // patológica de la biopsia: adenocarcinoma…» es una sola cosa.
    if (porComas && c === ':' && sig === ' ') { cortes.add(i + 1); continue; }
    if (porComas && c === ',' && sig === ' ' && !/\d$/.test(texto.slice(i - 1, i))) { cortes.add(i + 1); debiles.add(i + 1); }
  }
  // Cada mensaje de un chat.
  for (const m of texto.matchAll(/(?:^|\s)(?:\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\]?\s*-?\s*)/g)) cortes.add(m.index + (m[0].startsWith(' ') ? 1 : 0));
  // « y que », « pero », « aunque »: otro segmento (la segunda mitad no es el mismo dato).
  // Fuera de un texto clínico, también la «y»: «TIENE DEUDAS DE JUEGO Y ESTUVO EN LA CARCEL» son dos
  // cosas, y solo la segunda es un antecedente. (Lo que va a los dos lados de la «y» y es dato lleva
  // su propio disparador: «HTA y DM2».)
  if (porComas) {
    for (const m of texto.matchAll(/\s(?:pero|aunque|mientras que|sin embargo|perque|pero que|y|e|i|Y|E|I)\s/g)) {
      cortes.add(m.index + 1);
      if (/^\s[yeiYEI]\s$/.test(m[0])) debiles.add(m.index + 1);
    }
  }
  // El remitente de un chat («Rocío Amaya: …») abre un mensaje nuevo.
  for (const r of remitentesDeChat(texto)) cortes.add(r.inicio);
  const lista = [...cortes].sort((a, b) => a - b);
  const fuera = [];
  for (let k = 0; k < lista.length - 1; k++) if (lista[k + 1] > lista[k]) fuera.push({ inicio: lista[k], fin: lista[k + 1], debil: debiles.has(lista[k]) });
  return fuera;
}

// Los remitentes de un chat tal como lo deja el indexador: «Nombre Apellido: mensaje Nombre
// Apellido: mensaje…», todo en una línea. Un nombre con mayúscula que se repite delante de «:» al
// menos dos veces en el fragmento es quien escribe.
const ROTULOS = /^(?:Testigo|Testiga|Causa|Pregunta|Respuesta|Letrad[oa]|Fiscal|Declarante|Juez|Jueza|Magistrad[oa]|Abogad[oa]|Actor|Actora|Demandante|Demandad[oa]|Resultado|Fecha|Asunto|De|Para|Nota|Hechos|Fdo|Firma|Tel|Teléfono|Paciente|Pacient|Nombre|Nom|Diagnóstico|Tratamiento|Motivo|Juicio|Exploración|Antecedentes|Plan|Evolución|Edad|Sexo|NHC|CIP|TSI|Total|Importe|Documento|Página|Data|Assumpte|Asunto|Enviado|Para|Cc|Re|Fwd|RV|Objeto|Conclusiones|Conclusión|Observaciones|Diagnòstic|Tractament|Domicilio|DNI|NIE|Dirección|Profesión|Categoría|Empresa|Puesto|Autos|Procedimiento|Expediente|Referencia|Ref)$/i;

// Quien escribe en un chat: el nombre más largo que se repite delante de «:». En «…sabes Por Pau
// Vicent: lo siento» el remitente es «Vicent» (que escribe más veces), no «Por Pau Vicent».
export function remitentesDeChat(texto) {
  const re = /(?<![\p{L}\p{N}])((?:[\p{Lu}][\p{L}'’.-]*)(?:\s+(?:(?:de|del|la|i|y|da|dos|el|van|von|bin|ben|al)\s+)?[\p{Lu}][\p{L}'’.-]*){0,3}):\s/gu;
  const ocurrencias = [];
  let m;
  while ((m = re.exec(texto)) !== null) ocurrencias.push({ inicio: m.index, fin: m.index + m[1].length, valor: m[1] });
  const sufijos = (v) => {
    const p = v.split(/\s+/);
    return p.map((_, k) => p.slice(k).join(' ')).filter((x) => /^[\p{Lu}]/u.test(x));
  };
  const cuenta = new Map();
  for (const o of ocurrencias) for (const x of new Set(sufijos(o.valor))) cuenta.set(x, (cuenta.get(x) ?? 0) + 1);
  const fuera = [];
  for (const o of ocurrencias) {
    const elegido = sufijos(o.valor).find((x) => (cuenta.get(x) ?? 0) >= 2 && !ROTULOS.test(x));
    if (!elegido) continue;
    const ini = o.fin - elegido.length;
    fuera.push({ inicio: ini, fin: o.fin, valor: elegido });
  }
  return fuera.sort((a, b) => a.inicio - b.inicio);
}

// ¿Es un texto clínico denso? Muchos disparadores de salud por palabra: un informe médico, una
// pericial, un parte de lesiones, la hoja de exploración de un dictamen.
function densidadClinica(texto, disp) {
  const palabras = (texto.match(/[\p{L}\p{N}]+/gu) ?? []).length || 1;
  return disp.filter((d) => d.clase === 'SALUD').length / palabras;
}

// ───────────────────────────── La expansión ─────────────────────────────
//
// `ocupado`: posiciones que no se tocan (guardia, objeto, lo ya tapado con su tipo).
// Devuelve las detecciones nuevas: los trozos de cada segmento con disparador que quedan libres.
// Cuando el expediente ya ha establecido una categoría como el OBJETO del escrito (una tutela de
// libertad sindical, una solicitud de asilo por orientación sexual, una demanda por discriminación
// étnica, unas medidas por la adicción de un progenitor), el vocabulario de ESA categoría dicho de
// la parte no hace sensible la frase: «portavoz del comité de huelga», «candidatura de CCOO», «la
// dueña no quiere gitanos», «14.000 euros en apuestas». Sí la hace si en el segmento aparece un
// tercero (el compañero afiliado, la hermana lesbiana): el criterio de fondo nunca pasa el dato
// de otro. Y el detalle clínico sigue siendo SALUD, que no pasa por esto.
// Solo sindical y adicciones: en origen étnico y orientación el contexto no distingue bien la parte
// del tercero (en una tutela sindical, el acoso al compañero gitano o a la compañera lesbiana), y
// ahí pasa solo la expresión exacta del objeto («origen étnico», «orientación sexual»).
// (Los antecedentes no: Juan exige que la FRASE los presente como objeto —se pide su cancelación,
// son el motivo del recurso—, y eso lo decide esObjeto término a término, no el expediente entero.)
// (Las adicciones tampoco: el criterio de Juan deja pasar la CONDICIÓN —«toxicomanía», «drogadicción»—
// por esObjeto; los controles de orina y los «6 a 8 porros al día» son el detalle, y se tapan.)
const PASA = { ...(CRITERIO_EXTENDIDO ? { SINDICAL: 'SINDICAL' } : {}) };
const TERCERO_SEG = /(?<![\p{L}])(?:testigos?|vecin[oa]s?|herman[oa]s?|germ[àa]|irm[áa]n?|prim[oa]s?|cuñad[oa]s?|cunyad[oa]|suegr[oa]s?|compañer[oa]s?|company[oa]|companys|amig[oa]s?|t[íi][oa]s?|abuel[oa]s?|esposa|espos[oa]|marido|c[óo]nyuge|padre|madre|pare|mare|pai|nai|aita|ama|amatxo|hij[oa]s?|fill[ae]?|otr[oa]s?\s+(?:trabajador\w*|emplead\w*)|tercer[oa]s?)(?![\p{L}])/iu;

// En la frase que presenta un antecedente como objeto («La única condena de mi defendido, por un
// delito contra la seguridad vial de 2022, está cancelada o es cancelable»), lo penal que la
// acompaña es ese mismo objeto, no otro dato. Si la frase nombra a un tercero, no.
const OBJETO_DE_CLASE = { ANTECEDENTES: 'PENAL', ADICCION: 'ADICCION' };

export function tramosSensibles(texto, { ocupado, objetoEn = () => false, objetos = new Set(), objetosAqui = [], frases = [] }) {
  const s = sombra(texto);
  const pasan = new Set([...objetos].map((o) => PASA[o]).filter(Boolean));
  const disp = disparadores(texto, s).filter((d) => {
    // Un disparador que cae dentro de la guardia (el «Hospital Universitario Miguel Servet», la
    // «Unidad de Salud Mental») o que ES el objeto del escrito no hace sensible a su segmento.
    for (let i = d.inicio; i < d.fin; i++) if (ocupado.guardia[i] || ocupado.objeto[i]) return false;
    if (objetoEn(d.inicio, d.fin)) return false;
    for (const o of objetosAqui) {
      if (OBJETO_DE_CLASE[o.clase] !== d.clase) continue;
      const f = frases.find((x) => o.inicio >= x.inicio && o.inicio < x.fin);
      const propia = /\bmis?\s+(?:defendid[oa]|mandante|cliente|representad[oa])\b/i.test(o.valor ?? '');
      if (f && d.inicio >= f.inicio && d.fin <= f.fin && (propia || !TERCERO_SEG.test(texto.slice(f.inicio, f.fin)))) return false;
    }
    return true;
  });
  if (!disp.length) return [];
  const dens = densidadClinica(texto, disp);
  // Con un mínimo de disparadores: una frase suelta de doce palabras con un término clínico no es un
  // informe clínico.
  const nSalud = disp.filter((d) => d.clase === 'SALUD').length;
  const denso = dens >= 0.05 && nSalud >= 5;
  // Un informe clínico de verdad (más de 7 disparadores de salud cada 100 palabras): más de la
  // mitad del texto es dato de salud. Ahí se tapa todo lo que no es rótulo, fecha, nombre o
  // institución: «Consciente», «Buen estado general», «No RAMC» son exploración, aunque no lleven
  // ningún término clínico.
  const nPenal = disp.filter((d) => d.clase === 'PENAL').length;
  const palabras = (texto.match(/[\p{L}\p{N}]+/gu) ?? []).length || 1;
  // Un documento de antecedentes (hoja histórico-penal, certificado de penales): todo él es el dato.
  const historicoPenal = nPenal >= 4 && nPenal / palabras >= 0.012 && /hist[óo]rico[-\s]penal|antecedentes\s+penales|certificad[oa]\s+de\s+(?:antecedentes|penales)|certificaci[óo]n\s+de\s+antecedentes|registro\s+central\s+de\s+(?:penados|delincuentes)|casier\s+judiciaire|casillero\s+judicial|licenciamiento\s+definitivo/i.test(sombra(texto));
  const clinico = (dens >= 0.07 && nSalud >= 8) || historicoPenal;
  const segs = segmentos(texto, { porComas: !denso });
  const fuera = [];
  let anteriorSensible = false;
  for (const seg of segs) {
    let aqui = disp.filter((d) => d.inicio >= seg.inicio && d.fin <= seg.fin);
    // Lo penal «amplio» solo cuenta si el segmento lo ata a alguien y a un hecho pasado: «el delito
    // de injuria» de un razonamiento jurídico no es el antecedente de nadie; «por esta causa» es la
    // causa misma.
    // El ancla se busca en la FRASE: «…al marido le pusieron en 2016 una pena de ocho meses de prisión,
    // en suspenso, y multa» lleva el ancla en la primera parte y el dato en las tres.
    const fr = frases.find((x) => seg.inicio >= x.inicio && seg.inicio < x.fin) ?? seg;
    const trozoFrase = texto.slice(fr.inicio, fr.fin);
    if (aqui.some((d) => d.anclado) && (!ANCLA_PERSONAL.test(trozoFrase) || /\besta\s+causa\b/i.test(trozoFrase))) aqui = aqui.filter((d) => !d.anclado);
    if (pasan.size && aqui.some((d) => pasan.has(d.clase)) && !TERCERO_SEG.test(texto.slice(seg.inicio, seg.fin))) {
      aqui = aqui.filter((d) => !pasan.has(d.clase));
    }
    // La coletilla que describe lo de antes: «…en fase moderada (GDS 5), amb desorientació i
    // episodis d'agitació nocturna», «…, con afectación de la grasa pericólica».
    const hereda = !aqui.length && anteriorSensible && seg.debil && COLETILLA.test(texto.slice(seg.inicio, seg.fin));
    const todoClinico = !aqui.length && clinico;
    if (!aqui.length && !hereda && !todoClinico) { anteriorSensible = false; continue; }
    if (!aqui.length) aqui = [{ inicio: seg.inicio, fin: seg.fin, clase: historicoPenal ? 'PENAL' : 'SALUD', tipo: historicoPenal ? 'DATO_PENAL' : 'CAT_ESPECIAL', virtual: true }];
    anteriorSensible = true;
    // El tipo del tramo: si hay algo de 9.1, categoría especial; si solo hay penal, dato penal.
    const especial = aqui.find((d) => d.tipo === 'CAT_ESPECIAL');
    const tipo = especial ? 'CAT_ESPECIAL' : 'DATO_PENAL';
    const clase = (especial ?? aqui[0]).clase;
    // Un segmento muy largo sin puntuación (una tabla de nómina, una analítica aplanada) no se tapa
    // entero: solo una ventana alrededor de cada disparador.
    const ventanas = seg.fin - seg.inicio > 300 && !clinico
      ? fundirVentanas(aqui.filter((d) => !d.virtual).map((d) => ventana(texto, seg, d)))
      : [{ inicio: seg.inicio, fin: seg.fin }];
    for (const v of ventanas) {
    let i = v.inicio;
    while (i < v.fin) {
      while (i < v.fin && (ocupado.todo[i])) i++;
      let f = i;
      while (f < v.fin && !ocupado.todo[f]) f++;
      let a = i;
      let b = f;
      // Fuera de un informe clínico, el principio LARGO de una frase no es el dato: «Durante enero y
      // febrero de 2026 la actora se encontraba en | las primeras semanas de un tratamiento de
      // reproducción asistida». Se dejan en claro las palabras a más de seis del primer disparador;
      // las seis más cercanas se tapan con él («me hice por fin la prueba del gen…» entero). Recortar
      // más cerca (probado el 2-oct) dejaba en claro «PATRÓN COMPATIBLE CON CONSUMO CRÓNICO DE…»: en
      // categoría especial, en la duda, se tapa.
      if (!clinico) {
        const primero = Math.min(
          ...aqui.filter((d) => !d.virtual && d.inicio >= a && d.inicio < b).map((d) => d.inicio),
          ...(ocupado.sensible ? [ocupado.sensible.slice(a, b).findIndex(Boolean)].filter((x) => x >= 0).map((x) => a + x) : []),
        );
        if (Number.isFinite(primero) && primero > a) {
          const antes = [...texto.slice(a, primero).matchAll(/\S+/g)];
          if (antes.length > 6) a = a + antes[antes.length - 6].index;
        }
      }
      while (a < b && /[\s,;:.·•|()\-–—«»"'¿¡]/.test(texto[a])) a++;
      while (b > a && /[\s,;:.·•|(\-–—«»"'¿¡]/.test(texto[b - 1])) b--;
      // Un paréntesis que se abre dentro del trozo y se cierra fuera: el cierre va con él.
      const trozo = texto.slice(a, b);
      // Solo el trozo que lleva el dato: un disparador o lo que ya tapaban las reglas. «Su
      // compañera» delante de un nombre no dice nada de la salud de nadie; «refiere dolor» sí.
      const lleva = aqui.some((d) => d.inicio < b && a < d.fin) || (ocupado.sensible && ocupado.sensible.slice(a, b).some(Boolean));
      if (b > a && lleva && /\p{L}{2,}|\d/u.test(trozo) && !soloRelleno(trozo) && !(clinico && soloAdministrativo(trozo))) {
        fuera.push({ tipo, clase, valor: trozo, inicio: a, fin: b, via: `tramo:${clase.toLowerCase()}${clinico ? ':clinico' : denso ? ':denso' : ''}` });
      }
      i = f;
    }
    }
  }
  return fuera;
}

// La ventana de un disparador dentro de un segmento largo: hasta 8 palabras a cada lado.
function ventana(texto, seg, d) {
  let a = d.inicio;
  let b = d.fin;
  for (let n = 0; n < 8 && a > seg.inicio; n++) { a--; while (a > seg.inicio && !/\s/.test(texto[a - 1])) a--; }
  for (let n = 0; n < 8 && b < seg.fin; n++) { b++; while (b < seg.fin && !/\s/.test(texto[b])) b++; }
  return { inicio: Math.max(seg.inicio, a), fin: Math.min(seg.fin, b) };
}
function fundirVentanas(vs) {
  const o = vs.sort((x, y) => x.inicio - y.inicio);
  const fuera = [];
  for (const v of o) {
    const u = fuera[fuera.length - 1];
    if (u && v.inicio <= u.fin) u.fin = Math.max(u.fin, v.fin);
    else fuera.push({ ...v });
  }
  return fuera;
}

const ENLACE = new Set(['un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'lo', 'su', 'sus', 'mi', 'mis', 'tu', 'de', 'del', 'con', 'sin', 'por', 'en', 'a', 'al',
  'este', 'esta', 'ese', 'esa', 'aquel', 'aquella', 'gran', 'grave', 'leve', 'fuerte', 'muy', 'mucho', 'mucha', 'otro', 'otra', 'nuevo', 'nueva', 'primer', 'segundo',
  'segunda', 'unha', 'o', 'os', 'as', 'da', 'do', 'dos', 'das', 'na', 'no', 'amb', 'per', 'els', 'les', 'l', 'd', 'seu', 'seva']);

const COLETILLA = /^\s*(?:con|amb|sin|sense|co|coa|cun|cunha|y\s+con|i\s+amb|e\s+con|asociad[oa]s?\s+a|secundari[oa]s?\s+a|derivad[oa]s?\s+de|que\s+(?:precis|requier|oblig|le\s+impid|le\s+limit|afect))\b/i;

// En un informe clínico, lo que no es dato: el rótulo, la fecha, el número de página.
const ADMIN = new Set(['paciente', 'pacient', 'nombre', 'nom', 'apellidos', 'edad', 'años', 'anys', 'sexo', 'varón', 'varon', 'mujer', 'hombre', 'fecha', 'data',
  'nacimiento', 'naixement', 'nhc', 'cip', 'nº', 'n', 'número', 'numero', 'servicio', 'servei', 'hospital', 'centro', 'médico', 'medico', 'doctor', 'doctora',
  'dr', 'dra', 'firma', 'fdo', 'página', 'pagina', 'pág', 'de', 'del', 'la', 'el', 'informe', 'motivo', 'sello', 'colegiado', 'colegiada', 'col', 'teléfono',
  'telefono', 'dirección', 'direccion', 'domicilio', 'episodio', 'a', 'en', 'y', 'e', 'i', 'por', 'para', 'responsable', 'facultativo', 'facultativa',
  'emitido', 'firmado', 'electrónicamente', 'electronicamente', 'copia', 'original', 'hoja', 'ref', 'referencia', 'expediente', 'código', 'codigo',
  'verificación', 'verificacion', 'csv', 'mañana', 'tarde', 'hora', 'horas', 'lugar', 'destinatario', 'atentamente', 'saludos', 'cordialmente']);
function soloAdministrativo(trozo) {
  const p = trozo.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return p.every((w) => ADMIN.has(w) || /^\d+$/.test(w) || w.length < 2);
}

// Lo que no dice nada solo: un conector, un artículo, «y», «de la», una fecha suelta no.
const RELLENO = new Set(['y', 'e', 'o', 'u', 'de', 'del', 'la', 'el', 'los', 'las', 'en', 'a', 'al', 'con', 'por', 'para', 'que', 'su', 'sus', 'un', 'una', 'i', 'da', 'do', 'na', 'no', 'se', 'lo', 'le', 'les', 'como', 'según', 'segun', 'ante', 'entre', 'sobre', 'tras', 'desde', 'hasta', 'sin']);
function soloRelleno(trozo) {
  const p = trozo.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return p.every((w) => RELLENO.has(w) || w.length < 2);
}

export default tramosSensibles;
