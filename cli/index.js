#!/usr/bin/env node
// CLI de Robin Search.
//
//   robin-local                         → arranca el servidor MCP (stdio). Este es el modo
//                                         que usan Claude Desktop (.mcpb), Claude Code y Cursor.
//   robin-local --silent --token=... --folder=...
//                                       → modo IT: indexa la carpeta una vez y sale (0). Sirve
//                                         para pre-cargar el índice en despliegues masivos
//                                         (GPO/JAMF/Intune) sin interacción del usuario.
//
// Los flags --token y --folder rellenan ROBIN_TOKEN y ROBIN_FOLDER. Se procesan ANTES de
// cargar cualquier módulo que lea la configuración (import dinámico) para que surtan efecto.

function parseArgs(argv) {
  const opts = { silent: false, help: false, version: false, _: [] };
  for (const arg of argv) {
    if (arg === '--silent' || arg === '-s') opts.silent = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-v') opts.version = true;
    else if (arg.startsWith('--token=')) opts.token = arg.slice('--token='.length);
    else if (arg.startsWith('--folder=')) opts.folder = arg.slice('--folder='.length);
    else if (arg.startsWith('--data-dir=')) opts.dataDir = arg.slice('--data-dir='.length);
    else if (arg === 'index') opts.silent = true;
    else if (arg === 'serve') opts._.push('serve');
    else opts._.push(arg);
  }
  return opts;
}

const HELP = `Robin Search — servidor MCP local de búsqueda en expedientes.

Uso:
  robin-local [opciones]

Opciones:
  (sin opciones)        Arranca el servidor MCP por stdio (Claude Desktop / Code / Cursor).
  --silent, -s          Modo IT: indexa la carpeta una vez y sale. No arranca el servidor.
  --token=TOKEN         Token Robin Lawyer (equivale a ROBIN_TOKEN).
  --folder=RUTA         Carpeta de expedientes a indexar (equivale a ROBIN_FOLDER).
  --data-dir=RUTA       Directorio de datos (índice/logs). Por defecto, dir de la app del SO.
  --version, -v         Muestra la versión.
  --help, -h            Muestra esta ayuda.

Variables de entorno equivalentes: ROBIN_TOKEN, ROBIN_FOLDER, ROBIN_DATA_DIR.
`;

async function run() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  // Trasladar flags → entorno ANTES de importar config.
  if (opts.token) process.env.ROBIN_TOKEN = opts.token;
  if (opts.folder) process.env.ROBIN_FOLDER = opts.folder;
  if (opts.dataDir) process.env.ROBIN_DATA_DIR = opts.dataDir;

  if (opts.version) {
    const { VERSION } = await import('../server/config.js');
    process.stdout.write(`robin-search ${VERSION}\n`);
    return;
  }

  if (opts.silent) {
    // Modo IT: indexar una vez y salir. Aquí stdout es seguro (no es modo MCP).
    const { bootstrap } = await import('../server/bootstrap.js');
    const { state } = await import('../server/state.js');
    const { config } = await import('../server/config.js');
    if (!config.watchedFolder) {
      process.stderr.write('robin-local: falta --folder o ROBIN_FOLDER.\n');
      process.exit(2);
    }
    process.stdout.write(`Indexando ${config.watchedFolder} ...\n`);
    await bootstrap({ initialIndex: true, watch: false, warmModel: true });
    if (state.estado === 'error') {
      process.stderr.write(`robin-local: indexado con errores: ${state.ultimoError}\n`);
      process.exit(1);
    }
    process.stdout.write('Indexado completado.\n');
    return;
  }

  // Modo por defecto: arrancar el servidor MCP (el módulo se auto-ejecuta).
  await import('../server/index.js');
}

run().catch((err) => {
  process.stderr.write(`robin-local: ${err?.message ?? err}\n`);
  process.exit(1);
});
