// Pruebas del anonimizador: los invariantes que tienen que cumplirse SIEMPRE.
//
//   node scripts/banco-nombres/pruebas.mjs
//
// El banco mide cuánto tapa. Esto comprueba otra cosa: que lo que hace está bien hecho. Son las
// propiedades de las que depende que el abogado pueda fiarse, y cada una responde a un modo
// concreto de romperse:
//
//   · El alias es ESTABLE. Si «[PERSONA_3]» cambia de dueño entre una respuesta y la siguiente,
//     Claude razona sobre personas distintas creyendo que es la misma y el escrito sale mal.
//   · Los expedientes están AISLADOS. Un nombre conocido en un asunto no se propaga a otro. Es el
//     mismo principio que ya impide que dos expedientes se mezclen, que es lo más delicado que hay.
//   · El camino de vuelta DEVUELVE el texto. Si no, el borrador sale con corchetes dentro.
//   · Un alias inventado por Claude se DETECTA, no se deja pasar en silencio.
//   · La tabla NO viaja: el texto que sale no contiene ningún valor real.
//
// Sin red y sin modelo: solo reglas. Corre en un segundo.

import { Anonimizador, TablaAlias } from './anonimizador/index.mjs';

let ok = 0;
let ko = 0;
const fallos = [];

function comprobar(nombre, condicion, detalle = '') {
  if (condicion) {
    ok++;
    process.stdout.write(`  ✓ ${nombre}\n`);
  } else {
    ko++;
    fallos.push({ nombre, detalle });
    process.stdout.write(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}\n`);
  }
}

const nuevo = () => new Anonimizador({ tabla: new TablaAlias() });

const anon = async (a, textos, expediente) =>
  (await a.anonimizarRespuesta(textos, { expediente })).map((r) => r.texto);

// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write('\nESTABILIDAD DEL ALIAS\n');
{
  const a = nuevo();
  const [t1] = await anon(a, ['D. Juan Pérez Gómez, con DNI 12345678Z, demanda a D.ª Ana Soto Gil.'], 'e1');
  const [t2] = await anon(a, ['El Sr. Juan Pérez Gómez ratifica su demanda frente a D.ª Ana Soto Gil.'], 'e1');
  const alias1 = t1.match(/\[PERSONA_\d+\]/g) ?? [];
  const alias2 = t2.match(/\[PERSONA_\d+\]/g) ?? [];
  comprobar('el mismo nombre recibe el mismo alias en dos respuestas', alias1[0] === alias2[0], `${alias1[0]} vs ${alias2[0]}`);
  comprobar('dos personas distintas reciben alias distintos', alias1[0] !== alias1[1], `${alias1.join(' ')}`);
  comprobar('el DNI no sale en el texto', !t1.includes('12345678Z'), t1);

  const a2 = nuevo();
  const [r1] = await anon(a2, ['D. Juan Pérez Gómez y D.ª Ana Soto Gil.'], 'e1');
  const [r2] = await anon(a2, ['D. Juan Pérez Gómez y D.ª Ana Soto Gil.'], 'e1');
  comprobar('anonimizar dos veces lo mismo da lo mismo (idempotente)', r1 === r2, `${r1}\n      ${r2}`);
}

// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write('\nAISLAMIENTO ENTRE EXPEDIENTES\n');
{
  const a = nuevo();
  await anon(a, ['D. Juan Pérez Gómez, demandante.'], 'expA');
  const [otro] = await anon(a, ['Pérez Gómez no es parte en este asunto.'], 'expB');
  comprobar(
    'un nombre conocido en un expediente NO se propaga a otro',
    otro.includes('Pérez Gómez'),
    otro,
  );
  const tablaA = a.tabla.volcar('expA');
  const tablaB = a.tabla.volcar('expB');
  comprobar('cada expediente tiene su propia tabla', tablaA.length >= 1 && tablaB.length === 0, `A=${tablaA.length} B=${tablaB.length}`);

  // Y el alias de un expediente no revierte en otro.
  const alias = tablaA[0].alias;
  comprobar(
    'el alias de un expediente no se revierte en otro',
    a.tabla.rehidratar('expB', `Escrito sobre ${alias}.`).includes(alias),
    a.tabla.rehidratar('expB', `Escrito sobre ${alias}.`),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write('\nCAMINO DE VUELTA\n');
{
  const a = nuevo();
  const original =
    'D.ª Marta Iglesias Rubio, Procuradora, en nombre de D. Juan Pérez Gómez, con DNI 12345678Z y ' +
    'domicilio en la calle Serrano 45, 3º B, 28006 Madrid, ante el Juzgado de Primera Instancia nº 5 ' +
    'de Madrid, conforme al artículo 1124 del Código Civil.';
  const [conAlias] = await anon(a, [original], 'e1');
  const vuelta = a.rehidratar(conAlias, { expediente: 'e1' });
  comprobar('revertir devuelve el texto original', vuelta.texto === original, `${vuelta.texto}`);
  comprobar('no quedan alias sin revertir', !/\[[A-Z_]+_\d+\]/.test(vuelta.texto), vuelta.texto);
  comprobar('el juzgado sigue en claro', conAlias.includes('Juzgado de Primera Instancia nº 5 de Madrid'), conAlias);
  comprobar('el artículo sigue en claro', conAlias.includes('artículo 1124 del Código Civil'), conAlias);
  comprobar('el nombre real NO viaja', !conAlias.includes('Juan Pérez Gómez'), conAlias);
  comprobar('el domicilio real NO viaja', !conAlias.includes('Serrano 45'), conAlias);

  // El borrador que devuelve Claude: escrito nuevo, con los alias de la tabla.
  const borrador = 'Que [PERSONA_2] incumplió el contrato, y así lo acredita el documento aportado.';
  const reh = a.rehidratar(borrador, { expediente: 'e1' });
  comprobar('un borrador con alias se rehidrata', !reh.texto.includes('[PERSONA_2]'), reh.texto);
  comprobar('no avisa de alias desconocidos cuando no los hay', reh.desconocidos.length === 0, reh.desconocidos.join(' '));

  const inventado = a.rehidratar('Que [PERSONA_97] y [CUENTA_44] no existen.', { expediente: 'e1' });
  comprobar('un alias inventado por Claude se detecta', inventado.desconocidos.length === 2, inventado.desconocidos.join(' '));
  comprobar('y no se revierte en silencio', inventado.texto.includes('[PERSONA_97]'), inventado.texto);
}

// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write('\nEL FILTRO DE ENTRADA ES OBLIGATORIO\n');
{
  // Si Claude pregunta por «[PERSONA_1]» y no se revierte ANTES de buscar, la búsqueda no
  // encuentra nada. Esta prueba fija ese requisito.
  const a = nuevo();
  await anon(a, ['D. Juan Pérez Gómez firmó el contrato.'], 'e1');
  const consulta = a.rehidratar('¿qué dice el contrato de [PERSONA_1]?', { expediente: 'e1' });
  comprobar('una consulta con alias se revierte antes de buscar', consulta.texto.includes('Juan Pérez Gómez'), consulta.texto);
}

// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write('\nLO QUE NUNCA SE TAPA\n');
{
  const a = nuevo();
  const casos = [
    ['Juzgado de lo Social nº 14 de Madrid', 'Se señala ante el Juzgado de lo Social nº 14 de Madrid.'],
    ['ECLI:ES:TS:2024:1780', 'Véase la ECLI:ES:TS:2024:1780 citada.'],
    ['ROJ: STS 1780/2024', 'Consta el ROJ: STS 1780/2024 en la base.'],
    ['Ignacio Sancho Gargallo', 'Ponente: Excmo. Sr. D. Ignacio Sancho Gargallo.'],
    ['Carlos Mendaña Prieto', 'Letrado de la Administración de Justicia: D. Carlos Mendaña Prieto.'],
    ['TIP U-34215', 'Ante el Agente con TIP U-34215 comparece el denunciante.'],
    ['Agencia Española de Protección de Datos', 'Resolución de la Agencia Española de Protección de Datos.'],
    ['artículo 1124 del Código Civil', 'Al amparo del artículo 1124 del Código Civil.'],
  ];
  for (const [debeQuedar, texto] of casos) {
    const [salida] = await anon(a, [texto], `caso-${debeQuedar}`);
    comprobar(`queda en claro: ${debeQuedar}`, salida.includes(debeQuedar), salida);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write('\nLO QUE SIEMPRE SE TAPA\n');
{
  const casos = [
    ['DNI', 'Con DNI 12345678Z en el expediente.', '12345678Z'],
    ['NIE', 'Con NIE X1234567L aportado.', 'X1234567L'],
    ['CIF', 'La mercantil, CIF B23456783, comparece.', 'B23456783'],
    ['IBAN', 'Ingreso en la cuenta ES9121000418450200051332 el día 5.', 'ES9121000418450200051332'],
    ['IBAN escaneado', 'ABONO EN CUENTA ES5420950123456789012345 EN QUINCE DIAS.', 'ES5420950123456789012345'],
    ['teléfono', 'Puede llamar al 612 345 678 por las mañanas.', '612 345 678'],
    ['correo', 'Escriba a carolina.nieto@gmail.com cuando pueda.', 'carolina.nieto@gmail.com'],
    ['matrícula', 'El vehículo matrícula 4521 KDR estaba aparcado.', '4521 KDR'],
    ['persona con tratamiento', 'Comparece D. Sebastián Otero Manrique.', 'Sebastián Otero Manrique'],
    ['persona en escaneo', 'COMPARECE DONA BEGONA ETXEBARRIA ZULOAGA.', 'BEGONA ETXEBARRIA ZULOAGA'],
    ['nombre catalán', 'Otorga D.ª Antònia Sastre Vives el poder.', 'Antònia Sastre Vives'],
    ['perito', 'Emitido por el Perito D. Gonzalo Arrieta Pazos.', 'Gonzalo Arrieta Pazos'],
    ['agente con nombre', 'Inspección por el Agente D. Manuel Espejo Trillo.', 'Manuel Espejo Trillo'],
    ['domicilio', 'Con domicilio en la calle Alta 27, 1º izda., 39008 Santander.', 'calle Alta 27'],
    ['salud', 'El actor padece esclerosis múltiple desde 2019.', 'esclerosis múltiple'],
    ['afiliación sindical', 'La actora es afiliada al sindicato Comisiones Obreras.', 'Comisiones Obreras'],
    ['etnia', 'La trabajadora, de etnia gitana, fue apartada.', 'de etnia gitana'],
    ['orientación sexual', 'Se invoca su orientación sexual de forma impropia.', 'orientación sexual'],
  ];
  for (const [nombre, texto, debeDesaparecer] of casos) {
    const a = nuevo();
    const [salida] = await anon(a, [texto], `t-${nombre}`);
    comprobar(`se tapa: ${nombre}`, !salida.includes(debeDesaparecer), salida);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write('\nPROPAGACIÓN\n');
{
  const a = nuevo();
  const [f1, f2, f3] = await anon(
    a,
    [
      'D. Juan Pérez Gómez, con DNI 12345678Z, formula demanda.',
      'Pérez Gómez remitió burofax el 14 de marzo sin obtener respuesta.',
      'ANEXO — PARTIDAS RECLAMADAS POR DON JUAN PEREZ GOMEZ.',
    ],
    'e1',
  );
  comprobar('la primera mención se tapa', !f1.includes('Juan Pérez Gómez'), f1);
  comprobar('la segunda, por apellido suelto, también', !f2.includes('Pérez Gómez'), f2);
  comprobar('y la del escaneo en mayúsculas, también', !f3.includes('JUAN PEREZ GOMEZ'), f3);
  const alias = [f1.match(/\[PERSONA_\d+\]/)?.[0], f2.match(/\[PERSONA_\d+\]/)?.[0], f3.match(/\[PERSONA_\d+\]/)?.[0]];
  comprobar('las tres menciones comparten alias', alias[0] === alias[1] && alias[1] === alias[2], alias.join(' '));

  // Dentro del MISMO fragmento: presentado arriba, a secas abajo.
  const b = nuevo();
  const [uno] = await anon(b, ['Comparece D. Manuel Pérez Alcaraz. Interrogado Pérez Alcaraz, manifiesta que sí.'], 'e2');
  comprobar('el apellido suelto del mismo fragmento se tapa', !uno.includes('Pérez Alcaraz'), uno);
}

// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write('\nLA TABLA NO VIAJA\n');
{
  const a = nuevo();
  const textos = [
    'D. Juan Pérez Gómez, DNI 12345678Z, calle Serrano 45, 28006 Madrid, tel. 612 345 678.',
    'D.ª Ana Soto Gil, con IBAN ES9121000418450200051332 y correo ana@ejemplo.es.',
  ];
  const salida = await anon(a, textos, 'e1');
  const todo = salida.join('\n');
  const valores = a.tabla.volcar('e1').map((x) => x.valor);
  const filtrados = valores.filter((v) => todo.includes(v));
  comprobar(
    'ningún valor real de la tabla aparece en el texto que sale',
    filtrados.length === 0,
    `se han colado: ${filtrados.join(' | ')}`,
  );
  comprobar('la tabla tiene entradas', valores.length >= 6, `${valores.length} entradas`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Agujeros destapados el 29-sep al medir la v1 SIN modelo. Cada uno salía «bien» en el banco
// hasta que se midió como hay que medirlo.
process.stdout.write('\nAGUJEROS DEL 29-SEP (v1 sin modelo)\n');
{
  // El hijo con los apellidos de los padres: salía «Daniel [PADRE] [MADRE]».
  const a = nuevo();
  const [, hijos] = await anon(a, [
    'De una parte D. Iván Zamarreño Paredes y de otra D.ª Nuria Alcaine Bosque.',
    'La custodia de los hijos menores Daniel Zamarreño Alcaine y Leire Zamarreño Alcaine se atribuye a ambos.',
  ], 'conv');
  comprobar('el nombre de pila del hijo no sale en claro', !/Daniel|Leire/.test(hijos), hijos);
  const alias = hijos.match(/\[PERSONA_\d+\]/g) ?? [];
  comprobar('cada hijo es una persona nueva, no el padre ni la madre', alias.length === 2 && !alias.includes('[PERSONA_1]') && !alias.includes('[PERSONA_2]') && alias[0] !== alias[1], hijos);
  comprobar('y al revertir vuelven los hijos, no los padres', a.rehidratar(hijos, { expediente: 'conv' }).texto.includes('Daniel Zamarreño Alcaine'), a.rehidratar(hijos, { expediente: 'conv' }).texto);

  // Dos hermanos: el apellido a secas no se asigna a uno de ellos.
  const b = nuevo();
  const [acta] = await anon(b, ['Comparecen D. Manuel Pérez Alcaraz y su hermano D. Fernando Pérez Alcaraz. Interrogado Pérez Alcaraz, manifiesta que sí.'], 'her');
  const [m1, m2, m3] = acta.match(/\[PERSONA_\d+\]/g) ?? [];
  comprobar('el apellido compartido recibe su propio alias', m3 && m3 !== m1 && m3 !== m2, acta);
  const vuelta = b.rehidratar(acta, { expediente: 'her' }).texto;
  comprobar('y al revertir no afirma de cuál de los dos se trata', vuelta.includes('Interrogado Pérez Alcaraz,'), vuelta);

  // En producción no hay saltos de línea: la guardia no puede tragarse al procurador.
  const [plano] = await anon(nuevo(), ['AL JUZGADO DE PRIMERA INSTANCIA N 12 DE BARCELONA DON JOAQUIN MUNOZ ESTEVEZ, PROCURADOR DE LOS TRIBUNALES, ANTE EL JUZGADO COMPARECE Y DICE: QUE FORMULA DEMANDA CONTRA DON ELADIO QUESADA MARTORELL.'], 'pl');
  comprobar('texto aplanado: el procurador detrás del juzgado se tapa', !plano.includes('JOAQUIN MUNOZ'), plano);
  comprobar('texto aplanado: el demandado detrás de «ante el juzgado» se tapa', !plano.includes('ELADIO QUESADA'), plano);
  comprobar('texto aplanado: el juzgado sigue en claro', plano.includes('JUZGADO DE PRIMERA INSTANCIA N 12 DE BARCELONA'), plano);
  const [cita] = await anon(nuevo(), ['Conforme al artículo 1124 del Código Civil invocado por D. Juan Pérez Gómez en su demanda.'], 'ci');
  comprobar('una cita de norma no protege al que la invoca', !cita.includes('Juan Pérez Gómez') && cita.includes('artículo 1124 del Código Civil'), cita);
  const [correo] = await anon(nuevo(), ['Asunto: vista De: Práxedes Villarroel Osuna <p.v@despacho.es> Hola Casilda: nos vemos el jueves. Un abrazo, Práxedes'], 'co');
  comprobar('texto aplanado: cabecera, saludo y firma se tapan', !/Práxedes|Casilda/.test(correo), correo);
  const [ficha] = await anon(nuevo(), ['RECIBO DE SALARIOS. TRABAJADOR: GERMAN ALBERDI ZUBIZARRETA. DNI 12345678Z.'], 'fi');
  comprobar('texto aplanado: la etiqueta de ficha a mitad de línea se tapa', !ficha.includes('ALBERDI'), ficha);

  // El nombre completo sin presentar, que era lo único que ponía el modelo.
  const [sin] = await anon(nuevo(), ['Me llamó ayer Sonia Belmonte Tirado, la responsable financiera, para decirme que no lo tenían.'], 'sp');
  comprobar('el nombre completo sin tratamiento ni cargo se tapa', !sin.includes('Belmonte'), sin);
  const [inst] = await anon(nuevo(), ['Ingresó en el Hospital Universitario Central de Asturias y lo vio el Servicio Andaluz de Salud en Sevilla.'], 'in');
  comprobar('…pero una institución en mayúsculas no es un nombre', inst.includes('Hospital Universitario Central de Asturias') && inst.includes('Servicio Andaluz de Salud'), inst);

  // Apellidos que son instituciones.
  const [ap] = await anon(nuevo(), ['D. Lorenzo Guardia Civil y D.ª Amalia Estado Mayor, vecinos de Soria, frente a la Guardia Civil de Almazán.'], 'ap');
  comprobar('«D. Lorenzo Guardia Civil» es una persona y se tapa', !ap.includes('Lorenzo'), ap);
  comprobar('«Estado Mayor» como segundo apellido se tapa entero', !ap.includes('Mayor'), ap);
  comprobar('la Guardia Civil como institución sigue en claro', ap.includes('Guardia Civil de Almazán'), ap);
  comprobar('un municipio suelto no es un domicilio', ap.includes('vecinos de Soria'), ap);

  // Una palabra corriente que coincide con un nombre del expediente no es esa persona.
  const c = nuevo();
  const [, amparo] = await anon(c, [
    'Comparece D.ª Amparo Vidal Sagrera y D. Julián Mora Fuentes.',
    'Solicita protección internacional al amparo de la Ley 12/2009, con los intereses de mora y conforme a las fuentes del derecho.',
  ], 'am');
  comprobar('«al amparo de la Ley» no se tapa como si fuera Amparo', amparo.includes('al amparo de la Ley'), amparo);
  comprobar('«intereses de mora» y «fuentes del derecho» tampoco', amparo.includes('de mora') && amparo.includes('las fuentes del derecho'), amparo);
  comprobar('y la ida y vuelta de ese texto es exacta', c.rehidratar(amparo, { expediente: 'am' }).texto.includes('al amparo de la Ley 12/2009'), c.rehidratar(amparo, { expediente: 'am' }).texto);
  const [, escaneo] = await anon(nuevo(), ['Comparece D.ª Amparo Vidal Sagrera.', 'ANEXO: FIRMADO POR AMPARO VIDAL SAGRERA.'], 'am2');
  comprobar('…y en un escaneo en mayúsculas la mención sí se tapa', !escaneo.includes('VIDAL SAGRERA'), escaneo);

  // Lo que va detrás de «vecino de» no se lleva la frase entera.
  const [dom] = await anon(nuevo(), ['D.ª Amalia Soto Gil, vecina de Burgos, comparece frente a D. Cristóbal Vega Ruiz.'], 'do');
  comprobar('«vecina de Burgos, comparece…» no se traga la frase', dom.includes('comparece frente a'), dom);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que destapó el corpus escrito a ciegas el 29-sep (primera pasada: 73,8 %). Cada caso es una
// familia de agujero, no un caso suelto.
process.stdout.write('\nCORPUS CIEGO 29-SEP — FAMILIAS DE AGUJERO\n');
{
  const uno = async (texto, exp = 'cg') => (await anon(nuevo(), [texto], exp))[0];
  const claro = async (nombre, texto, debe) => { const t = await uno(texto); comprobar(nombre, debe.every((d) => t.includes(d)), t); };
  const tapa = async (nombre, texto, noDebe) => { const t = await uno(texto); comprobar(nombre, noDebe.every((d) => !t.includes(d)), t); };

  // La guardia no se estira.
  await tapa('una Consejería no protege el resto de la frase', 'Impugna la resolución de la Consejería de Salud y Consumo de la Junta de Andalucía que la excluyó tras manifestar su objeción de conciencia a la práctica.', ['objeción de conciencia']);
  await tapa('«Comunidad de Propietarios de la Calle Mayor, 12» no protege la dirección', 'ACTA DE LA JUNTA DE LA COMUNIDAD DE PROPIETARIOS DE LA CALLE MAYOR, 12, DE PALENCIA', ['MAYOR, 12']);
  await tapa('el número de afiliación detrás de «Seguridad Social» se tapa', 'Con número de afiliación a la Seguridad Social 28/1234567890 consta de alta.', ['28/1234567890']);
  await tapa('«equipo» en minúscula no protege un correo', 'Para: equipo@despachovo.es', ['equipo@despachovo.es']);
  await tapa('«Sala» no casa dentro de «Salamanca»', 'Comparece D. Álvaro Toledo Salamanca como demandado.', ['Salamanca']);
  await tapa('el juez en minúscula no protege a nadie', 'El juez acordó la prisión de Juan Pérez Gómez, sin fianza.', ['Juan Pérez Gómez']);
  await tapa('una cita de norma no protege al que la sigue', 'Conforme al artículo 24 CE, Urdiales Cotrina alegó indefensión.', ['Urdiales Cotrina']);
  await tapa('la excepción del hospital no veta el diagnóstico que sigue', 'Consta en la historia clínica del Hospital Universitario de Cruces el diagnóstico de cervicalgia postraumática.', ['cervicalgia']);
  await tapa('«HOSPITAL» no casa dentro de «HOSPITALARIOS»', 'EL ACTOR PADECE TRASTORNO BIPOLAR TIPO I CON INGRESOS HOSPITALARIOS EN 2021.', ['BIPOLAR', 'INGRESOS HOSPITALARIOS']);

  // Firmas judiciales, en las cuatro lenguas.
  await claro('«firma S.Sª Dña. …, Magistrada»', 'Lo acuerda y firma S.Sª Dña. Pilar Encinas Llorente, Magistrada.', ['Pilar Encinas Llorente']);
  await claro('«Doy fe, …, Letrada de la Administración de Justicia»', 'Doy fe, Almudena Recio Tobar, Letrada de la Administración de Justicia.', ['Almudena Recio Tobar']);
  await claro('LAJ con «Dña.»', 'Letrada de la Administración de Justicia: Dña. Soledad Montero Lagos.', ['Soledad Montero Lagos']);
  await claro('LAJ con «Ilmo. Sr. D.» detrás del ponente', 'Ponente: Excmo. Sr. D. Rodrigo Valcárcel Ybarra Letrado de la Administración de Justicia: Ilmo. Sr. D. Andrés Quintana Losada', ['Rodrigo Valcárcel Ybarra', 'Andrés Quintana Losada']);
  await claro('«siendo Ponente el Ilmo. Sr. D. …»', 'Se notifica la Sentencia, siendo Ponente el Ilmo. Sr. D. José Requena Paredes, que desestima.', ['José Requena Paredes']);
  await claro('catalán: «La jutgessa, …»', 'La jutgessa, Núria Casals Vidal. La lletrada de l\'Administració de Justícia, Anna Soler Batlle.', ['Núria Casals Vidal', 'Anna Soler Batlle']);
  await claro('gallego: «A maxistrada-xuíza, …»', 'A maxistrada-xuíza, Uxía Rodríguez Seoane, ditou a sentenza. A letrada da Administración de Xustiza, Brais Lamas Figueiras.', ['Uxía Rodríguez Seoane', 'Brais Lamas Figueiras']);
  await claro('la composición de la Sala', 'Magistrados: Montserrat Comas Ribalta (presidenta y ponente), Josep Maria Riera Tió y Rafael Mora Serrano.', ['Montserrat Comas Ribalta', 'Josep Maria Riera Tió', 'Rafael Mora Serrano']);
  await claro('funcionario de auxilio judicial cuyo apellido es un nombre de pila', 'Hizo la comprobación el funcionario del Cuerpo de Auxilio Judicial Ramón Gil Esteban.', ['Ramón Gil Esteban']);
  await claro('TIP solo con números', 'Instruido por los agentes con TIP 118442 y TIP 120915.', ['TIP 118442', 'TIP 120915']);
  await claro('órganos en catalán y euskera', 'Jutjat de Primera Instància núm. 3 de Girona. Bilboko Lehen Auzialdiko 5 zenbakiko Epaitegia.', ['Jutjat de Primera Instància núm. 3 de Girona', 'Bilboko Lehen Auzialdiko 5 zenbakiko Epaitegia']);
  await claro('Tribunal de Instancia con sección y plaza', 'AL TRIBUNAL DE INSTANCIA DE MADRID, SECCIÓN DE FAMILIA, INFANCIA Y CAPACIDAD, PLAZA Nº 22', ['TRIBUNAL DE INSTANCIA DE MADRID, SECCIÓN DE FAMILIA, INFANCIA Y CAPACIDAD, PLAZA Nº 22']);

  // Personas que ninguna regla de contexto veía.
  await tapa('nombres de pila sueltos en un correo', 'De: Nerea Etxeberria <n@a.es>\nPara: Jon Ugalde\nHola Jon:\nMe llamó ayer Garbiñe y hablé con Iñaki y con Maite. Un abrazo,\nNerea', ['Jon', 'Garbiñe', 'Iñaki', 'Maite', 'Nerea']);
  await tapa('«mi cuñado Toño», «su hermana Carmen», «El procurador, Lorenzo,»', 'Mi cuñado Toño avaló el préstamo. Cuenta con el apoyo de su hermana Carmen. El procurador, Lorenzo, me dijo que sí.', ['Toño', 'Carmen', 'Lorenzo']);
  await tapa('vocativo que abre el correo', 'Ane, buenas: te escribo por lo del acuerdo.', ['Ane']);
  await tapa('apellidos sueltos como sujeto en un correo', 'Oye, ¿sabes si Casado mandó ya el informe? Porque Fuentes dice que no. Lo ha revisado Vallejo con la clienta. Un saludo', ['Casado', 'Fuentes', 'Vallejo']);
  await tapa('apellido compuesto con guion', 'Asunto: pericial Uribe-Etxebarria', ['Uribe-Etxebarria']);
  await tapa('apellido que es una institución, con nombre de pila', 'La trabajadora social que firma, Rocío Justicia Moreno, propone la medida.', ['Justicia Moreno']);
  await tapa('la «y» dentro de un apellido compuesto', 'Representada por el procurador Don Álvaro de la Fuente y Sáenz de Tejada, formula demanda.', ['Sáenz de Tejada']);
  await tapa('en un escaneo, el nombre detrás de una palabra corriente', 'VIAJA COMO PASAJERO MAMADOU DIALLO, NACIDO EN SENEGAL.', ['MAMADOU DIALLO']);
  await tapa('dos apellidos + verbo sin el nombre completo antes', 'Urdiales Cotrina acreditó la cotización. Robles Camuñas interesó la ampliación.', ['Urdiales', 'Robles']);
  {
    const a = nuevo();
    const [t] = await anon(a, ['Comparecen Juan Pérez Gómez y Pedro López Ruiz.'], 'en');
    const al = t.match(/\[PERSONA_\d+\]/g) ?? [];
    comprobar('«Juan Pérez y Pedro López» son dos personas, no una', al.length === 2 && al[0] !== al[1], t);
  }
  await claro('una advocación o una calle con nombre de pila no es una persona', 'Ingresó en el Hospital Virgen del Rocío. Vive en la plaza de San Juan.', ['Rocío', 'San Juan']);
  await claro('«la Paz» o «Rosa» en la duda pasan', 'Rosa de los vientos. Se firmó la paz.', ['Rosa de los vientos']);

  // Teléfonos, domicilios, salud.
  await tapa('teléfonos en cualquier agrupación', 'Móvil 688 12 34 56, fijo 91 555 12 34, otro 944.15.26.37 y 600-11-22-33.', ['688 12 34 56', '91 555 12 34', '944.15.26.37', '600-11-22-33']);
  await claro('un importe no es un teléfono', 'Pagó 961.324.567 euros.', ['961.324.567']);
  await tapa('domicilios en catalán, gallego y euskera', 'Carrer de la Muralla, 8, 2n 1a, 17820 Banyoles; rúa do Príncipe, 34, 4º dereita, 36202 Vigo; Kale Nagusia, 14, 3. ezkerra, 48960 Galdakao.', ['Muralla, 8', 'Príncipe, 34', 'Nagusia, 14']);
  await tapa('la calle con nombre de persona sale entera como dirección', 'EN LA CALLE DEL CARME, 45, BAJOS, DE GIRONA.', ['45, BAJOS']);
  await tapa('medicación de raíz corta y con dosis', 'Sigue tratamiento con ibuprofeno 600 mg y diazepam 5 mg.', ['ibuprofeno', 'diazepam', '600 mg']);
  await tapa('familias de fármacos', 'Su compañera toma antidepresivos y está en tratamiento con metadona.', ['antidepresivos', 'metadona']);
  await claro('«injuria», «simpatía», «idioma», «toma» no son salud', 'El delito de injuria, la simpatía, el idioma y la toma de posesión.', ['injuria', 'simpatía', 'idioma', 'toma']);
  await tapa('«delegada de CCOO» y la opinión política', 'Presidido por Amparo Llopis, delegada de CCOO. Conocido por sus publicaciones a favor de la independencia de Cataluña.', ['delegada de CCOO', 'independencia de Cataluña']);
  await tapa('antecedentes «por» algo, incidentales', 'Consta que el denunciado tiene antecedentes penales por un delito de hurto de 2019.', ['hurto de 2019']);
  await tapa('«embarazada de siete meses» entero', 'Cayó sobre Ainhoa Lizarraga, que estaba embarazada de siete meses.', ['siete meses']);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que destapó el SEGUNDO corpus a ciegas (primera pasada: 76,7 %). Familias, no casos.
process.stdout.write('\nCORPUS CIEGO 2 — FAMILIAS DE AGUJERO\n');
{
  const uno = async (texto, exp = 'c2') => (await anon(nuevo(), [texto], exp))[0];
  const claro = async (nombre, texto, debe) => { const t = await uno(texto); comprobar(nombre, debe.every((d) => t.includes(d)), t); };
  const tapa = async (nombre, texto, noDebe) => { const t = await uno(texto); comprobar(nombre, noDebe.every((d) => !t.includes(d)), t); };

  // Personas.
  await tapa('formato «APELLIDOS, Nombre» de las listas', '1. ÁLVAREZ SOUTO, Brais — ***4521**\n4. FERNÁNDEZ DE LA TORRE, Ana Belén — ***0093**\n9. WANG, Li Na', ['SOUTO', 'Brais', 'TORRE', 'Ana Belén', 'WANG', 'Li Na']);
  await tapa('los DNI enmascarados de una lista', 'ÁLVAREZ SOUTO, Brais — ***4521** · PETRENKO, Oksana — ****3361*', ['***4521**', '****3361*']);
  await tapa('nombres chinos con el apellido delante', 'Reagrupados: su esposa, CHEN MEIHUA, y su hija, LIN YUTONG.', ['CHEN MEIHUA', 'LIN YUTONG']);
  await claro('«SU ESPOSA» no es un nombre chino', 'SU ESPOSA, DOÑA LAURA PAGES ROCA, PERCIBE PENSION.', ['SU ESPOSA']);
  await tapa('partícula árabe dentro del nombre', 'ACUSADOS: MOHAMED EL AMRANI BOUZIANE, NACIDO EN 1990.', ['BOUZIANE', 'AMRANI']);
  await tapa('el nombre con su edad', 'Hijos comunes: Nel (10 años) y Olaya (6 años).', ['Nel', 'Olaya']);
  await tapa('el mote entre paréntesis', 'ESTA PRESENTE D. FRANCISCO RAMOS BRAVO ("PACO").', ['PACO']);
  await tapa('saludo en euskera', 'Kaixo Josune:\n\nTe recuerdo que el lunes es la vista.', ['Josune']);
  await tapa('un lugar como apellido detrás del nombre', 'TITULAR: SERGIO TOLEDO MORA, CON DNI 12345678Z.', ['TOLEDO MORA']);
  await tapa('«de la Calle» como apellido', 'FDO: POR LA EMPRESA, MARIA DEL MAR TORRES DE LA CALLE', ['DE LA CALLE']);
  await claro('en un escaneo, «SE ALEJO», «31 DE JULIO» y «SAN FERNANDO» no son personas', 'EL CONDUCTOR SE ALEJO A PIE. EN SAN FERNANDO, A 31 DE JULIO DE 2026.', ['ALEJO', 'JULIO', 'SAN FERNANDO']);
  await claro('«ASUNCIÓN DE TUTELA» no es una persona', 'RESOLUCIÓN DE DECLARACIÓN DE DESAMPARO Y ASUNCIÓN DE TUTELA', ['ASUNCIÓN DE TUTELA']);
  await claro('una razón social no es una persona', 'Demandante: NORDIC TIMBER TRADING AB, representada por el abogado Don Björn Lindqvist.', ['NORDIC TIMBER TRADING AB']);

  // Guardia.
  await claro('el presidente de la Sección y la secretaria de Justicia del Constitucional', 'El presidente de la Sección, don Ignacio Sanz de Albornoz Pellicer. La secretaria de Justicia, doña Herminia Palencia Guerra.', ['Ignacio Sanz de Albornoz Pellicer', 'Herminia Palencia Guerra']);
  await claro('«Expediente sancionador n.º …» y la Jefatura', 'DIRECCIÓN GENERAL DE TRÁFICO — JEFATURA PROVINCIAL DE TOLEDO\nExpediente sancionador n.º 450123456789', ['JEFATURA PROVINCIAL DE TOLEDO', '450123456789']);
  await tapa('el dato penal que contiene un organismo', 'El padre está interno en el Centro Penitenciario de Castellón II cumpliendo condena.', ['Castellón II cumpliendo condena']);
  await tapa('un organismo en un escaneo no protege la línea de debajo', 'HOSPITAL CLINICO UNIVERSITARIO DE SANTIAGO - SERVIZO DE URXENCIAS\nINFORME DE ALTA DE URGENCIAS', ['INFORME DE ALTA DE URGENCIAS']);

  // Domicilios.
  await tapa('parcela, bloque, km y finca como número de la vía', 'Urbanización Los Pinares, parcela 27, 47151 Boecillo. Carretera de Valldemossa, km 12, Finca Son Mas, 07179 Deià.', ['parcela 27', 'km 12']);
  await tapa('dirección británica', 'domiciliada en 14 Harcourt Road, Flat 2, Bristol BS6 7RD (Reino Unido)', ['Harcourt Road', 'BS6 7RD']);
  await claro('la dirección no se come a la persona de la línea siguiente', 'domiciliado en Avinguda de Matadepera, 211, casa 3, 08207 Sabadell.\nDOÑA LAIA SOLER PUIGDOMÈNECH, con DNI 38987002R', ['DOÑA']);
  await claro('el domicilio social de una empresa pasa', 'CIF B20456786 — Domicilio social: Polígono Industrial Belartza, Donostia.', ['Polígono Industrial Belartza']);
  await claro('«plaza de aparcamiento número 14» no es una dirección', 'Lega la plaza de aparcamiento número 14 del edificio.', ['plaza de aparcamiento número 14']);
  {
    const a = nuevo();
    const [, t] = await anon(a, ['Arrendataria con domicilio en C/ Delicias, 88, bl. 2, esc. B, 3.º izda., 50017 Zaragoza.', 'Ya pasé por Delicias 88 y no había nadie.'], 'dom');
    comprobar('una calle ya vista, dicha a secas, se tapa', !t.includes('Delicias 88'), t);
  }

  // Categoría especial.
  await tapa('lesiones de un parte', 'Causándole fractura de huesos propios nasales y una herida inciso-contusa en región malar izquierda de 4 cm.', ['huesos propios nasales', 'inciso-contusa', 'malar']);
  await tapa('procedimientos y pruebas', 'Se practicó laparotomía; 11 días de ingreso en la UCI pediátrica; cateterismo y resonancia magnética.', ['laparotomía', 'UCI', 'cateterismo', 'resonancia']);
  await tapa('informes por su especialidad', 'Aporta informe neurológico, informe audiológico e informe del traumatólogo.', ['neurológico', 'audiológico', 'traumatólogo']);
  await tapa('adaptaciones que delatan una discapacidad', 'Solicita plaza en el turno de reserva para personas con discapacidad e intérprete de lengua de signos y bucle magnético.', ['turno de reserva', 'lengua de signos']);
  await tapa('bajas e IT', 'La baja de 7 meses del director; baja por depresión; Complemento IT en la nómina.', ['7 meses', 'depresión', 'Complemento IT']);
  await tapa('religión, sindical y etnia', 'Se negó a retirar el hiyab; paga cuota sindical UGT; pertenece a la etnia peul (fulani); va a catequesis.', ['hiyab', 'UGT', 'peul (fulani)', 'catequesis']);
  await claro('«uso» no es el sindicato USO', 'Hizo uso de su derecho.', ['uso de su derecho']);
  await claro('«vivir» y «espina» no son fármacos', 'Tiene que vivir con una espina clavada.', ['vivir', 'espina']);
  await tapa('adicción en lenguaje corriente, incidental', 'Sergiu está muy mal, desde que le echaron bebe mucho.', ['bebe mucho']);
  await claro('la ludopatía severa que funda las medidas pasa entera', 'Se solicita la modificación de medidas porque la Sra. Priego ha desarrollado una ludopatía severa.', ['ludopatía severa']);
  await claro('la adicción de la madre en un desamparo pasa', 'RESOLUCIÓN DE DECLARACIÓN DE DESAMPARO\n\n2. La madre presenta un trastorno por consumo de cocaína y alcohol.', ['trastorno por consumo de cocaína y alcohol']);
  await tapa('la condena concreta en una reagrupación se tapa', 'Documentación: certificado de antecedentes penales, que acredita la cancelación de la condena de 2009 por un delito de contrabando.', ['contrabando']);
  await claro('…pero el certificado de antecedentes, requisito a acreditar, pasa', 'Documentación: certificado de antecedentes penales, que acredita la cancelación de la condena de 2009 por un delito de contrabando.', ['antecedentes penales']);
}

// ─────────────────────────────────────────────────────────────────────────────
// El TERCER corpus a ciegas (primera pasada: 81,1 %).
process.stdout.write('\nCORPUS CIEGO 3 — FAMILIAS DE AGUJERO\n');
{
  const uno = async (texto, exp = 'c3') => (await anon(nuevo(), [texto], exp))[0];
  const claro = async (nombre, texto, debe) => { const t = await uno(texto); comprobar(nombre, debe.every((d) => t.includes(d)), t); };
  const tapa = async (nombre, texto, noDebe) => { const t = await uno(texto); comprobar(nombre, noDebe.every((d) => !t.includes(d)), t); };
  {
    const a = nuevo();
    const [t] = await anon(a, ['Els pares, Jordi Font i Casals i Montserrat Vidal Puig, denuncien els fets.'], 'cat');
    const al = t.match(/\[PERSONA_\d+\]/g) ?? [];
    comprobar('la «i» catalana delante de un nombre de pila separa a dos personas', al.length === 2 && al[0] !== al[1], t);
  }
  await tapa('iniciales de un menor', "L'altre menor, A.S.B., i el menor P.F.V. van participar.", ['A.S.B.', 'P.F.V.']);
  await claro('«S.L.» o «P.D.» no son iniciales de nadie', 'Firmado P.D. por HIERROS S.L.', ['P.D.', 'S.L.']);
  await tapa('nombre de pila con artículo en un mensaje', '[12/08/2026 23:15] Brais: se q estas con la Ro\n18:11 Maribel: aviso a la Pili y al tal Arteaga', ['Ro', 'Pili', 'Arteaga']);
  await claro('…pero «el Gregorio Marañón» es un hospital', '18:10 Chema: en el Gregorio Marañón, dicen q tiene rota la cadera', ['Gregorio Marañón']);
  await tapa('en un escaneo, un nombre no se estira por palabras corrientes', 'RAMIRO TIENE DEUDAS DE JUEGO Y ESTUVO EN LA CARCEL DE DAROCA EN 2018.', ['RAMIRO', 'CARCEL DE DAROCA']);
  await claro('…y «TIENE DEUDAS DE JUEGO» sigue en claro', 'RAMIRO TIENE DEUDAS DE JUEGO Y ESTUVO EN LA CARCEL DE DAROCA EN 2018.', ['TIENE DEUDAS DE JUEGO']);
  await tapa('tratamientos y saludos extranjeros', 'Reclamante: Ms. Siobhan Fletcher.\n\nLieber Tomeu,\nperdone mi español.', ['Siobhan', 'Fletcher', 'Tomeu']);
  await claro('la composición de la Sala «Ilmos. Sres.:»', 'Ilmos. Sres.: Presidente D. Rafael Carmona Gálvez; Magistrados D.ª Inmaculada Rueda Pozo y D. Álvaro Lagos Benítez (ponente).', ['Rafael Carmona Gálvez', 'Inmaculada Rueda Pozo', 'Álvaro Lagos Benítez']);
  await claro('«no es objeto de este pleito» manda', 'El INSS le ha reconocido una incapacidad permanente absoluta por resolución, que no es objeto de este pleito.', ['[DATO_SENSIBLE']);
  await tapa('antecedentes dichos de otras formas', 'Ya fue condenado en 2021. El varón dijo que había salido de la cárcel hacía poco; ya estuve dentro.', ['condenado en 2021', 'salido de la cárcel', 'estuve dentro']);
  await claro('la condena anterior que funda la reincidencia pasa', 'Condenamos con la agravante de reincidencia. SEGUNDO.- Había sido condenado ejecutoriamente por sentencia firme por un delito de robo.', ['condenado ejecutoriamente']);
  await claro('la drogadicción que funda la atenuante pasa', 'TERCERO.- Actuó con sus facultades volitivas disminuidas por su drogadicción de larga evolución.', ['drogadicción de larga evolución']);
  await tapa('vocabulario clínico en catalán', "Segueix tractament psicològic i pren metilfenidat; té hipoacúsia bilateral.", ['tractament psicològic', 'metilfenidat', 'hipoacúsia']);
  await tapa('informe de alta en un escaneo', 'JUICIO CLINICO: ICTUS ISQUEMICO DE ARTERIA CEREBRAL MEDIA IZQUIERDA. SITUACION FUNCIONAL: RANKIN 4. PRECISA AYUDA PARA ABVD.', ['ICTUS', 'RANKIN 4', 'ABVD']);
  await tapa('genética e identidad de género', 'Arrojó una probabilidad de paternidad del 99,997 %. Es una mujer trans en tratamiento hormonal con estradiol.', ['99,997', 'mujer trans', 'estradiol']);
  await claro('«Directora General de … Discapacidad» es un cargo', 'La Directora General de Cuidados, Dependencia y Discapacidad, firma.', ['Discapacidad']);
  await claro('«ATLANTIC SURF LAB, S.L.» no es el sindicato LAB', 'Constituyen la sociedad ATLANTIC SURF LAB, S.L.', ['LAB']);
  await tapa('teléfono extranjero y matrícula antigua', 'Llame al +44 7700 900412. Vehículo B-3456-TX.', ['7700 900412', 'B-3456-TX']);
  await claro('el domicilio detrás del CIF de una empresa pasa', 'HIERROS DEL EBRO, S.A. — CIF A28037158\nPolígono Malpica, calle E, parcela 12, 50016 Zaragoza', ['Polígono Malpica']);
  await tapa('«Mas» como apellido catalán', 'Declara Antoni Mas Coll.', ['Mas Coll']);
}

// ─────────────────────────────────────────────────────────────────────────────
// Las nueve dudas del anexo, con la respuesta de Juan del 26-sep. Cada una fija lo que Juan decidió
// para que ningún cambio posterior la deshaga sin que se note.
process.stdout.write('\nCATEGORÍA ESPECIAL — LAS NUEVE DUDAS (Juan, 26-sep)\n');
{
  const uno = async (texto, exp = 'd') => (await anon(nuevo(), [texto], exp))[0];
  const varios = async (textos, exp = 'd') => anon(nuevo(), textos, exp);

  // 1. Incapacidad permanente: la calificación pasa cuando es el objeto; el detalle clínico, nunca.
  let t = await uno('Frente a la resolución del INSS que le deniega la incapacidad permanente total derivada de lumbalgia crónica.');
  comprobar('1 · la incapacidad que se deniega pasa en claro', t.includes('incapacidad permanente total'), t);
  comprobar('1 · el detalle clínico que la acompaña se tapa', !t.includes('lumbalgia'), t);
  t = await uno('Se solicita que se reconozca la incapacidad permanente absoluta por espondilitis anquilosante.');
  comprobar('1 · con el diagnóstico detrás: pasa la calificación y se tapa el diagnóstico', t.includes('incapacidad permanente absoluta') && !t.includes('espondilitis'), t);
  t = await uno('El testigo D. Ramiro Lastra Cuesta, en situación de incapacidad permanente absoluta, declara que vio el accidente.');
  comprobar('1 · la de un tercero, incidental, se tapa', !t.includes('incapacidad permanente absoluta'), t);
  const [ip1, ip2] = await varios(['Se solicita la incapacidad permanente absoluta.', 'Desde entonces la incapacidad permanente absoluta le impide cualquier trabajo.']);
  comprobar('1 · establecida como objeto, pasa también en el fragmento siguiente', ip2.includes('incapacidad permanente absoluta'), `${ip1} | ${ip2}`);
  t = await uno('la resolución que le deniega la incapacidad permanente total');
  comprobar('1 · ya no depende de ir al final de frase (el apaño se ha quitado)', t.includes('incapacidad permanente total'), t);

  // 2. Discapacidad sin diagnóstico: categoría especial. Se mantiene la regla.
  t = await uno('La actora tiene reconocido un grado de discapacidad del 33 %.');
  comprobar('2 · la discapacidad sin diagnóstico se tapa', !/discapacidad|33 %/.test(t), t);

  // 3. País de origen: no es origen étnico. Se queda como está (en claro).
  t = await uno('D. Youssef El Amrani Bakkali, nacido en Nador (Marruecos), solicita la autorización.');
  comprobar('3 · el país de nacimiento sale en claro', t.includes('Nador (Marruecos)'), t);
  t = await uno('La trabajadora, de etnia bereber, fue apartada del puesto.');
  comprobar('3 · la pertenencia a una etnia sigue tapándose', !t.includes('bereber'), t);

  // 4. Antecedentes penales: art. 10, mismo criterio que la categoría especial.
  t = await uno('El acusado tiene antecedentes penales por hurto.');
  comprobar('4 · los antecedentes incidentales se tapan', !t.includes('antecedentes penales'), t);
  t = await uno('El acusado fue condenado anteriormente por un delito de robo con fuerza en las cosas y cumplió condena en 2019.');
  comprobar('4 · la condena anterior incidental se tapa', !/robo con fuerza|cumplió condena/.test(t), t);
  t = await uno('Se recurre la indebida aplicación de la agravante de reincidencia.');
  comprobar('4 · la reincidencia que es el motivo del recurso pasa', t.includes('reincidencia'), t);
  t = await uno('Solicita la cancelación de sus antecedentes penales.');
  comprobar('4 · los antecedentes cuya cancelación se pide pasan', t.includes('antecedentes penales'), t);
  t = await uno('El testigo reconoce que tiene antecedentes penales, y se solicita su tacha.');
  comprobar('4 · los del testigo se tapan aunque la frase pida algo', !t.includes('antecedentes penales'), t);
  t = await uno('Ingresó en prisión provisional el 3 de marzo por esta causa.');
  comprobar('4 · la prisión provisional de esta causa no es un antecedente', t.includes('prisión provisional'), t);
  const penal = await nuevo().anonimizarRespuesta(['El acusado tiene antecedentes penales por hurto.'], { expediente: 'p' });
  comprobar('4 · el alias dice DATO_PENAL, no categoría especial', /\[DATO_PENAL_\d+\]/.test(penal[0].texto), penal[0].texto);

  // 5. Documentos clínicos por su nombre: se quedan tapados.
  t = await uno('Se aporta la historia clínica y el parte de baja.');
  comprobar('5 · los documentos clínicos por su nombre se tapan', !/historia clínica|parte de baja/.test(t), t);

  // 6. Embarazo: pasa cuando es el objeto de la pretensión; incidental de un tercero, se tapa.
  t = await uno('La trabajadora comunicó su embarazo el 4 de febrero. Siete días después fue despedida, y se solicita la nulidad del despido.');
  comprobar('6 · el embarazo de la trabajadora despedida pasa', t.includes('embarazo'), t);
  t = await uno('Declara la compañera de trabajo, embarazada de seis meses, que presenció la discusión.');
  comprobar('6 · el de una tercera persona se tapa', !t.includes('embarazada'), t);
  t = await uno('Se solicita la nulidad del despido. La testigo, embarazada, presenció la discusión.');
  comprobar('6 · el de la testigo se tapa aunque el pleito sea un despido nulo', !t.includes('embarazada'), t);
  t = await uno('La vecina, que estaba embarazada, vio el accidente desde el portal.');
  comprobar('6 · el incidental, sin pleito que lo haga objeto, se tapa', !t.includes('embarazada'), t);
  t = await uno('Se solicita la nulidad del despido. Consta que se sometió a una interrupción voluntaria del embarazo.');
  comprobar('6 · la interrupción voluntaria del embarazo no entra en el criterio y se tapa', !t.includes('interrupción voluntaria'), t);

  // 7. Medicación por terminación: se deja tal cual.
  t = await uno('Está en tratamiento con enalapril y atorvastatina.');
  comprobar('7 · la medicación por terminación se tapa', !/enalapril|atorvastatina/.test(t), t);

  // 8. Objeción de conciencia: en convicciones filosóficas.
  t = await uno('El recurrente alegó objeción de conciencia.');
  comprobar('8 · la objeción de conciencia se tapa', !t.includes('objeción de conciencia'), t);

  // 9. Alcoholismo, ludopatía, toxicomanía: el mismo criterio de fondo.
  t = await uno('Se solicita la modificación de medidas por el alcoholismo del progenitor.');
  comprobar('9 · el alcoholismo que funda la modificación de medidas pasa', t.includes('alcoholismo'), t);
  const [a1, a2] = await varios(['Se solicita la modificación de medidas por el alcoholismo del progenitor.', 'El progenitor padece alcoholismo crónico con hepatopatía.']);
  comprobar('9 · en el fragmento siguiente pasa el alcoholismo…', a2.includes('alcoholismo crónico'), a2);
  comprobar('9 · …y el detalle clínico que lo acompaña se tapa', !a2.includes('hepatopatía'), a2);
  t = await uno('El informado presenta un trastorno delirante crónico con un episodio de alcoholismo en remisión.');
  comprobar('9 · en una pericial que no lo hace objeto, se tapa', !t.includes('alcoholismo'), t);
  t = await uno('El testigo, con antecedentes de ludopatía, declara a continuación.');
  comprobar('9 · la de un tercero se tapa', !t.includes('ludopatía'), t);
  t = await uno('Se interesa la atenuante de drogadicción del artículo 21.2 del Código Penal.');
  comprobar('9 · la drogadicción que funda la atenuante pasa', t.includes('drogadicción'), t);

  // Por lo que dice el texto, no por la sección donde está.
  t = await uno('FUNDAMENTOS DE DERECHO\n\nPRIMERO.— La testigo, embarazada de cinco meses, vio la escena.');
  comprobar('sección · un dato incidental en los fundamentos se tapa', !t.includes('embarazada'), t);
  t = await uno('DOCUMENTO Nº 4. Resolución del INSS que deniega la incapacidad permanente total.');
  comprobar('sección · el objeto citado dentro de un documento aportado pasa', t.includes('incapacidad permanente total'), t);

  // El objeto es del expediente: no se hereda en otro.
  const a = nuevo();
  await anon(a, ['Se solicita la incapacidad permanente absoluta.'], 'expA');
  const [otro] = await anon(a, ['El actor tiene reconocida una incapacidad permanente absoluta.'], 'expB');
  comprobar('el objeto de un expediente no hace pasar el dato en otro', !otro.includes('incapacidad permanente absoluta'), otro);
}

process.stdout.write('\nEXPEDIENTES COMPLETOS — FAMILIAS DE AGUJERO (2-oct)\n');
{
  const uno = async (texto, exp = 'x') => (await anon(nuevo(), [texto], exp))[0];
  const tapa = async (nombre, texto, noDebe) => { const t = await uno(texto); comprobar(nombre, noDebe.every((d) => !t.includes(d)), t); };
  const claro = async (nombre, texto, debe) => { const t = await uno(texto); comprobar(nombre, debe.every((d) => t.includes(d)), t); };

  // El tramo sensible: la frase que cuenta el dato, no solo el término.
  await tapa('tramo · el detalle que acompaña al término se tapa entero', 'Episodio depresivo leve en 2025 tras el segundo ciclo fallido de FIV.', ['segundo ciclo', 'FIV']);
  await tapa('tramo · coloquial en un chat', '12/05/26, 10:01 - Lucía Martín: estoy en urgencias, he sangrado esta mañana subida a la carretilla', ['urgencias', 'sangrado']);
  await tapa('tramo · la pauta dicha en la calle', 'La psiquiatra me a subido la sertralina y me a puesto otra para dormir, la mirtazapina.', ['sertralina', 'para dormir', 'mirtazapina']);
  await tapa('tramo · siglas y constantes', 'Antecedentes: HTA, DM2 en tto. con metformina. TA 138/84, FC 88 lpm, SatO2 95 %.', ['HTA', 'DM2', 'metformina', '138/84', '88 lpm']);
  await tapa('tramo · la coletilla tras la coma', "La Sra. Heredia pateix una malaltia d'Alzheimer en fase moderada (GDS 5), amb desorientació i episodis d'agitació nocturna.", ['Alzheimer', 'desorientació', 'agitació']);
  await tapa('tramo · religión, política y etnia dichas de pasada', 'Mi madre va a misa todos los días. Su hermano es de Bildu. Le llamaban gitano en la nave.', ['misa', 'Bildu', 'gitano']);
  await tapa('tramo · genético y biométrico', 'Es portadora de una mutación germinal en BRCA2. Se tomó la huella dactilar del índice derecho.', ['BRCA2', 'huella dactilar']);
  await claro('tramo · «Su compañera» delante de un nombre no es un dato', 'Su compañera Ana Ruiz padece diabetes tipo 1.', ['Su compañera']);
  await claro('tramo · una profesión dicha como cargo no es un dato', 'Informe emitido por la Médico Forense D.ª Rosa Gil, a instancia de la defensa.', ['Médico Forense']);
  await claro('tramo · «Dña» no es ADN', 'Bajo la dirección letrada de Dña. Marta Gil se interpone la demanda.', ['Bajo la dirección letrada de']);
  await claro('tramo · «3.º izquierda», «independiente», «ingresados en la cuenta»', 'Vive en el 3.º izquierda. El auditor independiente informa. Los importes fueron ingresados en la cuenta.', ['izquierda', 'independiente', 'ingresados en la cuenta']);
  await claro('tramo · «causa baja por despido» no es una baja médica', 'Causa baja por despido objetivo el 31/07/2026.', ['baja por despido']);
  await claro('tramo · «libertad sindical» es un derecho, no una afiliación', 'DEMANDA DE TUTELA DEL DERECHO FUNDAMENTAL DE LIBERTAD SINDICAL', ['LIBERTAD SINDICAL']);
  await claro('tramo · el delito de un razonamiento no es un antecedente', 'Los hechos no constituirían un delito de estafa.', ['delito de estafa']);
  await tapa('tramo · fuera de una causa penal, la condena del cónyuge es antecedente', 'En la reagrupación consta que al marido le pusieron en 2016 una pena de ocho meses de prisión, en suspenso, y multa.', ['ocho meses de prisión', 'en suspenso']);
  await claro('tramo · la guardia sigue mandando dentro del tramo', 'Padece cardiopatía isquémica conforme al art. 194 LGSS y en seguimiento en Cardiología del Hospital Virgen del Rocío.', ['art. 194 LGSS', 'Hospital Virgen del Rocío']);

  // Identificadores.
  await tapa('id · DNI con la letra mal, con etiqueta', 'Doña Sonia Calzada Rey, con DNI 63158720F y domicilio en Burgos.', ['63158720F']);
  await tapa('id · DNI del OCR con «l» y «O»', 'MAY0R DE EDAD, C0N DNI 73l04588-J Y D0MICILI0', ['73l04588']);
  await tapa('id · historia clínica, tarjeta sanitaria y afiliación', 'NHC: 2184773  CIPA: ARLT880412-07  N. AFILIACI0N: 41/l0245678/33  TSI: OUAN960811-3027', ['2184773', 'ARLT880412', '0245678', 'OUAN960811']);
  await tapa('id · pasaporte y zona legible por máquina', 'Titular del pasaporte del interesado (n.º TK8820164). P<MAREL<AMRANI<<FATIMA<ZAHRA<<<<<<<<', ['TK8820164', 'AMRANI<<FATIMA']);
  await tapa('id · NIE e IBAN español por la forma', 'Con NIE Y4829176K, cuenta ES21 2085 5202 7103 3012 4581.', ['Y4829176K', 'ES21 2085']);
  await claro('id · el número de un expediente no es un DNI', 'Expediente n.º 20261234A del registro.', ['20261234A']);

  // Personas.
  {
    const [t] = await anon(nuevo(), ['Fdo.: Garbiñe Arrieta Zubizarreta Iñaki Olabarria Uriarte Amaia Larrañaga Etxebarria'], 'f');
    const al = t.match(/\[PERSONA_\d+\]/g) ?? [];
    comprobar('persona · una línea de firmas aplanada son tres personas', new Set(al).size === 3, t);
  }
  {
    const [t] = await anon(nuevo(), ['Vicent: hola, ¿qué tal? Rocío Amaya: me han echado del curro, lo sabe Pau Vicent: lo siento mucho Rocío Amaya: gracias'], 'f');
    comprobar('persona · el remitente de un chat no se funde con la última palabra del mensaje anterior', !t.includes('Vicent') && !t.includes('Rocío') && /lo sabe \[PERSONA_\d+\] \[PERSONA_\d+\]:/.test(t), t);
  }
  await claro('persona · una institución o un lugar no son personas', 'Remitido por la Gestión Sanitaria Sevilla Norte-Macarena al Juzgado de lo Social número 7 de Sevilla.', ['Sevilla Norte-Macarena', 'número 7 de Sevilla']);
  await claro('persona · «da Lei» es una ley', 'Conforme ao artigo 92 da Lei 39/2015, do 1 de outubro.', ['da Lei 39/2015']);
  await tapa('persona · nombre del OCR con ceros', 'TRABAJAD0RA: MARIA J0SE ALBAS GRACIA, C0N D0MICILI0 EN C/ T0MAS BRET0N 47', ['ALBAS GRACIA']);

  // Guardia.
  await claro('guardia · cita abreviada', 'Vulneración del art. 16 CE, despido del ART. 52 C) ET y art. 140.3 LRJS.', ['art. 16 CE', 'ART. 52 C) ET', 'art. 140.3 LRJS']);
  await claro('guardia · sigla sanitaria con su lugar', 'Segueix tractament al CSMIJ del Gironès per una simptomatologia ansiosa.', ['CSMIJ del Gironès']);
}

// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write(`\n${'═'.repeat(60)}\n`);
process.stdout.write(`${ok} pasan · ${ko} fallan\n`);
if (ko) {
  process.stdout.write('\nFALLOS:\n');
  for (const f of fallos) process.stdout.write(`  · ${f.nombre}\n    ${f.detalle}\n`);
}
process.exit(ko ? 1 : 0);
