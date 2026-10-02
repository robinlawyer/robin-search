// Domicilios.
//
// El banco del 23-sep los encontró a CERO, y por una razón de diseño, no por fallo del modelo:
// solo se convierte en alias lo que el reconocedor etiqueta como PERSONA, y un domicilio lo marca
// como LOC. Taparlo por ahí no es una opción: de las 594 marcas de organización y lugar que pone
// el modelo sobre este corpus, 120 pisan un intocable. Si se taparan los lugares se irían por
// delante «Madrid», «Juzgado de Primera Instancia nº 5 de Madrid» y media cabecera de cada escrito.
//
// La salida es tratarlo como lo que es: una estructura, no una entidad. Un domicilio español tiene
// forma fija —vía + nombre + número, y detrás piso, código postal y municipio— y esa forma se
// reconoce sin modelo y sin ambigüedad. «Madrid» a secas NO es un domicilio y se queda en claro;
// «calle Serrano 45, 3º B, 28006 Madrid» sí lo es, y se tapa entero, municipio incluido, porque
// es ahí donde vive una persona concreta.

const VIA =
  '(?:calle|c/|c\\.|avenida|avda\\.?|av\\.|plaza|pza\\.?|pl\\.|paseo|pº|po\\.|ronda|camino|cmno\\.?|' +
  'carretera|ctra\\.?|travesía|travesia|trav\\.?|glorieta|bulevar|vía|via|gran\\s+v[íi]a|polígono|poligono|' +
  'urbanización|urbanizacion|urb\\.?|barrio|carrer|passeig|avinguda|plaça|rambla|travessera|rúa|rua|' +
  'estrada|lugar|kalea|kale|etorbidea|pasealekua|enparantza|cuesta|callejón|callejon|barriada|cam[íi]|cl|calle\\s+de|avenida\\s+de)';

// Nombre de la vía: palabras capitalizadas o en mayúsculas, con partículas en medio.
// Mismas letras que en personas.mjs: sin la à se cae «passeig de Gràcia», que es una dirección
// de Barcelona como cualquier otra.
const MIN = "a-záéíóúüñàèìòùïçâêîôûäëöÿ";
const MAY = "A-ZÁÉÍÓÚÜÑÀÈÌÒÙÏÇÂÊÎÔÛÄËÖ";
const PAL = `(?:[${MAY}][${MIN}'’.]+|[${MAY}]{2,})`;
// Partículas de un nombre de calle en las cuatro lenguas: «rúa do Príncipe», «carrer de les
// Corts», «Gran Vía de Don Diego López de Haro» (con varias en medio).
const PART_VIA = "(?:de\\s+la|de\\s+los|de\\s+las|de\\s+les|del|dels|de|do|da|dos|das|i|y|la|el)";
// Entre pieza y pieza, un ESPACIO (salvo detrás de «d'» o «l'»). Con `\\s*` y la bandera `i`, una
// palabra como «Serrano» se podía partir en piezas de muchísimas maneras y la expresión regular
// probaba todas: 8 ms por fragmento solo en direcciones, más que todo el resto del filtro junto.
const NOMBRE_VIA = `(?:(?:${PART_VIA})\\s+|[dl]')?${PAL}(?:\\s+(?:(?:${PART_VIA})\\s+|[dl]')?${PAL}){0,6}`;

