// Detección de personas por CONTEXTO, no por el nombre.
//
// El reconocedor estadístico acierta mucho pero falla justo donde el escrito es más formulario: a
// la cuarta «D.ª» seguida deja de marcar, y el nombre suelto de un saludo («Buenos días, Alberto:»)
// no lo ve nunca. Aquí no se mira si la palabra «parece un nombre»: se mira lo que hay DELANTE.
// En un escrito judicial el tratamiento y el cargo preceden al nombre casi siempre, y eso es una
// regla, no una estadística — no falla a la cuarta repetición y funciona igual en un escaneo en
// mayúsculas, donde la capitalización ya no dice nada.
//
// Esto NO sustituye al modelo, lo complementa: el modelo coge el nombre que aparece sin presentar
// («Interrogado Pérez Alcaraz…»), y esto coge el que aparece presentado pero que al modelo se le
// pasa. Medidos por separado en el banco.

import {
  nombresSinPresentar, apellidosSujeto, esPrimeraPiezaDeNombre, nombresConPila, nombresDePilaSueltos,
  nombresTrasRelacion, nombresEntreComas, vocativos, apellidosEnCorreo, apellidosConGuion, nombresInvertidos,
  nombresChinos, nombresConEdad, motes, nombresTrasTal, nombresConArticulo, inicialesAmplias, nombresEnFicha } from './texto.mjs';

// ───────────────────────────── Piezas del nombre ─────────────────────────────
//
// Una palabra de nombre es una capitalizada normal («Pérez», «Fernández-Ordóñez») o una toda en
// mayúsculas («PEREZ»), que es como vienen los escaneos. Se admiten guion y apóstrofo, que salen en
// apellidos compuestos y en los catalanes («O'Donnell», «Sáenz de Tejada»).
// Las letras acentuadas NO son decorativas aquí: sin la à, la ò y la ç se caían «Antònia»,
// «Llorenç» y «Gràcia», o sea todos los nombres catalanes del corpus. Un apellido que el filtro no
// sabe deletrear es un apellido que sale en claro.
const MIN = "a-záéíóúüñàèìòùïçâêîôûäëöÿ";
const MAY = "A-ZÁÉÍÓÚÜÑÀÈÌÒÙÏÇÂÊÎÔÛÄËÖ";
// Cada pieza EMPIEZA palabra: con la bandera `i` y sin este límite, una regla sin ancla por la
// izquierda arrancaba el nombre a mitad de palabra («…SIN PERMIS·O. VIAJA COMO…» daba la inicial «O.»).
const LIMITE = `(?<![${MIN}${MAY}])`;
const PAL = `${LIMITE}(?:[${MAY}][${MIN}'’]+(?:-[${MAY}][${MIN}'’]+)*|[${MAY}]{3,}(?:-[${MAY}]{3,})*)`;
// Partículas que van EN MEDIO de un nombre y no lo cortan: «de la Fuente», «Ruiz de Alda».
//
// La «y» NO está, y es deliberado. En castellano casi nunca va dentro de un nombre, pero sí separa
// a las partes de una enumeración: «…D. Llorenç Sastre Vives y D.ª Margalida Sastre Vives». Con la
// «y» dentro, el nombre se estiraba hasta comerse el «D.» del SIGUIENTE, el cursor de la expresión
// quedaba pasado, y Margalida no se detectaba nunca. Una heredera en claro por una conjunción.
// La «i» sí está: en catalán va dentro del nombre («Pujadas i Fontanals»).
const PART = '(?:de|del|de\\s+la|de\\s+los|de\\s+las|la|las|los|i|da|dos|van|von|DE|DEL|DE\\s+LA|LA|I)';
// Una inicial suelta: «D. J. Pérez». Admite el ordinal volado, que es como se abrevia María:
// «D.ª M.ª Ángeles Sanchidrián Recio». Sin él, el nombre empezaba a contarse en «Ángeles».
const INI = `(?:${LIMITE}[${MAY}]\\.[ªº]?)`;
// El nombre completo: de 1 a 6 piezas, admitiendo partículas e iniciales entre medias.
const NOMBRE = `(?:${INI}|${PAL})(?:\\s+(?:${PART}\\s+)?(?:${INI}|${PAL})){0,5}`;

