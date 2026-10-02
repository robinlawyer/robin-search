// Categoría especial del artículo 9.1 RGPD.
//
// Es la regla que Alonso y Juan cerraron como «tapar SIEMPRE en caso de duda», y la que el banco
// del 23-sep encontró a CERO: ninguno de los cuatro reconocedores tapaba un solo dato de salud,
// de afiliación sindical o de confesión religiosa. Es lógico — «espondilitis anquilosante» no es
// un nombre, y un reconocedor de nombres no lo busca. Así que la regla no tenía nada detrás.
//
// Esto es lo que va detrás. No es un modelo: es vocabulario y contexto, que para esto funciona
// mejor, porque el conjunto de cosas que el 9.1 protege es cerrado y se puede enumerar:
//
//   salud · origen étnico o racial · opiniones políticas · convicciones religiosas o filosóficas
//   afiliación sindical · datos genéticos · datos biométricos · vida sexual u orientación sexual
//
// Criterio de diseño, y es deliberado: aquí se tapa de más a propósito. En el resto del
// anonimizador la regla acordada es dejar pasar en caso de duda; en categoría especial es la
// contraria, y la propia decisión del hilo dice que en la duda se tapa. Un diagnóstico de más
// tapado cuesta una palabra del escrito; uno de menos manda la salud de un cliente a un tercero.

import { FONDO, terminosDeFondo, esObjeto, frases } from './objeto.mjs';

const T = (f, b = 'gi') => new RegExp(f, b);

// ───────────────────────────── Salud ─────────────────────────────
//
// Tres vías: el término clínico por su MORFOLOGÍA (los sufijos griegos y latinos de la medicina
// son productivos y cubren muchísimo más que cualquier lista cerrada de patologías), el contexto
// que anuncia un dato de salud, y la medicación.

// «-oma» NO va aquí: casaba con «toma», «idioma», «diploma», «broma». Los tumores van por su nombre
// (TUMORES, abajo). Y los sufijos que quedan tienen palabras corrientes que acaban igual
// («simpatía», «academia», «nostalgia», «injuria»): esas se descartan por su nombre (NO_CLINICAS).
const SUFIJOS_CLINICOS =
  '(?:itis|osis|emia|patía|patia|algia|ectomía|ectomia|tomía|tomia|stomía|plastia|scopia|terapia|teràpia|iasis|penia|' +
  'trofia|tròfia|plejía|plejia|paresia|fagia|uria|cardia|dinia|acusia|acúsia|plasia|rragia|rrea)';
const TUMORES =
  '(?:carcin|melan|hemat|glauc|sarc|linf|miel|aden|fibr|lip|papil|ater|granul|neur|oste|mesoteli|gli|terat|' +
  'meningi|blast|neuroblast|retinoblast|angi|condr|hemangi|hepat|insulin|leiomi|mi|neurofibr|semin|cordo|craneofaringi|astrocit|ependim)oma';
const NO_CLINICAS = new Set(['simpatia', 'antipatia', 'empatia', 'telepatia', 'apatia', 'academia', 'blasfemia',
  'nostalgia', 'injuria', 'penuria', 'furia', 'curia', 'lujuria', 'centuria', 'incuria', 'metamorfosis', 'simbiosis',
  'apoteosis', 'tuberosis', 'hipotesis', 'sintesis', 'tesis', 'antitesis', 'protesis', 'genesis', 'enfasis', 'crisis',
  'dosis', 'psicosis', 'misericordia', 'concordia', 'discordia', 'endemia', 'bohemia', 'abstemia', 'infamia',
  'tumoracion', 'cardiologia',
  // Una prueba, no un dato de salud: «la prueba de alcoholemia arroja 0,62 mg/l» (la cifra ya va en claro).
  'alcoholemia']);
const sinTildesMin = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Dosis que acompaña al fármaco: «600 mg», «5 mg/día», «20 UI».
const DOSIS = '(?:\\s+\\d+(?:[.,]\\d+)?\\s*(?:mg|g|ml|mcg|µg|UI|mg\\/d[íi]a|mg\\/kg)(?:\\s*\\/\\s*(?:d[íi]a|\\d+\\s*h))?(?:\\s+cada\\s+\\d+\\s+horas)?)?';

// La coletilla que dice cómo es o dónde afecta lo diagnosticado: «con fracción de eyección del
// 45 %», «con hernia discal L5-S1», «con rectificación de la lordosis», «en fase moderada», «tipo
// I». Sin ella, el trozo tapado se quedaba corto y el detalle clínico salía en claro.
const VOC_CLINICO =
  '(?:[a-záéíóúñ]{3,}(?:itis|osis|emia|pat[íi]a|algia|plej[íi]a|paresia)|[a-z]+oma(?=\\s)(?<!toma)(?<!idioma)(?<!diploma)|hernia|fractura|rotura|lesi[óo]n|' +
  'rectificaci[óo]n|lordosis|cifosis|escoliosis|fracci[óo]n\\s+de\\s+eyecci[óo]n|afectaci[óo]n|compromiso|' +
  'secuelas?|limitaci[óo]n|d[ée]ficit|protrusi[óo]n|estenosis|[LCDT]\\d-[LCDTS]\\d|ingresos?\\s+hospitalarios?|' +
  'brotes?|crisis|recidiva|met[áa]stasis|insuficiencia|disfunci[óo]n|atrofia|necrosis|isquemia|irradiaci[óo]n|' +
  'miembro\\s+(?:superior|inferior)|miembros\\s+inferiores|parestesias?|hipoestesia|limitaci[óo]n\\s+funcional|vejiga|radiculopat[íi]a|[LCDTS]\\d)';
const COLETILLA =
  `(?:\\s+(?:tipo\\s+(?:\\d|I{1,3}|IV)|en\\s+(?:fase|grado|estadio)\\s+(?!de\\b)[a-záéíóúñ]+|` +
  `(?:con|y)\\s+(?=[^.;,\\n]{0,40}${VOC_CLINICO})[^.;,\\n]{3,80}?(?=[.;,\\n]|$|\\s+(?:que|desde|seg[úu]n|por\\s+lo|sin)\\s)))*`;

const SINDICATO =
  'Comisiones\\s+Obreras|CC\\.?\\s?OO\\.?|Uni[óo]n\\s+General\\s+de\\s+Trabajadores|UGT|CGT|CNT|USO|ELA|LAB|CSIF|SATSE|CIG|' +
  'Intersindical(?:\\s+[A-Z][\\wáéíóú]+)*|CSI-F|STEs|ANPE|SPJ-USO|STAJ|Confederaci[óo]n(?:\\s+(?:de|del|General|Sindical|Nacional))*(?:\\s+[A-Z][\\wáéíóú]+){1,4}';

const ADJETIVOS =
  '(?:\\s+(?:cr[óo]nic[oa]|agud[oa]|grave|leve|moderad[oa]|sever[oa]|bilateral|recurrente|degenerativ[oa]|' +
  'postraum[áa]tic[oa]|reactiv[oa]|persistente|avanzad[oa]|incipiente|mayor|menor|mec[áa]nic[oa]|inespec[íi]fic[oa]|' +
  'irradiad[oa]|difus[oa]|localizad[oa]|residual|secundari[oa]|primari[oa]|mixt[oa]|intervenid[oa]|avanzad[oa])(?:\\s*\\(\\s*GDS\\s*\\d\\s*\\))?)*';

// Una palabra que puede ir dentro de la descripción de una lesión o un síntoma: cualquiera MENOS las
// funcionales y los participios de trámite. Sin esta exclusión, «fractura de huesos propios nasales y
// una» se comía la conjunción, y en «herida inciso-contusa en región malar» el hueco se tragaba el
// «en» y lo que venía detrás ya no casaba.
const PAL_CLIN = '(?!(?:y|e|o|u|en|de|del|la|el|los|las|un|una|con|que|por|para|sin|a|al|documentad[oa]s?|acreditad[oa]s?|emitid[oa]|seg[úu]n|tras|desde|hasta)(?![a-záéíóúñ\\-]))[a-záéíóúñ][a-záéíóúñ\\-]*';

