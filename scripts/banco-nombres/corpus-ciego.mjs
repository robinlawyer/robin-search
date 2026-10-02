// AJUSTE DE CONVENCIÓN (29-sep, después de la primera pasada): el anexo que Juan revisó dice que
// del «diagnóstico anunciado» se tapa el dato y no el verbo («en tratamiento con [X]», «diagnosticado
// de [X]»). Donde el oro anotaba la frase entera se ha dejado solo el dato. No es afinar: es medir
// con la convención acordada.
//
// Corpus CIEGO — escrito el 29-sep-2026 sin ver las reglas del anonimizador.
// Quien lo escribió NO abrió anonimizador/, corpus.mjs, corpus-validacion.mjs,
// banco.mjs ni pruebas.mjs. Nombres, domicilios e identificadores son inventados
// (los DNI/NIE/CIF/IBAN/NUSS llevan dígito de control válido para ser verosímiles).
// Formato: el mismo que corpus.mjs (id, fuente, clase, expediente?, texto, oro, ambiguo?).
export default [
  // ───────────────────────── 1. Demanda civil, Tribunal de Instancia (LO 1/2025)
  {
    id: 'c-demanda-ordinario-sevilla',
    fuente: 'Demanda de juicio ordinario ante Tribunal de Instancia (nueva planta LO 1/2025)',
    clase: 'nativo',
    texto: `AL TRIBUNAL DE INSTANCIA DE SEVILLA, SECCIÓN CIVIL, PLAZA Nº 4

Doña Macarena Villalobos Ruiz de Castroviejo, Procuradora de los Tribunales, en nombre y representación de Don Rafael Montoya Heredia, mayor de edad, con DNI 28765432-E y domicilio en calle Feria, 112, 3º B, 41003 Sevilla, bajo la dirección letrada de Don Íñigo Arrieta Goikoetxea, colegiado nº 8.765 del Ilustre Colegio de la Abogacía de Sevilla, ante el Tribunal comparezco y como mejor proceda en Derecho DIGO:

Que por medio del presente escrito formulo DEMANDA DE JUICIO ORDINARIO en reclamación de 48.300 euros contra la mercantil CONSTRUCCIONES GUADAIRA 2010, S.L., con CIF B91234567 y domicilio social en Avenida de la Innovación, 5, Edificio Arena 2, planta 1ª, 41020 Sevilla, al amparo de los arts. 1101 y ss. CC y del art. 1591 CC, siendo competente este Tribunal conforme a los arts. 249.1 y 399 LEC y al art. 84 LOPJ.

Mi mandante abonó la suma reclamada mediante transferencia a la cuenta ES91 2100 0418 4502 0005 1332, titularidad de la demandada. Según reiterada doctrina (STS 1234/2024, de 5 de marzo), la ruina funcional es equiparable a la ruina física.`,
    oro: [
      ['ORGANO', 'TRIBUNAL DE INSTANCIA DE SEVILLA, SECCIÓN CIVIL, PLAZA Nº 4'],
      ['PERSONA', 'Macarena Villalobos Ruiz de Castroviejo'],
      ['PERSONA', 'Rafael Montoya Heredia'],
      ['DNI', '28765432-E'],
      ['DIRECCION', 'calle Feria, 112, 3º B, 41003 Sevilla'],
      ['PERSONA', 'Íñigo Arrieta Goikoetxea'],
      ['ORGANISMO', 'Ilustre Colegio de la Abogacía de Sevilla'],
      ['CIF', 'B91234567'],
      // Domicilio SOCIAL de una empresa (29-sep, misma convención que el corpus ciego 2): no es dato de nadie.
      ['NORMA', 'arts. 1101 y ss. CC'],
      ['NORMA', 'art. 1591 CC'],
      ['NORMA', 'arts. 249.1 y 399 LEC'],
      ['NORMA', 'art. 84 LOPJ'],
      ['IBAN', 'ES91 2100 0418 4502 0005 1332'],
      ['NORMA', 'STS 1234/2024, de 5 de marzo'],
    ],
  },

  // ───────────────────────── 2. Auto de orden de protección, Sección de Violencia sobre la Mujer
  {
    id: 'c-auto-orden-proteccion-vsm',
    fuente: 'Auto de orden de protección — Sección de Violencia sobre la Mujer',
    clase: 'nativo',
    texto: `Tribunal de Instancia de Valladolid, Sección de Violencia sobre la Mujer, Plaza nº 1
D.P. 123/2024 — NIG 47186 43 2 2024 0003411

AUTO

En Valladolid, a 12 de marzo de 2024.

HECHOS
PRIMERO.- El 10 de marzo de 2024 se recibió atestado de la Policía Nacional, instruido por los agentes con TIP 118442 y TIP 120915, en el que Yolanda Pisonero Cuesta denuncia que su expareja, Víctor Manuel Garrido Olmedo, la agredió en el domicilio común de calle Labradores, 23, 1º izquierda, de Valladolid. La denunciante fue atendida en el Hospital Clínico Universitario de Valladolid, cuyo informe médico de urgencias refiere una crisis de ansiedad. Consta que el denunciado tiene antecedentes penales por un delito de hurto de 2019.

SEGUNDO.- La Fiscalía Provincial de Valladolid interesó la adopción de orden de protección conforme al art. 544 ter LECrim. Se ha solicitado informe de la Unidad de Valoración Forense Integral y se ha dado traslado a la Oficina de Asistencia a las Víctimas.

PARTE DISPOSITIVA
Se acuerda la prohibición de que Víctor Manuel Garrido se aproxime a menos de 300 metros de Yolanda Pisonero y de que se comunique con ella por cualquier medio, incluido el teléfono 654 321 987.

Lo acuerda y firma S.Sª Dña. Pilar Encinas Llorente, Magistrada. Doy fe, Almudena Recio Tobar, Letrada de la Administración de Justicia.`,
    oro: [
      ['ORGANO', 'Tribunal de Instancia de Valladolid, Sección de Violencia sobre la Mujer, Plaza nº 1'],
      ['AUTOS', 'D.P. 123/2024'],
      ['AUTOS', 'NIG 47186 43 2 2024 0003411'],
      ['ORGANISMO', 'Policía Nacional'],
      ['TIP', 'TIP 118442'],
      ['TIP', 'TIP 120915'],
      ['PERSONA', 'Yolanda Pisonero Cuesta'],
      ['PERSONA', 'Víctor Manuel Garrido Olmedo'],
      ['DIRECCION', 'calle Labradores, 23, 1º izquierda'],
      ['ORGANISMO', 'Hospital Clínico Universitario de Valladolid'],
      ['CAT_ESPECIAL', 'informe médico de urgencias'],
      ['CAT_ESPECIAL', 'ansiedad'],
      ['DATO_PENAL', 'antecedentes penales por un delito de hurto de 2019'],
      ['ORGANISMO', 'Fiscalía Provincial de Valladolid'],
      ['NORMA', 'art. 544 ter LECrim'],
      ['ORGANISMO', 'Unidad de Valoración Forense Integral'],
      ['ORGANISMO', 'Oficina de Asistencia a las Víctimas'],
      ['PERSONA', 'Víctor Manuel Garrido'],
      ['PERSONA', 'Yolanda Pisonero'],
      ['TELEFONO', '654 321 987'],
      ['PONENTE', 'Pilar Encinas Llorente'],
      ['LAJ', 'Almudena Recio Tobar'],
    ],
  },

  // ───────────────────────── 3. Correo interno de despacho (IP objeto + detalle clínico)
  {
    id: 'c-correo-ip-absoluta-bilbao',
    fuente: 'Correo interno entre abogados del despacho',
    clase: 'correo',
    texto: `De: Nerea Etxeberria <nerea.etxeberria@arrietaabogados.es>
Para: Jon Ugalde
Asunto: RE: Pensión de Aitziber — cita con el perito

Hola Jon:

Me llamó ayer Garbiñe desde el móvil (688 12 34 56) para decir que no podrá venir el jueves. Dice que Mikel Zabaleta Iturbe, el perito, ya tiene el informe y que lo firma también Ander Lasa. Te reenvío el correo de Aitziber Olabarria Mendizabal con la resolución del INSS denegando la incapacidad permanente absoluta; en la resolución se reconoce que padece una esclerosis múltiple remitente-recurrente y que está en tratamiento con fingolimod.

Hay que presentar la reclamación previa antes del día 15 ante la Dirección Provincial del INSS en Bizkaia (art. 71 LRJS). Acuérdate de que el Juzgado de lo Social nº 7 de Bilbao ya nos señaló en los autos 512/2023.

Un abrazo,
Nerea`,
    oro: [
      ['PERSONA', 'Nerea Etxeberria'],
      ['CORREO', 'nerea.etxeberria@arrietaabogados.es'],
      ['PERSONA', 'Jon Ugalde'],
      ['PERSONA', 'Jon'],
      ['PERSONA', 'Aitziber'],
      ['PERSONA', 'Garbiñe'],
      ['TELEFONO', '688 12 34 56'],
      ['PERSONA', 'Mikel Zabaleta Iturbe'],
      ['PERSONA', 'Ander Lasa'],
      ['PERSONA', 'Aitziber Olabarria Mendizabal'],
      ['ORGANISMO', 'INSS'],
      ['OBJETO', 'incapacidad permanente absoluta'],
      ['CAT_ESPECIAL', 'esclerosis múltiple remitente-recurrente'],
      ['CAT_ESPECIAL', 'fingolimod'],
      ['ORGANISMO', 'Dirección Provincial del INSS en Bizkaia'],
      ['NORMA', 'art. 71 LRJS'],
      ['ORGANO', 'Juzgado de lo Social nº 7 de Bilbao'],
      ['AUTOS', 'autos 512/2023'],
      ['PERSONA', 'Nerea'],
    ],
  },

  // ───────────────────────── 4. OCR sentencia despido nulo por embarazo
  {
    id: 'c-ocr-despido-nulo-embarazo',
    fuente: 'Sentencia de despido nulo escaneada (OCR)',
    clase: 'ocr',
    texto: `JUZGADO DE LO SOCIAL NUMERO 3 DE MALAGA
AUTOS: DESPIDO 845/2024

EN MALAGA, A 3 DE FEBRERO DE 2025.

VISTOS POR D. ALFONSO PEREA CAÑIZARES, MAGISTRADO-JUEZ DEL JUZGADO DE LO SOCIAL NUMERO 3 DE MALAGA, LOS PRESENTES AUTOS SOBRE DESPIDO SEGUIDOS A INSTANCIA DE DOÑA ROCIO BENITEZ GALLARDO, CON DNI 74859612-V, ASISTIDA POR EL LETRADO D. FRANCISCO JAVIER DEL PINO SANCHEZ, CONTRA LA EMPRESA LIMPIEZAS COSTA DEL SOL, S.A., CON CIF A29456787, Y CONTRA EL FONDO DE GARANTIA SALARIAL.

HECHOS PROBADOS
PRIMERO.- LA ACTORA, CON NUMERO DE AFILIACION A LA SEGURIDAD SOCIAL 29/1045678916, HA VENIDO PRESTANDO SERVICIOS PARA LA DEMANDADA DESDE EL 1 DE MARZO DE 2021.
SEGUNDO.- EL 14 DE JUNIO DE 2024 LA ACTORA COMUNICO A SU ENCARGADA, DOÑA INMACULADA SEDEÑO LUQUE, SU EMBARAZO. EL 21 DE JUNIO DE 2024 FUE DESPEDIDA POR SUPUESTA DISMINUCION DEL RENDIMIENTO.
TERCERO.- LA COMPAÑERA DE LA ACTORA, DOÑA ESTHER MOYANO RUBIO, QUE DECLARO COMO TESTIGO, SE ENCONTRABA EN LAS MISMAS FECHAS DE BAJA POR EMBARAZO DE RIESGO.

FUNDAMENTOS DE DERECHO
UNICO.- CONFORME AL ART. 55.5 B) ET Y A LA DOCTRINA DE LA STC 92/2008, LA NULIDAD ES OBJETIVA Y NO REQUIERE PRUEBA DEL MOVIL DISCRIMINATORIO.

FALLO
ESTIMO LA DEMANDA Y DECLARO NULO EL DESPIDO DE DOÑA ROCIO BENITEZ GALLARDO.`,
    oro: [
      ['ORGANO', 'JUZGADO DE LO SOCIAL NUMERO 3 DE MALAGA'],
      ['AUTOS', 'DESPIDO 845/2024'],
      ['PONENTE', 'ALFONSO PEREA CAÑIZARES'],
      ['PERSONA', 'ROCIO BENITEZ GALLARDO'],
      ['DNI', '74859612-V'],
      ['PERSONA', 'FRANCISCO JAVIER DEL PINO SANCHEZ'],
      ['CIF', 'A29456787'],
      ['ORGANISMO', 'FONDO DE GARANTIA SALARIAL'],
      ['NUSS', '29/1045678916'],
      ['PERSONA', 'INMACULADA SEDEÑO LUQUE'],
      ['OBJETO', 'SU EMBARAZO'],
      ['PERSONA', 'ESTHER MOYANO RUBIO'],
      ['CAT_ESPECIAL', 'BAJA POR EMBARAZO DE RIESGO'],
      ['NORMA', 'ART. 55.5 B) ET'],
      ['NORMA', 'STC 92/2008'],
    ],
  },

  // ───────────────────────── 5. OCR atestado Mossos
  {
    id: 'c-ocr-atestado-mossos',
    fuente: 'Atestado de Mossos d’Esquadra escaneado (OCR)',
    clase: 'ocr',
    texto: `MOSSOS D'ESQUADRA - COMISSARIA DE GIRONA
ATESTADO NUM. 2024/118765

DILIGENCIA DE EXPOSICION DE HECHOS: LOS AGENTES CON TIP 11873 Y TIP 14502 SE PERSONAN EN LA CALLE DEL CARME, 45, BAJOS, DE GIRONA, DONDE LOCALIZAN A JORDI CASADEVALL I FERRER, QUE CONDUCIA EL VEHICULO CON MATRICULA 4521 KLM. EL CONDUCTOR MANIFIESTA ESTAR EN TRATAMIENTO CON METADONA. REALIZADA LA PRUEBA DE ALCOHOLEMIA ARROJA 0,62 MG/L. CONSULTADAS LAS BASES DE DATOS, EL CONDUCTOR CUENTA CON ANTECEDENTES POR CONDUCCION SIN PERMISO.
VIAJA COMO PASAJERO MAMADOU DIALLO, NACIDO EN SENEGAL, CON NIE Y-4567123-G Y TELEFONO 972 21 43 65, QUE NO PRESENTA SINTOMAS.
INSTRUYE EL ATESTADO EL AGENTE SERGI ROVIRA PLANAS. SE DA CUENTA AL JUTJAT DE GUARDIA DE GIRONA.`,
    oro: [
      ['ORGANISMO', "MOSSOS D'ESQUADRA"],
      ['AUTOS', 'ATESTADO NUM. 2024/118765'],
      ['TIP', 'TIP 11873'],
      ['TIP', 'TIP 14502'],
      ['DIRECCION', 'CALLE DEL CARME, 45, BAJOS'],
      ['PERSONA', 'JORDI CASADEVALL I FERRER'],
      ['MATRICULA', '4521 KLM'],
      ['CAT_ESPECIAL', 'METADONA'],
      ['DATO_PENAL', 'ANTECEDENTES POR CONDUCCION SIN PERMISO'],
      ['PERSONA', 'MAMADOU DIALLO'],
      ['NIE', 'Y-4567123-G'],
      ['TELEFONO', '972 21 43 65'],
      ['PERSONA', 'SERGI ROVIRA PLANAS'],
      ['ORGANO', 'JUTJAT DE GUARDIA DE GIRONA'],
    ],
  },

  // ───────────────────────── 6. Interlocutòria en catalán
  {
    id: 'c-interlocutoria-girona-cat',
    fuente: 'Interlocutòria de Jutjat de Primera Instància (en catalán)',
    clase: 'nativo',
    texto: `Jutjat de Primera Instància núm. 3 de Girona
Procediment verbal 334/2024-C

INTERLOCUTÒRIA

Girona, 7 de maig de 2024

FETS
La procuradora Montserrat Vilaró i Pujol, en nom de Pere Bosch Serrallonga, veí de Banyoles, amb domicili al carrer de la Muralla, 8, 2n 1a, 17820 Banyoles, ha presentat demanda contra Laia Coromines Sitjà, amb DNI 40334455E, en reclamació de possessió d'una finca.

FONAMENTS DE DRET
D'acord amb l'article 250.1.4 LEC i l'article 541-1 del Codi civil de Catalunya, s'admet a tràmit la demanda. Es lliura exhort al Jutjat de Pau de Porqueres per a la citació de la demandada.

La jutgessa, Núria Casals Vidal.
La lletrada de l'Administració de Justícia, Anna Soler Batlle.`,
    oro: [
      ['ORGANO', 'Jutjat de Primera Instància núm. 3 de Girona'],
      ['AUTOS', 'Procediment verbal 334/2024-C'],
      ['PERSONA', 'Montserrat Vilaró i Pujol'],
      ['PERSONA', 'Pere Bosch Serrallonga'],
      ['DIRECCION', 'carrer de la Muralla, 8, 2n 1a, 17820 Banyoles'],
      ['PERSONA', 'Laia Coromines Sitjà'],
      ['DNI', '40334455E'],
      ['NORMA', 'article 250.1.4 LEC'],
      ['NORMA', 'article 541-1 del Codi civil de Catalunya'],
      ['ORGANO', 'Jutjat de Pau de Porqueres'],
      ['PONENTE', 'Núria Casals Vidal'],
      ['LAJ', 'Anna Soler Batlle'],
    ],
  },

  // ───────────────────────── 7. Sentenza en gallego (IP total objeto + discapacidad %)
  {
    id: 'c-sentenza-vigo-gal',
    fuente: 'Sentenza do Xulgado do Social (en galego)',
    clase: 'nativo',
    texto: `Xulgado do Social número 2 de Vigo
Procedemento: Seguridade Social 221/2024

SENTENZA

Vigo, 18 de novembro de 2024.

A maxistrada-xuíza, Uxía Rodríguez Seoane, ditou a seguinte sentenza no procedemento promovido por Xosé Manuel Outeiriño Castro, con domicilio na rúa do Príncipe, 34, 4º dereita, 36202 Vigo, contra o Instituto Nacional da Seguridade Social e a Tesourería Xeral da Seguridade Social.

FEITOS PROBADOS
Primeiro.- O demandante solicita que se lle recoñeza a incapacidade permanente total para a súa profesión habitual de mariñeiro.
Segundo.- Consta no informe médico de síntese que presenta unha lumbociática crónica con hernia discal L5-S1.
Terceiro.- A Consellería de Política Social da Xunta de Galicia recoñeceulle un grao de discapacidade do 33 %.

Fundamento: art. 194 LGSS.

A letrada da Administración de Xustiza, Brais Lamas Figueiras.`,
    oro: [
      ['ORGANO', 'Xulgado do Social número 2 de Vigo'],
      ['AUTOS', 'Seguridade Social 221/2024'],
      ['PONENTE', 'Uxía Rodríguez Seoane'],
      ['PERSONA', 'Xosé Manuel Outeiriño Castro'],
      ['DIRECCION', 'rúa do Príncipe, 34, 4º dereita, 36202 Vigo'],
      ['ORGANISMO', 'Instituto Nacional da Seguridade Social'],
      ['ORGANISMO', 'Tesourería Xeral da Seguridade Social'],
      ['OBJETO', 'incapacidade permanente total'],
      ['CAT_ESPECIAL', 'informe médico de síntese'],
      ['CAT_ESPECIAL', 'lumbociática crónica con hernia discal L5-S1'],
      ['ORGANISMO', 'Consellería de Política Social da Xunta de Galicia'],
      ['CAT_ESPECIAL', 'grao de discapacidade do 33 %'],
      ['NORMA', 'art. 194 LGSS'],
      ['LAJ', 'Brais Lamas Figueiras'],
    ],
  },

  // ───────────────────────── 8. Diligencia bilingüe euskera/castellano
  {
    id: 'c-diligencia-bilbao-eus',
    fuente: 'Diligencia de ordenación bilingüe (euskera / castellano)',
    clase: 'nativo',
    texto: `Bilboko Lehen Auzialdiko 5 zenbakiko Epaitegia / Juzgado de Primera Instancia nº 5 de Bilbao
Prozedura arrunta / Procedimiento ordinario 1022/2023
NIG PV 48.04.2-23/018765

ANTOLAMENDU EGINBIDEA / DILIGENCIA DE ORDENACIÓN
Justizia Administrazioko letratua / Letrada de la Administración de Justicia: Itziar Mendieta Olaizola.

En Bilbao, a 4 de abril de 2024.

Se tiene por personado al procurador Unai Bengoetxea Arrieta en nombre de Koldo Aranburu Elorza. No habiendo podido emplazarse a la demandada, Amaia Irazu Lekue, en su último domicilio conocido, Kale Nagusia, 14, 3. ezkerra, 48960 Galdakao, se acuerda librar oficio a la Ertzaintza y a la Diputación Foral de Bizkaia / Bizkaiko Foru Aldundia (Hacienda Foral) para averiguación de domicilio, conforme al art. 156 LEC.`,
    oro: [
      ['ORGANO', 'Bilboko Lehen Auzialdiko 5 zenbakiko Epaitegia'],
      ['ORGANO', 'Juzgado de Primera Instancia nº 5 de Bilbao'],
      ['AUTOS', 'Procedimiento ordinario 1022/2023'],
      ['AUTOS', 'NIG PV 48.04.2-23/018765'],
      ['LAJ', 'Itziar Mendieta Olaizola'],
      ['PERSONA', 'Unai Bengoetxea Arrieta'],
      ['PERSONA', 'Koldo Aranburu Elorza'],
      ['PERSONA', 'Amaia Irazu Lekue'],
      ['DIRECCION', 'Kale Nagusia, 14, 3. ezkerra, 48960 Galdakao'],
      ['ORGANISMO', 'Ertzaintza'],
      ['ORGANISMO', 'Diputación Foral de Bizkaia'],
      ['ORGANISMO', 'Bizkaiko Foru Aldundia'],
      ['ORGANISMO', 'Hacienda Foral'],
      ['NORMA', 'art. 156 LEC'],
    ],
  },

  // ───────────────────────── 9. EXPEDIENTE familia Salcedo/Quiroga (3 fragmentos)
  {
    id: 'c-exp-salcedo-1-demanda',
    fuente: 'Demanda de modificación de medidas (alcoholismo como fundamento)',
    clase: 'nativo',
    expediente: 'exp-salcedo-quiroga',
    texto: `AL TRIBUNAL DE INSTANCIA DE MADRID, SECCIÓN DE FAMILIA, INFANCIA Y CAPACIDAD, PLAZA Nº 22

Doña Lucía Quiroga Fernández-Arias, con DNI 50987321-R y domicilio en calle de Alcalá, 214, 5º C, 28028 Madrid, representada por el procurador Don Álvaro de la Fuente y Sáenz de Tejada, formula DEMANDA DE MODIFICACIÓN DE MEDIDAS DEFINITIVAS respecto de la sentencia de divorcio dictada en los autos 1450/2019, contra Don Diego Salcedo Muñoz, vecino de Alcobendas, padre de los menores Pablo Salcedo Quiroga e Irene Salcedo Quiroga.

HECHOS
PRIMERO.- El fundamento de la modificación es el alcoholismo del demandado, que se ha agravado desde 2023 y le impide atender a los menores durante sus fines de semana (art. 775 LEC y art. 90.3 CC).
SEGUNDO.- El Sr. Salcedo acudió a recoger a Pablo el 3 de febrero de 2024 en estado de embriaguez, según el atestado de la Policía Municipal de Madrid.`,
    oro: [
      ['ORGANO', 'TRIBUNAL DE INSTANCIA DE MADRID, SECCIÓN DE FAMILIA, INFANCIA Y CAPACIDAD, PLAZA Nº 22'],
      ['PERSONA', 'Lucía Quiroga Fernández-Arias'],
      ['DNI', '50987321-R'],
      ['DIRECCION', 'calle de Alcalá, 214, 5º C, 28028 Madrid'],
      ['PERSONA', 'Álvaro de la Fuente y Sáenz de Tejada'],
      ['AUTOS', 'autos 1450/2019'],
      ['PERSONA', 'Diego Salcedo Muñoz'],
      ['PERSONA', 'Pablo Salcedo Quiroga'],
      ['PERSONA', 'Irene Salcedo Quiroga'],
      ['OBJETO', 'alcoholismo'],
      ['NORMA', 'art. 775 LEC'],
      ['NORMA', 'art. 90.3 CC'],
      ['PERSONA', 'Salcedo'],
      ['PERSONA', 'Pablo'],
      ['OBJETO', 'estado de embriaguez'],
      ['ORGANISMO', 'Policía Municipal de Madrid'],
    ],
    ambiguo: ['Salcedo'],
  },
  {
    id: 'c-exp-salcedo-2-acta',
    fuente: 'Acta de la vista de modificación de medidas',
    clase: 'nativo',
    expediente: 'exp-salcedo-quiroga',
    texto: `Tribunal de Instancia de Madrid, Sección de Familia, Infancia y Capacidad, Plaza nº 22
Modificación de medidas 388/2024

ACTA DE LA VISTA

Comparecen la actora, Lucía Quiroga, asistida de su letrada, y el demandado, Salcedo Muñoz, asistido del letrado Gonzalo Vallejo Prieto.

Declara el demandado, que reconoce haber tenido problemas con la bebida, pero afirma que desde enero sigue un programa de deshabituación y toma disulfiram pautado por su médico.

Testigo: Carmen Quiroga Fernández-Arias, hermana de la actora. Manifiesta que la Sra. Quiroga le pidió que recogiera a los niños varios domingos porque el padre no estaba en condiciones.

Testigo: Rosendo Ibáñez Pastor, vecino del demandado. Manifiesta que él mismo estuvo en tratamiento por ludopatía y que coincidió con Salcedo en el bar del portal casi a diario.

Con lo que se da por terminado el acto. La Letrada de la Administración de Justicia, Beatriz Olmos Carrasco.`,
    oro: [
      ['ORGANO', 'Tribunal de Instancia de Madrid, Sección de Familia, Infancia y Capacidad, Plaza nº 22'],
      ['AUTOS', 'Modificación de medidas 388/2024'],
      ['PERSONA', 'Lucía Quiroga'],
      ['PERSONA', 'Salcedo Muñoz'],
      ['PERSONA', 'Gonzalo Vallejo Prieto'],
      ['OBJETO', 'problemas con la bebida'],
      ['CAT_ESPECIAL', 'programa de deshabituación'],
      ['CAT_ESPECIAL', 'disulfiram'],
      ['PERSONA', 'Carmen Quiroga Fernández-Arias'],
      ['PERSONA', 'Quiroga'],
      ['PERSONA', 'Rosendo Ibáñez Pastor'],
      ['CAT_ESPECIAL', 'ludopatía'],
      ['PERSONA', 'Salcedo'],
      ['LAJ', 'Beatriz Olmos Carrasco'],
    ],
    ambiguo: ['Quiroga', 'Salcedo'],
  },
  {
    id: 'c-exp-salcedo-3-psicosocial',
    fuente: 'Informe del equipo psicosocial adscrito al juzgado de familia',
    clase: 'nativo',
    expediente: 'exp-salcedo-quiroga',
    texto: `INFORME PSICOSOCIAL — Modificación de medidas 388/2024

Entrevistas realizadas por Gorka Uriarte Basterra, psicólogo, y Marisa Toledano Gil, trabajadora social, del Equipo Técnico Psicosocial de los Juzgados de Familia de Madrid.

Irene, de 11 años, expresa con claridad que prefiere no pernoctar en casa del padre. Pablo, de 8, se muestra más ambivalente. Ambos refieren que Salcedo Muñoz se queda dormido en el sofá por las tardes.

La abuela paterna, Remedios Muñoz Tello, con quien los menores pasaban parte de las visitas, padece alzhéimer en fase moderada y ya no puede hacerse cargo de ellos.

La madre, Quiroga Fernández-Arias, trabaja a turnos en el Hospital Universitario La Paz y cuenta con el apoyo de su hermana Carmen.`,
    oro: [
      ['AUTOS', 'Modificación de medidas 388/2024'],
      ['PERSONA', 'Gorka Uriarte Basterra'],
      ['PERSONA', 'Marisa Toledano Gil'],
      ['ORGANISMO', 'Equipo Técnico Psicosocial de los Juzgados de Familia de Madrid'],
      ['PERSONA', 'Irene'],
      ['PERSONA', 'Pablo'],
      ['PERSONA', 'Salcedo Muñoz'],
      ['PERSONA', 'Remedios Muñoz Tello'],
      ['CAT_ESPECIAL', 'alzhéimer en fase moderada'],
      ['PERSONA', 'Quiroga Fernández-Arias'],
      ['ORGANISMO', 'Hospital Universitario La Paz'],
      ['PERSONA', 'Carmen'],
    ],
    ambiguo: ['Quiroga Fernández-Arias', 'Carmen'],
  },

  // ───────────────────────── 10. EXPEDIENTE penal hermanos Ferreiro (3 fragmentos)
  {
    id: 'c-exp-ferreiro-1-auto-pa',
    fuente: 'Auto de transformación en procedimiento abreviado',
    clase: 'nativo',
    expediente: 'exp-ferreiro',
    texto: `Tribunal de Instancia de Ourense, Sección de Instrucción, Plaza nº 2
D.P. 876/2023 — P.A. 45/2024

AUTO DE TRANSFORMACIÓN EN PROCEDIMIENTO ABREVIADO

HECHOS
De lo actuado resultan indicios de que el 22 de octubre de 2023 Brais Ferreiro Doval, con DNI 44556677-L, y su hermano Anxo Ferreiro Doval, con DNI 44556678-C, ambos domiciliados en Avenida de Zamora, 77, 2º A, 32005 Ourense, accedieron forzando la persiana al establecimiento de telefonía de la calle del Paseo y se apoderaron de catorce terminales. Así lo relata la empleada Dolores Rivas Seoane y lo recoge el atestado de la Guardia Civil (Puesto de Allariz), instruido por el agente con TIP U-34215.

RAZONAMIENTOS JURÍDICOS
Los hechos pueden ser constitutivos de un delito de robo con fuerza de los arts. 237 y 240 CP, por lo que procede seguir los trámites del art. 779.1.4ª LECrim. Dese traslado al Ministerio Fiscal.

Lo manda y firma el Magistrado, Carlos Ogando Vidal. Doy fe, la LAJ, Sabela Pazos Rey.`,
    oro: [
      ['ORGANO', 'Tribunal de Instancia de Ourense, Sección de Instrucción, Plaza nº 2'],
      ['AUTOS', 'D.P. 876/2023'],
      ['AUTOS', 'P.A. 45/2024'],
      ['PERSONA', 'Brais Ferreiro Doval'],
      ['DNI', '44556677-L'],
      ['PERSONA', 'Anxo Ferreiro Doval'],
      ['DNI', '44556678-C'],
      ['DIRECCION', 'Avenida de Zamora, 77, 2º A, 32005 Ourense'],
      ['PERSONA', 'Dolores Rivas Seoane'],
      ['ORGANISMO', 'Guardia Civil'],
      ['TIP', 'TIP U-34215'],
      ['NORMA', 'arts. 237 y 240 CP'],
      ['NORMA', 'art. 779.1.4ª LECrim'],
      ['ORGANISMO', 'Ministerio Fiscal'],
      ['PONENTE', 'Carlos Ogando Vidal'],
      ['LAJ', 'Sabela Pazos Rey'],
    ],
  },
  {
    id: 'c-exp-ferreiro-2-defensa',
    fuente: 'Escrito de defensa (reincidencia y drogadicción como objeto)',
    clase: 'nativo',
    expediente: 'exp-ferreiro',
    texto: `AL JUZGADO DE LO PENAL Nº 2 DE OURENSE
P.A. 45/2024

Don Manuel Otero Lamas, abogado del Colegio de la Abogacía de Ourense, en defensa de Anxo Ferreiro Doval, formula ESCRITO DE DEFENSA:

PRIMERA.- Frente a la agravante de reincidencia (art. 22.8ª CP) que el Ministerio Fiscal aplica a los hermanos Ferreiro, esta parte sostiene que la condena anterior de mi defendido (Ejecutoria 88/2019 del Juzgado de lo Penal nº 1 de Ourense) debió estar cancelada conforme al art. 136 CP.

SEGUNDA.- Anxo Ferreiro actuó bajo los efectos de su drogadicción, por lo que se interesa la atenuante del art. 21.2ª CP. Consta la historia clínica del Centro de Atención a Drogodependientes de Ourense y el testimonio de su madre, Pilar Doval Carballo.

TERCERA.- Respecto de Brais, esta defensa nada tiene que alegar.`,
    oro: [
      ['ORGANO', 'JUZGADO DE LO PENAL Nº 2 DE OURENSE'],
      ['AUTOS', 'P.A. 45/2024'],
      ['PERSONA', 'Manuel Otero Lamas'],
      ['ORGANISMO', 'Colegio de la Abogacía de Ourense'],
      ['PERSONA', 'Anxo Ferreiro Doval'],
      ['OBJETO', 'agravante de reincidencia'],
      ['NORMA', 'art. 22.8ª CP'],
      ['ORGANISMO', 'Ministerio Fiscal'],
      ['PERSONA', 'Ferreiro'],
      ['OBJETO', 'condena anterior'],
      ['AUTOS', 'Ejecutoria 88/2019'],
      ['ORGANO', 'Juzgado de lo Penal nº 1 de Ourense'],
      ['NORMA', 'art. 136 CP'],
      ['PERSONA', 'Anxo Ferreiro'],
      ['OBJETO', 'drogadicción'],
      ['NORMA', 'art. 21.2ª CP'],
      ['CAT_ESPECIAL', 'historia clínica'],
      ['ORGANISMO', 'Centro de Atención a Drogodependientes de Ourense'],
      ['PERSONA', 'Pilar Doval Carballo'],
      ['PERSONA', 'Brais'],
    ],
    ambiguo: ['Ferreiro'],
  },
  {
    id: 'c-exp-ferreiro-3-ocr-sentencia',
    fuente: 'Sentencia penal escaneada (OCR)',
    clase: 'ocr',
    expediente: 'exp-ferreiro',
    texto: `JUZGADO DE LO PENAL NUMERO 2 DE OURENSE
PROCEDIMIENTO ABREVIADO 45/2024
SENTENCIA

MAGISTRADA: MARIA XOSE CARBALLO NUÑEZ

HECHOS PROBADOS
SE DECLARA PROBADO QUE FERREIRO DOVAL, EL MAYOR DE LOS HERMANOS, FORZO LA PERSIANA MIENTRAS EL OTRO VIGILABA. EL AGENTE DE LA GUARDIA CIVIL CON TIP U-34215 RATIFICO EL ATESTADO. EL TESTIGO RAMIRO CID BARJA, QUE CUMPLIO CONDENA EN EL CENTRO PENITENCIARIO DE PEREIRO DE AGUIAR, DECLARO HABER COMPRADO DOS DE LOS TERMINALES.

FALLO
CONDENO A BRAIS FERREIRO DOVAL Y A ANXO FERREIRO DOVAL COMO AUTORES DE UN DELITO DE ROBO CON FUERZA DEL ART. 240 CP.`,
    oro: [
      ['ORGANO', 'JUZGADO DE LO PENAL NUMERO 2 DE OURENSE'],
      ['AUTOS', 'PROCEDIMIENTO ABREVIADO 45/2024'],
      ['PONENTE', 'MARIA XOSE CARBALLO NUÑEZ'],
      ['PERSONA', 'FERREIRO DOVAL'],
      ['ORGANISMO', 'GUARDIA CIVIL'],
      ['TIP', 'TIP U-34215'],
      ['PERSONA', 'RAMIRO CID BARJA'],
      ['DATO_PENAL', 'CUMPLIO CONDENA'],
      // Donde cumplió condena es parte del dato penal (criterio de los corpus 2 y 3, 29-sep).
      ['PERSONA', 'BRAIS FERREIRO DOVAL'],
      ['PERSONA', 'ANXO FERREIRO DOVAL'],
      ['NORMA', 'ART. 240 CP'],
    ],
    ambiguo: ['FERREIRO DOVAL'],
  },

  // ───────────────────────── 11. EXPEDIENTE concurso Beltrán padre e hijo (2 fragmentos)
  {
    id: 'c-exp-beltran-1-solicitud',
    fuente: 'Solicitud de concurso voluntario',
    clase: 'nativo',
    expediente: 'exp-beltran',
    texto: `AL TRIBUNAL DE INSTANCIA DE VALENCIA, SECCIÓN DE LO MERCANTIL, PLAZA Nº 1 (antes Juzgado de lo Mercantil nº 1 de Valencia)

D. Joaquín Beltrán Ribera, con DNI 52123987-F, administrador único de TALLERES BELTRÁN E HIJOS, S.L., con CIF B46789012 y domicilio en Polígono Industrial Fuente del Jarro, calle Ciudad de Sevilla, 23, 46988 Paterna, asistido por su hijo y apoderado, D. Joaquín Beltrán Oliver, solicita la declaración de CONCURSO VOLUNTARIO de la sociedad al amparo de los arts. 2 y 5 TRLC.

La sociedad mantiene deudas con la TGSS, con la AEAT y con la Conselleria de Hacienda de la Generalitat Valenciana. Los pagos pueden dirigirse a la cuenta ES35 0081 0216 7100 0012 3456. A efectos de notificaciones: teléfono 961 32 45 67 y correo administracion@talleresbeltran.es.`,
    oro: [
      ['ORGANO', 'TRIBUNAL DE INSTANCIA DE VALENCIA, SECCIÓN DE LO MERCANTIL, PLAZA Nº 1'],
      ['ORGANO', 'Juzgado de lo Mercantil nº 1 de Valencia'],
      ['PERSONA', 'Joaquín Beltrán Ribera'],
      ['DNI', '52123987-F'],
      ['CIF', 'B46789012'],
      ['DIRECCION', 'Polígono Industrial Fuente del Jarro, calle Ciudad de Sevilla, 23, 46988 Paterna'],
      ['PERSONA', 'Joaquín Beltrán Oliver'],
      ['NORMA', 'arts. 2 y 5 TRLC'],
      ['ORGANISMO', 'TGSS'],
      ['ORGANISMO', 'AEAT'],
      ['ORGANISMO', 'Conselleria de Hacienda de la Generalitat Valenciana'],
      ['IBAN', 'ES35 0081 0216 7100 0012 3456'],
      ['TELEFONO', '961 32 45 67'],
      ['CORREO', 'administracion@talleresbeltran.es'],
    ],
  },
  {
    id: 'c-exp-beltran-2-informe-ac',
    fuente: 'Informe de la administración concursal (art. 292 TRLC)',
    clase: 'nativo',
    expediente: 'exp-beltran',
    texto: `INFORME DE LA ADMINISTRACIÓN CONCURSAL — Concurso ordinario 311/2024

La administradora concursal, Vicenta Marí Escrivà, economista, expone:

1. La gestión efectiva correspondía a Beltrán Oliver desde 2021. Beltrán Ribera, que tiene reconocida una discapacidad del 65 por ciento por la Conselleria de Servicios Sociales de la Generalitat Valenciana, se limitaba a firmar lo que le presentaban.

2. El comité de empresa, presidido por Amparo Llopis Sanchis, delegada de CCOO, comunicó impagos de nóminas desde marzo. El antiguo encargado de la nave, casado con la hermana del administrador, retiró herramientas sin justificante.

3. Los dos Joaquín firmaron indistintamente las disposiciones de caja; el Sr. Beltrán no ha sabido explicar cuál de ellos autorizó cada una.

Todo ello conforme al art. 292 TRLC y concordantes.`,
    oro: [
      ['AUTOS', 'Concurso ordinario 311/2024'],
      ['PERSONA', 'Vicenta Marí Escrivà'],
      ['PERSONA', 'Beltrán Oliver'],
      ['PERSONA', 'Beltrán Ribera'],
      ['CAT_ESPECIAL', 'discapacidad del 65 por ciento'],
      ['ORGANISMO', 'Conselleria de Servicios Sociales de la Generalitat Valenciana'],
      ['PERSONA', 'Amparo Llopis Sanchis'],
      ['CAT_ESPECIAL', 'delegada de CCOO'],
      ['PERIFRASIS', 'El antiguo encargado de la nave, casado con la hermana del administrador'],
      ['PERSONA', 'Joaquín'],
      ['PERSONA', 'Beltrán'],
      ['NORMA', 'art. 292 TRLC'],
    ],
    ambiguo: ['Joaquín', 'Beltrán'],
  },

  // ───────────────────────── 12. OCR TSJ Catalunya suplicación (IP objeto vs IP incidental de tercero)
  {
    id: 'c-ocr-tsj-catalunya-suplicacion',
    fuente: 'Sentencia de suplicación del TSJ escaneada (OCR)',
    clase: 'ocr',
    texto: `TRIBUNAL SUPERIOR DE JUSTICIA DE CATALUNYA
SALA DE LO SOCIAL
RECURSO DE SUPLICACION 2345/2024

ILMA. SRA. DÑA. MERCE ALEGRET FONT (PONENTE)

EN BARCELONA, A 10 DE ENERO DE 2025.

RECURSO INTERPUESTO POR EL INSTITUTO NACIONAL DE LA SEGURIDAD SOCIAL CONTRA LA SENTENCIA DEL JUZGADO DE LO SOCIAL NUM. 14 DE BARCELONA EN AUTOS 670/2023, SEGUIDOS A INSTANCIA DE D. OSCAR MARTORELL CODINA, CON NUMERO DE AFILIACION 08/1234567869, QUE LE RECONOCIO LA INCAPACIDAD PERMANENTE TOTAL.

HECHOS PROBADOS: EL ACTOR PADECE TRASTORNO BIPOLAR TIPO I CON INGRESOS HOSPITALARIOS EN 2021 Y 2022. SU ESPOSA, DOÑA LAURA PAGES ROCA, PERCIBE PENSION DE INCAPACIDAD PERMANENTE ABSOLUTA DESDE 2018.

FUNDAMENTOS: ART. 194 LGSS. STS 1234/2024, DE 5 DE MARZO (ECLI:ES:TS:2024:1234).`,
    oro: [
      ['ORGANO', 'TRIBUNAL SUPERIOR DE JUSTICIA DE CATALUNYA'],
      ['ORGANO', 'SALA DE LO SOCIAL'],
      ['AUTOS', 'RECURSO DE SUPLICACION 2345/2024'],
      ['PONENTE', 'MERCE ALEGRET FONT'],
      ['ORGANISMO', 'INSTITUTO NACIONAL DE LA SEGURIDAD SOCIAL'],
      ['ORGANO', 'JUZGADO DE LO SOCIAL NUM. 14 DE BARCELONA'],
      ['AUTOS', 'AUTOS 670/2023'],
      ['PERSONA', 'OSCAR MARTORELL CODINA'],
      ['NUSS', '08/1234567869'],
      ['OBJETO', 'INCAPACIDAD PERMANENTE TOTAL'],
      ['CAT_ESPECIAL', 'TRASTORNO BIPOLAR TIPO I'],
      ['CAT_ESPECIAL', 'INGRESOS HOSPITALARIOS'],
      ['PERSONA', 'LAURA PAGES ROCA'],
      ['CAT_ESPECIAL', 'INCAPACIDAD PERMANENTE ABSOLUTA'],
      ['NORMA', 'ART. 194 LGSS'],
      ['NORMA', 'STS 1234/2024, DE 5 DE MARZO'],
      ['ECLI', 'ECLI:ES:TS:2024:1234'],
    ],
  },

  // ───────────────────────── 13. Contencioso TSJ Andalucía (objeción de conciencia, religión, país)
  {
    id: 'c-apelacion-tsja-objecion',
    fuente: 'Sentencia de apelación de Sala de lo Contencioso-Administrativo de TSJ',
    clase: 'nativo',
    texto: `Sala de lo Contencioso-Administrativo del Tribunal Superior de Justicia de Andalucía, con sede en Granada, Sección Primera
Rec. 1234/2023 — Apelación contra la sentencia del Juzgado de lo Contencioso-Administrativo nº 3 de Almería en el P.A. 212/2022

Ponente: Ilmo. Sr. D. Federico Garcés Montilla

ANTECEDENTES
La apelante, Samira El Amrani Bouzid, nacida en Tetuán (Marruecos), con NIE X-1234567-L y enfermera del Hospital Universitario Torrecárdenas, impugna la resolución de la Consejería de Salud y Consumo de la Junta de Andalucía que la excluyó de la bolsa de trabajo tras haber manifestado su objeción de conciencia a la práctica de la interrupción voluntaria del embarazo. Alega, además, un trato discriminatorio por ser de religión musulmana.

FUNDAMENTOS
Invoca los arts. 14, 16 y 24 CE, el art. 16 de la LO 2/2010 y el art. 85 LJCA. Cita la STC 151/2014 y la STS 1560/2023 (ROJ: STS 1560/2023).`,
    oro: [
      // En categoría especial, en la duda se tapa (Juan, 21 y 26-sep).,
      ['CAT_ESPECIAL', 'interrupción voluntaria del embarazo'],
      ['ORGANO', 'Sala de lo Contencioso-Administrativo del Tribunal Superior de Justicia de Andalucía, con sede en Granada, Sección Primera'],
      ['AUTOS', 'Rec. 1234/2023'],
      ['ORGANO', 'Juzgado de lo Contencioso-Administrativo nº 3 de Almería'],
      ['AUTOS', 'P.A. 212/2022'],
      ['PONENTE', 'Federico Garcés Montilla'],
      ['PERSONA', 'Samira El Amrani Bouzid'],
      ['NIE', 'X-1234567-L'],
      ['ORGANISMO', 'Hospital Universitario Torrecárdenas'],
      ['ORGANISMO', 'Consejería de Salud y Consumo de la Junta de Andalucía'],
      ['CAT_ESPECIAL', 'objeción de conciencia'],
      ['CAT_ESPECIAL', 'religión musulmana'],
      ['NORMA', 'arts. 14, 16 y 24 CE'],
      ['NORMA', 'art. 16 de la LO 2/2010'],
      ['NORMA', 'art. 85 LJCA'],
      ['NORMA', 'STC 151/2014'],
      ['ROJ', 'ROJ: STS 1560/2023'],
    ],
  },

  // ───────────────────────── 14. Juzgado Central de Instrucción
  {
    id: 'c-jci-comision-rogatoria',
    fuente: 'Providencia de Juzgado Central de Instrucción (blanqueo)',
    clase: 'nativo',
    texto: `JUZGADO CENTRAL DE INSTRUCCIÓN Nº 5
AUDIENCIA NACIONAL
Diligencias Previas 67/2024

PROVIDENCIA
Magistrado sustituto: D. Ernesto Lucena Arjona.

Madrid, 2 de julio de 2024.

Recibido el informe de la Unidad Central Operativa (UCO) de la Guardia Civil y la comunicación del SEPBLAC, se acuerda tomar declaración como investigado a Dmitri Aleksandrovich Volkov, con NIE X-9876543-K, y como testigo a Hans-Peter Müller, con domicilio en Urbanización Nueva Andalucía, calle Los Naranjos, 12, 29660 Marbella. Se libra comisión rogatoria a las autoridades de Chipre para el bloqueo de la cuenta vinculada, con reflejo en la cuenta española ES95 2095 0611 0409 1234 5678.

Contra esta resolución cabe recurso de reforma (art. 217 LECrim) y, en su caso, apelación ante la Sala de lo Penal de la Audiencia Nacional.

Lo manda y firma S.Sª. Doy fe, la Letrada de la Administración de Justicia, Marta Iglesias Palacio.`,
    oro: [
      ['ORGANO', 'JUZGADO CENTRAL DE INSTRUCCIÓN Nº 5'],
      ['ORGANO', 'AUDIENCIA NACIONAL'],
      ['AUTOS', 'Diligencias Previas 67/2024'],
      ['PONENTE', 'Ernesto Lucena Arjona'],
      ['ORGANISMO', 'Unidad Central Operativa (UCO) de la Guardia Civil'],
      ['ORGANISMO', 'SEPBLAC'],
      ['PERSONA', 'Dmitri Aleksandrovich Volkov'],
      ['NIE', 'X-9876543-K'],
      ['PERSONA', 'Hans-Peter Müller'],
      ['DIRECCION', 'Urbanización Nueva Andalucía, calle Los Naranjos, 12, 29660 Marbella'],
      ['IBAN', 'ES95 2095 0611 0409 1234 5678'],
      ['NORMA', 'art. 217 LECrim'],
      ['ORGANO', 'Sala de lo Penal de la Audiencia Nacional'],
      ['LAJ', 'Marta Iglesias Palacio'],
    ],
  },

  // ───────────────────────── 15. Juzgado de Menores (etnia vs país; TDAH y medicación)
  {
    id: 'c-menores-sevilla-reforma',
    fuente: 'Informe del Equipo Técnico en expediente de reforma de menores',
    clase: 'nativo',
    texto: `Juzgado de Menores nº 1 de Sevilla
Expediente de Reforma 234/2024 — Fiscalía de Menores de Sevilla

INFORME DEL EQUIPO TÉCNICO (art. 27 LORPM)

El menor Kevin Heredia Montoya, de 16 años, de etnia gitana, reside con su madre, Esperanza Montoya Vargas, en calle Parras, 17, bajo, 41002 Sevilla. Su padre, nacido en Rumanía, reside en Bucarest y no mantiene contacto.

Está diagnosticado de TDAH desde los 9 años y en tratamiento con metilfenidato, aunque la madre refiere que no lo toma con regularidad. La trabajadora social que firma, Rocío Justicia Moreno, propone la medida de libertad vigilada del art. 7.1.h) LORPM, con seguimiento por la Consejería de Inclusión Social, Juventud, Familias e Igualdad de la Junta de Andalucía.`,
    oro: [
      ['ORGANO', 'Juzgado de Menores nº 1 de Sevilla'],
      ['AUTOS', 'Expediente de Reforma 234/2024'],
      ['ORGANISMO', 'Fiscalía de Menores de Sevilla'],
      ['NORMA', 'art. 27 LORPM'],
      ['PERSONA', 'Kevin Heredia Montoya'],
      ['CAT_ESPECIAL', 'etnia gitana'],
      ['PERSONA', 'Esperanza Montoya Vargas'],
      ['DIRECCION', 'calle Parras, 17, bajo, 41002 Sevilla'],
      ['CAT_ESPECIAL', 'TDAH'],
      ['CAT_ESPECIAL', 'metilfenidato'],
      ['PERSONA', 'Rocío Justicia Moreno'],
      ['NORMA', 'art. 7.1.h) LORPM'],
      ['ORGANISMO', 'Consejería de Inclusión Social, Juventud, Familias e Igualdad de la Junta de Andalucía'],
    ],
  },

  // ───────────────────────── 16. Vigilancia Penitenciaria (tercer grado objeto; libertad condicional de tercero)
  {
    id: 'c-jvp-tercer-grado',
    fuente: 'Recurso ante Juzgado de Vigilancia Penitenciaria contra clasificación',
    clase: 'nativo',
    texto: `AL JUZGADO DE VIGILANCIA PENITENCIARIA Nº 3 DE MADRID
Expediente 4567/2024

Abdelkader Benali Haddou, interno en el Centro Penitenciario Madrid VII (Estremera), representado por la letrada Irene Caballero Leal, interpone RECURSO contra el acuerdo de la Secretaría General de Instituciones Penitenciarias que deniega su progresión a tercer grado.

La Junta de Tratamiento valoró negativamente que sigue tratamiento con metadona, cuando lo cierto es que lo hace dentro del programa del propio centro con resultados favorables. Su compañero de módulo, Iván Serrano Gil, que está en libertad condicional desde mayo, puede dar fe de su evolución.

Se invocan los arts. 63 y 72 LOGP y el art. 102 RP. Interesa asimismo que se recabe el informe del Servicio Médico del centro.`,
    oro: [
      ['ORGANO', 'JUZGADO DE VIGILANCIA PENITENCIARIA Nº 3 DE MADRID'],
      ['AUTOS', 'Expediente 4567/2024'],
      ['PERSONA', 'Abdelkader Benali Haddou'],
      ['ORGANISMO', 'Centro Penitenciario Madrid VII (Estremera)'],
      ['PERSONA', 'Irene Caballero Leal'],
      ['ORGANISMO', 'Secretaría General de Instituciones Penitenciarias'],
      ['OBJETO', 'tercer grado'],
      ['CAT_ESPECIAL', 'metadona'],
      ['PERSONA', 'Iván Serrano Gil'],
      ['DATO_PENAL', 'en libertad condicional'],
      ['NORMA', 'arts. 63 y 72 LOGP'],
      ['NORMA', 'art. 102 RP'],
    ],
  },

  // ───────────────────────── 17. Extranjería (antecedentes como requisito = OBJETO)
  {
    id: 'c-extranjeria-larga-duracion',
    fuente: 'Solicitud de autorización de residencia de larga duración',
    clase: 'nativo',
    texto: `A LA OFICINA DE EXTRANJERÍA DE BARCELONA (Subdelegación del Gobierno en Barcelona)

Doña Gloria Patricia Restrepo Cárdenas, nacida en Medellín (Colombia), de nacionalidad colombiana, con NIE Y-2345678-Z, domicilio en carrer de Sants, 180, 4t 2a, 08028 Barcelona, teléfono +34 612 345 678 y correo gprestrepo.bcn@gmail.com, SOLICITA autorización de residencia de larga duración conforme al art. 32 LOEX.

Acompaña, entre otros documentos, certificado del Registro Central de Penados que acredita carecer de antecedentes penales en España, y certificado equivalente de su país de origen apostillado.`,
    oro: [
      ['ORGANISMO', 'OFICINA DE EXTRANJERÍA DE BARCELONA'],
      ['ORGANISMO', 'Subdelegación del Gobierno en Barcelona'],
      ['PERSONA', 'Gloria Patricia Restrepo Cárdenas'],
      ['NIE', 'Y-2345678-Z'],
      ['DIRECCION', 'carrer de Sants, 180, 4t 2a, 08028 Barcelona'],
      ['TELEFONO', '+34 612 345 678'],
      ['CORREO', 'gprestrepo.bcn@gmail.com'],
      ['NORMA', 'art. 32 LOEX'],
      ['ORGANISMO', 'Registro Central de Penados'],
      ['OBJETO', 'carecer de antecedentes penales'],
    ],
  },

  // ───────────────────────── 18. Cancelación de antecedentes (OBJETO)
  {
    id: 'c-cancelacion-antecedentes',
    fuente: 'Solicitud de cancelación de antecedentes penales',
    clase: 'nativo',
    texto: `AL MINISTERIO DE JUSTICIA — REGISTRO CENTRAL DE PENADOS

D. Tomás Echevarría Lacasa, con DNI 46111222-V y domicilio en paseo de Sagasta, 40, 6º dcha., 50006 Zaragoza, SOLICITA la cancelación de sus antecedentes penales derivados de la sentencia de la Audiencia Provincial de Zaragoza, Sección Tercera, dictada en el Rollo de Sala 12/2016 (Ejecutoria 88/2016), por haber transcurrido los plazos del art. 136 CP sin volver a delinquir.`,
    oro: [
      ['ORGANISMO', 'MINISTERIO DE JUSTICIA'],
      ['ORGANISMO', 'REGISTRO CENTRAL DE PENADOS'],
      ['PERSONA', 'Tomás Echevarría Lacasa'],
      ['DNI', '46111222-V'],
      ['DIRECCION', 'paseo de Sagasta, 40, 6º dcha., 50006 Zaragoza'],
      ['OBJETO', 'cancelación de sus antecedentes penales'],
      ['ORGANO', 'Audiencia Provincial de Zaragoza, Sección Tercera'],
      ['AUTOS', 'Rollo de Sala 12/2016'],
      ['AUTOS', 'Ejecutoria 88/2016'],
      ['NORMA', 'art. 136 CP'],
    ],
  },

  // ───────────────────────── 19. Correo de cliente (ludopatía y embarazo de terceros)
  {
    id: 'c-correo-cliente-soria',
    fuente: 'Correo de un cliente a su abogada',
    clase: 'correo',
    texto: `De: Fermín Lafuente <ferminlafuente58@hotmail.com>
Para: Marta Cordero Rey
Asunto: lo del embargo

Hola Marta, soy Fermín.

Te escribo por lo del embargo. Como sabes vivo en Soria, pero la casa embargada es la de mi madre en Almazán, en la calle Mayor 4, 2º D. Mi cuñado Toño está enganchado a las tragaperras, una ludopatía de años, y fue él quien avaló el préstamo con Cajaviva sin decírnoslo. Mi hermana Begoña está embarazada de cinco meses y no quiero darle más disgustos.

El procurador, Lorenzo, me dijo que el Tribunal de Instancia de Soria ya ha señalado subasta en la ejecución hipotecaria 77/2024. ¿Me llamas al 975 22 11 00 cuando puedas?

Gracias,
Fermín`,
    oro: [
      ['PERSONA', 'Fermín Lafuente'],
      ['CORREO', 'ferminlafuente58@hotmail.com'],
      ['PERSONA', 'Marta Cordero Rey'],
      ['PERSONA', 'Marta'],
      ['PERSONA', 'Fermín'],
      ['DIRECCION', 'calle Mayor 4, 2º D'],
      ['PERSONA', 'Toño'],
      ['CAT_ESPECIAL', 'ludopatía'],
      ['PERSONA', 'Begoña'],
      ['CAT_ESPECIAL', 'embarazada de cinco meses'],
      ['PERSONA', 'Lorenzo'],
      ['ORGANO', 'Tribunal de Instancia de Soria'],
      ['AUTOS', 'ejecución hipotecaria 77/2024'],
      ['TELEFONO', '975 22 11 00'],
    ],
  },

  // ───────────────────────── 20. Acta de junta de propietarios (apellidos = palabras comunes)
  {
    id: 'c-acta-junta-propietarios',
    fuente: 'Acta de junta general de comunidad de propietarios',
    clase: 'nativo',
    texto: `ACTA DE LA JUNTA GENERAL ORDINARIA DE LA COMUNIDAD DE PROPIETARIOS DE LA CALLE MAYOR, 12, DE PALENCIA

Asisten: Salvador Bueno Cordero (1º A), Rosa Leal Caballero (2º B), Ana María Justicia Delgado (2º C) y, como administrador de fincas colegiado, Pedro Salvador Iglesias.

Toma la palabra Bueno, que propone cambiar la empresa de ascensores. Leal se opone por el coste. Justicia pide que conste en acta que ya se votó lo mismo en 2022.

Se acuerda por mayoría requerir de pago al propietario del 3º C, Sr. Blanco Rey, deudor de 2.340 euros, y, de no atenderlo, ejercitar la acción del art. 21 LPH ante el Tribunal de Instancia de Palencia, Sección Civil. Se faculta al presidente para solicitar nota simple al Registro de la Propiedad de Palencia nº 1.`,
    oro: [
      ['DIRECCION', 'CALLE MAYOR, 12'],
      ['PERSONA', 'Salvador Bueno Cordero'],
      ['PERSONA', 'Rosa Leal Caballero'],
      ['PERSONA', 'Ana María Justicia Delgado'],
      ['PERSONA', 'Pedro Salvador Iglesias'],
      ['PERSONA', 'Bueno'],
      ['PERSONA', 'Leal'],
      ['PERSONA', 'Justicia'],
      ['PERSONA', 'Blanco Rey'],
      ['NORMA', 'art. 21 LPH'],
      ['ORGANO', 'Tribunal de Instancia de Palencia, Sección Civil'],
      ['ORGANISMO', 'Registro de la Propiedad de Palencia nº 1'],
    ],
  },

  // ───────────────────────── 21. Escritura notarial (notario = PERSONA)
  {
    id: 'c-escritura-compraventa-donostia',
    fuente: 'Escritura pública de compraventa',
    clase: 'nativo',
    texto: `NÚMERO MIL DOSCIENTOS TREINTA Y CUATRO.
En Donostia / San Sebastián, a dieciséis de septiembre de dos mil veinticuatro.
Ante mí, ENEKO ZUBIZARRETA ALDAY, Notario del Ilustre Colegio Notarial del País Vasco, con residencia en esta ciudad,

COMPARECEN
De una parte, DON JEAN-BAPTISTE DUBOIS, de nacionalidad francesa, mayor de edad, con NIE X7654321J, con domicilio en avenida de la Libertad, 21, 3º, 20004 Donostia / San Sebastián.
Y de otra, DOÑA MAIALEN ETXANIZ ARANZADI, mayor de edad, con DNI 30112233N, vecina de Hernani.

EXPONEN
Que la vendedora es dueña de la finca inscrita en el Registro de la Propiedad nº 2 de San Sebastián. El precio se paga mediante transferencia a la cuenta ES70 0049 1500 0105 1234 5678. El impuesto se liquidará ante la Hacienda Foral de Gipuzkoa conforme a la Norma Foral 1/2011.`,
    oro: [
      ['PERSONA', 'ENEKO ZUBIZARRETA ALDAY'],
      ['ORGANISMO', 'Ilustre Colegio Notarial del País Vasco'],
      ['PERSONA', 'JEAN-BAPTISTE DUBOIS'],
      ['NIE', 'X7654321J'],
      ['DIRECCION', 'avenida de la Libertad, 21, 3º, 20004 Donostia / San Sebastián'],
      ['PERSONA', 'MAIALEN ETXANIZ ARANZADI'],
      ['DNI', '30112233N'],
      ['ORGANISMO', 'Registro de la Propiedad nº 2 de San Sebastián'],
      ['IBAN', 'ES70 0049 1500 0105 1234 5678'],
      ['ORGANISMO', 'Hacienda Foral de Gipuzkoa'],
      ['NORMA', 'Norma Foral 1/2011'],
    ],
  },

  // ───────────────────────── 22. Sentencia Audiencia Provincial (ECLI, ROJ, TJUE, perito)
  {
    id: 'c-sentencia-ap-barcelona',
    fuente: 'Sentencia de Audiencia Provincial (sección penal)',
    clase: 'nativo',
    texto: `Audiencia Provincial de Barcelona, Sección Vigesimoprimera
Rollo de Sala 12/2024 — Sumario 3/2023 del Juzgado de Instrucción nº 4 de Terrassa
ECLI:ES:APB:2024:5678 — ROJ: SAP B 5678/2024

Magistrados: Montserrat Comas Ribalta (presidenta y ponente), Josep Maria Riera Tió y Rafael Mora Serrano.

HECHOS PROBADOS
El acusado, Oriol Vendrell Masó, abordó a la víctima, Clara Sunyer Pons, en el portal de su domicilio de la calle de Sant Pere, 9, 1r 2a, 08221 Terrassa. La perito del Institut de Medicina Legal i Ciències Forenses de Catalunya, Dra. Elena Sarasola Ibarra, dictaminó que la víctima sufre trastorno de estrés postraumático crónico.

FUNDAMENTOS
Resultan aplicables los arts. 178 y 180 CP. La declaración de la víctima reúne los requisitos de la STS 1234/2024, de 5 de marzo, y de la STC 11/2016. Los Mossos d'Esquadra (agentes TIP 7788 y TIP 9102) ratificaron el atestado.

La Letrada de la Administración de Justicia, Neus Ferrer Gasull.`,
    oro: [
      ['ORGANO', 'Audiencia Provincial de Barcelona, Sección Vigesimoprimera'],
      ['AUTOS', 'Rollo de Sala 12/2024'],
      ['AUTOS', 'Sumario 3/2023'],
      ['ORGANO', 'Juzgado de Instrucción nº 4 de Terrassa'],
      ['ECLI', 'ECLI:ES:APB:2024:5678'],
      ['ROJ', 'ROJ: SAP B 5678/2024'],
      ['PONENTE', 'Montserrat Comas Ribalta'],
      ['PONENTE', 'Josep Maria Riera Tió'],
      ['PONENTE', 'Rafael Mora Serrano'],
      ['PERSONA', 'Oriol Vendrell Masó'],
      ['PERSONA', 'Clara Sunyer Pons'],
      ['DIRECCION', 'calle de Sant Pere, 9, 1r 2a, 08221 Terrassa'],
      ['ORGANISMO', 'Institut de Medicina Legal i Ciències Forenses de Catalunya'],
      ['PERSONA', 'Elena Sarasola Ibarra'],
      ['CAT_ESPECIAL', 'trastorno de estrés postraumático crónico'],
      ['NORMA', 'arts. 178 y 180 CP'],
      ['NORMA', 'STS 1234/2024, de 5 de marzo'],
      ['NORMA', 'STC 11/2016'],
      ['ORGANISMO', "Mossos d'Esquadra"],
      ['TIP', 'TIP 7788'],
      ['TIP', 'TIP 9102'],
      ['LAJ', 'Neus Ferrer Gasull'],
    ],
  },

  // ───────────────────────── 23. Correo de procuradora (LexNET, Servicio Común)
  {
    id: 'c-correo-procuradora-lexnet',
    fuente: 'Correo de procuradora reenviando notificación LexNET',
    clase: 'correo',
    texto: `De: Teresa Bravo Montes <tbravo@procuradoresmadrid.es>
Para: despacho@quinteroabogados.es
Asunto: Notificación LexNET — Tribunal de Instancia de Madrid, Sección Civil, Plaza nº 47 — Juicio verbal 2201/2024

Buenos días:

Os reenvío la diligencia de ordenación de la LAJ, Raquel Fontán Seijas, por la que se da traslado del escrito de la contraria (lo firma el letrado Gonzalo Mínguez Arroyo) y se requiere a vuestra clienta, Olga Semenova, para que aporte en cinco días el contrato original. El emplazamiento lo practicó el Servicio Común Procesal de Actos de Comunicación de Madrid.

Si hace falta me llamáis al 91 555 12 34.

Un saludo,
Teresa`,
    oro: [
      ['PERSONA', 'Teresa Bravo Montes'],
      ['CORREO', 'tbravo@procuradoresmadrid.es'],
      ['CORREO', 'despacho@quinteroabogados.es'],
      ['ORGANO', 'Tribunal de Instancia de Madrid, Sección Civil, Plaza nº 47'],
      ['AUTOS', 'Juicio verbal 2201/2024'],
      ['LAJ', 'Raquel Fontán Seijas'],
      ['PERSONA', 'Gonzalo Mínguez Arroyo'],
      ['PERSONA', 'Olga Semenova'],
      ['ORGANISMO', 'Servicio Común Procesal de Actos de Comunicación de Madrid'],
      ['TELEFONO', '91 555 12 34'],
      ['PERSONA', 'Teresa'],
    ],
  },

  // ───────────────────────── 24. OCR denuncia Policía Local
  {
    id: 'c-ocr-denuncia-policia-local',
    fuente: 'Denuncia de Policía Local escaneada (OCR)',
    clase: 'ocr',
    texto: `AYUNTAMIENTO DE ALICANTE - POLICIA LOCAL
BOLETIN DE DENUNCIA NUM. 2024-00456

AGENTE DENUNCIANTE: TIP 3456
DENUNCIANTE: D. HUGO VAN DER BERG, CON NIE Z-1234567-R, VECINO DE ALICANTE, CON DOMICILIO EN AVDA. MAISONNAVE, 33, 7º B, 03003 ALICANTE, TELEFONO 699 887 766.
HECHOS: EL VEHICULO MATRICULA 1234 BCD, ESTACIONADO EN DOBLE FILA, IMPIDE LA SALIDA DEL GARAJE DEL DENUNCIANTE. CONSULTADA LA DGT, EL TITULAR ES D. EMILIO PARDO SALVADOR.
TESTIGO: DOÑA PURIFICACION ROMERO CANO, QUE MANIFIESTA QUE EL CONDUCTOR SE ALEJO A PIE.
SE REMITE A LA CONCEJALIA DE SEGURIDAD CIUDADANA A LOS EFECTOS OPORTUNOS.`,
    oro: [
      ['ORGANISMO', 'AYUNTAMIENTO DE ALICANTE'],
      ['ORGANISMO', 'POLICIA LOCAL'],
      ['TIP', 'TIP 3456'],
      ['PERSONA', 'HUGO VAN DER BERG'],
      ['NIE', 'Z-1234567-R'],
      ['DIRECCION', 'AVDA. MAISONNAVE, 33, 7º B, 03003 ALICANTE'],
      ['TELEFONO', '699 887 766'],
      ['MATRICULA', '1234 BCD'],
      ['ORGANISMO', 'DGT'],
      ['PERSONA', 'EMILIO PARDO SALVADOR'],
      ['PERSONA', 'PURIFICACION ROMERO CANO'],
      ['ORGANISMO', 'CONCEJALIA DE SEGURIDAD CIUDADANA'],
    ],
  },

  // ───────────────────────── 25. Recurso al SEPE (baja, depresión, discapacidad de tercero)
  {
    id: 'c-reclamacion-sepe',
    fuente: 'Reclamación previa contra el SEPE por cobro indebido',
    clase: 'nativo',
    texto: `A LA DIRECCIÓN PROVINCIAL DEL SERVICIO PÚBLICO DE EMPLEO ESTATAL (SEPE) EN ZARAGOZA

D. Yusuf Kaya, con NIE Y-8765432-P y número de afiliación 50/1122334432, domiciliado en calle Delicias, 58, 3º izda., 50017 Zaragoza, interpone RECLAMACIÓN PREVIA (art. 71 LRJS) contra la resolución que le reclama 2.184 euros de subsidio por desempleo como cobro indebido.

El periodo reclamado coincide con su parte de baja de 12 de marzo de 2024 por depresión mayor, comunicado en plazo a la TGSS y al Instituto Aragonés de Empleo. Además, convive con su padre, que tiene reconocida una discapacidad del 75 %, circunstancia que computa a efectos del art. 275 LGSS.`,
    oro: [
      ['ORGANISMO', 'DIRECCIÓN PROVINCIAL DEL SERVICIO PÚBLICO DE EMPLEO ESTATAL (SEPE) EN ZARAGOZA'],
      ['PERSONA', 'Yusuf Kaya'],
      ['NIE', 'Y-8765432-P'],
      ['NUSS', '50/1122334432'],
      ['DIRECCION', 'calle Delicias, 58, 3º izda., 50017 Zaragoza'],
      ['NORMA', 'art. 71 LRJS'],
      ['CAT_ESPECIAL', 'parte de baja'],
      ['CAT_ESPECIAL', 'depresión mayor'],
      ['ORGANISMO', 'TGSS'],
      ['ORGANISMO', 'Instituto Aragonés de Empleo'],
      ['CAT_ESPECIAL', 'discapacidad del 75 %'],
      ['NORMA', 'art. 275 LGSS'],
    ],
  },

  // ───────────────────────── 26. Despido y afiliación sindical / opinión política (Jutjat Social)
  {
    id: 'c-demanda-despido-sindical-bcn',
    fuente: 'Demanda de despido con vulneración de derechos fundamentales',
    clase: 'nativo',
    texto: `AL JUTJAT SOCIAL NÚM. 21 DE BARCELONA

Arnau Soler Vives, amb DNI 31987654-J, en su propio nombre, asistido por el Col·legi de l'Advocacia de Barcelona a través del turno de oficio, formula DEMANDA DE DESPIDO con tutela de derechos fundamentales (arts. 177 y ss. LRJS) contra LOGÍSTICA MEDITERRÀNIA, S.A.

HECHOS
PRIMERO.- El actor está afiliado a la CGT desde 2019 y es conocido en la empresa por sus publicaciones a favor de la independencia de Cataluña.
SEGUNDO.- El 2 de septiembre de 2024 el jefe de almacén, Xavier Puig Rosell, le comunicó verbalmente que «no quería rojos en el turno». Lo presenció la compañera Fatima Zahra Ouali.
TERCERO.- La empresa alega bajo rendimiento sin concretar. Se invocan los arts. 14 y 28.1 CE y el art. 55.5 ET, así como la STC 11/2016.`,
    oro: [
      ['ORGANO', 'JUTJAT SOCIAL NÚM. 21 DE BARCELONA'],
      ['PERSONA', 'Arnau Soler Vives'],
      ['DNI', '31987654-J'],
      ['ORGANISMO', "Col·legi de l'Advocacia de Barcelona"],
      ['NORMA', 'arts. 177 y ss. LRJS'],
      ['CAT_ESPECIAL', 'afiliado a la CGT'],
      ['CAT_ESPECIAL', 'publicaciones a favor de la independencia de Cataluña'],
      ['PERSONA', 'Xavier Puig Rosell'],
      ['PERSONA', 'Fatima Zahra Ouali'],
      ['NORMA', 'arts. 14 y 28.1 CE'],
      ['NORMA', 'art. 55.5 ET'],
      ['NORMA', 'STC 11/2016'],
    ],
  },

  // ───────────────────────── 27. Juzgado de Paz, acta de conciliación (Martín nombre y apellido)
  {
    id: 'c-juzgado-paz-conciliacion',
    fuente: 'Acta de acto de conciliación en Juzgado de Paz',
    clase: 'nativo',
    texto: `JUZGADO DE PAZ DE VALDEMORILLO
Acto de conciliación 14/2024

En Valdemorillo, a 9 de mayo de 2024, ante el Juez de Paz, D. Anselmo Rubio Tejero, asistido del Secretario, D. Julián Cabello Mora, comparecen como solicitante D. Eusebio Martín Martín, vecino de esta localidad, con domicilio en Camino de las Eras, 9, 28210 Valdemorillo, y como requerido su primo D. Martín Martín Sanz.

El solicitante pide que se reconozca la linde entre sus fincas. Martín Sanz manifiesta que no está conforme. Martín Martín insiste en que el mojón se movió en 2019.

Se da por intentado sin avenencia el acto (arts. 139 y ss. LJV).`,
    oro: [
      ['ORGANO', 'JUZGADO DE PAZ DE VALDEMORILLO'],
      ['AUTOS', 'Acto de conciliación 14/2024'],
      ['PONENTE', 'Anselmo Rubio Tejero'],
      ['LAJ', 'Julián Cabello Mora'],
      ['PERSONA', 'Eusebio Martín Martín'],
      ['DIRECCION', 'Camino de las Eras, 9, 28210 Valdemorillo'],
      ['PERSONA', 'Martín Martín Sanz'],
      ['PERSONA', 'Martín Sanz'],
      ['PERSONA', 'Martín Martín'],
      ['NORMA', 'arts. 139 y ss. LJV'],
    ],
    ambiguo: ['Martín Martín'],
  },

  // ───────────────────────── 28. Informe pericial médico (tráfico)
  {
    id: 'c-pericial-medica-trafico',
    fuente: 'Informe pericial médico de valoración del daño corporal',
    clase: 'nativo',
    texto: `INFORME PERICIAL DE VALORACIÓN DEL DAÑO CORPORAL

Perito: Dr. Álvaro Casado Lin, colegiado nº 28/45678 del Ilustre Colegio Oficial de Médicos de Madrid.
Lesionada: Begoña Uribe-Etxebarria Zubiaur, DNI 72345678-Y, domicilio en Gran Vía de Don Diego López de Haro, 60, 4º izda., 48011 Bilbao.

Accidente de circulación del 14 de enero de 2024: el turismo matrícula 7788 HJK colisionó por alcance con el vehículo de la lesionada.

Consta en la historia clínica del Hospital Universitario de Cruces el diagnóstico de cervicalgia postraumática con rectificación de la lordosis. Sigue tratamiento con ibuprofeno 600 mg y diazepam 5 mg. Se valora conforme al baremo de la Ley 35/2015 (art. 37 LRCSCVM), con 97 días de perjuicio moderado.

El atestado lo instruyó la Ertzaintza, agente TIP 4455.`,
    oro: [
      ['PERSONA', 'Álvaro Casado Lin'],
      ['ORGANISMO', 'Ilustre Colegio Oficial de Médicos de Madrid'],
      ['PERSONA', 'Begoña Uribe-Etxebarria Zubiaur'],
      ['DNI', '72345678-Y'],
      ['DIRECCION', 'Gran Vía de Don Diego López de Haro, 60, 4º izda., 48011 Bilbao'],
      ['MATRICULA', '7788 HJK'],
      ['CAT_ESPECIAL', 'historia clínica'],
      ['ORGANISMO', 'Hospital Universitario de Cruces'],
      ['CAT_ESPECIAL', 'cervicalgia postraumática con rectificación de la lordosis'],
      ['CAT_ESPECIAL', 'ibuprofeno 600 mg'],
      ['CAT_ESPECIAL', 'diazepam 5 mg'],
      ['NORMA', 'Ley 35/2015'],
      ['NORMA', 'art. 37 LRCSCVM'],
      ['ORGANISMO', 'Ertzaintza'],
      ['TIP', 'TIP 4455'],
    ],
  },

  // ───────────────────────── 29. Sentencia del Tribunal Supremo (casación)
  {
    id: 'c-sentencia-ts-casacion',
    fuente: 'Sentencia de la Sala Primera del Tribunal Supremo',
    clase: 'nativo',
    texto: `TRIBUNAL SUPREMO
Sala de lo Civil
Sentencia núm. 812/2024 — Recurso de casación núm. 4567/2022
ECLI:ES:TS:2024:2345 — ROJ: STS 2345/2024

Ponente: Excmo. Sr. D. Rodrigo Valcárcel Ybarra
Letrado de la Administración de Justicia: Ilmo. Sr. D. Andrés Quintana Losada

En el recurso interpuesto por Doña Guadalupe Sánchez de la Cruz, representada por el procurador D. Íñigo de Loyola Urquijo, contra la sentencia de la Audiencia Provincial de Málaga, Sección 5.ª, de 3 de mayo de 2022 (rollo 890/2021), sobre nulidad de cláusula de vencimiento anticipado.

FUNDAMENTOS
Resulta de aplicación la sentencia del TJUE de 14 de marzo de 2013, asunto C-415/11 (Aziz), la STJUE de 26 de marzo de 2019, asuntos acumulados C-70/17 y C-179/17, y el art. 693.2 LEC. Se reitera la doctrina de la STS 463/2019, de 11 de septiembre.`,
    oro: [
      ['ORGANO', 'TRIBUNAL SUPREMO'],
      ['ORGANO', 'Sala de lo Civil'],
      ['AUTOS', 'Recurso de casación núm. 4567/2022'],
      ['ECLI', 'ECLI:ES:TS:2024:2345'],
      ['ROJ', 'ROJ: STS 2345/2024'],
      ['PONENTE', 'Rodrigo Valcárcel Ybarra'],
      ['LAJ', 'Andrés Quintana Losada'],
      ['PERSONA', 'Guadalupe Sánchez de la Cruz'],
      ['PERSONA', 'Íñigo de Loyola Urquijo'],
      ['ORGANO', 'Audiencia Provincial de Málaga, Sección 5.ª'],
      ['AUTOS', 'rollo 890/2021'],
      ['NORMA', 'sentencia del TJUE de 14 de marzo de 2013, asunto C-415/11'],
      ['NORMA', 'STJUE de 26 de marzo de 2019, asuntos acumulados C-70/17 y C-179/17'],
      ['NORMA', 'art. 693.2 LEC'],
      ['NORMA', 'STS 463/2019, de 11 de septiembre'],
      ['NORMA', 'Sentencia núm. 812/2024'],
    ],
  },

  // ───────────────────────── 30. Correo interno con apellidos sueltos
  {
    id: 'c-correo-interno-apellidos',
    fuente: 'Correo interno breve entre asociados',
    clase: 'correo',
    texto: `De: Sole <sole.navarro@quinteroabogados.es>
Para: Guille
Asunto: pericial Uribe-Etxebarria

Oye, ¿sabes si Casado mandó ya el informe firmado? Porque Fuentes dice que no le ha llegado nada y Quintero quiere cerrar la demanda el viernes. Lo ha revisado Vallejo con la clienta esta mañana.

Si no contesta, llámale tú al 600 11 22 33, que a mí no me lo coge.

Sole`,
    oro: [
      ['PERSONA', 'Sole'],
      ['CORREO', 'sole.navarro@quinteroabogados.es'],
      ['PERSONA', 'Guille'],
      ['PERSONA', 'Uribe-Etxebarria'],
      ['PERSONA', 'Casado'],
      ['PERSONA', 'Fuentes'],
      ['PERSONA', 'Quintero'],
      ['PERSONA', 'Vallejo'],
      ['TELEFONO', '600 11 22 33'],
    ],
  },

  // ───────────────────────── 31. OCR resolución del INSS
  {
    id: 'c-ocr-resolucion-inss-cadiz',
    fuente: 'Resolución del INSS escaneada (OCR)',
    clase: 'ocr',
    texto: `INSTITUTO NACIONAL DE LA SEGURIDAD SOCIAL
DIRECCION PROVINCIAL DE CADIZ

RESOLUCION SOBRE INCAPACIDAD PERMANENTE

BENEFICIARIO: JOSE ANTONIO BARRIOS DE LA ROSA
DNI: 31987654J   NUM. AFILIACION: 11/2034567843
DOMICILIO: C/ ANCHA, 15, 1º, 11001 CADIZ

VISTO EL DICTAMEN PROPUESTA DEL EQUIPO DE VALORACION DE INCAPACIDADES, ESTA DIRECCION PROVINCIAL RESUELVE DENEGAR LA PRESTACION DE INCAPACIDAD PERMANENTE EN GRADO DE ABSOLUTA, POR NO ALCANZAR LAS LESIONES UN GRADO SUFICIENTE DE DISMINUCION DE LA CAPACIDAD LABORAL (ART. 194 LGSS).
CUADRO CLINICO RESIDUAL: CARDIOPATIA ISQUEMICA CON FRACCION DE EYECCION DEL 45 %.

CONTRA ESTA RESOLUCION PODRA INTERPONER RECLAMACION PREVIA (ART. 71 LRJS).

EL DIRECTOR PROVINCIAL, FDO.: MANUEL JESUS ORTEGA BARRERA`,
    oro: [
      ['ORGANISMO', 'INSTITUTO NACIONAL DE LA SEGURIDAD SOCIAL'],
      ['ORGANISMO', 'DIRECCION PROVINCIAL DE CADIZ'],
      ['PERSONA', 'JOSE ANTONIO BARRIOS DE LA ROSA'],
      ['DNI', '31987654J'],
      ['NUSS', '11/2034567843'],
      ['DIRECCION', 'C/ ANCHA, 15, 1º, 11001 CADIZ'],
      ['ORGANISMO', 'EQUIPO DE VALORACION DE INCAPACIDADES'],
      ['OBJETO', 'INCAPACIDAD PERMANENTE EN GRADO DE ABSOLUTA'],
      ['NORMA', 'ART. 194 LGSS'],
      ['CAT_ESPECIAL', 'CARDIOPATIA ISQUEMICA CON FRACCION DE EYECCION DEL 45 %'],
      ['NORMA', 'ART. 71 LRJS'],
      ['PERSONA', 'MANUEL JESUS ORTEGA BARRERA'],
    ],
  },

  // ───────────────────────── 32. Policía Foral / Navarra (embarazo de tercera = CAT_ESPECIAL)
  {
    id: 'c-auto-pamplona-policia-foral',
    fuente: 'Auto de incoación con atestado de Policía Foral',
    clase: 'nativo',
    texto: `Tribunal de Instancia de Pamplona/Iruña, Sección de Instrucción, Plaza nº 2
Diligencias Previas 1502/2024 — NIG 31201 43 2 2024 0009876

AUTO

HECHOS: Según el atestado de la Policía Foral de Navarra (agentes TIP 2211 y TIP 3322) y el de la Policía Municipal de Pamplona, el 6 de julio de 2024, en la plaza del Castillo, Iker Goñi Zabalza golpeó a Patxi Oroz Erro, que cayó sobre Ainhoa Lizarraga Urdiain; esta última, que estaba embarazada de siete meses, fue trasladada al Hospital Universitario de Navarra.

RAZONAMIENTOS: Los hechos pueden constituir un delito de lesiones del art. 147.1 CP. Se acuerda recabar informe del Instituto Navarro de Medicina Legal y comunicar la incoación al Gobierno de Navarra, Departamento de Justicia (Oficina de Atención a las Víctimas del Delito).

Lo acuerda la Magistrada, Arantxa Ezcurra Iribarren.`,
    oro: [
      ['ORGANO', 'Tribunal de Instancia de Pamplona/Iruña, Sección de Instrucción, Plaza nº 2'],
      ['AUTOS', 'Diligencias Previas 1502/2024'],
      ['AUTOS', 'NIG 31201 43 2 2024 0009876'],
      ['ORGANISMO', 'Policía Foral de Navarra'],
      ['TIP', 'TIP 2211'],
      ['TIP', 'TIP 3322'],
      ['ORGANISMO', 'Policía Municipal de Pamplona'],
      ['PERSONA', 'Iker Goñi Zabalza'],
      ['PERSONA', 'Patxi Oroz Erro'],
      ['PERSONA', 'Ainhoa Lizarraga Urdiain'],
      ['CAT_ESPECIAL', 'embarazada de siete meses'],
      ['ORGANISMO', 'Hospital Universitario de Navarra'],
      ['NORMA', 'art. 147.1 CP'],
      ['ORGANISMO', 'Instituto Navarro de Medicina Legal'],
      ['ORGANISMO', 'Gobierno de Navarra, Departamento de Justicia'],
      ['ORGANISMO', 'Oficina de Atención a las Víctimas del Delito'],
      ['PONENTE', 'Arantxa Ezcurra Iribarren'],
    ],
  },

  // ───────────────────────── 33. Registro Civil y Servicio Común (tramitadora con nombre)
  {
    id: 'c-registro-civil-expediente',
    fuente: 'Resolución de expediente del Registro Civil',
    clase: 'nativo',
    texto: `REGISTRO CIVIL DE MÁLAGA
Expediente gubernativo 1789/2024 — Inscripción de nacimiento fuera de plazo

La Encargada del Registro Civil, vista la solicitud de Nkechi Adaeze Okonkwo, con NIE X-3456789-G, madre del menor Chidi Okonkwo, nacido en Lagos (Nigeria), y el informe favorable del Ministerio Fiscal (Fiscalía Provincial de Málaga), acuerda practicar la inscripción conforme a los arts. 47 y 96 de la Ley 20/2011, del Registro Civil.

Tramitó el expediente la funcionaria del Cuerpo de Tramitación Procesal Encarnación Ruiz Morales. Notifíquese a la interesada en su domicilio de calle Cuarteles, 31, 5º A, 29002 Málaga, y a la Dirección General de Seguridad Jurídica y Fe Pública.`,
    oro: [
      ['ORGANISMO', 'REGISTRO CIVIL DE MÁLAGA'],
      ['AUTOS', 'Expediente gubernativo 1789/2024'],
      ['PERSONA', 'Nkechi Adaeze Okonkwo'],
      ['NIE', 'X-3456789-G'],
      ['PERSONA', 'Chidi Okonkwo'],
      ['ORGANISMO', 'Ministerio Fiscal'],
      ['ORGANISMO', 'Fiscalía Provincial de Málaga'],
      ['NORMA', 'arts. 47 y 96 de la Ley 20/2011'],
      ['LAJ', 'Encarnación Ruiz Morales'],
      ['DIRECCION', 'calle Cuarteles, 31, 5º A, 29002 Málaga'],
      ['ORGANISMO', 'Dirección General de Seguridad Jurídica y Fe Pública'],
    ],
  },

  // ───────────────────────── 34. Correo con la contraparte sobre medicación incidental y SEPE/TGSS (sin tratamientos)
  {
    id: 'c-correo-negociacion-laboral',
    fuente: 'Correo entre letrados de parte contraria (negociación laboral)',
    clase: 'correo',
    texto: `De: Borja Arriola <barriola@laboralistas-bizkaia.com>
Para: Ane Mugica Leizaola
CC: Kepa
Asunto: Propuesta acuerdo — SMAC Bizkaia (papeleta 3345/2024)

Ane, buenas:

Hablé con Iñaki y con Maite de recursos humanos. La empresa acepta readmitir a Ekaitz Olazabal si retira la reclamación de horas extra. Lo de que su compañera Sonia tome antidepresivos no debería salir en el acto de conciliación ante el Consejo de Relaciones Laborales / Lan Harremanen Kontseilua, estaremos de acuerdo.

Te llamo mañana al fijo, 944 15 26 37.

Borja`,
    oro: [
      ['PERSONA', 'Borja Arriola'],
      ['CORREO', 'barriola@laboralistas-bizkaia.com'],
      ['PERSONA', 'Ane Mugica Leizaola'],
      ['PERSONA', 'Kepa'],
      ['ORGANISMO', 'SMAC Bizkaia'],
      ['AUTOS', 'papeleta 3345/2024'],
      ['PERSONA', 'Ane'],
      ['PERSONA', 'Iñaki'],
      ['PERSONA', 'Maite'],
      ['PERSONA', 'Ekaitz Olazabal'],
      ['PERSONA', 'Sonia'],
      ['CAT_ESPECIAL', 'tome antidepresivos'],
      ['ORGANISMO', 'Consejo de Relaciones Laborales'],
      ['ORGANISMO', 'Lan Harremanen Kontseilua'],
      ['TELEFONO', '944 15 26 37'],
      ['PERSONA', 'Borja'],
    ],
  },

  // ───────────────────────── 35. Diligencia de ordenación (gestora de auxilio con nombre, Juzgado de lo Mercantil)
  {
    id: 'c-diligencia-mercantil-madrid',
    fuente: 'Diligencia de ordenación en incidente concursal',
    clase: 'nativo',
    texto: `Tribunal de Instancia de Madrid, Sección de lo Mercantil, Plaza nº 9
Incidente concursal 55/2024 dimanante del Concurso ordinario 1210/2023

DILIGENCIA DE ORDENACIÓN
Letrada de la Administración de Justicia: Dña. Soledad Montero Lagos.

En Madrid, a 20 de junio de 2024.

Presentado escrito por el administrador concursal, D. Héctor Villanueva Sastre, únase. Se tiene por comparecida en el incidente a Doña Carlota Álvarez de Toledo Pignatelli, acreedora, y a su abogado, D. Fernando Rey Blanco, del Colegio de la Abogacía de Madrid. Se da traslado a la concursada por cinco días (art. 534 TRLC). Remítase testimonio al Registro Mercantil de Madrid. Hizo la comprobación de firmas el funcionario del Cuerpo de Auxilio Judicial Ramón Gil Esteban.`,
    oro: [
      ['ORGANO', 'Tribunal de Instancia de Madrid, Sección de lo Mercantil, Plaza nº 9'],
      ['AUTOS', 'Incidente concursal 55/2024'],
      ['AUTOS', 'Concurso ordinario 1210/2023'],
      ['LAJ', 'Soledad Montero Lagos'],
      ['PERSONA', 'Héctor Villanueva Sastre'],
      ['PERSONA', 'Carlota Álvarez de Toledo Pignatelli'],
      ['PERSONA', 'Fernando Rey Blanco'],
      ['ORGANISMO', 'Colegio de la Abogacía de Madrid'],
      ['NORMA', 'art. 534 TRLC'],
      ['ORGANISMO', 'Registro Mercantil de Madrid'],
      ['LAJ', 'Ramón Gil Esteban'],
    ],
  },
];