// Tratamientos que preceden a un nombre de persona.
const TRATAMIENTO =
  '(?:D\\.ª|D\\.\\u00aa|Dña\\.|D\\.|D[ªº]\\.?|Don|Doña|DON|DOÑA|DONA|Sr\\.|Sra\\.|Srta\\.|SR\\.|SRA\\.|' +
  'Excmo\\.|Excma\\.|Ilmo\\.|Ilma\\.|EXCMO\\.|ILMO\\.|Dr\\.|Dra\\.|DR\\.|DRA\\.|Prof\\.|Profa\\.|Mr\\.?|Mrs\\.?|Ms\\.?|Miss|Herr|Frau|Mme\\.?|Mlle\\.?|Dott\\.?|Sig\\.?)';

// Cargos y oficios que preceden a un nombre y cuyo titular SÍ se tapa. Ojo a los que NO están
// aquí: magistrado, juez, ponente, letrado de la Administración de Justicia y personal de la
// oficina judicial van con nombre real, y de eso se encarga la guardia de intocables.
const CARGO =
  '(?:Procurador(?:a)?(?:\\s+de\\s+los\\s+Tribunales)?|PROCURADOR(?:A)?|' +
  'Letrad[oa]|LETRAD[OA]|Abogad[oa]|ABOGAD[OA]|' +
  'Perit[oa](?:\\s+[a-záéíóúñ]+)?|PERIT[OA]|' +
  'M[ée]dico\\s+Forense|M[ÉE]DICO\\s+FORENSE|' +
  'Notari[oa]|NOTARI[OA]|' +
  'Agente|AGENTE|' +
  'Administrador(?:\\s+(?:[úu]nico|concursal))?|ADMINISTRADOR(?:\\s+[ÚU]NICO)?|' +
  'Testigo|TESTIGO|Denunciante|Perjudicad[oa]|Investigad[oa]|Demandante|Demandad[oa]|' +
  'Arrendador(?:a)?|Arrendatari[oa]|Causante|Heredero|Trabajador(?:a)?|Solicitante|Reclamante|' +
  'secretari[oa]|Secretari[oa])';

const T = (fuente, banderas = 'g') => new RegExp(fuente, banderas);
const EMPIEZA_MAYUS = new RegExp(`^[${MAY}]`);

// ───────────────────────────── Las reglas ─────────────────────────────
//
// Cada una captura el nombre en el grupo 1. El orden no importa: el compositor resuelve solapes.

