// Versión mínima de Node. IMPORTAR LO PRIMERO (server/index.js y cli/index.js).
//
// pdfjs-dist (lector de PDF) exige Node 20: con Node 18 RobinSearch arrancaba y fallaba después,
// fichero a fichero, con errores que no se parecían en nada a la causa. Mejor decirlo claro al
// arrancar. Claude Desktop trae su propio Node (reciente); esto afecta a quien lo lanza con el
// Node del sistema (Claude Code, Cursor, modo IT).
const MINIMA = 20;
const mayor = Number(String(process.versions?.node || '0').split('.')[0]);

if (!(mayor >= MINIMA)) {
  process.stderr.write(
    `robin-search: necesita Node ${MINIMA} o posterior y este es Node ${process.versions?.node}. ` +
      'Actualiza Node (https://nodejs.org) o usa RobinSearch desde Claude Desktop, que trae el suyo.\n',
  );
  process.exit(1);
}

export const NODE_MINIMO = MINIMA;
