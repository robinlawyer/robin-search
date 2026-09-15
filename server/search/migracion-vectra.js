// Lectura del índice ANTIGUO (vectra, hasta la 1.4.4) SIN cargarlo entero en memoria.
//
// vectra guardaba todo el índice en un único `index.json`: {"version":1,"metadata_config":{},
// "items":[{id, metadata, vector, norm}, …]}, con el texto de cada fragmento dentro. Con un
// expediente grande ese fichero pasa de cientos de MB: leerlo con `readFile` + `JSON.parse`
// (lo que hacía vectra) agota la memoria del proceso — justo el fallo que hay que dejar
// atrás—, así que aquí se recorre en streaming y se entrega item a item.
//
// Tolera un fichero CORTADO (una escritura interrumpida, que vectra no hacía atómica): los
// items completos se entregan y el último, a medias, se descarta y se declara en `info`.

import fs from 'node:fs';

// Máquina de estados sobre el texto del fichero. `alimentar(trozo)` devuelve el texto JSON
// de cada item que se completa dentro de ese trozo (un item puede venir partido entre trozos).
export function crearLector() {
  let fase = 'cabecera'; // 'cabecera' → 'array' → 'fin'
  let cabecera = '';
  let profundidad = 0;
  let enCadena = false;
  let escape = false;
  let piezas = [];

  function alimentar(entrada) {
    const items = [];
    let txt = entrada;
    if (fase === 'cabecera') {
      cabecera += txt;
      const k = cabecera.indexOf('"items"');
      if (k < 0) {
        // Sin rastro de "items" todavía: se conserva solo la cola, por si la clave llega partida.
        if (cabecera.length > 4096) cabecera = cabecera.slice(-16);
        return items;
      }
      const corchete = cabecera.indexOf('[', k);
      if (corchete < 0) return items;
      txt = cabecera.slice(corchete + 1);
      cabecera = '';
      fase = 'array';
    }
    if (fase !== 'array') return items;

    let inicio = profundidad > 0 ? 0 : -1;
    for (let i = 0; i < txt.length; i++) {
      const c = txt.charCodeAt(i);
      if (profundidad === 0) {
        if (c === 123 /* { */) {
          profundidad = 1;
          inicio = i;
          enCadena = false;
          escape = false;
        } else if (c === 93 /* ] */) {
          fase = 'fin';
          break;
        }
        continue;
      }
      if (enCadena) {
        if (escape) escape = false;
        else if (c === 92 /* \ */) escape = true;
        else if (c === 34 /* " */) enCadena = false;
        continue;
      }
      if (c === 34) enCadena = true;
      else if (c === 123 || c === 91) profundidad += 1;
      else if (c === 125 || c === 93) {
        profundidad -= 1;
        if (profundidad === 0) {
          piezas.push(txt.slice(inicio, i + 1));
          items.push(piezas.join(''));
          piezas = [];
          inicio = -1;
        }
      }
    }
    if (profundidad > 0 && inicio >= 0) piezas.push(txt.slice(inicio));
    return items;
  }

  return {
    alimentar,
    get terminado() {
      return fase === 'fin';
    },
    get vistoArray() {
      return fase !== 'cabecera';
    },
  };
}

// Recorre los items de un index.json de vectra. `info` se rellena al terminar:
//   { items, ilegibles, completo }  — completo=false si el fichero estaba cortado.
export async function* itemsVectra(ruta, info = {}) {
  const lector = crearLector();
  info.items = 0;
  info.ilegibles = 0;
  info.completo = false;
  const stream = fs.createReadStream(ruta, { encoding: 'utf8', highWaterMark: 1 << 20 });
  try {
    for await (const trozo of stream) {
      for (const texto of lector.alimentar(trozo)) {
        let item;
        try {
          item = JSON.parse(texto);
        } catch {
          info.ilegibles += 1;
          continue;
        }
        info.items += 1;
        yield item;
      }
      if (lector.terminado) break;
    }
  } finally {
    stream.destroy();
  }
  info.completo = lector.terminado;
  info.sinArray = !lector.vistoArray;
}

export default { crearLector, itemsVectra };