const REGLAS = [
  {
    // «D. Juan Pérez Gómez», «DOÑA MARIA DEL CARMEN PENALVER GUZMAN», «Excmo. Sr. D. …»
    nombre: 'tratamiento',
    // El tratamiento empieza palabra: sin eso, el «DON» de «METADONA. REALIZADA…» presentaba a una
    // persona llamada «A. REALIZADA LA PRUEBA», que además se llevaba el fármaco.
    re: T(`(?<![\\p{L}])(?:${TRATAMIENTO}\\s*)+(${NOMBRE})`, 'gu'),
  },
  {
    // «Procuradora D.ª Lucía Berrocal», «el letrado Ferrer Castaño», «Médico Forense D.ª Pilar…»
    nombre: 'cargo',
    // «como testigo a Hans-Peter Müller», «citar al perito D. …»: la «a» entre el cargo y el nombre.
    re: T(`\\b${CARGO}\\s+(?:(?:a|al)\\s+)?(?:${TRATAMIENTO}\\s*)*(${NOMBRE})`, 'gi'),
  },
  {
    // «Ponente: …» NO entra aquí — lo protege la guardia. Esta es la del revés: el nombre y detrás
    // el cargo. «D.ª Marta Iglesias Rubio, Procuradora de los Tribunales».
    nombre: 'cargo-detras',
    // El nombre tiene que EMPEZAR en un límite (principio de línea, signo de puntuación, «y», o un
    // tratamiento). Sin anclar el principio, la expresión arranca lo más a la izquierda que puede y
    // se lleva la cola de lo anterior: «…N 12 DE BARCELONA\n\nDON JOAQUIN MUÑOZ…» se detectaba
    // desde «BARCELONA», y entonces la detección pisa el nombre del juzgado, la guardia la anula
    // entera y el procurador se va en claro.
    re: T(`(?:^|[\\n,;:(]\\s*|\\sy\\s|${TRATAMIENTO}\\s*)(${NOMBRE}),\\s*${CARGO}`, 'g'),
  },
  {
    // Saludo de correo: «Buenos días, Alberto:», «Estimado Sr. Domínguez:», «Hola Alonso,».
    // Aquí es donde se escapa el nombre de pila suelto, que ningún reconocedor marca.
    nombre: 'saludo',
    re: T(
      // En las lenguas cooficiales e inglés también: «Kaixo Josune:», «Bon dia, Marc,», «Bos días».
      `(?:Estimad[oa]s?|Muy\\s+Sr\\.?\\s*m[íi]o|Querid[oa]|Hola|Buenos\\s+d[íi]as|Buenas\\s+tardes|Kaixo|Egun\\s+on|` +
        `Arratsalde\\s+on|Bon\\s+dia|Bona\\s+tarda|Benvolgud[ao]|Bos\\s+d[íi]as|Boas\\s+tardes|Hello|Dear|Hi|Lieber|Liebe|Sehr\\s+geehrte[rs]?|Cher|Ch[èe]re|Caro|Cara|Bonjour)` +
        `(?:\\s+compañer[oa])?[,:\\s]+(?:${TRATAMIENTO}\\s*)*(${NOMBRE})\\s*[,:]`,
      'gi',
    ),
  },
  {
    // Firma: una línea que es solo un nombre, después de la despedida.
    nombre: 'firma',
    // En producción no hay saltos de línea (el indexador une las palabras con un espacio), así que
    // la firma no puede exigir uno: basta un blanco, y el nombre acaba en el fin del texto o en
    // lo que ya no es nombre. Que la primera pieza no sea una palabra corriente lo comprueba el
    // bucle de abajo («Un saludo. Por cierto…» no firma nadie llamado «Por»).
    re: T(`(?:saludo|saludos|abrazo|atentamente|cordialmente)[,.]?\\s+(${NOMBRE})(?=\\s*$|\\s*[\\n,<(|]|\\s+(?:Tel|Tfno|M[óo]vil|Abogad|Letrad|Socio|Asociad|Despacho|www|http))`, 'gi'),
  },
  {
    // «at. D. Rodrigo Villaescusa Peñalba» de una cláusula de notificaciones.
    nombre: 'a-la-atencion',
    re: T(`\\b(?:at\\.|a\\s+la\\s+atenci[óo]n\\s+de|A/A)\\s*:?\\s*(?:${TRATAMIENTO}\\s*)*(${NOMBRE})`, 'gi'),
  },
  {
    // Campo de cabecera de correo: «De: Gustavo Peñaranda Iriarte <…>».
    nombre: 'cabecera-correo',
    // Sin `^`: en producción la cabecera puede ir a mitad de fragmento. El «<» del correo basta.
    // Y sin «<»: «Para: Jon Ugalde» a secas, que acaba en el salto de línea o en la cabecera siguiente.
    re: T(`(?:^|(?<=[\\s>;,]))(?:De|Para|CC|CCO|Cc|From|To)\\s*:\\s*["«“]?(${NOMBRE})["»”]?\\s*(?:<|;|$|\\n|(?=\\s+(?:Asunto|CC|CCO|Cc|Para|De|Enviado|Fecha|Subject|Date|From|To)\\s*:))`, 'gm'),
  },
  {
    // Etiqueta de ficha: «Solicitante: D. Youssef El Amrani», «TRABAJADOR: DON GERMAN ALBERDI».
    nombre: 'etiqueta',
    re: T(
      // Sin `^` por lo mismo: la etiqueta de la ficha va detrás de un punto o de un blanco.
      `(?:^|(?<=[\\s.;]))\\s*(?:Solicitante|Reclamante|Causante|Trabajador(?:a)?|Conductor[^:\\n]*|Destinatario|` +
        `TRABAJADOR|CONDUCTOR[^:\\n]*|EMPRESA|Demandante|Demandad[oa]|Investigad[oa]|Herederos?|` +
        `Beneficiari[oa]|BENEFICIARI[OA]|Titular|TITULAR|Interesad[oa]|INTERESAD[OA]|Lesionad[oa]|LESIONAD[OA]|` +
        `Paciente|PACIENTE|Asegurad[oa]|ASEGURAD[OA]|Tomador(?:a)?|TOMADOR(?:A)?|Deudor(?:a)?|DEUDOR(?:A)?|` +
        `Acreedor(?:a)?|ACREEDOR(?:A)?|Avalista|AVALISTA|Propietari[oa]|PROPIETARI[OA]|Comprador(?:a)?|Vendedor(?:a)?|` +
        `Denunciante|DENUNCIANTE|Denunciad[oa]|DENUNCIAD[OA]|Testigo|TESTIGO|Perjudicad[oa]|PERJUDICAD[OA]|` +
        `Menor|MENOR|Detenid[oa]|DETENID[OA]|Perito|PERITO|Firmado|FIRMADO|Fdo\\.?|FDO\\.?|Hij[oa]s?(?:\\s+(?:comunes|menores))?|` +
        `Menores|Progenitor(?:a|es)?|Reagrupad[oa]s?|Reagrupante|Albacea|Legatari[oa]|Usufructuari[oa]|Fiador(?:a)?|Asistentes?|Asisten|` +
        `Presidente|Presidenta|Secretari[oa]|Vocal(?:es)?|Socios?|Administrador(?:a)?|Otorgante|Compareciente)\\s*\\.?:\\s*` +
        `(?:${TRATAMIENTO}\\s*)*(${NOMBRE})`,
      'gim',
    ),
  },
  {
    // «Daniel Zamarreño Alcaine, nacido el 7 de junio de 2016». Los hijos menores de un convenio
    // regulador se enumeran así, sin tratamiento delante, y sin esta regla salían en claro.
    nombre: 'fecha-nacimiento',
    sinAnclaIzquierda: true,
    // Sin ancla, la regla se intentaba en cada posición del texto: 2 ms por fragmento para algo que
    // casi nunca está. Solo se corre si el fragmento dice «nacido» o «fallecido».
    pre: /nacid[oa]|fallecid[oa]/i,
    re: T(`(${NOMBRE}),\\s*(?:nacid[oa]|fallecid[oa])\\s+(?:el|en)\\b`, 'gi'),
  },
  {
    // Enumeración de partes: «Herederos: D.ª A, D. B y D.ª C». El primero lo coge la etiqueta; los
    // demás van detrás de coma o de «y», y los coge la regla de tratamiento. Esta recoge el caso
    // sin tratamiento: «…, D. Llorenç Sastre Vives y D.ª Margalida Sastre Vives».
    nombre: 'enumeracion',
    re: T(`(?:,|\\sy)\\s+(?:${TRATAMIENTO}\\s*)+(${NOMBRE})`, 'g'),
  },
];

