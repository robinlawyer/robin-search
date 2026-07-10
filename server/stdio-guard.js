// GUARDA DE STDOUT — importar LO PRIMERO en el servidor MCP.
//
// En el transporte MCP por stdio, `stdout` es EXCLUSIVO para los mensajes JSON-RPC. Cualquier
// escritura ajena lo corrompe y Claude Desktop muestra "Invalid JSON-RPC message". Varias
// librerías escriben avisos por `console.log` (que va a stdout): p. ej. pdfjs emite
// "Warning: Setting up fake worker." y onnxruntime/transformers imprimen diagnósticos.
//
// Redirigimos toda la consola a stderr (que sí es seguro). NO tocamos `process.stdout.write`,
// que es justo el canal que usa el SDK de MCP para el JSON-RPC.

const toStderr =
  (prefix) =>
  (...args) => {
    try {
      const line = args
        .map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
        .join(' ');
      process.stderr.write(`${prefix}${line}\n`);
    } catch {
      /* nunca romper por un log */
    }
  };

console.log = toStderr('');
console.info = toStderr('');
console.debug = toStderr('');
console.warn = toStderr('');
console.error = toStderr('');

export {};
