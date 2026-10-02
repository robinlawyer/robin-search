// El anonimizador: filtro de salida y filtro de entrada.
//
// Va en el punto único de `server/index.js` —el `setRequestHandler(CallToolRequestSchema, …)` por
// el que pasan las 16 tools antes de volver a Claude—, y es un filtro de ida y otro de vuelta:
//
//   SALIDA  documento → alias → Claude
//   ENTRADA Claude → alias → nombre real → disco (guardar_borrador) o búsqueda
//
// El filtro de ENTRADA no es opcional, es obligatorio: si Claude pregunta por «[PERSONA_3]» y no
// se revierte antes de buscar, la búsqueda no encuentra nada.
//
// ORDEN DE LAS CAPAS, y el porqué de cada una:
//
//   1. Guardia de intocables. Va PRIMERA y manda sobre todo lo demás. Marca las regiones que nunca
//      se tapan (órganos, autos, ECLI, ROJ, normas, organismos, ponente, LAJ, TIP). Tapar de más
//      mata el producto: si el filtro se come «Juzgado de Primera Instancia nº 5 de Madrid», la
//      respuesta deja de servir para trabajar.
//
//   2. Deterministas. DNI, NIE, CIF, IBAN, teléfono, correo, matrícula, NAF. Con dígito de control
//      comprobado, no por la forma. Gratis y sin modelo.
//
//   3. Propagación. Los nombres que ya están en la tabla de este expediente. Gratis y sin modelo.
//
//   4. Personas por contexto. Tratamiento y cargo delante del nombre. Es una regla, no una
//      estadística: no se cansa a la cuarta «D.ª» seguida y funciona igual en un escaneo.
//
//   5. Domicilios y categoría especial. Estructura y vocabulario, no entidades.
//
//   5b. El TRAMO sensible (tramos.mjs, 2-oct). El segmento de frase que lleva un dato de categoría
//      especial o un antecedente se tapa entero, menos lo que tiene dueño: la guardia, el objeto
//      del escrito y lo ya tapado con su tipo. Sin esto, con expedientes completos se tapaba el
//      9,5 % de la categoría especial: el término sí, la frase que lo cuenta no.
//
//   6. El modelo. NO VA EN LA v1 (Juan, 26-sep): pone un dato de cada noventa —el nombre que
//      aparece sin presentar, «me llamó ayer Sonia Belmonte Tirado»— a cambio de 31 MB de
//      instalador, casi 7 s por respuesta y una dependencia binaria más. El filtro NO lo importa:
//      solo lo carga el banco, cuando se le pide expresamente, para volver a medirlo con
//      expedientes reales. Si ahí aparece un patrón de fuga que las reglas no cogen, entra en una
//      v1.1 con esos datos encima de la mesa.
//
// Las capas 2-6 se resuelven por prioridad: la de número más bajo gana el trozo de texto. Y todas
// ellas, sin excepción, ceden ante la capa 1.

import { detectarDeterministas, sombraNumerica } from './deterministas.mjs';
import { detectarPersonasPorContexto } from './personas.mjs';
import { detectarDomicilios } from './domicilios.mjs';
import { detectarCategoriaEspecial } from './especiales.mjs';
import { objetosDelTexto, terminosDeFondo, esObjeto, frases } from './objeto.mjs';
import { tramosSensibles, remitentesDeChat } from './tramos.mjs';
import { regionesIntocables, estaProtegida } from './intocables.mjs';
import { TablaAlias, variantesDe } from './alias.mjs';
import { plegar, extenderNombre, vaEnMayuscula, dentroDeRazonSocial, antesNoPersona, pareceNombreDePersona, esNombreDePila, esSoloLugarOInstitucion } from './texto.mjs';
import { normalizar } from './alias.mjs';

export { TablaAlias } from './alias.mjs';

const PRIORIDAD = {
  determinista: 2,
  propagacion: 3,
  contexto: 4,
  domicilio: 5,
  especial: 5,
  modelo: 6,
};

