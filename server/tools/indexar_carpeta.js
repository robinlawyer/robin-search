// indexar_carpeta — indexa (o re-indexa) la carpeta de expedientes. Escribe en el índice
// pero no borra datos del usuario ni es destructiva: readOnlyHint:false, destructiveHint:false,
// idempotentHint:true (re-ejecutar con los mismos ficheros no cambia el resultado).

import { config, rootForPath } from '../config.js';
import { indexFolder } from '../indexer/indexer.js';
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

  const resumen = await indexFolder({
    folders,
    force: Boolean(args?.forzar),
    // Al re-indexar a mano también se retira del índice lo que ya no está en disco, para que
    // una búsqueda no siga devolviendo un escrito que se sacó del expediente.
    reconciliarBorrados: true,
  });

  // Carpeta ilegible ≠ carpeta vacía. Si la unidad de red no responde hay que decirlo, no
  // devolver un "0 documentos" que se lee como "aquí no hay nada".
  if (resumen.carpetas_inaccesibles || resumen.subcarpetas_ilegibles) {
    resumen.aviso =
      'Alguna carpeta no se ha podido leer, así que el índice puede estar incompleto. ' +
      'Si es una unidad de red, comprueba en el Explorador que sigue conectada y que la ' +
      'sesión tiene credenciales sobre ese recurso.';
  }
  return ok(resumen);
}

export default { definition, handler };