// Número y lo que va detrás: «45», «112», «nave 12», «s/n», «km 4,5».
// El «número» de una vía también puede ser una parcela, un bloque, un portal o un punto kilométrico:
// «Urbanización Los Pinares, parcela 27», «Barriada …, bloque 4», «Carretera de El Palmar, km 4,2».
const NUMERO = '(?:(?:(?:n\\.?\\s?[ºo°]\\.?|n[úu]mero)\\s*)?(?:\\d{1,4}(?:\\s*[-–]\\s*\\d{1,4})?|s/n)|(?:parcela|bloque|bloc|portal|km|kil[óo]metro)\\s*\\d{1,3}(?:[.,]\\d{1,3})?)';
// Piso y puerta: «3º B», «2º C», «1º izda.», «planta 7», «bajo», «ático»… y como se escriben en
// catalán, gallego y euskera («2n 1a», «4t 2a», «1r», «4º dereita», «3. ezkerra»), con el edificio,
// el portal o la escalera por delante («Edificio Arena 2, planta 1ª»).
const LADO = '(?:[A-Z](?![a-záéíóúñ])|izda\\.?|dcha\\.?|izq\\.?|dcha\\.?|izquierda|derecha|dereita|esquerda|ezkerra|eskuina|centro|\\d{1,2}(?:[ªºa])?(?![\\d]))';
const PISO =
  '(?:,?\\s*(?:planta\\s+\\d{1,2}(?:\\.?[ªº])?|\\d{1,2}(?:\\s*[ºªo]|\\.º|\\.ª|n|r|t|è|er|a|\\.)(?:\\s*' + LADO + ')?|\\d{1,2}\\s+(?:IZ|DR|IZQ|DCH|ESQ|DCHA|IZDA)\\b|' +
  'bajos?(?:\\s+(?:izquierda|derecha|izda\\.?|dcha\\.?))?|baixos|entresuelo|entres[òo]l|(?:[áa]tico|[àa]tic|principal|pral\\.?)(?:\\s+\\d{1,2}[ªºa]?)?|s[óo]tano|' +
  // «1.º C», «1.ª», «2n 1a» ya van arriba; aquí el edificio y lo rural: parcela, bloc, porta, finca, km.
  '\\d{1,2}\\.[ºª](?:\\s*' + LADO + ')?|\\d{1,2}\\s+(?:ESQ|IZDA|DCHA|IZQ|DER)\\b|' +
  '(?:parcela|bloc|bl\\.|porta|pta\\.?|finca)\\s*[\\wÁÉÍÓÚáéíóúñÑ]{1,4}(?:\\s+[A-ZÁÉÍÓÚ][\\wáéíóúñ]+){0,3}|km\\s*\\d{1,3}(?:[.,]\\d{1,3})?|' +
  '(?:edificio|edif\\.|bloque|portal|escalera|esc\\.?|puerta|pta\\.|local|nave|casa|km)\\s*[\\wÁÉÍÓÚáéíóúñÑ.,]{1,20}?(?:\\s+\\d{1,3})?(?=,|\\s|$)))*';
// Código postal español: 5 dígitos, 01–52.
// Con guion largo delante también: «Calle Larga, 31 — 10910 Malpartida», «C/ Coso, 67, 2.º – 50001 Zaragoza».
const CP = '(?:,?\\s*(?:[—–-]\\s*)?(?:0[1-9]|[1-4]\\d|5[0-2])\\d{3})';
// El municipio: piezas SIN punto (el de «Sabadell.» es el final de la frase) y sin cruzar un salto de
// línea, parando en lo que ya no es un municipio: un tratamiento o un rótulo. Sin eso, «…08207
// Sabadell.\nDOÑA LAIA SOLER» se tapaba como parte de la dirección, y «…08221 Terrassa. La perito del
// Institut…» chocaba con la guardia y la dirección entera salía en claro.
const PAL_MUN = `(?:[${MAY}][${MIN}'’]+|[${MAY}]{2,})`;
const NO_MUNICIPIO = `(?!(?:D\\.|Dª|Dña|DÑA|Doña|DOÑA|DONA|Don|DON|T|Tel|TEL|TELF|Telf|Tfno|TFNO|Móvil|CIF|DNI|NIE|NIF|Email|Correo)(?![${MIN}${MAY}]))`;
const MUNICIPIO = `(?:,?[ \\t]*${NO_MUNICIPIO}${PAL_MUN}(?:(?:[ \\t]+|-)(?:(?:de|del|de la|DE|DEL|DE LA|d')[ \\t]*)?${NO_MUNICIPIO}${PAL_MUN}){0,3}(?:[ \\t]*\\([^)]{2,30}\\))?)`;
// «…, de Alicante», «…, DE GIRONA»: el municipio detrás de una dirección sin código postal.
const DE_MUNICIPIO = `(?:,?\\s+(?:de|DE)\\s+${PAL}(?:\\s+(?:(?:de|del|DE|DEL)\\s+)?${PAL}){0,3})?`;

