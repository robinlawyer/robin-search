// Utilidades compartidas por las herramientas MCP.

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
export function matchesFolder(rutaRelativa, carpetaFiltro) {
  if (!carpetaFiltro) return true;
  const norm = (s) => s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const rel = norm(rutaRelativa);
  const filtro = norm(carpetaFiltro);
  return rel === filtro || rel.startsWith(`${filtro}/`);
}
