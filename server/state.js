// Estado de ejecución en memoria del servidor. Lo consulta `estado_servidor` y lo
// actualizan indexador y watcher. No persiste contenido documental.

export const state = {
  estado: 'activo', // 'activo' | 'indexando' | 'error'
  ultimoError: null,
  progreso: null, // { procesados, total, ficheroActual } durante un indexado
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

export function setIndexando(progreso) {
  state.estado = 'indexando';
  state.progreso = progreso;
}

export function setActivo() {
  state.estado = 'activo';
  state.progreso = null;
}

export function setError(err) {
  state.estado = 'error';
  state.ultimoError = String(err?.message ?? err);
}

export default state;
