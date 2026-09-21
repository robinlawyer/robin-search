// El tiempo restante del indexado: que se estime por TRABAJO (fragmentos) y no por bytes.
//
// El caso que lo motiva (21-sep-2026): un lote con .docx (ZIP: muchos bytes, poco texto) y .txt
// (texto puro). Estimando por bytes, la parte de .txt que falta parece un suspiro y no lo es.
import assert from 'node:assert';
import { nuevaEta } from '../server/indexer/indexer.js';

let hechas = 0; const casos = [];
const prueba = (n, f) => casos.push([n, f]);
const reloj = () => { let t = 0; return { ahora: () => t, avanzar: (s) => { t += s * 1000; } }; };

prueba('no se inventa un número sin muestra: ni con pocos ficheros ni en los primeros segundos', () => {
  const r = reloj();
  const eta = nuevaEta(1000, new Map([['.txt', 1000]]), r.ahora);
  eta.hecho(100, 5, '.txt'); r.avanzar(30);
  assert.deepEqual(eta.estimar(), {}, 'con 1 fichero no se estima');
  eta.hecho(100, 5, '.txt'); eta.hecho(100, 5, '.txt');
  assert.ok(eta.estimar().eta_segundos > 0, 'con 3 ficheros y 30 s, sí');
});

prueba('el ritmo se mide en fragmentos por segundo', () => {
  const r = reloj();
  // 1000 bytes pendientes, 100 fragmentos en total a 2 fragmentos/s = 50 s.
  const eta = nuevaEta(1000, new Map([['.txt', 1000]]), r.ahora);
  r.avanzar(10);
  for (let i = 0; i < 4; i++) eta.hecho(50, 5, '.txt');   // 200 bytes, 20 fragmentos en 10 s
  const { eta_segundos } = eta.estimar();
  // Quedan 800 bytes de .txt a 0,1 fragmentos/byte = 80 fragmentos, a 2/s → 40 s.
  assert.ok(Math.abs(eta_segundos - 40) <= 2, `esperaba ~40 s y dio ${eta_segundos}`);
});

prueba('🔴 lo que fallaba: .docx pesados terminados primero no hacen creer que el resto vuela', () => {
  const r = reloj();
  // 10 .docx de 40 KB (2 fragmentos cada uno) y 10 .txt de 4 KB (2 fragmentos cada uno).
  // Mismo trabajo en las dos mitades; en BYTES, los .txt parecen el 9 % del total.
  const pendientes = new Map([['.docx', 400_000], ['.txt', 40_000]]);
  const eta = nuevaEta(440_000, pendientes, r.ahora);
  r.avanzar(20);
  for (let i = 0; i < 10; i++) eta.hecho(40_000, 2, '.docx');   // los 10 .docx, 20 fragmentos en 20 s
  const { eta_segundos } = eta.estimar();
  // Queda el mismo trabajo que ya se ha hecho (20 fragmentos a 1/s) → ~20 s.
  assert.ok(Math.abs(eta_segundos - 20) <= 3, `esperaba ~20 s y dio ${eta_segundos}`);
  // Por bytes habría dicho 2 s: es justo el error de «8 minutos» cuando eran cuarenta.
});

prueba('un documento reutilizado no cuenta como trabajo', () => {
  const r = reloj();
  const eta = nuevaEta(1000, new Map([['.pdf', 1000]]), r.ahora);
  r.avanzar(10);
  eta.hecho(100, 0, '.pdf'); eta.hecho(100, 0, '.pdf'); eta.hecho(100, 10, '.pdf');
  const { eta_segundos } = eta.estimar();
  // 10 fragmentos en 10 s = 1/s; quedan 700 bytes a 10/300 por byte ≈ 23 fragmentos ≈ 23 s.
  assert.ok(eta_segundos > 15 && eta_segundos < 32, `esperaba ~23 s y dio ${eta_segundos}`);
});

prueba('sin ningún fragmento (todo reutilizado) se cae al cálculo por bytes, no se calla', () => {
  const r = reloj();
  const eta = nuevaEta(1000, new Map([['.pdf', 1000]]), r.ahora);
  r.avanzar(10);
  eta.hecho(100, 0, '.pdf'); eta.hecho(100, 0, '.pdf'); eta.hecho(100, 0, '.pdf');
  const { eta_segundos } = eta.estimar();
  assert.ok(Math.abs(eta_segundos - 23) <= 2, `esperaba ~23 s y dio ${eta_segundos}`);
});

prueba('un formato aún sin catar se estima por la densidad de su tabla, no por bytes a pelo', () => {
  const r = reloj();
  const eta = nuevaEta(2000, new Map([['.txt', 1000], ['.rtf', 1000]]), r.ahora);
  r.avanzar(10);
  for (let i = 0; i < 5; i++) eta.hecho(200, 4, '.txt');   // 1000 bytes .txt, 20 fragmentos: 2/s
  const { eta_segundos } = eta.estimar();
  // Quedan 1000 bytes de .rtf. Un .rtf lleva dentro ~0,3 bytes de texto por byte de fichero
  // (tabla TEXTO_POR_BYTE), así que son ~6 fragmentos, no 20: a 2/s, unos 3 segundos.
  assert.ok(Math.abs(eta_segundos - 3) <= 2, `esperaba ~3 s y dio ${eta_segundos}`);
});

prueba('y en cuanto termina uno de ese formato, manda lo MEDIDO y no la tabla', () => {
  const r = reloj();
  const eta = nuevaEta(2000, new Map([['.txt', 1000], ['.rtf', 1000]]), r.ahora);
  r.avanzar(10);
  for (let i = 0; i < 4; i++) eta.hecho(200, 4, '.txt');   // 800 bytes .txt, 16 fragmentos
  // Un .rtf de verdad resulta ser denso: 200 bytes dieron 8 fragmentos (0,04/byte).
  eta.hecho(200, 8, '.rtf');
  const { eta_segundos } = eta.estimar();
  // Quedan 200 de .txt (4 fragmentos) y 800 de .rtf medidos a 0,04 = 32; 36 en total,
  // a 2,4 fragmentos/s ≈ 15 s. Con la tabla habrían salido menos de la mitad.
  assert.ok(eta_segundos > 11 && eta_segundos < 20, `esperaba ~15 s y dio ${eta_segundos}`);
});

let fallos = 0;
for (const [n, f] of casos) {
  try { f(); hechas += 1; console.log(`  ✓ ${n}`); }
  catch (e) { fallos += 1; console.log(`  ✗ ${n}\n      ${e.message}`); }
}
console.log(`\n${hechas}/${casos.length} pruebas del tiempo restante pasadas`);
process.exit(fallos ? 1 : 0);