const T = (f) => new RegExp(f, 'gi');

const REGLAS = [
  {
    nota: 'vía + número + CP + municipio',
    // Entre el piso y el código postal puede ir el barrio: «calle Galileo, 45, Tafira Alta, 35017 …».
    re: T(`\\b${VIA}\\s+${NOMBRE_VIA}\\s*,?\\s*${NUMERO}${PISO}(?:,\\s*${PAL_MUN}(?:\\s+${PAL_MUN}){0,2})?${CP}${MUNICIPIO}`),
  },
  {
    nota: 'vía + número + piso (sin CP)',
    re: T(`\\b${VIA}\\s+${NOMBRE_VIA}\\s*,?\\s*${NUMERO}${PISO}${DE_MUNICIPIO}`),
  },
  {
    // El euskera pone el tipo de vía detrás: «Bidebieta Kalea, 6, 2.º B, 20017 Donostia».
    nota: 'vía en euskera (tipo detrás)',
    // Sin la bandera «i»: con ella, el nombre de la vía casaba también en minúscula («domicilio en …»).
    re: new RegExp(`(?<![${MIN}${MAY}])${PAL}(?:\\s+${PAL}){0,2}\\s+(?:[Kk]alea|KALEA|[Ee]torbidea|ETORBIDEA|[Bb]idea|[Pp]asealekua|[Ee]nparantza|[Pp]laza|[Aa]uzoa)\\s*,?\\s*${NUMERO}${PISO}(?:${CP}${MUNICIPIO})?`, 'g'),
  },
  {
    // La vivienda nombrada por su calle, sin número: «la vivienda de la calle Arxiduc Lluís Salvador»,
    // «el usufructo de la vivienda de la calle Prim», «una vivienda en la Rúa Fernando Macías», y la
    // casa rural por su nombre: «el caserío Etxeberri de Igeldo».
    nota: 'vivienda por su calle',
    re: T(`(?<=(?:vivienda|piso|casa|local|domicilio|finca|ático|chalet|apartamento)\\s+(?:de|en|sit[oa]\\s+en)\\s+(?:la\\s+|el\\s+)?)${VIA}\\s+${NOMBRE_VIA}`),
  },
  {
    nota: 'caserío o masía por su nombre',
    re: T(`\\b(?:caser[íi]o|baserri|mas[íi]a|mas|cortijo|pazo|quinta)\\s+${PAL}(?:\\s+(?:de|del|d')\\s*${PAL})?`),
  },
  {
    nota: 'dirección extranjera',
    // «14 Harcourt Road, Flat 2, Bristol BS6 7RD». El número va delante y la vía detrás.
    re: T(`\\b\\d{1,4}\\s+${PAL}(?:\\s+${PAL}){0,3}\\s+(?:Road|Street|St\\.|Avenue|Ave\\.|Lane|Drive|Close|Gardens|Square|Place|Way|Terrace|Crescent|Straße|Strasse|Weg|Allee)\\b(?:,\\s*(?:Flat|Apt\\.?|Apartment|Unit)\\s+\\w{1,4})?(?:,\\s*(?!(?:[A-Z]{1,2}\\d))${PAL})?(?:\\s+[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}|\\s+\\d{4,5})?`),
  },
  {
    nota: 'polígono o urbanización + nave',
    re: T(`\\b(?:pol[íi]gono(?:\\s+industrial)?|urbanizaci[óo]n)\\s+${NOMBRE_VIA}(?:,?\\s*nave\\s+\\d{1,3})?(?:,?\\s*de\\s+${PAL})?`),
  },
  {
    nota: 'domicilio anunciado',
    // «con domicilio en X», «domicilio a efectos de notificaciones en X», «sito en X».
    // El grupo 1 es SOLO la dirección: la fórmula que la anuncia no se tapa. Además de que taparla
    // sobra, el preámbulo arrastraba la detección hasta chocar con la guardia.
    re: T(`\\b(?:con\\s+domicilio(?:\\s+social)?\\s+en|domiciliad[oa]\\s+en|domicilio\\s+a\\s+efectos\\s+de\\s+notificaciones\\s+en|sit[oa]\\s+en|residencia\\s+en|vecin[oa]\\s+de)\\s+([^.;\\n]{5,110})`),
    grupo: 1,
    anunciado: true,
  },
];

