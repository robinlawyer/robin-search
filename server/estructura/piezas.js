// Qué texto del DESPACHO lleva cada respuesta de las herramientas de estructura, y de dónde sale.
//
// Condición de Juan (1-oct-2026): todo texto que devuelvan las herramientas nuevas pasa por el mismo
// punto de respuesta y por el filtro del anonimizador. Los índices muestran rótulos como «Anexo II,
// D. fulano», así que llevan nombres. Medido con los expedientes del anonimizador (5-oct): un título
// o una sección corta, analizados sueltos, se tapan peor que el mismo texto dentro de su documento
// («PRUEBAS COMPLEMENTARIAS / Coombs indirecto negativo» no parece un informe clínico si llega
// solo). Por eso cada respuesta deja apuntado aquí, en memoria y en local, qué trozos del documento
// lleva y en qué posición: el filtro, en el punto de respuesta (server/index.js), analiza el
// documento entero una vez (Anonimizador#anonimizarPiezas, con caché) y sustituye dentro de cada
// pieza. Nada de esto viaja: la respuesta que sale es la misma, y este registro no se serializa.
//
//   registrar(resultado, documento)  — documento: { docId, clave, texto, piezas: [{ valor, inicio, fin, plano? }] }
//   piezasDe(resultado)              — lo registrado para esa respuesta (o [])

const _registro = new WeakMap();

export function registrar(resultado, documento) {
  if (!resultado || !documento?.piezas?.length) return resultado;
  const lista = _registro.get(resultado) ?? [];
  lista.push(documento);
  _registro.set(resultado, lista);
  return resultado;
}

export function piezasDe(resultado) {
  return _registro.get(resultado) ?? [];
}

// Una pieza a partir de un texto que la herramienta ha sacado del documento (un título que puede
// venir unido de dos renglones, un arranque recortado con «…»): se localiza en el documento desde
// `desde`, admitiendo cualquier blanco donde el texto tenga un espacio.
export function localizar(texto, valor, desde = 0) {
  const limpio = String(valor || '').replace(/…$/, '').trim();
  if (!limpio) return null;
  const directo = texto.indexOf(limpio, desde);
  if (directo >= 0) return { valor: limpio, inicio: directo, fin: directo + limpio.length };
  const re = new RegExp(limpio.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');
  re.lastIndex = desde;
  const m = re.exec(texto);
  return m ? { valor: limpio, inicio: m.index, fin: m.index + m[0].length, plano: true } : null;
}

export default { registrar, piezasDe, localizar };