const REGLAS = [
  {
    clase: 'SALUD',
    nota: 'término clínico por su forma',
    // Una o dos palabras terminadas en sufijo clínico, con sus adjetivos detrás: «espondilitis
    // anquilosante», «artrosis degenerativa bilateral».
    re: T(
      `\\b(?:[a-záéíóúñ]{3,}${SUFIJOS_CLINICOS}|${TUMORES})\\b` +
        `(?:\\s+(?:[a-záéíóúñ]+(?:ante|ada|ado|ica|ico|iva|ivo|osa|oso|al|ar|aria|ario)|bilateral|` +
        `crónic[oa]|agud[oa]|grave|leve|moderad[oa]|severo|generalizad[oa]|mayor|tipo\\s+\\d+))*` +
        // …y la coletilla que describe la extensión: «con afectación sacroilíaca bilateral». Sin
        // ella el trozo tapado se quedaba corto y la parte que decía DÓNDE afecta salía en claro.
        COLETILLA,
    ),
  },
  {
    clase: 'SALUD',
    nota: 'diagnóstico anunciado',
    // «diagnosticado de X», «padece X», «en tratamiento con X», «episodio de X».
    // El grupo 1 es SOLO el dato: el verbo que lo anuncia no se tapa. Y se corta en la primera
    // conjunción o coma, porque si no una sola detección se traga la frase entera y se lleva por
    // delante el segundo diagnóstico, que entonces sale en claro. Pasó: «padece espondilitis… y
    // está diagnosticado de dia|betes» dejaba la diabetes fuera, partida por la mitad.
    re: T(
      `\\b(?:diagnosticad[oa]\\s+de|padece(?:\\s+de)?|sufre(?:\\s+de)?|aquejad[oa]\\s+de|` +
        `refiere\\s+un[ao]|presenta\\s+un[ao]|consta\\s+(?:un[ao]\\s+)?(?:episodio|cuadro)\\s+de|` +
        `trastorno\\s+(?:de|por)|s[íi]ndrome\\s+de|episodio\\s+de|cuadro\\s+de|` +
        `(?:en\\s+|sigue\\s+|sigui[óo]\\s+|recibe\\s+|recibi[óo]\\s+)?tratamiento\\s+(?:con|de|por|para)|con\\s+seguimiento\\s+en|crisis\\s+de|` +

        `grado\\s+de\\s+discapacidad\\s+de)` +
        `\\s+((?:[^.;,\\n]|,\\s*(?!\\s))*?)(?=\\s+(?:y|e|desde|seg[úu]n|en\\s+(?:la|el|los|las)|que|con\\s+un|documentad[oa]s?|acreditad[oa]s?|emitid[oa]|por\\s+(?:el|la)|aunque|pero)\\s|[.;,\\n]|$)`,
    ),
    grupo: 1,
  },
  {
    clase: 'SALUD',
    nota: 'episodio o cuadro con adjetivo',
    // «un episodio depresivo mayor», «un cuadro ansioso reactivo»: sin «de» en medio, así que la
    // regla del diagnóstico anunciado no los veía.
    re: T(
      // Solo con un adjetivo CLÍNICO: «cuadro depresivo», «episodio psicótico». «Cuadro idéntico»,
      // «cuadro comparativo» o «cuadro técnico» no dicen nada de la salud de nadie.
      `\\b(?:episodio|cuadro|trastorno|s[íi]ndrome|brote)\\s+` +
        `(?:depresiv[oa]|ansios[oa]|ansioso-depresiv[oa]|psic[óo]tic[oa]|confusional|man[íi]ac[oa]|delirante|febril|infeccios[oa]|` +
        `gripal|v[íi]ric[oa]|bacterian[oa]|al[ée]rgic[oa]|convulsiv[oa]|disociativ[oa]|obsesiv[oa]|f[óo]bic[oa]|reactiv[oa]|adaptativ[oa]|` +
        `sincopal|an[ée]mic[oa]|isqu[ée]mic[oa]|hipertensiv[oa]|diab[ée]tic[oa]|bipolar|esquizoafectiv[oa]|epil[ée]ptic[oa]|coronari[oa]|` +
        `demencial|autista|psicopatol[óo]gic[oa]|traum[áa]tic[oa]|postraum[áa]tic[oa]|asm[áa]tic[oa]|respiratori[oa]|dolor[oa]s[oa])\\b(?:\\s+(?:mayor|menor|grave|leve|` +
        `moderad[oa]|cr[óo]nic[oa]|agud[oa]|recurrente|reactiv[oa]))?`,
    ),
  },
  {
    clase: 'SALUD',
    nota: 'patología nombrada',
    re: T(
      `\\b(?:diabetes(?:\\s+mellitus)?(?:\\s+tipo\\s+\\d)?(?:\\s+insulinodependiente)?|` +
        `c[áa]ncer(?:\\s+de\\s+[a-záéíóúñ]+)?|carcinoma|tumor(?:\\s+[a-záéíóúñ]+)?|VIH|sida|` +
        `hepatitis\\s*[ABC]?|esquizofrenia|depresi[óo]n(?:\\s+(?:mayor|cr[óo]nica))?|ansiedad|` +
        `bipolar(?:idad)?|anorexia|bulimia|alzh[ée]imer|p[áa]rkinson|epilepsia|asma|` +
        `fibromialgia|esclerosis(?:\\s+m[úu]ltiple)?|ictus|infarto(?:\\s+de\\s+[a-záéíóúñ]+)?|` +
        `alcoholismo|ludopat[íi]a|toxicoman[íi]a|drogodependencia|drogadicci[óo]n|embriaguez\\s+habitual|minusval[íi]a|(?:(?:grado|grao)\\s+de\\s+)?discapacidade|(?:grado\\s+de\\s+)?discapacidad(?:\\s+(?:f[íi]sica|` +
        `ps[íi]quica|intelectual|sensorial))?|invalidez|incapacidad\\s+(?:permanente|laboral)` +
        `(?:\\s+(?:total|absoluta|parcial))?|incapacidad\\s+temporal|gran\\s+invalidez|` +
        // Catalán y gallego: «incapacitat permanent», «discapacitat», «embaràs», «alcoholisme»,
        // «incapacidade permanente».
        `incapacitat\\s+(?:permanent|temporal)(?:\\s+(?:total|absoluta|parcial))?|incapacidade\\s+(?:permanente|temporal)(?:\\s+(?:total|absoluta|parcial))?|` +
        `discapacitat|embar[àa]s|alcoholisme|drogodepend[èe]ncia|toxicomania|` +
        `embarazo(?:\\s+de\\s+riesgo)?|embarazada(?:\\s+de\\s+[a-záéíóúñ\\d]+\\s+(?:meses|semanas))?|gestaci[óo]n|aborto|` +
        `interrupci[óo]n\\s+voluntaria\\s+del\\s+embarazo|hernia(?:\\s+discal)?(?:\\s+[LCDT]\\d-[LCDTS]\\d)?|(?:lumbo)?ci[áa]tica|` +
        `trastorno\\s+(?:bipolar|l[íi]mite|obsesivo|psic[óo]tico|depresivo|de\\s+ansiedad|del\\s+espectro\\s+autista|` +
        `de\\s+la\\s+conducta\\s+alimentaria|de\\s+estr[ée]s\\s+postraum[áa]tico)(?:\\s+(?!tipo\\b|con\\b|y\\b|en\\b|que\\b)[a-záéíóúñ]+)?|` +
        `programa\\s+de\\s+(?:deshabituaci[óo]n|desintoxicaci[óo]n|mantenimiento\\s+con\\s+metadona|metadona)` +
        `(?:\\s+(?:alcoh[óo]lica|al\\s+alcohol|al\\s+juego|de\\s+opi[áa]ceos))?)\\b` + ADJETIVOS + COLETILLA,
    ),
  },
  {
    clase: 'SALUD',
    nota: 'siglas clínicas',
    // Solo en mayúsculas y como palabra entera: «TDAH», «TEA», «EPOC». En minúscula «tea» o «toc»
    // son otra cosa.
    re: T('\\b(?:TDAH|TEA|TOC|TLP|EPOC|TCA|TEPT|HTA|DM[12]|VHC|VHB)\\b', 'g'),
  },
  {
    clase: 'SALUD',
    nota: 'historia clínica y bajas',
    re: T(
      `\\b(?:historia(?:l)?\\s+cl[íi]nic[oa]|informe\\s+(?:m[ée]dico|cl[íi]nico|de\\s+alta|de\\s+urgencias|` +
        `psiqui[áa]trico|psicol[óo]gico|forense\\s+de\\s+sanidad)(?:\\s+de\\s+(?:urgencias|alta|s[íi]ntese|s[íi]ntesis|` +
        `valoraci[óo]n|seguimiento))?|parte\\s+(?:de\\s+baja|de\\s+lesiones|m[ée]dico)|` +
        `baja\\s+(?:m[ée]dica|laboral|por\\s+(?:enfermedad(?:\\s+com[úu]n)?|accidente(?:\\s+(?:de\\s+trabajo|laboral|no\\s+laboral))?|` +
        `embarazo(?:\\s+de\\s+riesgo)?|riesgo\\s+durante\\s+el\\s+embarazo|maternidad|paternidad|incapacidad\\s+temporal|IT))|` +
        `alta\\s+m[ée]dica|ingresos?\\s+hospitalarios?|` +
        `tratamiento\\s+(?:psiqui[áa]trico|psicol[óo]gico|oncol[óo]gico)|` +
        `seguimiento\\s+en\\s+salud\\s+mental)\\b`,
    ),
  },
  {
    clase: 'SALUD',
    nota: 'medicación en lista',
    // «en tratamiento con interferón beta y sertralina»: la regla general se corta en la «y», que
    // es lo que hay que hacer para no tragarse media frase, pero entonces el SEGUNDO fármaco se
    // quedaba fuera. Esta recoge la lista entera, que aquí sí es toda ella dato de salud.
    re: T(`(?<=tratamiento\\s+(?:con|de|por)\\s)[^.;\\n]{3,80}?(?=\\s+(?:desde|durante|seg[úu]n|que|desde\\s+el|y\\s+consta|en\\s+\\d|aunque|pautad[oa])|[.;,\\n]|$)`),
  },
  {
    clase: 'SALUD',
    nota: 'medicación',
    // Principios activos por su morfología: -pram, -zepam, -olol, -pril, -statina, -cilina…
    // La raíz puede ser corta: «ibu-profeno», «dia-zepam». Con {4,} se escapaban los dos
    // analgésicos más recetados de España. Y la dosis va con el fármaco («600 mg»).
    re: T(
      `\\b[a-záéíóúñ]{2,}(?:pram|zepam|zolam|olol|pril|sartán|sartan|statina|cilina|micina|` +
        // Ni «-vir» ni «-pina» a secas: casaban con «vivir» y «espina». Esos van por su nombre.
        `azol|tidina|caína|caina|fenaco|profeno|metacina|xetina|triptán|triptan|dronato|` +
        `azepina|glitazona|gliptina|limus|umab|imab|grel)\\b${DOSIS}`,
    ),
  },
  {
    clase: 'SALUD',
    nota: 'medicación por su nombre o su familia',
    // Los que no tienen una terminación que los delate, y las familias de fármacos, que dicen tanto
    // como el fármaco: «toma antidepresivos», «en tratamiento con metadona».
    re: T(
      `\\b(?:metadona|disulfiram|naltrexona|buprenorfina|metilfenidato|litio|insulina|fingolimod|` +
        `interfer[óo]n(?:\\s+beta)?|risperidona|olanzapina|quetiapina|haloperidol|clozapina|aripiprazol|` +
        `sertralina|paroxetina|fluoxetina|escitalopram|citalopram|venlafaxina|duloxetina|mirtazapina|` +
        `trazodona|lorazepam|alprazolam|clonazepam|lormetazepam|zolpidem|pregabalina|gabapentina|` +
        `tramadol|morfina|fentanilo|oxicodona|tapentadol|metformina|levotiroxina|sintrom|acenocumarol|` +
        `donepezilo|rivastigmina|memantina|galantamina|clopidogrel|apixab[áa]n|rivaroxab[áa]n|edoxab[áa]n|dabigatr[áa]n|estradiol|ciproterona|testosterona|aciclovir|valaciclovir|tenofovir|ritonavir|` +
        `efavirenz|oseltamivir|sofosbuvir|remdesivir|carbamazepina|oxcarbazepina|nevirapina|nifedipino|amlodipino|` +
        `enalapril|omeprazol|pantoprazol|paracetamol|metamizol|nolotil|valium|orfidal|trankimazin|lexatin|prozac|` +
        `seroquel|zyprexa|risperdal|dianben|adiro|ventolin|salbutamol|budesonida|prednisona|corticoides?|` +
        `warfarina|metotrexato|adalimumab|etanercept|tamoxifeno|letrozol|antirretrovirales?|` +
        `antidepresivos?|ansiol[íi]ticos?|antipsic[óo]ticos?|neurol[ée]pticos?|benzodiacepinas?|` +
        `opi[áa]ceos?|antiepil[ée]pticos?|anticoagulantes?|inmunosupresores?|quimioterapia|radioterapia|` +
        `hemodi[áa]lisis|di[áa]lisis|terapia\\s+antirretroviral|terapia\\s+hormonal)\\b${DOSIS}`,
    ),
  },

  {
    clase: 'SALUD',
    nota: 'grado de discapacidad',
    pre: /discapaci|minusval/i,
    // El porcentaje, se escriba como se escriba: «grado de discapacidad del 33 %», «una
    // discapacidad reconocida del 65 por ciento», «un 45 % de minusvalía». La regla del
    // diagnóstico anunciado solo veía «grado de discapacidad DE», y con «del» el grado salía en
    // claro. Juan (26-sep, duda 2): la discapacidad es categoría especial aunque solo diga el
    // grado, así que el grado se tapa.
    re: T(
      `(?<=\\b(?:discapacidad|discapacidade|discapacitat|minusval[íi]a)[^.;\\n]{0,40}?)\\b\\d{1,3}(?:[.,]\\d+)?\\s*(?:%|por\\s+ciento)|` +
        `\\b\\d{1,3}(?:[.,]\\d+)?\\s*(?:%|por\\s+ciento)(?=\\s+de\\s+(?:discapacidad|discapacidade|minusval[íi]a))`,
    ),
  },
  {
    clase: 'SALUD',
    nota: 'adicción o consumo',
    pre: /alcohol|ludopat|toxicoman|drogo|drogadic|embriaguez|adicci|consumo|problemas\s+con|beb[eií]|borrach|droga|dependencia/i,
    // «adicción al juego», «consumo habitual de cocaína». Salud en el sentido del 9.1: dicen de una
    // persona algo que la regla de patologías nombradas no veía porque no es un nombre de
    // enfermedad. Llevan el mismo criterio de fondo que el alcoholismo (duda 9).
    re: FONDO.ADICCION,
  },

  // ───────────────────────────── Antecedentes penales (art. 10 RGPD) ─────────────────────────────
  //
  // Duda 4, Juan 26-sep: no son 9.1 sino art. 10, con régimen propio, pero el art. 10.3 LOPDGDD
  // legitima al abogado a tratarlos, no a mandárselos a un tercero que no los necesita ver. Mismo
  // criterio que la categoría especial: se tapan salvo que sean el objeto directo del escrito.
  // Tipo aparte (DATO_PENAL) porque NO son categoría especial y el alias no debe decir que lo son.
  {
    clase: 'PENAL',
    tipo: 'DATO_PENAL',
    nota: 'antecedentes penales',
    pre: /antecedent|reincid|condena|condenad|condemnat|furt|robatori|prisi[óo]n|c[áa]rcel|dentro|penados|libertad\s+condicional|tercer\s+grado|centro\s+penitenciario|intern[oa]\s+en/i,
    re: FONDO.ANTECEDENTES,
  },

  {
    clase: 'SALUD',
    nota: 'lesiones y secuelas',
    // Lo que describe un parte de lesiones o una pericial: «fractura de huesos propios nasales»,
    // «herida inciso-contusa en región malar izquierda de 4 cm», «cicatriz de 3,5 cm».
    pre: /fractur|herid|cicatri|contusi|esguince|luxaci|traumatism|quemadur|amputaci|lesi[óo]n|secuela|policontus|erosi[óo]n|hematoma|dolor|fiebre/i,
    re: T(
        `\\b(?:fractura(?:\\s+(?:de|del)\\s+${PAL_CLIN}(?:\\s+(?:de\\s+|del\\s+)?${PAL_CLIN}){0,3})?|` +
      `herida(?:s)?(?:\\s+${PAL_CLIN}){0,2}(?:\\s+en\\s+(?:la\\s+)?(?:regi[óo]n\\s+)?${PAL_CLIN}(?:\\s+${PAL_CLIN}){0,2})?(?:\\s+de\\s+\\d+(?:[.,]\\d+)?\\s*cm)?|` +
        `cicatri(?:z|ces)(?:\\s+[a-záéíóúñ]+)?(?:\\s+de\\s+\\d+(?:[.,]\\d+)?\\s*cm)?|contusi[óo]n(?:es)?(?:\\s+[a-záéíóúñ]+){0,2}|` +
        `policontusiones|esguince(?:\\s+de\\s+[a-záéíóúñ]+)?|luxaci[óo]n(?:\\s+de\\s+[a-záéíóúñ]+)?|` +
        `traumatismo(?:\\s+[a-záéíóúñ]+)?|quemaduras?(?:\\s+de\\s+(?:primer|segundo|tercer)\\s+grado)?|amputaci[óo]n(?:\\s+de\\s+[a-záéíóúñ]+)?|` +
        `lesi[óo]n\\s+medular|secuelas(?:\\s+(?:psicol[óo]gicas|f[íi]sicas|permanentes|neurol[óo]gicas))?(?:\\s+(?:de|del)\\s+(?:la\\s+|el\\s+)?${PAL_CLIN}(?:\\s+${PAL_CLIN})?)?|` +
      `dolor\\s+(?:abdominal|tor[áa]cico|lumbar|cervical|articular|neurop[áa]tico|cr[óo]nico|precordial|epig[áa]strico)` +
      `(?:\\s+${PAL_CLIN}){0,3}(?:\\s+(?:en|de)\\s+[^.;,\\n]{2,40}?(?=[.;,\\n]|$|\\s+y\\s+fiebre))?(?:\\s+de\\s+\\d+\\s+(?:horas|d[íi]as)\\s+de\\s+evoluci[óo]n)?|` +
        `fiebre(?:\\s+de\\s+\\d+(?:[.,]\\d+)?\\s*º?\\s*C)?)\\b` + COLETILLA,
    ),
  },
  {
    clase: 'SALUD',
    nota: 'procedimientos, ingresos y pruebas',
    pre: /Protocolo\s+de\s+Estambul|pericial\s+(?:m[ée]dic|psiqui|psicol)|tom[íi]a|cateteris|ingres|UCI|biopsi|resonancia|radiograf|TAC\b|anal[íi]tica|electrocardiograma|ecograf|odontograma|cuestionario|certificado\s+m[ée]dico|informe|trasplante|quir[úu]rgic|rehabilitaci|fisioter|terapia|di[áa]lisis/i,
    re: T(
      `\\b(?:cateterismo|bypass|trasplante\\s+(?:de|renal|hep[áa]tico|card[íi]aco)[a-záéíóúñ\\s]{0,20}|intervenci[óo]n\\s+quir[úu]rgica|` +
        `(?:\\d+|varios|dos|tres)\\s+(?:d[íi]as\\s+de\\s+)?ingresos?(?:\\s+en\\s+(?:la\\s+|el\\s+)?[A-ZÁÉÍÓÚ][^.;,\\n]{2,60}?(?=[.;,\\n]|$|\\s+(?:y|que|por|desde)\\s))?|` +
        `ingreso\\s+en\\s+(?:la\\s+|el\\s+)?(?:UCI|U\\.C\\.I\\.|[A-ZÁÉÍÓÚ][a-záéíóúñ]+(?:log[íi]a|atr[íi]a)|planta|psiquiatr[íi]a|la\\s+unidad[^.;,\\n]{0,40})(?:\\s+[a-záéíóúñ]+)?|` +
        `ingresad[oa](?=\\s+en\\s+(?:el\\s+|la\\s+)?(?:hospital|cl[íi]nica|UCI|centro|planta|residencia|psiqui[áa]trico|Hospital|Cl[íi]nica))|` +
        `biopsia|resonancia\\s+magn[ée]tica|radiograf[íi]a|TAC|anal[íi]tica(?:\\s+de\\s+[a-z]+)?|electrocardiograma|ecograf[íi]a|odontograma|` +
        `cuestionario\\s+de\\s+salud|certificado\\s+m[ée]dico(?:\\s+oficial)?|` +
        `informe\\s+(?:m[ée]dico\\s+forense|[a-záéíóúñ]+(?:l[óo]gico|[áa]trico|[íi]strico)|de\\s+alta(?:\\s+de\\s+[a-záéíóúñ]+(?:\\s+[a-záéíóúñ]+)?)?|de\\s+urgencias)|` +
        `informe\\s+del\\s+(?:m[ée]dico|forense|psiquiatra|pediatra|[a-záéíóúñ]+(?:[óo]logo|[óo]loga|atra))|` +
        `informe\\s+(?:del|seg[úu]n\\s+el)\\s+Protocolo\\s+de\\s+Estambul|informe\\s+pericial\\s+(?:m[ée]dico|psiqui[áa]trico|psicol[óo]gico)|` +
        `(?:sesi[óo]n(?:es)?\\s+de\\s+)?(?:rehabilitaci[óo]n(?=\\s|[.,;])(?!\\s+(?:del?\\s+(?:edificio|inmueble|vivienda|local|fachada|sociedad|concursad))|\\s+urban)|fisioter[àa]pia|sessi[óo]\\s+de\\s+fisioter[àa]pia)|` +
        `terapia(?:\\s+(?:psicol[óo]gica|de\\s+pareja|familiar|individual|ocupacional|cognitivo-conductual))?|di[áa]lisis|hemodi[áa]lisis)\\b`,
    ),
  },
  {
    clase: 'SALUD',
    nota: 'bajas e IT',
    pre: /baja|\bIT\b|I\.T\.|incapacidad\s+temporal|invalidez/i,
    re: T(
      `\\b(?:baja(?:\\s+(?:m[ée]dica|laboral))?\\s+de\\s+\\d+\\s+(?:d[íi]as|semanas|meses)|` +
        `baja\\s+por\\s+(?:depresi[óo]n|ansiedad|estr[ée]s|lesi[óo]n|operaci[óo]n|intervenci[óo]n|c[áa]ncer|enfermedad(?:\\s+com[úu]n)?|` +
        `accidente(?:\\s+(?:de\\s+trabajo|laboral|no\\s+laboral))?|embarazo(?:\\s+de\\s+riesgo)?|maternidad|paternidad|[a-záéíóúñ]+(?:itis|osis|algia|pat[íi]a))|` +
        `(?:complemento|prestaci[óo]n|subsidio|situaci[óo]n)\\s+(?:de\\s+|por\\s+)?(?:IT|I\\.T\\.)(?![A-Za-z])|` +
        `pensi[óo]n\\s+(?:no\\s+contributiva\\s+)?(?:de|por)\\s+invalidez)`,
    ),
  },
  {
    clase: 'SALUD',
    nota: 'condiciones nombradas',
    pre: /lupus|par[áa]lisis|demencia|deterioro|autismo|down|sordera|ceguera|visi[óo]n|desnutrici|obesidad|intentos?\s+autol|suicid|autolesi|fumador|tabaquismo|mini-?mental|desorientad|VIH|met[áa]stasis|coronario|trastorno\s+por\s+consumo|hipoacusia/i,
    re: T(
      `\\b(?:lupus(?:\\s+eritematoso(?:\\s+sist[ée]mico)?)?|par[áa]lisis(?:\\s+cerebral|\\s+facial)?|demencia(?:\\s+(?:tipo\\s+)?[a-záéíóúñ]+)?|` +
        `deterioro\\s+cognitivo(?:\\s+(?:leve|moderado|grave|severo))?(?:\\s+compatible\\s+con\\s+[^.;,\\n]{3,60}?(?=[.;,\\n]|$))?|` +
        `autismo|s[íi]ndrome\\s+de\\s+Down|sordera|ceguera|baja\\s+visi[óo]n|desnutrici[óo]n|obesidad(?:\\s+m[óo]rbida)?|` +
        `(?:signos\\s+de\\s+)(?=desnutrici)|intentos?\\s+(?:autol[íi]ticos?|de\\s+suicidio)|ideaci[óo]n\\s+suicida|autolesiones|` +
        `(?:ex)?fumador(?:a)?|tabaquismo|mini-?mental(?:\\s*:?\\s*\\d{1,2}\\s*\\/\\s*30)?|desorientad[oa]\\s+en\\s+tiempo(?:\\s+y\\s+espacio)?|` +
        `VIH(?:\\s+positivo)?(?:\\s+en\\s+seguimiento(?:\\s+por\\s+[a-záéíóúñ]+)?)?|met[áa]stasis(?:\\s+[a-záéíóúñ]+)?|` +
        `s[íi]ndrome\\s+coronario(?:\\s+agudo)?(?:\\s+(?:sin|con)\\s+elevaci[óo]n\\s+del\\s+ST)?)\\b`,
    ),
  },
  {
    clase: 'SALUD',
    nota: 'discapacidad por sus adaptaciones',
    // Lo que delata una discapacidad sin nombrarla: el turno de reserva, la lengua de signos, la
    // tarjeta de aparcamiento. Juan (26-sep, duda 2): la discapacidad es categoría especial.
    pre: /discapaci|minusv|movilidad\s+reducida|signos|bucle|braille|perro\s+gu|silla\s+de\s+ruedas|pr[óo]tesis/i,
    re: T(
      `\\b(?:(?:turno|cupo|plazas?|reserva)\\s+(?:de\\s+reserva\\s+)?(?:para|de)\\s+personas\\s+con\\s+(?:discapacidad|diversidad\\s+funcional)|` +
        `(?:tarjeta|targeta)\\s+(?:de\\s+estacionamiento|d'aparcament|de\\s+aparcamiento)\\s+(?:para|per\\s+a)\\s+(?:personas|persones)\\s+(?:con|amb)\\s+(?:discapacidad|discapacitat|movilidad\\s+reducida|mobilitat\\s+redu[ïi]da)|` +
        `int[ée]rprete\\s+de\\s+(?:lengua\\s+de\\s+)?signos(?:\\s+y\\s+bucle\\s+magn[ée]tico)?|lengua\\s+de\\s+signos|bucle\\s+magn[ée]tico|braille|` +
        `perro\\s+(?:gu[íi]a|de\\s+asistencia)|silla\\s+de\\s+ruedas|pr[óo]tesis(?:\\s+[a-záéíóúñ]+)?)\\b`,
    ),
  },

  {
    clase: 'SALUD',
    nota: 'vocabulario clínico ampliado',
    // Lo que destapó el tercer corpus ciego: informes de alta, EVI, dependencia, lesiones, pruebas
    // genéticas, identidad de género, y el catalán de los informes de servicios sociales.
    pre: /tractament|simptomatolog|sintomatolog|metilfenidat|problemes|ingressat|autolesi|fractura-|artrodesis|osteos[íi]ntesis|hospitalizad|vejiga|bipedestaci|bastones|diab[ée]tic|defunci|infarto|p[ée]rdida\s+de\s+fuerza|alteraci[óo]n\s+del\s+lenguaje|fibrilaci|ictus|afasia|rankin|abvd|condiciones\s+de\s+salud|dependencia|quir[úu]rgic|perjuicio\s+est|parte\s+de|resonancia|radiofrecuencia|hemodi|VIH|transmisi[óo]n\s+vertical|ADN|paternidad|trans\b|transg|hormonal|reconocimiento\s+m[ée]dico|sesi[óo]n|radiograf|implantes|cadera|operan|operad|tensi[óo]n\s+alta|hipertensi|alzh|inhalador|controles|asistencia|mixto|adaptativ/i,
    re: T(
      `\\b(?:tractament\\s+(?:psicol[òo]gic|psiqui[àa]tric|m[èe]dic|hormonal)|` +
        `(?:simptomatologia|sintomatolog[íi]a)(?:\\s+[a-záéíóúàèòïüç-]+){0,2}|metilfenidat(?:o)?|` +
        `problemes\\s+amb\\s+l'alcohol|ingressat\\s+a\\s+la\\s+unitat\\s+de\\s+[a-záéíóúàèòç]+|episodis?\\s+d'autolesions|autolesions|` +
        `fractura(?:-[a-záéíóúñ]+)?(?:\\s+(?:de|del)\\s+(?:la\\s+)?${PAL_CLIN}(?:\\s+${PAL_CLIN}){0,2})?(?:\\s+[LCDTS]\\d)?|` +
        `artrodesis(?:\\s+[LCDT]\\d{1,2}-[LCDTS]\\d{1,2})?|osteos[íi]ntesis|hospitalizad[oa](?:\\s+\\d+\\s+d[íi]as)?|` +
        `vejiga\\s+neur[óo]gena(?:\\s+con\\s+[^.;,\\n]{3,40})?|imposibilidad\\s+de\\s+bipedestaci[óo]n(?:\\s+prolongada)?|` +
        `marcha\\s+con\\s+(?:dos\\s+|un\\s+)?bast[óo]n(?:es)?(?:\\s+ingleses)?|diab[ée]tic[oa]s?|certificado\\s+m[ée]dico\\s+de\\s+defunci[óo]n|` +
        `(?:un\\s+)?infarto(?:\\s+agudo)?(?:\\s+de\\s+miocardio)?|p[ée]rdida\\s+de\\s+fuerza(?:\\s+en\\s+[a-záéíóúñ]+(?:\\s+[a-záéíóúñ]+)?)?|` +
        `alteraci[óo]n\\s+del\\s+lenguaje|fibrilaci[óo]n\\s+auricular(?:\\s+no\\s+anticoagulada)?|` +
        `ictus(?:\\s+(?:isqu[ée]mico|hemorr[áa]gico))?(?:\\s+de\\s+(?:la\\s+)?arteria(?:\\s+[a-záéíóúñ]+){0,4})?(?:\\s+de\\s+origen\\s+[a-záéíóúñ]+)?|` +
        `(?:precisa|necesita|requiere)\\s+ayuda\\s+para\\s+(?:las\\s+)?(?:ABVD|actividades\\s+b[áa]sicas(?:\\s+de\\s+la\\s+vida\\s+diaria)?)|` +
        `afasia(?:\\s+[a-záéíóúñ]+)?|rankin\\s*\\d|abvd|informe\\s+de\\s+condiciones\\s+de\\s+salud|` +
        `grado\\s+(?:I{1,3}|[123])\\s+de\\s+dependencia(?:\\s+(?:severa|moderada|gran\\s+dependencia))?(?:,?\\s+con\\s+una\\s+puntuaci[óo]n\\s+BVD\\s+de\\s+\\d+\\s+puntos)?|` +
        `tratamiento\\s+quir[úu]rgico(?:\\s*\\([^)]{2,80}\\))?|perjuicio\\s+est[ée]tico(?:\\s+[a-záéíóúñ]+)?(?:\\s*\\(\\s*\\d+\\s+puntos?\\s*\\))?(?:\\s+por\\s+[^.;,\\n]{3,40})?|` +
        `parte\\s+de\\s+(?:alta|asistencia|confirmaci[óo]n)|resonancia\\s+magn[ée]tica(?:\\s+de\\s+control)?|radiofrecuencia|` +
        `(?:hemodi[áa]lisis|di[áa]lisis)(?:\\s+[a-záéíóúñ]+\\s+veces\\s+(?:por|a\\s+la)\\s+semana)?|portador[a]?\\s+del\\s+VIH|` +
        `negativ[oa]\\s+en\\s+las\\s+pruebas\\s+de\\s+transmisi[óo]n\\s+vertical|(?:una\\s+)?prueba\\s+(?:de\\s+ADN|biol[óo]gica\\s+de\\s+paternidad)(?:\\s+privada)?|` +
        `(?:una\\s+)?probabilidad\\s+de\\s+paternidad\\s+del\\s+[\\d.,]+\\s*%|(?:mujer|hombre|persona|chica|chico)\\s+trans|transg[ée]nero|` +
        `tratamiento\\s+hormonal(?:\\s+con\\s+[^.;,\\n]{3,40}?(?=[.;,\\n]|$))?|reconocimiento\\s+m[ée]dico(?:\\s+de\\s+vigilancia\\s+de\\s+la\\s+salud)?|` +
        `sesi[óo]n(?:es)?\\s+de\\s+(?:psicoterapia|terapia|fisioterapia|rehabilitaci[óo]n|quimioterapia|radioterapia)|radiograf[íi]a\\s+panor[áa]mica|` +
        `tratamiento\\s+de\\s+implantes|implantes\\s+dentales|(?:rota|rot[oa])\\s+la\\s+cadera|fractura\\s+de\\s+cadera|la\\s+operan(?:\\s+ma[ñn]ana)?|` +
        `operad[oa]\\s+de\\s+[a-záéíóúñ]+|(?:la\\s+)?tensi[óo]n\\s+alta|hipertensi[óo]n(?:\\s+arterial)?|inhalador|` +
        `abandono\\s+de\\s+los\\s+controles(?:\\s+del?\\s+[A-Z]{3,8})?|trastorno\\s+adaptativo(?:\\s+mixto)?)(?![A-Za-záéíóúñ0-9])` + ADJETIVOS + COLETILLA,
    ),
  },
  {
    clase: 'RELIGION',
    nota: 'práctica religiosa',
    pre: /practicante|mezquita|comunidad|Jehov|objetor/i,
    re: T(
      `\\b(?:(?:musulm[áa]n|cat[óo]lic[oa]|evang[ée]lic[oa]|jud[íi][oa]|ortodox[oa]|budista|hind[úu])\\s+practicante|` +
        `(?:acudir|acude|asistir|asiste|iba|va|acud[íi]a|asist[íi]a)\\s+a\\s+la\\s+mezquita(?:\\s+de\\s+[A-ZÁÉÍÓÚ][\\wáéíóúñ]+(?:\\s+[A-ZÁÉÍÓÚ][\\wáéíóúñ]+)?)?|` +
        `(?:miembro\\s+de\\s+)?la\\s+comunidad\\s+(?:musulmana|isl[áa]mica|ahmad[íi]|jud[íi]a|evang[ée]lica|cristiana|sij|budista)(?:\\s+del\\s+barrio)?|` +
        `testigos?\\s+de\\s+Jehov[áa]|objetor(?:a)?\\s+de\\s+conciencia(?:\\s+al\\s+servicio\\s+armado)?)`,
    ),
  },
  {
    clase: 'SINDICAL',
    nota: 'afiliado en contexto sindical',
    pre: /sindica/i,
    re: T('(?<=sindica[^.]{0,80})\\b(?:es\\s+)?afiliad[oa]s?(?:\\s+desde\\s+\\d{4})?\\b'),
  },
  {
    clase: 'SINDICAL',
    nota: 'cuota sindical',
    pre: /cuota|sindicat/i,
    re: T(`\\bcuota\\s+(?:sindical|de\\s+\\d+[.,]?\\d*\\s*euros\\s+(?:satisfecha|pagada|abonada)\\s+al\\s+sindicato\\s+[A-ZÁÉÍÓÚ][\\wáéíóúñ]*(?:\\s+[A-ZÁÉÍÓÚ][\\wáéíóúñ]*){0,3})`),
  },

  // ───────────────────────────── Afiliación sindical ─────────────────────────────
  {
    clase: 'SINDICAL',
    nota: 'afiliación o representación sindical',
    pre: /sindic|afiliad|CC\.?\s?OO|UGT|CGT|CNT|USO|ELA|LAB|CSIF|SATSE|CIG|Comisiones|Intersindical|Confederaci/i,
    re: T(
      // El sindicato por su nombre: sigla, «Comisiones Obreras», o palabras con mayúscula. Antes se
      // tragaba 60 caracteres fueran lo que fueran («…a la CGT desde 2019 y es conocido en la empresa
      // por sus publ…»).
      `\\b(?:afiliad[oa]s?\\s+(?:a\\s+la\\s+|a\\s+|al\\s+)(?!partido)(?:sindicato\\s+)?(?:${SINDICATO})|` +
        `afiliaci[óo]n\\s+sindical|` +
        `(?:delegad[oa]|representante|secretari[oa]\\s+general|miembro|afiliad[oa])\\s+(?:sindical\\s+)?(?:de\\s+la\\s+|de\\s+|del\\s+)(?:sindicato\\s+)?(?:${SINDICATO})|` +
        `(?:delegad[oa]|representante)\\s+sindical|` +
        `sindicato\\s+(?:de\\s+)?[A-ZÁÉÍÓÚÑ][^.;,\\n]{2,50}|` +
        `cuota\\s+sindical(?:\\s+(?:${SINDICATO}))?|` +
        `(?:delegad[oa]|representante)\\s+de\\s+(?:personal|los\\s+trabajadores)\\s+(?:de|por)\\s+(?:${SINDICATO})|` +
        `candidatura\\s+(?:de|por|del)\\s+(?:sindicato\\s+)?(?:${SINDICATO})|elecciones\\s+sindicales|` +
        `Comisiones\\s+Obreras|Uni[óo]n\\s+General\\s+de\\s+Trabajadores)\\b`,
    ),
  },
  {
    clase: 'SINDICAL',
    nota: 'siglas sindicales',
    // En MAYÚSCULAS y como palabra: con la bandera `i`, «uso» y «ela» eran sindicatos.
    re: T('\\b(?:CCOO|CC\\.OO\\.|UGT|CGT|CNT|USO|ELA|LAB|CSIF|SATSE|CIG|STEs|ANPE)\\b', 'g'),
  },

  // ───────────────────────────── Religión y convicciones ─────────────────────────────
  {
    clase: 'RELIGION',
    nota: 'confesión o convicciones',
    re: T(
      `\\b(?:profesa\\s+la\\s+religi[óo]n\\s+[a-záéíóúñ]+|religi[óo]n\\s+(?:cat[óo]lica|evang[ée]lica|` +
        `musulmana|jud[íi]a|ortodoxa|protestante|hind[úu]|budista)|` +
        `(?:es|son)\\s+(?:cat[óo]lic[oa]s?|evang[ée]lic[oa]s?|musulm[áa]n(?:a|es)?|jud[íi]os?|` +
        `testigo\\s+de\\s+Jehov[áa]|ateo|agn[óo]stic[oa])|` +
        `creencias\\s+religiosas|convicciones\\s+(?:religiosas|filos[óo]ficas)|` +
        `objeci[óo]n\\s+de\\s+conciencia|hiyab|niqab|burka|velo\\s+isl[áa]mico|kip[áa]|turbante\\s+sij|` +
        `parroquia\\s+(?:evang[ée]lica|cat[óo]lica|ortodoxa|adventista|protestante|bautista|pentecostal)|` +
        `catequesis(?:\\s+en\\s+la\\s+parroquia(?:\\s+de\\s+[A-ZÁÉÍÓÚ][^.;,\\n]{2,40}?(?=[.;,\\n]|$|\\s+(?:y|que)\\s))?)?|` +
        `(?:asiste|acude|iba|va|asist[íi]a|acud[íi]a)\\s+a\\s+(?:misa|la\\s+mezquita|la\\s+sinagoga|culto|la\\s+iglesia\\s+[a-záéíóúñ]+)|` +
        `mezquita|sinagoga|ramad[áa]n|ate[oa]s?|agn[óo]stic[oa]s?)\\b`,
    ),
  },

  // ───────────────────────────── Opinión política ─────────────────────────────
  {
    clase: 'POLITICA',
    nota: 'militancia u opinión política',
    re: T(
      `\\b(?:afiliad[oa]\\s+al\\s+partido[^.;\\n]{0,40}|militante\\s+(?:de|del)[^.;\\n]{2,40}|` +
        `ideolog[íi]a\\s+pol[íi]tica|opiniones\\s+pol[íi]ticas|` +
        `simpatizante\\s+(?:de|del)[^.;\\n]{2,40}|` +
        // «sus publicaciones a favor de la independencia de Cataluña», «independentista».
        `(?:a\\s+favor|en\\s+contra)\\s+de\\s+la\\s+independencia(?:\\s+de\\s+[A-ZÁÉÍÓÚ][\\wáéíóúñ]+)?|` +
        `independentistas?|soberanistas?|(?:ideas|convicciones|posturas?|simpat[íi]as|inclinaciones|creencias)\\s+pol[íi]ticas|` +
        `votante\\s+de\\s+[A-ZÁÉÍÓÚ][\\wáéíóúñ]+)\\b`,
    ),
  },

  // ───────────────────────────── Origen étnico o racial ─────────────────────────────
  {
    clase: 'ETNIA',
    nota: 'origen étnico o racial',
    re: T(
      // El paréntesis va fuera del `\\b` final: «etnia peul (fulani)» se cortaba antes de él.
      `\\b(?:(?:de\\s+)?etnia\\s+[a-záéíóúñ]+(?:\\s*\\([^)]{2,30}\\)(?=\\W|$))?|de\\s+raza\\s+[a-záéíóúñ]+|etnia\\s+gitana|pueblo\\s+gitano|origen\\s+(?:[ée]tnico|racial)|` +
        `minor[íi]a\\s+[ée]tnica|comunidad\\s+gitana)(?:\\b|(?<=\\)))`,
    ),
  },

  // ───────────────────────────── Vida y orientación sexual ─────────────────────────────
  {
    clase: 'SEXUAL',
    nota: 'orientación o vida sexual',
    re: T(
      `\\b(?:orientaci[óo]n?\\s+sexual|identitat\\s+de\\s+g[èe]nere|identidad\\s+de\\s+g[ée]nero|` +
        `(?:es|era)\\s+(?:homosexual|bisexual|transexual|transg[ée]nero|l[ée]sbica|gay)|` +
        `homosexualidad|transexualidad|cambio\\s+de\\s+sexo|reasignaci[óo]n\\s+de\\s+g[ée]nero|` +
        `vida\\s+sexual)\\b`,
    ),
  },

  // ───────────────────────────── Genéticos y biométricos ─────────────────────────────
  {
    clase: 'GENETICO',
    nota: 'datos genéticos o biométricos',
    re: T(
      `\\b(?:perfil\\s+gen[ée]tico|prueba\\s+de\\s+(?:ADN|paternidad)|muestra\\s+de\\s+ADN|` +
        `[áa]cido\\s+desoxirribonucleico|huella\\s+dactilar|reconocimiento\\s+facial|` +
        `datos\\s+biom[ée]tricos|an[áa]lisis\\s+gen[ée]tico)\\b`,
    ),
  },
];