// El domicilio anunciado se capturaba hasta el punto, y el punto puede estar muy lejos:
// «vecina de Burgos, comparecen como demandantes frente a D. Cristóbal…» se tapaba ENTERO, verbo
// incluido, y «vecino de Soria, y D.ª Amalia…» se comía la «D» del tratamiento siguiente, que
// entonces ya no presentaba a nadie. La dirección acaba en la primera coma, salvo que lo que venga
// detrás sea de verdad la continuación de una dirección: piso y puerta, código postal, o el
// municipio (palabras capitalizadas y nada más).
const CONTINUACION = new RegExp(
  `^\\s*(?:\\d{1,2}[ºªo]\\s*(?:[A-Z]|izda\\.?|dcha\\.?|izquierda|derecha|centro)?|bajo|[áa]tico|` +
    `entresuelo|principal|planta\\s+\\d{1,2}|esc\\.?\\s*\\w{1,3}|puerta\\s+\\w{1,3}|nave\\s+\\d{1,3}|` +
    `(?:C\\.?P\\.?\\s*)?(?:0[1-9]|[1-4]\\d|5[0-2])\\d{3}(?:\\s+${PAL}(?:[\\s-]+(?:de|del|la|${PAL})){0,4})?|` +
    `${PAL}(?:[\\s-]+(?:de|del|la|${PAL})){0,3}(?:\\s*\\([^)]{2,30}\\))?)\\s*$`,
);
const CORTE_EN_MEDIO = new RegExp(
  `\\s+(?:y|e)\\s+(?:D\\.|D[ªº]|Don|Doña|DON|DOÑA)|\\s+(?:frente\\s+a|contra|ante|quien|que|donde)\\s`,
);

function cortarAnunciado(trozo) {
  const corte = trozo.search(CORTE_EN_MEDIO);
  if (corte > 0) trozo = trozo.slice(0, corte);
  const partes = trozo.split(',');
  let fuera = partes[0];
  for (let i = 1; i < partes.length; i++) {
    if (!CONTINUACION.test(partes[i])) break;
    fuera += `,${partes[i]}`;
  }
  return fuera.replace(/[\s,;:.]+$/, '');
}