// Palabras que nunca son un nombre de persona aunque vayan capitalizadas y detrás de un
// tratamiento o un cargo. Sin esta lista, «D. Ramón Escudero» va bien pero «el Letrado de la
// Administración de Justicia» se convertiría en una persona llamada «La Administración».
const NO_ES_NOMBRE = new Set(
  [
    'Administración', 'Administracion', 'Justicia', 'Tribunales', 'Tribunal', 'Juzgado', 'Juzgados',
    'Audiencia', 'Sala', 'Sección', 'Seccion', 'Estado', 'Gobierno', 'Ministerio', 'Ayuntamiento',
    'Diputación', 'Diputacion', 'Registro', 'Propiedad', 'Mercantil', 'Colegio', 'Abogacía',
    'Abogacia', 'Notarial', 'Seguridad', 'Social', 'Hacienda', 'Agencia', 'Consejo', 'Comisión',
    'Comision', 'Fiscalía', 'Fiscalia', 'Banco', 'España', 'Espana', 'Guardia', 'Civil', 'Policía',
    'Policia', 'Nacional', 'Instituto', 'Medicina', 'Legal', 'Hospital', 'Servicio', 'Dirección',
    'Direccion', 'General', 'Tráfico', 'Trafico', 'Primera', 'Instancia', 'Instrucción',
    'Instruccion', 'Penal', 'Civil', 'Mercantil', 'Social', 'Violencia', 'Mujer', 'Trabajadores',
    'Sociedades', 'Capital', 'Código', 'Codigo', 'Ley', 'Real', 'Decreto', 'Reglamento',
    'Constitución', 'Constitucion', 'Enjuiciamiento', 'Supremo', 'Constitucional', 'Superior',
    'Provincial', 'Contencioso-Administrativo', 'Económico-Administrativo', 'Tesorería',
    'Tesoreria', 'Defensor', 'Pueblo', 'Mercados', 'Competencia', 'Valores', 'Mercado',
    // Lo que va detrás de un cargo sin ser un nombre: «Letrado Contrario», «Letrada actuante».
    'Contrario', 'Contraria', 'Actuante', 'Adverso', 'Adversa', 'Designado', 'Designada',
  ].map((s) => s.toUpperCase()),
);