// Lo que NO se tapa aunque case: son términos de la maquinaria del proceso, no datos de nadie.
// Sin esto, «Juzgado de Violencia sobre la Mujer» o «Servicio de Reumatología» —que son órganos e
// instituciones, y van con su nombre real— caerían dentro por llevar vocabulario clínico o social.
// Mismo cuidado que en domicilios.mjs: cortadas también en la coma, para que una excepción no se
// lleve por delante media frase y destape lo que venía detrás.
// Cola de un nombre de institución: palabras con MAYÚSCULA y partículas entre ellas, nada más. Antes
// era «hasta la coma», y «…la historia clínica del Hospital Universitario de Cruces el diagnóstico
// de cervicalgia postraumática con rectificación de la lordosis.» vetaba el diagnóstico entero: la
// excepción del hospital llegaba al punto. Es el mismo defecto que tenía la guardia de intocables.
const COLA_INST =
  "(?:[ \\t]+(?:(?:de|del|de\\s+la|de\\s+los|y|e|i|la|el|sobre|DE|DEL|DE\\s+LA|DE\\s+LOS|Y|I)[ \\t]+)?" +
  // En un escaneo todo va en mayúsculas: la cola no sigue por lo que ya no es el nombre de la
  // institución («HOSPITAL CLINICO SAN CARLOS DIAGNOSTICO DE CARDIOPATIA…»).
  "(?!(?:EL|LA|LOS|LAS|CON|POR|QUE|EN|SE|SU|SUS|AL|INFORME|Informe|PACIENTE|MOTIVO|ANTECEDENTES|TRATAMIENTO|JUICIO|DIAGN[OÓ]STIC\\w*|PADEC\\w*|PRESENT\\w*|SUFR\\w*|REFIER\\w*|CONST\\w*|" +
  "Diagn[oó]stic\\w*|Padec\\w*|Present\\w*|Sufr\\w*|Refier\\w*|Const\\w*)(?![\\wÁÉÍÓÚÑáéíóúñ]))" +
  "[A-ZÁÉÍÓÚÑÇ][\\wÁÉÍÓÚÑÇáéíóúñçàèòü'·-]*){0,7}";
