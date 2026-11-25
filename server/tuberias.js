// TUBERÍAS DE STDIO CERRADAS = Claude se ha ido, no una caída (informe de Eduardo, 16-oct-2026).
//
// Cuando Claude cierra el servidor («Server transport closed (intentional shutdown)») cierra las
// tuberías de stdin/stdout/stderr. Lo que el proceso escriba después —la respuesta a una petición
// en vuelo, una línea de registro— falla con EPIPE. En macOS las tuberías son asíncronas: el fallo
// llega como evento 'error' del stream y, sin nadie que lo escuche, Node lo convierte en una
// EXCEPCIÓN NO CAPTURADA. El manejador la registraba —por stderr: otra vez EPIPE—, en bucle (210
// «Excepción no capturada» en diez segundos), dejaba la marca de fase «excepcion», mandaba un
// informe y el siguiente arranque la sumaba como caída («Caídas seguidas: 6»). No era una caída.
//
// Aquí se escuchan los dos streams (solo en el servidor MCP: stdio-guard.js llama a
// `instalarOyentesStdio`). stdout roto = nadie puede recibir ya ninguna respuesta: se avisa a quien
// se haya apuntado (diagnostico.js → salida ordenada, sin marca ni informe). stderr roto = solo se
// deja de escribir en él; el registro en fichero sigue y no hay por qué cerrar por eso.

const CODIGOS_TUBERIA_CERRADA = new Set(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END', 'ECONNRESET', 'EOF']);

// ¿Es este error el de escribir en una tubería que el otro extremo ya cerró?
export function esTuberiaCerrada(err) {
  return Boolean(err) && CODIGOS_TUBERIA_CERRADA.has(err.code);
}

let stdoutCerrado = false;
let stderrCerrado = false;
let instalados = false;
const alCerrarStdout = [];

export function stdoutCerradoYa() {
  return stdoutCerrado;
}
export function stderrCerradoYa() {
  return stderrCerrado;
}

// `fn` se llama UNA vez cuando stdout deja de poder escribirse (o enseguida, si ya pasó).
export function alCerrarseLaSalida(fn) {
  if (stdoutCerrado) queueMicrotask(fn);
  else alCerrarStdout.push(fn);
}

// Escribir en stderr sin que nada pueda lanzar ni insistir con la tubería ya rota.
export function escribirStderr(texto) {
  if (stderrCerrado) return;
  try {
    process.stderr.write(texto);
  } catch {
    /* nunca romper por un log */
  }
}

function cerrarStdout() {
  if (stdoutCerrado) return;
  stdoutCerrado = true;
  for (const fn of alCerrarStdout.splice(0)) {
    try {
      fn();
    } catch {
      /* nada */
    }
  }
}

// Cualquier 'error' de estos dos streams se queda aquí: un evento 'error' sin oyente tumba el
// proceso, y un stdout/stderr que da error ya no sirve para nada más.
export function instalarOyentesStdio({ stdout = process.stdout, stderr = process.stderr } = {}) {
  if (instalados) return;
  instalados = true;
  stdout.on('error', cerrarStdout);
  stderr.on('error', () => {
    stderrCerrado = true;
  });
}