// Lo que NO es un domicilio aunque lleve vía o número. Un juzgado tiene sede, no domicilio, y la
// sede va en claro: es lo que hace que el escrito sirva.
// Ojo con la voracidad: estas excepciones se cortan también en la COMA. Con `[^.;\n]*` a secas,
// «PROCURADOR DE LOS TRIBUNALES, EN NOMBRE DE …, CON DOMICILIO EN CARRER DE BALMES 87, 08008
// BARCELONA» quedaba vetado ENTERO desde «TRIBUNALES», y el domicilio del cliente salía en claro.
// Una excepción estirada de más no protege: destapa.
// Con cola de palabras con mayúscula, no «hasta la coma» y sin la bandera `i`: «el colegio de los
// niños está en la calle Alta 5» vetaba la dirección entera.
const COLA_INST =
  "(?:\\s+(?:(?:de|del|de\\s+la|de\\s+los|y|e|i|la|el|sobre|DE|DEL|DE\\s+LA|DE\\s+LOS|Y|I)\\s+)?" +
  // En un escaneo todo va en mayúsculas: la cola no sigue por lo que ya no es el nombre de la
  // institución («HOSPITAL CLINICO SAN CARLOS DIAGNOSTICO DE CARDIOPATIA…»).
  "(?!(?:EL|LA|LOS|LAS|CON|POR|QUE|EN|SE|SU|SUS|AL|DIAGN[OÓ]STIC\\w*|PADEC\\w*|PRESENT\\w*|SUFR\\w*|REFIER\\w*|CONST\\w*|" +
  "Diagn[oó]stic\\w*|Padec\\w*|Present\\w*|Sufr\\w*|Refier\\w*|Const\\w*)(?![\\wÁÉÍÓÚÑáéíóúñ]))" +
  "(?:[A-ZÁÉÍÓÚÑÇ][\\wÁÉÍÓÚÑÇáéíóúñçàèòü'·-]*|n[ºo°]\\.?\\s*\\d{1,3}|\\d{1,3})){0,7}";
const FIN_PALABRA = "(?![\\wÁÉÍÓÚÑÇáéíóúñçàèòü])";
const EXCEPCIONES = [
  new RegExp(`\\b(?:Juzgado|JUZGADO|Juzgados|JUZGADOS|Tribunal|TRIBUNAL|Audiencia|AUDIENCIA)${FIN_PALABRA}${COLA_INST}`, 'g'),
  new RegExp(`\\b(?:Registro|REGISTRO)\\s+(?:de\\s+la\\s+Propiedad|Mercantil|DE\\s+LA\\s+PROPIEDAD|MERCANTIL)${COLA_INST}`, 'g'),
  /\bfinca\s+registral[^.;,\n]{0,40}/gi,
  new RegExp(`\\b(?:Ilustre\\s+)?(?:Colegio|COLEGIO)${FIN_PALABRA}${COLA_INST}`, 'g'),
];

// Filtro previo: sin una vía, un «domicilio en» o un «vecino de», no hay nada que buscar.
const HAY_ALGO = new RegExp(`\\b(?:${VIA}|caser[íi]o|baserri|mas[íi]a|cortijo|pazo|domicili|sit[oa]\\s+en|residencia\\s+en|vecin[oa]\\s+de)`, 'i');

// La calle de un domicilio ya visto, dicha a secas: «Delicias 88» cuando arriba ponía «C/ Delicias,
// 88, bl. 2, esc. B». Devuelve las formas cortas (nombre de la vía + número) por las que buscarla.
export function variantesDeDireccion(valor) {
  const sinVia = valor.replace(new RegExp(`^${VIA}\\s*`, 'i'), '').replace(/^(?:(?:de\s+la|de\s+los|del|de|la|el)\s+)/i, '');
  const m = sinVia.match(/^([A-ZÁÉÍÓÚÑÇÀÈÒÏÜ][\wáéíóúñçàèòïü'·-]*(?:\s+(?:(?:de|del|de la|la|el|i|y)\s+)?[A-ZÁÉÍÓÚÑÇÀÈÒÏÜ][\wáéíóúñçàèòïü'·-]*){0,4})\s*,?\s*(\d{1,4})\b/);
  if (!m) return [];
  return [`${m[1]} ${m[2]}`, `${m[1]}, ${m[2]}`, `${m[1]} nº ${m[2]}`, `${m[1]} n.º ${m[2]}`];
}