const FIN_PALABRA = "(?![\\wÁÉÍÓÚÑÇáéíóúñçàèòü])";
const EXCEPCIONES = [
  T(`\\b(?:Juzgado|JUZGADO|Jutjat|Xulgado|Tribunal|TRIBUNAL)${FIN_PALABRA}${COLA_INST}`, 'g'),
  T(`\\b(?:Servicio|SERVICIO|Servei|Servizo)\\s+(?:de\\s+|del\\s+)?[A-ZÁÉÍÓÚÑ][\\wáéíóúñ-]*${COLA_INST}`, 'g'),
  // Con fin de palabra: «HOSPITAL» casaba dentro de «INGRESOS HOSPITALARIOS» y vetaba el diagnóstico.
  T(`\\b(?:Hospital|HOSPITAL|Instituto|INSTITUTO|Institut|Centro|CENTRO|Unidad|UNIDAD|Cl[íi]nica|CL[ÍI]NICA)${FIN_PALABRA}${COLA_INST}`, 'g'),
  T(`\\b(?:Medicina\\s+Legal|MEDICINA\\s+LEGAL)${FIN_PALABRA}${COLA_INST}`, 'g'),
  T('\\bM[ée]dico\\s+Forense\\b', 'gi'),
  // El nombre de un cargo o un órgano con palabras de salud: «Directora General de Cuidados,
  // Dependencia y Discapacidad», «Punto de Encuentro Familiar».
  T(`\\b(?:Director|Directora|Consejer[oa]|Ministr[oa]|Secretari[oa]|Viceconsejer[oa]|Direcci[óo]n|Consejer[íi]a|Ministerio|Servicio|Instituto|Unidad|Centro)\\s+(?:General\\s+|Provincial\\s+|Territorial\\s+)?de\\s+[A-ZÁÉÍÓÚ][\\wáéíóúñ]*(?:(?:,\\s*|\\s+y\\s+|\\s+de\\s+|\\s+)[A-ZÁÉÍÓÚ][\\wáéíóúñ]*){0,6}`, 'g'),
  T('\\bPunto\\s+de\\s+Encuentro(?:\\s+Familiar)?\\b', 'g'),
  // Aquí había una excepción para «incapacidad permanente total» al final de frase: un apaño para
  // que «la resolución que le deniega la incapacidad permanente total.» no quedara sin sentido.
  // Juan la sustituyó (26-sep) por un criterio de fondo, que vive en objeto.mjs.
];