const SIN_TILDES = new Map();
const sinTildes = (s) => {
  let r = SIN_TILDES.get(s);
  if (r === undefined) {
    r = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    if (SIN_TILDES.size > 50000) SIN_TILDES.clear();
    SIN_TILDES.set(s, r);
  }
  return r;
};

function esNombrePlausible(txt) {
  const piezas = txt.split(/\s+/).filter(Boolean);
  if (!piezas.length) return false;
  // Si la PRIMERA pieza es una palabra de institución, no es un nombre.
  const primera = sinTildes(piezas[0].replace(/[.,;:]$/, ''));
  for (const mala of NO_ES_NOMBRE) if (sinTildes(mala) === primera) return false;
  // Una sola pieza y muy corta: casi siempre es basura de la expresión regular.
  if (piezas.length === 1 && piezas[0].replace(/\./g, '').length < 3) return false;
  return true;
}

// Recorta la cola del nombre: la expresión regular es golosa y se lleva la palabra que viene
// detrás («Juan Pérez Gómez Mayor» de «…Gómez, mayor de edad»). Se corta en cuanto aparece una
// palabra funcional o una pieza de institución.
const CORTE = new Set(
  ['MAYOR', 'CON', 'QUE', 'EN', 'POR', 'PARA', 'ANTE', 'COMO', 'SEGUN', 'DESDE', 'HASTA', 'SOBRE',
   'NACIDO', 'NACIDA', 'FALLECIDO', 'FALLECIDA', 'TITULAR', 'VECINO', 'VECINA', 'ACTUANDO',
   'ASISTIDA', 'ASISTIDO', 'PROCURADORA', 'PROCURADOR', 'LETRADO', 'LETRADA', 'NOTARIO', 'PERITO',
   'COLEGIADO', 'COLEGIADA', 'ADMINISTRADOR', 'MEDICO', 'AGENTE', 'MAGISTRADA', 'MAGISTRADO',
   'DEMANDANTE', 'DEMANDADO', 'DEMANDADA', 'ARRENDADOR', 'ARRENDATARIA', 'SOLICITANTE',
   'REQUERIDA', 'REQUERIDO', 'PRESIDE', 'PRIMO', 'HERMANO', 'HERMANA', 'PADRE', 'MADRE', 'HIJO'],
);

// Partículas que van DENTRO de un nombre. No cortan por sí solas —«de la Fuente Calatayud» es un
// apellido, no el final del nombre más una preposición— pero sí cortan si son lo último que queda:
// «Tomás Larrea Goicoechea y» termina en el nombre, no en la conjunción.
const PARTICULA = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'I', 'DA', 'DOS', 'VAN', 'VON']);

// Tratamientos escritos con todas las letras: al ir en mayúsculas encajan como pieza de nombre y
// se cuelan por delante («DON JOAQUIN MUNOZ»). El alias sustituye al nombre, no al «DON».
// La «D.» de «D. Alberto» encaja como INICIAL de nombre, así que también hay que quitarla. Las
// demás iniciales sueltas («J. M. Escrivá») se conservan: son parte del nombre.
const TRATO_SUELTO = new Set(['DON', 'DONA', 'DOÑA', 'SR', 'SRA', 'SRTA', 'EXCMO', 'EXCMA',
  'ILMO', 'ILMA', 'DNA', 'D', 'DÑA', 'DNA']);