export function detectarDomicilios(texto) {
  if (!HAY_ALGO.test(texto)) return [];
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
    regla.re.lastIndex = 0;
    let m;
    while ((m = regla.re.exec(texto)) !== null) {
      if (!m[0].length) { regla.re.lastIndex++; continue; }
      let inicio = m.index;
      let bruto = m[0];
      if (regla.grupo && m[regla.grupo]) {
        const rel = m[0].indexOf(m[regla.grupo]);
        if (rel >= 0) { inicio = m.index + rel; bruto = m[regla.grupo]; }
      }
      let trozo = bruto.replace(/[\s,;:.]+$/, '');
      // El nombre de la vía va con mayúscula (o es un número): «plaza de aparcamiento número 14» no es
      // una dirección. La expresión lleva la bandera `i` por la vía («Calle», «CALLE», «calle»), y
      // esa bandera deja pasar el nombre en minúscula; se comprueba aquí.
      if (!regla.anunciado && regla.nota !== 'dirección extranjera' && !regla.nota.startsWith('caser')) {
        const trasVia = trozo.replace(new RegExp(`^${VIA}\\s*`, 'i'), '');
        if (!/^(?:(?:de\s+la|de\s+los|de\s+las|de\s+les|del|dels|de|do|da|dos|das|i|y|la|el|[dl]')\s*)*[A-ZÁÉÍÓÚÑÇÀÈÒÏÜ\d]/.test(trasVia)) continue;
      }
      // El domicilio SOCIAL de una empresa no es un dato de nadie: consta en el Registro Mercantil. En
      // la duda —la regla de Juan para lo que no es categoría especial—, pasa.
      if (/(?:(?:domicilio|sede)\s+social|despacho\s+(?:profesional\s+)?|oficinas?|sede|consulta)\s*:?\s*(?:en\s+)?(?:el\s+|la\s+)?$/i.test(texto.slice(Math.max(0, inicio - 40), inicio))) continue;
      // Justo detrás del nombre de una empresa («…PENSIONES, S.A.\nPaseo de la Castellana, 95…»,
      // «TASACIONES CANTABRICO SA - C/ CALVO SOTELO 19…»): es la dirección de la empresa.
      if (/\b(?:S\.?\s?[AL]\.?U?|SAU|SLU|S\.?\s?C\.?|C\.?\s?B\.?)\.?\s*[,\-–—]?\s*(?:con\s+(?:domicilio|sede)\s+en\s+)?$/.test(texto.slice(Math.max(0, inicio - 12), inicio))) continue;
      // …o detrás de su CIF: «HIERROS DEL EBRO, S.A. — CIF A28037158\nPolígono Malpica…».
      if (/\bCIF\s*:?\s*[A-Z]-?\d{7}-?[0-9A-J]\s*[,\-–—]?\s*$/.test(texto.slice(Math.max(0, inicio - 25), inicio))) continue;
      if (regla.anunciado) {
        trozo = cortarAnunciado(trozo);
        // Un municipio a secas no es un domicilio: «vecino de Soria», «con domicilio en Madrid». Se
        // queda en claro, igual que «Madrid» en cualquier otro sitio. Lo que se tapa es la
        // dirección con su estructura: número, vía o código postal.
        if (!trozo || !(/\d/.test(trozo) || new RegExp(`\\b${VIA}\\s`, 'i').test(trozo))) continue;
      }
      const fin = inicio + trozo.length;
      let veta = false;
      for (let i = inicio; i < fin; i++) if (vetado[i]) { veta = true; break; }
      if (veta) continue;
      let libre = false;
      for (let i = inicio; i < fin; i++) if (!ocupado[i]) { libre = true; break; }
      if (!libre) continue;
      for (let i = inicio; i < fin; i++) ocupado[i] = true;
      fuera.push({ tipo: 'DIRECCION', valor: trozo, inicio, fin, via: `domicilio:${regla.nota}` });
    }
  }
  return fuera.sort((a, b) => a.inicio - b.inicio);
}

export default detectarDomicilios;

export const _reglas = REGLAS;