const prioridadDe = (d) => PRIORIDAD[String(d.via ?? 'modelo').split(':')[0]] ?? 9;

// Resuelve solapes entre capas: gana la prioridad más baja y, a igualdad, el trozo más largo.
// Ejemplo real: la regla de contexto marca «Juan Pérez Gómez» y el modelo marca solo «Pérez
// Gómez». Sin esto se taparía el apellido y el nombre de pila saldría en claro.
//
// Entre PERSONAS no manda la capa, manda el largo. La propagación va antes que el contexto, y en
// un convenio regulador eso partía al hijo: «Daniel Zamarreño Alcaine» se quedaba en «Daniel» EN
// CLARO más el primer apellido del padre y el de la madre, cada uno con el alias de su dueño. Un
// nombre de pila fuera y el niño convertido en sus padres. El nombre más largo es el de la persona
// que de verdad está ahí; el apellido suelto que la propagación reconoce es solo un trozo suyo.
//
// Y un DOMICILIO compite con una persona en igualdad: «calle del Carme, 45, bajos» o «calle Juan
// Bravo 3» llevan un nombre de persona dentro, y si gana la persona la dirección se parte y el
// número y el piso salen en claro. El más largo es la dirección entera.
const prioridadResolver = (d) => (d.tipo === 'PERSONA' || d.tipo === 'DIRECCION' ? PRIORIDAD.propagacion : prioridadDe(d));

function resolver(detecciones, largoTexto) {
  const ordenadas = [...detecciones].sort((a, b) => {
    const p = prioridadResolver(a) - prioridadResolver(b);
    if (p !== 0) return p;
    const l = b.fin - b.inicio - (a.fin - a.inicio);
    if (l !== 0) return l;
    // Empate exacto entre una dirección y una persona: gana la dirección (una vía con nombre de
    // persona —«calle Juan Bravo 3»— es una dirección).
    if (a.tipo === 'DIRECCION' && b.tipo === 'PERSONA') return -1;
    if (b.tipo === 'DIRECCION' && a.tipo === 'PERSONA') return 1;
    return a.inicio - b.inicio;
  });
  const ocupado = new Array(largoTexto).fill(false);
  const fuera = [];
  for (const d of ordenadas) {
    let libre = true;
    for (let i = d.inicio; i < d.fin; i++) if (ocupado[i]) { libre = false; break; }
    if (!libre) continue;
    for (let i = d.inicio; i < d.fin; i++) ocupado[i] = true;
    fuera.push(d);
  }
  return fuera.sort((a, b) => a.inicio - b.inicio);
}

function sustituir(texto, detecciones, tabla, expediente) {
  let fuera = '';
  let cursor = 0;
  for (const d of detecciones) {
    fuera += texto.slice(cursor, d.inicio);
    fuera += tabla.alias(expediente, d.tipo, d.valor);
    cursor = d.fin;
  }
  return fuera + texto.slice(cursor);
}

const PRESENTADA = /^contexto:(?:tratamiento|cargo|enumeracion|etiqueta|cargo-detras)$/;
// Lo que corta una región: una persona presentada, o una que empieza por un nombre de pila del
// léxico (un órgano no se llama «Juan»: si la cola de un juzgado llega a un nombre de pila, ahí
// empieza otra cosa).
// Y las demás señales FUERTES de persona: la relación («mi hermana Carmen»), el vocativo, el cargo
// entre comas, los apellidos que hacen de sujeto de un verbo («…conforme al artículo 24 CE,
// Urdiales Cotrina alegó…» protegía al que venía detrás de la cita, porque la región de la norma
// llega hasta el final de la frase). NO el nombre completo por su forma: tres palabras con
// mayúscula salen también DENTRO de un organismo («Agencia Española de Protección de Datos»,
// «Colegio Oficial de Médicos de Madrid»), y cortar ahí tapaba la institución.
const CORTA_REGION = /^contexto:(?:tratamiento|cargo|enumeracion|etiqueta|cargo-detras|nombre-de-pila|relacion|vocativo|cargo-entre-comas|apellidos-sujeto|apellido-en-correo|saludo|firma|cabecera-correo|a-la-atencion|fecha-nacimiento)$/;

