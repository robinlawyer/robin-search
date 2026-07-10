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

// --- Parche 2: quitar el import ESTÁTICO de `sharp` (binario nativo) en transformers.
// `sharp` solo se usa para procesar IMÁGENES; Robin Search es texto (PDF/DOCX). El import
// estático carga el .node al importar transformers y Claude Desktop lo bloquea (Team ID).
const imageJs = path.join(root, 'node_modules', '@xenova', 'transformers', 'src', 'utils', 'image.js');
if (fs.existsSync(imageJs)) {
  let img = fs.readFileSync(imageJs, 'utf8');
  let imgChanged = false;
  if (img.includes("import sharp from 'sharp';")) {
    img = img.replace(
      "import sharp from 'sharp';",
      "const sharp = null; // [ROBIN] sin sharp: nativo bloqueado por Claude Desktop; solo texto",
    );
    imgChanged = true;
  }
  // Sin sharp, image.js lanzaba "Unable to load image processing library" AL CARGAR (rompía el
  // embedding de texto). Lo hacemos perezoso: solo falla si de verdad se procesa una imagen.
  if (img.includes("throw new Error('Unable to load image processing library.');")) {
    img = img.replace(
      "throw new Error('Unable to load image processing library.');",
      "loadImageFunction = async () => { throw new Error('[ROBIN] Robin Search solo procesa texto (imágenes no soportadas).'); };",
    );
    imgChanged = true;
  }
  if (imgChanged) {
    fs.writeFileSync(imageJs, img);
    console.log('patch-wasm: sharp + throw de imagen neutralizados en image.js.');
  } else if (!img.includes('[ROBIN]')) {
    console.error('patch-wasm: image.js no coincide con lo esperado — revisar versión.');
    process.exit(1);
  }
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
