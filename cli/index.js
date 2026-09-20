#!/usr/bin/env node
// CLI de RobinSearch.
//
//   robin-search                         → arranca el servidor MCP (stdio). Este es el modo
//                                         que usan Claude Desktop (.mcpb), Claude Code y Cursor.
//   robin-search --silent --token=... --folder=...
//                                       → modo IT: indexa la carpeta una vez y sale (0). Sirve
//                                         para pre-cargar el índice en despliegues masivos
//                                         (GPO/JAMF/Intune) sin interacción del usuario.
//
// Los flags --token y --folder rellenan ROBIN_TOKEN y ROBIN_FOLDER. Se procesan ANTES de
// cargar cualquier módulo que lea la configuración (import dinámico) para que surtan efecto.

// Lo primero: con un Node demasiado antiguo se dice claro y se sale (no lee configuración).
import '../server/version-node.js';

function parseArgs(argv) {
  const opts = { silent: false, help: false, version: false, folders: [], _: [] };
  for (const arg of argv) {
    if (arg === '--silent' || arg === '-s') opts.silent = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-v') opts.version = true;
    else if (arg.startsWith('--token=')) opts.token = arg.slice('--token='.length);
    // --folder puede repetirse para vigilar varias carpetas.
    else if (arg.startsWith('--folder=')) opts.folders.push(arg.slice('--folder='.length));
    else if (arg.startsWith('--folders=')) {
      for (const f of arg.slice('--folders='.length).split(/[\n;]+/)) if (f.trim()) opts.folders.push(f.trim());
    } else if (arg.startsWith('--data-dir=')) opts.dataDir = arg.slice('--data-dir='.length);
    else if (arg === 'index') opts.silent = true;
    else if (arg === 'serve' || arg === 'login' || arg === 'logout') opts._.push(arg);
    // `correo` y todo lo que venga detrás es para su propio CLI (server/correo/cli.js): sus
    // banderas no son carpetas de expedientes.
    else if (arg === 'correo') { opts.correo = []; opts._.push(arg); }
    else if (opts.correo) opts.correo.push(arg);
    // Cualquier otro argumento posicional es una CARPETA de expedientes. Así es como el
    // instalador .mcpb pasa las (varias) carpetas: se expanden como argumentos.
    else opts.folders.push(arg);
  }
  return opts;
}

const HELP = `RobinSearch — servidor MCP local de búsqueda en expedientes.

Uso:
  robin-search [comando] [opciones]

Comandos:
  login                 Inicia sesión en RobinLawyer.ai (abre el navegador). Guarda la sesión.
  logout                Cierra la sesión y borra las credenciales locales.
  correo                Conecta el buzón del abogado (IMAP/SMTP). «robin-search correo» para la
                        ayuda. La contraseña se lee por la ENTRADA ESTÁNDAR, nunca como
                        argumento: en argumento la vería cualquiera con un ps.

Opciones:
  (sin opciones)        Arranca el servidor MCP por stdio (Claude Desktop / Code / Cursor).
  --silent, -s          Modo IT: indexa la carpeta una vez y sale. No arranca el servidor.
  --token=TOKEN         Token pre-provisionado para IT/headless (equivale a ROBIN_TOKEN). El
                        abogado normal NO lo necesita: inicia sesión con "login".
  --folder=RUTA         Carpeta de expedientes. Repetible para vigilar VARIAS carpetas.
  --folders=A;B;C       Varias carpetas de una vez (separadas por ; o salto de línea).
  --data-dir=RUTA       Directorio de datos (índice/logs). Por defecto, dir de la app del SO.
  --version, -v         Muestra la versión.
  --help, -h            Muestra esta ayuda.

Variables de entorno equivalentes: ROBIN_TOKEN, ROBIN_FOLDER, ROBIN_FOLDERS, ROBIN_DATA_DIR.
`;

async function run() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  // Trasladar flags → entorno ANTES de importar config. Se usa ROBIN_FOLDERS (multi) para
  // todos los casos: parseFolders() en config.js acepta 1 ruta, varias, o un array JSON
  // (según cómo expanda las carpetas el cliente).
  if (opts.token) process.env.ROBIN_TOKEN = opts.token;
  if (opts.folders.length) process.env.ROBIN_FOLDERS = opts.folders.join('\n');
  if (opts.dataDir) process.env.ROBIN_DATA_DIR = opts.dataDir;

  if (opts.version) {
    const { VERSION } = await import('../server/config.js');
    process.stdout.write(`robin-search ${VERSION}\n`);
    return;
  }

  // Los certificados raíz del sistema (proxy/antivirus del despacho) antes de cualquier conexión.
  if (opts._.includes('login') || opts._.includes('logout') || opts.silent) {
    const { usarCertificadosDelSistema } = await import('../server/red-corporativa.js');
    usarCertificadosDelSistema();
  }

  // Conectar el correo del abogado. No es modo MCP → stdout seguro (devuelve JSON).
  if (opts._.includes('correo')) {
    const { ejecutar } = await import('../server/correo/cli.js');
    process.exit(await ejecutar(opts.correo || []));
  }

  // Iniciar / cerrar sesión en RobinLawyer.ai (OAuth). No es modo MCP → stdout seguro.
  if (opts._.includes('login')) {
    const { loginInteractive } = await import('../server/auth/oauth.js');
    process.exit((await loginInteractive()) ? 0 : 1);
  }
  if (opts._.includes('logout')) {
    const { logout } = await import('../server/auth/oauth.js');
    await logout();
    process.stdout.write('Sesión cerrada.\n');
    return;
  }

  if (opts.silent) {
    // Modo IT: indexar una vez y salir. Aquí stdout es seguro (no es modo MCP).
    const { bootstrap } = await import('../server/bootstrap.js');
    const { state } = await import('../server/state.js');
    const { config } = await import('../server/config.js');
    if (config.watchedFolders.length === 0) {
      process.stderr.write('robin-search: falta --folder/--folders o ROBIN_FOLDER/ROBIN_FOLDERS.\n');
      process.exit(2);
    }
    process.stdout.write(`Indexando ${config.watchedFolders.length} carpeta(s):\n  ${config.watchedFolders.join('\n  ')}\n`);
    await bootstrap({ initialIndex: true, watch: false, warmModel: true });
    if (state.estado === 'error') {
      process.stderr.write(`robin-search: indexado con errores: ${state.ultimoError}\n`);
      process.exit(1);
    }
    process.stdout.write('Indexado completado.\n');
    // Salida explícita: los hilos de embedding que quedan esperando trabajo mantendrían vivo el
    // proceso, y un despliegue de IT que espera a que termine se quedaba colgado. El registro
    // pendiente se vuelca en el manejador de 'exit'.
    process.exit(0);
  }

  // Modo por defecto: arrancar el servidor MCP (el módulo se auto-ejecuta).
  await import('../server/index.js');
}

run().catch((err) => {
  process.stderr.write(`robin-search: ${err?.message ?? err}\n`);
  process.exit(1);
});