// Palabras que, solas, no dicen nada de nadie. Si al sacar el término de fondo de una detección
// solo queda esto, no queda nada que tapar.
const VACIAS = new Set(['es', 'son', 'era', 'fue', 'severa', 'severo', 'grave', 'leve', 'moderada', 'moderado', 'cronica', 'cronico', 'crónica', 'crónico',
  'aguda', 'agudo', 'grado', 'fase', 'estadio', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'con', 'en', 'por', 'su', 'sus',
  'para', 'a', 'al', 'un', 'una', 'que', 'se', 'le', 'lo', 'o', 'u']);

function quedaAlgo(trozo) {
  const palabras = trozo.toLowerCase().match(/[\p{L}\p{N}%]+/gu) ?? [];
  return palabras.some((p) => !VACIAS.has(p) && p.length > 1);
}

// `objetos`: las clases que el expediente ya ha establecido como objeto del escrito (ver
// objeto.mjs). Sin él, cada fragmento decide solo con lo que dice él mismo.
export function detectarCategoriaEspecial(texto, { objetos = new Set() } = {}) {
  const vetado = new Array(texto.length).fill(false);
  for (const ex of EXCEPCIONES) {
    ex.lastIndex = 0;
    let m;
    while ((m = ex.exec(texto)) !== null) {
      if (!m[0].length) { ex.lastIndex++; continue; }
      for (let i = m.index; i < m.index + m[0].length; i++) vetado[i] = true;
    }
  }

  const fuera = [];
  const ocupado = new Array(texto.length).fill(false);
  for (const regla of REGLAS) {
    // Filtro previo barato: si el fragmento no tiene ni la palabra que la regla necesita, no se corre.
    if (regla.pre && !regla.pre.test(texto)) continue;
    regla.re.lastIndex = 0;
    let m;
    while ((m = regla.re.exec(texto)) !== null) {
      if (!m[0].length) { regla.re.lastIndex++; continue; }
      let inicio = m.index;
      let fin = inicio + m[0].length;
      if (regla.grupo && m[regla.grupo]) {
        const rel = m[0].indexOf(m[regla.grupo]);
        if (rel >= 0) { inicio = m.index + rel; fin = inicio + m[regla.grupo].length; }
      }
      // Recorte de la cola: las reglas de contexto son golosas y se llevan media frase.
      const trozo = texto.slice(inicio, fin).replace(/[\s,;:.]+$/, '');
      // «simpatía», «academia», «injuria»: acaban como un término clínico y no lo son.
      if (NO_CLINICAS.has(sinTildesMin(trozo.split(/\s+/)[0]))) continue;
      // Un rótulo de sección («SECUELAS:», «ALTA MÉDICA:») no es el dato: lo es lo que va detrás.
      if (trozo.split(/\s+/).length <= 2 && /^\s*:/.test(texto.slice(fin, fin + 3))) continue;
      // Una sigla sindical dentro del nombre de una empresa: «ATLANTIC SURF LAB, S.L.».
      if (regla.nota === 'siglas sindicales' && (/^,?\s*S\.?\s?[LA]\b/.test(texto.slice(fin, fin + 8)) || /[A-ZÁÉÍÓÚÑ]{3,}\s+$/.test(texto.slice(Math.max(0, inicio - 12), inicio)))) continue;
      fin = inicio + trozo.length;
      // Se veta lo que cae ENTERO dentro de una excepción («Servicio de Reumatología», «Juzgado de
      // Violencia sobre la Mujer»). Lo que empieza fuera y la incluye sí se tapa: «varios ingresos en
      // la Unidad de Conductas Adictivas» dice de una persona lo que el nombre de la unidad solo no.
      let veta = true;
      for (let i = inicio; i < fin; i++) if (!vetado[i]) { veta = false; break; }
      if (veta) continue;
      let libre = false;
      for (let i = inicio; i < fin; i++) if (!ocupado[i]) { libre = true; break; }
      if (!libre) continue;
      for (let i = inicio; i < fin; i++) ocupado[i] = true;
      fuera.push({ tipo: regla.tipo ?? 'CAT_ESPECIAL', clase: regla.clase, valor: trozo, inicio, fin, via: `especial:${regla.nota}` });
    }
  }
  return recortarObjeto(texto, fuera, objetos).sort((a, b) => a.inicio - b.inicio);
}

