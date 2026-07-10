// Parche de build: fuerza a @xenova/transformers a usar onnxruntime-web (WASM puro) también
// en Node, en lugar de onnxruntime-node (binario NATIVO). Claude Desktop ejecuta con
// hardened runtime + library validation: rechaza cargar binarios .node que no lleven su mismo
// Team ID (error "different Team IDs"). WASM no es código nativo → no hay dlopen, ni firma, ni
// validación → funciona dentro de Claude Desktop y es cross-plataforma (el objetivo original).
//
// Idempotente. Se ejecuta antes de empaquetar el .mcpb (y tras `npm install`).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'node_modules', '@xenova', 'transformers', 'src', 'backends', 'onnx.js');

if (!fs.existsSync(target)) {
  console.error('patch-wasm: no encuentro', target, '— ¿has hecho npm install?');
  process.exit(1);
}

let src = fs.readFileSync(target, 'utf8');
let changed = false;

// 1) No importar el binario nativo: aliasar ONNX_NODE a onnxruntime-web.
if (src.includes("import * as ONNX_NODE from 'onnxruntime-node';")) {
  src = src.replace(
    "import * as ONNX_NODE from 'onnxruntime-node';",
    "import * as ONNX_NODE from 'onnxruntime-web'; // [ROBIN] WASM en Node (evita binario nativo bloqueado por Claude Desktop)",
  );
  changed = true;
}

// 2) No anteponer el execution provider 'cpu' (solo existe en onnxruntime-node); dejar 'wasm'.
if (src.includes("executionProviders.unshift('cpu');")) {
  src = src.replace(
    "executionProviders.unshift('cpu');",
    "// [ROBIN] 'cpu' EP no aplica en WASM; se deja 'wasm'.",
  );
  changed = true;
}

if (changed) {
  fs.writeFileSync(target, src);
  console.log('patch-wasm: aplicado (onnxruntime-web / WASM forzado en Node).');
} else if (src.includes("[ROBIN]")) {
  console.log('patch-wasm: ya estaba aplicado.');
} else {
  console.error('patch-wasm: el fichero no coincide con lo esperado — revisar versión de @xenova/transformers.');
  process.exit(1);
}
