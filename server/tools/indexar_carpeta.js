// indexar_carpeta — indexa (o re-indexa) la carpeta de expedientes. Escribe en el índice
// pero no borra datos del usuario ni es destructiva: readOnlyHint:false, destructiveHint:false,
// idempotentHint:true (re-ejecutar con los mismos ficheros no cambia el resultado).

import path from 'node:path';

import { config, rootForPath } from '../config.js';
import { indexFolder, indexandoAhora, alTerminarIndexado } from '../indexer/indexer.js';
import { log } from '../logger.js';
import { ok, fail } from './util.js';
import * as expedientes from '../expedientes.js';
import { ensureAuthorized, authPromptResult } from '../auth/oauth.js';

export const definition = {
  name: 'indexar_carpeta',
  title: 'Indexar la carpeta de expedientes',
  description:
    'Indexa los documentos de la carpeta de expedientes para poder buscarlos semánticamente. ' +
    'Soporta PDF y Word, pero también RTF/ODT/TXT/Markdown/HTML, presentaciones (PPTX/ODP), ' +
    'hojas de cálculo (XLSX/XLS/ODS/CSV), correos (.eml y .msg de Outlook), volcados de ' +
    'WhatsApp, imágenes con OCR local (JPG/PNG/TIFF/HEIC) y expedientes comprimidos ' +
    '(ZIP/RAR/7z, p. ej. de LexNet o Justizia.eus). Por defecto solo procesa ficheros nuevos ' +
    'o modificados (incremental). Usa forzar=true para re-indexar todo.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Opcional: una carpeta concreta a indexar, que debe estar DENTRO de las carpetas ' +
          'configuradas. Por defecto, todas las carpetas configuradas.',
      },
      expediente: {
        type: 'string',
        description:
          'Opcional: indexar solo un expediente (carpeta del caso), por su nombre. Alternativa ' +
          'cómoda a "path" cuando solo se ha actualizado un asunto.',
      },
      forzar: {
        type: 'boolean',
        description: 'Si es true, re-indexa aunque no haya cambios detectados.',
        default: false,
      },
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

// Con un indexado ya en marcha (el del arranque, un re-escaneo de red, uno pedido desde la app)
// NO se lanza un segundo encima: se pone en cola, como hace el canal de control, y sale en cuanto
// termine el actual. null = nada · { todas, carpetas: Set, force }.
let _cola = null;
let _drenando = false;

function encolar(folders, force) {
  _cola ??= { todas: false, carpetas: new Set(), force: false };
  if (!folders) _cola.todas = true;
  else for (const f of folders) _cola.carpetas.add(f);
  _cola.force = _cola.force || force;
}

function drenar() {
  if (!_cola || _drenando || indexandoAhora()) return;
  const c = _cola;
  _cola = null;
  _drenando = true;
  indexFolder({ folders: c.todas ? undefined : [...c.carpetas], force: c.force, reconciliarBorrados: true })
    .then((resumen) => log.info('Indexado en cola (indexar_carpeta) completado', { indexados: resumen.indexados, errores: resumen.errores }))
    .catch((err) => log.error('Fallo en el indexado en cola (indexar_carpeta)', { err: String(err) }))
    .finally(() => {
      _drenando = false;
      drenar();
    });
}
alTerminarIndexado(drenar);

