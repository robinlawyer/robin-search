// Banco de pruebas de nombres — corpus anotado.
//
// Cada fragmento es un trozo de documento como los que RobinSearch DEVUELVE en una respuesta
// (no como los indexa): lo que vería el filtro de salida en el punto único de index.js.
//
// Las anotaciones son LITERALES, no desplazamientos: `['PERSONA', 'Juan Pérez Gómez']` marca
// TODAS las apariciones de ese literal en el fragmento. El cargador (banco.mjs) las resuelve a
// posiciones, resuelve los solapes por el más largo primero («Juan Pérez Gómez» gana a «Pérez»)
// y aborta si un literal anotado no aparece en el texto, para que una errata no se cuele como
// un fallo del modelo.
//
// TIPOS
//
//   Se tapa (el modelo tiene que verlo):
//     PERSONA      nombre de persona física
//     PERITO       perito, de parte o judicial — fuera del bloque intocable (lista revisada 21-sep)
//     AGENTE       agente actuante CON nombre y apellidos — se tapa (dictamen AEPD 0049/2023)
//     DIRECCION    domicilio de una persona
//
//   Se tapa, y lo coge una regla determinista sin modelo (dígito de control):
//     DNI NIE CIF IBAN TELEFONO CORREO MATRICULA NUSS
//
//   Se tapa SIEMPRE en caso de duda (categoría especial, art. 9.1 RGPD):
//     CAT_ESPECIAL salud, orientación sexual, afiliación sindical, origen étnico
//
//   NUNCA se tapa (si el modelo lo marca, es sobre-tapado y degrada el escrito):
//     ORGANO       órgano judicial y su sede
//     AUTOS        número de autos, de recurso, de ejecución, de diligencias
//     ECLI ROJ     identificadores de resolución publicada
//     NORMA        normas y artículos
//     ORGANISMO    organismo público como institución
//     PONENTE      magistrado ponente de resolución publicada
//     LAJ          Letrado de la Administración de Justicia y personal de la oficina judicial
//     TIP          agente por su número de identificación profesional (sin nombre)
//
//   Techo conocido, se mide aparte y NO cuenta como fallo del modelo:
//     PERIFRASIS   identifica a una persona sin nombrarla («el administrador único de la
//                  mercantil del polígono de Alcobendas»). Ningún reconocedor lo coge.
//
// CLASES de fragmento: 'nativo' (texto extraído limpio), 'ocr' (escaneo en mayúsculas y sin
// tildes, como sale de tesseract), 'correo' (cuerpo de correo del despacho).
//
// Los DNI, NIE, CIF e IBAN llevan dígito de control VÁLIDO calculado, para que las reglas
// deterministas se midan de verdad y no contra cadenas inventadas.

