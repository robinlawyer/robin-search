// Corpus de VALIDACIÓN.
//
// Escrito aparte del de trabajo y con otra forma a propósito: otras jurisdicciones, otros tipos de
// escrito, nombres catalanes, gallegos, vascos y extranjeros, escaneos con Ñ, sentencias que ya
// vienen con iniciales, juzgados de paz, arbitraje, notificaciones administrativas autonómicas.
//
// Sirve para una sola cosa: dar el número honesto. Las reglas y la guardia se afinaron contra
// `corpus.mjs`, así que allí los resultados son un techo. Si aquí caen mucho, es que las reglas
// están aprendidas de memoria y no generalizan, y eso hay que saberlo ANTES de prometer nada.
//
// Mismos tipos de anotación que en el corpus de trabajo (ver `corpus.mjs` para la lista completa).

export const VALIDACION = [
  // ───────────────────────────── Contencioso-administrativo y autonómico ─────────────────────────────
  {
    id: 'v-recurso-contencioso',
    fuente: 'Escrito de interposición de recurso contencioso-administrativo',
    clase: 'nativo',
    texto:
      'AL JUZGADO DE LO CONTENCIOSO-ADMINISTRATIVO Nº 3 DE OVIEDO\n\n' +
      'D.ª Covadonga Piñera Roces, Procuradora de los Tribunales, en nombre de D. Anselmo Riestra ' +
      'Cangas, con DNI 45678912S y domicilio en la calle Uría 38, 4º D, 33003 Oviedo, interpone ' +
      'recurso contencioso-administrativo frente a la resolución de la Consejería de Medio Rural del ' +
      'Principado de Asturias de 9 de enero de 2025.\n\n' +
      'Se formula al amparo del artículo 25 de la Ley 29/1998, de 13 de julio, reguladora de la ' +
      'Jurisdicción Contencioso-administrativa.',
    oro: [
      ['PERSONA', 'Covadonga Piñera Roces'],
      ['PERSONA', 'Anselmo Riestra Cangas'],
      ['DNI', '45678912S'],
      ['DIRECCION', 'calle Uría 38, 4º D, 33003 Oviedo'],
      ['ORGANO', 'JUZGADO DE LO CONTENCIOSO-ADMINISTRATIVO Nº 3 DE OVIEDO'],
      ['ORGANISMO', 'Consejería de Medio Rural del Principado de Asturias'],
      ['NORMA', 'artículo 25 de la Ley 29/1998, de 13 de julio, reguladora de la Jurisdicción Contencioso-administrativa'],
    ],
  },
  {
    id: 'v-notificacion-autonomica',
    fuente: 'Notificación de expediente sancionador autonómico',
    clase: 'nativo',
    texto:
      'NOTIFICACIÓN DE RESOLUCIÓN\n\nExpediente sancionador 2025/SAN/00412.\n' +
      'Interesado: D. Bieito Carballeira Oureiro, con DNI 07654321J.\n' +
      'Órgano instructor: Dirección Xeral de Comercio e Consumo da Xunta de Galicia.\n\n' +
      'Se le impone una sanción de 3.000 euros por la infracción tipificada en el artículo 48 de la ' +
      'Ley 2/2012, de 28 de marzo, gallega de protección general de las personas consumidoras. ' +
      'Puede abonarla en la cuenta ES5420950123456789012345 o recurrir en alzada en el plazo de un mes.',
    oro: [
      ['PERSONA', 'Bieito Carballeira Oureiro'],
      ['DNI', '07654321J'],
      ['IBAN', 'ES5420950123456789012345'],
      ['AUTOS', 'Expediente sancionador 2025/SAN/00412'],
      ['ORGANISMO', 'Dirección Xeral de Comercio e Consumo da Xunta de Galicia'],
      ['NORMA', 'artículo 48 de la Ley 2/2012, de 28 de marzo, gallega de protección general de las personas consumidoras'],
    ],
  },
  {
    id: 'v-juzgado-paz',
    fuente: 'Acta del Juzgado de Paz',
    clase: 'nativo',
    texto:
      'JUZGADO DE PAZ DE CANDELEDA\n\nActo de conciliación 4/2025.\n\n' +
      'Comparecen D. Nicasio Terrón Bravo, solicitante, y D.ª Herminia Bautista Galán, requerida, ' +
      'ambos vecinos de la localidad, asistidos respectivamente por los Letrados D. Casimiro Vegas ' +
      'Prieto y D.ª Trinidad Olmedo Sacristán.\n\n' +
      'No se alcanza avenencia, quedando expedita la vía judicial conforme al artículo 139 de la Ley ' +
      '15/2015, de 2 de julio, de la Jurisdicción Voluntaria.',
    oro: [
      ['PERSONA', 'Nicasio Terrón Bravo'],
      ['PERSONA', 'Herminia Bautista Galán'],
      ['PERSONA', 'Casimiro Vegas Prieto'],
      ['PERSONA', 'Trinidad Olmedo Sacristán'],
      ['ORGANO', 'JUZGADO DE PAZ DE CANDELEDA'],
      ['AUTOS', 'Acto de conciliación 4/2025'],
      ['NORMA', 'artículo 139 de la Ley 15/2015, de 2 de julio, de la Jurisdicción Voluntaria'],
    ],
  },

  // ───────────────────────────── Arbitraje y mediación ─────────────────────────────
  {
    id: 'v-laudo-arbitral',
    fuente: 'Laudo arbitral, encabezamiento',
    clase: 'nativo',
    texto:
      'LAUDO ARBITRAL\n\nProcedimiento arbitral 118/2024 de la Corte de Arbitraje de la Cámara de ' +
      'Comercio de Madrid.\n\nÁrbitro único: D. Fulgencio Maldonado Serrano.\n\n' +
      'Partes: NAVIERA LEVANTINA S.A., CIF A87654323, representada por D.ª Remedios Ballester Fabra, ' +
      'y TRANSPORTES ATLÁNTICOS DEL SUR S.L., CIF B23456783, representada por D. Isidoro Quevedo Nadal.\n\n' +
      'Se resuelve conforme a los artículos 34 y 37 de la Ley 60/2003, de 23 de diciembre, de Arbitraje.',
    oro: [
      ['PERSONA', 'Fulgencio Maldonado Serrano'],
      ['PERSONA', 'Remedios Ballester Fabra'],
      ['PERSONA', 'Isidoro Quevedo Nadal'],
      ['CIF', 'A87654323'],
      ['CIF', 'B23456783'],
      ['AUTOS', 'Procedimiento arbitral 118/2024'],
      ['ORGANISMO', 'Corte de Arbitraje de la Cámara de Comercio de Madrid'],
      ['NORMA', 'artículos 34 y 37 de la Ley 60/2003, de 23 de diciembre, de Arbitraje'],
    ],
  },

  // ───────────────────────────── Sentencia publicada (puro intocable) ─────────────────────────────
  {
    id: 'v-sentencia-tsj',
    fuente: 'Sentencia del TSJ, cabecera completa',
    clase: 'nativo',
    texto:
      'TRIBUNAL SUPERIOR DE JUSTICIA DE LA COMUNIDAD VALENCIANA. Sala de lo Social, Sección 1ª. ' +
      'Recurso de Suplicación 2.118/2024. Sentencia núm. 907/2025, de 6 de marzo. ' +
      'Ponente: Ilma. Sra. D.ª Inmaculada Linares Bosch. ECLI:ES:TSJCV:2025:1204. ' +
      'ROJ: STSJ CV 1204/2025.\n\n' +
      'Se aplica el artículo 52.d) del Estatuto de los Trabajadores y la doctrina de la STS 1.312/2021, ' +
      'de 21 de diciembre, dictada en unificación de doctrina.',
    oro: [
      ['ORGANO', 'TRIBUNAL SUPERIOR DE JUSTICIA DE LA COMUNIDAD VALENCIANA'],
      ['ORGANO', 'Sala de lo Social, Sección 1ª'],
      ['AUTOS', 'Recurso de Suplicación 2.118/2024'],
      ['PONENTE', 'Inmaculada Linares Bosch'],
      ['ECLI', 'ECLI:ES:TSJCV:2025:1204'],
      ['ROJ', 'ROJ: STSJ CV 1204/2025'],
      ['NORMA', 'artículo 52.d) del Estatuto de los Trabajadores'],
      ['NORMA', 'STS 1.312/2021, de 21 de diciembre'],
    ],
  },
  {
    id: 'v-providencia-oficina',
    fuente: 'Providencia y diligencia de constancia de la oficina judicial',
    clase: 'nativo',
    texto:
      'PROVIDENCIA\n\nMagistrado-Juez: Ilmo. Sr. D. Baltasar Quiñones Alcántara.\n' +
      'Letrada de la Administración de Justicia: D.ª Genoveva Peñalosa Ruano.\n' +
      'Juzgado de Primera Instancia nº 11 de Murcia. Ordinario 776/2024.\n\n' +
      'Se tiene por presentado el escrito de D. Onofre Belmonte Zaplana y se señala la audiencia previa ' +
      'para el día 3 de junio, conforme al artículo 414 de la Ley de Enjuiciamiento Civil.\n\n' +
      'Doy fe. El Tramitador Procesal, D. Cándido Mateo Lorca.',
    oro: [
      ['PONENTE', 'Baltasar Quiñones Alcántara'],
      ['LAJ', 'Genoveva Peñalosa Ruano'],
      ['LAJ', 'Cándido Mateo Lorca'],
      ['PERSONA', 'Onofre Belmonte Zaplana'],
      ['ORGANO', 'Juzgado de Primera Instancia nº 11 de Murcia'],
      ['AUTOS', 'Ordinario 776/2024'],
      ['NORMA', 'artículo 414 de la Ley de Enjuiciamiento Civil'],
    ],
  },

  // ───────────────────────────── Escaneos con Ñ y nombres no castellanos ─────────────────────────────
  {
    id: 'v-ocr-poder-catalan',
    fuente: 'Escaneo de poder notarial, OCR en mayúsculas',
    clase: 'ocr',
    texto:
      'PODER GENERAL PARA PLEITOS\n\nANTE MI, DON JOSEP MARIA PUJADAS I FONTANALS, NOTARIO DE ' +
      'TARRAGONA, COMPARECE DONA MONTSERRAT VILASECA I MIRO, MAYOR DE EDAD, CON DNI 51234567C, ' +
      'VECINA DE REUS, CON DOMICILIO EN CARRER DEL RAVAL DE SANTA ANNA 14, 43201 REUS.\n\n' +
      'OTORGA PODER A FAVOR DE LOS PROCURADORES DON JORDI SEGARRA I BALAGUER Y DONA NURIA CASTELLVI ' +
      'I ROIG, Y DE LOS LETRADOS DON XAVIER FORTUNY I MASIP Y DONA LAIA BERENGUER I SOLE.',
    oro: [
      ['PERSONA', 'JOSEP MARIA PUJADAS I FONTANALS'],
      ['PERSONA', 'MONTSERRAT VILASECA I MIRO'],
      ['PERSONA', 'JORDI SEGARRA I BALAGUER'],
      ['PERSONA', 'NURIA CASTELLVI I ROIG'],
      ['PERSONA', 'XAVIER FORTUNY I MASIP'],
      ['PERSONA', 'LAIA BERENGUER I SOLE'],
      ['DNI', '51234567C'],
      ['DIRECCION', 'CARRER DEL RAVAL DE SANTA ANNA 14, 43201 REUS'],
    ],
  },
  {
    id: 'v-ocr-atestado-enie',
    fuente: 'Escaneo de atestado con Ñ, OCR en mayúsculas',
    clase: 'ocr',
    texto:
      'ATESTADO NUMERO 872/2025 DE LA COMISARIA DE POLICIA NACIONAL DE LOGROÑO\n\n' +
      'INSTRUCTOR: FUNCIONARIO CON CARNE PROFESIONAL 98.442. SECRETARIO: CARNE PROFESIONAL 98.443.\n\n' +
      'DENUNCIANTE: DONA MARIA PILAR OÑATE MUÑARRIZ, DNI 09876543K, TELEFONO 678 334 221, ' +
      'DOMICILIADA EN AVENIDA DE LA RIOJA 55, 26006 LOGROÑO.\n' +
      'DENUNCIADO: DON IÑIGO ZUÑIGA PEÑAFIEL, DNI 28765432E, QUE CONDUCIA EL VEHICULO MATRICULA 3344 GHJ.\n\n' +
      'SE REMITE AL JUZGADO DE INSTRUCCION N 4 DE LOGROÑO.',
    oro: [
      ['PERSONA', 'MARIA PILAR OÑATE MUÑARRIZ'],
      ['PERSONA', 'IÑIGO ZUÑIGA PEÑAFIEL'],
      ['DNI', '09876543K'],
      ['DNI', '28765432E'],
      ['TELEFONO', '678 334 221'],
      ['MATRICULA', '3344 GHJ'],
      ['DIRECCION', 'AVENIDA DE LA RIOJA 55, 26006 LOGROÑO'],
      ['ORGANO', 'JUZGADO DE INSTRUCCION N 4 DE LOGROÑO'],
      ['ORGANISMO', 'COMISARIA DE POLICIA NACIONAL DE LOGROÑO'],
    ],
  },
  {
    id: 'v-ocr-contrato-vasco',
    fuente: 'Escaneo de contrato, OCR en mayúsculas',
    clase: 'ocr',
    texto:
      'CONTRATO DE COMPRAVENTA DE PARTICIPACIONES\n\n' +
      'DE UNA PARTE, DON GORKA AGIRREZABALAGA URRUTIKOETXEA, DNI 12345678Z, EN NOMBRE DE ' +
      'INDUSTRIAS MECANICAS DEL DEBA S.L., CIF B76543214.\n' +
      'DE OTRA PARTE, DONA AINHOA ELORRIAGA GABILONDO, DNI 45678912S.\n\n' +
      'EL PRECIO SE ABONARA EN LA CUENTA ES7201822370410201234567 EN EL PLAZO DE QUINCE DIAS.',
    oro: [
      ['PERSONA', 'GORKA AGIRREZABALAGA URRUTIKOETXEA'],
      ['PERSONA', 'AINHOA ELORRIAGA GABILONDO'],
      ['DNI', '12345678Z'],
      ['DNI', '45678912S'],
      ['CIF', 'B76543214'],
      ['IBAN', 'ES7201822370410201234567'],
    ],
  },

  // ───────────────────────────── Categoría especial ─────────────────────────────
  {
    id: 'v-demanda-discapacidad',
    fuente: 'Demanda de reconocimiento de grado de discapacidad',
    clase: 'nativo',
    texto:
      'HECHOS\n\nPRIMERO.— D.ª Feliciana Urdiales Cotrina, con DNI 51234567C, solicitó la revisión de ' +
      'su grado de discapacidad ante el IMSERSO.\n\n' +
      'SEGUNDO.— La actora está diagnosticada de esclerosis múltiple remitente-recurrente desde 2019 y ' +
      'padece una depresión mayor con seguimiento en salud mental. En la actualidad se encuentra en ' +
      'tratamiento con interferón beta y sertralina.\n\n' +
      'TERCERO.— El dictamen del equipo de valoración le reconoció un grado de discapacidad de 33 %, ' +
      'porcentaje que se impugna.',
    oro: [
      // Juan, 26-sep: la discapacidad es categoría especial aunque solo diga el grado (Informe AEPD
      // 0007/2021 y DA 17.ª LOPDGDD). Se tapa también el grado.,
      ['CAT_ESPECIAL', 'discapacidad'],
      ['CAT_ESPECIAL', '33 %'],
      ['PERSONA', 'Feliciana Urdiales Cotrina'],
      ['DNI', '51234567C'],
      ['CAT_ESPECIAL', 'esclerosis múltiple remitente-recurrente'],
      ['CAT_ESPECIAL', 'depresión mayor'],
      ['CAT_ESPECIAL', 'seguimiento en salud mental'],
      ['CAT_ESPECIAL', 'sertralina'],
      ['ORGANISMO', 'IMSERSO'],
    ],
  },
  {
    id: 'v-despido-discriminatorio',
    fuente: 'Demanda por despido discriminatorio',
    clase: 'nativo',
    texto:
      'CUARTO.— La trabajadora, D.ª Rosalía Cifuentes Berzosa, comunicó a la empresa su embarazo el 4 de ' +
      'febrero. Es afiliada al sindicato UGT desde 2017 y de etnia gitana, circunstancias ambas ' +
      'conocidas por la dirección de recursos humanos.\n\n' +
      'QUINTO.— Siete días después recibió la carta de despido. Se invoca la nulidad del artículo 55.5 ' +
      'del Estatuto de los Trabajadores y la tutela del artículo 14 de la Constitución Española.',
    oro: [
      ['PERSONA', 'Rosalía Cifuentes Berzosa'],
      // Juan, 26-sep (duda 6): en un despido nulo el embarazo es el hecho que se litiga, y pasa.
      // La afiliación y la etnia no llevan criterio de fondo: se tapan.
      ['OBJETO', 'embarazo'],
      ['CAT_ESPECIAL', 'afiliada al sindicato UGT'],
      ['CAT_ESPECIAL', 'de etnia gitana'],
      ['NORMA', 'artículo 55.5 del Estatuto de los Trabajadores'],
      ['NORMA', 'artículo 14 de la Constitución Española'],
    ],
  },
  {
    id: 'v-familia-orientacion',
    fuente: 'Escrito de modificación de medidas',
    clase: 'nativo',
    texto:
      'TERCERO.— El progenitor, D. Aurelio Pizarro Menchén, alega como circunstancia sobrevenida la ' +
      'nueva convivencia de la madre, D.ª Jacinta Robledo Ferrán, cuya orientación sexual invoca de ' +
      'forma impropia como elemento de valoración.\n\n' +
      'Dicha alegación debe rechazarse de plano: el artículo 92 del Código Civil atiende al interés ' +
      'superior del menor y no a la vida privada de los progenitores.',
    oro: [
      ['PERSONA', 'Aurelio Pizarro Menchén'],
      ['PERSONA', 'Jacinta Robledo Ferrán'],
      ['CAT_ESPECIAL', 'orientación sexual'],
      ['NORMA', 'artículo 92 del Código Civil'],
    ],
  },
  {
    id: 'v-penal-antecedentes',
    fuente: 'Informe pericial psiquiátrico en causa penal',
    clase: 'nativo',
    texto:
      'INFORME PERICIAL PSIQUIÁTRICO\n\nEmitido por el Perito D. Teodoro Anchuelo Vidarte, psiquiatra ' +
      'colegiado nº 4.881, a instancia de la defensa de D. Higinio Naranjo Peláez.\n\n' +
      'El informado presenta un trastorno delirante crónico en tratamiento con risperidona, con un ' +
      'episodio de alcoholismo en remisión. Se aprecia una afectación leve de sus facultades ' +
      'volitivas a los efectos del artículo 21.1 del Código Penal.',
    oro: [
      // Duda 5 (Juan, 26-sep): el documento clínico por su nombre se tapa.
      ['CAT_ESPECIAL', 'INFORME PERICIAL PSIQUIÁTRICO'],
      ['PERITO', 'Teodoro Anchuelo Vidarte'],
      ['PERSONA', 'Higinio Naranjo Peláez'],
      ['CAT_ESPECIAL', 'trastorno delirante crónico'],
      ['CAT_ESPECIAL', 'risperidona'],
      ['CAT_ESPECIAL', 'alcoholismo'],
      ['NORMA', 'artículo 21.1 del Código Penal'],
    ],
  },

  // ───────────────────────────── Correos ─────────────────────────────
  {
    id: 'v-correo-interno',
    fuente: 'Correo interno del despacho',
    clase: 'correo',
    texto:
      'De: Práxedes Villarroel Osuna <p.villarroel@despachovo.es>\n' +
      'Para: equipo@despachovo.es\n' +
      'Asunto: Señalamiento del jueves\n\n' +
      'Hola Casilda:\n\n' +
      'El jueves tenemos la vista de Zurbarán en el Juzgado de lo Social nº 7 de Sevilla, Autos ' +
      '441/2024. Avisa por favor a Macarena Ordóñez Pelayo, que es la testigo, en el 611 908 447.\n\n' +
      'Un abrazo,\nPráxedes',
    oro: [
      ['PERSONA', 'Práxedes Villarroel Osuna'],
      ['PERSONA', 'Casilda'],
      ['PERSONA', 'Macarena Ordóñez Pelayo'],
      ['PERSONA', 'Práxedes'],
      ['CORREO', 'p.villarroel@despachovo.es'],
      ['CORREO', 'equipo@despachovo.es'],
      ['TELEFONO', '611 908 447'],
      ['ORGANO', 'Juzgado de lo Social nº 7 de Sevilla'],
      ['AUTOS', 'Autos 441/2024'],
    ],
  },
  {
    id: 'v-correo-cliente-factura',
    fuente: 'Correo de cliente con datos bancarios',
    clase: 'correo',
    texto:
      'De: Melchor Aizkorbe Iriarte <maizkorbe@construccionesai.com>\n' +
      'Para: facturacion@despachovo.es\n' +
      'Asunto: Provisión de fondos\n\n' +
      'Estimada Sra. Villarroel:\n\n' +
      'Le confirmo la transferencia de la provisión desde la cuenta ES6000491500051234567892. ' +
      'Mi NIF es 07654321J y el de la sociedad, B23456783. Cualquier cosa, en el 948 221 067.\n\n' +
      'Atentamente,\nMelchor Aizkorbe',
    oro: [
      ['PERSONA', 'Melchor Aizkorbe Iriarte'],
      ['PERSONA', 'Melchor Aizkorbe'],
      ['PERSONA', 'Villarroel'],
      ['CORREO', 'maizkorbe@construccionesai.com'],
      ['CORREO', 'facturacion@despachovo.es'],
      ['IBAN', 'ES6000491500051234567892'],
      ['DNI', '07654321J'],
      ['CIF', 'B23456783'],
      ['TELEFONO', '948 221 067'],
    ],
  },

  // ───────────────────────────── Solo intocables ─────────────────────────────
  {
    id: 'v-solo-normas',
    fuente: 'Fundamento de derecho, solo normas',
    clase: 'nativo',
    texto:
      'Resultan de aplicación el artículo 1902 del Código Civil, los artículos 216 y 218 de la Ley ' +
      '1/2000, de 7 de enero, de Enjuiciamiento Civil, el artículo 76 de la Ley 50/1980, de 8 de ' +
      'octubre, de Contrato de Seguro, y el Real Decreto Legislativo 8/2004, de 29 de octubre. ' +
      'En el ámbito europeo, la Directiva 2009/103/CE y la sentencia del Tribunal de Justicia de 20 de ' +
      'junio de 2019, asunto C-100/18.',
    oro: [
      ['NORMA', 'artículo 1902 del Código Civil'],
      ['NORMA', 'artículos 216 y 218 de la Ley 1/2000, de 7 de enero, de Enjuiciamiento Civil'],
      ['NORMA', 'artículo 76 de la Ley 50/1980, de 8 de octubre, de Contrato de Seguro'],
      ['NORMA', 'Real Decreto Legislativo 8/2004, de 29 de octubre'],
      ['NORMA', 'Directiva 2009/103/CE'],
      ['NORMA', 'asunto C-100/18'],
      ['ORGANO', 'Tribunal de Justicia'],
    ],
  },
  {
    id: 'v-solo-organos',
    fuente: 'Índice de actuaciones, solo órganos y autos',
    clase: 'nativo',
    texto:
      'ÍNDICE DE ACTUACIONES\n\n' +
      'Audiencia Provincial de Pontevedra, Sección 6ª, Rollo de Apelación 344/2025.\n' +
      'Juzgado de lo Mercantil nº 3 de Barcelona, Concurso Abreviado 91/2023.\n' +
      'Sala de lo Penal de la Audiencia Nacional, Sección 2ª, Rollo 18/2024.\n' +
      'Tribunal Superior de Justicia de Aragón, Sala de lo Civil y Penal, Recurso de Casación 2/2025.\n' +
      'Juzgado de Vigilancia Penitenciaria nº 1 de Cáceres, Expediente 205/2024.',
    oro: [
      ['ORGANO', 'Audiencia Provincial de Pontevedra, Sección 6ª'],
      ['ORGANO', 'Juzgado de lo Mercantil nº 3 de Barcelona'],
      ['ORGANO', 'Sala de lo Penal de la Audiencia Nacional, Sección 2ª'],
      ['ORGANO', 'Tribunal Superior de Justicia de Aragón'],
      ['ORGANO', 'Juzgado de Vigilancia Penitenciaria nº 1 de Cáceres'],
      ['AUTOS', 'Rollo de Apelación 344/2025'],
      ['AUTOS', 'Concurso Abreviado 91/2023'],
      ['AUTOS', 'Rollo 18/2024'],
      ['AUTOS', 'Recurso de Casación 2/2025'],
    ],
  },

  // ───────────────────────────── Apellido que también es topónimo o institución ─────────────────────────────
  {
    id: 'v-apellidos-traicioneros',
    fuente: 'Escrito con apellidos que coinciden con instituciones',
    clase: 'nativo',
    texto:
      'D. Lorenzo Guardia Civil, vecino de Soria, y D.ª Amalia Estado Mayor, vecina de Burgos, ' +
      'comparecen como demandantes frente a D. Cristóbal Ejército Vega.\n\n' +
      'Las actuaciones se siguen ante el Juzgado de Primera Instancia nº 2 de Soria, Ordinario ' +
      '155/2025, y se ha librado oficio a la Guardia Civil de Almazán y al Ministerio de Defensa.',
    oro: [
      ['PERSONA', 'Lorenzo Guardia Civil'],
      ['PERSONA', 'Amalia Estado Mayor'],
      ['PERSONA', 'Cristóbal Ejército Vega'],
      ['ORGANO', 'Juzgado de Primera Instancia nº 2 de Soria'],
      ['AUTOS', 'Ordinario 155/2025'],
      ['ORGANISMO', 'Guardia Civil de Almazán'],
      ['ORGANISMO', 'Ministerio de Defensa'],
    ],
  },
  {
    id: 'v-iniciales-y-abreviado',
    fuente: 'Escrito con iniciales y nombres abreviados',
    clase: 'nativo',
    texto:
      'Comparecen D. J. M. Escrivá de Balaguer Torrent, D.ª M.ª Ángeles Sanchidrián Recio y ' +
      'D. F. Javier Oyarzábal Mendiluce.\n\n' +
      'El primero actúa en su condición de administrador concursal, designado en el Concurso ' +
      'Abreviado 91/2023 del Juzgado de lo Mercantil nº 3 de Barcelona.',
    oro: [
      ['PERSONA', 'J. M. Escrivá de Balaguer Torrent'],
      ['PERSONA', 'M.ª Ángeles Sanchidrián Recio'],
      ['PERSONA', 'F. Javier Oyarzábal Mendiluce'],
      ['AUTOS', 'Concurso Abreviado 91/2023'],
      ['ORGANO', 'Juzgado de lo Mercantil nº 3 de Barcelona'],
    ],
  },
  {
    id: 'v-extranjeros',
    fuente: 'Escrito de extranjería con nombres no españoles',
    clase: 'nativo',
    texto:
      'Solicitante: D. Oleksandr Kovalenko Shevchenko, nacido en Járkov el 2 de agosto de 1990, ' +
      'NIE X1234567L, con domicilio en la calle Pere IV 221, 3º 2ª, 08005 Barcelona, teléfono ' +
      '632 118 904 y correo o.kovalenko@mail.example.\n\n' +
      'Acompaña contrato de trabajo con HOSTELERÍA DEL RAVAL S.L., CIF G22334452, y solicita ' +
      'protección internacional al amparo de la Ley 12/2009, de 30 de octubre.',
    oro: [
      ['PERSONA', 'Oleksandr Kovalenko Shevchenko'],
      ['NIE', 'X1234567L'],
      ['DIRECCION', 'calle Pere IV 221, 3º 2ª, 08005 Barcelona'],
      ['TELEFONO', '632 118 904'],
      ['CORREO', 'o.kovalenko@mail.example'],
      ['CIF', 'G22334452'],
      ['NORMA', 'Ley 12/2009, de 30 de octubre'],
    ],
  },

  // ───────────────────────────── Perífrasis ─────────────────────────────
  {
    id: 'v-perifrasis-2',
    fuente: 'Hechos con identificación por perífrasis',
    clase: 'nativo',
    texto:
      'La encargada del turno de noche de la residencia municipal avisó a la familia a las tres de la ' +
      'madrugada. El único hijo varón del causante, que vive en el extranjero, no pudo llegar a tiempo. ' +
      'El párroco de la localidad ofició el funeral dos días después.',
    oro: [
      ['PERIFRASIS', 'La encargada del turno de noche de la residencia municipal'],
      ['PERIFRASIS', 'El único hijo varón del causante, que vive en el extranjero'],
      ['PERIFRASIS', 'El párroco de la localidad'],
    ],
  },

  // ───────────────────────────── Expediente seguido (propagación) ─────────────────────────────
  {
    id: 'v-prop-01',
    fuente: 'Expediente seguido, escrito rector',
    clase: 'nativo',
    expediente: 'v-exp-urdiales',
    texto:
      'D.ª Feliciana Urdiales Cotrina, con DNI 51234567C, asistida por el Letrado D. Anastasio ' +
      'Robles Camuñas, formula demanda frente a la Tesorería General de la Seguridad Social ante el ' +
      'Juzgado de lo Social nº 2 de Palencia.',
    oro: [
      ['PERSONA', 'Feliciana Urdiales Cotrina'],
      ['PERSONA', 'Anastasio Robles Camuñas'],
      ['DNI', '51234567C'],
      ['ORGANISMO', 'Tesorería General de la Seguridad Social'],
      ['ORGANO', 'Juzgado de lo Social nº 2 de Palencia'],
    ],
  },
  {
    id: 'v-prop-02',
    fuente: 'Mismo expediente, segunda mención sin presentar',
    clase: 'nativo',
    expediente: 'v-exp-urdiales',
    texto:
      'Urdiales Cotrina acreditó la cotización mediante el informe de vida laboral aportado como ' +
      'documento número 4. Robles Camuñas interesó la ampliación del plazo, que fue concedida.',
    oro: [
      ['PERSONA', 'Urdiales Cotrina'],
      ['PERSONA', 'Robles Camuñas'],
    ],
  },
  {
    id: 'v-prop-03',
    fuente: 'Mismo expediente, anexo escaneado',
    clase: 'ocr',
    expediente: 'v-exp-urdiales',
    texto:
      'ANEXO I — DOCUMENTACION APORTADA POR DONA FELICIANA URDIALES COTRINA.\n' +
      'CONFORME: EL LETRADO DON ANASTASIO ROBLES CAMUNAS.',
    oro: [
      ['PERSONA', 'FELICIANA URDIALES COTRINA'],
      ['PERSONA', 'ANASTASIO ROBLES CAMUNAS'],
    ],
  },
];

export default VALIDACION;
