// en-disco.js con un documento de índice HEREDADO (sin entrada en el registro): la ruta se
// deduce de su ruta lógica «raíz/…» y un fichero borrado tampoco se sirve (revisión de Codex,
// 13-nov-2026). Uso: ROBIN_FOLDERS=<carpeta> ROBIN_DATA_DIR=<datos> node scripts/test-en-disco-heredado.mjs
import fs from 'node:fs'; import path from 'node:path';
const { rutaEnDisco, retiradoDelDisco, soloEnDisco } = await import('../server/search/en-disco.js');
const raiz = process.env.ROBIN_FOLDERS; const nombre = path.basename(raiz);
const res = []; const check = (n, c, d = '') => { res.push(c); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const meta = { rutaRelativa: `${nombre}/Caso/a.txt` };
check('la ruta se deduce de la ruta lógica', rutaEnDisco('sin-registro', meta) === path.join(raiz, 'Caso', 'a.txt'), rutaEnDisco('sin-registro', meta));
check('fichero presente: se sirve', (await retiradoDelDisco('sin-registro', meta)) === false);
fs.rmSync(path.join(raiz, 'Caso', 'a.txt'));
check('fichero borrado: no se sirve', (await retiradoDelDisco('sin-registro', meta)) === true);
check('sin ruta conocida: no se toca (no es un borrado)', (await retiradoDelDisco('sin-registro', {})) === false);
const r = await soloEnDisco([{ doc_id: 'x', ruta_relativa: `${nombre}/Caso/a.txt` }, { doc_id: 'y' }], 'doc_id', (d) => ({ rutaRelativa: d.ruta_relativa }));
check('soloEnDisco quita solo el borrado', r.items.length === 1 && r.items[0].doc_id === 'y' && r.retirados === 1);
const f = res.filter((x) => !x).length; console.log(`\n${res.length - f}/${res.length} comprobaciones`); process.exit(f ? 1 : 0);
