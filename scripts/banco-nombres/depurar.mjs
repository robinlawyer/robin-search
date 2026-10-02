// Depuración: qué detecta el filtro en un fragmento concreto de un volcado de medir-expedientes,
// con la tabla del expediente en el mismo estado que en la medición (se pasa antes por los
// fragmentos anteriores del mismo expediente).
//   node depurar.mjs expedientes/ronda-1.frags.json "<id del fragmento>" [texto a buscar]
import fs from 'node:fs';
import { Anonimizador, TablaAlias } from './anonimizador/index.mjs';
const [, , volcado, id, aguja] = process.argv;
const { frags } = JSON.parse(fs.readFileSync(volcado, 'utf8'));
const obj = frags.find((f) => f.id === id);
if (!obj) { console.log('no existe'); process.exit(1); }
const a = new Anonimizador({ tabla: new TablaAlias() });
const preparadas = new Set();
for (const f of frags.filter((x) => x.expediente === obj.expediente)) {
  if (!preparadas.has(f.respuesta)) {
    preparadas.add(f.respuesta);
    a.prepararRespuesta(frags.filter((x) => x.respuesta === f.respuesta).map((x) => x.texto), { expediente: f.expediente });
  }
  const { detecciones, regiones } = a.detectar(f.texto, { expediente: f.expediente });
  if (f.id !== id) continue;
  const t = f.texto;
  let i0 = 0, i1 = t.length;
  if (aguja) { const k = t.indexOf(aguja); i0 = Math.max(0, k - 150); i1 = Math.min(t.length, k + aguja.length + 150); }
  console.log('TEXTO:', t.slice(i0, i1));
  for (const r of regiones ?? []) if (r.fin > i0 && r.inicio < i1) console.log('  GUARDA', r.clase, JSON.stringify(t.slice(r.inicio, r.fin)));
  for (const d of detecciones) if (d.fin > i0 && d.inicio < i1) console.log('  TAPA', d.tipo, d.via, JSON.stringify(t.slice(d.inicio, d.fin)));
  for (const o of f.oro) if (!aguja || o[1].includes(aguja) || aguja.includes(o[1])) console.log('  ORO', o.join(' | '));
}