function recortar(txt) {
  let piezas = txt.split(/\s+/).filter(Boolean);
  // Fuera lo que sobra por delante: partículas sueltas y tratamientos. Si no, la detección empieza
  // dentro del nombre del órgano judicial, la guardia la da por protegida entera y el nombre de la
  // persona sale EN CLARO. Un recorte mal hecho por la izquierda no tapa de más: destapa.
  while (piezas.length) {
    const c = sinTildes(piezas[0].replace(/[.,;:ªº]/g, ''));
    if (PARTICULA.has(c) || TRATO_SUELTO.has(c)) piezas = piezas.slice(1);
    else break;
  }
  const fuera = [];
  for (let i = 0; i < piezas.length; i++) {
    const p = piezas[i];
    const limpia = sinTildes(p.replace(/[.,;:]$/, ''));
    // «mayor» corta en «…Gómez mayor de edad», pero «Amalia Estado Mayor» es una persona con su
    // segundo apellido: solo corta si detrás viene «de edad» o si va en minúscula.
    if (limpia === 'MAYOR') {
      const sig = sinTildes((piezas[i + 1] ?? '').replace(/[.,;:]$/, ''));
      if (sig === 'DE' || sig === 'EDAD' || /^[a-z]/.test(p) || !piezas[i + 1] && /^[a-z]/.test(p)) break;
      fuera.push(p);
      continue;
    }
    if (CORTE.has(limpia)) break;
    // Un nombre no lleva palabras en minúscula salvo las partículas: «Os reenvío la diligencia…»
    // no es el nombre de nadie (la bandera `i` de la regla del saludo lo dejaba casar).
    if (/^[a-záéíóúüñàèìòùç]/.test(p) && !PARTICULA.has(limpia)) break;
    // Antes se cortaba aquí si la pieza era una palabra de institución. Se ha quitado: «Lorenzo
    // Guardia Civil» y «Amalia Estado Mayor» son personas, y cortarlas dejaba el apellido en claro.
    // De que no se tape una institución de verdad ya se encarga la guardia de intocables, que va
    // por delante de todo; este recorte solo tiene que decidir dónde acaba el nombre.
    // Una partícula solo sigue formando parte del nombre si detrás viene otra pieza de nombre.
    // Sin esto, «María José de la Fuente Calatayud» se quedaba en «María José».
    if (PARTICULA.has(limpia)) {
      let j = i;
      while (j < piezas.length && PARTICULA.has(sinTildes(piezas[j].replace(/[.,;:]$/, '')))) j++;
      const siguiente = piezas[j];
      if (!siguiente) break;
      const limpiaSig = sinTildes(siguiente.replace(/[.,;:]$/, ''));
      if (CORTE.has(limpiaSig) || NO_ES_NOMBRE.has(limpiaSig)) break;
      // Una pieza suelta de una sola letra detrás de «y» es el tratamiento del SIGUIENTE nombre
      // («…Goicoechea y D.ª Emilia…»), no parte de este.
      if (siguiente.replace(/[.,;:ª º]/g, '').length <= 1) break;
    }
    fuera.push(p);
  }
  // Fuera las partículas y la puntuación que hayan quedado colgando al final.
  while (fuera.length && PARTICULA.has(sinTildes(fuera[fuera.length - 1].replace(/[.,;:]$/, '')))) fuera.pop();
  return fuera.join(' ').replace(/[,;:.]+$/, '');
}

function ultimaRacha(txt) {
  const piezas = txt.split(/\s+/).filter(Boolean);
  let i = piezas.length;
  while (i > 0) {
    const p = piezas[i - 1];
    const k = sinTildes(p.replace(/[.,;:]$/, ''));
    if (PARTICULA.has(k)) { i--; continue; }
    if (CORTE.has(k) || !esPrimeraPiezaDeNombre(p) || !EMPIEZA_MAYUS.test(p)) break;
    i--;
  }
  while (i < piezas.length && PARTICULA.has(sinTildes(piezas[i]))) i++;
  return piezas.slice(i).join(' ');
}

