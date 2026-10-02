// Banco de pruebas del anonimizador.
//
//   node scripts/banco-nombres/banco.mjs                  todo
//   node scripts/banco-nombres/banco.mjs --solo-reglas    sin modelo y sin red
//   node scripts/banco-nombres/banco.mjs --candidato bert-small-pii
//   node scripts/banco-nombres/banco.mjs --json informe.json
//
// Dos corpus, y la diferencia entre ellos es la que importa:
//
//   · corpus.mjs            el de trabajo. Contra él se han afinado las reglas y la guardia, así
//                           que sus números son un TECHO, no una medida de campo.
//   · corpus-validacion.mjs escrito DESPUÉS de cerrar las reglas y sin volver a tocarlas. Es el
//                           número honesto. Si cae mucho respecto al de trabajo, es que las reglas
//                           están aprendidas de memoria y no generalizan.
//
// Lo que se mide:
//
//   1. Cobertura de lo que HAY QUE TAPAR, por tipo y por clase de fragmento (el escaneo en
//      MAYÚSCULAS aparte: promediarlo con el texto nativo esconde el problema).
//   2. Sobre-tapado de lo que NUNCA se tapa, con la guardia y sin ella.
//   3. Reparto por capas: cuánto trabajo hace cada una, y cuánto queda para el modelo, que es la
//      única cara.
//   4. Ida y vuelta: anonimizar y revertir tiene que devolver el texto ORIGINAL, carácter a
//      carácter. Es la prueba que dice si el camino de vuelta funciona de verdad.
//   5. Peso y latencia por respuesta de 60 fragmentos, que es el techo real de obtener_documento.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import CORPUS from './corpus.mjs';
import VALIDACION from './corpus-validacion.mjs';
import CIEGO from './corpus-ciego.mjs';
import CIEGO2 from './corpus-ciego-2.mjs';
import CIEGO3 from './corpus-ciego-3.mjs';
import CANDIDATOS from './candidatos.mjs';
import { Anonimizador, TablaAlias } from './anonimizador/index.mjs';
import { regionesIntocables } from './anonimizador/intocables.mjs';
import { reconocerLote, plegar } from './anonimizador/ner.mjs';
import { variantesDe } from './anonimizador/alias.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CACHE_MODELOS = path.join(AQUI, '.modelos');

const SE_TAPA = new Set(['PERSONA', 'PERITO', 'AGENTE', 'DIRECCION', 'CAT_ESPECIAL', 'DATO_PENAL',
  'DNI', 'NIE', 'CIF', 'IBAN', 'TELEFONO', 'CORREO', 'MATRICULA', 'NUSS']);
const PERSONAS = new Set(['PERSONA', 'PERITO', 'AGENTE']);
const INTOCABLES = new Set(['ORGANO', 'AUTOS', 'ECLI', 'ROJ', 'NORMA', 'ORGANISMO', 'PONENTE', 'LAJ', 'TIP',
  // El dato sensible que es el objeto del escrito (criterio de fondo de Juan, 26-sep): se mide como
  // lo que NUNCA se tapa, porque taparlo deja el escrito sin sentido.
  'OBJETO']);

// El tipo del oro y el que pone el anonimizador no siempre se llaman igual: un perito y un agente
// se tapan como PERSONA, porque para el alias son una persona más.
const EQUIVALE = { PERITO: 'PERSONA', AGENTE: 'PERSONA' };
const equiv = (t) => EQUIVALE[t] ?? t;

// ───────────────────────────── Carga del oro ─────────────────────────────

export function cargar(corpus) {
  const fuera = [];
  for (const frag of corpus) {
    const spans = [];
    const ocupado = new Array(frag.texto.length).fill(false);
    const anotaciones = [...frag.oro].sort((a, b) => b[1].length - a[1].length);
    for (const [tipo, literal, sub] of anotaciones) {
      let desde = 0;
      let hallado = 0;
      for (;;) {
        const i = frag.texto.indexOf(literal, desde);
        if (i < 0) break;
        desde = i + 1;
        const fin = i + literal.length;
        let libre = true;
        for (let k = i; k < fin; k++) if (ocupado[k]) { libre = false; break; }
        if (!libre) continue;
        for (let k = i; k < fin; k++) ocupado[k] = true;
        spans.push({ tipo, valor: literal, inicio: i, fin, ...(sub ? { sub } : {}) });
        hallado++;
      }
      // Una errata en el corpus se contaría como un fallo del anonimizador. Mejor reventar.
      if (hallado === 0 && !frag.texto.includes(literal)) {
        throw new Error(`[${frag.id}] anotación que no aparece en el texto: ${JSON.stringify(literal)}`);
      }
    }
    fuera.push({ ...frag, spans: spans.sort((a, b) => a.inicio - b.inicio) });
  }
  return fuera;
}