// Una región intocable ACABA donde empieza una persona presentada con tratamiento o cargo.
//
// Las regiones de la guardia llevan colas golosas («Juzgado … de …» hasta la coma, «Ley …» hasta el
// fin de frase), y en producción el texto no tiene saltos de línea: el indexador trocea por
// palabras y las vuelve a unir con un espacio. Así, «AL JUZGADO DE PRIMERA INSTANCIA N 12 DE
// BARCELONA DON JOAQUIN MUNOZ ESTEVEZ, PROCURADOR…» protegía al procurador, y «ANTE EL JUZGADO
// COMPARECE … CONTRA DON ELADIO QUESADA MARTORELL» protegía al demandado: los dos en claro. Es la
// misma lección de siempre —una protección estirada de más destapa—, y la regla que la cierra es
// general: un tratamiento o un cargo delante de un nombre dicen que ahí empieza una persona, y
// ninguna institución sigue más allá. El ponente y el LAJ no se ven afectados: su región EMPIEZA
// en el nombre, no antes.
function recortarRegiones(regiones, crudas) {
  const cortes = crudas
    .filter((d) => d.tipo === 'PERSONA' && CORTA_REGION.test(d.via ?? ''))
    .map((d) => d.inicio);
  if (!cortes.length) return regiones;
  return regiones
    .map((r) => {
      let fin = r.fin;
      for (const c of cortes) if (c > r.inicio && c < fin) fin = c;
      return fin === r.fin ? r : { ...r, fin, recortada: true };
    })
    .filter((r) => r.fin > r.inicio);
}

function apellidoInstitucional(d, r) {
  return d.tipo === 'PERSONA' && PRESENTADA.test(d.via ?? '') && r.clase === 'ORGANISMO' &&
    r.inicio > d.inicio && r.fin === d.fin && r.valor.split(/\s+/).length <= 3;
}

function organismoDentroDeDato(d, r) {
  return (d.tipo === 'CAT_ESPECIAL' || d.tipo === 'DATO_PENAL') && r.clase === 'ORGANISMO' && r.inicio >= d.inicio && r.fin <= d.fin && d.fin - d.inicio > r.fin - r.inicio;
}

// La línea de firmas aplanada: «Garbiñe Arrieta Zubizarreta Iñaki Olabarria Uriarte Amaia Larrañaga
// Etxebarria» llega así a Claude (el indexador junta los espacios de la columna de firmas) y se leía
// como UNA persona: un solo alias para tres profesionales. Se parte donde empieza otro nombre de
// pila después de, al menos, nombre y un apellido. «María Teresa Lopetegui» no se parte: el segundo
// nombre de pila va pegado al primero.
function sinCerosDeOcr(texto) {
  if (!/[A-ZÁÉÍÓÚÑa-záéíóúñ]0|0[A-ZÁÉÍÓÚÑa-záéíóúñ]/.test(texto)) return texto;
  return texto.replace(/(?<![\p{N}])[\p{L}0]*\p{L}[\p{L}0]*(?![\p{N}])/gu, (w) => ((w.match(/\p{L}/gu) ?? []).length >= 2 && w.includes('0') ? w.replace(/0/g, w === w.toUpperCase() ? 'O' : 'o') : w));
}

