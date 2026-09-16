// Utilidades compartidas por las herramientas MCP.

import { rutas } from '../rutas.js';

// Empaqueta un resultado estructurado como respuesta MCP. Incluye tanto texto legible por
// el LLM como el objeto estructurado (structuredContent) para clientes que lo aprovechen.
export function ok(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

export function fail(mensaje, extra = {}) {
  const data = { error: mensaje, ...extra };
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    isError: true,
  };
}

// Normaliza el separador de rutas para comparar prefijos de subcarpeta de forma portable.
// Sin distinguir mayúsculas (Windows/macOS) ni forma Unicode NFC/NFD.
export function matchesFolder(rutaRelativa, carpetaFiltro) {
  return rutas.bajoPrefijoLogico(rutaRelativa, carpetaFiltro);
}
