// ESCENARIO (caso real de Eduardo, 4-nov-2026): PDFs de un proyecto de obra cuya fuente no trae
// tabla de caracteres. pdfjs devolvía el número de glifo (orden estándar de Apple) en vez de la
// letra: «de las tierras» salía «GH ODV WLHUUDV», la «á» salía «i». Ese texto no se encontraba al
// buscar, y un nombre metido en él no lo veía el anonimizador, aunque cualquiera lo descifra.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const results = []; const check = (n, c, d = '') => { results.push(Boolean(c)); console.log(`${c ? '  OK  ' : ' FALLO'}  ${n}${d ? ` — ${d}` : ''}`); };
const { descifrarGlifos, descifrarItemsPorFuente } = await import(path.join(REPO, 'server/indexer/glifos.js'));

const cifrar = (s) => [...s].map((c) => (c === ' ' ? ' ' : String.fromCharCode(c.charCodeAt(0) - 29))).join('');
const frase = 'Excavacion de las tierras para la cimentacion con medios mecanicos hasta la cota de proyecto';
check('el texto con número de glifo se descifra', descifrarGlifos(cifrar(frase)) === frase, descifrarGlifos(cifrar(frase)));
check('las vocales con tilde del orden de Apple (á=105, ó=121, ú=126)', descifrarGlifos('PHFiQLFRV VHJ~Q FLyQ') === 'mecánicos según ción');
const items = [
  { str: cifrar(frase), fontName: 'F1' },
  { str: cifrar('El contratista Juan Garcia aporta la factura de la obra'), fontName: 'F1' },
  { str: 'Juzgado de lo Social n.º 3 de Valencia', fontName: 'F2' },
  { str: 'ACERO B500 S', fontName: 'F3' },
];
const salida = descifrarItemsPorFuente(items).map((i) => i.str);
check('solo se descifra la fuente cifrada', salida[0] === frase && salida[1].includes('Juan Garcia'), salida[1]);
check('las fuentes normales no se tocan', salida[2] === items[2].str && salida[3] === items[3].str);
check('sin fuentes cifradas devuelve los mismos objetos', descifrarItemsPorFuente(items.slice(2)) !== null && descifrarItemsPorFuente(items.slice(2))[0] === items[2]);

const bien = results.filter(Boolean).length;
console.log(`\n${bien}/${results.length} comprobaciones superadas`);
process.exit(bien === results.length ? 0 : 1);