function partirFirmas(texto, d) {
  const piezas = [...d.valor.matchAll(/[^\s]+/g)];
  if (piezas.length < 5) return [d];
  const cortes = [0];
  for (let k = 2; k < piezas.length - 1; k++) {
    const p = piezas[k][0].replace(/[,.;:]+$/, '');
    const ant = piezas[k - 1][0].replace(/[,.;:]+$/, '');
    if (esNombreDePila(p) && !esNombreDePila(ant) && k - cortes[cortes.length - 1] >= 2) cortes.push(k);
  }
  if (cortes.length < 2) return [d];
  const fuera = [];
  for (let c = 0; c < cortes.length; c++) {
    const a = piezas[cortes[c]];
    const b = piezas[(cortes[c + 1] ?? piezas.length) - 1];
    const ini = d.inicio + a.index;
    const fin = d.inicio + b.index + b[0].length;
    fuera.push({ ...d, valor: texto.slice(ini, fin), inicio: ini, fin, via: `${d.via}:firma` });
  }
  return fuera;
}

export class Anonimizador {
  constructor({ tabla = new TablaAlias(), reconocedor = null, traducirEtiqueta = null } = {}) {
    this.tabla = tabla;
    this.reconocedor = reconocedor;
    this.traducirEtiqueta = traducirEtiqueta;
  }

  // La v1 es `new Anonimizador()`: solo reglas. `crear({ modelo })` existe para el banco, que
  // vuelve a medir los candidatos; el import es dinámico para que el filtro no cargue el módulo
  // del reconocedor ni su librería si nadie lo pide.
  static async crear({ modelo, traducirEtiqueta, cacheDir = null, modelsDir = null, empaquetado = false, tabla } = {}) {
    let reconocedor = null;
    if (modelo) {
      const { cargarReconocedor } = await import('./ner.mjs');
      reconocedor = await cargarReconocedor({ modelo, cacheDir, modelsDir, empaquetado });
    }
    return new Anonimizador({ tabla, reconocedor, traducirEtiqueta });
  }