function quitarMinusculasDelante(txt) {
  const piezas = txt.split(/(\s+)/);
  let i = 0;
  while (i < piezas.length) {
    const p = piezas[i];
    if (/^\s*$/.test(p)) { i++; continue; }
    if (EMPIEZA_MAYUS.test(p)) break;
    i++;
  }
  return piezas.slice(i).join('');
}

// Las iniciales de un menor o de una víctima: «el menor P.F.V.», «l'alumne A.S.B.». Solo con un
// contexto que diga que son una persona: sin él, «S.L.» o «D.P.» son otra cosa.
const RE_INICIALES = /(?<![\p{L}.])((?:[A-ZÁÉÍÓÚÑ]\.){2,4})(?![\p{L}])/gu;
const NO_INICIALES = new Set(['P.D.', 'P.O.', 'P.A.', 'N.B.', 'S.L.', 'S.A.', 'C.P.', 'D.P.', 'P.A.', 'S.S.', 'N.I.F.', 'D.N.I.', 'N.I.E.', 'C.I.F.', 'U.E.',
  'EE.UU.', 'A.P.', 'T.S.', 'T.C.', 'A.N.', 'C.E.', 'C.C.', 'L.O.', 'R.D.', 'B.O.E.', 'I.T.', 'S.L.U.', 'S.A.U.', 'C.B.', 'U.C.I.', 'C.S.', 'I.V.A.']);