const solapa = (a, b) => a.inicio < b.fin && b.inicio < a.fin;

// Sustituye en `texto` cada forma conocida de una persona por la forma canónica de la tabla.
// En UNA sola pasada y con las variantes más largas primero: hacerlo variante a variante encadena
// las sustituciones («Juan» → «Juan Pérez Gómez» → «Juan Pérez Gómez Pérez Gómez») y el
// comparador acaba inventándose corrupciones que no existen.
function canonizar(texto, tabla, exp) {
  const pares = [];
  for (const { valor, tipo } of tabla.volcar(exp)) {
    if (tipo !== 'PERSONA') continue;
    for (const v of variantesDe(valor)) if (v.length >= 4) pares.push({ v, valor });
  }
  if (!pares.length) return texto;
  pares.sort((a, b) => b.v.length - a.v.length);
  const escapar = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${pares.map((p) => escapar(p.v)).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  const porForma = new Map(pares.map((p) => [p.v, p.valor]));
  return texto.replace(re, (m) => porForma.get(m) ?? m);
}
function esperadoALaVuelta(texto, detecciones, tabla, exp) {
  let fuera = '';
  let cursor = 0;
  for (const d of detecciones) {
    fuera += texto.slice(cursor, d.inicio);
    fuera += tabla.valorDe(exp, tabla.alias(exp, d.tipo, d.valor)) ?? d.valor;
    cursor = d.fin;
  }
  return fuera + texto.slice(cursor);
}

// Cubierto de verdad = lo tapado se come al menos el 60 % de lo anotado. Sin umbral, marcar la
// coma de «Pérez, Juan» contaría como haber tapado el nombre.
//
// Se mide por UNIÓN de todo lo que se tapa ahí, no detección a detección: un dato largo puede
// quedar cubierto por dos trozos («trastorno de ansiedad generalizada» + «sertralina») y ninguno
// llega al 60 % por separado, pero entre los dos no dejan nada fuera. Midiéndolo de uno en uno
// salían como fallos dos datos que sí estaban tapados.
//
// Y en PERSONAS no vale el 60 %: vale que no quede NINGUNA palabra del nombre en claro. Con el
// umbral, «Daniel Zamarreño Alcaine» contaba como tapado cuando salía «Daniel [PERSONA_1]
// [PERSONA_2]»: el nombre de pila del niño en claro, y el banco diciendo que estaba bien.
const PALABRA_VACIA = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'i', 'con', 'en', 'a', 'al', 'da', 'dos']);

function cubierto(dets, o, { estricto = false } = {}) {
  const largo = o.fin - o.inicio;
  if (largo <= 0) return false;
  const marcado = new Array(largo).fill(false);
  for (const d of dets) {
    const i = Math.max(d.inicio, o.inicio);
    const f = Math.min(d.fin, o.fin);
    for (let k = i; k < f; k++) marcado[k - o.inicio] = true;
  }
  if (!estricto) return marcado.filter(Boolean).length >= 0.6 * largo;
  for (const m of o.valor.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (PALABRA_VACIA.has(m[0].toLowerCase())) continue;
    for (let k = m.index; k < m.index + m[0].length; k++) if (!marcado[k]) return false;
  }
  return true;
}

// ¿Son dos menciones de la misma persona? Una es variante de la otra («Pérez Gómez» de «Juan
// Pérez Gómez»). El oro no dice quién es quién, así que esto es lo que decide si dos menciones con
// el mismo alias son una persona (bien) o dos fundidas en una (mal).
// «NKEMELU TABE, EMMANUEL» es «Emmanuel Nkemelu Tabe» dicho como en una lista.
const derecho = (x) => (/^[^,]+,\s*[^,]+$/.test(x.trim()) ? x.trim().replace(/^([^,]+),\s*(.+)$/, '$2 $1') : x);
const mismaPersona = (a0, b0) => {
  const a = derecho(a0);
  const b = derecho(b0);
  const na = plegar(a).trim();
  const nb = plegar(b).trim();
  return na === nb || variantesDe(a).some((v) => plegar(v) === nb) || variantesDe(b).some((v) => plegar(v) === na);
};

// ───────────────────────────── La medida ─────────────────────────────