  // Todo lo que hay que tapar en un texto, ya resuelto y con la guardia aplicada.
  // `marcasModelo` llega de fuera porque el modelo se llama por LOTES: una sola pasada para los
  // 60 fragmentos de la respuesta en vez de 60 llamadas.
  detectar(texto, { expediente = '_', marcasModelo = [] } = {}) {
    // La última puerta de las personas: una institución, un lugar o un rótulo no entran en la tabla
    // (y la propagación ya no los esparce). La propagación pasa: lo que propaga ya pasó esta puerta.
    const crudas = this.detectarCrudo(texto, { expediente, marcasModelo })
      .flatMap((d) => (d.tipo === 'PERSONA' ? partirFirmas(texto, d) : [d]))
      .filter((d) => d.tipo !== 'PERSONA' || (String(d.via).startsWith('propagacion') && !d.estirado ? !esSoloLugarOInstitucion(d.valor) : pareceNombreDePersona(d.valor, texto, d.inicio)));
    // La guardia también sobre el texto sin los ceros del OCR («SERVIZ0 GALEG0 DE SAUDE»).
    const regiones = recortarRegiones(regionesIntocables(sinCerosDeOcr(texto)).map((r) => ({ ...r, valor: texto.slice(r.inicio, r.fin) })), crudas);
    // La guardia manda: lo que cae dentro de una región intocable no se tapa, venga de donde venga.
    //
    // Con una excepción, estrecha a propósito: el nombre presentado con tratamiento o cargo que
    // ACABA en un organismo. «D. Lorenzo Guardia Civil» es una persona; la guardia protegía
    // «Guardia Civil» y el nombre entero salía en claro. Gana la persona solo si el organismo cae
    // entero dentro del nombre, al final, con al menos una pieza delante, y la región es un
    // ORGANISMO (nunca un órgano judicial, unos autos o una norma). «oficio a la Guardia Civil de
    // Almazán» no lleva nombre delante, y sigue en claro.
    //
    // Y otra: un dato sensible que CONTIENE entero el nombre de un organismo. «interno en el Centro
    // Penitenciario de Castellón II cumpliendo condena», «varios ingresos en la Unidad de Conductas
    // Adictivas»: el organismo es público, pero dicho así cuenta algo de una persona.
    const permitidas = crudas.filter((d) => !estaProtegida(d, regiones.filter((r) => !apellidoInstitucional(d, r) && !organismoDentroDeDato(d, r))));
    let detecciones = resolver(permitidas, texto.length);

    // Segunda pasada DENTRO del mismo fragmento. Un nombre que ya se ha reconocido aquí arriba
    // («Manuel Pérez Alcaraz», presentado con tratamiento) vuelve a aparecer más abajo a secas
    // («Interrogado Pérez Alcaraz…», «si Pérez tuvo acceso»). La tabla del expediente no ayuda
    // todavía, porque esas menciones están en ESTE fragmento, no en uno anterior. Es una búsqueda
    // de texto sobre lo ya encontrado: no pasa por el modelo y no cuesta nada.
    const extra = [];
    const henoPlegado = plegar(texto); // una sola vez: estaba dentro del bucle
    const yaCubierto = (i, f) => detecciones.some((d) => i < d.fin && d.inicio < f);
    for (const d of detecciones.filter((x) => x.tipo === 'PERSONA')) {
      for (const v of variantesDe(d.valor)) {
        if (v.length < 4) continue;
        const aguja = plegar(v);
        let desde = 0;
        for (;;) {
          const i = henoPlegado.indexOf(aguja, desde);
          if (i < 0) break;
          desde = i + 1;
          let fin = i + aguja.length;
          const antes = texto[i - 1];
          const despues = texto[fin];
          if ((antes && /[\p{L}\p{N}]/u.test(antes)) || (despues && /[\p{L}\p{N}]/u.test(despues))) continue;
          if (yaCubierto(i, fin)) continue;
          if (!vaEnMayuscula(texto.slice(i, fin))) continue;
          if (dentroDeRazonSocial(texto, i, fin)) continue;
          if (antesNoPersona(texto, i)) continue;
          // Mismo cuidado que en la tabla: un apellido de esta persona pegado a otras piezas de
          // nombre es otra persona («Daniel Zamarreño Alcaine» no es su padre).
          let ini = i;
          let de = d.valor;
          if (normalizar(v) !== normalizar(d.valor)) {
            const x = extenderNombre(texto, i, fin);
            if (x.estirado) { ini = x.inicio; fin = x.fin; de = null; }
          }
          if (ini !== i && yaCubierto(ini, fin)) continue;
          const cand = de
            ? { tipo: 'PERSONA', valor: texto.slice(ini, fin), inicio: ini, fin, via: 'propagacion', de }
            : { tipo: 'PERSONA', valor: texto.slice(ini, fin), inicio: ini, fin, via: 'propagacion', estirado: true };
          // Lo estirado es un valor nuevo: pasa la misma puerta que cualquier persona.
          if (cand.estirado && !pareceNombreDePersona(cand.valor, texto, cand.inicio)) continue;
          if (estaProtegida(cand, regiones)) continue;
          if (extra.some((e) => e.inicio < fin && ini < e.fin)) continue;
          extra.push(cand);
        }
      }
    }
    if (extra.length) detecciones = resolver([...detecciones, ...extra], texto.length);
    detecciones = this.ampliarTramos(texto, detecciones, regiones, expediente);
    return { detecciones, regiones };
  }