const ANTES_INICIALES = /(?:menor(?:es)?|alumn[oa]s?|alumne|nen|nena|niñ[oa]s?|hij[oa]s?|adoptand[oa]|expedientad[oa]|infractor[a]?|investigad[oa]|v[íi]ctima|acusad[oa]|joven|adolescent[e]?|el\s+otro|l'altre|la\s+otra|l'altra|y|i|e)\s*,?\s*$/i;
function iniciales(texto) {
  const fuera = [];
  RE_INICIALES.lastIndex = 0;
  let m;
  while ((m = RE_INICIALES.exec(texto)) !== null) {
    if (NO_INICIALES.has(m[1])) continue;
    const antes = texto.slice(Math.max(0, m.index - 30), m.index);
    const despues = texto.slice(m.index + m[1].length, m.index + m[1].length + 20);
    if (!ANTES_INICIALES.test(antes) && !/^\s*(?:\(|,)\s*(?:de\s+)?\d{1,2}\s+a[ñn]ys?|^\s*(?:\(|,)\s*(?:de\s+)?\d{1,2}\s+a[ñn]os?/.test(despues)) continue;
    fuera.push({ tipo: 'PERSONA', valor: m[1], inicio: m.index, fin: m.index + m[1].length, via: 'contexto:iniciales' });
  }
  return fuera;
}

export function detectarPersonasPorContexto(texto) {
  const fuera = [
    ...nombresSinPresentar(texto), ...apellidosSujeto(texto), ...nombresConPila(texto), ...nombresDePilaSueltos(texto),
    ...nombresTrasRelacion(texto), ...nombresEntreComas(texto), ...vocativos(texto), ...apellidosEnCorreo(texto),
    ...apellidosConGuion(texto), ...nombresInvertidos(texto), ...nombresChinos(texto), ...nombresConEdad(texto),
    ...motes(texto), ...iniciales(texto), ...nombresTrasTal(texto),
    ...nombresConArticulo(texto), ...inicialesAmplias(texto), ...nombresEnFicha(texto),
  ];
  for (const regla of REGLAS) {
    if (regla.pre && !regla.pre.test(texto)) continue;
    regla.re.lastIndex = 0;
    let m;
    while ((m = regla.re.exec(texto)) !== null) {
      if (m[0].length === 0) { regla.re.lastIndex++; continue; }
      const bruto = m[1];
      if (!bruto) continue;
      // «NOTARIO DE VITORIA-GASTEIZ», «Registrador de Tarragona»: con la bandera `i`, la «de» casa
      // como pieza de nombre y la ciudad salía como persona. Detrás del cargo, un «de» dice que lo
      // que sigue es el lugar o la institución, no quien lo ocupa.
      if (regla.nombre === 'cargo' && /^(?:de|del)\s/i.test(bruto)) continue;
      // «EMPRESA: MONTAJES ELECTRICOS DEL NORTE S.L.» es una sociedad, no una persona. La etiqueta
      // se queda (un autónomo figura ahí con su nombre), pero no cuando detrás viene la forma
      // social.
      // (La «S.» de «S.L.» encaja como inicial de nombre, así que la forma social puede ir dentro
      // de lo capturado o justo detrás: se mira el tramo entero.)
      if (regla.nombre === 'etiqueta' &&
        /(?:^|\s)(?:S\.?\s?L\.?U?|S\.?\s?A\.?U?|S\.?\s?C|C\.?\s?B|S\.?\s?COOP|AB|GmbH|Ltd|LLC|Inc|SAS|SARL|SpA|BV|NV|AG|PLC|Oy|A\/S|S\.?L\.?P)(?:\.|\s|,|$)/.test(texto.slice(m.index, m.index + m[0].length + 8))) continue;
      const rel = m[0].lastIndexOf(bruto);
      if (rel < 0) continue;
      // Con la bandera `i`, una regla sin ancla por la izquierda («…, nacido el») arranca el nombre
      // lo más a la izquierda que puede: «custodia de los hijos menores Daniel Zamarreño Alcaine».
      // La comprobación de mayúscula de abajo lo tiraba ENTERO, y el hijo se quedaba sin detectar:
      // la propagación cogía sus apellidos con los alias del padre y de la madre, y «Daniel» salía
      // en claro. Lo que sobra por delante son las palabras en minúscula que no son partícula de
      // un nombre; se quitan y se sigue con lo que queda. SOLO en esta regla: en las de cargo, la
      // misma bandera deja que «la letrada de la contraparte pregunta si Pérez tuvo…» case, y ahí
      // tirar el trozo entero es lo correcto (la letrada no se llama «Pérez tuvo»).
      // En esta regla el nombre es la ÚLTIMA racha de piezas válidas antes de «, nacido»: «VIAJA COMO
      // PASAJERO MAMADOU DIALLO, NACIDO EN SENEGAL» es Mamadou Diallo, no «VIAJA».
      const recortado = recortar(regla.sinAnclaIzquierda ? ultimaRacha(quitarMinusculasDelante(bruto)) : bruto);
      if (!recortado || !esNombrePlausible(recortado)) continue;
      // Un nombre EMPIEZA por mayúscula, siempre. Varias reglas llevan la bandera `i` para que el
      // cargo case en minúscula («el letrado Ferrer Castaño»), pero esa bandera anula también la
      // exigencia de mayúscula del nombre, y entonces «El reclamante padece espondilitis» daba una
      // persona llamada «padece espondilitis anquilosante». No solo era basura: tenía más
      // prioridad que la regla de categoría especial y le robaba el trozo, así que el diagnóstico
      // acababa mal etiquetado. La comprobación va aquí, una vez, y vale para todas las reglas.
      if (!EMPIEZA_MAYUS.test(recortado)) continue;
      // Ni una palabra corriente con mayúscula («Por», «Según», «Anexo»): eso no empieza un nombre.
      if (!esPrimeraPiezaDeNombre(recortado.split(/\s+/)[0])) continue;
      // `recortar` puede quitar piezas por DELANTE («DON», «D.», una partícula suelta), así que el
      // principio del trozo se mueve con ellas. Si no se mueve, el alias se escribe desplazado y
      // parte el texto: «letrada de D. Alberto Ferrer Castaño» salía como «letrada Alberto Ferrer
      // Castañoastaño». Lo destapó la prueba de ida y vuelta, y por eso esa prueba está aquí.
      const desplazamiento = bruto.indexOf(recortado);
      if (desplazamiento < 0) continue;
      const inicio = m.index + rel + desplazamiento;
      fuera.push({
        tipo: 'PERSONA',
        valor: recortado,
        inicio,
        fin: inicio + recortado.length,
        via: `contexto:${regla.nombre}`,
      });
    }
  }
  return fuera.sort((a, b) => a.inicio - b.inicio || b.fin - a.fin);
}

export default detectarPersonasPorContexto;

export const _reglas = REGLAS;
