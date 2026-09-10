// Estado de ejecución en memoria del servidor. Lo consulta `estado_servidor` y lo
// actualizan indexador y watcher. No persiste contenido documental.

export const state = {
  estado: 'activo', // 'activo' | 'indexando' | 'error'
  ultimoError: null,
  progreso: null, // { procesados, total, ficheroActual } durante un indexado
  // Resumen del ÚLTIMO indexado (incluido su recuento de errores y sus causas). Sin esto,
  // un indexado que falla en todos los ficheros era invisible desde `estado_servidor`: el
  // contador de errores vivía solo en el valor de retorno de esa llamada concreta.
  ultimoIndexado: null,
  // Set de rutas relativas de ficheros sin texto legible extraíble: PDFs escaneados o
  // imágenes de los que el OCR no obtuvo texto (o con OCR desactivado) (RF-03.4).
  ficherosSinOcr: new Set(),
  // Expediente activo de la sesión (aislamiento por expediente). El servidor corre por stdio
  // ligado a UNA instancia del cliente (Claude Desktop / Code / Cursor), así que el estado
  // vive a nivel de proceso: no se persiste, y al cerrar el cliente no queda ningún expediente
  // "pegado" de la sesión anterior — que sería justo la fuga que esto evita.
  expedienteActivo: null,
  // Aviso de actualización disponible (rellenado en arranque contra endpoint público).
  actualizacionDisponible: null,
};

// Suscriptores a los cambios de estado. Existe para que el canal de control
// (control.js) pueda avisar a la app de escritorio SIN que state.js dependa de
// él: si state importara control, y control importa state, tendríamos un ciclo.
const avisadores = new Set();

export function alCambiar(fn) {
  avisadores.add(fn);
  return () => avisadores.delete(fn);
}

function avisar() {
  for (const fn of avisadores) {
    try { fn(state); } catch { /* un observador roto jamás rompe el estado */ }
  }
}

export function setIndexando(progreso) {
  // Un indexado en curso no borra un error anterior: si el motor de embedding no cargó, ese
  // error sigue siendo la explicación de lo que está a punto de pasar.
  state.estado = 'indexando';
  state.progreso = progreso;
  avisar();
}

// Fin de una operación. NO limpia `ultimoError`: si algo había fallado (típicamente el motor
// de embedding en el arranque), el estado sigue siendo 'error' hasta que algo salga bien de
// verdad y llame a `clearError()`.
//
// Esto era un fallo real: `bootstrap` marcaba el error de `warmup()` con `setError()` y la
// línea siguiente (`indexFolder`) lo borraba con su `setActivo()` final, aunque los ficheros
// hubieran fallado todos. La causa se autodestruía antes de que nadie pudiera leerla.
export function setActivo() {
  state.progreso = null;
  state.estado = state.ultimoError ? 'error' : 'activo';
  avisar();
}

export function setError(err) {
  state.estado = 'error';
  state.ultimoError = String(err?.message ?? err);
  avisar();
}

// Solo se llama cuando una operación termina BIEN de principio a fin.
export function clearError() {
  state.ultimoError = null;
  if (state.estado === 'error') state.estado = 'activo';
  avisar();
}

// Guarda el resumen del último indexado para que `estado_servidor` pueda contarlo.
export function setUltimoIndexado(resumen) {
  state.ultimoIndexado = resumen ? { ...resumen, fin: new Date().toISOString() } : null;
  avisar();
  return state.ultimoIndexado;
}

export default state;