  // Capa 5b: el tramo sensible entero. Lo que ya tapaban las reglas de categoría especial se funde
  // con el tramo en un solo trozo (un alias), y lo demás —personas, identificadores, domicilios—
  // conserva el suyo.
  ampliarTramos(texto, detecciones, regiones, expediente) {
    const n = texto.length;
    const guardia = new Array(n).fill(false);
    // Una cárcel no es una institución neutra dentro de un dato penal: «cumple condena en el Centro
    // Penitenciario de Basauri» dice de alguien lo mismo que la condena (la regla del 29-sep ya lo
    // tapaba dentro del dato; el tramo no puede dejarla en claro).
    for (const r of regiones) {
      if (r.clase === 'ORGANISMO' && /penitenci|prisi[óo]n|c[áa]rcel|presidio/i.test(texto.slice(r.inicio, r.fin))) continue;
      // Ni la unidad que dice ella sola la condición: «Unidad de Conductas Adictivas», «Proyecto
      // Hombre», «Centro de Atención a Drogodependencias». (Las de salud mental en general sí quedan
      // en claro como institución, como cerró Juan.)
      // Salvo que la adicción sea el objeto del escrito (la atenuante, las medidas): entonces la unidad
      // que la trata es parte de ese objeto y va en claro.
      if (r.clase === 'ORGANISMO' && /adicti|drogodepend|toxicoman|proyecto\s+hombre|alcoh[óo]lic/i.test(texto.slice(r.inicio, r.fin)) &&
        !this.tabla.objetos(expediente).has('ADICCION') && !objetosDelTexto(texto).has('ADICCION')) continue;
      for (let i = r.inicio; i < r.fin; i++) guardia[i] = true;
    }
    const objeto = new Array(n).fill(false);
    const objetos = this.tabla.objetos(expediente);
    const lista = frases(texto);
    const objetosAqui = [];
    for (const t of terminosDeFondo(texto, { objetos })) {
      if (esObjeto(texto, t, { objetos, lista })) {
        objetosAqui.push(t);
        for (let i = t.inicio; i < t.fin; i++) objeto[i] = true;
      }
    }
    const sensible = (d) => d.tipo === 'CAT_ESPECIAL' || d.tipo === 'DATO_PENAL';
    const todo = guardia.map((g, i) => g || objeto[i]);
    for (const d of detecciones) if (!sensible(d)) for (let i = d.inicio; i < d.fin; i++) todo[i] = true;
    const yaSensible = new Array(n).fill(false);
    for (const d of detecciones) if (sensible(d)) for (let i = d.inicio; i < d.fin; i++) yaSensible[i] = true;
    const nuevos = tramosSensibles(texto, { ocupado: { guardia, objeto, todo, sensible: yaSensible }, objetos: new Set([...objetos, ...objetosDelTexto(texto)]), objetosAqui, frases: lista });
    if (!nuevos.length) return detecciones;
    // Unión de lo sensible (lo de antes y los tramos), por intervalos. El tipo del trozo fundido es el
    // que le daban las reglas de antes si lo había (un antecedente sigue siendo DATO_PENAL aunque el
    // tramo lo amplíe), y si no, el del tramo.
    const marca = new Array(n).fill(null);
    const previo = new Array(n).fill(null);
    for (const d of detecciones.filter(sensible)) for (let i = d.inicio; i < d.fin; i++) previo[i] = d.tipo;
    for (const d of [...detecciones.filter(sensible), ...nuevos]) {
      for (let i = d.inicio; i < d.fin; i++) {
        if (marca[i] === 'CAT_ESPECIAL') continue;
        marca[i] = d.tipo;
      }
    }
    const fundidos = [];
    for (let i = 0; i < n;) {
      if (!marca[i]) { i++; continue; }
      let f = i;
      let tipo = 'DATO_PENAL';
      let tipoPrevio = null;
      while (f < n && marca[f]) { if (marca[f] === 'CAT_ESPECIAL') tipo = 'CAT_ESPECIAL'; if (previo[f] && !tipoPrevio) tipoPrevio = previo[f]; f++; }
      if (tipoPrevio) tipo = tipoPrevio;
      const vias = new Set([...detecciones.filter(sensible), ...nuevos].filter((d) => d.inicio < f && i < d.fin).map((d) => d.via));
      fundidos.push({ tipo, valor: texto.slice(i, f), inicio: i, fin: f, via: [...vias].join('+') });
      i = f;
    }
    return [...detecciones.filter((d) => !sensible(d)), ...fundidos].sort((a, b) => a.inicio - b.inicio);
  }