export async function medir(corpus, { anonimizador, candidato = null }) {
  const porTipo = new Map();
  const porSub = new Map();
  const porClase = new Map();
  const porCapa = new Map();
  const escapadas = [];
  let intocablesOro = 0;
  let sobreBruto = 0;
  let sobreConGuardia = 0;
  const ejemplosSobre = [];
  let perifrasisOro = 0;
  let perifrasisCogidas = 0;
  let ivOK = 0;
  let ivKO = 0;
  let ivCanonico = 0;
  const fallosIV = [];
  const latencias = [];

  // Por expediente y en orden: así la propagación hace lo que haría en producción.
  const grupos = new Map();
  for (const frag of corpus) {
    const exp = frag.expediente ?? `solo:${frag.id}`;
    if (!grupos.has(exp)) grupos.set(exp, []);
    grupos.get(exp).push(frag);
  }

  const fusiones = [];
  const deMas = [];
  let caracteresLibres = 0;
  let caracteresDeMas = 0;
  for (const [exp, frags] of grupos) {
    const aliasDelOro = new Map();
    const textos = frags.map((f) => f.texto);
    // Como en producción: la pasada previa por la «respuesta». En los corpus, la respuesta son los
    // fragmentos del expediente; en los expedientes de verdad (medir-expedientes.mjs) cada fragmento
    // dice a qué respuesta de 60 pertenece, y se prepara cada una justo antes de tapar la suya.
    const porRespuesta = frags.some((f) => f.respuesta != null);
    if (!porRespuesta) anonimizador.prepararRespuesta(textos, { expediente: exp });
    const preparadas = new Set();
    let marcas = textos.map(() => []);
    if (anonimizador.reconocedor) {
      const t0 = performance.now();
      marcas = await reconocerLote(anonimizador.reconocedor, textos, anonimizador.traducirEtiqueta);
      latencias.push({ ms: performance.now() - t0, n: textos.length });
    }

    for (let i = 0; i < frags.length; i++) {
      const frag = frags[i];
      if (porRespuesta && !preparadas.has(frag.respuesta)) {
        preparadas.add(frag.respuesta);
        anonimizador.prepararRespuesta(frags.filter((f) => f.respuesta === frag.respuesta).map((f) => f.texto), { expediente: exp });
      }
      // Sin guardia: para poder decir cuánto sobre-tapado EVITA la guardia, que es la medida de
      // por qué la guardia no es un adorno.
      const regiones = regionesIntocables(frag.texto);
      const sinGuardia = anonimizador.detectarCrudo(frag.texto, { expediente: exp, marcasModelo: marcas[i] ?? [] });
      const { detecciones } = anonimizador.detectar(frag.texto, { expediente: exp, marcasModelo: marcas[i] ?? [] });
      void regiones;

      for (const s of frag.spans) {
        if (SE_TAPA.has(s.tipo)) {
          const t = equiv(s.tipo);
          const r = porTipo.get(t) ?? { oro: 0, cubiertas: 0 };
          r.oro++;
          const mismas = detecciones.filter((d) => equiv(d.tipo) === t && solapa(d, s));
          const hit = cubierto(mismas, s, { estricto: PERSONAS.has(s.tipo) }) ? mismas[0] : null;
          if (hit && PERSONAS.has(s.tipo) && !(frag.ambiguo ?? []).includes(s.valor)) {
            const alias = anonimizador.tabla.alias(exp, 'PERSONA', hit.valor);
            if (!aliasDelOro.has(alias)) aliasDelOro.set(alias, new Set());
            aliasDelOro.get(alias).add(s.valor);
          }
          if (hit) {
            r.cubiertas++;
            const capa = String(hit.via ?? 'modelo').split(':')[0];
            porCapa.set(capa, (porCapa.get(capa) ?? 0) + 1);
          } else {
            escapadas.push({ frag: frag.id, clase: frag.clase, tipo: s.tipo, valor: s.valor, ...(s.sub ? { sub: s.sub } : {}) });
          }
          porTipo.set(t, r);
          if (s.sub) {
            const q = porSub.get(s.sub) ?? { oro: 0, cubiertas: 0 };
            q.oro++;
            if (hit) q.cubiertas++;
            porSub.set(s.sub, q);
          }
          if (PERSONAS.has(s.tipo)) {
            const c = porClase.get(frag.clase) ?? { oro: 0, cubiertas: 0 };
            c.oro++;
            if (hit) c.cubiertas++;
            porClase.set(frag.clase, c);
          }
        } else if (INTOCABLES.has(s.tipo)) {
          intocablesOro++;
          if (sinGuardia.some((d) => solapa(d, s))) sobreBruto++;
          if (detecciones.some((d) => solapa(d, s))) {
            sobreConGuardia++;
            const por = detecciones.filter((d) => solapa(d, s)).map((d) => `${d.tipo}:${d.via}:${frag.texto.slice(d.inicio, d.fin)}`);
            ejemplosSobre.push({ frag: frag.id, tipo: s.tipo, valor: s.valor, por });
          }
        } else if (s.tipo === 'PERIFRASIS') {
          perifrasisOro++;
          if (detecciones.some((d) => solapa(d, s))) perifrasisCogidas++;
        }
      }

      // Tapado DE MÁS fuera de la lista de intocables: lo que el filtro convierte en alias y no
      // está anotado como nada. Sin esto, una regla que tapara toda palabra con mayúscula daría
      // un 100 % de cobertura y el banco no diría nada.
      for (const d of detecciones) {
        if (!frag.spans.some((s) => solapa(d, s))) deMas.push({ frag: frag.id, tipo: d.tipo, valor: d.valor, via: d.via });
      }
      // Tapado de más en CARACTERES: lo que se tapa fuera de toda anotación, sobre todo el texto que
      // no es ningún dato. Con el tramo sensible (2-oct) un trozo tapado puede pisar un dato y
      // llevarse además media frase: contarlo por detecciones lo escondía.
      {
        const anotado = new Array(frag.texto.length).fill(false);
        for (const sp of frag.spans) for (let k = sp.inicio; k < sp.fin; k++) anotado[k] = true;
        const tapado = new Array(frag.texto.length).fill(false);
        for (const d of detecciones) for (let k = d.inicio; k < d.fin; k++) tapado[k] = true;
        for (let k = 0; k < frag.texto.length; k++) {
          if (anotado[k] || /\s/.test(frag.texto[k])) continue;
          caracteresLibres++;
          if (tapado[k]) caracteresDeMas++;
        }
      }

      // Ida y vuelta.
      let conAlias = '';
      let cursor = 0;
      for (const d of detecciones) {
        conAlias += frag.texto.slice(cursor, d.inicio);
        conAlias += anonimizador.tabla.alias(exp, d.tipo, d.valor);
        cursor = d.fin;
      }
      conAlias += frag.texto.slice(cursor);
      const vuelta = anonimizador.tabla.rehidratar(exp, conAlias);
      if (vuelta === frag.texto) ivOK++;
      // Canonizar = escribir en el texto original la MISMA forma que la tabla usa al revertir. Si
      // tras eso los dos textos coinciden, la diferencia no es una corrupción: es que el nombre
      // vuelve completo o bien escrito. «Urdiales Cotrina» vuelve como «Feliciana Urdiales
      // Cotrina», y «JUAN PEREZ GOMEZ» como «Juan Pérez Gómez». En el borrador que firma el
      // abogado eso es lo que se quiere; contarlo como texto roto escondería los rotos de verdad.
      // El texto esperado a la vuelta: el original con cada trozo TAPADO cambiado por la forma
      // canónica a la que revierte su alias. Canonizar todo el original (como se hacía) contaba
      // como «texto roto» un nombre de pila que simplemente no se había tapado: eso es un escape,
      // y se mide arriba, no aquí.
      else if (plegar(esperadoALaVuelta(frag.texto, detecciones, anonimizador.tabla, exp)) === plegar(vuelta)) {
        // Difiere solo en mayúsculas y tildes: el texto traía el nombre de un escaneo
        // («JUAN PEREZ GOMEZ») y al revertir se escribe la forma buena de la tabla («Juan Pérez
        // Gómez»). No es una pérdida, es lo que se quiere: el borrador que firma el abogado sale
        // con el nombre bien escrito. Se cuenta aparte para no confundirlo con una corrupción.
        ivCanonico++;
      } else {
        ivKO++;
        if (fallosIV.length < 5) {
          let j = 0;
          while (j < frag.texto.length && frag.texto[j] === vuelta[j]) j++;
          fallosIV.push({
            frag: frag.id,
            enPos: j,
            esperado: frag.texto.slice(Math.max(0, j - 30), j + 40),
            obtenido: vuelta.slice(Math.max(0, j - 30), j + 40),
          });
        }
      }
    }
    // Dos personas distintas del oro con el MISMO alias: Claude razona sobre una donde hay dos.
    for (const [alias, valores] of aliasDelOro) {
      const vs = [...valores];
      // Dos menciones son la misma persona si una es variante de la otra, o si las dos lo son del
      // nombre al que revierte el alias («Pilar» y «Bravo» de «Pilar Bravo Soler»).
      const canon = anonimizador.tabla.valorDe(exp, alias);
      const deCanon = (x0) => { const x = derecho(x0); return canon && (plegar(x) === plegar(derecho(canon)) || variantesDe(derecho(canon)).some((v) => plegar(v) === plegar(x)) || variantesDe(canon).some((v) => plegar(v) === plegar(x))); };
      for (let a = 0; a < vs.length; a++) {
        for (let b = a + 1; b < vs.length; b++) {
          if (!mismaPersona(vs[a], vs[b]) && !(deCanon(vs[a]) && deCanon(vs[b]))) fusiones.push({ exp, alias, a: vs[a], b: vs[b] });
        }
      }
    }
  }

  const msTotal = latencias.reduce((a, l) => a + l.ms, 0);
  const nTotal = latencias.reduce((a, l) => a + l.n, 0);
  const msPorFragmento = nTotal ? msTotal / nTotal : 0;

  return {
    pesoMB: candidato?.pesoMB ?? 0,
    porTipo: Object.fromEntries([...porTipo].sort()),
    porSub: Object.fromEntries([...porSub].sort()),
    porClase: Object.fromEntries(porClase),
    porCapa: Object.fromEntries([...porCapa].sort((a, b) => b[1] - a[1])),
    escapadas,
    fusiones,
    deMas,
    caracteres: { libres: caracteresLibres, deMas: caracteresDeMas },
    intocables: { oro: intocablesOro, sobreBruto, sobreConGuardia, ejemplos: ejemplosSobre },
    perifrasis: { oro: perifrasisOro, cogidas: perifrasisCogidas },
    idaVuelta: { ok: ivOK, canonico: ivCanonico, ko: ivKO, fallos: fallosIV },
    latencia: { msPorFragmento, respuesta60Ms: msPorFragmento * 60 },
  };
}