// El criterio de fondo (dudas 1, 4, 6 y 9). Lo que es el objeto del escrito se saca de la
// detección y pasa en claro; lo que lo acompaña se sigue tapando. «padece alcoholismo crónico con
// hepatopatía» en un escrito que pide la modificación de medidas por ese alcoholismo: pasa
// «alcoholismo crónico», y «hepatopatía» sigue tapada, porque ese es el detalle clínico.
function recortarObjeto(texto, detecciones, objetos) {
  const lista = frases(texto);
  const libres = terminosDeFondo(texto, { objetos }).filter((t) => esObjeto(texto, t, { objetos, lista }));
  if (!libres.length) return detecciones;
  const fuera = [];
  for (const d of detecciones) {
    const dentro = libres.filter((t) => t.inicio < d.fin && d.inicio < t.fin).sort((a, b) => a.inicio - b.inicio);
    if (!dentro.length) { fuera.push(d); continue; }
    let cursor = d.inicio;
    const cortes = [];
    for (const t of dentro) {
      if (t.inicio > cursor) cortes.push([cursor, t.inicio]);
      cursor = Math.max(cursor, t.fin);
    }
    if (cursor < d.fin) cortes.push([cursor, d.fin]);
    for (let [i, f] of cortes) {
      while (i < f && /[\s,;:.]/.test(texto[i])) i++;
      while (f > i && /[\s,;:.]/.test(texto[f - 1])) f--;
      const trozo = texto.slice(i, f);
      if (!quedaAlgo(trozo)) continue;
      // Si lo que queda empieza o acaba en una palabra vacía («con hepatopatía»), fuera también:
      // el conector no es el dato.
      const m = trozo.match(/^(?:(?:de|del|con|en|por|y|e|la|el|su|a|al)\s+)+/i);
      const i2 = i + (m ? m[0].length : 0);
      fuera.push({ ...d, valor: texto.slice(i2, f), inicio: i2, fin: f, via: `${d.via}+resto-del-objeto` });
    }
  }
  return fuera;
}

export default detectarCategoriaEspecial;

export const _reglas = REGLAS;
