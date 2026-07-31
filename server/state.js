// Estado de ejecución en memoria del servidor. Lo consulta `estado_servidor` y lo
// actualizan indexador y watcher. No persiste contenido documental.

export const state = {
  estado: 'activo', // 'activo' | 'indexando' | 'error'
  ultimoError: null,
  progreso: null, // { procesados, total, ficheroActual } durante un indexado
  // Set de rutas relativas de ficheros sin texto legible extraíble: PDFs escaneados o
  // imágenes de los que el OCR no obtuvo texto (o con OCR desactivado) (RF-03.4).
  ficherosSinOcr: new Set(),
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