  // Lo mismo SIN la guardia. Solo lo usa el banco, para poder decir cuánto sobre-tapado evita la
  // guardia — que es la medida de por qué la guardia no es un adorno sino la mitad del producto.
  detectarCrudo(texto, { expediente = '_', marcasModelo = [] } = {}) {
    // Personas y domicilios se buscan también sobre el texto con el 0 del OCR devuelto a su O
    // («MARIA J0SE ALBAS GRACIA», «C/ T0MAS BRET0N 47»): mismo largo, mismas posiciones, y el valor
    // que se tapa es el original.
    const limpio = sinCerosDeOcr(sombraNumerica(texto));
    const conOriginal = (ds) => ds.map((d) => ({ ...d, valor: texto.slice(d.inicio, d.fin) }));
    return [
      ...detectarDeterministas(texto).map((d) => ({ ...d, via: 'determinista' })),
      ...this.tabla.propagar(expediente, texto),
      ...this.tabla.propagarDirecciones(expediente, texto),
      ...conOriginal(detectarPersonasPorContexto(limpio)),
      // Quien escribe en un chat, tal como lo deja el indexador («Rocío Amaya: … Vicent: …»).
      ...conOriginal(remitentesDeChat(limpio).map((r) => ({ tipo: 'PERSONA', ...r, via: 'contexto:remitente' }))),
      ...conOriginal(detectarDomicilios(limpio)),
      ...detectarCategoriaEspecial(texto, { objetos: this.tabla.objetos(expediente) }),
      ...marcasModelo,
    ];
  }

  // La pasada previa por una respuesta entera: qué datos sensibles son el objeto del escrito. La
  // hace anonimizarRespuesta, y el banco también, para medir lo mismo que ocurre en producción.
  prepararRespuesta(textos, { expediente = '_' } = {}) {
    for (const t of textos) for (const clase of objetosDelTexto(t)) this.tabla.marcarObjeto(expediente, clase);
  }

  // Filtro de SALIDA sobre una respuesta entera. Recibe los fragmentos tal cual salen de la tool y
  // devuelve los textos con alias, en el mismo orden.
  async anonimizarRespuesta(fragmentos, { expediente = '_' } = {}) {
    const textos = fragmentos.map((f) => (typeof f === 'string' ? f : f.texto));
    // Pasada previa por la respuesta entera: qué datos sensibles son el objeto del escrito
    // (criterio de fondo de Juan, objeto.mjs). Va ANTES de tapar nada para que el mismo término no
    // salga tapado en el fragmento 1 y en claro en el 3 de la misma respuesta. Y se guarda en la
    // tabla del expediente, aislada como el resto: el objeto de un asunto no dice nada del otro.
    this.prepararRespuesta(textos, { expediente });
    let marcas = textos.map(() => []);
    if (this.reconocedor && this.traducirEtiqueta) {
      const { reconocerLote } = await import('./ner.mjs');
      marcas = await reconocerLote(this.reconocedor, textos, this.traducirEtiqueta);
    }
    const fuera = [];
    for (let i = 0; i < textos.length; i++) {
      // Importante que sea SECUENCIAL: cada fragmento alimenta la tabla, y el siguiente ya se
      // aprovecha de ella por propagación. En paralelo se perdería ese efecto y además los alias
      // saldrían numerados de forma distinta en cada ejecución.
      const { detecciones } = this.detectar(textos[i], { expediente, marcasModelo: marcas[i] ?? [] });
      fuera.push({
        texto: sustituir(textos[i], detecciones, this.tabla, expediente),
        detecciones,
      });
    }
    return fuera;
  }

  // Filtro de ENTRADA. Lo que Claude manda, con los alias cambiados por los valores reales.
  // Devuelve también los alias que no conocíamos, para que quien llame avise en vez de dejar el
  // literal metido en un borrador que va a firmar un abogado.
  rehidratar(texto, { expediente = '_' } = {}) {
    return {
      texto: this.tabla.rehidratar(expediente, texto),
      desconocidos: this.tabla.aliasDesconocidos(expediente, texto),
    };
  }
}

export default Anonimizador;