// ───────────────────────────── Informe ─────────────────────────────

const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)} %`);

const ROTULO_CAPA = {
  determinista: 'dígito de control',
  propagacion: 'propagación (gratis)',
  contexto: 'tratamiento y cargo',
  domicilio: 'estructura de domicilio',
  especial: 'categoría especial',
  modelo: 'EL MODELO',
};

export function bloque(r, titulo, L) {
  const p = (s = '') => L.push(s);
  p('');
  p(`   ${titulo}`);
  p(`   ${'─'.repeat(90)}`);
  let oro = 0;
  let cub = 0;
  p(`     ${'tipo'.padEnd(16)}${'en el corpus'.padStart(14)}${'tapados'.padStart(10)}${'cobertura'.padStart(12)}`);
  for (const [tipo, v] of Object.entries(r.porTipo)) {
    oro += v.oro; cub += v.cubiertas;
    p(`     ${tipo.padEnd(16)}${String(v.oro).padStart(14)}${String(v.cubiertas).padStart(10)}${pct(v.cubiertas, v.oro).padStart(12)}${v.cubiertas < v.oro ? '  ←' : ''}`);
  }
  p(`     ${'TOTAL'.padEnd(16)}${String(oro).padStart(14)}${String(cub).padStart(10)}${pct(cub, oro).padStart(12)}`);
  if (r.porSub && Object.keys(r.porSub).length) {
    p('');
    p('     categoría especial, por lo que protege el 9.1:');
    for (const [sub, v] of Object.entries(r.porSub)) {
      p(`       ${sub.padEnd(14)}${String(v.oro).padStart(16)}${String(v.cubiertas).padStart(10)}${pct(v.cubiertas, v.oro).padStart(12)}${v.cubiertas < v.oro ? '  ←' : ''}`);
    }
  }
  p('');
  p('     por clase de fragmento (solo personas):');
  for (const [clase, v] of Object.entries(r.porClase)) {
    const rot = clase === 'ocr' ? 'escaneo MAYÚSCULAS sin tildes' : clase === 'correo' ? 'correo del despacho' : 'texto nativo';
    p(`       ${rot.padEnd(32)}${String(v.cubiertas).padStart(4)}/${String(v.oro).padEnd(4)} ${pct(v.cubiertas, v.oro)}`);
  }
  p('');
  p('     quién tapa qué (reparto por capas):');
  const total = Object.values(r.porCapa).reduce((a, b) => a + b, 0);
  for (const [capa, n] of Object.entries(r.porCapa)) {
    p(`       ${(ROTULO_CAPA[capa] ?? capa).padEnd(32)}${String(n).padStart(4)}   ${pct(n, total)}`);
  }
  p('');
  if (r.escapadas.length) {
    p(`     SE ESCAPAN ${r.escapadas.length}   ← llegarían a Claude tal cual`);
    for (const e of r.escapadas.slice(0, 12)) p(`       · [${e.frag}] ${e.tipo} ${JSON.stringify(e.valor)}`);
    if (r.escapadas.length > 12) p(`       … y ${r.escapadas.length - 12} más`);
  } else {
    p('     SE ESCAPAN 0');
  }
  p('');
  p(`     FUSIONES ${r.fusiones.length}${r.fusiones.length ? '   ← dos personas con el mismo alias' : ''}`);
  for (const f of r.fusiones.slice(0, 8)) p(`       · ${f.alias}: ${JSON.stringify(f.a)} y ${JSON.stringify(f.b)}`);
  p('');
  p(`     TAPADO DE MÁS, sin estar anotado: ${r.deMas.length}  ·  en caracteres: ${pct(r.caracteres.deMas, r.caracteres.libres)} del texto que no es ningún dato`);
  for (const f of r.deMas.slice(0, 12)) p(`       · [${f.frag}] ${f.tipo} ${JSON.stringify(f.valor)} (${f.via})`);
  p('');
  p(`     SOBRE-TAPADO (${r.intocables.oro} cosas que nunca se tapan)`);
  p(`       sin la guardia           ${r.intocables.sobreBruto}   (${pct(r.intocables.sobreBruto, r.intocables.oro)})`);
  p(`       con la guardia           ${r.intocables.sobreConGuardia}   (${pct(r.intocables.sobreConGuardia, r.intocables.oro)})`);
  for (const e of r.intocables.ejemplos.slice(0, 15)) p(`         · [${e.frag}] ${e.tipo} ${JSON.stringify(e.valor)}`);
  p('');
  p('     IDA Y VUELTA (anonimizar → revertir → ¿el texto original?)');
  const ivN = r.idaVuelta.ok + r.idaVuelta.canonico + r.idaVuelta.ko;
  p(`       idénticos                ${r.idaVuelta.ok}/${ivN}`);
  p(`       nombre canonizado        ${r.idaVuelta.canonico}/${ivN}   (vuelve completo o bien escrito: «Urdiales Cotrina» → «Feliciana Urdiales Cotrina»)`);
  p(`       CORROMPIDOS              ${r.idaVuelta.ko}/${ivN}${r.idaVuelta.ko ? '   ← texto roto' : ''}`);
  for (const f of r.idaVuelta.fallos) {
    p(`         ✗ [${f.frag}] difiere en la posición ${f.enPos}`);
    p(`           esperado: …${f.esperado}…`);
    p(`           obtenido: …${f.obtenido}…`);
  }
  p('');
  p(`     TECHO — identificación sin nombre: ${r.perifrasis.cogidas}/${r.perifrasis.oro} perífrasis`);
  if (r.latencia.msPorFragmento) {
    p(`     Latencia  ${r.latencia.msPorFragmento.toFixed(0)} ms/fragmento · ${(r.latencia.respuesta60Ms / 1000).toFixed(1)} s por respuesta de 60`);
  }
}

function imprimir(res) {
  const L = [];
  const p = (s = '') => L.push(s);
  p('═'.repeat(96));
  p('BANCO DE PRUEBAS DEL ANONIMIZADOR — RobinSearch');
  p(`Fecha: ${res.fecha}`);
  p(`Corpus de trabajo:    ${String(res.tamaños.trabajo.frag).padStart(3)} fragmentos · ${res.tamaños.trabajo.spans} anotaciones · ${res.tamaños.trabajo.ocr} escaneos`);
  p(`Corpus de validación: ${String(res.tamaños.validacion.frag).padStart(3)} fragmentos · ${res.tamaños.validacion.spans} anotaciones · ${res.tamaños.validacion.ocr} escaneos`);
  p(`Corpus ciego 1:       ${String(res.tamaños.ciego.frag).padStart(3)} fragmentos · ${res.tamaños.ciego.spans} anotaciones · ${res.tamaños.ciego.ocr} escaneos`);
  p(`Corpus ciego 3:       ${String(res.tamaños.ciego3.frag).padStart(3)} fragmentos · ${res.tamaños.ciego3.spans} anotaciones · ${res.tamaños.ciego3.ocr} escaneos`);
  p(`Corpus ciego 2:       ${String(res.tamaños.ciego2.frag).padStart(3)} fragmentos · ${res.tamaños.ciego2.spans} anotaciones · ${res.tamaños.ciego2.ocr} escaneos`);
  p('');
  p('El corpus de validación se escribió DESPUÉS de cerrar las reglas y no se ha usado para');
  p('afinarlas. Sus números son los honestos; los del corpus de trabajo son un techo.');
  p('═'.repeat(96));

  for (const c of res.corridas) {
    p('');
    p('═'.repeat(96));
    if (c.candidato && !c.candidato.pesoMB) {
      p(`${c.candidato.id.toUpperCase()}   (${c.candidato.modelo})`);
      p(c.candidato.nota);
    } else if (c.candidato) {
      p(`CANDIDATO: ${c.candidato.id}   (${c.candidato.modelo})`);
      p(c.candidato.nota);
      p(`Peso añadido al .mcpb: ${c.candidato.pesoMB.toFixed(1)} MB  →  instalador ${(243 + c.candidato.pesoMB).toFixed(0)} MB (hoy 243 MB)`);
    } else {
      p('SIN MODELO — solo reglas (dígito de control, propagación, tratamiento y cargo,');
      p('domicilios y categoría especial). Dice cuánto se hace sin pagar un MB ni un milisegundo.');
    }
    p('═'.repeat(96));
    bloque(c.trabajo, 'CORPUS DE TRABAJO (techo: las reglas se afinaron aquí)', L);
    if (c.validacion) bloque(c.validacion, 'CORPUS DE VALIDACIÓN', L);
    if (c.ciego) bloque(c.ciego, 'CORPUS CIEGO 1 (escrito sin ver las reglas, 29-sep; ya afinado contra él)', L);
    if (c.ciego2) bloque(c.ciego2, 'CORPUS CIEGO 2 (sin ver reglas ni corpus; ya afinado contra él)', L);
    if (c.ciego3) bloque(c.ciego3, 'CORPUS CIEGO 3 (escrito después de cerrar el 2: el número honesto)', L);
  }

  p('');
  p('═'.repeat(96));
  p('RESUMEN — sobre el corpus CIEGO 3');
  p('═'.repeat(96));
  p(`   ${'configuración'.padEnd(24)}${'peso'.padStart(8)}${'instal.'.padStart(9)}${'60 frag.'.padStart(10)}${'tapa'.padStart(9)}${'escaneo'.padStart(10)}${'escapan'.padStart(9)}${'sobre-tapa'.padStart(12)}${'ida/vuelta'.padStart(12)}`);
  for (const c of res.corridas) {
    const r = c.ciego3 ?? c.ciego2 ?? c.ciego ?? c.validacion ?? c.trabajo;
    const oro = Object.values(r.porTipo).reduce((a, v) => a + v.oro, 0);
    const cub = Object.values(r.porTipo).reduce((a, v) => a + v.cubiertas, 0);
    const ocr = r.porClase.ocr;
    p(
      `   ${(c.candidato?.id ?? 'solo reglas').padEnd(24)}` +
        `${((c.candidato?.pesoMB ?? 0).toFixed(0) + ' MB').padStart(8)}` +
        `${((243 + (c.candidato?.pesoMB ?? 0)).toFixed(0) + ' MB').padStart(9)}` +
        `${(r.latencia.respuesta60Ms ? `${(r.latencia.respuesta60Ms / 1000).toFixed(1)} s` : '—').padStart(10)}` +
        `${pct(cub, oro).padStart(9)}` +
        `${(ocr ? pct(ocr.cubiertas, ocr.oro) : '—').padStart(10)}` +
        `${String(r.escapadas.length).padStart(9)}` +
        `${pct(r.intocables.sobreConGuardia, r.intocables.oro).padStart(12)}` +
        `${`${r.idaVuelta.ko} rotos`.padStart(12)}`,
    );
  }
  p('');
  return L.join('\n');
}

// ───────────────────────────── Principal ─────────────────────────────

async function principal() {
  const args = process.argv.slice(2);
  const soloReglas = args.includes('--solo-reglas');
  const iJson = args.indexOf('--json');
  const destinoJson = iJson >= 0 ? args[iJson + 1] : null;
  const iCand = args.indexOf('--candidato');
  const filtro = iCand >= 0 ? args[iCand + 1] : null;

  // --como-produccion: el texto tal como lo guarda el indexador. `chunkPages` parte por palabras y
  // las vuelve a unir con UN espacio, así que en producción los saltos de línea no existen. Las
  // reglas que se apoyan en ellos (firma de correo, cabecera «De:», etiqueta de ficha, fin de
  // frase) hay que medirlas también así, o el banco mide un texto que Claude nunca ve.
  const comoProduccion = args.includes('--como-produccion');
  const plano = (x) => x.split(/\s+/).filter(Boolean).join(' ');
  // El oro se aplana igual que el texto: un literal con salto de línea no existe en el texto plano.
  const aplanar = (corpus) => corpus.map((f) => ({ ...f, texto: plano(f.texto), oro: f.oro.map(([t, l]) => [t, plano(l)]), ambiguo: f.ambiguo?.map(plano) }));
  const trabajo = cargar(comoProduccion ? aplanar(CORPUS) : CORPUS);
  const validacion = cargar(comoProduccion ? aplanar(VALIDACION) : VALIDACION);
  // El tercer corpus (29-sep): escrito por otro agente SIN ver las reglas, sobre todo para la
  // lista de intocables y las dudas de categoría especial. Su primera pasada se guardó tal cual
  // salió en informe-ciego-primera-pasada.txt; lo que se arregló después ya no es ciego.
  const ciego = cargar(comoProduccion ? aplanar(CIEGO) : CIEGO);
  // El segundo, escrito por otro agente después de cerrar lo del primero, sin ver ni las reglas ni
  // los otros corpus. Su primera pasada (informe-ciego2-primera-pasada.txt) es el número honesto.
  const ciego2 = cargar(comoProduccion ? aplanar(CIEGO2) : CIEGO2);
  const ciego3 = cargar(comoProduccion ? aplanar(CIEGO3) : CIEGO3);
  const tam = (c) => ({
    frag: c.length,
    spans: c.reduce((a, f) => a + f.spans.length, 0),
    ocr: c.filter((f) => f.clase === 'ocr').length,
  });

  const res = {
    fecha: new Date().toISOString().slice(0, 10),
    tamaños: { trabajo: tam(trabajo), validacion: tam(validacion), ciego: tam(ciego), ciego2: tam(ciego2), ciego3: tam(ciego3) },
    corridas: [],
  };

  res.corridas.push({
    candidato: null,
    trabajo: await medir(trabajo, { anonimizador: new Anonimizador({ tabla: new TablaAlias() }) }),
    validacion: await medir(validacion, { anonimizador: new Anonimizador({ tabla: new TablaAlias() }) }),
    ciego: await medir(ciego, { anonimizador: new Anonimizador({ tabla: new TablaAlias() }) }),
    ciego2: await medir(ciego2, { anonimizador: new Anonimizador({ tabla: new TablaAlias() }) }),
    ciego3: await medir(ciego3, { anonimizador: new Anonimizador({ tabla: new TablaAlias() }) }),
  });
  // La v1 (solo reglas) se mide SIEMPRE también sobre el texto como lo deja el indexador. Es el que
  // llega de verdad al filtro, y el 29-sep destapó dos nombres de un escaneo que con saltos de
  // línea salían tapados y aplanados no.
  if (!comoProduccion) {
    res.corridas.push({
      candidato: { id: 'solo reglas · producción', modelo: 'texto troceado como en el indexador (sin saltos de línea)', nota: 'La v1, sobre el texto que de verdad le llega.', pesoMB: 0 },
      trabajo: await medir(cargar(aplanar(CORPUS)), { anonimizador: new Anonimizador({ tabla: new TablaAlias() }) }),
      validacion: await medir(cargar(aplanar(VALIDACION)), { anonimizador: new Anonimizador({ tabla: new TablaAlias() }) }),
      ciego: await medir(cargar(aplanar(CIEGO)), { anonimizador: new Anonimizador({ tabla: new TablaAlias() }) }),
      ciego2: await medir(cargar(aplanar(CIEGO2)), { anonimizador: new Anonimizador({ tabla: new TablaAlias() }) }),
      ciego3: await medir(cargar(aplanar(CIEGO3)), { anonimizador: new Anonimizador({ tabla: new TablaAlias() }) }),
    });
  }

  if (!soloReglas) {
    const lista = filtro ? CANDIDATOS.filter((c) => c.id === filtro) : CANDIDATOS;
    if (!lista.length) throw new Error(`candidato desconocido: ${filtro}`);
    for (const cand of lista) {
      process.stderr.write(`  · ${cand.id} — cargando…\n`);
      let a1;
      try {
        a1 = await Anonimizador.crear({
          modelo: cand.modelo, traducirEtiqueta: cand.etiqueta, cacheDir: CACHE_MODELOS, tabla: new TablaAlias(),
        });
      } catch (e) {
        process.stderr.write(`    ✗ ${e.message}\n`);
        continue;
      }
      const a2 = new Anonimizador({
        tabla: new TablaAlias(), reconocedor: a1.reconocedor, traducirEtiqueta: cand.etiqueta,
      });
      res.corridas.push({
        candidato: cand,
        trabajo: await medir(trabajo, { anonimizador: a1, candidato: cand }),
        validacion: await medir(validacion, { anonimizador: a2, candidato: cand }),
      });
    }
  }

  process.stdout.write(`${imprimir(res)}\n`);
  if (destinoJson) {
    fs.writeFileSync(destinoJson, `${JSON.stringify(res, null, 2)}\n`);
    process.stderr.write(`\nJSON en ${destinoJson}\n`);
  }
}

// Se importa desde medir-expedientes.mjs (la medida y el informe son los mismos): solo se corre
// el banco cuando se llama a este fichero directamente.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    process.stderr.write(`\n✗ ${e.stack}\n`);
    process.exit(1);
  });
}
