// Que el pool de embedding CREZCA cuando hay trabajo.
//
// El caso real (21-sep-2026, Mac de Alonso): 521 documentos indexándose con un solo hilo durante
// más de media hora, cabiendo dos. `repartir()` entregaba el lote y lo sacaba de la cola antes de
// que `ampliar()` mirase si había cola; con un hilo, el indexador manda los documentos de uno en
// uno, así que la cola estaba siempre vacía y el pool no crecía jamás.
import assert from 'node:assert';
import { hayDemanda } from '../server/embedder/pool.js';

const casos = [];
const prueba = (n, f) => casos.push([n, f]);
const hilo = (ocupado) => ({ lote: ocupado ? { textos: [] } : null });

prueba('con lotes esperando en la cola, hace falta otro hilo', () => {
  assert.equal(hayDemanda({ cola: 3, hilos: [hilo(true)] }), true);
});

prueba('🔴 el caso que fallaba: cola vacía pero el único hilo ocupado', () => {
  // Justo después de repartir: la cola está vacía porque el lote ya se ha entregado.
  assert.equal(hayDemanda({ cola: 0, hilos: [hilo(true)] }), true);
});

prueba('con un hilo libre no hace falta otro: el trabajo ya tiene dónde ir', () => {
  assert.equal(hayDemanda({ cola: 0, hilos: [hilo(true), hilo(false)] }), false);
});

prueba('sin trabajo y sin hilos ocupados, no se amplía (la instancia que solo busca)', () => {
  assert.equal(hayDemanda({ cola: 0, hilos: [hilo(false)] }), false);
  assert.equal(hayDemanda({ cola: 0, hilos: [] }), false);
});

let fallos = 0;
for (const [n, f] of casos) {
  try { f(); console.log(`  ✓ ${n}`); } catch (e) { fallos += 1; console.log(`  ✗ ${n}\n      ${e.message}`); }
}
console.log(`\n${casos.length - fallos}/${casos.length} pruebas del pool pasadas`);
process.exit(fallos ? 1 : 0);