export const CORPUS = [
  // ───────────────────────────── Civil: demanda y contrato ─────────────────────────────
  {
    id: 'demanda-ordinario-encabezamiento',
    fuente: 'Demanda de juicio ordinario, encabezamiento y suplico',
    clase: 'nativo',
    // Mismo expediente que los tres fragmentos de propagación del final: es AQUÍ donde se presentan
    // los nombres que allí aparecen ya sin presentar. Sin esto, la tabla de alias de ese expediente
    // llegaba vacía y la propagación no tenía nada que propagar.
    expediente: 'exp-perez-gomez',
    texto:
      'AL JUZGADO DE PRIMERA INSTANCIA Nº 5 DE MADRID\n\n' +
      'D.ª Marta Iglesias Rubio, Procuradora de los Tribunales, en nombre y representación de ' +
      'D. Juan Pérez Gómez, mayor de edad, con DNI 12345678Z y domicilio en la calle Serrano 45, ' +
      '3º B, 28006 Madrid, bajo la dirección letrada de D. Alberto Ferrer Castaño, colegiado nº 78.234 ' +
      'del Ilustre Colegio de la Abogacía de Madrid, comparezco y DIGO:\n\n' +
      'Que por medio del presente escrito formulo DEMANDA DE JUICIO ORDINARIO en reclamación de ' +
      'cantidad frente a CONSTRUCCIONES ALMAGRO S.L., con CIF B23456783 y domicilio social en el ' +
      'polígono industrial Las Mercedes, nave 12, de Alcobendas, en ejercicio de la acción de ' +
      'resolución contractual del artículo 1124 del Código Civil.',
    oro: [
      // «domicilio social en el polígono…»: el domicilio social de una empresa no es un dato de nadie.
      ['PERSONA', 'Marta Iglesias Rubio'],
      ['PERSONA', 'Juan Pérez Gómez'],
      ['PERSONA', 'Alberto Ferrer Castaño'],
      ['DNI', '12345678Z'],
      ['DIRECCION', 'calle Serrano 45, 3º B, 28006 Madrid'],
      ['CIF', 'B23456783'],
      ['ORGANO', 'JUZGADO DE PRIMERA INSTANCIA Nº 5 DE MADRID'],
      ['NORMA', 'artículo 1124 del Código Civil'],
      ['ORGANISMO', 'Ilustre Colegio de la Abogacía de Madrid'],
    ],
  },
  {
    id: 'contrato-arrendamiento-partes',
    fuente: 'Contrato de arrendamiento de vivienda, comparecencia',
    clase: 'nativo',
    texto:
      'REUNIDOS\n\nDe una parte, D. Ignacio Sanchís Bermúdez, mayor de edad, con DNI 45678912S, ' +
      'en adelante el ARRENDADOR.\n\nDe otra parte, D.ª Carolina Nieto Ordóñez, mayor de edad, con ' +
      'DNI 07654321J, en adelante la ARRENDATARIA.\n\n' +
      'La renta se abonará mediante transferencia a la cuenta ES9121000418450200051332 dentro de los ' +
      'siete primeros días de cada mes, conforme al artículo 17 de la Ley 29/1994, de 24 de noviembre, ' +
      'de Arrendamientos Urbanos. A efectos de notificaciones, la arrendataria señala el teléfono ' +
      '612 345 678 y el correo carolina.nieto@gmail.com.',
    oro: [
      ['PERSONA', 'Ignacio Sanchís Bermúdez'],
      ['PERSONA', 'Carolina Nieto Ordóñez'],
      ['DNI', '45678912S'],
      ['DNI', '07654321J'],
      ['IBAN', 'ES9121000418450200051332'],
      ['TELEFONO', '612 345 678'],
      ['CORREO', 'carolina.nieto@gmail.com'],
      ['NORMA', 'artículo 17 de la Ley 29/1994, de 24 de noviembre, de Arrendamientos Urbanos'],
    ],
  },
  {
    id: 'burofax-requerimiento',
    fuente: 'Burofax de requerimiento de pago',
    clase: 'nativo',
    texto:
      'Muy Sr. mío:\n\nEn nombre y representación de mi mandante, D.ª Rosario Aguilar Pineda, me dirijo a ' +
      'usted, D. Ramón Escudero Vilaplana, con domicilio en avenida del Cid 112, 46018 Valencia, para ' +
      'requerirle formalmente el pago de la cantidad de 14.500 euros, más los intereses de demora del ' +
      'artículo 1108 del Código Civil, en el plazo improrrogable de diez días hábiles.\n\n' +
      'Transcurrido dicho plazo sin atender el requerimiento, se interpondrá la correspondiente demanda ' +
      'ante los Juzgados de Primera Instancia de Valencia, con expresa imposición de costas.',
    oro: [
      ['PERSONA', 'Rosario Aguilar Pineda'],
      ['PERSONA', 'Ramón Escudero Vilaplana'],
      ['DIRECCION', 'avenida del Cid 112, 46018 Valencia'],
      ['NORMA', 'artículo 1108 del Código Civil'],
      ['ORGANO', 'Juzgados de Primera Instancia de Valencia'],
    ],
  },
  {
    id: 'escritura-compraventa',
    fuente: 'Escritura pública de compraventa, otorgamiento',
    clase: 'nativo',
    texto:
      'Ante mí, D. Fernando Quiroga Alonso, Notario del Ilustre Colegio Notarial de Andalucía, con ' +
      'residencia en Sevilla, comparecen:\n\n' +
      'De una parte, D.ª Purificación Bermejo Lastra, con DNI 51234567C, y de otra, D. Salvador ' +
      'Ontiveros Rey, con DNI 28765432E, ambos mayores de edad y con capacidad legal suficiente.\n\n' +
      'La finca registral 14.882 del Registro de la Propiedad nº 3 de Sevilla se transmite libre de ' +
      'cargas, sirviendo el presente otorgamiento de título conforme a los artículos 609 y 1462 del ' +
      'Código Civil.',
    oro: [
      ['PERSONA', 'Fernando Quiroga Alonso'],
      ['PERSONA', 'Purificación Bermejo Lastra'],
      ['PERSONA', 'Salvador Ontiveros Rey'],
      ['DNI', '51234567C'],
      ['DNI', '28765432E'],
      ['ORGANISMO', 'Registro de la Propiedad nº 3 de Sevilla'],
      ['ORGANISMO', 'Ilustre Colegio Notarial de Andalucía'],
      ['NORMA', 'artículos 609 y 1462 del Código Civil'],
    ],
  },

  // ───────────────────────────── Resoluciones publicadas (intocables) ─────────────────────────────
  {
    id: 'sentencia-ts-encabezamiento',
    fuente: 'Sentencia del Tribunal Supremo, Sala Primera — encabezamiento',
    clase: 'nativo',
    texto:
      'TRIBUNAL SUPREMO. Sala de lo Civil. Sentencia núm. 512/2024, de 17 de abril. ' +
      'Recurso de casación núm. 3.421/2021. Ponente: Excmo. Sr. D. Ignacio Sancho Gargallo. ' +
      'ECLI:ES:TS:2024:1780. ROJ: STS 1780/2024.\n\n' +
      'La Sala, tras deliberación, votación y fallo, dicta la presente sentencia con aplicación del ' +
      'artículo 1281 del Código Civil y de la doctrina de la STS 419/2020, de 13 de julio.',
    oro: [
      ['ORGANO', 'TRIBUNAL SUPREMO'],
      ['ORGANO', 'Sala de lo Civil'],
      ['AUTOS', 'Recurso de casación núm. 3.421/2021'],
      ['PONENTE', 'Ignacio Sancho Gargallo'],
      ['ECLI', 'ECLI:ES:TS:2024:1780'],
      ['ROJ', 'ROJ: STS 1780/2024'],
      ['NORMA', 'artículo 1281 del Código Civil'],
      ['NORMA', 'STS 419/2020, de 13 de julio'],
    ],
  },
  {
    id: 'diligencia-ordenacion-laj',
    fuente: 'Diligencia de ordenación del Letrado de la Administración de Justicia',
    clase: 'nativo',
    texto:
      'DILIGENCIA DE ORDENACIÓN\n\nLetrado de la Administración de Justicia: D. Carlos Mendaña Prieto.\n' +
      'En Bilbao, a 3 de marzo de 2025.\n\n' +
      'Habiéndose presentado escrito por la Procuradora D.ª Lucía Berrocal Íñiguez en nombre de ' +
      'D. Andrés Valcárcel Sanz, se acuerda unirlo a los autos de Procedimiento Ordinario 348/2024 ' +
      'seguidos ante el Juzgado de Primera Instancia nº 8 de Bilbao, y dar traslado a la contraparte ' +
      'por plazo de diez días conforme al artículo 404 de la Ley de Enjuiciamiento Civil.\n\n' +
      'La tramitación corresponde a la Gestora Procesal D.ª Yolanda Requejo Mata.',
    oro: [
      ['LAJ', 'Carlos Mendaña Prieto'],
      ['LAJ', 'Yolanda Requejo Mata'],
      ['PERSONA', 'Lucía Berrocal Íñiguez'],
      ['PERSONA', 'Andrés Valcárcel Sanz'],
      ['AUTOS', 'Procedimiento Ordinario 348/2024'],
      ['ORGANO', 'Juzgado de Primera Instancia nº 8 de Bilbao'],
      ['NORMA', 'artículo 404 de la Ley de Enjuiciamiento Civil'],
    ],
  },
  {
    id: 'cita-normativa-pura',
    fuente: 'Fundamento de derecho, solo normas y resoluciones',
    clase: 'nativo',
    texto:
      'De conformidad con lo dispuesto en el artículo 24.1 de la Constitución Española, en los ' +
      'artículos 394 y 398 de la Ley 1/2000, de 7 de enero, de Enjuiciamiento Civil, y en el artículo ' +
      '6.3 del Código Civil, y siguiendo el criterio fijado por el Tribunal Constitucional en la ' +
      'STC 140/2018, de 20 de diciembre, y por el Tribunal de Justicia de la Unión Europea en la ' +
      'sentencia de 3 de octubre de 2019, asunto C-260/18, procede estimar la pretensión.',
    oro: [
      ['NORMA', 'artículo 24.1 de la Constitución Española'],
      ['NORMA', 'artículos 394 y 398 de la Ley 1/2000, de 7 de enero, de Enjuiciamiento Civil'],
      ['NORMA', 'artículo 6.3 del Código Civil'],
      ['NORMA', 'STC 140/2018, de 20 de diciembre'],
      ['NORMA', 'asunto C-260/18'],
      ['ORGANO', 'Tribunal Constitucional'],
      ['ORGANO', 'Tribunal de Justicia de la Unión Europea'],
    ],
  },
  {
    id: 'auto-ejecucion',
    fuente: 'Auto despachando ejecución',
    clase: 'nativo',
    texto:
      'AUTO\n\nMagistrada-Juez: Ilma. Sra. D.ª Beatriz Colomer Nadal.\n' +
      'Juzgado de Primera Instancia e Instrucción nº 2 de Talavera de la Reina.\n' +
      'Ejecución de Títulos Judiciales 117/2025.\n\n' +
      'Se despacha ejecución a instancia de D.ª Encarnación Prats Solsona frente a D. Eloy Cabanillas ' +
      'Herrero por importe de 22.340,18 euros de principal, más 6.702 euros presupuestados para ' +
      'intereses y costas, conforme al artículo 575 de la Ley de Enjuiciamiento Civil.',
    oro: [
      ['PONENTE', 'Beatriz Colomer Nadal'],
      ['ORGANO', 'Juzgado de Primera Instancia e Instrucción nº 2 de Talavera de la Reina'],
      ['AUTOS', 'Ejecución de Títulos Judiciales 117/2025'],
      ['PERSONA', 'Encarnación Prats Solsona'],
      ['PERSONA', 'Eloy Cabanillas Herrero'],
      ['NORMA', 'artículo 575 de la Ley de Enjuiciamiento Civil'],
    ],
  },

  // ───────────────────────────── Penal: atestado, agentes, peritos ─────────────────────────────
  {
    id: 'atestado-agentes-tip',
    fuente: 'Atestado de la Guardia Civil, diligencia de comparecencia',
    clase: 'nativo',
    texto:
      'DILIGENCIA DE COMPARECENCIA. En el Puesto de la Guardia Civil de Alcalá de Henares, siendo las ' +
      '18:40 horas del día 12 de enero de 2025, ante los Agentes con TIP U-34215 y TIP U-34216 ' +
      'comparece D. Sebastián Otero Manrique, con DNI 09876543K, quien manifiesta haber sido agredido.\n\n' +
      'Practicada la inspección ocular por el Agente D. Manuel Espejo Trillo, se hace constar que el ' +
      'vehículo implicado, matrícula 4521 KDR, se encontraba estacionado frente al número 8 de la calle ' +
      'Mayor. Se instruyen Diligencias Previas 214/2025 del Juzgado de Instrucción nº 3 de Alcalá de ' +
      'Henares.',
    oro: [
      ['TIP', 'TIP U-34215'],
      ['TIP', 'TIP U-34216'],
      ['AGENTE', 'Manuel Espejo Trillo'],
      ['PERSONA', 'Sebastián Otero Manrique'],
      ['DNI', '09876543K'],
      ['MATRICULA', '4521 KDR'],
      ['AUTOS', 'Diligencias Previas 214/2025'],
      ['ORGANO', 'Juzgado de Instrucción nº 3 de Alcalá de Henares'],
      ['ORGANISMO', 'Guardia Civil'],
    ],
  },
  {
    id: 'informe-pericial-privado',
    fuente: 'Informe pericial de parte, hoja de firma',
    clase: 'nativo',
    texto:
      'INFORME PERICIAL CALIGRÁFICO\n\nEmitido por D. Gonzalo Arrieta Pazos, perito calígrafo, ' +
      'colegiado nº 1.442, a instancia de la representación procesal de D.ª Amparo Vidal Sagrera.\n\n' +
      'Conclusión: la firma obrante al folio 34 no ha sido estampada por el puño y letra de ' +
      'D. Ricardo Salcedo Buendía. El presente dictamen se emite a los efectos del artículo 335 de la ' +
      'Ley de Enjuiciamiento Civil y se aporta en los autos de Juicio Ordinario 902/2024.',
    oro: [
      ['PERITO', 'Gonzalo Arrieta Pazos'],
      ['PERSONA', 'Amparo Vidal Sagrera'],
      ['PERSONA', 'Ricardo Salcedo Buendía'],
      ['NORMA', 'artículo 335 de la Ley de Enjuiciamiento Civil'],
      ['AUTOS', 'Juicio Ordinario 902/2024'],
    ],
  },
  {
    id: 'informe-forense-iml',
    fuente: 'Informe médico-forense del Instituto de Medicina Legal',
    clase: 'nativo',
    texto:
      'INSTITUTO DE MEDICINA LEGAL Y CIENCIAS FORENSES DE MURCIA\n\n' +
      'Informe emitido por la Médico Forense D.ª Pilar Anguita Sarabia a requerimiento del Juzgado de ' +
      'Violencia sobre la Mujer nº 1 de Murcia, Diligencias Urgentes 88/2025.\n\n' +
      'Reconocida D.ª Noelia Cascales Ripoll, se aprecian lesiones compatibles con el mecanismo descrito. ' +
      'La paciente refiere un trastorno de ansiedad generalizada en tratamiento con sertralina desde 2022 ' +
      'y consta en su historia clínica un episodio depresivo mayor en 2019.',
    oro: [
      ['CAT_ESPECIAL', 'historia clínica'],
      ['PERITO', 'Pilar Anguita Sarabia'],
      ['PERSONA', 'Noelia Cascales Ripoll'],
      ['ORGANISMO', 'INSTITUTO DE MEDICINA LEGAL Y CIENCIAS FORENSES DE MURCIA'],
      ['ORGANO', 'Juzgado de Violencia sobre la Mujer nº 1 de Murcia'],
      ['AUTOS', 'Diligencias Urgentes 88/2025'],
      ['CAT_ESPECIAL', 'trastorno de ansiedad generalizada en tratamiento con sertralina'],
      ['CAT_ESPECIAL', 'episodio depresivo mayor'],
    ],
  },
  {
    id: 'escrito-acusacion',
    fuente: 'Escrito de acusación del Ministerio Fiscal',
    clase: 'nativo',
    texto:
      'AL JUZGADO DE LO PENAL Nº 4 DE ZARAGOZA\n\nEL FISCAL, despachando el trámite conferido en el ' +
      'Procedimiento Abreviado 455/2024, formula escrito de acusación contra D. Óscar Benegas Mustafá, ' +
      'con NIE X1234567L, nacido el 4 de mayo de 1988, por un delito de estafa de los artículos 248 y ' +
      '250.1.5º del Código Penal.\n\n' +
      'Se solicita la práctica de la declaración del perjudicado D. Jaime Turégano Ferrándiz y la ' +
      'testifical de D.ª Inmaculada Sos Beltrán.',
    oro: [
      ['PERSONA', 'Óscar Benegas Mustafá'],
      ['PERSONA', 'Jaime Turégano Ferrándiz'],
      ['PERSONA', 'Inmaculada Sos Beltrán'],
      ['NIE', 'X1234567L'],
      ['ORGANO', 'JUZGADO DE LO PENAL Nº 4 DE ZARAGOZA'],
      ['AUTOS', 'Procedimiento Abreviado 455/2024'],
      ['NORMA', 'artículos 248 y 250.1.5º del Código Penal'],
      ['ORGANISMO', 'EL FISCAL'],
    ],
  },

  // ───────────────────────────── Laboral y categoría especial ─────────────────────────────
  {
    id: 'carta-despido',
    fuente: 'Carta de despido disciplinario',
    clase: 'nativo',
    texto:
      'Estimado Sr. Domínguez:\n\nPor la presente le comunicamos que TEXTILES RIBERA DEL DUERO S.A., ' +
      'con CIF A87654323, ha decidido proceder a su despido disciplinario con efectos del 28 de febrero ' +
      'de 2025, al amparo del artículo 54.2.d) del Estatuto de los Trabajadores.\n\n' +
      'Los hechos imputados a D. Alfonso Domínguez Recalde, con DNI 12345678Z y número de afiliación a ' +
      'la Seguridad Social 28/1234567890, consisten en la transgresión de la buena fe contractual.\n\n' +
      'Se le liquidará el finiquito en la cuenta ES6000491500051234567892.',
    oro: [
      ['PERSONA', 'Domínguez'],
      ['PERSONA', 'Alfonso Domínguez Recalde'],
      ['DNI', '12345678Z'],
      ['CIF', 'A87654323'],
      ['NUSS', '28/1234567890'],
      ['IBAN', 'ES6000491500051234567892'],
      ['NORMA', 'artículo 54.2.d) del Estatuto de los Trabajadores'],
      ['ORGANISMO', 'Seguridad Social'],
    ],
  },
  {
    id: 'demanda-tutela-sindical',
    fuente: 'Demanda de tutela de derechos fundamentales, hechos',
    clase: 'nativo',
    texto:
      'HECHOS\n\nPRIMERO.— D.ª Montserrat Aizpurúa Lecumberri presta servicios para la empresa desde el ' +
      '4 de septiembre de 2015 con la categoría de Técnico Superior.\n\n' +
      'SEGUNDO.— La actora es afiliada al sindicato Comisiones Obreras desde 2018 y fue elegida ' +
      'delegada sindical en las elecciones de 2023. Consta asimismo que profesa la religión evangélica, ' +
      'extremo conocido por la dirección.\n\n' +
      'TERCERO.— Tras la comunicación de su condición de representante, la empresa la apartó de sus ' +
      'funciones, lo que constituye la vulneración del artículo 28.1 de la Constitución Española que se ' +
      'denuncia, con arreglo al procedimiento de los artículos 177 y siguientes de la Ley 36/2011, ' +
      'reguladora de la jurisdicción social.',
    oro: [
      ['CAT_ESPECIAL', 'delegada sindical'],
      ['PERSONA', 'Montserrat Aizpurúa Lecumberri'],
      ['CAT_ESPECIAL', 'afiliada al sindicato Comisiones Obreras'],
      ['CAT_ESPECIAL', 'profesa la religión evangélica'],
      ['NORMA', 'artículo 28.1 de la Constitución Española'],
      ['NORMA', 'artículos 177 y siguientes de la Ley 36/2011, reguladora de la jurisdicción social'],
    ],
  },
  {
    id: 'incapacidad-permanente',
    fuente: 'Reclamación previa ante el INSS',
    clase: 'nativo',
    texto:
      'RECLAMACIÓN PREVIA ANTE EL INSTITUTO NACIONAL DE LA SEGURIDAD SOCIAL\n\n' +
      'D. Severino Lombardero Cuervo, con DNI 45678912S y NUSS 33/9876543210, frente a la resolución ' +
      'de la Dirección Provincial de Asturias de 11 de diciembre de 2024 que le deniega la incapacidad ' +
      'permanente total.\n\n' +
      'El reclamante padece espondilitis anquilosante con afectación sacroilíaca bilateral y está ' +
      'diagnosticado de diabetes mellitus tipo 2 insulinodependiente, según consta en los informes del ' +
      'Servicio de Reumatología del Hospital Universitario Central de Asturias.',
    oro: [
      // Duda 1 (Juan, 26-sep): la calificación que se deniega es el objeto del escrito y pasa; el
      // detalle clínico que la acompaña se tapa.,
      ['OBJETO', 'incapacidad permanente total'],
      ['PERSONA', 'Severino Lombardero Cuervo'],
      ['DNI', '45678912S'],
      ['NUSS', '33/9876543210'],
      ['CAT_ESPECIAL', 'espondilitis anquilosante con afectación sacroilíaca bilateral'],
      ['CAT_ESPECIAL', 'diabetes mellitus tipo 2 insulinodependiente'],
      ['ORGANISMO', 'INSTITUTO NACIONAL DE LA SEGURIDAD SOCIAL'],
      ['ORGANISMO', 'Hospital Universitario Central de Asturias'],
    ],
  },
  {
    id: 'acta-conciliacion-smac',
    fuente: 'Papeleta de conciliación ante el SMAC',
    clase: 'nativo',
    texto:
      'PAPELETA DE CONCILIACIÓN\n\nAnte el Servicio de Mediación, Arbitraje y Conciliación de la ' +
      'Comunidad de Madrid, D.ª Vanesa Portillo Castañeda, con domicilio a efectos de notificaciones en ' +
      'la calle Bravo Murillo 210, 2º C, 28020 Madrid, teléfono 655 120 447 y correo ' +
      'v.portillo@despachoruiz.es, insta conciliación frente a LOGÍSTICA INTEGRAL DEL SUR S.L.U., ' +
      'CIF B76543214, por despido improcedente.',
    oro: [
      ['PERSONA', 'Vanesa Portillo Castañeda'],
      ['DIRECCION', 'calle Bravo Murillo 210, 2º C, 28020 Madrid'],
      ['TELEFONO', '655 120 447'],
      ['CORREO', 'v.portillo@despachoruiz.es'],
      ['CIF', 'B76543214'],
      ['ORGANISMO', 'Servicio de Mediación, Arbitraje y Conciliación de la Comunidad de Madrid'],
    ],
  },

  // ───────────────────────────── Escaneos OCR: MAYÚSCULAS SIN TILDES ─────────────────────────────
  {
    id: 'ocr-demanda-mayusculas',
    fuente: 'Escaneo de demanda, OCR en mayúsculas sin tildes',
    clase: 'ocr',
    texto:
      'AL JUZGADO DE PRIMERA INSTANCIA N 12 DE BARCELONA\n\n' +
      'DON JOAQUIN MUNOZ ESTEVEZ, PROCURADOR DE LOS TRIBUNALES, EN NOMBRE DE DONA MARIA DEL CARMEN ' +
      'PENALVER GUZMAN, MAYOR DE EDAD, CON DNI 51234567C Y DOMICILIO EN CARRER DE BALMES 87, 08008 ' +
      'BARCELONA, ANTE EL JUZGADO COMPARECE Y COMO MEJOR PROCEDA EN DERECHO DICE:\n\n' +
      'QUE FORMULA DEMANDA DE DESAHUCIO POR FALTA DE PAGO CONTRA DON ELADIO QUESADA MARTORELL, ' +
      'AL AMPARO DEL ARTICULO 250.1.1 DE LA LEY DE ENJUICIAMIENTO CIVIL.',
    oro: [
      ['PERSONA', 'JOAQUIN MUNOZ ESTEVEZ'],
      ['PERSONA', 'MARIA DEL CARMEN PENALVER GUZMAN'],
      ['PERSONA', 'ELADIO QUESADA MARTORELL'],
      ['DNI', '51234567C'],
      ['DIRECCION', 'CARRER DE BALMES 87, 08008 BARCELONA'],
      ['ORGANO', 'JUZGADO DE PRIMERA INSTANCIA N 12 DE BARCELONA'],
      ['NORMA', 'ARTICULO 250.1.1 DE LA LEY DE ENJUICIAMIENTO CIVIL'],
    ],
  },
  {
    id: 'ocr-acta-notarial',
    fuente: 'Escaneo de acta notarial, OCR en mayúsculas sin tildes',
    clase: 'ocr',
    texto:
      'ACTA DE MANIFESTACIONES\n\nANTE MI, DON JESUS ANGEL BARRENECHEA URIBE, NOTARIO DE VITORIA-GASTEIZ, ' +
      'COMPARECE DONA BEGONA ETXEBARRIA ZULOAGA, CON DNI 28765432E, ASISTIDA DE SU LETRADO DON ' +
      'IKER AGIRRETXE LARRANAGA, COLEGIADO NUMERO 3.221.\n\n' +
      'MANIFIESTA QUE EL VEHICULO MATRICULA 7788 LBM FUE ADQUIRIDO POR SU DIFUNTO ESPOSO DON ' +
      'ANTXON GOIKOETXEA MENDIZABAL, FALLECIDO EL 2 DE ABRIL DE 2024.',
    oro: [
      ['PERSONA', 'JESUS ANGEL BARRENECHEA URIBE'],
      ['PERSONA', 'BEGONA ETXEBARRIA ZULOAGA'],
      ['PERSONA', 'IKER AGIRRETXE LARRANAGA'],
      ['PERSONA', 'ANTXON GOIKOETXEA MENDIZABAL'],
      ['DNI', '28765432E'],
      ['MATRICULA', '7788 LBM'],
    ],
  },
  {
    id: 'ocr-atestado-trafico',
    fuente: 'Escaneo de atestado de tráfico, OCR en mayúsculas sin tildes',
    clase: 'ocr',
    texto:
      'ATESTADO NUMERO 1.204/2025 DE LA AGRUPACION DE TRAFICO DE LA GUARDIA CIVIL\n\n' +
      'INSTRUIDO POR EL AGENTE TIP K-90117, ACTUANDO COMO SECRETARIO EL AGENTE TIP K-90118.\n\n' +
      'CONDUCTOR DEL VEHICULO A, MATRICULA 1234 FGH: DON RUBEN CAPDEVILA ORIOL, DNI 09876543K, ' +
      'TELEFONO 699 887 221. CONDUCTOR DEL VEHICULO B, MATRICULA 5566 JKL: DONA SOLEDAD ' +
      'VILLANUEVA ARAMBURU, DNI 07654321J.\n\n' +
      'SE REMITE AL JUZGADO DE INSTRUCCION N 2 DE LUGO A LOS EFECTOS DEL ARTICULO 142 DEL CODIGO PENAL.',
    oro: [
      ['PERSONA', 'RUBEN CAPDEVILA ORIOL'],
      ['PERSONA', 'SOLEDAD VILLANUEVA ARAMBURU'],
      ['DNI', '09876543K'],
      ['DNI', '07654321J'],
      ['TELEFONO', '699 887 221'],
      ['MATRICULA', '1234 FGH'],
      ['MATRICULA', '5566 JKL'],
      ['TIP', 'TIP K-90117'],
      ['TIP', 'TIP K-90118'],
      ['ORGANO', 'JUZGADO DE INSTRUCCION N 2 DE LUGO'],
      ['NORMA', 'ARTICULO 142 DEL CODIGO PENAL'],
      ['ORGANISMO', 'AGRUPACION DE TRAFICO DE LA GUARDIA CIVIL'],
    ],
  },
  {
    id: 'ocr-nomina',
    fuente: 'Escaneo de nómina, OCR en mayúsculas sin tildes',
    clase: 'ocr',
    texto:
      'RECIBO INDIVIDUAL DE SALARIOS\n\nEMPRESA: MONTAJES ELECTRICOS DEL NORTE S.L. CIF B23456783\n' +
      'TRABAJADOR: DON GERMAN ALBERDI ZUBIZARRETA. DNI 12345678Z. NAF 20/4567891234.\n' +
      'CATEGORIA: OFICIAL DE PRIMERA. ANTIGUEDAD: 12/03/2011.\n' +
      'ABONO EN CUENTA ES5420950123456789012345.',
    oro: [
      ['PERSONA', 'GERMAN ALBERDI ZUBIZARRETA'],
      ['DNI', '12345678Z'],
      ['CIF', 'B23456783'],
      ['NUSS', '20/4567891234'],
      ['IBAN', 'ES5420950123456789012345'],
    ],
  },

  // ───────────────────────────── Ambigüedad: dos apellidos iguales ─────────────────────────────
  {
    id: 'dos-perez-mismo-pleito',
    fuente: 'Acta de vista, dos partes con el mismo apellido',
    clase: 'nativo',
    texto:
      'Comparecen en el acto de la vista D. Manuel Pérez Alcaraz, demandante, y su hermano ' +
      'D. Fernando Pérez Alcaraz, demandado, ambos asistidos de letrado.\n\n' +
      'Interrogado Pérez Alcaraz sobre el origen de los fondos, manifiesta que procedían de la herencia ' +
      'materna. La letrada de la contraparte pregunta si Pérez tuvo acceso a la cuenta, a lo que ' +
      'responde negativamente.\n\n' +
      'El testigo D. Cipriano Pérez Ruano, primo de ambos, declara a continuación.',
    oro: [
      ['PERSONA', 'Manuel Pérez Alcaraz'],
      ['PERSONA', 'Fernando Pérez Alcaraz'],
      ['PERSONA', 'Cipriano Pérez Ruano'],
      ['PERSONA', 'Pérez Alcaraz'],
      ['PERSONA', 'Pérez'],
    ],
    // Este fragmento es el caso que Alonso describe: «un "Pérez" a secas cuando hay dos Pérez en el
    // pleito». Las menciones cortas se anotan como PERSONA porque hay que taparlas; qué alias les
    // corresponde es un problema distinto (y sin solución fiable), y se reporta como techo.
    ambiguo: ['Pérez Alcaraz', 'Pérez'],
  },
  {
    id: 'nombre-que-es-tambien-lugar',
    fuente: 'Escrito con apellidos que coinciden con topónimos y con órganos',
    clase: 'nativo',
    texto:
      'D. Álvaro Toledo Salamanca, vecino de Cuenca, interpone recurso frente a la resolución del ' +
      'Ayuntamiento de Toledo, siendo parte codemandada D.ª Lucía Segovia Ávila, funcionaria de la ' +
      'Diputación Provincial de Salamanca.\n\n' +
      'El asunto se sigue ante el Juzgado de lo Contencioso-Administrativo nº 1 de Toledo, ' +
      'Procedimiento Abreviado 62/2025.',
    oro: [
      ['PERSONA', 'Álvaro Toledo Salamanca'],
      ['PERSONA', 'Lucía Segovia Ávila'],
      ['ORGANISMO', 'Ayuntamiento de Toledo'],
      ['ORGANISMO', 'Diputación Provincial de Salamanca'],
      ['ORGANO', 'Juzgado de lo Contencioso-Administrativo nº 1 de Toledo'],
      ['AUTOS', 'Procedimiento Abreviado 62/2025'],
    ],
  },
  {
    id: 'nombre-compuesto-y-particula',
    fuente: 'Poder para pleitos, nombres compuestos y con partícula',
    clase: 'nativo',
    texto:
      'Otorgan poder tan amplio y bastante como en Derecho se requiera D.ª María José de la Fuente ' +
      'Calatayud, D. Juan Carlos Sáenz de Tejada Ibarrola, D.ª Ana Belén Ruiz de Alda Muñagorri y ' +
      'D. José María Fernández-Ordóñez del Pino, a favor de los Procuradores D. Tomás Larrea Goicoechea ' +
      'y D.ª Emilia Santacruz Villalonga.',
    oro: [
      ['PERSONA', 'María José de la Fuente Calatayud'],
      ['PERSONA', 'Juan Carlos Sáenz de Tejada Ibarrola'],
      ['PERSONA', 'Ana Belén Ruiz de Alda Muñagorri'],
      ['PERSONA', 'José María Fernández-Ordóñez del Pino'],
      ['PERSONA', 'Tomás Larrea Goicoechea'],
      ['PERSONA', 'Emilia Santacruz Villalonga'],
    ],
  },

  // ───────────────────────────── Techo: identificación sin nombre ─────────────────────────────
  {
    id: 'perifrasis-administrador-unico',
    fuente: 'Hechos de una demanda, identificación por perífrasis',
    clase: 'nativo',
    texto:
      'El administrador único de la mercantil del polígono de Alcobendas se personó en las oficinas el ' +
      'día 14 y exigió la entrega inmediata de la documentación contable.\n\n' +
      'La hija mayor del anterior arrendatario, que regenta el único estanco de la localidad, presenció ' +
      'los hechos. También estaba presente el médico de familia del centro de salud del barrio, que ' +
      'atendía a la demandante desde 2016.',
    oro: [
      ['PERIFRASIS', 'El administrador único de la mercantil del polígono de Alcobendas'],
      ['PERIFRASIS', 'La hija mayor del anterior arrendatario, que regenta el único estanco de la localidad'],
      ['PERIFRASIS', 'el médico de familia del centro de salud del barrio'],
    ],
  },

  // ───────────────────────────── Mercantil y societario ─────────────────────────────
  {
    id: 'acta-junta-general',
    fuente: 'Acta de junta general de socios',
    clase: 'nativo',
    texto:
      'ACTA DE LA JUNTA GENERAL EXTRAORDINARIA DE SOCIOS DE INVERSIONES BALUARTE S.L., CIF G22334452\n\n' +
      'Preside la reunión D. Enrique Lizarraga Otazu, administrador único, actuando como secretaria ' +
      'D.ª Teresa Munárriz Elizalde.\n\n' +
      'Asisten los socios D. Pablo Irurzun Berasategui, titular del 45% del capital, y D.ª Cristina ' +
      'Goñi Armendáriz, titular del 30%. Se adopta por unanimidad el acuerdo de ampliación de capital ' +
      'conforme a los artículos 295 y siguientes de la Ley de Sociedades de Capital, acuerdo que se ' +
      'elevará a público e inscribirá en el Registro Mercantil de Navarra.',
    oro: [
      ['PERSONA', 'Enrique Lizarraga Otazu'],
      ['PERSONA', 'Teresa Munárriz Elizalde'],
      ['PERSONA', 'Pablo Irurzun Berasategui'],
      ['PERSONA', 'Cristina Goñi Armendáriz'],
      ['CIF', 'G22334452'],
      ['NORMA', 'artículos 295 y siguientes de la Ley de Sociedades de Capital'],
      ['ORGANISMO', 'Registro Mercantil de Navarra'],
    ],
  },
  {
    id: 'due-diligence-contrato',
    fuente: 'Revisión de contrato mercantil, cláusula de notificaciones',
    clase: 'nativo',
    texto:
      'DÉCIMA.— NOTIFICACIONES. Las comunicaciones entre las partes se dirigirán:\n\n' +
      'A la VENDEDORA: at. D. Rodrigo Villaescusa Peñalba, calle Orense 68, planta 7, 28020 Madrid, ' +
      'correo rvillaescusa@baluarte-inv.com, teléfono +34 917 220 341.\n\n' +
      'A la COMPRADORA: at. D.ª Silvia Marimón Farreny, passeig de Gràcia 21, 08007 Barcelona, ' +
      'correo s.marimon@grupfarreny.cat, teléfono +34 934 881 092.\n\n' +
      'Toda controversia se someterá a los Juzgados y Tribunales de la ciudad de Madrid, con renuncia ' +
      'expresa a cualquier otro fuero que pudiera corresponder.',
    oro: [
      ['PERSONA', 'Rodrigo Villaescusa Peñalba'],
      ['PERSONA', 'Silvia Marimón Farreny'],
      ['DIRECCION', 'calle Orense 68, planta 7, 28020 Madrid'],
      ['DIRECCION', "passeig de Gràcia 21, 08007 Barcelona"],
      ['CORREO', 'rvillaescusa@baluarte-inv.com'],
      ['CORREO', 's.marimon@grupfarreny.cat'],
      ['TELEFONO', '+34 917 220 341'],
      ['TELEFONO', '+34 934 881 092'],
      ['ORGANO', 'Juzgados y Tribunales de la ciudad de Madrid'],
    ],
  },
  {
    id: 'concurso-acreedores',
    fuente: 'Solicitud de concurso voluntario, lista de acreedores',
    clase: 'nativo',
    texto:
      'AL JUZGADO DE LO MERCANTIL Nº 2 DE LAS PALMAS DE GRAN CANARIA\n\n' +
      'La concursada CANARIAS FRÍO INDUSTRIAL S.L., CIF B76543214, representada por su administrador ' +
      'D. Domingo Betancor Quintana, solicita la declaración de concurso voluntario al amparo del ' +
      'artículo 2 del Texto Refundido de la Ley Concursal.\n\n' +
      'Se propone como administrador concursal a D. Aitor Mendiluce Zabaleta, economista, y se acompaña ' +
      'la lista de acreedores, entre los que figuran la Agencia Estatal de Administración Tributaria y ' +
      'la Tesorería General de la Seguridad Social.',
    oro: [
      ['PERSONA', 'Domingo Betancor Quintana'],
      ['PERSONA', 'Aitor Mendiluce Zabaleta'],
      ['CIF', 'B76543214'],
      ['ORGANO', 'JUZGADO DE LO MERCANTIL Nº 2 DE LAS PALMAS DE GRAN CANARIA'],
      ['NORMA', 'artículo 2 del Texto Refundido de la Ley Concursal'],
      ['ORGANISMO', 'Agencia Estatal de Administración Tributaria'],
      ['ORGANISMO', 'Tesorería General de la Seguridad Social'],
    ],
  },

  // ───────────────────────────── Familia y sucesiones ─────────────────────────────
  {
    id: 'convenio-regulador',
    fuente: 'Convenio regulador de divorcio, guarda y custodia',
    clase: 'nativo',
    texto:
      'CONVENIO REGULADOR\n\nDe una parte D. Iván Zamarreño Paredes, con DNI 45678912S, y de otra ' +
      'D.ª Nuria Alcaine Bosque, con DNI 51234567C, ambos mayores de edad.\n\n' +
      'PRIMERA.— Guarda y custodia de los hijos menores Daniel Zamarreño Alcaine, nacido el 7 de junio ' +
      'de 2016, y Leire Zamarreño Alcaine, nacida el 22 de enero de 2019, que se atribuye de forma ' +
      'compartida conforme al artículo 92 del Código Civil.\n\n' +
      'SEGUNDA.— Pensión de alimentos de 400 euros mensuales por hijo, ingresados en la cuenta ' +
      'ES7201822370410201234567 antes del día 5 de cada mes.',
    oro: [
      ['PERSONA', 'Iván Zamarreño Paredes'],
      ['PERSONA', 'Nuria Alcaine Bosque'],
      ['PERSONA', 'Daniel Zamarreño Alcaine'],
      ['PERSONA', 'Leire Zamarreño Alcaine'],
      ['DNI', '45678912S'],
      ['DNI', '51234567C'],
      ['IBAN', 'ES7201822370410201234567'],
      ['NORMA', 'artículo 92 del Código Civil'],
    ],
  },
  {
    id: 'cuaderno-particional',
    fuente: 'Cuaderno particional de herencia',
    clase: 'nativo',
    texto:
      'CUADERNO PARTICIONAL\n\nCausante: D. Bartolomé Sastre Coll, fallecido en Palma el 19 de octubre ' +
      'de 2023, bajo testamento abierto autorizado por el Notario D. Miquel Alemany Pons.\n\n' +
      'Herederos: D.ª Antònia Sastre Vives, D. Llorenç Sastre Vives y D.ª Margalida Sastre Vives, ' +
      'por partes iguales.\n\n' +
      'Se practica la partición conforme a los artículos 1061 y 1068 del Código Civil, previa liquidación ' +
      'del Impuesto sobre Sucesiones y Donaciones ante la Agencia Tributaria de las Illes Balears.',
    oro: [
      ['PERSONA', 'Bartolomé Sastre Coll'],
      ['PERSONA', 'Miquel Alemany Pons'],
      ['PERSONA', 'Antònia Sastre Vives'],
      ['PERSONA', 'Llorenç Sastre Vives'],
      ['PERSONA', 'Margalida Sastre Vives'],
      ['NORMA', 'artículos 1061 y 1068 del Código Civil'],
      ['ORGANISMO', 'Agencia Tributaria de las Illes Balears'],
    ],
  },
  {
    id: 'medidas-violencia-genero',
    fuente: 'Auto de medidas cautelares, orden de protección',
    clase: 'nativo',
    texto:
      'El Juzgado de Violencia sobre la Mujer nº 2 de Sevilla, en las Diligencias Urgentes 301/2025, ' +
      'acuerda la orden de protección a favor de D.ª Rocío Manzanares Gil frente a D. Julián Barrantes ' +
      'Coronado, prohibiéndole aproximarse a menos de 500 metros de su domicilio sito en la calle ' +
      'Feria 93, 41003 Sevilla, y de su centro de trabajo.\n\n' +
      'Se adopta al amparo del artículo 544 ter de la Ley de Enjuiciamiento Criminal y del artículo 64 ' +
      'de la Ley Orgánica 1/2004, de 28 de diciembre.',
    oro: [
      ['PERSONA', 'Rocío Manzanares Gil'],
      ['PERSONA', 'Julián Barrantes Coronado'],
      ['DIRECCION', 'calle Feria 93, 41003 Sevilla'],
      ['ORGANO', 'Juzgado de Violencia sobre la Mujer nº 2 de Sevilla'],
      ['AUTOS', 'Diligencias Urgentes 301/2025'],
      ['NORMA', 'artículo 544 ter de la Ley de Enjuiciamiento Criminal'],
      ['NORMA', 'artículo 64 de la Ley Orgánica 1/2004, de 28 de diciembre'],
    ],
  },

  // ───────────────────────────── Administrativo, tributario, extranjería ─────────────────────────────
  {
    id: 'recurso-reposicion-multa',
    fuente: 'Recurso de reposición frente a sanción de tráfico',
    clase: 'nativo',
    texto:
      'RECURSO DE REPOSICIÓN\n\nD.ª Estefanía Cordero Villagrán, con DNI 28765432E, frente al expediente ' +
      'sancionador 280045678901 de la Dirección General de Tráfico, por la supuesta infracción del ' +
      'artículo 21.1 del Reglamento General de Circulación cometida con el vehículo matrícula 9012 MNP.\n\n' +
      'El vehículo se encontraba cedido a un tercero en la fecha de los hechos, lo que excluye la ' +
      'responsabilidad de la titular conforme al artículo 82 del Real Decreto Legislativo 6/2015.',
    oro: [
      ['PERSONA', 'Estefanía Cordero Villagrán'],
      ['DNI', '28765432E'],
      ['MATRICULA', '9012 MNP'],
      ['ORGANISMO', 'Dirección General de Tráfico'],
      ['NORMA', 'artículo 21.1 del Reglamento General de Circulación'],
      ['NORMA', 'artículo 82 del Real Decreto Legislativo 6/2015'],
    ],
  },
  {
    id: 'reclamacion-teac',
    fuente: 'Reclamación económico-administrativa',
    clase: 'nativo',
    texto:
      'AL TRIBUNAL ECONÓMICO-ADMINISTRATIVO REGIONAL DE CATALUÑA\n\n' +
      'D. Ferran Casanovas Bertran, con NIF 12345678Z, actuando en su propio nombre, interpone ' +
      'reclamación económico-administrativa frente a la liquidación provisional del IRPF del ejercicio ' +
      '2022, dictada por la Administración de Sant Andreu de la Agencia Estatal de Administración ' +
      'Tributaria, al amparo del artículo 226 de la Ley 58/2003, de 17 de diciembre, General Tributaria.',
    oro: [
      ['PERSONA', 'Ferran Casanovas Bertran'],
      ['DNI', '12345678Z'],
      ['ORGANO', 'TRIBUNAL ECONÓMICO-ADMINISTRATIVO REGIONAL DE CATALUÑA'],
      ['ORGANISMO', 'Agencia Estatal de Administración Tributaria'],
      ['NORMA', 'artículo 226 de la Ley 58/2003, de 17 de diciembre, General Tributaria'],
    ],
  },
  {
    id: 'extranjeria-arraigo',
    fuente: 'Solicitud de autorización de residencia por arraigo social',
    clase: 'nativo',
    texto:
      'SOLICITUD DE AUTORIZACIÓN DE RESIDENCIA TEMPORAL POR ARRAIGO SOCIAL\n\n' +
      'Solicitante: D. Youssef El Amrani Bakkali, nacido en Nador (Marruecos) el 11 de marzo de 1991, ' +
      'NIE Y7654321G, con domicilio en la calle Alta 27, 1º izda., 39008 Santander.\n\n' +
      'Se aporta informe de arraigo emitido por el Ayuntamiento de Santander, contrato de trabajo con ' +
      'HOSTELERÍA CANTÁBRICA S.L., CIF A87654323, y certificado de antecedentes penales, todo ello a los ' +
      'efectos del artículo 124.2 del Real Decreto 557/2011.',
    oro: [
      // Duda 4: carecer de antecedentes es requisito del arraigo, el hecho a probar. Pasa.,
      ['OBJETO', 'antecedentes penales'],
      ['PERSONA', 'Youssef El Amrani Bakkali'],
      ['NIE', 'Y7654321G'],
      ['DIRECCION', 'calle Alta 27, 1º izda., 39008 Santander'],
      ['CIF', 'A87654323'],
      ['ORGANISMO', 'Ayuntamiento de Santander'],
      ['NORMA', 'artículo 124.2 del Real Decreto 557/2011'],
    ],
  },
  {
    id: 'alegaciones-aepd',
    fuente: 'Alegaciones en procedimiento sancionador de protección de datos',
    clase: 'nativo',
    texto:
      'ALEGACIONES EN EL PROCEDIMIENTO PS/00234/2025\n\n' +
      'CLÍNICA DENTAL ARROYO S.L.P., CIF B23456783, frente al acuerdo de inicio de la Agencia Española ' +
      'de Protección de Datos derivado de la reclamación presentada por D.ª Alicia Redondo Paniagua.\n\n' +
      'La reclamante solicitó el acceso a su historia clínica el 3 de febrero, y la respuesta se remitió ' +
      'dentro del plazo del artículo 12.3 del Reglamento (UE) 2016/679, sin que concurra la infracción ' +
      'del artículo 83.5.b) imputada.',
    oro: [
      ['CAT_ESPECIAL', 'historia clínica'],
      ['PERSONA', 'Alicia Redondo Paniagua'],
      ['CIF', 'B23456783'],
      ['AUTOS', 'PS/00234/2025'],
      ['ORGANISMO', 'Agencia Española de Protección de Datos'],
      ['NORMA', 'artículo 12.3 del Reglamento (UE) 2016/679'],
      ['NORMA', 'artículo 83.5.b)'],
    ],
  },

  // ───────────────────────────── Correo del despacho ─────────────────────────────
  {
    id: 'correo-cliente-consulta',
    fuente: 'Correo del cliente al despacho',
    clase: 'correo',
    texto:
      'De: Gustavo Peñaranda Iriarte <g.penaranda@correo-empresa.es>\n' +
      'Para: despacho@ruizabogados.com\n' +
      'Asunto: RE: Situación con el proveedor\n\n' +
      'Buenos días, Alberto:\n\n' +
      'Te confirmo que el pago de los 18.000 € salió el viernes desde la cuenta ' +
      'ES6000491500051234567892. Me llamó ayer Sonia Belmonte Tirado, la responsable financiera de ' +
      'ellos, al 644 210 883 para decirme que no lo tenían localizado.\n\n' +
      'Por cierto, la vista en el Juzgado de lo Mercantil nº 1 de Bilbao ya tiene fecha, el 14 de mayo. ' +
      'Un saludo.',
    oro: [
      ['PERSONA', 'Gustavo Peñaranda Iriarte'],
      ['PERSONA', 'Sonia Belmonte Tirado'],
      ['PERSONA', 'Alberto'],
      ['CORREO', 'g.penaranda@correo-empresa.es'],
      ['CORREO', 'despacho@ruizabogados.com'],
      ['IBAN', 'ES6000491500051234567892'],
      ['TELEFONO', '644 210 883'],
      ['ORGANO', 'Juzgado de lo Mercantil nº 1 de Bilbao'],
    ],
  },
  {
    id: 'correo-contraparte',
    fuente: 'Correo del letrado de la contraparte',
    clase: 'correo',
    texto:
      'De: Letrado Contrario <j.mirallesboada@mirallesabogados.es>\n' +
      'Para: alberto.ferrer@ruizabogados.com\n' +
      'Asunto: Propuesta transaccional — Ordinario 348/2024\n\n' +
      'Estimado compañero:\n\n' +
      'En relación con los autos de Procedimiento Ordinario 348/2024 del Juzgado de Primera Instancia ' +
      'nº 8 de Bilbao, mi mandante, D. Nicolás Arteaga Belloso, estaría dispuesto a abonar 30.000 euros ' +
      'en el plazo de treinta días, con renuncia recíproca de acciones y sin imposición de costas, al ' +
      'amparo del artículo 19 de la Ley de Enjuiciamiento Civil.\n\n' +
      'Quedo a la espera de tu respuesta. Un cordial saludo,\nJoan Miralles Boadá',
    oro: [
      ['PERSONA', 'Nicolás Arteaga Belloso'],
      ['PERSONA', 'Joan Miralles Boadá'],
      ['CORREO', 'j.mirallesboada@mirallesabogados.es'],
      ['CORREO', 'alberto.ferrer@ruizabogados.com'],
      ['AUTOS', 'Procedimiento Ordinario 348/2024'],
      ['ORGANO', 'Juzgado de Primera Instancia nº 8 de Bilbao'],
      ['NORMA', 'artículo 19 de la Ley de Enjuiciamiento Civil'],
    ],
  },
  {
    id: 'correo-lexnet',
    fuente: 'Notificación de LexNET',
    clase: 'correo',
    texto:
      'NOTIFICACIÓN LEXNET\n\nÓrgano remitente: Audiencia Provincial de Granada, Sección 3ª.\n' +
      'Procedimiento: Recurso de Apelación 512/2025.\n' +
      'Tipo de acto: Sentencia.\n' +
      'Destinatario: Procuradora D.ª Remedios Fajardo Ocaña, nº de colegiada 412.\n\n' +
      'Se notifica la Sentencia núm. 188/2025, siendo Ponente el Ilmo. Sr. D. José Requena Paredes, ' +
      'que desestima el recurso interpuesto por D. Ezequiel Navascués Larrucea.',
    oro: [
      ['PERSONA', 'Remedios Fajardo Ocaña'],
      ['PERSONA', 'Ezequiel Navascués Larrucea'],
      ['PONENTE', 'José Requena Paredes'],
      ['ORGANO', 'Audiencia Provincial de Granada, Sección 3ª'],
      ['AUTOS', 'Recurso de Apelación 512/2025'],
    ],
  },

  // ───────────────────────────── Sobre-tapado: fragmentos SIN nada que tapar ─────────────────────────────
  {
    id: 'solo-intocables-cabecera',
    fuente: 'Cabecera de resolución, nada que tapar',
    clase: 'nativo',
    texto:
      'AUDIENCIA PROVINCIAL DE MADRID, SECCIÓN 28ª (MERCANTIL). Rollo de Apelación 1.204/2024. ' +
      'Procedente del Juzgado de lo Mercantil nº 6 de Madrid, Juicio Ordinario 771/2022. ' +
      'ECLI:ES:APM:2025:412. ROJ: SAP M 412/2025. Ponente: Ilmo. Sr. D. Pedro María Gómez Sánchez. ' +
      'Se aplica el artículo 1.1 de la Ley 15/2007, de 3 de julio, de Defensa de la Competencia, en ' +
      'relación con el artículo 101 del Tratado de Funcionamiento de la Unión Europea.',
    oro: [
      ['ORGANO', 'AUDIENCIA PROVINCIAL DE MADRID, SECCIÓN 28ª (MERCANTIL)'],
      ['ORGANO', 'Juzgado de lo Mercantil nº 6 de Madrid'],
      ['AUTOS', 'Rollo de Apelación 1.204/2024'],
      ['AUTOS', 'Juicio Ordinario 771/2022'],
      ['ECLI', 'ECLI:ES:APM:2025:412'],
      ['ROJ', 'ROJ: SAP M 412/2025'],
      ['PONENTE', 'Pedro María Gómez Sánchez'],
      ['NORMA', 'artículo 1.1 de la Ley 15/2007, de 3 de julio, de Defensa de la Competencia'],
      ['NORMA', 'artículo 101 del Tratado de Funcionamiento de la Unión Europea'],
    ],
  },
  {
    id: 'solo-intocables-organismos',
    fuente: 'Escrito que solo cita instituciones, nada que tapar',
    clase: 'nativo',
    texto:
      'Se han recabado informes del Ministerio de Justicia, del Consejo General del Poder Judicial, ' +
      'de la Fiscalía General del Estado, del Banco de España, de la Comisión Nacional del Mercado de ' +
      'Valores y de la Comisión Nacional de los Mercados y la Competencia. Asimismo se ha solicitado ' +
      'dictamen al Consejo de Estado y se ha dado traslado a la Abogacía del Estado y al Defensor del ' +
      'Pueblo, conforme a lo previsto en la Ley 50/1997, de 27 de noviembre, del Gobierno.',
    oro: [
      ['ORGANISMO', 'Ministerio de Justicia'],
      ['ORGANISMO', 'Consejo General del Poder Judicial'],
      ['ORGANISMO', 'Fiscalía General del Estado'],
      ['ORGANISMO', 'Banco de España'],
      ['ORGANISMO', 'Comisión Nacional del Mercado de Valores'],
      ['ORGANISMO', 'Comisión Nacional de los Mercados y la Competencia'],
      ['ORGANISMO', 'Consejo de Estado'],
      ['ORGANISMO', 'Abogacía del Estado'],
      ['ORGANISMO', 'Defensor del Pueblo'],
      ['NORMA', 'Ley 50/1997, de 27 de noviembre, del Gobierno'],
    ],
  },
  {
    id: 'solo-intocables-juzgados',
    fuente: 'Listado de señalamientos, solo órganos y autos',
    clase: 'nativo',
    texto:
      'SEÑALAMIENTOS DE LA SEMANA\n\n' +
      'Lunes: Juzgado de lo Social nº 14 de Madrid, Autos 623/2024, a las 10:00.\n' +
      'Martes: Juzgado de Primera Instancia nº 47 de Madrid, Ordinario 1.198/2023, a las 11:30.\n' +
      'Miércoles: Sala de lo Contencioso-Administrativo del Tribunal Superior de Justicia de Madrid, ' +
      'Sección 9ª, Procedimiento Ordinario 88/2023, a las 09:45.\n' +
      'Jueves: Audiencia Nacional, Sala de lo Penal, Sección 4ª, Rollo 27/2024, a las 10:15.\n' +
      'Viernes: Juzgado de Instrucción nº 21 de Madrid, Diligencias Previas 4.412/2024, a las 12:00.',
    oro: [
      ['ORGANO', 'Juzgado de lo Social nº 14 de Madrid'],
      ['ORGANO', 'Juzgado de Primera Instancia nº 47 de Madrid'],
      ['ORGANO', 'Sala de lo Contencioso-Administrativo del Tribunal Superior de Justicia de Madrid'],
      ['ORGANO', 'Audiencia Nacional, Sala de lo Penal, Sección 4ª'],
      ['ORGANO', 'Juzgado de Instrucción nº 21 de Madrid'],
      ['AUTOS', 'Autos 623/2024'],
      ['AUTOS', 'Ordinario 1.198/2023'],
      ['AUTOS', 'Procedimiento Ordinario 88/2023'],
      ['AUTOS', 'Rollo 27/2024'],
      ['AUTOS', 'Diligencias Previas 4.412/2024'],
    ],
  },
  {
    id: 'solo-intocables-doctrina',
    fuente: 'Fundamento jurídico, solo doctrina y jurisprudencia',
    clase: 'nativo',
    texto:
      'La cuestión ha sido resuelta por la Sala Primera del Tribunal Supremo en las sentencias ' +
      '705/2015, de 23 de diciembre, 671/2018, de 28 de noviembre, y 105/2020, de 19 de febrero, ' +
      'que fijan doctrina sobre el control de transparencia de las cláusulas suelo, en aplicación de la ' +
      'Directiva 93/13/CEE del Consejo, de 5 de abril de 1993, y de la sentencia del Tribunal de ' +
      'Justicia de 21 de diciembre de 2016, asuntos acumulados C-154/15, C-307/15 y C-308/15.',
    oro: [
      ['ORGANO', 'Sala Primera del Tribunal Supremo'],
      ['ORGANO', 'Tribunal de Justicia'],
      ['NORMA', '705/2015, de 23 de diciembre'],
      ['NORMA', '671/2018, de 28 de noviembre'],
      ['NORMA', '105/2020, de 19 de febrero'],
      ['NORMA', 'Directiva 93/13/CEE del Consejo, de 5 de abril de 1993'],
      ['NORMA', 'asuntos acumulados C-154/15, C-307/15 y C-308/15'],
    ],
  },

  // ───────────────────────────── Propagación: el mismo nombre en otro fragmento ─────────────────────────────
  // Estos tres fragmentos son del MISMO expediente que 'demanda-ordinario-encabezamiento' y repiten
  // sus nombres sin volver a presentarlos. Miden lo que Alonso propone: un nombre visto una vez se
  // busca literalmente en los fragmentos siguientes, a coste cero y sin modelo.
  {
    id: 'propagacion-01-continuacion',
    fuente: 'Mismo expediente, hechos segundo y tercero',
    clase: 'nativo',
    expediente: 'exp-perez-gomez',
    texto:
      'SEGUNDO.— El 14 de marzo de 2023 Pérez Gómez remitió burofax a Construcciones Almagro requiriendo ' +
      'la subsanación de los defectos, sin obtener respuesta.\n\n' +
      'TERCERO.— El letrado Ferrer Castaño reiteró el requerimiento por correo el 2 de abril, conforme ' +
      'al artículo 1100 del Código Civil.',
    oro: [
      ['PERSONA', 'Pérez Gómez'],
      ['PERSONA', 'Ferrer Castaño'],
      ['NORMA', 'artículo 1100 del Código Civil'],
    ],
  },
  {
    id: 'propagacion-02-prueba',
    fuente: 'Mismo expediente, proposición de prueba',
    clase: 'nativo',
    expediente: 'exp-perez-gomez',
    texto:
      'OTROSÍ DIGO PRIMERO.— Que interesa el interrogatorio de D. Juan Pérez Gómez y la testifical de ' +
      'D. Alberto Ferrer Castaño, así como la documental consistente en el contrato suscrito con ' +
      'CONSTRUCCIONES ALMAGRO S.L. el 8 de enero de 2022.',
    oro: [
      ['PERSONA', 'Juan Pérez Gómez'],
      ['PERSONA', 'Alberto Ferrer Castaño'],
    ],
  },
  {
    id: 'propagacion-03-ocr',
    fuente: 'Mismo expediente, anexo escaneado en mayúsculas',
    clase: 'ocr',
    expediente: 'exp-perez-gomez',
    texto:
      'ANEXO II — RELACION DE PARTIDAS RECLAMADAS POR DON JUAN PEREZ GOMEZ A CONSTRUCCIONES ALMAGRO S.L.\n' +
      'PARTIDA 1: CIMENTACION. PARTIDA 2: ESTRUCTURA. PARTIDA 3: CUBIERTA.\n' +
      'CONFORME: EL LETRADO DON ALBERTO FERRER CASTANO.',
    oro: [
      ['PERSONA', 'JUAN PEREZ GOMEZ'],
      ['PERSONA', 'ALBERTO FERRER CASTANO'],
    ],
    // Aquí la propagación literal sola NO basta: el nombre viene en mayúsculas y sin tildes. Mide si
    // el cotejo normalizado (mayúsculas + tildes fuera) recupera lo que el literal pierde.
    propagacionNormalizada: true,
  },
];

export default CORPUS;