export async function handler(args) {
  const auth = await ensureAuthorized();
  if (!auth.ok) return authPromptResult(auth.loginUrl);

  if (config.watchedFolders.length === 0) {
    return fail(
      'No hay carpetas de expedientes configuradas. Define ROBIN_FOLDER/ROBIN_FOLDERS.',
    );
  }

  let folders;

  if (args?.expediente) {
    const r = expedientes.resolver(args.expediente);
    if (!r.ok) {
      return fail(
        r.motivo === 'ambiguo'
          ? `El expediente "${args.expediente}" es ambiguo. Indica su ruta completa.`
          : `No hay ningún expediente llamado "${args.expediente}".`,
        { candidatos: r.candidatos, expedientes_disponibles: r.conocidos },
      );
    }
    const ruta = expedientes.rutaAbsoluta(r.expediente);
    if (!ruta) return fail(`No se localiza en disco el expediente "${r.expediente}".`);
    folders = [ruta];
  } else if (args?.path) {
    // Solo se indexa DENTRO de las carpetas que el abogado configuró. Aceptar una ruta
    // arbitraria dejaría entrar en el índice documentos de fuera del ámbito consentido (y sin
    // raíz, no tendrían expediente asignable).
    const abs = path.resolve(args.path);
    if (!rootForPath(abs)) {
      return fail(
        `La carpeta "${args.path}" está fuera de las carpetas de expedientes configuradas. ` +
          'RobinSearch solo indexa dentro de ellas — esto NO se puede cambiar desde el chat. ' +
          'Para añadirla (incluida una unidad de red Z:\\ o una ruta \\\\servidor\\recurso): ' +
          'Claude Desktop → Configuración → Extensiones → RobinSearch → "Carpeta madre de ' +
          'expedientes", y reinicia Claude Desktop.',
        { carpetas_configuradas: config.watchedFolders },
      );
    }
    folders = [abs];
  }

  if (indexandoAhora() || _drenando) {
    encolar(folders, Boolean(args?.forzar));
    return ok({
      encolado: true,
      carpetas: folders ?? config.watchedFolders,
      mensaje:
        'Ya hay un indexado en marcha: esta petición queda en cola y empieza sola en cuanto ' +
        'termine. El progreso (y el resultado) se ven en estado_servidor.',
    });
  }

  const resumen = await indexFolder({
    folders,
    force: Boolean(args?.forzar),
    // Al re-indexar a mano también se retira del índice lo que ya no está en disco, para que
    // una búsqueda no siga devolviendo un escrito que se sacó del expediente.
    reconciliarBorrados: true,
  });

  // Carpeta ilegible ≠ carpeta vacía. Si la unidad de red no responde hay que decirlo, no
  // devolver un "0 documentos" que se lee como "aquí no hay nada".
  const avisos = [];
  if (resumen.carpetas_inaccesibles || resumen.subcarpetas_ilegibles) {
    avisos.push(
      'Alguna carpeta no se ha podido leer, así que el índice puede estar incompleto. ' +
        'Si es una unidad de red, comprueba en el Explorador que sigue conectada y que la ' +
        'sesión tiene credenciales sobre ese recurso.',
    );
  }
  if (resumen.no_indexables) {
    avisos.push(
      'Parte de lo que hay en la carpeta no se ha podido indexar (ver "no_indexables"): ficheros ' +
        'en la nube sin descargar a este equipo (iCloud, OneDrive, Dropbox) o enlaces que no llevan ' +
        'a nada accesible. La búsqueda no los cubre.',
    );
  }
  // Un recuento de errores SIN causa no se puede diagnosticar desde el chat, y el abogado no
  // va a abrir el fichero de log. Las causas se devuelven agrupadas en `errores_por_causa`.
  if (resumen.errores > 0) {
    const total = resumen.errores + resumen.indexados + resumen.sinCambios + resumen.sinOcr + resumen.omitidos;
    const todos = resumen.indexados === 0 && resumen.errores === total;
    avisos.push(
      `Han fallado ${resumen.errores} fichero(s). Las causas agrupadas van en ` +
        '"errores_por_causa" (con un fichero de ejemplo por causa).' +
        (todos
          ? ' Han fallado TODOS: eso no es un problema de los documentos, sino del servidor. ' +
            'Llama a estado_servidor y mira "motor_embedding" antes que nada.'
          : ''),
    );
  }
  if (avisos.length) resumen.aviso = avisos.join(' ');
  return ok(resumen);
}

export default { definition, handler };
