// Corpus CIEGO 2 — escrito el 29-sep-2026 sin ver las reglas del anonimizador ni los otros corpus.
export default [
  {
    id: 'd-querella-estafa',
    fuente: 'Querella por estafa de inversión ante Tribunal de Instancia (Valladolid)',
    clase: 'nativo',
    texto: `AL TRIBUNAL DE INSTANCIA DE VALLADOLID, SECCIÓN DE INSTRUCCIÓN, PLAZA N.º 3

Doña Covadonga Prieto Arias, Procuradora de los Tribunales, en nombre y representación de DOÑA ITZIAR GOIKOETXEA ARRIZABALAGA, mayor de edad, con DNI 16054321-E y domicilio en calle Doctor Cazalla, 14, 3.º B, 47004 Valladolid, bajo la dirección letrada de Don Íñigo Bravo Saiz, colegiado n.º 3.412 del Ilustre Colegio de la Abogacía de Valladolid, ante el Tribunal comparezco y, como mejor proceda en Derecho, DIGO:

Que por medio del presente escrito formulo QUERELLA CRIMINAL por un presunto delito de estafa de los artículos 248 y 250.1.5.º del Código Penal contra DON BRUNO CASTILLO REY, con DNI 71123456-G, con domicilio en Urbanización Los Pinares, parcela 27, 47151 Boecillo (Valladolid), y contra la mercantil INVERSIONES DUERO PATRIMONIAL, S.L., con CIF B47851233.

HECHOS

PRIMERO.- En marzo de 2025 el querellado, que se presentaba como asesor financiero, convenció a mi mandante para que transfiriera 86.000 euros a la cuenta ES43 2100 1234 5613 0012 3456, titularidad de la mercantil, prometiéndole una rentabilidad garantizada del 11 % anual.

SEGUNDO.- Mi mandante, viuda desde 2022 y en tratamiento con sertralina 50 mg por un trastorno depresivo mayor, confió plenamente en el Sr. Castillo, al que conocía porque era amigo de su difunto esposo, Don Aitor Etxeberria Lasa.

TERCERO.- Las comunicaciones se mantuvieron por el teléfono 983 21 44 07 y por correo electrónico desde la dirección bruno.castillo@duero-patrimonial.es. Castillo dejó de contestar en noviembre de 2025.

Se designa como testigo a Doña Nerea Goikoetxea Mendizabal, hermana de la querellante.`,
    oro: [
      ["ORGANO", "TRIBUNAL DE INSTANCIA DE VALLADOLID, SECCIÓN DE INSTRUCCIÓN, PLAZA N.º 3"],
      ["PERSONA", "Covadonga Prieto Arias"],
      ["PERSONA", "ITZIAR GOIKOETXEA ARRIZABALAGA"],
      ["DNI", "16054321-E"],
      ["DIRECCION", "calle Doctor Cazalla, 14, 3.º B, 47004 Valladolid"],
      ["PERSONA", "Íñigo Bravo Saiz"],
      ["ORGANISMO", "Ilustre Colegio de la Abogacía de Valladolid"],
      ["NORMA", "artículos 248 y 250.1.5.º del Código Penal"],
      ["PERSONA", "BRUNO CASTILLO REY"],
      ["DNI", "71123456-G"],
      ["DIRECCION", "Urbanización Los Pinares, parcela 27, 47151 Boecillo"],
      ["CIF", "B47851233"],
      ["IBAN", "ES43 2100 1234 5613 0012 3456"],
      ["CAT_ESPECIAL", "sertralina 50 mg"],
      ["CAT_ESPECIAL", "trastorno depresivo mayor"],
      ["PERSONA", "Castillo"],
      ["PERSONA", "Aitor Etxeberria Lasa"],
      ["TELEFONO", "983 21 44 07"],
      ["CORREO", "bruno.castillo@duero-patrimonial.es"],
      ["PERSONA", "Nerea Goikoetxea Mendizabal"],
    ],
  },
  {
    id: 'd-acusacion-fiscal-lesiones',
    fuente: 'Escrito de acusación del Ministerio Fiscal por lesiones con agravante de reincidencia',
    clase: 'nativo',
    expediente: 'exp-lesiones-alicante',
    texto: `AL TRIBUNAL DE INSTANCIA DE ALICANTE, SECCIÓN PENAL

Diligencias Previas n.º 1187/2025 — Procedimiento Abreviado n.º 64/2026

EL FISCAL, en las diligencias arriba referenciadas, formula ESCRITO DE ACUSACIÓN contra:

MOHAMED EL AMRANI BOUZIANE, nacido en Tetuán (Marruecos) el 4 de febrero de 1991, con NIE X-4471823-W, en libertad por esta causa, con antecedentes penales computables a efectos de reincidencia.

CONCLUSIONES PROVISIONALES

PRIMERA.- Sobre las 02:30 horas del 17 de agosto de 2025, en el interior del pub «La Bodeguita», en la calle Castaños de Alicante, el acusado, tras una discusión, golpeó con un vaso de cristal en la cara a Óscar Ramos Pastor, causándole fractura de huesos propios nasales y una herida inciso-contusa en región malar izquierda de 4 cm, que precisaron para su sanidad tratamiento quirúrgico y 45 días de curación, quedándole como secuela una cicatriz de 3,5 cm.

La intervención de los agentes de la Policía Local con TIP 2217 y 2240 permitió la detención del acusado en el lugar.

SEGUNDA.- Los hechos son constitutivos de un delito de lesiones de los artículos 147.1 y 148.1.º del Código Penal.

CUARTA.- Concurre la agravante de reincidencia del artículo 22.8.ª CP, pues el acusado fue condenado por sentencia firme de 9 de mayo de 2023 del Juzgado de lo Penal n.º 4 de Alicante, por un delito de lesiones, a la pena de 1 año de prisión.

QUINTA.- Indemnizará a Óscar Ramos en 4.800 euros por las lesiones y en 3.000 euros por la secuela.

Testigos: Doña Lucía Pastor Ramos, con domicilio a efectos de notificaciones en la Avenida de Novelda, 131, esc. 2, 4.º D, 03009 Alicante, y el camarero Wilson Andrés Quiñónez Caicedo.`,
    oro: [
      // Lesiones de la víctima: dato de salud (29-sep).,
      ['CAT_ESPECIAL', 'tratamiento quirúrgico'],
      ["ORGANO", "TRIBUNAL DE INSTANCIA DE ALICANTE, SECCIÓN PENAL"],
      ["AUTOS", "Diligencias Previas n.º 1187/2025"],
      ["AUTOS", "Procedimiento Abreviado n.º 64/2026"],
      ["PERSONA", "MOHAMED EL AMRANI BOUZIANE"],
      ["NIE", "X-4471823-W"],
      ["OBJETO", "antecedentes penales computables a efectos de reincidencia"],
      ["PERSONA", "Óscar Ramos Pastor"],
      ["CAT_ESPECIAL", "fractura de huesos propios nasales"],
      ["CAT_ESPECIAL", "herida inciso-contusa en región malar izquierda de 4 cm"],
      ["CAT_ESPECIAL", "cicatriz de 3,5 cm"],
      ["ORGANISMO", "Policía Local"],
      ["TIP", "2217"],
      ["TIP", "2240"],
      ["NORMA", "artículos 147.1 y 148.1.º del Código Penal"],
      ["OBJETO", "agravante de reincidencia"],
      ["NORMA", "artículo 22.8.ª CP"],
      ["ORGANO", "Juzgado de lo Penal n.º 4 de Alicante"],
      ["PERSONA", "Óscar Ramos"],
      ["PERSONA", "Lucía Pastor Ramos"],
      ["DIRECCION", "Avenida de Novelda, 131, esc. 2, 4.º D, 03009 Alicante"],
      ["PERSONA", "Wilson Andrés Quiñónez Caicedo"],
    ],
  },
  {
    id: 'd-auto-apertura-juicio-oral',
    fuente: 'Auto de apertura de juicio oral (mismo asunto de lesiones)',
    clase: 'nativo',
    expediente: 'exp-lesiones-alicante',
    texto: `TRIBUNAL DE INSTANCIA DE ALICANTE
SECCIÓN DE INSTRUCCIÓN — PLAZA N.º 2
Diligencias Previas n.º 1187/2025

AUTO

En Alicante, a 12 de enero de 2026.

HECHOS

ÚNICO.- Por el Ministerio Fiscal se ha formulado escrito de acusación contra Mohamed El Amrani por un delito de lesiones, solicitando la apertura del juicio oral. La acusación particular, ejercida por el Sr. Ramos bajo la dirección de la letrada Doña Marta Blanco Toledo, se ha adherido.

PARTE DISPOSITIVA

1.- Se acuerda la APERTURA DEL JUICIO ORAL contra MOHAMED EL AMRANI BOUZIANE por el delito de lesiones de los artículos 147.1 y 148.1.º CP.
2.- Se declara competente para el enjuiciamiento a la Sección Penal de este Tribunal de Instancia.
3.- Se requiere al acusado para que preste fianza de 8.000 euros. Notifíquese al acusado en su domicilio de la calle Pintor Aparicio, 8, bajo izquierda, de Alicante, y en el teléfono +34 612 448 903.

Así lo acuerda, manda y firma S.S.ª Ilma. Doña Rosario Ferrándiz Soler, Magistrada. Doy fe.
La Letrada de la Administración de Justicia, Pilar Moltó Gisbert.`,
    oro: [
      ["ORGANO", "TRIBUNAL DE INSTANCIA DE ALICANTE"],
      ["AUTOS", "Diligencias Previas n.º 1187/2025"],
      ["ORGANISMO", "Ministerio Fiscal"],
      ["PERSONA", "Mohamed El Amrani"],
      ["PERSONA", "Ramos"],
      ["PERSONA", "Marta Blanco Toledo"],
      ["PERSONA", "MOHAMED EL AMRANI BOUZIANE"],
      ["NORMA", "artículos 147.1 y 148.1.º CP"],
      ["DIRECCION", "calle Pintor Aparicio, 8, bajo izquierda, de Alicante"],
      ["TELEFONO", "+34 612 448 903"],
      ["PONENTE", "Rosario Ferrándiz Soler"],
      ["LAJ", "Pilar Moltó Gisbert"],
    ],
    ambiguo: ['Ramos'],
  },
  {
    id: 'd-alzada-consejeria-oposiciones',
    fuente: 'Recurso de alzada ante Consejería de Educación (oposiciones, turno de discapacidad)',
    clase: 'nativo',
    texto: `A LA CONSEJERÍA DE EDUCACIÓN, CIENCIA Y UNIVERSIDADES DE LA COMUNIDAD DE MADRID

Don Diego Armando Villalba Ortiz, con DNI 50987654-N y domicilio a efectos de notificaciones en calle Arroyo del Olivar, 45, portal 3, 2.º izda., 28018 Madrid, teléfono 634.221.908, correo dvillalba.ortiz@gmail.com, interpone RECURSO DE ALZADA, al amparo de los artículos 121 y 122 de la Ley 39/2015, de 1 de octubre, del Procedimiento Administrativo Común de las Administraciones Públicas, contra la Resolución de 3 de julio de 2026 de la Dirección General de Recursos Humanos por la que se aprueba la lista definitiva de aspirantes seleccionados en el procedimiento selectivo para el Cuerpo de Maestros, especialidad de Pedagogía Terapéutica.

ALEGACIONES

PRIMERA.- El recurrente concurrió por el turno de reserva para personas con discapacidad, acreditando un grado de discapacidad del 45 % por hipoacusia neurosensorial bilateral severa, reconocido por el Centro Base n.º 5 de la Comunidad de Madrid.

SEGUNDA.- El tribunal calificador n.º 12, presidido por Doña Almudena Cano Prado, le denegó la adaptación de tiempo y medios (intérprete de lengua de signos y bucle magnético) que había solicitado en tiempo y forma, adjuntando el informe audiológico emitido por el Dr. Fernando Mora Guerra.

TERCERA.- Otra aspirante, Doña Khadija Benali, sí obtuvo una adaptación equivalente en el mismo tribunal.`,
    oro: [
      ["ORGANISMO", "CONSEJERÍA DE EDUCACIÓN, CIENCIA Y UNIVERSIDADES DE LA COMUNIDAD DE MADRID"],
      ["PERSONA", "Diego Armando Villalba Ortiz"],
      ["DNI", "50987654-N"],
      ["DIRECCION", "calle Arroyo del Olivar, 45, portal 3, 2.º izda., 28018 Madrid"],
      ["TELEFONO", "634.221.908"],
      ["CORREO", "dvillalba.ortiz@gmail.com"],
      ["NORMA", "artículos 121 y 122 de la Ley 39/2015, de 1 de octubre, del Procedimiento Administrativo Común de las Administraciones Públicas"],
      ["ORGANISMO", "Dirección General de Recursos Humanos"],
      ["CAT_ESPECIAL", "turno de reserva para personas con discapacidad"],
      ["CAT_ESPECIAL", "grado de discapacidad del 45 %"],
      ["CAT_ESPECIAL", "hipoacusia neurosensorial bilateral severa"],
      ["ORGANISMO", "Centro Base n.º 5 de la Comunidad de Madrid"],
      ["PERSONA", "Almudena Cano Prado"],
      ["CAT_ESPECIAL", "intérprete de lengua de signos y bucle magnético"],
      ["CAT_ESPECIAL", "informe audiológico"],
      ["PERSONA", "Fernando Mora Guerra"],
      ["PERSONA", "Khadija Benali"],
    ],
  },
  {
    id: 'd-lista-admitidos-policia-local',
    fuente: 'Lista provisional de admitidos y excluidos, oposición a Policía Local (Ourense)',
    clase: 'nativo',
    texto: `AYUNTAMIENTO DE OURENSE
Proceso selectivo para la provisión de 6 plazas de Policía Local, turno libre (OEP 2025)

LISTA PROVISIONAL DE ASPIRANTES ADMITIDOS Y EXCLUIDOS

Admitidos:
1. ÁLVAREZ SOUTO, Brais — ***4521**
2. CASTRO LOUREIRO, Uxía — ***8830**
3. DOVAL PAZOS, Xoán Manuel — ***1276**
4. FERNÁNDEZ DE LA TORRE, Ana Belén — ***0093**
5. NDIAYE DIOP, Mamadou — ***7714**
6. PETRENKO, Oksana — ****3361*
7. REY BOUZAS, Antía — ***5502**

Excluidos:
8. SANTOS NOVOA, Iago — ***6649** — Causa: no aporta el permiso de conducción de la clase A2.
9. WANG, Li Na — ****2208* — Causa: falta justificante del abono de la tasa.

Los aspirantes excluidos disponen de diez días hábiles para subsanar, conforme al artículo 68 de la Ley 39/2015.

Ourense, 22 de septiembre de 2026. O alcalde, P.D., a concelleira delegada de Persoal, Sabela Iglesias Portela.`,
    oro: [
      ["ORGANISMO", "AYUNTAMIENTO DE OURENSE"],
      ["PERSONA", "ÁLVAREZ SOUTO, Brais"],
      ["DNI", "***4521**"],
      ["PERSONA", "CASTRO LOUREIRO, Uxía"],
      ["DNI", "***8830**"],
      ["PERSONA", "DOVAL PAZOS, Xoán Manuel"],
      ["DNI", "***1276**"],
      ["PERSONA", "FERNÁNDEZ DE LA TORRE, Ana Belén"],
      ["DNI", "***0093**"],
      ["PERSONA", "NDIAYE DIOP, Mamadou"],
      ["DNI", "***7714**"],
      ["PERSONA", "PETRENKO, Oksana"],
      ["NIE", "****3361*"],
      ["PERSONA", "REY BOUZAS, Antía"],
      ["DNI", "***5502**"],
      ["PERSONA", "SANTOS NOVOA, Iago"],
      ["DNI", "***6649**"],
      ["PERSONA", "WANG, Li Na"],
      ["NIE", "****2208*"],
      ["NORMA", "artículo 68 de la Ley 39/2015"],
      ["PERSONA", "Sabela Iglesias Portela"],
    ],
  },
  {
    id: 'd-reclamacion-patrimonial-sanitaria',
    fuente: 'Reclamación de responsabilidad patrimonial sanitaria al SAS por apendicitis no diagnosticada',
    clase: 'nativo',
    texto: `AL SERVICIO ANDALUZ DE SALUD — DIRECCIÓN GERENCIA

RECLAMACIÓN DE RESPONSABILIDAD PATRIMONIAL

Doña Rocío Moreno Blanco, con DNI 28765432-E, actuando en su propio nombre y en el de su hijo menor de edad, Hugo, y con domicilio en Barriada Nuestra Señora del Carmen, bloque 4, portal B, 1.º C, 41020 Sevilla, formula reclamación de responsabilidad patrimonial al amparo de los artículos 32 y siguientes de la Ley 40/2015, de Régimen Jurídico del Sector Público, por los daños derivados de la asistencia prestada en el Hospital Universitario Virgen del Rocío.

HECHOS

1.- El 14 de febrero de 2026 el menor Hugo Sánchez Moreno, de 7 años, acudió a urgencias con dolor abdominal en fosa ilíaca derecha y fiebre de 38,9 ºC. Fue dado de alta con el diagnóstico de gastroenteritis aguda por la Dra. Beatriz Guerrero Lozano.

2.- Dos días después reingresó con una apendicitis aguda perforada con peritonitis difusa, que obligó a una laparotomía y a 11 días de ingreso en la UCI pediátrica.

3.- Se acompañan la historia clínica completa, el informe de alta de cirugía pediátrica y el informe pericial del Dr. Rafael Toledo Campos, especialista en Cirugía General.

Se solicita una indemnización de 62.000 euros, a ingresar en la cuenta ES73 0182 5566 7101 2345 6789.`,
    oro: [
      ["ORGANISMO", "SERVICIO ANDALUZ DE SALUD"],
      ["PERSONA", "Rocío Moreno Blanco"],
      ["DNI", "28765432-E"],
      ["PERSONA", "Hugo"],
      ["DIRECCION", "Barriada Nuestra Señora del Carmen, bloque 4, portal B, 1.º C, 41020 Sevilla"],
      ["NORMA", "artículos 32 y siguientes de la Ley 40/2015, de Régimen Jurídico del Sector Público"],
      ["ORGANISMO", "Hospital Universitario Virgen del Rocío"],
      ["PERSONA", "Hugo Sánchez Moreno"],
      ["CAT_ESPECIAL", "dolor abdominal en fosa ilíaca derecha y fiebre de 38,9 ºC"],
      ["CAT_ESPECIAL", "gastroenteritis aguda"],
      ["PERSONA", "Beatriz Guerrero Lozano"],
      ["CAT_ESPECIAL", "apendicitis aguda perforada con peritonitis difusa"],
      ["CAT_ESPECIAL", "laparotomía"],
      ["CAT_ESPECIAL", "11 días de ingreso en la UCI pediátrica"],
      ["CAT_ESPECIAL", "historia clínica"],
      ["CAT_ESPECIAL", "informe de alta de cirugía pediátrica"],
      ["PERSONA", "Rafael Toledo Campos"],
      ["IBAN", "ES73 0182 5566 7101 2345 6789"],
    ],
  },
  {
    id: 'd-informe-urgencias-ocr',
    fuente: 'Informe de alta de urgencias escaneado (Santiago de Compostela)',
    clase: 'ocr',
    texto: `HOSPITAL CLINICO UNIVERSITARIO DE SANTIAGO - SERVIZO DE URXENCIAS
INFORME DE ALTA DE URGENCIAS
PACIENTE: FERREIRO BARREIRO, MANUEL ANXO
DNI: 33287654F   NUSS: 15/0987654354   F. NAC: 12/03/1958
DOMICILIO: RUA DO HORREO 61 4 ESQ 15702 SANTIAGO DE COMPOSTELA
TELF CONTACTO: 981 58 62 14 (HIJA: NOELIA FERREIRO)
MOTIVO DE CONSULTA: DOLOR TORACICO OPRESIVO DE 2 HORAS DE EVOLUCION
ANTECEDENTES: HTA. DIABETES MELLITUS TIPO 2 EN TRATAMIENTO CON METFORMINA 850 MG. EXFUMADOR. VIH POSITIVO EN SEGUIMIENTO POR INFECCIOSAS.
JUICIO CLINICO: SINDROME CORONARIO AGUDO SIN ELEVACION DEL ST
PLAN: INGRESO EN CARDIOLOGIA. SE SOLICITA CATETERISMO.
MEDICO RESPONSABLE: DR. XABIER OTERO LAGO`,
    oro: [
      ["ORGANISMO", "HOSPITAL CLINICO UNIVERSITARIO DE SANTIAGO"],
      ["CAT_ESPECIAL", "INFORME DE ALTA DE URGENCIAS"],
      ["PERSONA", "FERREIRO BARREIRO, MANUEL ANXO"],
      ["DNI", "33287654F"],
      ["NUSS", "15/0987654354"],
      ["DIRECCION", "RUA DO HORREO 61 4 ESQ 15702 SANTIAGO DE COMPOSTELA"],
      ["TELEFONO", "981 58 62 14"],
      ["PERSONA", "NOELIA FERREIRO"],
      ["CAT_ESPECIAL", "DOLOR TORACICO OPRESIVO DE 2 HORAS DE EVOLUCION"],
      ["CAT_ESPECIAL", "HTA"],
      ["CAT_ESPECIAL", "DIABETES MELLITUS TIPO 2"],
      ["CAT_ESPECIAL", "METFORMINA 850 MG"],
      ["CAT_ESPECIAL", "EXFUMADOR"],
      ["CAT_ESPECIAL", "VIH POSITIVO EN SEGUIMIENTO POR INFECCIOSAS"],
      ["CAT_ESPECIAL", "SINDROME CORONARIO AGUDO SIN ELEVACION DEL ST"],
      ["CAT_ESPECIAL", "INGRESO EN CARDIOLOGIA"],
      ["CAT_ESPECIAL", "CATETERISMO"],
      ["PERSONA", "XABIER OTERO LAGO"],
    ],
  },
  {
    id: 'd-desamparo-menores',
    fuente: 'Resolución de desamparo y asunción de tutela (Generalitat Valenciana)',
    clase: 'nativo',
    texto: `GENERALITAT VALENCIANA
CONSELLERIA DE SERVICIOS SOCIALES, IGUALDAD Y VIVIENDA
Dirección Territorial de Castellón — Sección de Protección de Menores
Expediente de protección n.º 12/0456/2026

RESOLUCIÓN DE DECLARACIÓN DE DESAMPARO Y ASUNCIÓN DE TUTELA

Vista la propuesta de la Comisión Técnica de Protección y el informe de los servicios sociales municipales de Vila-real, elaborado por la educadora social Mireia Vicent Llorens, resultan los siguientes hechos:

1. Los menores Aleix (9 años) y Júlia (4 años) Borràs Querol conviven con su madre, Montserrat Querol Ibáñez, en la vivienda sita en carrer de Sant Pasqual, 37, porta 5, 12540 Vila-real.

2. La madre presenta un trastorno por consumo de cocaína y alcohol, con varios ingresos en la Unidad de Conductas Adictivas, y ha abandonado el tratamiento con metadona. El padre, Jordi Borràs Mas, se encuentra interno en el Centro Penitenciario de Castellón II cumpliendo condena.

3. El centro escolar comunica absentismo reiterado de Aleix y signos de desnutrición en la menor.

4. La abuela materna, Doña Amparo Ibáñez Gil, con teléfono 964 52 11 30, se ha ofrecido como familia extensa acogedora.

Por todo ello, de conformidad con el artículo 172 del Código Civil y la Ley 26/2018, de 21 de diciembre, de derechos y garantías de la infancia y la adolescencia de la Comunitat Valenciana, RESUELVO declarar la situación de desamparo de ambos menores y asumir su tutela.`,
    oro: [
      ["ORGANISMO", "CONSELLERIA DE SERVICIOS SOCIALES, IGUALDAD Y VIVIENDA"],
      ["AUTOS", "Expediente de protección n.º 12/0456/2026"],
      ["PERSONA", "Mireia Vicent Llorens"],
      ["PERSONA", "Aleix"],
      ["PERSONA", "Júlia"],
      ["PERSONA", "Borràs Querol"],
      ["PERSONA", "Montserrat Querol Ibáñez"],
      ["DIRECCION", "carrer de Sant Pasqual, 37, porta 5, 12540 Vila-real"],
      ["OBJETO", "trastorno por consumo de cocaína y alcohol"],
      ["CAT_ESPECIAL", "varios ingresos en la Unidad de Conductas Adictivas"],
      ["CAT_ESPECIAL", "metadona"],
      ["PERSONA", "Jordi Borràs Mas"],
      ["DATO_PENAL", "interno en el Centro Penitenciario de Castellón II cumpliendo condena"],
      ["CAT_ESPECIAL", "signos de desnutrición"],
      ["PERSONA", "Amparo Ibáñez Gil"],
      ["TELEFONO", "964 52 11 30"],
      ["NORMA", "artículo 172 del Código Civil"],
      ["NORMA", "Ley 26/2018, de 21 de diciembre, de derechos y garantías de la infancia y la adolescencia de la Comunitat Valenciana"],
    ],
  },
  {
    id: 'd-apoyos-solicitud',
    fuente: 'Solicitud de provisión de medidas judiciales de apoyo (Burgos)',
    clase: 'nativo',
    expediente: 'exp-apoyos-burgos',
    texto: `AL TRIBUNAL DE INSTANCIA DE BURGOS, SECCIÓN CIVIL, PLAZA N.º 5

Doña Teresa Iglesias López, mayor de edad, con DNI 13145678-M, domiciliada en calle Vitoria, 176, escalera izquierda, 5.º A, 09007 Burgos, representada por el Procurador Don Álvaro Santamaría Peña y asistida por la Letrada Doña Begoña Arnáiz Ruiz, promueve EXPEDIENTE DE JURISDICCIÓN VOLUNTARIA DE PROVISIÓN DE MEDIDAS JUDICIALES DE APOYO a favor de su padre, DON RAMÓN IGLESIAS CANO, con DNI 13002211-N, conforme a los artículos 42 bis a) y siguientes de la Ley 15/2015, de la Jurisdicción Voluntaria, y 249 y siguientes del Código Civil.

HECHOS

PRIMERO.- Don Ramón, de 81 años, viudo desde que falleció su esposa, Doña Mercedes López de Iglesias, en 2024, padece una enfermedad de Alzheimer en fase moderada (GDS 5), diagnosticada en el Hospital Universitario de Burgos, según el informe neurológico que se acompaña como documento n.º 2.

SEGUNDO.- Reside en su domicilio de la calle San Pedro de Cardeña, 30, 1.º, 09002 Burgos, con la ayuda de una cuidadora, Doña Maricel Dela Cruz Bautista.

TERCERO.- Su otro hijo, Don Pablo Iglesias López, residente en Bilbao, está conforme con que sea la promotora quien preste el apoyo. Pablo ha manifestado, no obstante, que desea participar en las decisiones patrimoniales.`,
    oro: [
      ["ORGANO", "TRIBUNAL DE INSTANCIA DE BURGOS, SECCIÓN CIVIL, PLAZA N.º 5"],
      ["PERSONA", "Teresa Iglesias López"],
      ["DNI", "13145678-M"],
      ["DIRECCION", "calle Vitoria, 176, escalera izquierda, 5.º A, 09007 Burgos"],
      ["PERSONA", "Álvaro Santamaría Peña"],
      ["PERSONA", "Begoña Arnáiz Ruiz"],
      ["PERSONA", "RAMÓN IGLESIAS CANO"],
      ["DNI", "13002211-N"],
      ["NORMA", "artículos 42 bis a) y siguientes de la Ley 15/2015, de la Jurisdicción Voluntaria"],
      ["NORMA", "249 y siguientes del Código Civil"],
      ["PERSONA", "Ramón"],
      ["PERSONA", "Mercedes López de Iglesias"],
      ["CAT_ESPECIAL", "enfermedad de Alzheimer en fase moderada (GDS 5)"],
      ["ORGANISMO", "Hospital Universitario de Burgos"],
      ["CAT_ESPECIAL", "informe neurológico"],
      ["DIRECCION", "calle San Pedro de Cardeña, 30, 1.º, 09002 Burgos"],
      ["PERSONA", "Maricel Dela Cruz Bautista"],
      ["PERSONA", "Pablo Iglesias López"],
      ["PERSONA", "Pablo"],
    ],
  },
  {
    id: 'd-apoyos-informe-forense-ocr',
    fuente: 'Informe médico forense escaneado en el expediente de apoyos',
    clase: 'ocr',
    expediente: 'exp-apoyos-burgos',
    texto: `INSTITUTO DE MEDICINA LEGAL Y CIENCIAS FORENSES DE BURGOS
INFORME MEDICO FORENSE
PROCEDIMIENTO: JURISDICCION VOLUNTARIA 1422/2026 - TRIBUNAL DE INSTANCIA DE BURGOS, SECCION CIVIL, PLAZA 5
INFORMADO: RAMON IGLESIAS CANO
RECONOCIMIENTO REALIZADO EL 02/09/2026 EN SU DOMICILIO, EN PRESENCIA DE SU HIJA TERESA Y DE LA CUIDADORA.
EL SR. IGLESIAS SE MUESTRA COLABORADOR PERO DESORIENTADO EN TIEMPO Y ESPACIO. MINI-MENTAL: 16/30. PRESENTA DETERIORO COGNITIVO MODERADO COMPATIBLE CON DEMENCIA TIPO ALZHEIMER. TOMA DONEPEZILO 10 MG Y QUETIAPINA 25 MG POR LA NOCHE.
CONSERVA CAPACIDAD PARA EXPRESAR PREFERENCIAS BASICAS: DESEA SEGUIR EN SU CASA Y QUE LE AYUDE TERESA. MANIFIESTA DESCONFIANZA HACIA SU HIJO PABLO.
CONCLUSION: PRECISA APOYO DE CARACTER REPRESENTATIVO PARA LA GESTION PATRIMONIAL Y DE SALUD.
LA MEDICO FORENSE: DRA. ARANTZA URIARTE ECHEVARRIA`,
    oro: [
      ["ORGANISMO", "INSTITUTO DE MEDICINA LEGAL Y CIENCIAS FORENSES DE BURGOS"],
      ["CAT_ESPECIAL", "INFORME MEDICO FORENSE"],
      ["AUTOS", "JURISDICCION VOLUNTARIA 1422/2026"],
      ["ORGANO", "TRIBUNAL DE INSTANCIA DE BURGOS, SECCION CIVIL, PLAZA 5"],
      ["PERSONA", "RAMON IGLESIAS CANO"],
      ["PERSONA", "TERESA"],
      ["PERSONA", "IGLESIAS"],
      ["CAT_ESPECIAL", "DESORIENTADO EN TIEMPO Y ESPACIO"],
      ["CAT_ESPECIAL", "MINI-MENTAL: 16/30"],
      ["CAT_ESPECIAL", "DETERIORO COGNITIVO MODERADO COMPATIBLE CON DEMENCIA TIPO ALZHEIMER"],
      ["CAT_ESPECIAL", "DONEPEZILO 10 MG"],
      ["CAT_ESPECIAL", "QUETIAPINA 25 MG"],
      ["PERSONA", "PABLO"],
      ["PERSONA", "ARANTZA URIARTE ECHEVARRIA"],
    ],
    ambiguo: ['IGLESIAS'],
  },
  {
    id: 'd-apoyos-auto-curatela',
    fuente: 'Auto de provisión de apoyos con nombramiento de curadora',
    clase: 'nativo',
    expediente: 'exp-apoyos-burgos',
    texto: `TRIBUNAL DE INSTANCIA DE BURGOS
SECCIÓN CIVIL — PLAZA N.º 5
Expediente de provisión de apoyos n.º 1422/2026

AUTO N.º 311/2026

Magistrado-Juez: Ilmo. Sr. D. Gonzalo Pérez-Tabernero Sáez
En Burgos, a 24 de septiembre de 2026.

RAZONAMIENTOS JURÍDICOS

PRIMERO.- De la exploración judicial y del informe médico forense resulta que Don Ramón Iglesias precisa apoyos para la administración de su patrimonio y para las decisiones sobre su salud. El art. 250 CC y la STS 589/2021, de 8 de septiembre (ECLI:ES:TS:2021:3276), exigen respetar la voluntad, deseos y preferencias de la persona.

SEGUNDO.- La desconfianza que el Sr. Iglesias expresa hacia su hijo Pablo, y la buena relación con Teresa, aconsejan designar a esta como curadora representativa. Pablo Iglesias será informado trimestralmente de la gestión.

PARTE DISPOSITIVA: Se nombra curadora a Doña Teresa Iglesias López, con las facultades que se detallan. Se fija como domicilio de la persona con apoyo la calle San Pedro de Cardeña, 30, 1.º, 09002 Burgos.

Contra este auto cabe recurso de apelación ante la Audiencia Provincial de Burgos.

Lo acuerda y firma el Magistrado. Ante mí, el Letrado de la Administración de Justicia, Don Eusebio Garrido Mata, doy fe.`,
    oro: [
      ["ORGANO", "TRIBUNAL DE INSTANCIA DE BURGOS"],
      ["AUTOS", "Expediente de provisión de apoyos n.º 1422/2026"],
      ["PONENTE", "Gonzalo Pérez-Tabernero Sáez"],
      ["CAT_ESPECIAL", "informe médico forense"],
      ["PERSONA", "Ramón Iglesias"],
      ["NORMA", "art. 250 CC"],
      ["NORMA", "STS 589/2021, de 8 de septiembre"],
      ["ECLI", "ECLI:ES:TS:2021:3276"],
      ["PERSONA", "Iglesias"],
      ["PERSONA", "Pablo"],
      ["PERSONA", "Teresa"],
      ["PERSONA", "Pablo Iglesias"],
      ["PERSONA", "Teresa Iglesias López"],
      ["DIRECCION", "calle San Pedro de Cardeña, 30, 1.º, 09002 Burgos"],
      ["ORGANO", "Audiencia Provincial de Burgos"],
      ["LAJ", "Eusebio Garrido Mata"],
    ],
    ambiguo: ['Iglesias'],
  },
  {
    id: 'd-testamento-abierto',
    fuente: 'Testamento abierto notarial (Sabadell)',
    clase: 'nativo',
    expediente: 'exp-herencia-sabadell',
    texto: `NÚMERO MIL DOSCIENTOS CUARENTA Y TRES.
TESTAMENTO ABIERTO.
En Sabadell, mi residencia, a diez de marzo de dos mil veintidós.
Ante mí, JOSEP MARIA VILASECA I ROIG, Notario del Ilustre Colegio Notarial de Cataluña,
COMPARECE:
DOÑA NÚRIA PUIGDOMÈNECH FERRER, mayor de edad, viuda, vecina de Sabadell, con domicilio en Carrer de la Indústria, 48, 2n 1a, 08202 Sabadell, y con DNI 38123987-S.
Tiene, a mi juicio, la capacidad legal necesaria para otorgar este testamento, sin que obste a ello que se encuentre en tratamiento oncológico por un carcinoma ductal infiltrante de mama.
DISPOSICIONES:
PRIMERA.- Lega a su nieta, CARLOTA SOLER VIDAL, menor de edad, la plaza de aparcamiento número 14 del edificio sito en Rambla de Sabadell, 102, 08201 Sabadell.
SEGUNDA.- Instituye herederos universales, por partes iguales, a sus hijos, MARC y LAIA SOLER PUIGDOMÈNECH, sustituidos vulgarmente por sus descendientes.
TERCERA.- Nombra albacea a su amiga DOÑA ROSER CASTELLS BOSCH.
Leído por mí el presente testamento, conforme a los artículos 421-1 y siguientes del Codi civil de Catalunya, la testadora lo aprueba y firma.`,
    oro: [
      ["PERSONA", "JOSEP MARIA VILASECA I ROIG"],
      ["ORGANISMO", "Ilustre Colegio Notarial de Cataluña"],
      ["PERSONA", "NÚRIA PUIGDOMÈNECH FERRER"],
      ["DIRECCION", "Carrer de la Indústria, 48, 2n 1a, 08202 Sabadell"],
      ["DNI", "38123987-S"],
      ["CAT_ESPECIAL", "tratamiento oncológico"],
      ["CAT_ESPECIAL", "carcinoma ductal infiltrante de mama"],
      ["PERSONA", "CARLOTA SOLER VIDAL"],
      ["DIRECCION", "Rambla de Sabadell, 102, 08201 Sabadell"],
      ["PERSONA", "MARC"],
      ["PERSONA", "LAIA SOLER PUIGDOMÈNECH"],
      ["PERSONA", "ROSER CASTELLS BOSCH"],
      ["NORMA", "artículos 421-1 y siguientes del Codi civil de Catalunya"],
    ],
  },
  {
    id: 'd-aceptacion-herencia',
    fuente: 'Escritura de aceptación y adjudicación de herencia (mismo asunto)',
    clase: 'nativo',
    expediente: 'exp-herencia-sabadell',
    texto: `ESCRITURA DE ACEPTACIÓN Y ADJUDICACIÓN DE HERENCIA
En Sabadell, a 2 de septiembre de 2026, ante mí, MERITXELL CODINA PRAT, Notaria del Ilustre Colegio Notarial de Cataluña,
COMPARECEN:
DON MARC SOLER PUIGDOMÈNECH, con DNI 38987001-T, domiciliado en Avinguda de Matadepera, 211, casa 3, 08207 Sabadell.
DOÑA LAIA SOLER PUIGDOMÈNECH, con DNI 38987002-R, domiciliada en 14 Harcourt Road, Flat 2, Bristol BS6 7RD (Reino Unido), representada por su esposo DON THOMAS EDWARD WHITFIELD.
EXPONEN:
I.- Que DOÑA NÚRIA PUIGDOMÈNECH FERRER falleció en Sabadell el 18 de mayo de 2026, según certificado de defunción en el que consta como causa metástasis hepática.
II.- Que falleció bajo el testamento otorgado ante el Notario de Sabadell Don Josep Maria Vilaseca i Roig el 10 de marzo de 2022, número 1.243 de protocolo, según certificado del Registro General de Actos de Última Voluntad.
III.- Que el caudal relicto incluye el saldo de la cuenta ES07 0081 0200 1100 0123 4567 y la vivienda sita en Carrer de la Indústria, 48, 2n 1a, 08202 Sabadell, finca registral 45.112 del Registro de la Propiedad n.º 2 de Sabadell.
IV.- Que la legataria, la menor Carlota, está representada por su madre, Doña Elena Vidal Montoya.`,
    oro: [
      ["PERSONA", "MERITXELL CODINA PRAT"],
      ["ORGANISMO", "Ilustre Colegio Notarial de Cataluña"],
      ["PERSONA", "MARC SOLER PUIGDOMÈNECH"],
      ["DNI", "38987001-T"],
      ["DIRECCION", "Avinguda de Matadepera, 211, casa 3, 08207 Sabadell"],
      ["PERSONA", "LAIA SOLER PUIGDOMÈNECH"],
      ["DNI", "38987002-R"],
      ["DIRECCION", "14 Harcourt Road, Flat 2, Bristol BS6 7RD"],
      ["PERSONA", "THOMAS EDWARD WHITFIELD"],
      ["PERSONA", "NÚRIA PUIGDOMÈNECH FERRER"],
      ["CAT_ESPECIAL", "metástasis hepática"],
      ["PERSONA", "Josep Maria Vilaseca i Roig"],
      ["ORGANISMO", "Registro General de Actos de Última Voluntad"],
      ["IBAN", "ES07 0081 0200 1100 0123 4567"],
      ["DIRECCION", "Carrer de la Indústria, 48, 2n 1a, 08202 Sabadell"],
      ["ORGANISMO", "Registro de la Propiedad n.º 2 de Sabadell"],
      ["PERSONA", "Carlota"],
      ["PERSONA", "Elena Vidal Montoya"],
    ],
  },
  {
    id: 'd-correo-herencia-cliente',
    fuente: 'Correo del heredero a su abogada (castellano con catalán)',
    clase: 'correo',
    expediente: 'exp-herencia-sabadell',
    texto: `De: Marc Soler <marc.soler.p@gmail.com>
Para: Gemma Roca <groca@rocaiadvocats.cat>
CC: laia.soler@outlook.com
Asunto: RE: Herència de la mama - plusvàlua

Hola Gemma,

Te confirmo que la Laia firmará a través de Thomas, ya tenemos el poder apostillado. Sobre la plusvalía, el Ajuntament de Sabadell nos ha mandado la liquidación a mi dirección y no a la del piso de mamá.

Otra cosa: Carlota cumple 16 en diciembre y Elena pregunta si hace falta autorización judicial para vender la plaza de parking que le dejó la iaia.

Llámame cuando puedas al 657 30 91 22, que por la mañana estoy en el hospital con lo de la diálisis.

Gràcies,
Marc

--
Gemma Roca i Farré
Roca i Associats Advocats
Passeig de Gràcia, 77, principal 2a, 08008 Barcelona
T. 93 487 22 10`,
    oro: [
      ["PERSONA", "Marc Soler"],
      ["CORREO", "marc.soler.p@gmail.com"],
      ["PERSONA", "Gemma Roca"],
      ["CORREO", "groca@rocaiadvocats.cat"],
      ["CORREO", "laia.soler@outlook.com"],
      ["PERSONA", "Gemma"],
      ["PERSONA", "Laia"],
      ["PERSONA", "Thomas"],
      ["ORGANISMO", "Ajuntament de Sabadell"],
      ["PERSONA", "Carlota"],
      ["PERSONA", "Elena"],
      ["TELEFONO", "657 30 91 22"],
      ["CAT_ESPECIAL", "diálisis"],
      ["PERSONA", "Marc"],
      ["PERSONA", "Gemma Roca i Farré"],
      ["DIRECCION", "Passeig de Gràcia, 77, principal 2a, 08008 Barcelona"],
      ["TELEFONO", "93 487 22 10"],
    ],
  },
  {
    id: 'd-escritura-prestamo-hipotecario',
    fuente: 'Escritura de préstamo hipotecario con fiadores (Murcia)',
    clase: 'nativo',
    texto: `ESCRITURA DE PRÉSTAMO CON GARANTÍA HIPOTECARIA
NÚMERO 2.118
En Murcia, a 15 de abril de 2026. Ante mí, ENCARNACIÓN MARTÍNEZ-ABELLÁN BELMONTE, Notaria del Ilustre Colegio Notarial de Murcia.
COMPARECEN:
De una parte, como PRESTAMISTA, DON FRANCISCO JAVIER GUERRA SÁNCHEZ, en nombre y representación de CAJA RURAL DEL SEGURA, SOCIEDAD COOPERATIVA DE CRÉDITO, con CIF F30112239, según poder que me exhibe.
De otra, como PRESTATARIOS, los cónyuges DON ANDRÉS FELIPE CARDONA RESTREPO, con NIE Y-2345678-Z, y DOÑA YESENIA PATRICIA MOSQUERA LOZANO, con NIE Y-3456789-H, ambos con domicilio en Carretera de El Palmar, km 4,2, casa 11, 30120 El Palmar (Murcia), y teléfono (+34) 868 012 345.
Intervienen como fiadores solidarios los padres de la prestataria, DON EDGAR MOSQUERA y DOÑA GLADYS LOZANO DE MOSQUERA.
ESTIPULACIONES: Capital de 148.000 euros, con cargo de las cuotas en la cuenta ES81 3058 0301 2127 3000 4455. La finca hipotecada es la vivienda sita en calle Mayor, 12, planta 1.ª, puerta 2, 30120 El Palmar, finca registral 22.418 del Registro de la Propiedad de Murcia n.º 6.
La prestataria manifiesta que ha contratado el seguro de vida vinculado, habiendo declarado en el cuestionario de salud padecer lupus eritematoso sistémico.
Se hace constar que se ha cumplido lo dispuesto en la Ley 5/2019, de 16 de marzo, reguladora de los contratos de crédito inmobiliario, habiéndose levantado el acta de transparencia previa.`,
    oro: [
      ["PERSONA", "ENCARNACIÓN MARTÍNEZ-ABELLÁN BELMONTE"],
      ["ORGANISMO", "Ilustre Colegio Notarial de Murcia"],
      ["PERSONA", "FRANCISCO JAVIER GUERRA SÁNCHEZ"],
      ["CIF", "F30112239"],
      ["PERSONA", "ANDRÉS FELIPE CARDONA RESTREPO"],
      ["NIE", "Y-2345678-Z"],
      ["PERSONA", "YESENIA PATRICIA MOSQUERA LOZANO"],
      ["NIE", "Y-3456789-H"],
      ["DIRECCION", "Carretera de El Palmar, km 4,2, casa 11, 30120 El Palmar"],
      ["TELEFONO", "(+34) 868 012 345"],
      ["PERSONA", "EDGAR MOSQUERA"],
      ["PERSONA", "GLADYS LOZANO DE MOSQUERA"],
      ["IBAN", "ES81 3058 0301 2127 3000 4455"],
      ["DIRECCION", "calle Mayor, 12, planta 1.ª, puerta 2, 30120 El Palmar"],
      ["ORGANISMO", "Registro de la Propiedad de Murcia n.º 6"],
      ["CAT_ESPECIAL", "cuestionario de salud"],
      ["CAT_ESPECIAL", "lupus eritematoso sistémico"],
      ["NORMA", "Ley 5/2019, de 16 de marzo, reguladora de los contratos de crédito inmobiliario"],
    ],
  },
  {
    id: 'd-arrendamiento-contrato',
    fuente: 'Contrato de arrendamiento de vivienda (Zaragoza)',
    clase: 'nativo',
    expediente: 'exp-alquiler-delicias',
    texto: `CONTRATO DE ARRENDAMIENTO DE VIVIENDA
En Zaragoza, a 1 de septiembre de 2024.
REUNIDOS
De una parte, DOÑA PILAR BRAVO MORENO, mayor de edad, con DNI 17234567-T, con domicilio en Paseo de Sagasta, 40, 6.º dcha., 50006 Zaragoza (en adelante, LA ARRENDADORA).
De otra, DON SERGIU POPESCU, con NIE X-9876543-K, y DOÑA IOANA POPESCU, con NIE X-9876544-E, ambos mayores de edad (en adelante, LOS ARRENDATARIOS).
EXPONEN
I.- Que la arrendadora es propietaria de la vivienda sita en calle Delicias, 88, bloque 2, escalera B, 3.º izquierda, 50017 Zaragoza.
CLÁUSULAS
PRIMERA.- Duración: cinco años, conforme al artículo 9 de la Ley 29/1994, de 24 de noviembre, de Arrendamientos Urbanos.
SEGUNDA.- Renta: 750 euros mensuales, a ingresar en la cuenta ES70 2085 0100 7803 3012 3456.
TERCERA.- Los arrendatarios declaran que en la vivienda residirá también su hijo menor, Andrei, que tiene reconocido un 65 % de discapacidad por parálisis cerebral, por lo que la arrendadora autoriza las adaptaciones de accesibilidad necesarias.
CUARTA.- Fianza: una mensualidad, que se depositará en el Gobierno de Aragón.
Notificaciones: arrendadora, pilarbravo58@hotmail.com; arrendatarios, 722 45 61 03.`,
    oro: [
      ["PERSONA", "PILAR BRAVO MORENO"],
      ["DNI", "17234567-T"],
      ["DIRECCION", "Paseo de Sagasta, 40, 6.º dcha., 50006 Zaragoza"],
      ["PERSONA", "SERGIU POPESCU"],
      ["NIE", "X-9876543-K"],
      ["PERSONA", "IOANA POPESCU"],
      ["NIE", "X-9876544-E"],
      ["DIRECCION", "calle Delicias, 88, bloque 2, escalera B, 3.º izquierda, 50017 Zaragoza"],
      ["NORMA", "artículo 9 de la Ley 29/1994, de 24 de noviembre, de Arrendamientos Urbanos"],
      ["IBAN", "ES70 2085 0100 7803 3012 3456"],
      ["PERSONA", "Andrei"],
      ["CAT_ESPECIAL", "65 % de discapacidad"],
      ["CAT_ESPECIAL", "parálisis cerebral"],
      ["ORGANISMO", "Gobierno de Aragón"],
      ["CORREO", "pilarbravo58@hotmail.com"],
      ["TELEFONO", "722 45 61 03"],
    ],
  },
  {
    id: 'd-arrendamiento-burofax',
    fuente: 'Burofax de requerimiento de pago de rentas',
    clase: 'nativo',
    expediente: 'exp-alquiler-delicias',
    texto: `BUROFAX CON ACUSE DE RECIBO Y CERTIFICACIÓN DE CONTENIDO
Remitente: Luis Moreno Ester, abogado, en nombre de Doña Pilar Bravo Moreno. C/ Coso, 67, entresuelo, 50001 Zaragoza.
Destinatarios: D. Sergiu Popescu y D.ª Ioana Popescu. C/ Delicias, 88, bl. 2, esc. B, 3.º izda., 50017 Zaragoza.

Muy Sres. míos:
Por la presente les requiero, en nombre de la Sra. Bravo, para que en el plazo de diez días abonen las rentas de marzo a junio de 2026, que ascienden a 3.000 euros, con la advertencia de que en caso contrario se interpondrá demanda de desahucio por falta de pago y reclamación de rentas, conforme al artículo 27.2.a) LAU y al artículo 22.4 LEC.
Tengo conocimiento de que el Sr. Popescu ha perdido su empleo tras ser despedido siendo delegado sindical de CCOO, pero ello no le exime del pago.
Atentamente,
Luis Moreno`,
    oro: [
      ["PERSONA", "Luis Moreno Ester"],
      ["PERSONA", "Pilar Bravo Moreno"],
      ["DIRECCION", "C/ Coso, 67, entresuelo, 50001 Zaragoza"],
      ["PERSONA", "Sergiu Popescu"],
      ["PERSONA", "Ioana Popescu"],
      ["DIRECCION", "C/ Delicias, 88, bl. 2, esc. B, 3.º izda., 50017 Zaragoza"],
      ["PERSONA", "Bravo"],
      ["NORMA", "artículo 27.2.a) LAU"],
      ["NORMA", "artículo 22.4 LEC"],
      ["PERSONA", "Popescu"],
      ["CAT_ESPECIAL", "delegado sindical de CCOO"],
      ["PERSONA", "Luis Moreno"],
    ],
    ambiguo: ['Popescu', 'Moreno'],
  },
  {
    id: 'd-arrendamiento-whatsapp',
    fuente: 'Conversación de WhatsApp transcrita entre arrendadora y arrendataria',
    clase: 'correo',
    expediente: 'exp-alquiler-delicias',
    texto: `[12/07/26, 21:14] Ioana: Doña Pilar buenas noches, soy Ioana la del 3º izquierda. Sergiu está muy mal, no es excusa pero desde que le echaron bebe mucho y yo sola con Andrei no puedo
[12/07/26, 21:15] Ioana: le pagamos 1000 el viernes y el resto en agosto, se lo prometo
[12/07/26, 22:40] Pilar Bravo: Ioana yo te entiendo pero mi abogado dice que hasta que no esté todo pagado sigue adelante. Llama a Luis al 976 23 40 18
[12/07/26, 22:41] Pilar Bravo: y lo del niño ya lo hablaremos
[13/07/26, 09:02] +40 745 123 456: Buenos días señora, soy Mihai, hermano de Sergiu. Yo puedo avalar, trabajo en la Opel de Figueruelas
[13/07/26, 09:30] Pilar Bravo: Gracias Mihai. Mándeme su DNI o NIE por aquí
[13/07/26, 09:35] +40 745 123 456: X-5566778-L. Mihai Popescu Lungu`,
    oro: [
      ["PERSONA", "Ioana"],
      ["PERSONA", "Pilar"],
      ["PERSONA", "Sergiu"],
      ["CAT_ESPECIAL", "bebe mucho"],
      ["PERSONA", "Andrei"],
      ["PERSONA", "Pilar Bravo"],
      ["PERSONA", "Luis"],
      ["TELEFONO", "976 23 40 18"],
      ["TELEFONO", "+40 745 123 456"],
      ["PERSONA", "Mihai"],
      ["NIE", "X-5566778-L"],
      ["PERSONA", "Mihai Popescu Lungu"],
    ],
  },
  {
    id: 'd-arrendamiento-correo-procuradora',
    fuente: 'Correo del abogado a la procuradora encargando el desahucio',
    clase: 'correo',
    expediente: 'exp-alquiler-delicias',
    texto: `De: Luis Moreno Ester <lmoreno@morenoester-abogados.es>
Para: "Procuradora Sara Gimeno" <sgimeno@procuradoreszaragoza.com>
CC: Pilar Bravo
Fecha: 20 de julio de 2026 11:02
Asunto: Desahucio Bravo / Popescu – Delicias 88

Sara, buenos días:

Te paso la demanda de desahucio para presentar en el Tribunal de Instancia de Zaragoza, Sección Civil. La cliente es Pilar Bravo Moreno; demandados, los dos Popescu (Sergiu e Ioana). Ojo, que el hermano, Mihai, se ofrece como avalista, pero no lo metemos.

La Sra. Popescu me ha llamado llorando; según ella, Sergiu padece alcoholismo y lo están tratando en la Unidad de Atención y Seguimiento de Adicciones. No lo vamos a usar, obviamente.

Si hay enervación, que nos avisen. Un abrazo,
Luis`,
    oro: [
      ["PERSONA", "Luis Moreno Ester"],
      ["CORREO", "lmoreno@morenoester-abogados.es"],
      ["PERSONA", "Sara Gimeno"],
      ["CORREO", "sgimeno@procuradoreszaragoza.com"],
      ["PERSONA", "Pilar Bravo"],
      ["PERSONA", "Bravo"],
      ["PERSONA", "Popescu"],
      ["DIRECCION", "Delicias 88"],
      ["PERSONA", "Sara"],
      ["ORGANO", "Tribunal de Instancia de Zaragoza, Sección Civil"],
      ["PERSONA", "Pilar Bravo Moreno"],
      ["PERSONA", "Sergiu"],
      ["PERSONA", "Ioana"],
      ["PERSONA", "Mihai"],
      ["CAT_ESPECIAL", "alcoholismo"],
      ["PERSONA", "Luis"],
    ],
    ambiguo: ['Popescu'],
  },
  {
    id: 'd-acta-junta-socios',
    fuente: 'Acta de junta universal de socios con cese de administrador (Donostia)',
    clase: 'nativo',
    texto: `ACTA DE LA JUNTA GENERAL EXTRAORDINARIA Y UNIVERSAL DE SOCIOS DE «TALLERES MECÁNICOS HERMANOS ARANA, S.L.»
CIF B20456786 — Domicilio social: Polígono Industrial Belartza, Donostia / San Sebastián.
En Donostia, a 30 de junio de 2026, se reúnen en el domicilio social la totalidad de los socios:
- Don Koldo Arana Zubizarreta, titular de 1.500 participaciones (50 %).
- Doña Ainhoa Arana Zubizarreta, titular de 900 participaciones (30 %).
- Don Unai Olaizola Arana, hijo de Doña Ainhoa, titular de 600 participaciones (20 %), que asiste representado por su madre.
Actúa como Presidente Don Koldo Arana y como Secretaria Doña Ainhoa Arana.
ACUERDOS:
1.º Aprobar las cuentas anuales del ejercicio 2025.
2.º Cesar como administrador único a Don Koldo Arana Zubizarreta, a petición propia, tras su reciente diagnóstico de esclerosis lateral amiotrófica, y nombrar administradora única a Doña Ainhoa Arana Zubizarreta, con DNI 44156789-D, domiciliada en Pasealekua Zurriola, 21, 4. eskuina, 20002 Donostia.
3.º Facultar a la administradora para elevar a público los acuerdos ante el Registro Mercantil de Gipuzkoa.
Y no habiendo más asuntos, se levanta la sesión. Vº Bº El Presidente, Koldo. La Secretaria, Ainhoa.`,
    oro: [
      ["CIF", "B20456786"],
      ["PERSONA", "Koldo Arana Zubizarreta"],
      ["PERSONA", "Ainhoa Arana Zubizarreta"],
      ["PERSONA", "Unai Olaizola Arana"],
      ["PERSONA", "Ainhoa"],
      ["PERSONA", "Koldo Arana"],
      ["PERSONA", "Ainhoa Arana"],
      ["CAT_ESPECIAL", "esclerosis lateral amiotrófica"],
      ["DNI", "44156789-D"],
      ["DIRECCION", "Pasealekua Zurriola, 21, 4. eskuina, 20002 Donostia"],
      ["ORGANISMO", "Registro Mercantil de Gipuzkoa"],
      ["PERSONA", "Koldo"],
    ],
  },
  {
    id: 'd-informe-auditoria',
    fuente: 'Informe de auditoría con salvedades por operaciones vinculadas',
    clase: 'nativo',
    texto: `INFORME DE AUDITORÍA DE CUENTAS ANUALES EMITIDO POR UN AUDITOR INDEPENDIENTE
A los socios de LOGÍSTICA FRÍO LEVANTE, S.L. (CIF B98765431):
Opinión con salvedades
Hemos auditado las cuentas anuales de la Sociedad, que comprenden el balance a 31 de diciembre de 2025, la cuenta de pérdidas y ganancias y la memoria.
Fundamento de la opinión con salvedades
Durante el ejercicio, la Sociedad concedió un préstamo de 240.000 euros a su administrador, Don Vicente Ramos Beltrán, sin que conste acuerdo de la junta general conforme al artículo 190 del texto refundido de la Ley de Sociedades de Capital. Asimismo, figura una partida de 38.500 euros en concepto de «gastos de representación» abonada a la cuenta ES17 0049 1500 0512 3456 7890, titularidad de Doña Amparo Beltrán Cebrià, madre del administrador.
La responsable de administración, Doña Yolanda Martí Sanchis, nos informó de que la baja de 7 meses del director financiero, Don Hao Chen, por un trastorno de ansiedad generalizada, impidió conciliar los saldos.
Hemos llevado a cabo nuestra auditoría de conformidad con la normativa reguladora de la actividad de auditoría de cuentas vigente en España (Ley 22/2015, de 20 de julio, de Auditoría de Cuentas).
Valencia, 28 de marzo de 2026
AUDITORES DEL TURIA, S.L.P.
Joan Baptista Ferrando Llopis (ROAC 20.876)`,
    oro: [
      ["CIF", "B98765431"],
      ["PERSONA", "Vicente Ramos Beltrán"],
      ["NORMA", "artículo 190 del texto refundido de la Ley de Sociedades de Capital"],
      ["IBAN", "ES17 0049 1500 0512 3456 7890"],
      ["PERSONA", "Amparo Beltrán Cebrià"],
      ["PERSONA", "Yolanda Martí Sanchis"],
      ["CAT_ESPECIAL", "baja de 7 meses"],
      ["PERSONA", "Hao Chen"],
      ["CAT_ESPECIAL", "trastorno de ansiedad generalizada"],
      ["NORMA", "Ley 22/2015, de 20 de julio, de Auditoría de Cuentas"],
      ["PERSONA", "Joan Baptista Ferrando Llopis"],
    ],
  },
  {
    id: 'd-requerimiento-notarial',
    fuente: 'Acta notarial de requerimiento sobre servidumbre (Mallorca)',
    clase: 'nativo',
    texto: `ACTA DE REQUERIMIENTO
NÚMERO 877
En Palma, a 3 de junio de 2026. Ante mí, BARTOMEU OLIVER MOREY, Notario del Ilustre Colegio Notarial de las Illes Balears,
COMPARECE: DOÑA MARGALIDA FERRAGUT CLADERA, con DNI 43098765-P, con domicilio en Camí de Son Rapinya, 55, bloc A, porta 3, 07013 Palma.
REQUIERE a mí, el Notario, para que me persone en la vivienda de DON ALISTAIR JAMES MCKENZIE, sita en Carretera de Valldemossa, km 12, Finca Son Mas, 07179 Deià, y le notifique que deberá cesar en el uso de la servidumbre de paso que viene ejerciendo sin título.
DILIGENCIA.- A las 11:20 horas me persono en el lugar indicado, donde soy atendido por una persona que dice llamarse Rosa Elvira Chuquimarca y ser empleada del hogar, la cual manifiesta que el Sr. McKenzie se encuentra ingresado en la Clínica Rotger por una cirrosis hepática y que no puede hacerse cargo de la cédula. Hago entrega de la cédula conforme al artículo 202 del Reglamento Notarial.
Contacto de la requirente: 971 76 54 32 / mferragut@icloud.com`,
    oro: [
      ["PERSONA", "BARTOMEU OLIVER MOREY"],
      ["ORGANISMO", "Ilustre Colegio Notarial de las Illes Balears"],
      ["PERSONA", "MARGALIDA FERRAGUT CLADERA"],
      ["DNI", "43098765-P"],
      ["DIRECCION", "Camí de Son Rapinya, 55, bloc A, porta 3, 07013 Palma"],
      ["PERSONA", "ALISTAIR JAMES MCKENZIE"],
      ["DIRECCION", "Carretera de Valldemossa, km 12, Finca Son Mas, 07179 Deià"],
      ["PERSONA", "Rosa Elvira Chuquimarca"],
      ["PERSONA", "McKenzie"],
      ["CAT_ESPECIAL", "ingresado"],
      ["CAT_ESPECIAL", "cirrosis hepática"],
      ["NORMA", "artículo 202 del Reglamento Notarial"],
      ["TELEFONO", "971 76 54 32"],
      ["CORREO", "mferragut@icloud.com"],
    ],
  },
  {
    id: 'd-informe-detective',
    fuente: 'Informe de detective privado sobre trabajador en incapacidad temporal (León)',
    clase: 'nativo',
    texto: `INFORME DE INVESTIGACIÓN PRIVADA
Detective: Rubén Cordero Salas, licencia n.º 2.845 (Dirección General de la Policía)
Cliente: SEGUROS ATLÁNTICO VIDA, S.A. — Siniestro 2026/IT/00455
Investigado: Don Juan Carlos Prado Mora, DNI 09876543-K, con domicilio en Avenida de la Constitución, 18, portal 2, 5.º B, 24009 León. Vehículo: Seat León matrícula 4521 KLM.

Antecedentes: el investigado se encuentra en situación de incapacidad temporal desde el 3 de marzo de 2026 por lumbalgia mecánica con irradiación a miembro inferior izquierdo, según el parte de baja aportado.

Día 14/04/2026: 08:15 h. El investigado sale de su domicilio y conduce el vehículo 4521 KLM hasta la nave de la calle Astorga, 5, de Trobajo del Camino, donde descarga sacos de cemento junto a otro varón, identificado posteriormente como su cuñado, Esteban Rey Cano.
Día 15/04/2026: 17:30 h. Asiste al gimnasio y, a la salida, acude a la parroquia evangélica de la calle Ramiro Valbuena, donde permanece dos horas.
Se adjuntan 34 fotografías y 3 vídeos. Las imágenes se obtuvieron en la vía pública, conforme a los artículos 48 y 49 de la Ley 5/2014, de 4 de abril, de Seguridad Privada.`,
    oro: [
      ["PERSONA", "Rubén Cordero Salas"],
      ["ORGANISMO", "Dirección General de la Policía"],
      ["PERSONA", "Juan Carlos Prado Mora"],
      ["DNI", "09876543-K"],
      ["DIRECCION", "Avenida de la Constitución, 18, portal 2, 5.º B, 24009 León"],
      ["MATRICULA", "4521 KLM"],
      ["CAT_ESPECIAL", "incapacidad temporal"],
      ["CAT_ESPECIAL", "lumbalgia mecánica con irradiación a miembro inferior izquierdo"],
      ["CAT_ESPECIAL", "parte de baja"],
      ["DIRECCION", "calle Astorga, 5, de Trobajo del Camino"],
      ["PERSONA", "Esteban Rey Cano"],
      ["CAT_ESPECIAL", "parroquia evangélica"],
      ["NORMA", "artículos 48 y 49 de la Ley 5/2014, de 4 de abril, de Seguridad Privada"],
    ],
  },
  {
    id: 'd-nomina',
    fuente: 'Recibo de salarios con cuota sindical, IT y embargo',
    clase: 'nativo',
    texto: `RECIBO INDIVIDUAL JUSTIFICATIVO DEL PAGO DE SALARIOS
Empresa: LIMPIEZAS INTEGRALES DEL SUR, S.L.  CIF: B29876547
Trabajadora: AMINATA DIALLO SOW   NIE: Y-7654321-G   N.º afiliación S.S.: 29/1034567867
Categoría: Limpiadora   Antigüedad: 01/02/2019   Periodo: 01/08/2026 a 31/08/2026
DEVENGOS: Salario base 1.184,00 · Plus transporte 92,00 · Plus convenio 45,00
Complemento IT a cargo de la empresa (días 12 a 31) 318,40
DEDUCCIONES: Contingencias comunes 4,70 % · Desempleo 1,55 % · Formación 0,10 % · MEI 0,13 % · IRPF 6,00 %
Cuota sindical UGT 11,50
Embargo judicial (Ejecución de títulos judiciales 245/2025, Tribunal de Instancia de Málaga, Sección Social, Plaza 3): 120,00
LÍQUIDO A PERCIBIR: 1.302,17 € — Transferencia a ES81 2103 0146 9500 3012 7788`,
    oro: [
      ["CIF", "B29876547"],
      ["PERSONA", "AMINATA DIALLO SOW"],
      ["NIE", "Y-7654321-G"],
      ["NUSS", "29/1034567867"],
      ["CAT_ESPECIAL", "Complemento IT"],
      ["CAT_ESPECIAL", "Cuota sindical UGT"],
      ["AUTOS", "Ejecución de títulos judiciales 245/2025"],
      ["ORGANO", "Tribunal de Instancia de Málaga, Sección Social, Plaza 3"],
      ["IBAN", "ES81 2103 0146 9500 3012 7788"],
    ],
  },
  {
    id: 'd-finiquito-ocr',
    fuente: 'Finiquito escaneado firmado no conforme (San Fernando)',
    clase: 'ocr',
    texto: `DOCUMENTO DE LIQUIDACION Y FINIQUITO
D. JOSE ANTONIO GALLARDO SANTOS, CON DNI 45678912-S, Y DOMICILIO EN C/ REAL 102 BAJO 11100 SAN FERNANDO (CADIZ), QUE HA PRESTADO SERVICIOS PARA LA EMPRESA ASTILLEROS BAHIA SUR SA COMO SOLDADOR HASTA EL 31/07/2026, FECHA EN QUE CAUSA BAJA POR DESPIDO OBJETIVO (ART. 52 C) ET), RECIBE EN ESTE ACTO LAS SIGUIENTES CANTIDADES:
VACACIONES NO DISFRUTADAS: 1.245,30
PARTE PROPORCIONAL PAGAS EXTRA: 980,12
INDEMNIZACION 20 DIAS/AÑO: 14.230,00
EL TRABAJADOR FIRMA NO CONFORME. ESTA PRESENTE EL DELEGADO DE PERSONAL DE CGT, D. FRANCISCO RAMOS BRAVO ("PACO").
EN SAN FERNANDO, A 31 DE JULIO DE 2026
FDO: EL TRABAJADOR          FDO: POR LA EMPRESA, MARIA DEL MAR TORRES DE LA CALLE (RRHH)
TELEFONO TRABAJADOR: 656-12-34-56`,
    oro: [
      ["PERSONA", "JOSE ANTONIO GALLARDO SANTOS"],
      ["DNI", "45678912-S"],
      ["DIRECCION", "C/ REAL 102 BAJO 11100 SAN FERNANDO"],
      ["NORMA", "ART. 52 C) ET"],
      ["CAT_ESPECIAL", "DELEGADO DE PERSONAL DE CGT"],
      ["PERSONA", "FRANCISCO RAMOS BRAVO"],
      ["PERSONA", "PACO"],
      ["PERSONA", "MARIA DEL MAR TORRES DE LA CALLE"],
      ["TELEFONO", "656-12-34-56"],
    ],
  },
  {
    id: 'd-parte-accidente-ocr',
    fuente: 'Declaración amistosa de accidente escaneada (Santander)',
    clase: 'ocr',
    texto: `DECLARACION AMISTOSA DE ACCIDENTE
FECHA: 22/06/2026  HORA: 19:40  LUGAR: ROTONDA DE LA AV. DE LOS CASTROS CON C/ CARDENAL HERRERA ORIA, SANTANDER
HERIDOS: SI (LEVES)
VEHICULO A: CONDUCTOR: GUTIERREZ DEL CAMPO, SANTIAGO  DNI 72045678H  DOMICILIO: BARRIO LA GANDARA 14 39600 MALIAÑO  TELF 942 25 33 10  MATRICULA 1234 BCD  ASEGURADORA: MUTUA CANTABRA POLIZA 55-887766
VEHICULO B: CONDUCTOR: ZHANG WEI  NIE X3344556B  DOMICILIO: C/ SAN FERNANDO 45 3ºC 39010 SANTANDER  TELF 622113344  MATRICULA 9876 JKL
OBSERVACIONES CONDUCTOR B: EL CONDUCTOR A NO RESPETO LA PRIORIDAD. MI ACOMPAÑANTE, LIU YANG, EMBARAZADA DE 7 MESES, SUFRE DOLOR CERVICAL Y FUE TRASLADADA EN AMBULANCIA AL HOSPITAL VALDECILLA.
TESTIGOS: AGENTE POLICIA LOCAL SANTANDER N 0457 Y VECINA MARIA JESUS CAMPO ESCUDERO, TEL 649 00 11 22`,
    oro: [
      ["PERSONA", "GUTIERREZ DEL CAMPO, SANTIAGO"],
      ["DNI", "72045678H"],
      ["DIRECCION", "BARRIO LA GANDARA 14 39600 MALIAÑO"],
      ["TELEFONO", "942 25 33 10"],
      ["MATRICULA", "1234 BCD"],
      ["PERSONA", "ZHANG WEI"],
      ["NIE", "X3344556B"],
      ["DIRECCION", "C/ SAN FERNANDO 45 3ºC 39010 SANTANDER"],
      ["TELEFONO", "622113344"],
      ["MATRICULA", "9876 JKL"],
      ["PERSONA", "LIU YANG"],
      ["CAT_ESPECIAL", "EMBARAZADA DE 7 MESES"],
      ["CAT_ESPECIAL", "DOLOR CERVICAL"],
      ["ORGANISMO", "POLICIA LOCAL SANTANDER"],
      ["TIP", "0457"],
      ["PERSONA", "MARIA JESUS CAMPO ESCUDERO"],
      ["TELEFONO", "649 00 11 22"],
    ],
  },
  {
    id: 'd-rcud-incapacidad-absoluta',
    fuente: 'Recurso de casación para la unificación de doctrina sobre incapacidad permanente absoluta',
    clase: 'nativo',
    texto: `A LA SALA DE LO SOCIAL DEL TRIBUNAL SUPREMO

Recurso de casación para la unificación de doctrina contra la sentencia de la Sala de lo Social del Tribunal Superior de Justicia de Castilla-La Mancha, sede en Albacete, de 11 de junio de 2026 (Recurso de Suplicación n.º 612/2026).

Doña Soledad Cortés Heredia, Graduada Social colegiada n.º 214, en nombre de DON ANTONIO JIMÉNEZ CORTÉS, con NUSS 02/1045678960, cuya representación consta acreditada, interpone RECURSO DE CASACIÓN PARA LA UNIFICACIÓN DE DOCTRINA al amparo de los artículos 218 y siguientes de la LRJS.

La sentencia recurrida revocó la de instancia y denegó al trabajador la incapacidad permanente absoluta derivada de enfermedad común reconocida por el Juzgado de lo Social n.º 2 de Albacete, pese a que padece una cardiopatía isquémica con fracción de eyección del 30 % y un síndrome ansioso-depresivo crónico, y está en tratamiento con bisoprolol, clopidogrel y alprazolam.

Se invoca como sentencia de contraste la STSJ de Andalucía, Sevilla, de 4 de abril de 2024 (ECLI:ES:TSJAND:2024:5120), que ante un cuadro idéntico reconoció el grado de absoluta.

El actor pertenece a la etnia gitana y trabajaba como vendedor ambulante en el mercadillo de La Roda; su esposa, Doña Remedios Heredia Motos, percibe una pensión no contributiva por invalidez.

La base reguladora es de 1.422,60 euros. El INSS se opuso en la instancia.`,
    oro: [
      ["ORGANO", "SALA DE LO SOCIAL DEL TRIBUNAL SUPREMO"],
      ["ORGANO", "Sala de lo Social del Tribunal Superior de Justicia de Castilla-La Mancha, sede en Albacete"],
      ["AUTOS", "Recurso de Suplicación n.º 612/2026"],
      ["PERSONA", "Soledad Cortés Heredia"],
      ["PERSONA", "ANTONIO JIMÉNEZ CORTÉS"],
      ["NUSS", "02/1045678960"],
      ["NORMA", "artículos 218 y siguientes de la LRJS"],
      ["OBJETO", "incapacidad permanente absoluta derivada de enfermedad común"],
      ["ORGANO", "Juzgado de lo Social n.º 2 de Albacete"],
      ["CAT_ESPECIAL", "cardiopatía isquémica con fracción de eyección del 30 %"],
      ["CAT_ESPECIAL", "síndrome ansioso-depresivo crónico"],
      ["CAT_ESPECIAL", "bisoprolol"],
      ["CAT_ESPECIAL", "clopidogrel"],
      ["CAT_ESPECIAL", "alprazolam"],
      ["NORMA", "STSJ de Andalucía, Sevilla, de 4 de abril de 2024"],
      ["ECLI", "ECLI:ES:TSJAND:2024:5120"],
      ["CAT_ESPECIAL", "etnia gitana"],
      ["PERSONA", "Remedios Heredia Motos"],
      ["CAT_ESPECIAL", "pensión no contributiva por invalidez"],
      ["ORGANISMO", "INSS"],
    ],
  },
  {
    id: 'd-providencia-tc-inadmision',
    fuente: 'Providencia de inadmisión de recurso de amparo del Tribunal Constitucional',
    clase: 'nativo',
    texto: `TRIBUNAL CONSTITUCIONAL
Sala Segunda. Sección Cuarta.
Recurso de amparo n.º 3187-2026
Promovido por: Doña Fatima Zahra Ouali Haddou.

PROVIDENCIA

La Sección ha acordado no admitir a trámite el recurso de amparo promovido por doña Fatima Zahra Ouali Haddou contra el auto de 5 de mayo de 2026 de la Sección Primera de la Audiencia Provincial de Girona, dictado en el rollo de apelación n.º 211/2026, porque la recurrente no ha satisfecho la carga de justificar la especial trascendencia constitucional del recurso (arts. 49.1 y 50.1.b) LOTC).

La demanda denunciaba la vulneración del art. 16 CE por la sanción disciplinaria impuesta en el centro penitenciario de Puig de les Basses, donde cumplía condena, por negarse a retirar el hiyab durante las comunicaciones vis a vis.

Madrid, a 21 de septiembre de 2026.
El presidente de la Sección, don Ignacio Sanz de Albornoz Pellicer.
La secretaria de Justicia, doña Herminia Palencia Guerra.`,
    oro: [
      ["ORGANO", "TRIBUNAL CONSTITUCIONAL"],
      ["AUTOS", "Recurso de amparo n.º 3187-2026"],
      ["PERSONA", "Fatima Zahra Ouali Haddou"],
      ["ORGANO", "Sección Primera de la Audiencia Provincial de Girona"],
      ["AUTOS", "rollo de apelación n.º 211/2026"],
      ["NORMA", "arts. 49.1 y 50.1.b) LOTC"],
      ["NORMA", "art. 16 CE"],
      ["DATO_PENAL", "donde cumplía condena"],
      ["CAT_ESPECIAL", "hiyab"],
      ["PONENTE", "Ignacio Sanz de Albornoz Pellicer"],
      ["LAJ", "Herminia Palencia Guerra"],
    ],
  },
  {
    id: 'd-resolucion-aepd',
    fuente: 'Resolución sancionadora de la AEPD contra clínica dental',
    clase: 'nativo',
    texto: `AGENCIA ESPAÑOLA DE PROTECCIÓN DE DATOS
Procedimiento n.º: PS/00312/2026
RESOLUCIÓN DE PROCEDIMIENTO SANCIONADOR
Del procedimiento instruido por la Agencia Española de Protección de Datos ante CLÍNICA DENTAL SONRISA PLENA, S.L., con CIF B87654323, por la reclamación presentada por Don Borja Salvatierra Uribe, y en base a los siguientes
HECHOS PROBADOS
PRIMERO: El 9 de enero de 2026 el reclamante recibió, en su dirección borjasalvatierra@yahoo.es, un correo remitido por la clínica a 214 pacientes con todos los destinatarios en copia visible, en el que se adjuntaba por error el odontograma y el informe de periodontitis crónica avanzada de otra paciente, Doña Lorena Quispe Mamani.
SEGUNDO: La responsable del tratamiento, a través de su delegado de protección de datos, Don Iker Mendieta Alonso, reconoció los hechos.
FUNDAMENTOS DE DERECHO
Los hechos constituyen una infracción del artículo 5.1.f) del RGPD, tipificada en el artículo 83.5 del RGPD y calificada como muy grave a efectos de prescripción en el artículo 72.1.a) de la LOPDGDD.
Se impone una multa de 30.000 euros.
La Directora de la Agencia Española de Protección de Datos, P.S., la Subdirectora General de Inspección, Leonor Villegas Aranda.`,
    oro: [
      ["ORGANISMO", "AGENCIA ESPAÑOLA DE PROTECCIÓN DE DATOS"],
      ["AUTOS", "PS/00312/2026"],
      ["CIF", "B87654323"],
      ["PERSONA", "Borja Salvatierra Uribe"],
      ["CORREO", "borjasalvatierra@yahoo.es"],
      ["CAT_ESPECIAL", "odontograma"],
      ["CAT_ESPECIAL", "informe de periodontitis crónica avanzada"],
      ["PERSONA", "Lorena Quispe Mamani"],
      ["PERSONA", "Iker Mendieta Alonso"],
      ["NORMA", "artículo 5.1.f) del RGPD"],
      ["NORMA", "artículo 83.5 del RGPD"],
      ["NORMA", "artículo 72.1.a) de la LOPDGDD"],
      ["PERSONA", "Leonor Villegas Aranda"],
    ],
  },
  {
    id: 'd-sancion-dgt',
    fuente: 'Notificación de resolución sancionadora de la DGT (Toledo)',
    clase: 'nativo',
    texto: `DIRECCIÓN GENERAL DE TRÁFICO — JEFATURA PROVINCIAL DE TOLEDO
Expediente sancionador n.º 450123456789
NOTIFICACIÓN DE RESOLUCIÓN SANCIONADORA
Titular: SERGIO TOLEDO MORA   DNI: 03912345-E
Domicilio: Plaza de Zocodover, 7, 2.º, 45001 Toledo
Vehículo: Renault Mégane, matrícula 0912-HGT
Hecho denunciado: No respetar la luz roja de un semáforo. Precepto infringido: artículo 146 del Reglamento General de Circulación, en relación con el artículo 76.a) del texto refundido de la Ley sobre Tráfico, Circulación de Vehículos a Motor y Seguridad Vial (RDLeg 6/2015).
Agente denunciante: Guardia Civil, Agrupación de Tráfico, TIP V-12345-K.
Sanción: 200 euros y detracción de 4 puntos.
Conductor identificado: el titular.
Alegaciones: el interesado alegó que sufrió una crisis de epilepsia al volante y que toma carbamazepina; no aporta prueba y se desestiman.`,
    oro: [
      ["ORGANISMO", "DIRECCIÓN GENERAL DE TRÁFICO"],
      ["ORGANISMO", "JEFATURA PROVINCIAL DE TOLEDO"],
      ["AUTOS", "Expediente sancionador n.º 450123456789"],
      ["PERSONA", "SERGIO TOLEDO MORA"],
      ["DNI", "03912345-E"],
      ["DIRECCION", "Plaza de Zocodover, 7, 2.º, 45001 Toledo"],
      ["MATRICULA", "0912-HGT"],
      ["NORMA", "artículo 146 del Reglamento General de Circulación"],
      ["NORMA", "artículo 76.a) del texto refundido de la Ley sobre Tráfico, Circulación de Vehículos a Motor y Seguridad Vial"],
      ["NORMA", "RDLeg 6/2015"],
      ["ORGANISMO", "Guardia Civil"],
      ["TIP", "V-12345-K"],
      ["CAT_ESPECIAL", "epilepsia"],
      ["CAT_ESPECIAL", "carbamazepina"],
    ],
  },
  {
    id: 'd-recurs-multa-girona',
    fuente: 'Recurso de reposición contra multa municipal, en catalán (Girona)',
    clase: 'nativo',
    texto: `A L'AJUNTAMENT DE GIRONA — Àrea de Seguretat Ciutadana
RECURS DE REPOSICIÓ
Sra. Montserrat Guerra i Casals, amb DNI 40334455-E i domicili a efectes de notificacions al carrer de la Rutlla, 102, 3r 2a, 17003 Girona, telèfon 872 08 15 90, amb adreça electrònica mguerracasals@gmail.com, EXPOSO:
Que en data 4 d'agost de 2026 se m'ha notificat la resolució sancionadora de l'expedient 2026/ST/004512 per estacionar el vehicle 3344 LKP en una plaça reservada a persones amb mobilitat reduïda al carrer Nou, sense targeta visible.
Que la targeta d'aparcament per a persones amb discapacitat està expedida a nom del meu fill, Pol Rovira Guerra, que té reconeguda una discapacitat del 75 % per una distròfia muscular de Duchenne, i que en el moment de la denúncia jo el traslladava a la sessió de fisioteràpia a l'Hospital Santa Caterina.
Que la targeta era a la guantera i l'agent de la Policia Municipal amb número professional 1702 no ho va comprovar.
Per tot això, d'acord amb l'article 123 de la Llei 39/2015, SOL·LICITO que s'anul·li la sanció.`,
    oro: [
      ["ORGANISMO", "AJUNTAMENT DE GIRONA"],
      ["PERSONA", "Montserrat Guerra i Casals"],
      ["DNI", "40334455-E"],
      ["DIRECCION", "carrer de la Rutlla, 102, 3r 2a, 17003 Girona"],
      ["TELEFONO", "872 08 15 90"],
      ["CORREO", "mguerracasals@gmail.com"],
      ["AUTOS", "2026/ST/004512"],
      ["MATRICULA", "3344 LKP"],
      ["CAT_ESPECIAL", "targeta d'aparcament per a persones amb discapacitat"],
      ["PERSONA", "Pol Rovira Guerra"],
      ["CAT_ESPECIAL", "discapacitat del 75 %"],
      ["CAT_ESPECIAL", "distròfia muscular de Duchenne"],
      ["CAT_ESPECIAL", "sessió de fisioteràpia"],
      ["ORGANISMO", "Hospital Santa Caterina"],
      ["ORGANISMO", "Policia Municipal"],
      ["TIP", "1702"],
      ["NORMA", "article 123 de la Llei 39/2015"],
    ],
  },
  {
    id: 'd-laudo-arbitral',
    fuente: 'Laudo arbitral internacional de compraventa de madera',
    clase: 'nativo',
    texto: `CORTE DE ARBITRAJE DE LA CÁMARA OFICIAL DE COMERCIO, INDUSTRIA Y SERVICIOS DE MADRID
Arbitraje n.º 44/2025
LAUDO FINAL
Demandante: NORDIC TIMBER TRADING AB, representada por el abogado Don Björn Lindqvist y por Doña Paloma Santos Arroyo.
Demandada: CARPINTERÍAS DEL PRADO, S.A., con CIF A28112233, representada por Don Emilio Castillo Ferrer.
Árbitro único: Don Leopoldo Rey-Baltar Nogueira.
(...) Declaró como testigo el jefe de compras de la demandada, Don Dariusz Kowalczyk, quien reconoció haber recibido las 12 partidas de madera sin formular reserva alguna.
(...) Declaró asimismo Don Hernán Gutiérrez Ahumada, representante comercial, que manifestó haber estado de baja por depresión durante las negociaciones de marzo, lo que explicaría la ausencia de respuesta a los correos.
(...) De conformidad con el artículo 37 de la Ley 60/2003, de 23 de diciembre, de Arbitraje,
DECIDO: Condenar a CARPINTERÍAS DEL PRADO, S.A. a pagar a la demandante 412.880 euros, más los intereses legales.
Madrid, 15 de julio de 2026. Leopoldo Rey-Baltar Nogueira.`,
    oro: [
      ["ORGANISMO", "CORTE DE ARBITRAJE DE LA CÁMARA OFICIAL DE COMERCIO, INDUSTRIA Y SERVICIOS DE MADRID"],
      ["AUTOS", "Arbitraje n.º 44/2025"],
      ["PERSONA", "Björn Lindqvist"],
      ["PERSONA", "Paloma Santos Arroyo"],
      ["CIF", "A28112233"],
      ["PERSONA", "Emilio Castillo Ferrer"],
      ["PERSONA", "Leopoldo Rey-Baltar Nogueira"],
      ["PERSONA", "Dariusz Kowalczyk"],
      ["PERSONA", "Hernán Gutiérrez Ahumada"],
      ["CAT_ESPECIAL", "baja por depresión"],
      ["NORMA", "artículo 37 de la Ley 60/2003, de 23 de diciembre, de Arbitraje"],
    ],
  },
  {
    id: 'd-acta-mediacion-familiar',
    fuente: 'Acta final de mediación familiar (Asturias)',
    clase: 'nativo',
    texto: `SERVICIO DE MEDIACIÓN FAMILIAR DEL PRINCIPADO DE ASTURIAS
ACTA FINAL DE MEDIACIÓN — Expediente MF-OV-0213/2026
Mediadora: Covadonga Fernández Menéndez (Registro de Mediadores n.º 3301).
Participantes: Don Xandru Álvarez Suárez, con domicilio en calle Uría, 34, 5.º dcha., 33003 Oviedo, y Doña Lorena Menéndez Iglesias, con domicilio en Lugar La Llera, 12, 33190 Siero (Asturias).
Hijos comunes: Nel (10 años) y Olaya (6 años).
Acuerdos alcanzados:
1.º Custodia compartida por semanas alternas, con entrega los viernes a la salida del colegio.
2.º Se tendrá en cuenta que Nel tiene diagnosticado un trastorno del espectro autista (grado 1) y acude a terapia con la psicóloga Doña Marta Rubiera, cuyo coste (180 €/mes) se abonará por mitad.
3.º Olaya seguirá asistiendo a la catequesis en la parroquia de San Juan el Real, a petición de la madre; el padre, que se declara ateo, no se opone.
4.º Comunicación entre los progenitores por la aplicación y, en urgencias, en los teléfonos 684 11 22 33 (Xandru) y 684 99 88 77 (Lorena).
Las partes podrán elevar el acuerdo a convenio regulador ante el Tribunal de Instancia de Oviedo, Sección de Familia.`,
    oro: [
      ["ORGANISMO", "SERVICIO DE MEDIACIÓN FAMILIAR DEL PRINCIPADO DE ASTURIAS"],
      ["AUTOS", "Expediente MF-OV-0213/2026"],
      ["PERSONA", "Covadonga Fernández Menéndez"],
      ["PERSONA", "Xandru Álvarez Suárez"],
      ["DIRECCION", "calle Uría, 34, 5.º dcha., 33003 Oviedo"],
      ["PERSONA", "Lorena Menéndez Iglesias"],
      ["DIRECCION", "Lugar La Llera, 12, 33190 Siero"],
      ["PERSONA", "Nel"],
      ["PERSONA", "Olaya"],
      ["CAT_ESPECIAL", "trastorno del espectro autista (grado 1)"],
      ["CAT_ESPECIAL", "terapia"],
      ["PERSONA", "Marta Rubiera"],
      ["CAT_ESPECIAL", "catequesis en la parroquia de San Juan el Real"],
      ["CAT_ESPECIAL", "ateo"],
      ["TELEFONO", "684 11 22 33"],
      ["PERSONA", "Xandru"],
      ["TELEFONO", "684 99 88 77"],
      ["PERSONA", "Lorena"],
      ["ORGANO", "Tribunal de Instancia de Oviedo, Sección de Familia"],
    ],
  },
  {
    id: 'd-asilo-alegaciones',
    fuente: 'Alegaciones complementarias a solicitud de protección internacional',
    clase: 'nativo',
    texto: `SOLICITUD DE PROTECCIÓN INTERNACIONAL — ALEGACIONES COMPLEMENTARIAS
A LA OFICINA DE ASILO Y REFUGIO (Ministerio del Interior)
Expediente: 26/0045321
Solicitante: Don Ibrahima Coulibaly, nacido en Bamako (Malí) el 1 de enero de 1998, con NIE Z-1234567-R, alojado en el centro de acogida sito en calle Hortaleza, 91, 1.º, 28004 Madrid.
Representación: Doña Gabriela Montenegro Ríos, abogada de la Comisión Española de Ayuda al Refugiado, teléfono 91 555 06 98.
1. El solicitante pertenece a la etnia peul (fulani) y fue perseguido por milicias tras el asesinato de su padre, Amadou Coulibaly, en el centro del país.
2. Es homosexual; su pareja, Moussa Traoré, fue detenido y se desconoce su paradero.
3. Presenta secuelas de tortura documentadas en el informe del Protocolo de Estambul emitido por la Dra. Irene Bastida Cruz, psiquiatra, que diagnostica un trastorno de estrés postraumático crónico.
4. Su hermana, Awa Coulibaly, reside en Lyon con estatuto de refugiada.
Se invocan los artículos 3 y 7 de la Ley 12/2009, de 30 de octubre, reguladora del derecho de asilo y de la protección subsidiaria.`,
    oro: [
      ["ORGANISMO", "OFICINA DE ASILO Y REFUGIO"],
      ["ORGANISMO", "Ministerio del Interior"],
      ["AUTOS", "26/0045321"],
      ["PERSONA", "Ibrahima Coulibaly"],
      ["NIE", "Z-1234567-R"],
      ["DIRECCION", "calle Hortaleza, 91, 1.º, 28004 Madrid"],
      ["PERSONA", "Gabriela Montenegro Ríos"],
      ["ORGANISMO", "Comisión Española de Ayuda al Refugiado"],
      ["TELEFONO", "91 555 06 98"],
      ["CAT_ESPECIAL", "etnia peul (fulani)"],
      ["PERSONA", "Amadou Coulibaly"],
      ["CAT_ESPECIAL", "homosexual"],
      ["PERSONA", "Moussa Traoré"],
      ["CAT_ESPECIAL", "secuelas de tortura"],
      ["CAT_ESPECIAL", "informe del Protocolo de Estambul"],
      ["PERSONA", "Irene Bastida Cruz"],
      ["CAT_ESPECIAL", "trastorno de estrés postraumático crónico"],
      ["PERSONA", "Awa Coulibaly"],
      ["NORMA", "artículos 3 y 7 de la Ley 12/2009, de 30 de octubre, reguladora del derecho de asilo y de la protección subsidiaria"],
    ],
  },
  {
    id: 'd-reagrupacion-familiar',
    fuente: 'Solicitud de residencia por reagrupación familiar (Barcelona)',
    clase: 'nativo',
    texto: `SOLICITUD DE AUTORIZACIÓN DE RESIDENCIA TEMPORAL POR REAGRUPACIÓN FAMILIAR
Oficina de Extranjería de Barcelona
Reagrupante: LIN XIAOMING, NIE X-6789012-X, con domicilio en Carrer de Trafalgar, 29, àtic 1a, 08010 Barcelona, NUSS 08/1098765445, empleado de restauración.
Reagrupados: su esposa, CHEN MEIHUA, y su hija, LIN YUTONG, de 11 años, ambas residentes en Qingtian (Zhejiang, China).
Documentación: certificado de antecedentes penales del reagrupante en su país de origen, que acredita la cancelación de la condena de 2009 por un delito de contrabando; informe de disponibilidad de vivienda adecuada emitido por el Ayuntamiento de Barcelona; certificado médico de la hija, que padece una cardiopatía congénita (comunicación interventricular) operada en 2019.
Correo a efectos de notificaciones: gestoria.ramblas@gmail.com (Gestoría Ramblas, a/a Nuria Blasco Pueyo).
Base legal: artículos 17 y 18 de la Ley Orgánica 4/2000 y artículos 52 y siguientes del Real Decreto 1155/2024.`,
    oro: [
      ["ORGANISMO", "Oficina de Extranjería de Barcelona"],
      ["PERSONA", "LIN XIAOMING"],
      ["NIE", "X-6789012-X"],
      ["DIRECCION", "Carrer de Trafalgar, 29, àtic 1a, 08010 Barcelona"],
      ["NUSS", "08/1098765445"],
      ["PERSONA", "CHEN MEIHUA"],
      ["PERSONA", "LIN YUTONG"],
      ["DATO_PENAL", "la condena de 2009 por un delito de contrabando"],
      ["ORGANISMO", "Ayuntamiento de Barcelona"],
      ["CAT_ESPECIAL", "certificado médico"],
      ["CAT_ESPECIAL", "cardiopatía congénita (comunicación interventricular) operada en 2019"],
      ["CORREO", "gestoria.ramblas@gmail.com"],
      ["PERSONA", "Nuria Blasco Pueyo"],
      ["NORMA", "artículos 17 y 18 de la Ley Orgánica 4/2000"],
      ["NORMA", "artículos 52 y siguientes del Real Decreto 1155/2024"],
    ],
  },
  {
    id: 'd-pliego-cargos-funcionario',
    fuente: 'Pliego de cargos en expediente disciplinario de funcionario de la AEAT',
    clase: 'nativo',
    texto: `MINISTERIO DE HACIENDA — AGENCIA ESTATAL DE ADMINISTRACIÓN TRIBUTARIA
Delegación Especial de Castilla y León — Departamento de Recursos Humanos
Expediente disciplinario n.º ED-2026/017
PLIEGO DE CARGOS
Instructora: Doña Raquel Andrés Pardo, Jefa de Servicio.
Secretario: Don Julián Merino Tapia.
Expedientado: Don Héctor Bermejo Soto, funcionario del Cuerpo Técnico de Hacienda, con destino en la Administración de Segovia y domicilio en calle Real, 3, 2.º B, 40001 Segovia.
CARGO PRIMERO.- Haber accedido, sin justificación de servicio, en 87 ocasiones entre enero y abril de 2026, a los datos fiscales de su excuñada, Doña Silvia Mora Llorente, y de la pareja de esta, Don Adrián Cuesta Vela, lo que podría constituir falta muy grave del artículo 95.2 del TREBEP.
CARGO SEGUNDO.- Ausencias injustificadas. El expedientado alega que durante ese periodo estaba en tratamiento de deshabituación por ludopatía y aporta un informe del centro de salud mental, que no justifica las ausencias.
Consta que el expedientado es miembro de la Junta de Personal por la candidatura de CSIF.
Se le concede un plazo de diez días para formular alegaciones, conforme al artículo 35 del Real Decreto 33/1986.`,
    oro: [
      ["ORGANISMO", "MINISTERIO DE HACIENDA"],
      ["ORGANISMO", "AGENCIA ESTATAL DE ADMINISTRACIÓN TRIBUTARIA"],
      ["AUTOS", "Expediente disciplinario n.º ED-2026/017"],
      ["PERSONA", "Raquel Andrés Pardo"],
      ["PERSONA", "Julián Merino Tapia"],
      ["PERSONA", "Héctor Bermejo Soto"],
      ["DIRECCION", "calle Real, 3, 2.º B, 40001 Segovia"],
      ["PERSONA", "Silvia Mora Llorente"],
      ["PERSONA", "Adrián Cuesta Vela"],
      ["NORMA", "artículo 95.2 del TREBEP"],
      ["CAT_ESPECIAL", "deshabituación por ludopatía"],
      ["CAT_ESPECIAL", "informe del centro de salud mental"],
      ["CAT_ESPECIAL", "candidatura de CSIF"],
      ["NORMA", "artículo 35 del Real Decreto 33/1986"],
    ],
  },
  {
    id: 'd-certificado-empadronamiento',
    fuente: 'Certificado de empadronamiento colectivo, en gallego (Lugo)',
    clase: 'nativo',
    texto: `CONCELLO DE LUGO
CERTIFICADO DE EMPADROAMENTO
Dona Iria Vázquez Pardo, secretaria xeral do Concello de Lugo,
CERTIFICA: Que segundo os datos que constan no Padrón Municipal de Habitantes, figuran inscritas no domicilio Rúa da Raíña, 14, 3.º esquerda, 27001 Lugo, as seguintes persoas:
- ROSALÍA MOSQUERA DE CASTRO, DNI 33334444-S, data de alta: 12/05/2011.
- MARTIÑO CASTRO MOSQUERA, DNI 33335555-E, data de alta: 03/09/2014.
- NAHIA ECHEVERRÍA CASTRO, menor, data de alta: 22/11/2023.
E para que conste, a petición da interesada, para presentar no Instituto Galego de Vivenda e Solo, expido o presente en Lugo, a 18 de setembro de 2026.`,
    oro: [
      ["ORGANISMO", "CONCELLO DE LUGO"],
      ["PERSONA", "Iria Vázquez Pardo"],
      ["DIRECCION", "Rúa da Raíña, 14, 3.º esquerda, 27001 Lugo"],
      ["PERSONA", "ROSALÍA MOSQUERA DE CASTRO"],
      ["DNI", "33334444-S"],
      ["PERSONA", "MARTIÑO CASTRO MOSQUERA"],
      ["DNI", "33335555-E"],
      ["PERSONA", "NAHIA ECHEVERRÍA CASTRO"],
      ["ORGANISMO", "Instituto Galego de Vivenda e Solo"],
    ],
  },
  {
    id: 'd-correo-abogada-cliente-getxo',
    fuente: 'Correo de abogada a clientes antes de la vista (Bizkaia)',
    clase: 'correo',
    texto: `De: "Maite Ruiz de Azúa" <mruizdeazua@bufeteazua.eus>
Para: Josune <josune.lekue@euskaltel.net>
CC: Txema Lekue <txema.lekue61@gmail.com>; Ander (despacho) <ander@bufeteazua.eus>
Asunto: Juicio del lunes - Tribunal de Instancia de Getxo

Kaixo Josune:

Te recuerdo que el lunes 5 a las 10:00 tenéis la vista en el Tribunal de Instancia de Getxo, Sección Civil, Plaza n.º 1 (Juicio Verbal 318/2026). Venid media hora antes.

Tu marido que traiga el informe del traumatólogo y las facturas de la rehabilitación. Si Txema no puede estar de pie tanto rato por la hernia discal, que me lo diga y pido al juzgado que le dejen declarar sentado.

La contraria ha propuesto como testigo a la tal Begoña, la del segundo; según me dice Ander, es la presidenta de la comunidad y tiene muy mala relación con vosotros.

Ondo izan,
Maite

Maite Ruiz de Azúa Etxebarria
Abogada — Bufete Azua
Gran Vía de Don Diego López de Haro, 45, 3.º, 48011 Bilbao
Tel. 944 15 67 89 · Móvil 688 432 109`,
    oro: [
      ["PERSONA", "Maite Ruiz de Azúa"],
      ["CORREO", "mruizdeazua@bufeteazua.eus"],
      ["PERSONA", "Josune"],
      ["CORREO", "josune.lekue@euskaltel.net"],
      ["PERSONA", "Txema Lekue"],
      ["CORREO", "txema.lekue61@gmail.com"],
      ["PERSONA", "Ander"],
      ["CORREO", "ander@bufeteazua.eus"],
      ["ORGANO", "Tribunal de Instancia de Getxo, Sección Civil, Plaza n.º 1"],
      ["AUTOS", "Juicio Verbal 318/2026"],
      ["CAT_ESPECIAL", "informe del traumatólogo"],
      ["CAT_ESPECIAL", "rehabilitación"],
      ["PERSONA", "Txema"],
      ["CAT_ESPECIAL", "hernia discal"],
      ["PERSONA", "Begoña"],
      ["PERSONA", "Maite"],
      ["PERSONA", "Maite Ruiz de Azúa Etxebarria"],
      ["DIRECCION", "Gran Vía de Don Diego López de Haro, 45, 3.º, 48011 Bilbao"],
      ["TELEFONO", "944 15 67 89"],
      ["TELEFONO", "688 432 109"],
    ],
  },
  {
    id: 'd-modificacion-medidas-ludopatia',
    fuente: 'Demanda de modificación de medidas por ludopatía de la progenitora custodia',
    clase: 'nativo',
    texto: `AL TRIBUNAL DE INSTANCIA DE CÓRDOBA, SECCIÓN DE FAMILIA, PLAZA N.º 2
Autos de divorcio contencioso n.º 902/2022

Doña Inmaculada Cabello Romero, Procuradora, en nombre de DON RAFAEL ALCÁNTARA LUQUE, DNI 30556677-G, ante el Tribunal comparezco y formulo DEMANDA DE MODIFICACIÓN DE MEDIDAS DEFINITIVAS frente a DOÑA ESPERANZA PRIEGO CASTILLO, con domicilio en Urbanización El Brillante, calle Poeta Juan Rejano, 3, 14012 Córdoba.

HECHOS

PRIMERO.- Por sentencia de 20 de marzo de 2023 se atribuyó a la demandada la guarda y custodia del hijo común, Álvaro, hoy de 13 años.

SEGUNDO.- Con posterioridad, la Sra. Priego ha desarrollado una ludopatía severa, con pérdidas acreditadas de más de 40.000 euros en casas de apuestas online, que ha motivado que el menor haya sido desatendido.

TERCERO.- La demandada se encuentra en tratamiento con naltrexona y ha sido atendida en dos ocasiones en urgencias por intentos autolíticos, según consta en la historia clínica cuya aportación se solicita como prueba.

CUARTO.- La actual pareja de la demandada, Don Manuel Jesús Cantero Ruz, cumplió condena por un delito de tráfico de drogas y se encuentra en libertad condicional.

QUINTO.- El menor ha expresado a su tutora del instituto, Doña Aurora Luque Sepúlveda, su deseo de vivir con su padre.

Se solicita la atribución de la custodia al padre conforme a los artículos 90.3 y 91 del Código Civil y al artículo 775 LEC.`,
    oro: [
      ["ORGANO", "TRIBUNAL DE INSTANCIA DE CÓRDOBA, SECCIÓN DE FAMILIA, PLAZA N.º 2"],
      ["AUTOS", "Autos de divorcio contencioso n.º 902/2022"],
      ["PERSONA", "Inmaculada Cabello Romero"],
      ["PERSONA", "RAFAEL ALCÁNTARA LUQUE"],
      ["DNI", "30556677-G"],
      ["PERSONA", "ESPERANZA PRIEGO CASTILLO"],
      ["DIRECCION", "Urbanización El Brillante, calle Poeta Juan Rejano, 3, 14012 Córdoba"],
      ["PERSONA", "Álvaro"],
      ["PERSONA", "Priego"],
      ["OBJETO", "ludopatía severa"],
      ["CAT_ESPECIAL", "naltrexona"],
      ["CAT_ESPECIAL", "intentos autolíticos"],
      ["CAT_ESPECIAL", "historia clínica"],
      ["PERSONA", "Manuel Jesús Cantero Ruz"],
      ["DATO_PENAL", "cumplió condena por un delito de tráfico de drogas"],
      ["DATO_PENAL", "libertad condicional"],
      ["PERSONA", "Aurora Luque Sepúlveda"],
      ["NORMA", "artículos 90.3 y 91 del Código Civil"],
      ["NORMA", "artículo 775 LEC"],
    ],
  },
  {
    id: 'd-cancelacion-antecedentes',
    fuente: 'Solicitud de cancelación de antecedentes penales al Registro Central de Penados',
    clase: 'nativo',
    texto: `AL MINISTERIO DE JUSTICIA — Registro Central de Penados
SOLICITUD DE CANCELACIÓN DE ANTECEDENTES PENALES

Don Yeferson Stiven Mosquera Palacios, con NIE X-7788990-V, domicilio en Avenida del Cid, 60, puerta 14, 46018 València, teléfono 611 22 33 44 y correo yefer.mosquera@gmail.com,

EXPONE:

1.º Que fue condenado por sentencia de 12 de febrero de 2020 del Juzgado de lo Penal n.º 7 de Valencia (Ejecutoria 188/2020) a la pena de 6 meses de prisión por un delito de hurto, pena que quedó suspendida.

2.º Que han transcurrido los plazos del artículo 136 del Código Penal sin haber vuelto a delinquir, y ha satisfecho la responsabilidad civil.

3.º Que necesita la cancelación para su solicitud de nacionalidad española por residencia ante la Dirección General de Seguridad Jurídica y Fe Pública.

SOLICITA la cancelación de sus antecedentes penales.`,
    oro: [
      ["ORGANISMO", "MINISTERIO DE JUSTICIA"],
      ["ORGANISMO", "Registro Central de Penados"],
      ["PERSONA", "Yeferson Stiven Mosquera Palacios"],
      ["NIE", "X-7788990-V"],
      ["DIRECCION", "Avenida del Cid, 60, puerta 14, 46018 València"],
      ["TELEFONO", "611 22 33 44"],
      ["CORREO", "yefer.mosquera@gmail.com"],
      ["ORGANO", "Juzgado de lo Penal n.º 7 de Valencia"],
      ["AUTOS", "Ejecutoria 188/2020"],
      ["OBJETO", "la pena de 6 meses de prisión por un delito de hurto"],
      ["NORMA", "artículo 136 del Código Penal"],
      ["ORGANISMO", "Dirección General de Seguridad Jurídica y Fe Pública"],
      ["OBJETO", "cancelación de sus antecedentes penales"],
    ],
  },
];
